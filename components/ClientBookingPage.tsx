"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { PageShell } from "@/components/PageShell";
import { useIsMobile } from "@/lib/use-is-mobile";
import { useKeyboardAwareViewport } from "@/lib/use-keyboard-viewport";
import { TimeSlotCard } from "@/components/TimeSlotCard";
import { TimeSlotGridSkeleton, Skeleton } from "@/components/Skeleton";
import { AppointmentCard } from "@/components/AppointmentCard";
import {
  STYLIST,
  CONSULTATION_SLOTS,
  MOCK_TODAY,
  MOCK_AVAILABILITY_HORIZON,
  SERVICES,
  getShortlist,
  extractPhoneDigits,
  formatPhoneDisplay,
  formatPhoneAsTyped,
  findUpcomingByPhone,
} from "@/lib/mock-data";
import { useAppointments } from "@/lib/appointments-store";
import type { Appointment, Service, TimeSlot } from "@/lib/types";
import {
  parseClientMessage,
  extractTimeHints,
  getClarifyingQuestion,
  getRecommendedServices,
  getAssistantResponse,
  rankTimeSlots,
  filterSlotsByRefinement,
  getSlotsForWeekShift,
  findSlotByMention,
  getSlotsForService,
  EMPTY_CONTEXT,
  type AssistantContext,
  type Intent,
  type IntentTag,
  type LengthHint,
  type PermStyle,
  type ColorDirection,
  type Recommendation,
  type TimeHints,
} from "@/lib/parse-intent";
import {
  formatPriceAnswer,
  formatDurationAnswer,
  formatCombinedBookingSummary,
  getEstimatedTotalPrice,
  getEstimatedTotalDuration,
} from "@/lib/booking-summary";
import { cn } from "@/lib/cn";
import { track } from "@/lib/analytics";
import { detectUnsupportedService } from "@/lib/unsupported-services";
import { decideGuidancePresentation } from "@/lib/ai/guidance-presentation";
import { categoryBrowseOptions } from "@/lib/ai/category-browse";
import { normalizeTimePreferenceLocale } from "@/lib/ai/locale-normalize";

/* -------------------------------------------------------------------------- */
/* Types                                                                       */
/* -------------------------------------------------------------------------- */

type Stage =
  | "home"
  | "browse"
  | "service-picker"
  | "manage-lookup"
  | "usual-lookup"
  | "time"
  | "details"
  | "review"
  | "reschedule-review"
  | "confirmed"
  | "consultation"
  | "custom";

type AssistantTurn =
  | {
      kind: "bot-text";
      id: string;
      text: string;
      /**
       * Optional routing source — used to render the debug label under the
       * bubble when localStorage.kasa_debug === "1". Not present on
       * deterministically-generated bot turns; present on AI-routed turns.
       */
      source?:
        | "deterministic-facts+ai"
        | "deterministic-fallback"
        | "ai"
        | "fallback"
        | "cached";
    }
  | { kind: "user-text"; id: string; text: string }
  // Transient "Shen is typing…" bubble shown while a response is being fetched.
  // Removed as soon as the real turn renders. `label` is context-aware copy.
  | { kind: "typing"; id: string; label: string }
  | {
      kind: "clarify";
      id: string;
      text: string;
      options: { label: string; key: string }[];
      consumed?: boolean;
    }
  | {
      kind: "recommendation";
      id: string;
      rec: Recommendation;
      ackText: string;
      acted?: boolean;
    }
  | { kind: "alternates"; id: string; services: Service[]; recommendedId: string | null }
  | {
      kind: "times";
      id: string;
      slots: TimeSlot[];
      // Navigation context for the chip rows below the slot grid
      anchorDateKey: string | null;
      currentWeekShift: number | null; // 0 / 1 / 2 — drives chip availability
      // Which nav chips should render. Computed once when the turn is built so
      // we don't pass full service slot lists down the tree just for this.
      chipAvailability: Record<NavChipKey, boolean>;
      // ── Recommendation-first presentation ──────────────────────────────────
      // A short, context-derived lead-in ("Found a few good times for your Root
      // Touch-up, next Tuesday afternoon"). Null → no intro (generic listing).
      intro?: string | null;
      // The 3–6 RECOMMENDED slots shown first (the hero set). `slots` holds the
      // FULL contextually-relevant set; everything beyond the recommendations is
      // revealed on "See all". When absent we fall back to showing `slots`.
      recommended?: TimeSlot[];
      // Label for the expand action, e.g. "See all Tuesday times". Null → no
      // expansion offered (recommended IS everything).
      seeAllLabel?: string | null;
      // Specific-time mode (user pinned an exact hour): "hit" = that time is
      // open (intro is a yes + the one slot); "near" = not open, recommended are
      // the closest. null = normal range recommendation.
      exactStatus?: "hit" | "near" | null;
    }
  | { kind: "consult-cta"; id: string; reason?: string }
  | { kind: "custom-cta"; id: string }
  | {
      kind: "appointment-list";
      id: string;
      appointments: Appointment[];
      consumed?: boolean;
    }
  | {
      kind: "manage-chips";
      id: string;
      chips: { label: string; key: ManageChipKey }[];
      consumed?: boolean;
    }
  | {
      kind: "service-browser";
      id: string;
      groups: { category: string; services: Service[] }[];
    }
  | {
      // Handoff card — the user asked something complex/custom and we're
      // offering to send a summary to the stylist. Renders a small form
      // (name + phone + editable summary). Marked submitted once sent so
      // we don't double-submit.
      kind: "handoff";
      id: string;
      summary: string;
      sourceMessage: string;
      submitted?: boolean;
    };

type ManageChipKey =
  | "manage-try-again"
  | "manage-try-phone4"
  | "manage-book-instead"
  | "manage-book-another";

type ManageMode = "book" | "reschedule" | "cancel" | null;

type NavChipKey =
  | "earlier-day"
  | "later-day"
  | "next-day"
  | "this-week"
  | "next-week"
  | "week-after"
  | "pick-date"
  | "see-all";

const NAV_CHIP_LABELS: Record<NavChipKey, string> = {
  "earlier-day": "Earlier that day",
  "later-day": "Later that day",
  "next-day": "Next day",
  "this-week": "This week",
  "next-week": "Next week",
  "week-after": "Week after",
  "pick-date": "Pick a date",
  "see-all": "See all openings",
};

// Chips use the actual catalog category names so they always match what the
// stylist offers — no paraphrasing. The special "__browse__" preset opens the
// full service list. "__cat:<name>" opens just that category's services.
function buildPromptChips(services: Service[]): { label: string; preset: string }[] {
  const categories = Array.from(new Set(
    services.filter((s) => s.status !== "hidden" && s.category !== "Other").map((s) => s.category)
  ));
  const chips: { label: string; preset: string }[] = categories.slice(0, 4).map((cat) => ({
    label: cat as string,
    preset: `__cat:${cat}`,
  }));
  chips.push({ label: "Not sure", preset: "__browse__" });
  return chips;
}

const PROMPT_CHIPS = buildPromptChips(SERVICES);

const MODE_CHIPS: { label: string; mode: Exclude<ManageMode, null> }[] = [
  { label: "Book a new appointment", mode: "book" },
  { label: "Reschedule an appointment", mode: "reschedule" },
  { label: "Cancel an appointment", mode: "cancel" },
];

// Mutable profile — populated from /api/stylist on mount. Falls back to mock
// data so the page renders immediately while the fetch is in flight.
const stylistProfile = {
  name: STYLIST.name,
  location: STYLIST.location,
  initials: STYLIST.initials,
};

function sName() { return stylistProfile.name; }

/**
 * Pre-NLU intent matchers for utility flows. These route the user directly
 * to the dedicated lookup stages instead of the assistant chat, because
 * "book my usual" and "manage my appointment" have purpose-built UI that's
 * faster than a multi-turn chat conversation. Patterns are permissive on
 * purpose — these are the kinds of phrases real users actually type.
 *
 * Returns true if the input matches "book my usual" / "the usual" / etc.
 * Excludes phrases like "usual price" or "usual hours" that aren't booking
 * intents but happen to contain the word.
 */
function matchesUsualIntent(lower: string): boolean {
  // Must contain "usual" as a whole word, plus a booking verb or pronoun
  // ("my", "the") that strongly implies "repeat my last service."
  if (!/\busual\b/.test(lower)) return false;
  if (/\b(my|the)\s+usual\b/.test(lower)) return true;
  if (/^(book|do|get)\s+(my\s+)?usual\b/.test(lower)) return true;
  if (/\busual\s+(again|please|booking|appointment)\b/.test(lower)) return true;
  return false;
}

/**
 * Returns true if the input is a manage-appointment intent: reschedule,
 * cancel, change an existing booking. Tight enough to not catch booking
 * queries like "I want to schedule a haircut" (which contains "schedule"
 * but is a NEW booking, not a manage).
 */
function matchesManageIntent(lower: string): boolean {
  // Cancel / reschedule a specific existing booking.
  if (/\b(cancel|reschedule)\b.*\b(appointment|booking|my)\b/.test(lower))
    return true;
  if (/\b(cancel|reschedule)\s+(it|that|this|my)\b/.test(lower)) return true;
  // "I have a booking" / "I need to manage" patterns.
  if (/\b(have|got)\s+(a|an)\s+(booking|appointment)\b/.test(lower))
    return true;
  if (/\b(manage|change|move)\s+(my\s+)?(appointment|booking)\b/.test(lower))
    return true;
  // Bare "cancel" / "reschedule" with no other booking signal — short
  // single-word utterances are very likely about an existing booking.
  if (/^(cancel|reschedule)$/.test(lower.trim())) return true;
  return false;
}

/* -------------------------------------------------------------------------- */
/* AI chat client-side config                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Cap per session — after N AI calls we route the next ask straight to the
 * handoff form instead of burning more model quota. Lives in localStorage so
 * a refresh doesn't reset it; cleared on resetConversation.
 */
const SESSION_AI_LIMIT = 30;
const SESSION_AI_STORAGE_KEY = "kasa_session_ai_count";

function getSessionAICount(): number {
  if (typeof window === "undefined") return 0;
  const raw = window.localStorage.getItem(SESSION_AI_STORAGE_KEY);
  const parsed = raw ? Number(raw) : 0;
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

function bumpSessionAICount() {
  if (typeof window === "undefined") return;
  const next = getSessionAICount() + 1;
  window.localStorage.setItem(SESSION_AI_STORAGE_KEY, String(next));
}

function clearSessionAICount() {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(SESSION_AI_STORAGE_KEY);
}

/**
 * Local debug flag — toggled via `localStorage.kasa_debug = "1"` in dev
 * tools. Drives the small source-label under bot bubbles. Never reads any
 * env var; never visible in production unless the user explicitly sets the
 * key. Safe to ship.
 */
function isLocalDebugOn(): boolean {
  if (typeof window === "undefined") return false;
  return window.localStorage.getItem("kasa_debug") === "1";
}

function clarificationPreamble(intent: Intent): string {
  if (intent.kind !== "book" && intent.kind !== "switch_service") {
    return "Got it — I just need one detail.";
  }
  const tags = new Set(intent.tags);
  const isSwitch = intent.kind === "switch_service";

  if (tags.has("Perm") && tags.has("Haircut")) {
    return isSwitch
      ? "Totally — switching to a perm with a haircut. One quick detail."
      : "Got it — for a perm plus haircut, I just need one detail.";
  }
  if (tags.has("Haircut")) {
    return isSwitch
      ? "Totally — switching to a haircut. One quick question."
      : "Perfect — that sounds like a haircut. One quick question.";
  }
  if (tags.has("Color")) {
    return isSwitch
      ? "Totally — switching to color."
      : "Got it — that sounds like a color service.";
  }
  if (tags.has("Treatment")) {
    return isSwitch
      ? "Totally — switching to a treatment."
      : "Got it — let's set up a treatment.";
  }
  return isSwitch ? "Totally — switching." : "Got it — I just need one detail.";
}

/* -------------------------------------------------------------------------- */
/* Page                                                                        */
/* -------------------------------------------------------------------------- */

// Convert a "YYYY-MM-DD" + "HH:MM" New York wall-clock time to a UTC ISO string.
function nyWallToUtcIso(dateKey: string, hm: string): string {
  const [year, month, day] = dateKey.split("-").map(Number);
  const [hour, minute] = hm.split(":").map(Number);
  // Build a candidate UTC ms, then read back the NY offset at that instant.
  const candidate = Date.UTC(year, month - 1, day, hour, minute, 0);
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    hour: "numeric",
    hour12: false,
    timeZoneName: "shortOffset",
  }).formatToParts(new Date(candidate));
  const tzPart = parts.find((p) => p.type === "timeZoneName")?.value ?? "GMT-5";
  const offsetHours = parseInt(tzPart.replace("GMT", ""), 10);
  const utcMs = Date.UTC(year, month - 1, day, hour, minute, 0) - offsetHours * 3600 * 1000;
  return new Date(utcMs).toISOString();
}

// ── Real availability source ────────────────────────────────────────────────
//
// For a slug-based provider (e.g. /book/shen), slots come ONLY from
// /api/availability — never mock. If the API returns 0 slots, callers show an
// honest empty state ("No openings this week"). Mock is used ONLY on the
// legacy slug-less /shen / internal demo path.
//
// /api/availability returns the full multi-week set (weekCount: 3), so we
// fetch once per service and cache it. The cache is module-level keyed by
// (slug, serviceId) so the chat helpers and TimeStage share one fetch.

// Cache entries carry the local calendar date they were fetched on. Slots are
// date-relative ("tomorrow", min-notice, past-time filtering all key off the
// current day), so a cache built yesterday is wrong today. We treat any entry
// whose fetch-date != today as cold and re-fetch — this is what keeps a
// long-open tab fresh WITHOUT the user needing to refresh.
type SlotCacheEntry = { fetchedOn: string; slots: TimeSlot[] };
const realSlotsCache = new Map<string, SlotCacheEntry>();

function localDateStamp(): string {
  // Local calendar day, e.g. "2026-06-18". Cheap; called on each cache read.
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate()
  ).padStart(2, "0")}`;
}

/** Read a cache entry only if it was fetched today; otherwise treat as cold. */
function freshCachedSlots(key: string): TimeSlot[] | null {
  const entry = realSlotsCache.get(key);
  if (!entry) return null;
  if (entry.fetchedOn !== localDateStamp()) {
    realSlotsCache.delete(key); // stale (day rolled over) → force re-fetch
    return null;
  }
  return entry.slots;
}

function realSlotsCacheKey(serviceId: string, slug?: string): string {
  return `${slug ?? "__legacy__"}::${serviceId}`;
}

/** Invalidate cached slots for a service (e.g. after a booking consumes one). */
function invalidateRealSlots(serviceId: string, slug?: string) {
  realSlotsCache.delete(realSlotsCacheKey(serviceId, slug));
}

/**
 * SYNCHRONOUS read of already-cached real slots, for the chat helpers that run
 * inside non-async handlers. The cache is primed on service selection (see the
 * priming effect in the component), so it's warm by the time these run.
 *
 * - slug provider: returns cached real slots, or [] if cold — NEVER mock.
 *   (A cold cache is rare; if it happens the helper shows the empty state,
 *   which is correct: better than fabricating Mon/Wed slots.)
 * - slug-less legacy/demo: returns mock so /shen keeps working.
 */
function cachedRealSlots(serviceId: string, slug?: string): TimeSlot[] {
  const cached = freshCachedSlots(realSlotsCacheKey(serviceId, slug));
  if (cached) return cached;
  if (slug) return []; // real provider, cold/stale cache → empty, never mock
  return getSlotsForService(serviceId); // legacy demo only
}

/**
 * All available slots (3 weeks) for a service.
 *
 * - slug present (real provider): returns ONLY API slots. On error or empty,
 *   returns [] — NEVER mock. Callers render the honest empty state.
 * - slug absent (legacy demo): falls back to mock so /shen still works.
 */
async function getRealSlots(
  serviceId: string,
  slug?: string
): Promise<TimeSlot[]> {
  const key = realSlotsCacheKey(serviceId, slug);
  const cached = freshCachedSlots(key);
  if (cached) return cached;

  const isRealProvider = Boolean(slug);
  const stamp = localDateStamp();
  try {
    const slugParam = slug ? `&slug=${encodeURIComponent(slug)}` : "";
    // weekShift=0 — the API returns weekCount:3 from this point, covering the
    // 3 week tabs the UI buckets client-side.
    const res = await fetch(
      `/api/availability?serviceId=${encodeURIComponent(serviceId)}&weekShift=0${slugParam}`
    );
    if (!res.ok) throw new Error("availability api error");
    const data = await res.json();
    if (Array.isArray(data.slots)) {
      const slots = data.slots as TimeSlot[];
      // Real provider: cache + return whatever the API gave (incl. []).
      if (isRealProvider) {
        realSlotsCache.set(key, { fetchedOn: stamp, slots });
        return slots;
      }
      // Legacy: use API slots if non-empty, else mock below.
      if (slots.length > 0) {
        realSlotsCache.set(key, { fetchedOn: stamp, slots });
        return slots;
      }
    }
  } catch {
    // Real provider: do NOT fall back to mock — an error means "we couldn't
    // load real availability", and showing fake slots would be worse.
    if (isRealProvider) {
      realSlotsCache.set(key, { fetchedOn: stamp, slots: [] });
      return [];
    }
    // Legacy: fall through to mock below.
  }

  // Slug-less legacy / internal demo only.
  const mock = getSlotsForService(serviceId);
  realSlotsCache.set(key, { fetchedOn: stamp, slots: mock });
  return mock;
}

// Legacy helper kept for the single existing fetch call site. For real
// providers it now delegates to getRealSlots (no mock); for slug-less it
// preserves the old mock-fallback behavior.
async function fetchSlotsForService(
  serviceId: string,
  weekShift = 0,
  slug?: string
): Promise<TimeSlot[]> {
  // weekShift is honored by the caller's own filtering; getRealSlots returns
  // the full 3-week set which the caller buckets/filters as before.
  void weekShift;
  return getRealSlots(serviceId, slug);
}

/**
 * The client booking surface. Accepts an optional `slug` so the same
 * component can serve multiple providers via /book/[slug]. When `slug` is
 * undefined (the legacy /shen and /internal/shen entry points), the API
 * routes fall back to the first stylist row — preserving current behavior.
 *
 * `slug` is threaded into the four provider-scoped API calls (/api/stylist,
 * /api/chat, /api/availability, /api/handoff) as a query param. No UI/UX
 * change — this is purely about *which provider's* data the page reads.
 */
export function ClientBookingPage({
  slug,
  unsupportedTerms,
  syncedServices,
}: {
  slug?: string;
  unsupportedTerms?: string[];
  syncedServices?: Service[];
} = {}) {
  // Query-string suffix appended to provider-scoped API calls. Empty string
  // when no slug (legacy path), so existing fetches are byte-for-byte the
  // same as before.
  const slugQS = slug ? `slug=${encodeURIComponent(slug)}` : "";

  // Effective catalog for RENDERING tappable service cards / browse views.
  // Synced provider services when available (cards carry svc-* ids that book
  // through the existing flow), else the mock SERVICES — preserving demo and
  // no-Square behavior. NOTE: this is for rendering only; parse-intent.ts and
  // the booking routes are untouched and still resolve via service_catalog.
  const effectiveCatalog: Service[] =
    syncedServices && syncedServices.length > 0 ? syncedServices : SERVICES;

  const [stage, setStage] = useState<Stage>("home");

  // Entry screen vs assistant chat. Defaults to false (entry screen visible) so
  // confident clients can fast-book without engaging the chat. "Help me choose"
  // or typing flips it on; resetConversation() flips it back to entry. Declared
  // here (above the history effects) because the history model tracks it.
  const [assistantOpen, setAssistantOpen] = useState(false);

  // ── Native browser back/forward ────────────────────────────────────────────
  // The booking flow is a single client component with a local `stage`, so the
  // browser's back button did nothing. We mirror stage transitions into the
  // history stack: entering a non-home stage pushes an entry; the OS back button
  // fires popstate, which we map back to the previous stage. A ref guard stops
  // the popstate-driven setStage from pushing again (which would loop).
  const isPoppingRef = useRef(false);

  // History model: a "view" = { stage, chatOpen }. The public entry screen is
  // the BASE (chatOpen:false, stage:home). Opening chat pushes a layer; deeper
  // stages push further. Back walks layers down: deep stage → base chat → public
  // entry — so the user is never trapped inside chat (the old bug: chat-open
  // wasn't in history, so Back from the base chat did nothing).
  const prevViewRef = useRef<{ stage: Stage; chatOpen: boolean }>({ stage: "home", chatOpen: false });

  useEffect(() => {
    if (typeof window !== "undefined" && !window.history.state?.kasaView) {
      window.history.replaceState({ kasaView: { stage: "home", chatOpen: false } }, "");
    }
    function onPop(e: PopStateEvent) {
      const v = (e.state?.kasaView as { stage: Stage; chatOpen: boolean } | undefined) ?? {
        stage: "home",
        chatOpen: false,
      };
      let targetStage = v.stage;
      // Cold-land guard: stages that need prior context fall to home if missing.
      const needsContext: Stage[] = ["time", "details", "review", "reschedule-review", "confirmed"];
      if (
        needsContext.includes(targetStage) &&
        !contextRef.current.selectedService &&
        !contextRef.current.lastRecommendedService
      ) {
        targetStage = "home";
      }
      isPoppingRef.current = true; // suppress the push the view effect would do
      setStage(targetStage);
      setAssistantOpen(v.chatOpen);
    }
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  useEffect(() => {
    // Reflect (stage, assistantOpen) changes into history — except when the
    // change came FROM a back/forward (popstate), which would double-push.
    if (isPoppingRef.current) {
      isPoppingRef.current = false;
      prevViewRef.current = { stage, chatOpen: assistantOpen };
      return;
    }
    const prev = prevViewRef.current;
    if (prev.stage === stage && prev.chatOpen === assistantOpen) return;
    if (typeof window !== "undefined") {
      const view = { stage, chatOpen: assistantOpen };
      // The public base (entry, chat closed, home stage) is replaceState; every
      // deeper view (chat open, or a non-home stage) pushes so Back peels it off.
      if (stage === "home" && !assistantOpen) {
        window.history.replaceState({ kasaView: view }, "");
      } else {
        window.history.pushState({ kasaView: view }, "");
      }
    }
    prevViewRef.current = { stage, chatOpen: assistantOpen };
  }, [stage, assistantOpen]);


  // Category fast path: when the user taps a category chip on the entry
  // screen, we set this and route to the service picker stage.
  const [pickerCategory, setPickerCategory] = useState<string | null>(null);

  // Three-bucket context — single source of truth for the assistant
  const [context, setContext] = useState<AssistantContext>(EMPTY_CONTEXT);
  // Mirror of context for the once-bound popstate handler (avoids a stale
  // closure when deciding whether a back-target stage has the context it needs).
  const contextRef = useRef(context);
  useEffect(() => {
    contextRef.current = context;
  }, [context]);

  // Start with an empty turn list: the chat should not greet first. The
  // user's first message opens the conversation; everything else is a
  // response to that. Removed the canned "Hi! What brings you in…" intro
  // so the surface feels conversational, not scripted.
  const [turns, setTurns] = useState<AssistantTurn[]>([]);
  const [chipsLocked, setChipsLocked] = useState(false);
  // Booking result after POSTing to /api/bookings
  const [bookingResult, setBookingResult] = useState<{
    bookingId: string;
    squareBookingId: string | null;
  } | null>(null);

  // Holds the client info collected in DetailsStage so ReviewStage can show
  // it and submit the booking. Cleared by resetConversation so a fresh
  // session doesn't carry over stale data.
  const [pendingClientInfo, setPendingClientInfo] = useState<ClientInfo | null>(
    null
  );

  // Inline recommendation surfaced on the entry screen when the intent input
  // resolves cleanly to a single confident service. When set, the entry
  // screen renders a recommendation card instead of dropping into chat.
  // Cleared on reset, on "Not quite right" (which drops to chat), and on
  // any subsequent intent submission.
  const [entryRecommendation, setEntryRecommendation] = useState<{
    userText: string;
    rec: Recommendation;
  } | null>(null);

  // When the user taps "Show all [Category]" from the recommendation card,
  // BrowseAllServicesStage opens pre-filtered to that category.
  const [browseInitialCategory, setBrowseInitialCategory] = useState<
    string | null
  >(null);

  // Manage flow (reschedule / cancel) — kept as local state so parse-intent
  // stays focused on booking NLU. mode === null means the mode picker is the
  // active step; otherwise we're inside one of the three sub-flows.
  const [mode, setMode] = useState<ManageMode>(null);
  const [pendingAppointment, setPendingAppointment] = useState<Appointment | null>(null);
  // After name lookup finds a match, we ask for last-4 confirmation before acting
  const [awaitingPhone4, setAwaitingPhone4] = useState(false);
  // Last-4 the user typed and the server confirmed. Passed back to /api/bookings/cancel
  // so the server can re-verify ownership before cancelling — the only acceptable
  // pattern, since UI state could be tampered with.
  const [verifiedLast4, setVerifiedLast4] = useState<string | null>(null);
  // Picked-but-not-yet-committed slot for a page-level reschedule. When set,
  // RescheduleReviewStage is showing the user the old → new comparison and
  // waiting for them to confirm before the swap actually fires.
  const [pendingRescheduleSlot, setPendingRescheduleSlot] =
    useState<TimeSlot | null>(null);
  // Tracks where the reschedule started so RescheduleReviewStage knows
  // where to return on "Keep original time":
  //   "page" — user came via ManageLookupStage → back to manage-lookup
  //   "chat" — user came via chat assistant → back to home (closes chat)
  const [rescheduleOrigin, setRescheduleOrigin] =
    useState<"page" | "chat" | null>(null);
  const {
    today,
    upcoming,
    cancelAppointment,
    rescheduleAppointment,
  } = useAppointments();

  // Profile from Supabase — overrides mock fallback once loaded
  const [profile, setProfile] = useState({
    name: stylistProfile.name,
    location: stylistProfile.location,
    initials: stylistProfile.initials,
  });

  useEffect(() => {
    fetch(`/api/stylist${slugQS ? `?${slugQS}` : ""}`)
      .then((r) => r.ok ? r.json() : null)
      .then((data) => {
        if (!data?.name) return;
        const initials = data.name.trim().split(/\s+/).map((w: string) => w[0]).join("").slice(0, 2).toUpperCase();
        const next = {
          name: data.name,
          location: data.location ?? stylistProfile.location,
          initials,
        };
        stylistProfile.name = next.name;
        stylistProfile.location = next.location;
        stylistProfile.initials = next.initials;
        setProfile(next);
      })
      .catch(() => {});
  }, [slugQS]);

  // Keep a long-open tab fresh. When the user returns to a backgrounded tab
  // (or refocuses the window), drop the cached availability so the next read
  // re-fetches against the real current time. Without this, a tab left open
  // overnight serves yesterday's slots ("haircut tomorrow" → today's times)
  // until a manual refresh. The date-stamped cache handles the day-rollover
  // case; this also covers same-session staleness after hours idle.
  useEffect(() => {
    function refreshIfVisible() {
      if (document.visibilityState === "visible") {
        realSlotsCache.clear();
      }
    }
    document.addEventListener("visibilitychange", refreshIfVisible);
    window.addEventListener("focus", refreshIfVisible);
    return () => {
      document.removeEventListener("visibilitychange", refreshIfVisible);
      window.removeEventListener("focus", refreshIfVisible);
    };
  }, []);

  // Prime the real-slots cache whenever a service becomes active or
  // recommended, so the synchronous chat helpers (cachedRealSlots) have real
  // availability ready and never fall back to mock for a slug provider.
  const primeServiceId =
    context.selectedService?.id ?? context.lastRecommendedService?.id ?? null;
  useEffect(() => {
    if (!primeServiceId) return;
    // Fire-and-forget: getRealSlots caches the result keyed by (slug, id).
    void getRealSlots(primeServiceId, slug);
  }, [primeServiceId, slug]);

  const assistantRef = useRef<HTMLDivElement | null>(null);

  const isMobile = useIsMobile();
  const viewport = useKeyboardAwareViewport();

  /* ---------------------- Context helpers ---------------------- */

  function patchContext(patch: Partial<AssistantContext>) {
    setContext((prev) => ({ ...prev, ...patch }));
  }

  function showSlots(
    slots: TimeSlot[],
    anchorDateKey: string | null,
    currentWeekShift: number | null = null,
    // When the caller already pushed its own lead-in (e.g. a refinement ack
    // like "Here are more openings…"), suppress the recommendation intro so the
    // user doesn't see two near-identical messages stacked.
    suppressIntro = false,
    // The FULL service slot set, for computing exploration-chip availability.
    // Pass it when the caller just fetched it — the cache read alone can be cold
    // on some paths, which silently dropped the chips. Falls back to the cache
    // then the displayed slots when omitted.
    allServiceSlots?: TimeSlot[]
  ) {
    const svc = context.selectedService ?? context.lastRecommendedService;
    // Chip availability needs the FULL service slot set. Prefer an explicitly
    // passed set (callers that just fetched it), then the cache, then — as a
    // last resort — the displayed slots. The cache read alone was unreliable
    // here: on the clarification path it could be cold/mis-keyed when state
    // hadn't flushed, which silently dropped all the exploration chips
    // (Earlier/Later/Next day/See all), so the user couldn't see more times.
    const fullServiceSlots =
      allServiceSlots && allServiceSlots.length > 0
        ? allServiceSlots
        : svc && cachedRealSlots(svc.id, slug).length > 0
          ? cachedRealSlots(svc.id, slug)
          : slots;
    const chipAvailability = computeChipAvailability(
      fullServiceSlots,
      anchorDateKey,
      currentWeekShift,
      slots
    );
    // Recommendation-first: lead with 3–6 context-ranked times (the real
    // requested hints, not emptyHints), reveal the rest behind "See all".
    const reco = buildRecommendation(
      slots,
      context.lastIntentTimeHints,
      svc?.name ?? "appointment"
    );
    pushTurn({
      kind: "times",
      id: `t-times-${Date.now()}`,
      slots,
      anchorDateKey,
      currentWeekShift,
      chipAvailability,
      intro: suppressIntro ? null : reco.intro,
      recommended: reco.recommended,
      seeAllLabel: reco.seeAllLabel,
      exactStatus: reco.exactStatus ?? null,
    });
    patchContext({
      lastShownSlots: slots,
      lastAnchorDateKey:
        anchorDateKey ?? (slots.length > 0 ? slots[0].dateKey : null),
    });
  }

  function pushTurn(turn: AssistantTurn) {
    setTurns((prev) => [...prev, turn]);
  }

  // ── Typing indicator ───────────────────────────────────────────────────────
  // Show a transient "Shen is typing…" bubble while a response is in flight, so
  // the chat feels responsive on slower (Claude ~2-3s) replies. No artificial
  // delay — it only exists for the duration of the real fetch. Context-aware
  // copy by what the user is doing.
  const TYPING_ID = "t-typing";
  function showTyping(label = "Thinking…") {
    setTurns((prev) => [
      ...prev.filter((t) => t.kind !== "typing"),
      { kind: "typing", id: `${TYPING_ID}-${Date.now()}`, label },
    ]);
  }
  function clearTyping() {
    setTurns((prev) => prev.filter((t) => t.kind !== "typing"));
  }
  // Pick context copy from the raw message (cheap heuristic; the response path
  // still does the real classification — this is just the waiting label).
  function typingLabelFor(message: string): string {
    const t = message.toLowerCase();
    if (/\b(reschedul|move|change\s+my|another\s+spot)\b/.test(t)) return "Looking for another spot…";
    if (/\b(book|grab|take|reserve|hold|confirm|yes)\b/.test(t)) return "Holding that time…";
    if (/\b(time|open|availab|slot|when|free|appointment|tomorrow|today|week|am|pm|\d)\b/.test(t)) return "Checking my openings…";
    return "Thinking…";
  }

  function pushTurns(...newTurns: AssistantTurn[]) {
    setTurns((prev) => [...prev, ...newTurns]);
  }

  function markTurn(id: string, patch: Partial<AssistantTurn>) {
    setTurns((prev) =>
      prev.map((t) => (t.id === id ? ({ ...t, ...patch } as AssistantTurn) : t))
    );
  }

  function resetConversation() {
    // Empty turn list on reset — the chat doesn't greet, it waits for the
    // user's first message and responds to that.
    setTurns([]);
    setChipsLocked(false);
    setContext(EMPTY_CONTEXT);
    setStage("home");
    setMode(null);
    setPendingAppointment(null);
    setVerifiedLast4(null);
    setPendingClientInfo(null);
    setBookingResult(null);
    setEntryRecommendation(null);
    setPendingRescheduleSlot(null);
    setRescheduleOrigin(null);
    setConsecutiveLowConfidence(0);
    clearSessionAICount();
    // Drop back to the entry screen so the next visitor starts fresh.
    setAssistantOpen(false);
  }

  function changeService() {
    setContext((prev) => ({
      ...prev,
      selectedService: null,
      selectedSlot: null,
      lastRecommendedService: null,
      lastShownSlots: [],
      lastAnchorDateKey: null,
      lastIntentTags: [],
      lastIntentTimeHints: emptyHints(),
    }));
    setStage("home");
    pushTurn({
      kind: "bot-text",
      id: `t-change-${Date.now()}`,
      text: "Sure — what would you like instead?",
    });
    setChipsLocked(false);
  }

  /* ---------------------- Manage flow (reschedule / cancel) ---- */

  function handleModePick(picked: Exclude<ManageMode, null>) {
    setMode(picked);
    const userLabel =
      picked === "book"
        ? "Book a new appointment"
        : picked === "reschedule"
        ? "Reschedule an appointment"
        : "Cancel an appointment";
    pushTurn({
      kind: "user-text",
      id: `u-mode-${Date.now()}`,
      text: userLabel,
    });
    if (picked === "book") {
      pushTurn({
        kind: "bot-text",
        id: `t-mode-book-${Date.now()}`,
        text: `Great — what are you coming in for?`,
      });
      // Existing PROMPT_CHIPS render below since !chipsLocked && !serviceLocked
      return;
    }
    pushTurn({
      kind: "bot-text",
      id: `t-mode-name-${Date.now()}`,
      text: `No problem — what name is the booking under?`,
    });
  }

  /**
   * Enter manage mode from a typed user message (e.g. "cancel my
   * appointment", "reschedule my booking"). Mirrors handleModePick's
   * effect — switches into the right manage mode and asks for the name
   * on the booking — but does NOT echo a synthetic "Book a new
   * appointment" user-text turn, since the actual message was already
   * pushed by handleTextSubmit.
   *
   * "lookup" is treated as a soft reschedule for now: we don't have a
   * dedicated read-only view yet, so we present the same name lookup
   * with neutral copy and let the user pick reschedule/cancel from the
   * appointment card once it's found.
   */
  function enterManageMode(
    action: "cancel" | "reschedule" | "lookup"
  ) {
    const targetMode: Exclude<ManageMode, null> =
      action === "cancel" ? "cancel" : "reschedule";
    setMode(targetMode);
    const copy =
      action === "cancel"
        ? `No problem — what name is the booking under?`
        : action === "reschedule"
        ? `Sure — what name is the booking under?`
        : `Happy to help look that up — what name is the booking under?`;
    pushTurn({
      kind: "bot-text",
      id: `t-manage-${action}-${Date.now()}`,
      text: copy,
    });
  }

  async function handleNameLookup(name: string) {
    // Search Supabase by name (case-insensitive partial match)
    let realMatches: Appointment[] = [];
    try {
      const res = await fetch(`/api/bookings/lookup?name=${encodeURIComponent(name)}`);
      if (res.ok) {
        const data = await res.json();
        realMatches = data.appointments ?? [];
      }
    } catch {
      // fall through
    }

    // Also check mock store by name
    const mockAll = [...today, ...upcoming];
    const nameLower = name.trim().toLowerCase();
    const mockMatches = mockAll.filter((a) =>
      a.clientName.toLowerCase().includes(nameLower)
    );

    // Merge, dedup by id
    const seen = new Set<string>();
    const matches: Appointment[] = [];
    for (const a of [...realMatches, ...mockMatches]) {
      if (!seen.has(a.id)) { seen.add(a.id); matches.push(a); }
    }

    if (matches.length === 0) {
      pushTurn({
        kind: "bot-text",
        id: `t-notfound-${Date.now()}`,
        text: `I couldn't find a booking under "${name}". Double-check the name or try again?`,
      });
      pushTurn({
        kind: "manage-chips",
        id: `t-notfound-chips-${Date.now()}`,
        chips: [
          { label: "Try a different name", key: "manage-try-again" },
          { label: "Book new instead", key: "manage-book-instead" },
        ],
      });
      return;
    }
    if (matches.length === 1) {
      // Show the appointment and ask for phone-4 confirmation before acting
      const appt = matches[0];
      setPendingAppointment(appt);
      pushTurn({
        kind: "bot-text",
        id: `t-found-one-${Date.now()}`,
        text: `Found it — here's your upcoming appointment:`,
      });
      pushTurn({
        kind: "appointment-list",
        id: `t-appt-${Date.now()}`,
        appointments: [appt],
        consumed: true,
      });
      askForPhone4Confirm(appt);
      return;
    }
    pushTurn({
      kind: "bot-text",
      id: `t-found-many-${Date.now()}`,
      text: `I found ${matches.length} bookings under that name — which one?`,
    });
    pushTurn({
      kind: "appointment-list",
      id: `t-appt-list-${Date.now()}`,
      appointments: matches,
    });
  }

  function askForPhone4Confirm(appt: Appointment) {
    // Real bookings (UUIDs) get server-side phone verification. Mock bookings
    // from the in-memory store still use client-side comparison because they
    // never hit the API. We can detect mock IDs by checking if they look like
    // UUIDs vs the mock store's "appt-N" format.
    const isMockBooking = !/^[0-9a-f]{8}-/.test(appt.id);
    if (isMockBooking && !appt.clientPhone) {
      presentActionForAppointment(appt);
      return;
    }
    setAwaitingPhone4(true);
    pushTurn({
      kind: "bot-text",
      id: `t-phone4-${Date.now()}`,
      text: `Just to confirm — what are the last 4 digits of the phone number on this booking?`,
    });
  }

  async function handlePhone4Input(input: string) {
    const digits = input.replace(/\D/g, "").slice(-4);
    if (!pendingAppointment) return;
    setAwaitingPhone4(false);
    pushTurn({ kind: "user-text", id: `u-phone4-${Date.now()}`, text: input });

    // Real (UUID) booking → ask the server. Mock booking → compare locally.
    const isMockBooking = !/^[0-9a-f]{8}-/.test(pendingAppointment.id);
    let ok = false;
    if (isMockBooking) {
      const expected = pendingAppointment.clientPhone?.slice(-4) ?? "";
      ok = digits === expected;
    } else {
      try {
        const res = await fetch("/api/bookings/verify", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ bookingId: pendingAppointment.id, last4: digits }),
        });
        const data = await res.json();
        ok = Boolean(data?.ok);
      } catch {
        ok = false;
      }
    }

    if (ok) {
      setVerifiedLast4(digits);
      presentActionForAppointment(pendingAppointment);
    } else {
      pushTurn({
        kind: "bot-text",
        id: `t-phone4-err-${Date.now()}`,
        text: `That doesn't match what we have on file. Want to try again or start over?`,
      });
      pushTurn({
        kind: "manage-chips",
        id: `t-phone4-chips-${Date.now()}`,
        chips: [
          { label: "Try again", key: "manage-try-phone4" },
          { label: "Start over", key: "manage-try-again" },
        ],
      });
    }
  }

  function presentActionForAppointment(appt: Appointment) {
    if (mode === "cancel") {
      pushTurn({
        kind: "clarify",
        id: `t-cancel-confirm-${Date.now()}`,
        text: `Cancel your ${appt.serviceName} on ${appt.dayLabel} at ${appt.timeLabel}?`,
        options: [
          { label: "Yes, cancel", key: "manage-cancel-yes" },
          { label: "Keep it", key: "manage-cancel-no" },
        ],
      });
      return;
    }
    if (mode === "reschedule") {
      const service = SERVICES.find((s) => s.id === appt.serviceId);
      if (!service) {
        pushTurn({
          kind: "bot-text",
          id: `t-reschedule-err-${Date.now()}`,
          text: `Hmm — I can't find that service to reschedule. Please contact ${sName()} directly.`,
        });
        return;
      }
      patchContext({ selectedService: service });
      pushTurn({
        kind: "bot-text",
        id: `t-reschedule-prompt-${Date.now()}`,
        text: `What time would you like instead?`,
      });
      const allSlots = cachedRealSlots(service.id, slug);
      const initial = allSlots.slice(0, 6);
      const anchorKey = initial[0]?.dateKey ?? null;
      const weekShift = anchorKey ? deriveWeekShift(anchorKey) : null;
      showSlots(initial, anchorKey, weekShift);
    }
  }

  function handleAppointmentPick(turnId: string, appt: Appointment) {
    setPendingAppointment(appt);
    pushTurn({
      kind: "user-text",
      id: `u-appt-${Date.now()}`,
      text: `${appt.serviceName} — ${appt.dayLabel}, ${appt.timeLabel}`,
    });
    markTurn(turnId, { consumed: true } as Partial<AssistantTurn>);
    // When picking from a multi-result list, confirm with phone-4 before acting
    setPendingAppointment(appt);
    askForPhone4Confirm(appt);
  }

  function handleManageChip(turnId: string, key: ManageChipKey) {
    markTurn(turnId, { consumed: true } as Partial<AssistantTurn>);
    if (key === "manage-try-again") {
      setPendingAppointment(null);
      setAwaitingPhone4(false);
      pushTurn({
        kind: "bot-text",
        id: `t-tryagain-${Date.now()}`,
        text: `No problem — what name is the booking under?`,
      });
      return;
    }
    if (key === "manage-try-phone4") {
      if (pendingAppointment) {
        askForPhone4Confirm(pendingAppointment);
      }
      return;
    }
    if (key === "manage-book-instead" || key === "manage-book-another") {
      // Go directly into book mode — user already said they want to book,
      // don't drop them back at the mode picker and make them tap again.
      setMode("book");
      setPendingAppointment(null);
      setChipsLocked(false);
      patchContext({
        selectedService: null,
        lastRecommendedService: null,
        selectedSlot: null,
        lastShownSlots: [],
        lastAnchorDateKey: null,
        lastIntentTags: [],
        lastIntentTimeHints: emptyHints(),
        pendingClarification: null,
        additionalServices: [],
        bookingNotes: "",
      });
      pushTurns(
        {
          kind: "user-text",
          id: `u-bookmore-${Date.now()}`,
          text: "Book a new appointment",
        },
        {
          kind: "bot-text",
          id: `t-bookmore-${Date.now()}`,
          text: "Great — what are you coming in for?",
        }
      );
    }
  }

  /* ---------------------- Handoff (Send to Shen) ---------------- */

  // POST the handoff to the server. Mark the turn submitted on success so
  // the form collapses into a "Sent to Shen" acknowledgement and the user
  // can't double-submit. Returns true/false so HandoffCard can show an
  // inline error and let the user retry.
  async function handleSubmitHandoff(
    turnId: string,
    data: {
      clientName: string;
      clientPhone: string;
      clientEmail: string;
      summary: string;
      sourceMessage: string;
    }
  ): Promise<boolean> {
    try {
      const res = await fetch("/api/handoff", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...data, slug: slug ?? undefined }),
      });
      if (!res.ok) return false;
      markTurn(turnId, { submitted: true } as Partial<AssistantTurn>);
      return true;
    } catch {
      return false;
    }
  }

  // Open a blank handoff turn — used by the "Need Shen directly?" chat
  // shell affordance. Pre-fills a generic summary from the last user
  // message if available so the user has something to edit instead of an
  // empty box. The user can rewrite freely.
  function handleOpenHandoff() {
    const lastUser = [...turns].reverse().find((t) => t.kind === "user-text");
    const sourceMessage =
      lastUser && lastUser.kind === "user-text" ? lastUser.text : "";
    const summary = sourceMessage
      ? `Client wrote: "${sourceMessage}". They'd like ${sName()} to follow up.`
      : `Client would like ${sName()} to follow up directly.`;
    pushTurn({
      kind: "handoff",
      id: `t-handoff-${Date.now()}`,
      summary,
      sourceMessage,
    });
  }

  /* ---------------------- Prompt chip / text submit ------------ */

  // Resolve AI-recommended service ids to services in the effective catalog.
  // The AI grounds on provider_services (whose ids match effectiveCatalog when
  // synced), so this lines up. Unmatched ids are dropped so a card never
  // carries an unbookable id. Deduped by id.
  function matchEffectiveServices(ids: string[] | undefined): Service[] {
    if (!ids || ids.length === 0) return [];
    const seen = new Set<string>();
    const out: Service[] = [];
    for (const id of ids) {
      if (seen.has(id)) continue;
      const svc = effectiveCatalog.find((s) => s.id === id);
      if (svc && svc.status !== "hidden") {
        seen.add(id);
        out.push(svc);
      }
    }
    return out;
  }

  function buildBrowserGroups(filterCategory?: string) {
    // Render from the effective catalog (synced provider services when
    // available, else mock) so browse/category cards reflect the provider's
    // real Square services. Cards carry svc-* ids that book through the
    // existing flow.
    return Array.from(
      effectiveCatalog.reduce((map, svc) => {
        if (svc.status === "hidden") return map;
        if (filterCategory && svc.category !== filterCategory) return map;
        const arr = map.get(svc.category) ?? [];
        arr.push(svc);
        map.set(svc.category, arr);
        return map;
      }, new Map<string, Service[]>())
    ).map(([category, services]) => ({ category, services }));
  }

  function showServiceBrowser(filterCategory?: string) {
    const groups = buildBrowserGroups(filterCategory);
    const userText = filterCategory ?? "Show me all services";
    const botText = filterCategory
      ? `Here are ${sName()}'s ${filterCategory} services — tap one to book it.`
      : `Here's everything ${sName()} offers — tap any service to book it.`;
    pushTurns(
      { kind: "user-text", id: `u-browse-${Date.now()}`, text: userText },
      { kind: "bot-text", id: `t-browse-intro-${Date.now()}`, text: botText },
      { kind: "service-browser", id: `t-browser-${Date.now()}`, groups }
    );
    setChipsLocked(true);
  }

  function handlePromptChip(preset: string) {
    if (preset === "__browse__") {
      showServiceBrowser();
      return;
    }
    if (preset.startsWith("__cat:")) {
      showServiceBrowser(preset.slice(6));
      return;
    }
    handleTextSubmit(preset);
  }

  async function handleTextSubmit(input: string) {
    const trimmed = input.trim();
    if (!trimmed) return;

    // Manage flow: route typed input through name lookup or phone-4 confirm
    if (mode === "reschedule" || mode === "cancel") {
      if (awaitingPhone4) {
        handlePhone4Input(trimmed);
        return;
      }
      if (!pendingAppointment) {
        pushTurn({ kind: "user-text", id: `u-${Date.now()}`, text: trimmed });
        handleNameLookup(trimmed);
        return;
      }
    }

    pushTurn({ kind: "user-text", id: `u-${Date.now()}`, text: trimmed });
    setChipsLocked(true);

    // Deterministic manage-intent detection — short-circuit before AI for
    // clear cancel / reschedule / lookup phrasing. These shouldn't reach
    // the booking flow at all: the user has an existing appointment and
    // wants to act on it, not book a new one. Mode chips used to handle
    // this; with mode-picker removed, the chat itself routes here.
    //
    // Skipped when there's a pending Switch/Fuzzy/Clarification — in
    // those contexts "cancel" / "nevermind" mean "abandon this dialog",
    // not "cancel my appointment", and the existing handlers below
    // already know how to interpret them.
    const inPendingDialog =
      context.pendingSwitch !== null ||
      context.pendingFuzzy !== null ||
      context.pendingClarification !== null;
    if (!inPendingDialog) {
      // CONTINUITY: capture any day/time the user mentioned BEFORE the
      // unsupported / multi-person guards short-circuit to a handoff. Without
      // this, "balayage next Tuesday at 5pm" loses "next Tuesday at 5pm" the
      // moment it's flagged unsupported, so a follow-up "haircut instead" has
      // nothing to fall back to. We persist the time signal into context so the
      // existing merge logic (handleBookOrSwitch) reuses it on the next turn.
      // Provider-agnostic: operates purely on extracted time hints.
      const earlyHints = extractTimeHints(trimmed);
      if (hintsHaveSignal(earlyHints)) {
        patchContext({ lastIntentTimeHints: earlyHints });
      }

      const detManageAction = detectManageIntent(trimmed);
      if (detManageAction) {
        enterManageMode(detManageAction);
        return;
      }

      // Unsupported-service guard. The deterministic NLU maps "bleach" /
      // "highlights" / "balayage" etc. to the Color category (so the
      // parser recognizes color-adjacent vocabulary), but ${stylist}
      // doesn't actually do those techniques. If we let the deterministic
      // book path win here it would steer the user into Full Color, which
      // is the wrong service. Short-circuit to a handoff turn instead.
      //
      // Skipped during a pending Switch/Fuzzy/Clarification dialog so
      // mid-flow text like "no, just a trim" isn't mistakenly parsed as
      // a fresh booking request.
      const unsupported = detectUnsupportedService(trimmed, unsupportedTerms);
      if (unsupported) {
        const summary = `Client asked about "${unsupported}", which isn't in ${sName()}'s current service list. Most recent message: "${trimmed}".`;
        pushTurn({
          kind: "bot-text",
          id: `t-unsupported-${Date.now()}`,
          text: `That isn't something ${sName()} currently offers — I don't want to point you at the wrong service. Want me to send ${sName()} a quick message so she can let you know directly?`,
        });
        pushTurn({
          kind: "handoff",
          id: `t-unsupported-handoff-${Date.now()}`,
          summary,
          sourceMessage: trimmed,
        });
        return;
      }

      // Multi-person guard. The beta does not book more than one person
      // directly (it needs back-to-back slots or multiple staff/resources
      // we can't yet guarantee). Without this, "Can my mom and I both get
      // haircuts?" would be tagged as a normal Haircut booking by the
      // deterministic parser below and book a single slot. Route to a
      // handoff so ${stylist} can confirm timing for the group.
      if (detectMultiPerson(trimmed)) {
        const summary = `Client wants to book for more than one person. ${sName()} should confirm timing (back-to-back slots or multiple appointments). Most recent message: "${trimmed}".`;
        pushTurn({
          kind: "bot-text",
          id: `t-multi-${Date.now()}`,
          text: `This sounds like a booking for more than one person. I can send ${sName()} a message to confirm timing for everyone.`,
        });
        pushTurn({
          kind: "handoff",
          id: `t-multi-handoff-${Date.now()}`,
          summary,
          sourceMessage: trimmed,
        });
        return;
      }
    }

    // Architecture B routing.
    //
    // 1. Run the deterministic parser first. If it recognized a HARD action
    //    (something the executor handles natively — slot selection, time
    //    refinement, mid-flow clarification answer, confirmations,
    //    explicit price/duration question), dispatch immediately. These
    //    bypass AI by design — they're already structured.
    // 2. If the parser is unsure (unknown, or book with no tags / no
    //    timeHints), call AI to interpret the free-text. Convert the AI
    //    envelope to an Intent and dispatch. If AI converts to nothing
    //    actionable but returns a reply, render the reply and stop.
    // 3. If AI is unavailable or fails entirely, dispatch whatever the
    //    deterministic parser gave us (it's better than silence).
    const detIntent = parseClientMessage(trimmed, context);

    // ── TOP-LEVEL ANSWER-FIRST GUARD ───────────────────────────────────────
    // A QUESTION must be answered, in ANY state, before any other routing —
    // even mid-clarification, even when the message contains service words that
    // make the parser classify it as `book` (e.g. "what's the difference
    // between SHORT and MEDIUM?" parses as a haircut book, which previously
    // bulldozed past the question). This runs FIRST so no downstream
    // interceptor (clarification re-ask, booking, etc.) can swallow a question.
    // It only fires for genuinely question-shaped messages, not commitments.
    if (looksLikeConsultationQuestion(trimmed)) {
      // If we're mid-clarification, inline the pending question so "the two" /
      // "short and medium" is grounded in the actual choice being offered.
      const enriched = context.pendingClarification
        ? `${trimmed}\n(They're choosing between options for: "${context.pendingClarification.question}". Answer that specific comparison using the services list.)`
        : trimmed;
      const ai = await fetchChatResponse(enriched);
      if (ai && ai.reply) {
        renderChatResponse(ai, trimmed);
        // If a clarification was open, re-pose it warmly so the thread keeps
        // moving (we answered — we didn't fail to understand).
        if (context.pendingClarification) reAskClarification({ soft: true });
        return;
      }
      // AI unavailable → fall through to normal routing rather than dead-end.
    }

    // Pending-clarification re-ask: a typed answer to a pending clarification
    // should go through the deterministic path, even if it's low-signal.
    const isLowSignal =
      detIntent.kind === "unknown" ||
      (detIntent.kind === "book" && detIntent.tags.length === 0);
    if (
      context.pendingClarification &&
      detIntent.kind !== "clarification_answer" &&
      isLowSignal
    ) {
      reAskClarification();
      return;
    }

    // Time-first messages — the user said "tomorrow" or "next Tuesday"
    // before naming a service. Without this the time hint is dropped:
    // the deterministic parser returns a book intent with empty tags,
    // routes to AI for service clarification, then the user's follow-up
    // ("haircut") starts a fresh intent with empty hints. Persist any
    // time signal into context now so handleBookOrSwitch can merge it
    // into the next confident booking intent.
    // Persist ANY time signal from a booking message, even when the message
    // ALSO names a service ("haircut tomorrow at 4"). Previously this only
    // fired for tags.length===0, so a combined service+time message dropped the
    // time before the clarification answer could reuse it — the user picked
    // "Short/barber" and got a generic grid instead of "4pm tomorrow". Now the
    // hour survives into lastIntentTimeHints for the reconstruction to read.
    if (
      detIntent.kind === "book" &&
      hintsHaveSignal(detIntent.timeHints)
    ) {
      patchContext({ lastIntentTimeHints: detIntent.timeHints });
    }

    // SEE-ALL → open the full schedule directly. A typed "see all openings /
    // all the available times / show me everything" mid-booking should open the
    // full-screen day picker (same as the "See all openings" chip), NOT another
    // in-thread recommendation. Routing it here also avoids re-applying a prior
    // exact-hour constraint (which made "see all" show "3 PM isn't open…").
    const wantsSeeAll =
      (context.selectedService !== null || context.lastRecommendedService !== null) &&
      (/\ball\b[\s\w]*\b(times?|openings?|slots?|availability|appointments?)\b/i.test(trimmed) ||
        /\b(see|show|view)\b[\s\w]*\beverything\b/i.test(trimmed) ||
        /\bfull\s+availability\b/i.test(trimmed) ||
        /\beverything\s+(available|open)\b/i.test(trimmed));
    if (wantsSeeAll) {
      setStage("time");
      return;
    }

    // Hard deterministic actions — bypass AI entirely.
    const isHardAction =
      detIntent.kind === "select_slot" ||
      detIntent.kind === "refine_time" ||
      detIntent.kind === "clarification_answer" ||
      detIntent.kind === "confirm_switch" ||
      detIntent.kind === "confirm_fuzzy_match" ||
      (detIntent.kind === "info_query" && detIntent.asks.length > 0);
    if (isHardAction) {
      dispatch(detIntent);
      return;
    }

    // Book / add_services / switch_service with strong tags — the parser
    // is confident, no need to bother AI.
    const detIsConfidentBook =
      (detIntent.kind === "book" ||
        detIntent.kind === "switch_service" ||
        detIntent.kind === "add_services") &&
      detIntent.tags.length > 0;
    if (detIsConfidentBook) {
      dispatch(detIntent);
      return;
    }

    // ── MID-BOOKING GUARD ──────────────────────────────────────────────────
    // If we're already mid-booking (a service is in play and we've shown times)
    // and the parser couldn't make sense of this message, DON'T hand a vague
    // message to the AI — it tends to re-classify it as a fresh booking and
    // restart the "short or long?" clarification, erasing the user's progress
    // (the endless loop). Instead, keep them in the flow: if there's any time
    // signal, refine; otherwise gently re-show the current options without
    // starting over. The deterministic parser already handled explicit refines/
    // selections above, so reaching here with a service in play means the
    // message was genuinely ambiguous.
    const midBooking =
      (context.selectedService !== null || context.lastRecommendedService !== null) &&
      context.lastShownSlots.length > 0;
    const detIsVague =
      detIntent.kind === "unknown" ||
      (detIntent.kind === "book" && detIntent.tags.length === 0);
    if (midBooking && detIsVague) {
      const svc = context.selectedService ?? context.lastRecommendedService!;
      const allSlots = cachedRealSlots(svc.id, slug);
      // If the vague message carried a time hint, refine to it; else just
      // re-surface the current openings so the thread doesn't dead-end/restart.
      const vagueHints =
        detIntent.kind === "book" && hintsHaveSignal(detIntent.timeHints)
          ? detIntent.timeHints
          : context.lastIntentTimeHints;
      const ranked = rankTimeSlots(allSlots, vagueHints);
      pushTurn({
        kind: "bot-text",
        id: `t-stay-${Date.now()}`,
        text: `Still on your ${svc.name} 💛 Here are the times — tap one, or tell me a day or time that works.`,
      });
      showSlots(ranked, ranked[0]?.dateKey ?? null);
      return;
    }

    // Low-signal — call AI to interpret.
    const aiResponse = await fetchChatResponse(trimmed);
    if (aiResponse) {
      // AI inferred the user wants to manage an existing appointment.
      // Route directly into the manage flow — same exit as the
      // deterministic detector above, just with the AI as the fallback
      // when the user phrased it less obviously.
      if (aiResponse.manageAction) {
        enterManageMode(aiResponse.manageAction);
        return;
      }

      // Group bookings / explicit handoff → render the AI reply + handoff
      // form. renderChatResponse already does this.
      const isHandoffPath =
        aiResponse.intent === "handoff" ||
        aiResponse.intent === "unsupported" ||
        aiResponse.needsHumanHandoff ||
        (aiResponse.peopleCount ?? 1) > 1;
      if (isHandoffPath) {
        renderChatResponse(aiResponse, trimmed);
        return;
      }

      // Category / multi-match GUIDANCE → tappable cards. When the AI is
      // browsing (service_guidance) and points at 2+ services, show the
      // matching services as a tappable service-browser turn (sourced from
      // the effective catalog) so the client can tap → book directly,
      // instead of a text-only "which one?" they'd have to retype.
      if (aiResponse.intent === "service_guidance") {
        const matched = matchEffectiveServices(
          aiResponse.recommendedServiceIds
        );
        if (matched.length > 1) {
          const reply = aiResponse.reply.trim();
          if (reply) {
            pushTurn({
              kind: "bot-text",
              id: `t-ai-${Date.now()}`,
              text: reply,
              source: aiResponse.source,
            });
          }
          // Group the matched services by category for the browser turn.
          const groups = Array.from(
            matched.reduce((map, svc) => {
              const arr = map.get(svc.category) ?? [];
              arr.push(svc);
              map.set(svc.category, arr);
              return map;
            }, new Map<string, Service[]>())
          ).map(([category, services]) => ({ category, services }));
          pushTurn({
            kind: "service-browser",
            id: `t-cat-browser-${Date.now()}`,
            groups,
          });
          setChipsLocked(true);
          return;
        }
      }

      // ANSWER-FIRST GUARD (deterministic safety net): if the message is
      // clearly a QUESTION ("what's the difference", "which should I", "can you
      // do…", "would you recommend", "how long does X last"), never let it
      // collapse into a booking — even if the free model misclassified it as
      // `booking`. We render the AI's answer (reply) instead. This makes the
      // answer-first behavior robust to model mislabeling: we fail toward
      // ANSWERING, never toward bulldozing into book.
      const effectiveIntent =
        looksLikeConsultationQuestion(trimmed) &&
        (aiResponse.intent === "booking" || aiResponse.intent === "service_guidance")
          ? "consultation"
          : aiResponse.intent;

      const converted = aiEnvelopeToIntent(
        {
          intent: effectiveIntent,
          recommendedServiceIds: aiResponse.recommendedServiceIds,
          timePreference: aiResponse.timePreference ?? null,
          peopleCount: aiResponse.peopleCount ?? 1,
          multiServiceRequest: aiResponse.multiServiceRequest ?? false,
          questionType: aiResponse.questionType ?? null,
        },
        trimmed
      );

      if (converted) {
        // CONTINUITY (AI path): if the user's CURRENT message carries no time
        // signal, don't let the AI's timePreference (which can hallucinate a
        // time, or echo a stale one) override what they actually said earlier.
        // Strip it so handleBookOrSwitch's merge restores the real stored
        // hints (context.lastIntentTimeHints) — e.g. "balayage next Tuesday 5"
        // → "haircut instead" keeps Tuesday 5pm even via the AI route. When the
        // message DOES state a time, we trust the conversion as-is.
        let toDispatch = converted;
        if (
          (converted.kind === "book" || converted.kind === "switch_service") &&
          !hintsHaveSignal(extractTimeHints(trimmed)) &&
          hintsHaveSignal(context.lastIntentTimeHints)
        ) {
          toDispatch = { ...converted, timeHints: context.lastIntentTimeHints };
        }
        // The deterministic executor takes it from here. We deliberately do
        // NOT also render the AI reply — the executor will emit its own
        // grounded ack ("Got it, here are some openings for next week...").
        // Otherwise the user sees two bot turns in a row.
        dispatch(toDispatch);
        return;
      }

      // AI returned a reply (FAQ, soft guidance, or low-confidence
      // clarification) but nothing the executor can act on. Render the
      // reply as a bot text turn and stop.
      renderChatResponse(aiResponse, trimmed);
      return;
    }

    // AI failed entirely — fall back to the deterministic parser's best
    // guess (Q7: try deterministic safety net before showing fallback).
    dispatch(detIntent);
  }

  /**
   * Re-ask the most recent clarification with simpler wording. Used when the
   * user's free-text answer didn't match any expected key.
   */
  function reAskClarification(opts?: { soft?: boolean }) {
    // After we've just ANSWERED a question (soft), re-pose the choice warmly —
    // NOT "Sorry, I didn't catch that" (the user asked a valid question; we
    // heard them fine). Otherwise use the standard didn't-catch reprompt.
    const lead = opts?.soft ? "So — " : "Sorry, I didn't catch that. ";
    const recent = [...turns].reverse().find(
      (t) => t.kind === "clarify" && !t.consumed
    );
    if (!recent || recent.kind !== "clarify") {
      pushTurn({
        kind: "bot-text",
        id: `t-reprompt-${Date.now()}`,
        text: opts?.soft
          ? `Which would you like — tap one of the options above?`
          : `Sorry, I didn't catch that. Could you tap one of the options above, or rephrase?`,
      });
      return;
    }
    pushTurn({
      kind: "bot-text",
      id: `t-reask-${Date.now()}`,
      text: `${lead}${simplifyClarification(recent.text)}`,
    });
  }

  /**
   * Strip the question down to its simpler core — used when the user
   * misunderstood the original phrasing. "Is your hair short / barber
   * length, or medium-to-long?" → "Short hair or medium-to-long?"
   */
  function simplifyClarification(originalText: string): string {
    if (/short.+(medium|long)/.test(originalText)) {
      return "Short hair, or medium-to-long?";
    }
    if (/root.+(full|color)/.test(originalText.toLowerCase())) {
      return "Root touch-up, or full color?";
    }
    if (/perm/.test(originalText.toLowerCase())) {
      return "Short hair, medium-to-long, or down perm?";
    }
    return originalText;
  }

  /* ---------------------- Central dispatch -------------------- */

  function dispatch(intent: Intent, clarificationKey?: string) {
    switch (intent.kind) {
      case "book":
      case "switch_service":
        return handleBookOrSwitch(intent, clarificationKey);
      case "add_services":
        return handleAddServices(intent);
      case "confirm_switch":
        return handleConfirmSwitch(intent);
      case "clarification_answer":
        return handleClarificationAnswer(intent);
      case "confirm_fuzzy_match":
        return handleConfirmFuzzyMatch(intent);
      case "refine_time":
        return handleRefineTime(intent);
      case "select_slot":
        return handleSelectSlot(intent);
      case "info_query":
        return handleInfoQuery(intent);
      case "unknown":
        return handleUnknown(intent);
    }
  }

  /**
   * User answered a pending clarification with free text (e.g. typed "short"
   * instead of tapping the button). The parser already mapped it to a key;
   * we mark the clarify turn consumed and reconstruct the book intent the
   * way handleClarifyTap would.
   */
  function handleClarificationAnswer(
    intent: Extract<Intent, { kind: "clarification_answer" }>
  ) {
    // Find the most recent unconsumed clarify turn and route through
    // handleClarifyTap so button taps and typed answers share a code path.
    const recent = [...turns].reverse().find(
      (t) => t.kind === "clarify" && !t.consumed
    );
    if (recent && recent.kind === "clarify") {
      // Find the matching option label (or synthesize one if not found)
      const matched = recent.options.find((o) => o.key === intent.key);
      const opt = matched ?? { label: intent.rawText, key: intent.key };
      handleClarifyTap(recent.id, opt);
      return;
    }
    // No active clarify turn — synthesize one so the handler still has
    // something to consume. Should be rare; fallback for safety.
    const opt = { label: intent.rawText, key: intent.key };
    handleClarifyTap(`synth-${Date.now()}`, opt);
  }

  /**
   * Fuzzy-match soft confirmation. User typed "balayge" → bot says
   * "Got it — that sounds like a color service. Is that right?" with
   * Yes / No buttons.
   */
  function handleConfirmFuzzyMatch(
    intent: Extract<Intent, { kind: "confirm_fuzzy_match" }>
  ) {
    const categoryName = intent.proposedTag.toLowerCase();
    pushTurn({
      kind: "clarify",
      id: `t-fuzzy-${Date.now()}`,
      text: `Got it — that sounds like a ${categoryName} service. Is that right?`,
      options: [
        { label: `Yes, ${categoryName}`, key: "fuzzy-yes" },
        { label: "No, something else", key: "fuzzy-no" },
      ],
    });
    // Carry the most recent free-text time hints through so the eventual
    // "yes, color service" answer still respects "next Tuesday".
    patchContext({
      pendingFuzzy: {
        tag: intent.proposedTag,
        timeHints: context.lastIntentTimeHints,
      },
    });
  }

  /**
   * Ambiguous service mention. Renders a three-button prompt:
   *   Switch — replace current service
   *   Add    — add to current service (most beauty requests are add-ons)
   *   Keep   — discard the mention, friendly preserve
   */
  function handleConfirmSwitch(
    intent: Extract<Intent, { kind: "confirm_switch" }>
  ) {
    const current =
      context.selectedService ?? context.lastRecommendedService;
    if (!current) return;

    const newCategoryName =
      intent.proposedTags.find(
        (t) => t !== "Consultation" && t !== current.category
      ) ?? intent.proposedTags[0];

    pushTurn({
      kind: "clarify",
      id: `t-confirmswitch-${Date.now()}`,
      text: `Do you want to switch to ${newCategoryName}, add it to this appointment, or keep ${current.name}?`,
      options: [
        { label: `Switch to ${newCategoryName}`, key: `confirm-switch-yes` },
        { label: `Add ${newCategoryName}`, key: `confirm-switch-add` },
        { label: `Keep ${current.name}`, key: `confirm-switch-no` },
      ],
    });

    patchContext({ pendingSwitch: {
      tags: intent.proposedTags,
      lengthHint: intent.proposedLengthHint,
      permStyle: intent.proposedPermStyle,
      colorDirection: intent.proposedColorDirection,
      timeHints: context.lastIntentTimeHints,
    } });
  }

  /**
   * Multi-service / add-service handler. Either mode runs the same recommendation
   * pipeline; the difference is whether we merge into existing context (additive)
   * or set fresh state.
   *
   * The flow:
   *   1. Decide what the recommendation pipeline should see — for additive mode,
   *      we synthesize a request that includes BOTH the current service's
   *      category AND the new tags so getRecommendedServices treats it as a
   *      multi-service request and picks the right primary.
   *   2. Run getClarifyingQuestion. If the new service needs a clarification
   *      (e.g. color → root vs full), ask once, remember tags.
   *   3. Otherwise, run getRecommendedServices and render a multi-service
   *      recommendation.
   */
  function handleAddServices(
    intent: Extract<Intent, { kind: "add_services" }>
  ) {
    const current =
      context.selectedService ?? context.lastRecommendedService;

    // For additive mode, merge the current service's category into the tag set
    // so the recommender sees the full multi-service request.
    let mergedTags = [...intent.tags];
    if (intent.mode === "additive" && current) {
      const currentTag = current.category as IntentTag;
      if (!mergedTags.includes(currentTag)) {
        mergedTags = [currentTag, ...mergedTags];
      }
    }

    // The crux of Bug 2: when the current service is already fully resolved
    // (e.g. Full Color), we must pre-populate its attributes on the synth
    // intent so getClarifyingQuestion doesn't re-ask the color question.
    // The clarification logic should only see the GENUINELY new tag as
    // unresolved.
    let synthLengthHint = intent.lengthHint;
    let synthColorDirection = intent.colorDirection;
    let synthPermStyle = intent.permStyle;

    if (intent.mode === "additive" && current) {
      // Map current service id → resolved attributes
      const currentResolved = inferAttributesFromService(current);
      if (current.category === "Color" && synthColorDirection === null) {
        synthColorDirection = currentResolved.colorDirection;
      }
      if (current.category === "Haircut" && synthLengthHint === null) {
        synthLengthHint = currentResolved.lengthHint;
      }
      if (current.category === "Perm" && synthPermStyle === null) {
        synthPermStyle = currentResolved.permStyle;
      }
    }

    // Treat as a book intent for downstream — same shape, multi tags
    const synthBook: Extract<Intent, { kind: "book" }> = {
      kind: "book",
      rawText: intent.rawText,
      tags: mergedTags,
      lengthHint: synthLengthHint,
      permStyle: synthPermStyle,
      colorDirection: synthColorDirection,
      timeHints: intent.timeHints,
      confidence: "high",
      comboServiceId: intent.comboServiceId,
    };

    // Acknowledge the add explicitly so the user knows it's not being switched
    if (intent.mode === "additive" && current) {
      const newCategory = intent.tags.find(
        (t) => t !== "Consultation" && t !== current.category
      );
      pushTurn({
        kind: "bot-text",
        id: `t-add-ack-${Date.now()}`,
        text: newCategory
          ? `Got it — adding ${newCategory.toLowerCase()} to the appointment.`
          : `Got it — let me update the appointment.`,
      });
    }

    handleBookOrSwitch(synthBook);
  }

  /**
   * Reverse-engineer the resolved attributes for a Service. Used when the
   * current service is already locked in and we need its lengthHint /
   * colorDirection / permStyle to pass through additive-mode synthesis.
   */
  function inferAttributesFromService(svc: Service): {
    lengthHint: LengthHint;
    colorDirection: ColorDirection;
    permStyle: PermStyle;
  } {
    let lengthHint: LengthHint = null;
    let colorDirection: ColorDirection = null;
    let permStyle: PermStyle = null;

    if (svc.id === "svc-short-cut") lengthHint = "short";
    if (svc.id === "svc-medium-long-cut") lengthHint = "long";
    if (svc.id === "svc-mens-perm-cut") {
      lengthHint = "short";
      permStyle = null;
    }
    if (svc.id === "svc-cut-down-perm") {
      lengthHint = "long";
      permStyle = "down";
    }

    if (svc.id === "svc-full-color") colorDirection = "lighter";
    if (svc.id === "svc-root-touchup") colorDirection = "root";

    if (svc.id === "svc-womens-digital-perm") permStyle = "digital";
    if (svc.id === "svc-straightening-perm") permStyle = "straightening";

    return { lengthHint, colorDirection, permStyle };
  }

  /**
   * If the intent is a BARE single-category browse with no specifying detail
   * and the category has more than one bookable service, return the services
   * to show + a digestible question. Otherwise null (fall through to the
   * normal single-service recommendation). Category-agnostic — works for
   * perm/treatment/color/haircut alike.
   */
  function maybeCategoryBrowseChooser(
    intent: Extract<Intent, { kind: "book" | "switch_service" }>,
    hasClarifier: boolean
  ): { question: string; services: Service[] } | null {
    const options = categoryBrowseOptions(
      {
        tags: intent.tags,
        comboServiceId: intent.comboServiceId,
        lengthHint: intent.lengthHint,
        permStyle: intent.permStyle,
        colorDirection: intent.colorDirection,
        hasClarifier,
      },
      SERVICES
    );
    if (!options) return null;

    const category = options[0].category;
    const noun = String(category).toLowerCase();
    const question =
      category === "Perm"
        ? `${sName()} offers a few different perms. Here are the options 👇\n\nWant me to walk you through the differences, or do you already know which one you're after?`
        : `${sName()} offers a few ${noun} options. Here they are 👇\n\nTell me a bit about what you're going for, or tap one to see times. Happy to explain the differences too.`;

    return { question, services: options };
  }

  async function handleBookOrSwitch(
    intent: Extract<Intent, { kind: "book" | "switch_service" }>,
    clarificationKey?: string
  ) {
    if (intent.kind === "book" && intent.confidence === "low") {
      // Context-aware fallback — never "Hmm, I'm not totally sure"
      handleUnknown({ kind: "unknown", rawText: intent.rawText });
      return;
    }

    // ── BARE CATEGORY BROWSE — don't assume a single service ────────────────
    // When the user names just ONE category with no specifying detail ("perm",
    // "treatment", "color") and that category has SEVERAL distinct services,
    // we must NOT silently pre-pick a "closest match". Show them what's in the
    // category as a tappable list and ask what they're after — they can then
    // pick one, or ask a follow-up ("what's the difference between those?").
    // Like every other service, options first, questions encouraged.
    //
    // A dedicated clarifying question (e.g. haircut length, color direction)
    // is a BETTER experience than a raw list, so it wins — the browse-chooser
    // only fires for categories with no clarifier (perm, treatment).
    const hasClarifier =
      !clarificationKey && getClarifyingQuestion(intent, context) !== null;
    const browseChooser = maybeCategoryBrowseChooser(intent, hasClarifier);
    if (browseChooser) {
      pushTurns(
        {
          kind: "bot-text",
          id: `t-cat-q-${Date.now()}`,
          text: browseChooser.question,
        },
        {
          kind: "alternates",
          id: `t-cat-opts-${Date.now()}`,
          services: browseChooser.services,
          recommendedId: null,
        }
      );
      return;
    }

    // If the incoming intent has no time hints but the user already told
    // us about a time in a prior turn (e.g. they said "tomorrow" before
    // picking a service), merge those stored hints in. Without this,
    // "tomorrow" + "haircut" loses the "tomorrow."
    if (
      !hintsHaveSignal(intent.timeHints) &&
      hintsHaveSignal(context.lastIntentTimeHints)
    ) {
      intent = { ...intent, timeHints: context.lastIntentTimeHints };
    }

    // Switching service mid-conversation — clear slot/booking state but keep chat
    if (intent.kind === "switch_service") {
      patchContext({
        selectedService: null,
        selectedSlot: null,
        lastShownSlots: [],
        lastAnchorDateKey: null,
      });
    }

    const question = clarificationKey
      ? null
      : getClarifyingQuestion(intent, context);

    if (question) {
      // Some parser-side clarify texts already include a "Got it — …" preamble
      // baked into the question (notably the perm+haircut combo). Skip the
      // page-level preamble turn in that case so the user doesn't see two
      // near-identical "Got it" messages in a row.
      const questionHasOwnPreamble = /^got it/i.test(question.text);
      if (questionHasOwnPreamble) {
        pushTurn({
          kind: "clarify",
          id: `t-clarify-${Date.now()}`,
          text: question.text,
          options: question.options,
        });
      } else {
        pushTurns(
          {
            kind: "bot-text",
            id: `t-q-${Date.now()}`,
            text: clarificationPreamble(intent),
          },
          {
            kind: "clarify",
            id: `t-clarify-${Date.now()}`,
            text: question.text,
            options: question.options,
          }
        );
      }
      patchContext({
        lastIntentTags: intent.tags,
        lastIntentColorDirection: intent.colorDirection,
        // CRITICAL: Persist time hints so the eventual clarification answer
        // ("short", "root touch-up", "men's perm") can rebuild a `book`
        // intent that still respects the original "next Tuesday" / "Saturday
        // afternoon" / "soonest" the user typed. Without this the
        // reconstructed intent uses emptyHints() and slot display falls
        // back to today's openings.
        lastIntentTimeHints: intent.timeHints,
        pendingClarification: {
          question: question.text,
          expectedKeys: question.options.map((o) => o.key),
        },
      });
      return;
    }

    let rec = getRecommendedServices(intent, clarificationKey);

    // Preserve additional services from the previous recommendation when the
    // user refines/switches the primary service but never explicitly dropped
    // the add-ons (e.g. "actually make it root touch-up" after "roots + haircut"
    // — the haircut intent is still there, user just clarified the color type).
    if (rec.additionalServices.length === 0 && !rec.unresolvedAdditionalCategory) {
      const prevRecTurn = [...turns].reverse().find((t) => t.kind === "recommendation");
      const prevAdditionals =
        prevRecTurn && prevRecTurn.kind === "recommendation"
          ? prevRecTurn.rec.additionalServices
          : [];
      const hasExplicitDrop =
        /\b(just|only|alone|no\s+(haircut|cut|color|perm|treatment)|without\s+(a\s+|the\s+)?(haircut|cut|color|perm|treatment)|forget\s+(the\s+)?(haircut|cut|color|perm|treatment))\b/i.test(
          intent.rawText
        );
      if (!hasExplicitDrop && prevAdditionals.length > 0) {
        // Only carry services that aren't the same category as the new primary
        const compatible = prevAdditionals.filter(
          (s) => s.category !== rec.primary.category
        );
        if (compatible.length > 0) {
          rec = { ...rec, additionalServices: compatible };
        }
      }
    }

    const response = getAssistantResponse(intent, rec, context);

    patchContext({
      lastRecommendedService: rec.primary,
      lastIntentTags: intent.tags,
      lastIntentTimeHints: intent.timeHints,
      pendingClarification: null,
    });

    if (rec.primary.status === "consultation") {
      // Consultation-tier recommendations don't get booked through Kasa —
      // they need a direct conversation with the stylist. Route the user
      // to the Instagram DM handoff instead of a consultation booking
      // flow so we never imply Kasa can schedule a consult time.
      pushTurns(
        {
          kind: "bot-text",
          id: `t-cons-text-${Date.now()}`,
          text: `This one's best handled directly — message ${sName()} so they can plan it with you.`,
        },
        {
          kind: "custom-cta",
          id: `t-cons-${Date.now()}`,
        }
      );
      return;
    }

    // When a secondary service is unresolved (e.g. Haircut length unknown),
    // ask the clarification BEFORE showing the recommendation card — the user
    // shouldn't see "Book this" with the wrong default haircut on it.
    // The pendingAdditionalService handler will show the recommendation (with
    // the correct resolved service) once the user answers.
    if (rec.unresolvedAdditionalCategory === "Haircut") {
      patchContext({
        lastRecommendedService: rec.primary,
        additionalServices: [], // don't commit the defaulted haircut yet
        pendingAdditionalService: {
          category: "Haircut",
          lengthHint: null,
          colorDirection: null,
          permStyle: null,
        },
      });
      pushTurns(
        {
          kind: "bot-text",
          id: `t-addclarify-pre-${Date.now()}`,
          text: `Got it — ${rec.primary.name} plus a haircut. One quick detail:`,
        },
        {
          kind: "clarify",
          id: `t-add-clarify-${Date.now()}`,
          text: "Short / barber length, or medium-to-long?",
          options: [
            { label: "Short / barber", key: "len-short" },
            { label: "Medium or long", key: "len-long" },
          ],
        }
      );
      return;
    }

    // No unresolved secondary — show the recommendation card now.
    const recAckText =
      rec.additionalServices.length > 0
        ? `Perfect — I have ${rec.primary.name} plus ${rec.additionalServices
            .map((s) => s.name)
            .join(" plus ")}.`
        : `${response.ack} ${response.interpretation}`.trim();

    pushTurn({
      kind: "recommendation",
      id: `t-rec-${Date.now()}`,
      rec,
      ackText: recAckText,
    });

    if (rec.honestNote) {
      pushTurn({
        kind: "bot-text",
        id: `t-note-${Date.now()}`,
        text: rec.honestNote,
      });
    }

    // Skip-the-tap optimization: when the user gave us a specific time scope
    // (a day or hour or week) AND we're highly confident on the service,
    // auto-commit and show ranked times. They can still tap "Show other
    // options" on the recommendation bubble if they want to switch.
    //
    // CRITICAL: weekShift counts as a specific time. "I want a haircut next
    // week" needs to surface next-week slots, not today's. Previously this
    // check missed weekShift so the user got today's openings — bug fixed
    // alongside the AI-first refactor.
    const hasSpecificTime =
      intent.kind === "book" &&
      intent.confidence === "high" &&
      (intent.timeHints.hour24 !== null ||
        intent.timeHints.dateKey !== null ||
        intent.timeHints.dayOfMonth !== null ||
        intent.timeHints.days.length > 0 ||
        intent.timeHints.period !== null ||
        intent.timeHints.weekShift !== null ||
        intent.timeHints.prefersSoonest);

    if (hasSpecificTime && intent.kind === "book") {
      patchContext({ selectedService: rec.primary });
      // Await real slots here — this is often the FIRST slot display for the
      // service (e.g. "haircut next Tuesday"), so the cache may be cold. Using
      // the sync accessor would return [] before priming runs. getRealSlots
      // fetches + caches; no mock for slug providers.
      const allSlots = await getRealSlots(rec.primary.id, slug);

      // Detect exact-hour mismatch — user asked "at 5pm" but we don't have it.
      // We check on the *day they specified* if any. The fuzzy/around case
      // does not produce mismatch copy because flexibility is implicit.
      const askedExactHour =
        intent.timeHints.hour24 !== null &&
        intent.timeHints.timeFlexibility === "exact"
          ? intent.timeHints.hour24
          : null;

      // Constrain candidate pool to the day(s) and/or week the user
      // mentioned. Filters compose: "next Saturday" = days=["Sat"] AND
      // weekShift=1. "Weekend" = days=["Sat","Sun"]. "Next week" = just
      // weekShift=1, no day filter.
      let candidatePool = allSlots;

      // First, narrow by week if specified. Slots within
      // [today + 7*weekShift, today + 7*weekShift + 7) qualify.
      if (intent.timeHints.weekShift !== null) {
        const now = new Date();
        const todayMs = new Date(
          `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}T12:00:00`
        ).getTime();
        const dayMs = 24 * 60 * 60 * 1000;
        const weekStart = todayMs + intent.timeHints.weekShift * 7 * dayMs;
        const weekEnd = weekStart + 7 * dayMs;
        candidatePool = candidatePool.filter((s) => {
          const t = new Date(`${s.dateKey}T12:00:00`).getTime();
          return t >= weekStart && t < weekEnd;
        });
      }

      // Then narrow by specific day/date references.
      // PRECEDENCE: an explicit weekday ("Tuesday") wins over a bare
      // day-of-month. A stated weekday is unambiguous; day-of-month is the
      // weaker signal (and historically the source of the "at 5" → "the 5th"
      // confusion). Only fall to day-of-month when NO weekday was named.
      if (intent.timeHints.dateKey) {
        candidatePool = candidatePool.filter(
          (s) => s.dateKey === intent.timeHints.dateKey
        );
      } else if (intent.timeHints.days.length > 0) {
        // Day-of-week. If we ALSO had a weekShift, candidatePool is already
        // scoped to that week so we just filter by day label. If no week was
        // specified, prefer the nearest matching day so "next Tuesday"
        // doesn't surface later Tuesdays too.
        if (intent.timeHints.weekShift !== null) {
          candidatePool = candidatePool.filter((s) =>
            intent.timeHints.days.includes(s.dayLabel)
          );
        } else {
          const nearestKey = candidatePool
            .filter((s) => intent.timeHints.days.includes(s.dayLabel))
            .map((s) => s.dateKey)
            .sort()[0];
          if (nearestKey) {
            // "Weekend" (Sat+Sun) without a weekShift — keep BOTH days of
            // the nearest weekend rather than just Saturday.
            const nearestSlot = candidatePool.find((s) => s.dateKey === nearestKey);
            if (nearestSlot && intent.timeHints.days.length > 1) {
              candidatePool = candidatePool.filter((s) =>
                intent.timeHints.days.includes(s.dayLabel)
              );
            } else {
              candidatePool = candidatePool.filter((s) => s.dateKey === nearestKey);
            }
          }
        }
      } else if (intent.timeHints.dayOfMonth !== null) {
        // No weekday named, but a genuine day-of-month ("the 12th") — filter to it.
        candidatePool = candidatePool.filter(
          (s) => s.dayOfMonth === intent.timeHints.dayOfMonth
        );
      }

      // Rank the constrained pool by hour-proximity etc.
      const ranked = rankTimeSlots(candidatePool, intent.timeHints);

      const hourMissing =
        askedExactHour !== null &&
        candidatePool.every((s) => Math.abs(s.hour24 - askedExactHour) > 0.25);

      const scoped = ranked.slice(0, 4);

      // Two beats per the brief:
      //   1. Acknowledge what the user asked ("Got it — looking for next
      //      Tuesday around 3:30.")
      //   2. State availability with explanation if there's a mismatch
      //      ("I don't see 3:30 that day, but here are the closest
      //      available times:")
      const ackBeat = buildIntentAck(intent.timeHints, rec.primary.name);
      const availabilityBeat = hourMissing
        ? buildExactMismatchCopy(intent.timeHints, rec.primary.name)
        : `Here are the closest openings.`;

      // Skip the second beat when both messages would say similar things —
      // e.g. when there's no specific hour requested, the ack already
      // implies "here's what's available."
      const showAvailabilityBeat =
        hourMissing || intent.timeHints.hour24 !== null;

      pushTurn({
        kind: "bot-text",
        id: `t-ack-${Date.now()}`,
        text: ackBeat,
      });
      if (showAvailabilityBeat) {
        pushTurn({
          kind: "bot-text",
          id: `t-avail-${Date.now()}`,
          text: availabilityBeat,
        });
      }

      const weekShift = scoped[0]
        ? deriveWeekShift(scoped[0].dateKey)
        : null;
      showSlots(scoped, scoped[0]?.dateKey ?? null, weekShift, false, allSlots);
    }
  }

  /**
   * Beat 1 of the cold-start-with-time response: a short acknowledgement
   * that mirrors what the user asked. Pure echo, no availability claim.
   *
   *   "next Tuesday at 3:30" → "Got it — looking for next Tuesday at 3:30."
   *   "tomorrow afternoon"   → "Got it — looking for tomorrow afternoon."
   *   "haircut"              → "Got it — looking for {service}."
   */
  function buildIntentAck(hints: TimeHints, serviceName: string): string {
    const parts: string[] = [];
    if (hints.relative === "today") parts.push("today");
    else if (hints.relative === "tomorrow") parts.push("tomorrow");
    if (hints.days.length > 0) parts.push(hints.days[0]);
    // Only mention a day-of-month when NO weekday was named — matches the
    // filter precedence (weekday wins). Prevents "Tue the 5th" contradictions.
    else if (hints.dayOfMonth !== null) parts.push(`the ${hints.dayOfMonth}th`);
    if (hints.period === "morning") parts.push("morning");
    if (hints.period === "afternoon") parts.push("afternoon");
    if (hints.period === "evening") parts.push("evening");
    if (hints.hour24 !== null) {
      const hourLabel = formatHour(hints.hour24);
      parts.push(
        hints.timeFlexibility === "exact"
          ? `at ${hourLabel}`
          : `around ${hourLabel}`
      );
    }
    if (parts.length === 0) {
      return `Got it — looking for ${serviceName}.`;
    }
    return `Got it — looking for ${parts.join(" ")}.`;
  }

  function buildExactMismatchCopy(
    hints: TimeHints,
    serviceName: string
  ): string {
    const hourLabel = hints.hour24 !== null ? formatHour(hints.hour24) : null;
    let dayPhrase = "";
    if (hints.relative === "today") dayPhrase = " today";
    else if (hints.relative === "tomorrow") dayPhrase = " tomorrow";
    else if (hints.dayOfMonth !== null)
      dayPhrase = ` on the ${hints.dayOfMonth}th`;
    else if (hints.days.length > 0) dayPhrase = ` on ${hints.days[0]}`;
    return `I don't see a ${hourLabel} opening${dayPhrase}, but here are the closest available times for ${serviceName}.`;
  }

  function handleRefineTime(
    intent: Extract<Intent, { kind: "refine_time" }>
  ) {
    const svc = context.selectedService ?? context.lastRecommendedService;
    if (!svc) {
      pushTurn({
        kind: "bot-text",
        id: `t-needsvc-${Date.now()}`,
        text: "Tell me a little more — are you looking for a haircut, color, perm, treatment, or consultation?",
      });
      setChipsLocked(false);
      return;
    }

    const allSlots = cachedRealSlots(svc.id, slug);
    const result = filterSlotsByRefinement(allSlots, intent, context);

    // Past-horizon: user asked beyond what we have data for
    if (result.outcome === "past-horizon") {
      pushTurn({
        kind: "bot-text",
        id: `t-horizon-${Date.now()}`,
        text: `${sName()}'s calendar isn't open that far yet. The latest she has is ${MOCK_AVAILABILITY_HORIZON.dateLabel}. Want me to show what's open before then?`,
      });
      // Surface the latest week of slots as a helpful next step
      const horizonResult = getSlotsForWeekShift(allSlots, 2);
      if (horizonResult.slots.length > 0) {
        showSlots(horizonResult.slots.slice(0, 6), null, 2);
      }
      return;
    }

    // Build the acknowledgement copy. The structure is:
    //   1. (optional) explanation of mismatch — "I don't see 3pm exactly..."
    //   2. statement of what's being shown — "here are the closest" / "here's what's open on..."
    const ack = buildRefinementAck(intent, result, svc.name);

    pushTurn({
      kind: "bot-text",
      id: `t-refine-${Date.now()}`,
      text: ack,
    });
    // Derive the week shift the slots fall in so chip availability is correct.
    // For week-scoped requests we know it from the intent; for day-scoped we
    // infer from the anchor date.
    const weekShift =
      intent.timeHints.weekShift ??
      (result.anchorDateKey
        ? deriveWeekShift(result.anchorDateKey)
        : result.slots[0]
        ? deriveWeekShift(result.slots[0].dateKey)
        : null);

    // When we fell through to a different day, keep the result tighter — the
    // brief: "show only the next closest day (or 2 max), not a full grid."
    // 4 slots = enough for top-of-day + a couple alternates without becoming
    // a wall of times.
    const sliceCap =
      result.fallbackTier === "next-day" ||
      result.fallbackTier === "this-week" ||
      result.fallbackTier === "next-week"
        ? 4
        : 6;
    // suppressIntro: handleRefineTime already pushed its own ack ("Here are
    // more openings…"), so don't also emit the recommendation intro — that's
    // what caused two stacked near-identical messages.
    showSlots(result.slots.slice(0, sliceCap), result.anchorDateKey, weekShift, true);
  }

  /**
   * Build the ack message that precedes a slot grid after a refinement turn.
   *
   * Pattern (per the brief): always anchor to what the user asked, then say
   * what we found or why we couldn't.
   *
   *   1. Lead with the scope: "Looking at Mon May 18 —" / "Looking at the
   *      week of May 18 —"
   *   2. State the result: "here are the openings I found" OR "I don't see
   *      openings on that day"
   *   3. If fallback: explain WHY we're showing different slots, never
   *      silently broaden ("but here are the next available openings on
   *      Tue May 19").
   *
   * Never end with "Here's what I found." — that wastes the turn.
   */
  function buildRefinementAck(
    intent: Extract<Intent, { kind: "refine_time" }>,
    result: ReturnType<typeof filterSlotsByRefinement>,
    serviceName: string
  ): string {
    const { relation, timeHints } = intent;
    const dayPhrase = result.scopeLabel;

    /* ---------------- Non-working day --------------------------------- */
    // User asked about Sun/Mon — Shen's day off. Lead with that fact, then
    // pivot to alternatives. No "Looking at..." anchor here because the
    // anchor itself isn't actionable.
    if (result.nonWorkingDay && timeHints.days.length > 0) {
      const dayPlural = `${timeHints.days[0]}s`; // "Sun" → "Suns"... fix below
      const niceDayPlural =
        timeHints.days[0] === "Sun"
          ? "Sundays"
          : timeHints.days[0] === "Mon"
          ? "Mondays"
          : timeHints.days[0] === "Tue"
          ? "Tuesdays"
          : timeHints.days[0] === "Wed"
          ? "Wednesdays"
          : timeHints.days[0] === "Thu"
          ? "Thursdays"
          : timeHints.days[0] === "Fri"
          ? "Fridays"
          : timeHints.days[0] === "Sat"
          ? "Saturdays"
          : dayPlural;
      return `${sName()} doesn't usually take appointments on ${niceDayPlural}. Here are their next available openings.`;
    }

    /* ---------------- Past horizon ----------------------------------- */
    if (result.outcome === "past-horizon") {
      return `${sName()}'s calendar isn't open that far out yet. Try ${dayPhrase} or earlier.`;
    }

    /* ---------------- Exact-hour mismatch on a known day ------------- */
    if (
      result.outcome === "fuzzy" &&
      result.askedExactHour !== null &&
      result.scope === "anchor-day"
    ) {
      const hourLabel = formatHour(result.askedExactHour);
      return `I don't see a ${hourLabel} opening on ${dayPhrase}, but here are the closest available times that day.`;
    }

    /* ---------------- Week-scoped (this week / next week / week-of)  ----- */
    if (result.scope === "week") {
      if (result.outcome === "fell-through") {
        return `Looking at ${dayPhrase} — I don't see any openings for ${serviceName}. Want me to check another week?`;
      }
      return `Looking at ${dayPhrase} — here are ${sName()}'s openings for ${serviceName}.`;
    }

    /* ---------------- Day-scoped fall-through (anchor known, no slots) - */
    if (result.outcome === "fell-through") {
      const newDayLabel = formatDayPhraseFromSlot(result.slots[0]);

      if (result.fallbackTier === "next-day") {
        // User named a day with no availability OR asked earlier/later and
        // we walked to the next day with slots.
        if (relation === "earlier") {
          return `I don't see anything earlier on ${dayPhrase}, but here are the next available openings on ${newDayLabel}.`;
        }
        if (relation === "later") {
          return `I don't see anything later on ${dayPhrase}, but here are the next available openings on ${newDayLabel}.`;
        }
        return `I don't see any openings on ${dayPhrase}, but here are the closest available times right after that — ${newDayLabel}.`;
      }
      if (result.fallbackTier === "this-week") {
        if (relation === "earlier") {
          return `I don't see anything earlier that day, but here are the next available openings that week.`;
        }
        if (relation === "later") {
          return `I don't see anything later that day, but here are the next available openings that week.`;
        }
        return `I don't see any openings on ${dayPhrase}, but here are the next available times that week.`;
      }
      if (result.fallbackTier === "next-week") {
        return `${dayPhrase} is fully booked. Here are the next available openings the week after.`;
      }
      if (result.fallbackTier === "before-anchor") {
        // No slots exist on or after the anchor. Show the last available ones
        // and be upfront that they're earlier.
        if (relation === "later") {
          return `There are no openings after ${dayPhrase} for ${serviceName} — that's the last available window. Here are the remaining slots.`;
        }
        return `I don't see any openings on or after ${dayPhrase} for ${serviceName}. The last available times are before that — here they are.`;
      }
      // same-day tier — there ARE other slots that day, we just dropped the
      // earlier/later filter. Reassure rather than apologize.
      if (relation === "earlier") {
        return `I don't see anything earlier on ${dayPhrase}, but here are the closest available times that day.`;
      }
      if (relation === "later") {
        return `I don't see anything later on ${dayPhrase}, but here are the closest available times that day.`;
      }
      return `Looking at ${dayPhrase} — here's what's still open that day.`;
    }

    /* ---------------- Day-scoped successes --------------------------- */
    if (relation === "earlier") {
      return `Earlier openings on ${dayPhrase} for ${serviceName} —`;
    }
    if (relation === "later") {
      return `Later openings on ${dayPhrase} for ${serviceName} —`;
    }
    if (relation === "more") {
      // "yes" / "more" / "show more"
      return `Here are more of ${sName()}'s openings for ${serviceName}.`;
    }
    if (timeHints.hour24 !== null && timeHints.timeFlexibility === "approximate") {
      const hourLabel = formatHour(timeHints.hour24);
      return `Looking at ${dayPhrase} around ${hourLabel} — here are the closest options.`;
    }
    if (result.scope === "anchor-day") {
      return `Looking at ${dayPhrase} — here are the openings I found for that day.`;
    }
    // Unanchored success — should be rare. Still lead with the service name
    // rather than the generic "Here's what I found."
    return `Here are ${sName()}'s next openings for ${serviceName}.`;
  }

  function formatDayPhraseFromSlot(slot: TimeSlot | undefined): string {
    if (!slot) return "another day";
    return `${slot.dayLabel} ${slot.dateLabel}`;
  }

  function handleSelectSlot(
    intent: Extract<Intent, { kind: "select_slot" }>
  ) {
    const { slot, ambiguous } = findSlotByMention(intent, context);

    if (slot) {
      const svc = context.selectedService ?? context.lastRecommendedService;
      patchContext({ selectedSlot: slot, selectedService: svc });
      // Build a label that reflects the full booking — primary + any
      // additional services. Brief Issue 4: don't drop additionalServices
      // after slot selection.
      const allServices = svc
        ? [svc, ...context.additionalServices].map((s) => s.name).join(" + ")
        : "";
      pushTurn({
        kind: "bot-text",
        id: `t-pick-${Date.now()}`,
        text: `Perfect — I'll hold ${slot.dayLabel} ${slot.dateLabel} at ${slot.timeLabel}${
          allServices ? ` for ${allServices}` : ""
        }.`,
      });
      setTimeout(() => setStage("details"), 400);
      return;
    }

    if (ambiguous && ambiguous.length > 0) {
      pushTurn({
        kind: "bot-text",
        id: `t-amb-${Date.now()}`,
        text: `Sure — which one did you mean?`,
      });
      pushTurn({
        kind: "times",
        id: `t-amb-times-${Date.now()}`,
        slots: ambiguous,
        anchorDateKey: null,
        currentWeekShift: null,
        chipAvailability: {
          "earlier-day": false,
          "later-day": false,
          "next-day": false,
          "this-week": false,
          "next-week": false,
          "week-after": false,
          "pick-date": false,
          "see-all": false,
        },
      });
      patchContext({ lastShownSlots: ambiguous });
      return;
    }

    // No match — explain neutrally, then automatically walk forward.
    // The brief: don't ask "Want me to pull up more times?" — show them.
    const svc = context.selectedService ?? context.lastRecommendedService;
    if (!svc) {
      pushTurn({
        kind: "bot-text",
        id: `t-nomatch-${Date.now()}`,
        text: `That time isn't available. Tell me what you're looking for and I'll find some openings.`,
      });
      return;
    }

    // Build a friendly day label from whatever the user named. Prefer a slot's
    // own labels when available; otherwise compute "Mon May 18" from a synth
    // dateKey. This avoids the awkward "the 18th" form.
    const allSlots = cachedRealSlots(svc.id, slug);
    const namedSlot = intent.dateKey
      ? allSlots.find((s) => s.dateKey === intent.dateKey)
      : intent.dayOfMonth !== null
      ? allSlots.find((s) => s.dayOfMonth === intent.dayOfMonth)
      : null;
    const dayLabel = namedSlot
      ? `${namedSlot.dayLabel} ${namedSlot.dateLabel}`
      : intent.dateKey
      ? formatDateKeyToLabel(intent.dateKey)
      : intent.dayOfMonth !== null
      ? `May ${intent.dayOfMonth}`
      : null;

    const hourLabel = intent.hour24 !== null ? formatHour(intent.hour24) : null;

    let explanation: string;
    if (hourLabel && dayLabel) {
      explanation = `I don't see a ${hourLabel} opening on ${dayLabel}, but here are the closest available times.`;
    } else if (hourLabel) {
      explanation = `I don't see a ${hourLabel} opening, but here are the closest available times.`;
    } else if (dayLabel) {
      explanation = `I don't see openings on ${dayLabel}, but here are the closest available times right after that.`;
    } else {
      explanation = `That time isn't available, but here are the closest openings.`;
    }
    pushTurn({
      kind: "bot-text",
      id: `t-nomatch-${Date.now()}`,
      text: explanation,
    });

    // Automatically surface fallback slots — same day if possible, then walk
    let fallbackSlots: TimeSlot[] = [];
    let fallbackAnchor: string | null = null;

    if (namedSlot) {
      fallbackAnchor = namedSlot.dateKey;
      fallbackSlots = allSlots.filter((s) => s.dateKey === fallbackAnchor);
    }
    if (fallbackSlots.length === 0) {
      // Walk to next available day, cap to its slots only (not a grid).
      const next = allSlots.find((s) =>
        intent.dateKey
          ? s.dateKey > intent.dateKey
          : intent.dayOfMonth !== null
          ? s.dayOfMonth > intent.dayOfMonth || s.dateKey > MOCK_TODAY.dateKey
          : true
      );
      if (next) {
        fallbackAnchor = next.dateKey;
        fallbackSlots = allSlots.filter((s) => s.dateKey === fallbackAnchor);
      } else {
        // Truly no slots — show first few we have
        fallbackSlots = allSlots.slice(0, 4);
        fallbackAnchor = fallbackSlots[0]?.dateKey ?? null;
      }
    }
    // Brief: "show only the next closest day (or 2 max), not a full grid"
    showSlots(
      fallbackSlots.slice(0, 4),
      fallbackAnchor,
      fallbackAnchor ? deriveWeekShift(fallbackAnchor) : null
    );
  }

  /**
   * Format a dateKey "2026-05-18" as "Mon May 18". Used when user names a
   * date that has no slots, so we still produce a proper label.
   */
  function formatDateKeyToLabel(dateKey: string): string {
    const [y, m, d] = dateKey.split("-").map((s) => parseInt(s, 10));
    const dt = new Date(Date.UTC(y, m - 1, d, 12));
    const dayLabel = dt.toLocaleDateString("en-US", {
      weekday: "short",
      timeZone: "UTC",
    });
    const dateLabel = dt.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      timeZone: "UTC",
    });
    return `${dayLabel} ${dateLabel}`;
  }

  async function handleInfoQuery(intent: Extract<Intent, { kind: "info_query" }>) {
    const svc = context.selectedService ?? context.lastRecommendedService;
    if (!svc) {
      // No service in context — route to AI so it can answer naturally with
      // the catalog facts in its prompt ("how much is a haircut?" gets a
      // warm answer instead of a generic prompt). Falls through to the old
      // deterministic prompt if AI is unavailable.
      const aiResponse = await fetchChatResponse(intent.rawText);
      if (aiResponse && renderChatResponse(aiResponse, intent.rawText)) {
        return;
      }
      pushTurn({
        kind: "bot-text",
        id: `t-noinfo-${Date.now()}`,
        text: `Tell me what you're looking for first and I can share the price and how long it takes.`,
      });
      return;
    }

    // Brief Issue 2: honor the asked dimension. "How long" → duration only.
    // "How much" → price only. Both → combined.
    const asksPrice = intent.asks.includes("price");
    const asksDuration = intent.asks.includes("duration");

    const parts: string[] = [];

    if (asksPrice || (!asksPrice && !asksDuration)) {
      // Default to price when nothing was specified (legacy behavior)
      const priceAnswer = formatPriceAnswer(context);
      if (priceAnswer) parts.push(priceAnswer);
    }

    if (asksDuration) {
      const durationAnswer = formatDurationAnswer(context);
      if (durationAnswer) parts.push(durationAnswer);
    }

    // For combined bookings, append the note-line so the client knows the
    // secondary is a note, not a separate Square service. Only when we
    // actually answered (parts non-empty) — the note alone is awkward.
    if (context.additionalServices.length > 0 && parts.length > 0) {
      const primaryCategoryLower = svc.category.toLowerCase();
      const addonCategoryLower =
        context.additionalServices[0].category.toLowerCase();
      parts.push(
        `The main Square booking is the ${primaryCategoryLower}, and I'll add the ${addonCategoryLower} as a note for ${sName()} to confirm.`
      );
    }

    pushTurn({
      kind: "bot-text",
      id: `t-info-${Date.now()}`,
      text: parts.join("\n\n"),
    });
  }

  type ChatTimePreference = {
    raw: string;
    type:
      | "specific_day"
      | "specific_date"
      | "this_week"
      | "next_week"
      | "week_after"
      | "weekend"
      | "tomorrow"
      | "today"
      | "soonest"
      | "part_of_day_only"
      | null;
    dayOfWeek: string | null;
    date: string | null;
    partOfDay: "morning" | "afternoon" | "evening" | null;
  };

  type ChatResponse = {
    reply: string;
    intent:
      | "faq"
      | "service_guidance"
      | "booking"
      | "handoff"
      | "unsupported"
      | "unknown";
    recommendedServiceIds: string[];
    needsHumanHandoff: boolean;
    handoffSummary: string | null;
    confidence: number;
    serviceQuery?: string | null;
    timePreference?: ChatTimePreference | null;
    peopleCount?: number;
    multiServiceRequest?: boolean;
    questionType?: "price" | "duration" | "hours" | "location" | "other" | null;
    manageAction?: "cancel" | "reschedule" | "lookup" | null;
    source:
      | "deterministic-facts+ai"
      | "deterministic-fallback"
      | "ai"
      | "fallback"
      | "cached";
    debug?: {
      routingPath: string;
      aiCalled: boolean;
      aiOutcome?: "success" | "skipped" | "failed";
      matchedServiceId?: string | null;
      elapsedMs?: number;
    };
  };

  /**
   * POST the user's message to /api/chat. The server runs deterministic
   * fact resolution then calls Groq with grounded facts in the prompt.
   * Returns null on rate limit, network failure, or 800-char overrun so
   * the caller can fall through to deterministic prompts.
   *
   * When the per-session AI cap has been hit, returns a synthetic handoff
   * response instead of hitting the network — the chat shows a short
   * message and offers the Send-to-Shen form. The cap resets on
   * resetConversation; localStorage persists it across page reloads so a
   * spammy refresh doesn't reset abuse protection.
   */
  async function fetchChatResponse(message: string): Promise<ChatResponse | null> {
    if (message.length > 800) return null;

    // Session cap — already exhausted. Synthesize a handoff response so the
    // user gets a clean off-ramp instead of a dead chat.
    if (getSessionAICount() >= SESSION_AI_LIMIT) {
      return {
        reply: `Sounds like there's a lot to cover — let me send ${sName()} a quick summary so she can get back to you directly.`,
        intent: "handoff",
        recommendedServiceIds: [],
        needsHumanHandoff: true,
        handoffSummary: `Client has sent many messages this session and wants ${sName()} to follow up. Most recent message: "${message}".`,
        confidence: 1,
        source: "fallback",
      };
    }

    // Show the "Shen is typing…" bubble for the duration of the real fetch.
    // Cleared in finally so it never lingers, on any exit path.
    showTyping(typingLabelFor(message));
    try {
      // Send up to ~8 recent turns as conversation context. Filter to plain
      // user/bot text so the model isn't confused by structured turns.
      const conversation = turns
        .filter((t) => t.kind === "user-text" || t.kind === "bot-text")
        .map((t) => ({
          role: t.kind === "user-text" ? ("user" as const) : ("assistant" as const),
          content: (t as { text: string }).text,
        }))
        .slice(-8);
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message, conversation, slug: slug ?? undefined }),
      });
      if (!res.ok) return null;
      const data = (await res.json()) as ChatResponse;
      if (!data || typeof data.reply !== "string") return null;
      // Only count toward session cap if the response actually came from AI.
      // Cached / deterministic-fallback / fallback don't consume a quota.
      if (data.source === "ai" || data.source === "deterministic-facts+ai") {
        bumpSessionAICount();
      }
      return data;
    } catch {
      return null;
    } finally {
      clearTyping();
    }
  }

  /**
   * Counts how many CONSECUTIVE low-confidence "unknown" turns the AI has
   * produced. After 2 in a row we stop asking follow-ups and offer the
   * handoff form instead. Reset on any non-unknown response and on
   * resetConversation. Stored in component state — we want it cleared on
   * page reload, since a new session means a clean slate.
   */
  const [consecutiveLowConfidence, setConsecutiveLowConfidence] = useState(0);

  /**
   * Render a /api/chat response into the appropriate chat turn(s).
   * Tracks consecutive low-confidence unknown turns so a stuck conversation
   * (two follow-up questions in a row without resolution) escalates to a
   * handoff form rather than asking a third clarifying question.
   *
   * Returns true when the response rendered something useful (caller can
   * skip the existing fallback prompts); false when caller should fall
   * through to deterministic fallback.
   */
  function renderChatResponse(
    response: NonNullable<Awaited<ReturnType<typeof fetchChatResponse>>>,
    sourceMessage: string
  ): boolean {
    const reply = response.reply.trim();
    if (!reply) return false;

    pushTurn({
      kind: "bot-text",
      id: `t-ai-${Date.now()}`,
      text: reply,
      source: response.source,
    });

    // The server "fallback" reply mentions "Browse all services" — back it
    // with a REAL tappable browser turn so the CTA isn't dead copy.
    if (response.source === "fallback") {
      const groups = buildBrowserGroups();
      if (groups.length > 0) {
        pushTurn({
          kind: "service-browser",
          id: `t-fallback-browser-${Date.now()}`,
          groups,
        });
        setChipsLocked(true);
      }
      return true;
    }

    // Track consecutive low-confidence unknown turns. Hard rule:
    //   - low confidence (< 0.6) and intent unknown → bump counter
    //   - anything else → reset counter
    const isLowConfidenceUnknown =
      response.intent === "unknown" && response.confidence < 0.6;
    const nextLowConfidence = isLowConfidenceUnknown
      ? consecutiveLowConfidence + 1
      : 0;
    setConsecutiveLowConfidence(nextLowConfidence);

    // Handoff path — explicit AI signal OR two low-confidence turns in a
    // row (we've asked, we've asked again, time to escalate). AI's summary
    // or the user's message is the editable starting point.
    const escalateToHandoff =
      response.intent === "handoff" ||
      response.needsHumanHandoff ||
      nextLowConfidence >= 2;
    if (escalateToHandoff) {
      const summary =
        response.handoffSummary?.trim() ||
        `Client wrote: "${sourceMessage}". They'd like ${sName()} to follow up.`;
      pushTurn({
        kind: "handoff",
        id: `t-handoff-${Date.now()}`,
        summary,
        sourceMessage,
      });
      // Reset the counter after escalating so a fresh follow-up isn't
      // immediately routed to another handoff card.
      setConsecutiveLowConfidence(0);
      return true;
    }

    // Resolve the returned ids to real services (order preserved).
    const resolvedServices =
      response.recommendedServiceIds.length > 0
        ? response.recommendedServiceIds
            .map((id) => SERVICES.find((s) => s.id === id))
            .filter((s): s is Service => Boolean(s))
        : [];

    // ANSWER-FIRST, DON'T ASSUME A BOOKING — a single source of truth decides
    // whether multiple service ids mean "which of these?" (a chooser) or a
    // genuine multi-service cart. Category-agnostic.
    const presentation = decideGuidancePresentation({
      intent: response.intent,
      resolvedServiceCount: resolvedServices.length,
      multiServiceRequest: response.multiServiceRequest === true,
    });

    if (presentation.kind === "options") {
      // The AI already answered (the reply describes the differences). Show the
      // options as a SELECTABLE list so the client picks ONE — never a stacked
      // cart with an "estimated total".
      pushTurn({
        kind: "alternates",
        id: `t-options-${Date.now()}`,
        services: resolvedServices,
        recommendedId: null,
      });
      return true;
    }

    if (presentation.kind === "recommendation") {
      const primary = resolvedServices[0];
      // additional services (the cart) ONLY for a genuine multi-booking.
      const additional = presentation.withCart ? resolvedServices.slice(1) : [];
      const recommendation: Recommendation = {
        primary,
        additionalServices: additional,
        alternates: [],
        honestNote: null,
        reason: "",
        unresolvedAdditionalCategory: null,
      };
      // Commit selectedService so downstream "yes find me times" works.
      patchContext({
        lastRecommendedService: primary,
        additionalServices: additional,
        bookingNotes:
          additional.length > 0
            ? `Client also wants: ${additional.map((s) => s.name).join(", ")}. Please confirm timing on the day.`
            : "",
      });
      pushTurn({
        kind: "recommendation",
        id: `t-rec-${Date.now()}`,
        rec: recommendation,
        ackText: "",
      });
      return true;
    }

    // Unsupported — Shen doesn't offer this. Offer a quick "Send to Shen"
    // path so the user can ask about it directly.
    if (response.intent === "unsupported") {
      const summary = `Client asked about something not in your service list: "${sourceMessage}". They may be interested in a custom service.`;
      pushTurn({
        kind: "handoff",
        id: `t-handoff-${Date.now()}`,
        summary,
        sourceMessage,
      });
      return true;
    }

    // FAQ / unknown (still in clarification window) — just the reply, no
    // card. Return true so we don't double up with the existing fallback.
    return true;
  }

  async function handleUnknown(intent: Extract<Intent, { kind: "unknown" }>) {
    // Affirmative-proceed: "yes / sounds good / find me the times" when a
    // recommendation is pending but slots haven't been shown yet. Auto-show
    // slots instead of re-asking "Want me to find times?".
    if (
      context.lastRecommendedService &&
      !context.selectedService &&
      /\b(yes|yeah|yep|yup|sure|ok|okay|great|perfect|awesome|do\s+it|book\s+it|go\s+ahead|i'?m\s+in|let'?s\s+(go|do|book|check|see)|sounds?\s+good|find\s+(me\s+)?(the\s+)?times?|show\s+(me\s+)?(the\s+)?times?|proceed|continue|please)\b/i.test(
        intent.rawText
      )
    ) {
      const svc = context.lastRecommendedService;
      patchContext({ selectedService: svc });
      const allSlots = await getRealSlots(svc.id, slug);
      // Rank with the REAL requested hints (not emptyHints) so the
      // recommendation turn honors any day/time the user already stated;
      // showSlots → buildRecommendation handles selection + limiting.
      const ranked = rankTimeSlots(allSlots, context.lastIntentTimeHints);
      showSlots(ranked, ranked[0]?.dateKey ?? null, null, false, allSlots);
      return;
    }

    // "Something else" / "pick something else" / "different service" — user
    // is rejecting the current recommendation and wants to pick a new service.
    // Clear the recommendation and re-prompt cleanly.
    if (
      /\b(something\s+else|something\s+different|pick\s+something|different\s+service|different\s+option|never\s+mind|nevermind|change\s+my\s+mind|start\s+fresh|other\s+option|other\s+service)\b/i.test(
        intent.rawText
      )
    ) {
      patchContext({
        lastRecommendedService: null,
        selectedService: null,
        selectedSlot: null,
        lastShownSlots: [],
        lastAnchorDateKey: null,
        pendingClarification: null,
        additionalServices: [],
      });
      pushTurn({
        kind: "bot-text",
        id: `t-reset-${Date.now()}`,
        text: "No problem — what service are you looking for? I can help with haircuts, color, perms, treatments, or a consultation.",
      });
      setChipsLocked(false);
      return;
    }

    // ── AI escalation ────────────────────────────────────────────────
    // The deterministic parser couldn't classify this message AND none of
    // the short-circuits above (affirmative, "something else", etc.) fired.
    // Ask the server: it runs deterministic FAQ first (catalog/profile
    // facts), then escalates to Groq for ambiguous/complex/conversational
    // cases. Validated service ids only — no fake services, no fake
    // prices. Falls through to the existing fallback prompts if the
    // server returns nothing useful.
    const aiResponse = await fetchChatResponse(intent.rawText);
    if (aiResponse) {
      const rendered = renderChatResponse(aiResponse, intent.rawText);
      if (rendered) {
        setChipsLocked(false);
        return;
      }
    }

    // ── Deterministic fallback (context-aware) ──────────────────────────
    if (context.selectedService && context.lastShownSlots.length > 0 && context.lastAnchorDateKey) {
      const day = context.lastShownSlots.find((s) => s.dateKey === context.lastAnchorDateKey);
      const dayPhrase = day ? `${day.dayLabel} ${day.dateLabel}` : "that day";
      pushTurn({ kind: "bot-text", id: `t-fallback-${Date.now()}`, text: `Do you want earlier or later times on ${dayPhrase}, or a different day?` });
      setChipsLocked(false);
      return;
    }
    if (context.selectedService) {
      pushTurn({ kind: "bot-text", id: `t-fallback-${Date.now()}`, text: `I can check that for ${context.selectedService.name} — which day were you thinking?` });
      setChipsLocked(false);
      return;
    }
    if (context.lastRecommendedService) {
      pushTurn({ kind: "bot-text", id: `t-fallback-${Date.now()}`, text: `Want me to find times for ${context.lastRecommendedService.name}, or pick something else?` });
      setChipsLocked(false);
      return;
    }
    // No context — show the full service browser so they can just pick
    showServiceBrowser();
  }

  /* ---------------------- Clarification tap ------------------- */

  function handleClarifyTap(
    turnId: string,
    opt: { label: string; key: string }
  ) {
    pushTurn({
      kind: "user-text",
      id: `u-clarify-${Date.now()}`,
      text: opt.label,
    });
    markTurn(turnId, { consumed: true } as Partial<AssistantTurn>);

    // Manage flow: cancel confirmation
    if (opt.key === "manage-cancel-yes" && pendingAppointment) {
      const appt = pendingAppointment;
      cancelAppointment(appt.id); // update mock store
      // Also cancel in Supabase (and Square if applicable)
      fetch("/api/bookings/cancel", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bookingId: appt.id, last4: verifiedLast4 ?? "" }),
      }).catch(() => {}); // fire-and-forget; UI already updated
      setPendingAppointment(null);
      setVerifiedLast4(null);
      setMode(null);
      pushTurn({
        kind: "bot-text",
        id: `t-cancelled-${Date.now()}`,
        text: `Done — your ${appt.serviceName} on ${appt.dayLabel} at ${appt.timeLabel} is cancelled. You'll get a confirmation text shortly.`,
      });
      pushTurn({
        kind: "manage-chips",
        id: `t-cancelled-chips-${Date.now()}`,
        chips: [
          { label: "Book a new appointment", key: "manage-book-another" },
        ],
      });
      return;
    }
    if (opt.key === "manage-cancel-no" && pendingAppointment) {
      const appt = pendingAppointment;
      setPendingAppointment(null);
      setMode(null); // stop phone-lookup intercept on any further input
      pushTurn({
        kind: "bot-text",
        id: `t-keep-${Date.now()}`,
        text: `No problem — keeping your ${appt.serviceName} on ${appt.dayLabel} as-is.`,
      });
      pushTurn({
        kind: "manage-chips",
        id: `t-keep-chips-${Date.now()}`,
        chips: [
          { label: "Book a new appointment", key: "manage-book-another" },
        ],
      });
      return;
    }

    // Confirm-switch buttons — three-button routing (Switch / Add / Keep).
    // pendingSwitch carries the time hints from the originating user message
    // so a "switch to color" / "add color" preserves the "next Tuesday"
    // they typed.
    if (opt.key === "confirm-switch-yes" && context.pendingSwitch) {
      const synth: Intent = {
        kind: "switch_service",
        rawText: opt.label,
        tags: context.pendingSwitch.tags,
        lengthHint: context.pendingSwitch.lengthHint,
        permStyle: context.pendingSwitch.permStyle,
        colorDirection: context.pendingSwitch.colorDirection,
        timeHints: context.pendingSwitch.timeHints,
        comboServiceId: null,
      };
      patchContext({ pendingSwitch: null });
      handleBookOrSwitch(synth);
      return;
    }
    if (opt.key === "confirm-switch-add" && context.pendingSwitch) {
      const synth: Intent = {
        kind: "add_services",
        rawText: opt.label,
        mode: "additive",
        tags: context.pendingSwitch.tags,
        lengthHint: context.pendingSwitch.lengthHint,
        permStyle: context.pendingSwitch.permStyle,
        colorDirection: context.pendingSwitch.colorDirection,
        timeHints: context.pendingSwitch.timeHints,
        comboServiceId: null,
      };
      patchContext({ pendingSwitch: null });
      handleAddServices(synth);
      return;
    }
    if (opt.key === "confirm-switch-no") {
      patchContext({ pendingSwitch: null });
      const current =
        context.selectedService ?? context.lastRecommendedService;
      pushTurn({
        kind: "bot-text",
        id: `t-keep-${Date.now()}`,
        text: current
          ? `No problem — sticking with ${current.name}. What would you like to ask about it?`
          : `No problem — what would you like to do?`,
      });
      return;
    }

    // Fuzzy-match confirmation — user typed "balayge", we asked "color
    // service, right?", they tapped Yes/No. Restore time hints from the
    // original message so "balayge next Tuesday" → "yes color" still
    // surfaces Tuesday slots.
    if (opt.key === "fuzzy-yes" && context.pendingFuzzy) {
      const synth: Intent = {
        kind: "book",
        rawText: opt.label,
        tags: [context.pendingFuzzy.tag],
        lengthHint: null,
        permStyle: null,
        colorDirection: null,
        timeHints: context.pendingFuzzy.timeHints,
        confidence: "high",
        comboServiceId: null,
      };
      patchContext({ pendingFuzzy: null });
      handleBookOrSwitch(synth);
      return;
    }
    if (opt.key === "fuzzy-no") {
      patchContext({ pendingFuzzy: null });
      pushTurn({
        kind: "bot-text",
        id: `t-fuzzyno-${Date.now()}`,
        text: `No problem — tell me what service you're looking for and I'll help find the right booking.`,
      });
      return;
    }

    // Add-on flow — after selecting a primary from the service browser
    if (opt.key === "addon-no") {
      const svc = context.selectedService ?? context.lastRecommendedService;
      if (svc) {
        const allSlots = cachedRealSlots(svc.id, slug);
        const ranked = rankTimeSlots(allSlots, context.lastIntentTimeHints);
        showSlots(ranked, ranked[0]?.dateKey ?? null, null, false, allSlots);
      }
      return;
    }
    if (opt.key.startsWith("addon-cat:")) {
      const cat = opt.key.slice(10);
      const catServices = SERVICES.filter((s) => s.category === cat && s.status !== "hidden");
      pushTurn({
        kind: "service-browser",
        id: `t-addon-browser-${Date.now()}`,
        groups: [{ category: cat, services: catServices }],
      });
      return;
    }

    // Pending additional service — user just answered the haircut-length
    // clarification. Now commit everything and show the recommendation card
    // (which was intentionally deferred so the user could answer first).
    if (
      context.pendingAdditionalService &&
      (opt.key === "len-short" || opt.key === "len-long")
    ) {
      const newCutId =
        opt.key === "len-short" ? "svc-short-cut" : "svc-medium-long-cut";
      const newCut = SERVICES.find((s) => s.id === newCutId);
      if (newCut) {
        const filtered = context.additionalServices.filter(
          (s) => s.category !== "Haircut"
        );
        const updated = [...filtered, newCut];
        const primary = context.selectedService ?? context.lastRecommendedService;

        // Commit selectedService here so the DetailsStage guard passes when
        // the user later picks a slot (context.selectedSlot is the other half).
        patchContext({
          additionalServices: updated,
          pendingAdditionalService: null,
          selectedService: primary ?? null,
          bookingNotes:
            updated.length > 0
              ? `Client also wants: ${updated
                  .map((s) => s.name)
                  .join(", ")}. Please confirm timing on the day.`
              : "",
        });

        if (primary) {
          // Show the recommendation card now — this is the first time the user
          // sees it, with the correct resolved service in additionalServices.
          const recAckText = `Perfect — ${primary.name} plus ${updated
            .map((s) => s.name)
            .join(" plus ")}.`;
          pushTurn({
            kind: "recommendation",
            id: `t-rec-resolved-${Date.now()}`,
            rec: {
              primary,
              additionalServices: updated,
              alternates: [],
              reason: "",
              honestNote: null,
              unresolvedAdditionalCategory: null,
            },
            ackText: recAckText,
          });
        }
      }
      return;
    }

    // Standard clarify (length hint / color direction / etc.)
    // Restore colorDirection from context — the user may have already
    // specified root vs full before we asked for haircut length, and we
    // must not lose it.
    //
    // CRITICAL: Restore time hints too. The user's "next Tuesday" /
    // "Saturday afternoon" / "next week" / "soonest" from the originating
    // message lives on context.lastIntentTimeHints. Using emptyHints()
    // here is the bug that caused "haircut next Tuesday" → "short" to
    // surface today's openings instead of Tuesday's.
    const reconstructed: Intent = {
      kind: "book",
      rawText: opt.label,
      tags: context.lastIntentTags,
      lengthHint: null,
      permStyle: null,
      colorDirection: context.lastIntentColorDirection,
      timeHints: context.lastIntentTimeHints,
      confidence: "high",
      comboServiceId: null,
    };
    handleBookOrSwitch(reconstructed, opt.key);
  }

  /* ---------------------- Recommendation actions -------------- */

  function handleBookThis(turnId: string) {
    const rec = context.lastRecommendedService;
    // The recommendation lives on the turn AND on context.lastRecommendedService
    // — use the latter as the source of truth
    if (!rec) return;

    markTurn(turnId, { acted: true } as Partial<AssistantTurn>);

    // Pull the full recommendation (not just primary) from the turn
    const recTurn = [...turns].reverse().find((t) => t.kind === "recommendation");
    const fullRec =
      recTurn && recTurn.kind === "recommendation" ? recTurn.rec : null;
    const additional = fullRec?.additionalServices ?? [];
    const honestNote = fullRec?.honestNote ?? null;

    pushTurn({
      kind: "user-text",
      id: `u-book-${Date.now()}`,
      text:
        additional.length > 0
          ? `Book ${shortServiceName(rec.name)} + ${additional
              .map((s) => shortServiceName(s.name))
              .join(" + ")}`
          : `Book ${rec.name}`,
    });

    // Booking notes priority:
    //   1. additionalServices listed explicitly (multi-service)
    //   2. honestNote from recommender (e.g. women's perm + haircut gap)
    //   3. empty
    let bookingNotes = "";
    if (additional.length > 0) {
      const names = additional.map((s) => s.name).join(", ");
      bookingNotes = `Client also wants: ${names}. Please confirm timing on the day.`;
    } else if (honestNote) {
      bookingNotes =
        "Mentioned a haircut alongside the perm — please confirm whether to include a cut.";
    }

    patchContext({
      selectedService: rec,
      additionalServices: additional,
      bookingNotes,
    });

    if (context.selectedSlot) {
      pushTurn({
        kind: "bot-text",
        id: `t-todetails-${Date.now()}`,
        text: `Perfect. ${rec.name}${
          additional.length > 0
            ? " (with " +
              additional.map((s) => shortServiceName(s.name)).join(" + ") +
              " noted)"
            : ""
        } on ${context.selectedSlot.fullLabel} — let's lock it in.`,
      });
      setTimeout(() => setStage("details"), 400);
      return;
    }

    // Show times for this service — fetch from real API, fall back to mock.
    //
    // Respect the time hints from the originating message
    // (context.lastIntentTimeHints). If the user said "I want a haircut
    // next Tuesday", we must surface Tuesday slots here, not today's.
    // scopeSlotsByHints applies the same week/day/date filter the auto-
    // commit path uses, so the two flows stay consistent.
    const hints = context.lastIntentTimeHints;
    const loadingId = `t-loading-${Date.now()}`;
    pushTurn({
      kind: "bot-text",
      id: loadingId,
      text: `That's ${rec.priceLabel} and runs about ${rec.durationLabel.toLowerCase()}. Looking up openings…`,
    });
    fetchSlotsForService(rec.id, 0, slug).then((allSlots) => {
      setTurns((prev) => prev.map((t) =>
        t.id === loadingId
          ? { ...t, text: `That's ${rec.priceLabel} and runs about ${rec.durationLabel.toLowerCase()}. Here are ${sName()}'s best openings.` }
          : t
      ));
      const scoped = scopeSlotsByHints(allSlots, hints);
      const ranked = rankTimeSlots(scoped, hints).slice(0, 6);
      showSlots(ranked, ranked[0]?.dateKey ?? null, null, false, allSlots);
    });
  }

  function handleShowAlternates(turnId: string) {
    // Look up the recommendation from the turn itself
    const recTurn = [...turns]
      .reverse()
      .find((t) => t.kind === "recommendation" && t.id === turnId);
    if (!recTurn || recTurn.kind !== "recommendation") return;
    const primary = recTurn.rec.primary;
    const alternates = recTurn.rec.alternates;

    markTurn(turnId, { acted: true } as Partial<AssistantTurn>);
    pushTurn({
      kind: "user-text",
      id: `u-alts-${Date.now()}`,
      text: "Show other options",
    });

    if (alternates.length === 0) {
      pushTurn({
        kind: "bot-text",
        id: `t-noalt-${Date.now()}`,
        text: "That's the only close match. If it's not right, want to start over?",
      });
      return;
    }

    // Include the primary recommendation in the list so the user doesn't
    // lose it when comparing. Brief: "ALWAYS include the original recommended
    // service, marked visually as Recommended."
    const optionsWithPrimary = [
      primary,
      ...alternates.filter((a) => a.id !== primary.id),
    ];

    pushTurns(
      {
        kind: "bot-text",
        id: `t-alts-text-${Date.now()}`,
        text: "Here are the options. The recommended one is marked.",
      },
      {
        kind: "alternates",
        id: `t-alts-${Date.now()}`,
        services: optionsWithPrimary,
        recommendedId: primary.id,
      }
    );
  }

  function handleAlternatePick(svc: Service) {
    if (svc.status === "consultation") {
      // Consultation-tier services can't be booked through Kasa — they
      // require a direct conversation with the stylist. Don't pretend
      // to schedule one; hand off to Instagram DM instead.
      patchContext({ selectedService: svc, lastRecommendedService: svc });
      pushTurns(
        {
          kind: "user-text",
          id: `u-alt-${Date.now()}`,
          text: svc.name,
        },
        {
          kind: "bot-text",
          id: `t-cons-${Date.now()}`,
          text: `${svc.name} needs to be planned directly with ${sName()}. Send them a quick message to set it up.`,
        },
        { kind: "custom-cta", id: `t-cons-cta-${Date.now()}` }
      );
      return;
    }

    pushTurn({ kind: "user-text", id: `u-alt-${Date.now()}`, text: svc.name });

    // If a primary service already exists, this pick is an add-on
    const existingPrimary = context.selectedService ?? context.lastRecommendedService;
    if (existingPrimary && existingPrimary.id !== svc.id) {
      const updated = [...context.additionalServices.filter((s) => s.category !== svc.category), svc];
      patchContext({ additionalServices: updated });
      const allSlots = cachedRealSlots(existingPrimary.id, slug);
      const ranked = rankTimeSlots(allSlots, context.lastIntentTimeHints);
      pushTurn({
        kind: "bot-text",
        id: `t-addon-added-${Date.now()}`,
        text: `Added ${svc.name}.`,
      });
      showSlots(ranked, ranked[0]?.dateKey ?? null, null, false, allSlots);
      return;
    }

    patchContext({ selectedService: svc, lastRecommendedService: svc });

    if (context.selectedSlot) {
      pushTurn({
        kind: "bot-text",
        id: `t-todetails-${Date.now()}`,
        text: `Perfect. ${svc.name} on ${context.selectedSlot.fullLabel} — let's lock it in.`,
      });
      setTimeout(() => setStage("details"), 400);
      return;
    }

    // Offer add-on before showing times — one question, easy to skip
    const otherCategories = Array.from(
      new Set(SERVICES.filter((s) => s.status === "online" && s.category !== svc.category && s.category !== "Other").map((s) => s.category))
    ).slice(0, 3);

    pushTurn({
      kind: "clarify",
      id: `t-addon-${Date.now()}`,
      text: `Got it — ${svc.name} (${svc.priceLabel} · ${svc.durationLabel}). Want to add anything else while you're here?`,
      options: [
        ...otherCategories.map((cat) => ({ label: `Add ${cat}`, key: `addon-cat:${cat}` })),
        { label: "No, just this", key: "addon-no" },
      ],
    });
  }

  function handleInlineSlotPick(slot: TimeSlot) {
    // Reschedule path — defer the swap to RescheduleReviewStage so the user
    // gets a clear old → new confirmation moment instead of an instant
    // commit. Echo the slot as a user turn first so the chat thread reads
    // correctly when they come back (if they cancel the review). Mark the
    // origin as "chat" so RescheduleReviewStage knows where to return on
    // "Keep original time" (back to home, not manage-lookup).
    if (mode === "reschedule" && pendingAppointment) {
      pushTurn({
        kind: "user-text",
        id: `u-slot-${Date.now()}`,
        text: slot.fullLabel,
      });
      setPendingRescheduleSlot(slot);
      setRescheduleOrigin("chat");
      setStage("reschedule-review");
      return;
    }

    patchContext({ selectedSlot: slot, lastAnchorDateKey: slot.dateKey });
    pushTurn({
      kind: "user-text",
      id: `u-slot-${Date.now()}`,
      text: slot.fullLabel,
    });
    setStage("details");
  }

  function handleSeeMoreTimes() {
    if (!context.selectedService && !context.lastRecommendedService) return;
    setStage("time");
  }

  /**
   * Generic navigation chip handler — synthesizes the right intent or week
   * shift and reuses handleRefineTime / showSlots.
   */
  function handleNavChip(
    chipKey: NavChipKey,
    anchorDateKey: string | null,
    weekShift: number | null
  ) {
    const svc = context.selectedService ?? context.lastRecommendedService;
    if (!svc) return;

    // Echo the user's choice as a user bubble so the conversation reads naturally
    pushTurn({
      kind: "user-text",
      id: `u-nav-${Date.now()}`,
      text: NAV_CHIP_LABELS[chipKey],
    });

    if (chipKey === "earlier-day" || chipKey === "later-day") {
      const synth: Intent = {
        kind: "refine_time",
        rawText: NAV_CHIP_LABELS[chipKey],
        relation: chipKey === "earlier-day" ? "earlier" : "later",
        anchorDateKey,
        timeHints: emptyHints(),
      };
      handleRefineTime(synth);
      return;
    }

    if (chipKey === "next-day") {
      const allSlots = cachedRealSlots(svc.id, slug);
      // Find the next distinct date after anchorDateKey
      const nextDate = anchorDateKey
        ? allSlots.find((s) => s.dateKey > anchorDateKey)?.dateKey
        : allSlots[0]?.dateKey;
      if (!nextDate) {
        pushTurn({
          kind: "bot-text",
          id: `t-noday-${Date.now()}`,
          text: `That's the last day with openings I can see right now.`,
        });
        return;
      }
      const synth: Intent = {
        kind: "refine_time",
        rawText: "next day",
        relation: null,
        anchorDateKey: null,
        timeHints: { ...emptyHints(), dateKey: nextDate },
      };
      handleRefineTime(synth);
      return;
    }

    if (
      chipKey === "this-week" ||
      chipKey === "next-week" ||
      chipKey === "week-after"
    ) {
      const targetShift =
        chipKey === "this-week" ? 0 : chipKey === "next-week" ? 1 : 2;
      const allSlots = cachedRealSlots(svc.id, slug);
      const result = getSlotsForWeekShift(allSlots, targetShift);

      if (result.outcome === "past-horizon") {
        pushTurn({
          kind: "bot-text",
          id: `t-horizon-${Date.now()}`,
          text: `${sName()}'s calendar isn't open that far yet — the latest she has is ${MOCK_AVAILABILITY_HORIZON.dateLabel}.`,
        });
        return;
      }
      if (result.slots.length === 0) {
        pushTurn({
          kind: "bot-text",
          id: `t-emptyweek-${Date.now()}`,
          text: `That week is fully booked. Want me to check the week before or after?`,
        });
        return;
      }

      // Use the anchor-first pattern from buildRefinementAck
      const ack =
        chipKey === "this-week"
          ? `Looking at this week — here are ${sName()}'s openings for ${svc.name}.`
          : chipKey === "next-week"
          ? `Looking at next week — here are ${sName()}'s openings for ${svc.name}.`
          : `Looking at the week after — here are ${sName()}'s openings for ${svc.name}.`;

      pushTurn({ kind: "bot-text", id: `t-week-${Date.now()}`, text: ack });
      showSlots(result.slots.slice(0, 8), null, targetShift);
      return;
    }

    if (chipKey === "pick-date") {
      pushTurn({
        kind: "bot-text",
        id: `t-prototype-${Date.now()}`,
        text: `In production, you'd pick any date from a calendar. For this prototype, ${sName()}'s slots run through ${MOCK_AVAILABILITY_HORIZON.dateLabel}.`,
      });
      return;
    }

    if (chipKey === "see-all") {
      setStage("time");
      return;
    }
  }

  /* ---------------------- Render ----------------------------- */

  const homeProps: HomeProps = {
    assistantRef,
    turns,
    chipsLocked,
    onPromptChip: handlePromptChip,
    onTextSubmit: handleTextSubmit,
    onClarifyTap: handleClarifyTap,
    onBookThis: handleBookThis,
    onShowAlternates: handleShowAlternates,
    onAlternatePick: handleAlternatePick,
    onSlotPick: handleInlineSlotPick,
    onNavChip: handleNavChip,
    // Defensive: no code path emits consult-cta turns anymore (consultation
    // services now route to the Instagram DM handoff). If an old chat turn
    // is somehow still showing one, route to the custom (DM) stage instead
    // of the removed consultation booking flow.
    onConsultationCta: () => setStage("custom"),
    onCustomCta: () => setStage("custom"),
    // Browse all services from inside chat — exits the chat and lands on
    // the dedicated BrowseAllServicesStage. Used as the "I want to see
    // everything" escape from the alternates panel and from the entry-screen
    // recommendation card.
    onBrowseAllCta: () => {
      setAssistantOpen(false);
      setStage("browse");
    },
    onResetConversation: resetConversation,
    onChangeService: changeService,
    serviceLocked: Boolean(
      context.selectedService ||
        context.lastRecommendedService ||
        context.pendingSwitch ||
        context.pendingAdditionalService ||
        context.pendingFuzzy
    ),
    conversationStarted: turns.length > 1,
    mode,
    onModePick: handleModePick,
    onAppointmentPick: handleAppointmentPick,
    onManageChip: handleManageChip,
    onSubmitHandoff: handleSubmitHandoff,
    onOpenHandoff: handleOpenHandoff,
    stylistName: profile.name,
    stylistLocation: profile.location,
    stylistInitials: profile.initials,
  };

  // Entry screen — the first thing a visitor sees on /shen. Confident clients
  // can fast-book without engaging the chat; vague clients can open the
  // assistant via "Help me choose" or by typing in the input.
  function openAssistant(prefilledMessage?: string) {
    // If a conversation already exists from a prior open-then-close, start
    // fresh so the user sees a clean greeting and doesn't get confused by
    // stale turns from a previous session.
    if (turns.length > 0) {
      // Re-opening after a closed prior session — wipe stale turns and
      // start from an empty list. No greeting; user opens with their own
      // message.
      setTurns([]);
      setChipsLocked(false);
    }
    setAssistantOpen(true);
    track("assistant_opened", {
      source: prefilledMessage ? "prefilled" : "manual",
    });
    if (prefilledMessage) {
      // Defer one tick so the AssistantBlock / MobileChatShell is mounted and
      // its turn handlers are ready to receive the message.
      setTimeout(() => handleTextSubmit(prefilledMessage), 0);
    }
  }

  // Entry-screen service-card tap: set the chosen service and go straight to
  // TimeStage. Bypasses ServicePickerStage because the entry screen already
  // surfaces every bookable service — there's nothing to pick *between*.
  function handleServicePick(svc: Service) {
    track("booking_started", { source: "entry-service" });
    patchContext({ selectedService: svc });
    setStage("time");
    track("service_selected", { serviceId: svc.id, source: "entry-service" });
  }

  /**
   * Category-shortcut chip tap. Picks the top-ranked online service in the
   * given category and surfaces it as a confident recommendation card on
   * the entry screen. We don't route through the NLU because some
   * categories (notably Color) trigger a clarifying question that would
   * dump the user into chat — surprising behavior when they tapped what
   * they thought was a fast path.
   *
   * Falls back to opening the chat if the category has no online services
   * with a popular rank (defensive — should not happen with current data).
   */
  function handleCategoryShortcut(
    category: "Haircut" | "Color" | "Perm" | "Treatment"
  ) {
    // STAY IN THE CHAT. Tapping a category chip is the start of a question,
    // not a booking — so open the conversation with that category (e.g.
    // "perm") and let the assistant answer / enumerate the options inline,
    // instead of taking over the screen with a single pre-picked service.
    // The only way out of the chat is an explicit SERVICE tap in the booking
    // view (handleServicePick), never a category.
    track("assistant_opened", { source: "category-chip", category });
    openAssistant(category.toLowerCase());
  }

  /**
   * Entry-screen intent submission. Runs the user's text through the existing
   * parser. If we get a confident single-service recommendation, render the
   * inline recommendation card (no chat). Otherwise, fall through to the
   * existing assistant chat exactly like the prior behavior.
   *
   * "Confident" means: intent.kind === "book", at least one service tag (or
   * a combo match), the parser has no pending clarification question, and the
   * recommendation didn't fabricate an additional category we'd need to
   * confirm. Anything ambiguous goes to chat where the existing turn-by-turn
   * machinery handles back-and-forth.
   */
  function handleIntent(text: string) {
    const trimmed = text.trim();
    if (!trimmed) {
      openAssistant();
      return;
    }

    // Pre-NLU shortcuts for utility intents that have dedicated UI surfaces
    // and don't belong in chat. Pattern-matched here instead of in the
    // parser so the parser stays focused on booking NLU. Patterns are
    // intentionally permissive — these are the kinds of phrases real users
    // would actually type.
    const lower = trimmed.toLowerCase();
    if (matchesUsualIntent(lower)) {
      track("booking_started", { source: "usual" });
      setStage("usual-lookup");
      return;
    }
    if (matchesManageIntent(lower)) {
      track("booking_started", { source: "manage" });
      setStage("manage-lookup");
      return;
    }

    // Unsupported-service guard. Without this, "I want to bleach my hair"
    // typed at the entry screen would route to the inline recommendation
    // card for Full Color — a service the stylist doesn't actually offer.
    // Drop into the chat with the message so handleTextSubmit's matching
    // unsupported guard can render the handoff turn.
    if (detectUnsupportedService(trimmed, unsupportedTerms)) {
      openAssistant(trimmed);
      return;
    }

    // Multi-person guard (same reasoning): "my mom and I both want haircuts"
    // typed at the entry screen would otherwise become an inline single-cut
    // recommendation. Drop into chat so handleTextSubmit routes it to a
    // handoff instead of booking one slot.
    if (detectMultiPerson(trimmed)) {
      openAssistant(trimmed);
      return;
    }

    // STAY IN THE CHAT. A typed message on the entry screen always opens the
    // conversation — we never take over the screen with a full-page
    // recommendation card that pre-picks a service. The chat is the product:
    // it answers questions and, when appropriate, renders an INLINE
    // recommendation turn inside the conversation. The only way out of the
    // chat is the user explicitly tapping a service in the main booking view.
    track("assistant_opened", { source: "intent-input" });
    openAssistant(trimmed);
  }

  // Accept a recommendation from the inline card: lock the service (+ any
  // combo additionals) into context and route to TimeStage.
  function acceptEntryRecommendation() {
    if (!entryRecommendation) return;
    const { rec } = entryRecommendation;
    track("booking_started", { source: "entry-recommendation" });
    const additional = rec.additionalServices ?? [];
    const bookingNotes = additional.length
      ? `Client also wants: ${additional.map((s) => s.name).join(", ")}. Please confirm timing on the day.`
      : "";
    patchContext({
      selectedService: rec.primary,
      additionalServices: additional,
      bookingNotes,
    });
    track("service_selected", {
      serviceId: rec.primary.id,
      source: "entry-recommendation",
    });
    setEntryRecommendation(null);
    setStage("time");
  }

  // "Not quite right" — drop the inline card and hand off to the chat with
  // the original message so the user gets the full multi-turn refinement
  // flow (alternates, clarifications, switches, etc.).
  function refineEntryRecommendation() {
    if (!entryRecommendation) return;
    const text = entryRecommendation.userText;
    setEntryRecommendation(null);
    openAssistant(text);
  }

  // Recommendation card "Show all [Category]" — opens the browse stage
  // filtered to the recommendation's category so the user can scan every
  // service in that family without seeing unrelated categories.
  function showAllInRecommendationCategory() {
    if (!entryRecommendation) return;
    const cat = entryRecommendation.rec.primary.category;
    setBrowseInitialCategory(cat);
    setEntryRecommendation(null);
    setStage("browse");
  }

  // Recommendation card "Back" — clear the card and return to the bare
  // entry screen. Distinct from "Not quite right" which hands off to chat.
  function dismissEntryRecommendation() {
    setEntryRecommendation(null);
  }

  // "+ Add another service" inside the recommendation card. Merge the picked
  // service into the recommendation's additionalServices and re-render. The
  // card already filters categories already in the booking, so this won't
  // produce duplicates. Stays on the recommendation card (does not navigate)
  // so the user can keep adding or tap Find times when ready.
  function addAnotherToRecommendation(svc: Service) {
    if (!entryRecommendation) return;
    const existing = entryRecommendation.rec.additionalServices ?? [];
    // Defensive: skip if somehow already in the list (shouldn't happen since
    // the picker hides already-booked categories).
    if (existing.some((s) => s.id === svc.id)) return;
    setEntryRecommendation({
      userText: entryRecommendation.userText,
      rec: {
        ...entryRecommendation.rec,
        additionalServices: [...existing, svc],
      },
    });
    track("service_selected", {
      serviceId: svc.id,
      source: "entry-add-another",
    });
  }

  // User tapped an alternate service tile inside the recommendation card.
  // Skip the card and go directly to TimeStage with that service selected —
  // they've already chosen explicitly, no need to re-confirm.
  function acceptAlternateService(svc: Service) {
    track("booking_started", { source: "entry-alternate" });
    patchContext({
      selectedService: svc,
      additionalServices: [],
      bookingNotes: "",
    });
    setEntryRecommendation(null);
    setStage("time");
    track("service_selected", { serviceId: svc.id, source: "entry-alternate" });
  }

  // Compute alternates for the recommendation card: same-category online
  // services minus the primary itself and any combo-additional services,
  // capped at 3. The remainder (if any) is offered via "Show all [category]"
  // which routes to the filtered Browse stage.
  const recommendationAlternates = (() => {
    if (!entryRecommendation) return [];
    const { rec } = entryRecommendation;
    const cat = rec.primary.category;
    const excludeIds = new Set<string>([rec.primary.id]);
    rec.additionalServices.forEach((s) => excludeIds.add(s.id));
    return SERVICES.filter(
      (s) =>
        s.category === cat &&
        s.status === "online" &&
        !excludeIds.has(s.id)
    ).slice(0, 3);
  })();

  // True when there are more in-category services beyond the 3 shown — used
  // to toggle "Show all [category]" link visibility on the card.
  const recommendationHasMoreInCategory = (() => {
    if (!entryRecommendation) return false;
    const { rec } = entryRecommendation;
    const cat = rec.primary.category;
    const excludeIds = new Set<string>([rec.primary.id]);
    rec.additionalServices.forEach((s) => excludeIds.add(s.id));
    const all = SERVICES.filter(
      (s) =>
        s.category === cat &&
        s.status === "online" &&
        !excludeIds.has(s.id)
    );
    return all.length > 3;
  })();

  // Group bookable services by category — used by the "Browse all services"
  // stage. Not surfaced on the entry screen by default (the entry screen
  // shows only Popular). Filters out hidden + consultation-only.
  const groupedServices = ["Haircut", "Color", "Perm", "Treatment"]
    .map((cat) => ({
      category: cat,
      services: SERVICES.filter(
        (s) => s.category === cat && s.status === "online"
      ),
    }))
    .filter((g) => g.services.length > 0);

  // Top 3 popular services for the entry-screen Popular section. `popularRank`
  // lives on CatalogEntry (extends Service); we cast safely so existing types
  // don't need a refactor. Sort ascending — rank 1 is most popular. Services
  // without a rank are excluded.
  const popularServices = SERVICES
    .filter(
      (s): s is Service & { popularRank: number } =>
        s.status === "online" &&
        typeof (s as Service & { popularRank?: number }).popularRank === "number"
    )
    .sort((a, b) => a.popularRank - b.popularRank)
    .slice(0, 3);

  const entryScreen = (
    <EntryScreen
      stylistName={profile.name}
      popularServices={popularServices}
      recommendation={entryRecommendation}
      recommendationAlternates={recommendationAlternates}
      recommendationHasMoreInCategory={recommendationHasMoreInCategory}
      onSubmitIntent={handleIntent}
      onOpenAssistant={openAssistant}
      onAcceptRecommendation={acceptEntryRecommendation}
      onAcceptAlternate={acceptAlternateService}
      onShowAllInRecommendationCategory={showAllInRecommendationCategory}
      onDismissRecommendation={dismissEntryRecommendation}
      onRefineRecommendation={refineEntryRecommendation}
      onAddAnotherToRecommendation={addAnotherToRecommendation}
      onServicePick={handleServicePick}
      onCategoryShortcut={handleCategoryShortcut}
      onBrowseAll={() => setStage("browse")}
      onManageTap={() => {
        track("booking_started", { source: "manage" });
        setStage("manage-lookup");
      }}
      onUsualTap={() => {
        track("booking_started", { source: "usual" });
        setStage("usual-lookup");
      }}
    />
  );

  const showEntry = stage === "home" && !assistantOpen;

  // Mobile chat shell — fixed full-viewport, dedicated chat UX, replaces
  // PageShell entirely. Only the home (chat) stage uses it; details/confirmed
  // stay in PageShell because they're forms that scroll naturally.
  if (isMobile && stage === "home" && assistantOpen) {
    return <MobileChatShell {...homeProps} viewport={viewport} />;
  }

  return (
    <PageShell variant="client">
      {showEntry && entryScreen}
      {stage === "home" && assistantOpen && <HomeView {...homeProps} />}

      {stage === "browse" && (
        <BrowseAllServicesStage
          groupedServices={groupedServices}
          initialCategory={browseInitialCategory}
          onPick={(svc) => {
            // Reuse the same direct path as the entry-screen popular cards.
            handleServicePick(svc);
          }}
          onBack={() => {
            setBrowseInitialCategory(null);
            setStage("home");
          }}
        />
      )}

      {stage === "service-picker" && pickerCategory && (
        <ServicePickerStage
          category={pickerCategory}
          services={getShortlist(pickerCategory)}
          onPick={(svc) => {
            patchContext({ selectedService: svc });
            setStage("time");
            track("service_selected", {
              serviceId: svc.id,
              source: "service-picker",
              category: pickerCategory,
            });
          }}
          onBack={() => {
            setPickerCategory(null);
            setStage("home");
          }}
        />
      )}

      {stage === "manage-lookup" && (
        <ManageLookupStage
          onBack={() => setStage("home")}
          onReschedule={(appt) => {
            // Wire into the existing reschedule flow that TimeStage already
            // understands (handleInlineSlotPick checks mode === "reschedule"
            // and pendingAppointment to drive the swap).
            const svc =
              SERVICES.find((s) => s.id === appt.serviceId) ?? null;
            if (!svc) return;
            setPendingAppointment(appt);
            setMode("reschedule");
            setRescheduleOrigin("page");
            patchContext({ selectedService: svc });
            setStage("time");
            track("service_selected", { serviceId: svc.id, source: "reschedule" });
          }}
        />
      )}

      {stage === "usual-lookup" && (
        <UsualLookupStage
          onBack={() => setStage("home")}
          onBookSame={(svc, prefill) => {
            patchContext({ selectedService: svc });
            // Carry the previous client's name/phone/email into DetailsStage
            // so they don't re-type. Only set when the lookup returned a
            // single-match contact (guardrail at the API level).
            if (prefill) {
              setPendingClientInfo({
                name: prefill.name,
                phone: prefill.phone,
                email: prefill.email,
                notes: "",
              });
            }
            setStage("time");
            track("service_selected", { serviceId: svc.id, source: "usual" });
          }}
          onHelpMeChoose={() => {
            setStage("home");
            openAssistant();
          }}
        />
      )}

      {stage === "time" &&
        (context.selectedService || context.lastRecommendedService) && (
          <TimeStage
            service={
              (context.selectedService ?? context.lastRecommendedService)!
            }
            slug={slug}
            timeHints={emptyHints()}
            onPick={(slot) => {
              track("slot_selected", { source: "time-stage" });
              // Reschedule path: stash the picked slot and route to the
              // review screen. Nothing is committed yet — finalizeReschedule
              // is the only place that actually fires the swap.
              if (mode === "reschedule" && pendingAppointment) {
                setPendingRescheduleSlot(slot);
                setStage("reschedule-review");
                return;
              }
              patchContext({
                selectedSlot: slot,
                lastAnchorDateKey: slot.dateKey,
              });
              setStage("details");
            }}
            onBack={() => setStage("home")}
          />
        )}

      {stage === "reschedule-review" &&
        pendingAppointment &&
        pendingRescheduleSlot && (
          <RescheduleReviewStage
            appointment={pendingAppointment}
            newSlot={pendingRescheduleSlot}
            stylistName={profile.name}
            onConfirm={async () => {
              const appt = pendingAppointment;
              const slot = pendingRescheduleSlot;
              // Local-store swap. Backend reschedule API is a follow-up.
              rescheduleAppointment(appt.id, slot);
              // If reschedule originated in chat, also push success turns so
              // the chat history reads correctly if the user re-opens it.
              if (rescheduleOrigin === "chat") {
                pushTurn({
                  kind: "bot-text",
                  id: `t-rescheduled-${Date.now()}`,
                  text: `All set — your ${appt.serviceName} is moved to ${slot.dayLabel}, ${slot.dateLabel} at ${slot.timeLabel}. You'll get a confirmation text shortly.`,
                });
                pushTurn({
                  kind: "manage-chips",
                  id: `t-rescheduled-chips-${Date.now()}`,
                  chips: [
                    { label: "Book a new appointment", key: "manage-book-another" },
                  ],
                });
              }
              setPendingAppointment(null);
              setPendingRescheduleSlot(null);
              setMode(null);
              setRescheduleOrigin(null);
              setStage("home");
              track("booking_started", { source: "reschedule-confirmed" });
            }}
            onKeepOriginal={() => {
              // Where to return depends on origin: ManageLookupStage for the
              // page path (the user was scrolling appointments) or home for
              // the chat path (the chat is transient — closing it returns
              // the user to the entry screen). State stays cleaned up so
              // the next reschedule starts fresh.
              const origin = rescheduleOrigin;
              setPendingRescheduleSlot(null);
              setRescheduleOrigin(null);
              if (origin === "chat") {
                // Chat path — also clear reschedule mode + pending appointment
                // so the chat thread doesn't stay in a half-finished state.
                setPendingAppointment(null);
                setMode(null);
                setAssistantOpen(false);
                setStage("home");
              } else {
                setStage("manage-lookup");
              }
            }}
            onChangeTime={() => {
              // Go back to TimeStage to pick a different new slot. Keep
              // mode = "reschedule", pendingAppointment, and rescheduleOrigin
              // intact so the next slot pick re-enters this review screen
              // with the correct origin behavior. For chat-origin path the
              // service may not be in context (chat drove off pendingAppointment
              // alone) — populate it from the appointment's serviceId so
              // TimeStage has what it needs.
              if (!context.selectedService && !context.lastRecommendedService) {
                const svc = SERVICES.find(
                  (s) => s.id === pendingAppointment.serviceId
                );
                if (svc) patchContext({ selectedService: svc });
              }
              setPendingRescheduleSlot(null);
              setStage("time");
            }}
          />
        )}

      {stage === "details" && context.selectedService && context.selectedSlot && (
        <DetailsStage
          service={context.selectedService}
          additionalServices={context.additionalServices}
          slot={context.selectedSlot}
          prefilledNotes={context.bookingNotes}
          prefilledClientInfo={pendingClientInfo}
          stylistName={profile.name}
          stylistLocation={profile.location}
          onBack={() => setStage("home")}
          onConfirm={(clientInfo) => {
            // Just stash + transition. Actual booking happens in ReviewStage.
            setPendingClientInfo(clientInfo);
            setStage("review");
          }}
        />
      )}

      {stage === "review" &&
        context.selectedService &&
        context.selectedSlot &&
        pendingClientInfo && (
          <ReviewStage
            service={context.selectedService}
            additionalServices={context.additionalServices}
            slot={context.selectedSlot}
            clientInfo={pendingClientInfo}
            stylistName={profile.name}
            stylistLocation={profile.location}
            onChangeService={() => setStage("home")}
            onChangeTime={() => setStage("time")}
            onChangeDetails={() => setStage("details")}
            onConfirm={async () => {
              const svc = context.selectedService!;
              const slot = context.selectedSlot!;
              const info = pendingClientInfo;
              // Multi-service bookings: block the stylist's Square calendar
              // for the COMBINED time of primary + every additional service.
              // The Square booking record still references only the primary
              // SKU (additionals are surfaced in customer_note), but the
              // duration is the full multi-service total — accurate schedule
              // for the stylist is the priority.
              const additionalDuration = context.additionalServices.reduce(
                (sum, a) => sum + a.durationMinutes,
                0
              );
              const totalDurationMinutes =
                svc.durationMinutes + additionalDuration;
              try {
                const res = await fetch("/api/bookings", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({
                    serviceId: svc.id,
                    serviceName: svc.name,
                    // slot times are America/New_York wall clock — convert to UTC ISO
                    slotStartAt: nyWallToUtcIso(slot.dateKey, slot.isoTime),
                    durationMinutes: totalDurationMinutes,
                    clientName: info.name,
                    clientPhone: info.phone,
                    clientEmail: info.email || undefined,
                    notes: info.notes || undefined,
                    // Attribute the booking to this provider. Absent on the
                    // legacy /shen path (first-row fallback server-side).
                    slug: slug ?? undefined,
                  }),
                });
                if (!res.ok) {
                  track("booking_failed", { serviceId: svc.id });
                  return false;
                }
                const data = await res.json();
                // The just-booked slot now counts as blocked. Invalidate the
                // cache so a subsequent slot view re-fetches and excludes it.
                invalidateRealSlots(svc.id, slug);
                setBookingResult({
                  bookingId: data.bookingId,
                  squareBookingId: data.squareBookingId ?? null,
                });
                setStage("confirmed");
                track("booking_completed", {
                  serviceId: svc.id,
                  source: data.source ?? "unknown",
                });
                return true;
              } catch {
                track("booking_failed", { serviceId: svc.id });
                return false;
              }
            }}
            onMessageStylist={() => {
              // Booking failed (e.g. Square couldn't place it) — drop into the
              // handoff flow so the client can reach the stylist directly.
              setStage("home");
              setAssistantOpen(true);
              handleOpenHandoff();
            }}
          />
        )}

      {stage === "confirmed" &&
        context.selectedService &&
        context.selectedSlot && (
          <ConfirmedStage
            service={context.selectedService}
            additionalServices={context.additionalServices}
            slot={context.selectedSlot}
            onDone={resetConversation}
            stylistName={profile.name}
            stylistLocation={profile.location}
          />
        )}

      {stage === "consultation" && (
        <ConsultationStage
          service={context.selectedService}
          onPick={(slot) => {
            const consultService: Service =
              context.selectedService ?? {
                id: "consult-generic",
                name: `Consultation with ${sName()}`,
                category: "Other",
                priceLabel: "Free",
                durationMinutes: 30,
                durationLabel: "30 min",
                status: "consultation",
              };
            patchContext({
              selectedService: consultService,
              selectedSlot: slot,
            });
            setStage("details");
          }}
          onBack={() => setStage("home")}
          stylistName={profile.name}
        />
      )}

      {stage === "custom" && <CustomStage onDone={resetConversation} stylistName={profile.name} />}
    </PageShell>
  );
}

/* -------------------------------------------------------------------------- */
/* Helpers                                                                     */
/* -------------------------------------------------------------------------- */

function emptyHints(): TimeHints {
  return {
    days: [],
    dayOfMonth: null,
    dateKey: null,
    period: null,
    relative: null,
    hour24: null,
    timeFlexibility: "exact",
    weekShift: null,
    prefersSoonest: false,
  };
}

/**
 * True when any field on the TimeHints carries actual user signal — i.e.
 * it's not just emptyHints(). Used to detect "the user mentioned a time"
 * regardless of which specific field (day, hour, weekShift, etc.) they
 * used. Keeps "do they want a time?" out of the call sites.
 */
function hintsHaveSignal(h: TimeHints): boolean {
  return (
    h.days.length > 0 ||
    h.dayOfMonth !== null ||
    h.dateKey !== null ||
    h.period !== null ||
    h.relative !== null ||
    h.hour24 !== null ||
    h.weekShift !== null ||
    h.prefersSoonest
  );
}

/**
 * Deterministic multi-person detector. Returns true when the message is
 * clearly a booking for MORE THAN ONE person, which the beta does not
 * support booking directly (it requires back-to-back slots or multiple
 * staff/resources we can't yet guarantee). These route to a handoff.
 *
 * Runs BEFORE the confident-book path so "Can my mom and I both get
 * haircuts?" — which the deterministic parser would otherwise tag as a
 * normal Haircut booking — is intercepted.
 *
 * CRITICAL distinction:
 *   - "my mom and I", "me and my friend", "both of us", "two of us",
 *     "we both", "for me and my mom" → multi-person (TRUE).
 *   - "my mom needs a haircut", "my daughter wants color" → ONE person
 *     (the other person), NOT multi-person (FALSE). We must not over-fire
 *     on a single third-party booking.
 */
/**
 * Is this message clearly a CONSULTATION QUESTION (advice / comparison / "can
 * you do…") rather than a booking commitment? Used as a deterministic safety
 * net so a free-model misclassification can never bulldoze a real question into
 * the booking flow. We deliberately fail toward "answer" — so the bar for
 * matching is question-shaped phrasing, and we EXCLUDE clear commit phrasing.
 */
function looksLikeConsultationQuestion(text: string): boolean {
  const t = ` ${text.toLowerCase().trim()} `;

  // Clear commitment phrasing → NOT a consultation (let booking proceed).
  // "book me", "i want a/the", "let's do", "schedule", "i'd like to book".
  if (/\b(book|schedule|reserve)\s+(me|a|an|my|the|it)\b/.test(t)) return false;
  if (/\b(let'?s\s+do|i'?ll\s+(take|do|book|go\s+with))\b/.test(t)) return false;

  // Comparison / difference questions.
  if (/\b(difference|differ|compare|versus)\b/.test(t)) return true;
  if (/\bvs\.?\b/.test(t)) return true;

  // "which should I…", "what would you recommend", "what should I get/book".
  if (/\bwhich\s+(one|service|cut|should|do\s+you)\b/.test(t)) return true;
  if (/\b(recommend|suggest|advice|advise)\b/.test(t)) return true;
  if (/\bwhat\s+(should|would|do\s+you\s+think)\b/.test(t)) return true;

  // Feasibility / suitability → "can you do…", "could you do…", "is it possible",
  // "will this work", "would this suit". These often warrant a defer-to-Shen.
  if (/\b(can|could)\s+(you|shen|she)\s+(do|achieve|match|pull\s+off)\b/.test(t)) return true;
  if (/\b(will|would|does)\s+(this|that|it)\s+(work|suit|look|hold|last)\b/.test(t)) return true;
  if (/\bis\s+(it|this|that)\s+possible\b/.test(t)) return true;

  // Duration/longevity as a phrased question ("how long will this last").
  if (/\bhow\s+long\s+(will|does|do)\b.*\b(last|take|hold)\b/.test(t)) return true;

  return false;
}

function detectMultiPerson(text: string): boolean {
  const t = ` ${text.toLowerCase()} `;

  // Explicit "two people" phrasings.
  if (/\b(two|2|three|3|four|4)\s+(of\s+us|people|appointments?|cuts?|spots?|slots?)\b/.test(t)) {
    return true;
  }
  // "both" used about people: "both of us", "we both", "can we both",
  // "both get / both need / both want".
  if (/\bboth\s+(of\s+us|get|need|want|come|book)\b/.test(t)) return true;
  if (/\bwe\s+both\b/.test(t)) return true;
  // "can we both come in", "can we come in", "for both of us"
  if (/\bcan\s+we\b/.test(t) || /\bfor\s+both\b/.test(t)) return true;

  // "X and I" / "me and X" / "X and me" — the speaker PLUS someone else.
  // Require a companion noun/pronoun so we don't catch unrelated "and I".
  const companion =
    "(mom|mother|dad|father|friend|sister|brother|daughter|son|wife|husband|partner|girlfriend|boyfriend|kid|kids|child|children|family|cousin|aunt|uncle|roommate|coworker|colleague|someone|somebody)";
  if (
    new RegExp(`\\bme\\s+and\\s+(my\\s+)?${companion}\\b`).test(t) ||
    new RegExp(`\\b${companion}\\s+and\\s+(i|me)\\b`).test(t) ||
    new RegExp(`\\bmy\\s+${companion}\\s+and\\s+(i|me)\\b`).test(t) ||
    // "for me and my mom", "book for me and ..."
    new RegExp(`\\bfor\\s+me\\s+and\\b`).test(t)
  ) {
    return true;
  }

  return false;
}

/**
 * Deterministic manage-intent detector. Catches the obvious cancel /
 * reschedule / lookup phrasings before we burn an AI call on them. Same
 * routing target as the AI's manageAction field — AI is the fallback
 * when the user phrases it weirdly ("scrap my visit") rather than the
 * primary path.
 *
 * Conservative on purpose: we only fire on phrases that are unambiguous
 * about acting on an *existing* appointment. "Book another one" stays
 * in the booking flow.
 */
function detectManageIntent(
  text: string
): "cancel" | "reschedule" | "lookup" | null {
  const t = text.toLowerCase();

  // Cancel — strongest signal. "Don't want to book" is NOT cancel.
  if (
    /\b(cancel|nevermind cancel|drop|scrap)\s+(my|the|this|tomorrow'?s|today'?s|next\s+\w+'?s)?\s*(appointment|appt|booking|haircut|color|perm|treatment|visit|slot)\b/.test(
      t
    ) ||
    /\bi\s+(want\s+to|need\s+to|gotta|have\s+to)?\s*cancel\b/.test(t) ||
    /^\s*cancel(\s+(my|the|it|that|this))?\s*$/.test(t)
  ) {
    return "cancel";
  }

  // Reschedule / move / push / change time. Distinct from booking ("change
  // my service" stays booking).
  if (
    /\b(reschedule|re-?schedule)\b/.test(t) ||
    /\b(move|push|shift|change|switch)\s+(my|the|this|tomorrow'?s|today'?s|next\s+\w+'?s)?\s*(appointment|appt|booking|haircut|color|perm|treatment|visit|slot|time)\b/.test(
      t
    ) ||
    /\bcan\s+i\s+(change|move|push)\s+(my|the)\s+(appointment|booking|time)\b/.test(
      t
    )
  ) {
    return "reschedule";
  }

  // Lookup — "what's my appointment", "when is my visit". Conservative
  // so we don't grab "do you do haircuts" etc.
  if (
    /\b(what\s+(time\s+)?is\s+my|when\s+is\s+my|do\s+i\s+have|look\s+up\s+my|find\s+my|check\s+my)\s+(appointment|appt|booking|visit|next\s+visit|next\s+appointment)\b/.test(
      t
    )
  ) {
    return "lookup";
  }

  return null;
}

/**
 * Narrow a slot list to those matching the user's time hints. Same filter
 * logic the auto-commit branch in handleBookOrSwitch uses — extracted here
 * so the recommendation → "Book this" → slot-render path stays consistent
 * with the direct booking path.
 *
 * Hints compose: weekShift first, then dateKey > dayOfMonth > days. Returns
 * the original list unchanged when no hints apply.
 */
function scopeSlotsByHints(slots: TimeSlot[], hints: TimeHints): TimeSlot[] {
  let pool = slots;

  if (hints.weekShift !== null) {
    const now = new Date();
    const todayMs = new Date(
      `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}T12:00:00`
    ).getTime();
    const dayMs = 24 * 60 * 60 * 1000;
    const weekStart = todayMs + hints.weekShift * 7 * dayMs;
    const weekEnd = weekStart + 7 * dayMs;
    pool = pool.filter((s) => {
      const t = new Date(`${s.dateKey}T12:00:00`).getTime();
      return t >= weekStart && t < weekEnd;
    });
  }

  if (hints.dateKey) {
    pool = pool.filter((s) => s.dateKey === hints.dateKey);
  } else if (hints.dayOfMonth !== null) {
    pool = pool.filter((s) => s.dayOfMonth === hints.dayOfMonth);
  } else if (hints.days.length > 0) {
    if (hints.weekShift !== null) {
      pool = pool.filter((s) => hints.days.includes(s.dayLabel));
    } else {
      const nearestKey = pool
        .filter((s) => hints.days.includes(s.dayLabel))
        .map((s) => s.dateKey)
        .sort()[0];
      if (nearestKey) {
        if (hints.days.length > 1) {
          // "weekend" — keep all matching days, not just the first.
          pool = pool.filter((s) => hints.days.includes(s.dayLabel));
        } else {
          pool = pool.filter((s) => s.dateKey === nearestKey);
        }
      }
    }
  }

  // If the filter wiped out the pool entirely, fall back to the unfiltered
  // list so we surface SOMETHING rather than an empty turn. The bot copy
  // upstream should ideally call this out, but silence is worse than a
  // gentle mismatch.
  if (pool.length === 0) return slots;

  return pool;
}

/* -------------------------------------------------------------------------- */
/* AI-envelope → Intent conversion (Architecture B)                           */
/* -------------------------------------------------------------------------- */

/**
 * Time-preservation QA scenarios — these are the regressions to manually
 * exercise when touching anything in this section, handleClarifyTap, or
 * AssistantContext. Each scenario fails if the eventual slots aren't
 * scoped to the time the user originally typed.
 *
 *   1. "I need a haircut next Tuesday" → bot asks short vs medium/long →
 *      user picks short → slots MUST be next Tuesday, not today.
 *   2. "I need a haircut next week" → clarify → slots MUST be next-week.
 *   3. "I want color next week" → clarify root vs full → slots MUST be
 *      next-week.
 *   4. "I want a perm Saturday afternoon" → clarify perm type → slots
 *      MUST be Saturday afternoon.
 *   5. "Soonest haircut" → clarify → earliest available slots regardless
 *      of week (prefersSoonest=true).
 *   6. "I want my hair lighter next week" → recommendation card → user
 *      taps Book this → slots MUST be next-week (handleBookThis path).
 *   7. "balayge next Tuesday" → fuzzy "color service, right?" → Yes →
 *      slots MUST be next Tuesday (pendingFuzzy.timeHints path).
 *   8. "Can my girlfriend get a haircut during my perm?" → AI returns
 *      peopleCount=2 → handoff form, no booking.
 */

const FULL_DAY_TO_SHORT: Record<string, string> = {
  monday: "Mon",
  tuesday: "Tue",
  wednesday: "Wed",
  thursday: "Thu",
  friday: "Fri",
  saturday: "Sat",
  sunday: "Sun",
};

/**
 * Convert the AI's structured timePreference to the executor's TimeHints
 * vocabulary. The executor (the existing booking flow) is the source of
 * truth — this is a one-way translation, nothing more.
 *
 * The model may have hallucinated a malformed value. We accept what we
 * recognize and silently drop the rest.
 */
function aiTimePrefToHints(
  tp:
    | {
        type:
          | "specific_day"
          | "specific_date"
          | "this_week"
          | "next_week"
          | "week_after"
          | "weekend"
          | "tomorrow"
          | "today"
          | "soonest"
          | "part_of_day_only"
          | null;
        dayOfWeek: string | null;
        date: string | null;
        partOfDay: "morning" | "afternoon" | "evening" | null;
        raw?: string | null;
      }
    | null
): TimeHints {
  const hints = emptyHints();
  if (!tp) return hints;

  // Locale-agnostic normalization (English / Korean / Simplified Chinese).
  // The model may leak the user's language into dayOfWeek/partOfDay (e.g.
  // "화요일", "周二") or drop a field that was present in `raw` ("오후", "下午").
  // We normalize the structured fields to English enums, falling back to a
  // scan of `raw`. This is what keeps "다음주 화요일 오후" / "下周二下午" booking on
  // the right day + time instead of dropping to "next available openings".
  const loc = normalizeTimePreferenceLocale({
    dayOfWeek: tp.dayOfWeek,
    partOfDay: tp.partOfDay,
    raw: tp.raw ?? null,
  });

  if (loc.partOfDay) hints.period = loc.partOfDay;

  // Day-of-week — normalize to the 3-letter form the executor uses.
  if (loc.dayOfWeek) {
    const short = FULL_DAY_TO_SHORT[loc.dayOfWeek.toLowerCase()];
    if (short) hints.days = [short];
  }

  // EXACT-HOUR recovery. The AI's timePreference has no hour field (only
  // partOfDay), so "tomorrow at 5" arrives as partOfDay only — the specific
  // time is lost. Recover it from `raw` using the deterministic extractor
  // (which correctly reads "at 5" → 17:00). This is what lets the chat answer
  // a specific-time request ("is 5pm open?") instead of a vague afternoon list.
  if (tp.raw) {
    const rawHints = extractTimeHints(tp.raw);
    if (rawHints.hour24 !== null) {
      hints.hour24 = rawHints.hour24;
      hints.timeFlexibility = rawHints.timeFlexibility;
    }
    // Recover the DAY anchor from raw too, when the AI dropped it. The model
    // sometimes returns dayOfWeek=null / no concrete day for phrases like
    // "tomorrow at 130" (it only set partOfDay). Without this the time is known
    // but the day isn't, so ranking falls back to the soonest day (wrong AM
    // slots). Only fill what the structured fields didn't already provide.
    if (hints.days.length === 0 && rawHints.days.length > 0) {
      hints.days = rawHints.days;
    }
    if (!hints.dateKey && rawHints.dateKey) hints.dateKey = rawHints.dateKey;
    if (!hints.relative && rawHints.relative) hints.relative = rawHints.relative;
    if (hints.weekShift === null && rawHints.weekShift !== null) {
      hints.weekShift = rawHints.weekShift;
    }
  }

  switch (tp.type) {
    case "next_week":
      hints.weekShift = 1;
      hints.relative = "next-week";
      break;
    case "this_week":
      hints.weekShift = 0;
      hints.relative = "this-week";
      break;
    case "week_after":
      hints.weekShift = 2;
      hints.relative = "week-after";
      break;
    case "tomorrow":
      hints.relative = "tomorrow";
      break;
    case "today":
      hints.relative = "today";
      break;
    case "weekend":
      // Sat + Sun unless the model already pinned a specific day.
      if (hints.days.length === 0) hints.days = ["Sat", "Sun"];
      break;
    case "soonest":
      hints.prefersSoonest = true;
      break;
    case "specific_date":
      if (tp.date && isValidFutureIshDate(tp.date)) {
        hints.dateKey = tp.date;
      }
      break;
    case "specific_day":
      // dayOfWeek already converted into hints.days above. Nothing more.
      break;
    case "part_of_day_only":
      // partOfDay already set above. Nothing more.
      break;
    case null:
      break;
  }

  // "next week" recovery: a model may set type="specific_day" for "다음주 화요일"
  // / "下周二" / "next week Tuesday" without encoding the week shift. If the raw
  // phrase clearly means next week and no shift was set, apply it — so the
  // requested day resolves to NEXT week's occurrence, not this week's.
  if (loc.nextWeek && hints.weekShift === null) {
    hints.weekShift = 1;
    hints.relative = "next-week";
  }

  return hints;
}

/**
 * Cheap sanity check on dates the model emits. yyyy-mm-dd, calendar-valid,
 * not absurdly far in the past or future. Real availability checking is the
 * booking flow's job — we just guard against junk.
 */
function isValidFutureIshDate(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T12:00:00`);
  if (Number.isNaN(d.getTime())) return false;
  const now = Date.now();
  const min = now - 14 * 24 * 60 * 60 * 1000;
  const max = now + 365 * 24 * 60 * 60 * 1000;
  return d.getTime() >= min && d.getTime() <= max;
}

/**
 * Walk the validated AI service-id list against the live catalog and pick
 * the IntentTag of the first matching service. Lets us populate a `book`
 * intent's tags without asking the model to invent a taxonomy.
 */
function serviceIdsToIntentTags(ids: string[]): IntentTag[] {
  const tags: IntentTag[] = [];
  for (const id of ids) {
    const svc = SERVICES.find((s) => s.id === id);
    if (!svc) continue;
    const cat = svc.category;
    // Only categories that exist as IntentTag values map cleanly. The
    // booking executor doesn't have intent tags for Manicure/Pedicure/Other
    // yet (those businesses use a different chat surface), so they're
    // dropped here.
    if (
      (cat === "Haircut" ||
        cat === "Color" ||
        cat === "Perm" ||
        cat === "Treatment") &&
      !tags.includes(cat)
    ) {
      tags.push(cat);
    }
  }
  return tags;
}

/**
 * Build an `Intent` from a /api/chat AI envelope. Returns null when the
 * envelope is too sparse to act on (no service ids and no actionable
 * question). Caller falls back to the deterministic parser in that case.
 *
 * Important: this function NEVER books, cancels, or modifies anything.
 * It just translates the AI's reading of the message into the
 * deterministic executor's intent vocabulary.
 */
type AIEnvelopeForConversion = {
  intent:
    | "faq"
    | "service_guidance"
    | "consultation"
    | "booking"
    | "handoff"
    | "unsupported"
    | "unknown";
  recommendedServiceIds: string[];
  timePreference?: {
    raw: string;
    type:
      | "specific_day"
      | "specific_date"
      | "this_week"
      | "next_week"
      | "week_after"
      | "weekend"
      | "tomorrow"
      | "today"
      | "soonest"
      | "part_of_day_only"
      | null;
    dayOfWeek: string | null;
    date: string | null;
    partOfDay: "morning" | "afternoon" | "evening" | null;
  } | null;
  peopleCount?: number;
  multiServiceRequest?: boolean;
  questionType?: "price" | "duration" | "hours" | "location" | "other" | null;
};

function aiEnvelopeToIntent(
  env: AIEnvelopeForConversion,
  rawText: string
): Intent | null {
  // Group bookings — the executor doesn't handle them. Caller handles handoff.
  if ((env.peopleCount ?? 1) > 1) return null;

  // FAQ → info_query when the question is a billable fact we can answer
  // deterministically (price/duration). Other FAQs stay AI-text-only.
  if (env.intent === "faq") {
    if (env.questionType === "price" || env.questionType === "duration") {
      return {
        kind: "info_query",
        rawText,
        asks: [env.questionType],
      };
    }
    return null;
  }

  // CONSULTATION — an advice/comparison question ("what's the difference",
  // "which should I get", "can you do this style"). The AI already wrote the
  // ANSWER in env.reply; return null so the caller RENDERS that answer instead
  // of collapsing it into a booking action. This is the core "answer first,
  // book second" fix — the prior behavior discarded the answer and jumped to
  // time-selection, which read as ignoring the question (a trust break).
  if (env.intent === "consultation") {
    return null;
  }

  // Multi-service GUIDANCE (browsing, not committing) — e.g. a category
  // question like "do you offer treatment?" where several distinct services
  // match (Head Spa, Keratin, Milbon). Return null so the caller renders the
  // AI's enumerated reply ("we offer X, Y, Z — which one?") instead of
  // collapsing to a single deterministic booking and losing the list.
  // A direct "booking" intent (a commitment) still converts below.
  if (
    env.intent === "service_guidance" &&
    (env.recommendedServiceIds?.length ?? 0) > 1
  ) {
    return null;
  }

  // Booking / single-service guidance — reduce to a `book` intent that the
  // existing handleBookOrSwitch flow turns into a recommendation + time
  // selection. service_guidance with no tags falls through to unknown so
  // the chat asks a follow-up rather than guessing.
  if (env.intent === "booking" || env.intent === "service_guidance") {
    const tags = serviceIdsToIntentTags(env.recommendedServiceIds);
    if (tags.length === 0) return null;

    const hints = aiTimePrefToHints(env.timePreference ?? null);
    const isMulti = env.multiServiceRequest === true && tags.length > 1;

    if (isMulti) {
      return {
        kind: "add_services",
        rawText,
        mode: "fresh",
        tags,
        lengthHint: null,
        permStyle: null,
        colorDirection: null,
        timeHints: hints,
        comboServiceId: null,
      };
    }

    return {
      kind: "book",
      rawText,
      tags,
      lengthHint: null,
      permStyle: null,
      colorDirection: null,
      timeHints: hints,
      // We don't trust AI to pin a specific Square service id; the
      // deterministic recommender re-picks from tags + grounded prefs.
      confidence: "high",
      comboServiceId: null,
    };
  }

  return null;
}

/**
 * Format a 24h decimal hour to a casual display ("3pm", "10:30am", "noon").
 * Used inside assistant copy so it reads naturally in mid-sentence.
 */
function formatHour(hour24: number): string {
  if (hour24 === 12) return "noon";
  if (hour24 === 0) return "midnight";
  const isPM = hour24 >= 12;
  const h12 = hour24 % 12 === 0 ? 12 : Math.floor(hour24 % 12);
  const minutes = Math.round((hour24 - Math.floor(hour24)) * 60);
  if (minutes === 0) return `${h12}${isPM ? "pm" : "am"}`;
  return `${h12}:${minutes.toString().padStart(2, "0")}${isPM ? "pm" : "am"}`;
}

/**
 * Build the recommendation-first presentation for an availability turn.
 *
 * Takes the full contextually-relevant slot set plus the requested time hints
 * and the service, and returns {intro, recommended, seeAllLabel}:
 *   - recommended: 3–6 slots, "closest-to-requested-time then spread" within the
 *     anchor day, so the lead options feel intentional but still show range.
 *   - intro: a short, human lead-in derived from the service + what they asked.
 *   - seeAllLabel: the expand affordance label (e.g. "See all Tuesday times"),
 *     or null when the recommendations already are everything.
 *
 * Pure + provider-agnostic. Reuses rankTimeSlots (the existing context ranker).
 */
const MAX_RECOMMENDED = 6;

type RecoResult = {
  intro: string | null;
  recommended: TimeSlot[];
  seeAllLabel: string | null;
  // Specific-time mode: set when the user pinned an exact hour ("tomorrow at
  // 5"). Drives a yes/no-style answer instead of a range grid.
  //   exactStatus "hit"  → that exact time is open (offer to book it).
  //   exactStatus "near" → not open; `recommended` are the closest times.
  exactStatus?: "hit" | "near";
  exactSlot?: TimeSlot | null; // the matched slot when status is "hit"
};

function buildRecommendation(
  allSlots: TimeSlot[],
  hints: TimeHints,
  serviceName: string
): RecoResult {
  if (allSlots.length === 0) {
    return { intro: null, recommended: [], seeAllLabel: null };
  }

  // Anchor day: the first slot's day after ranking by the requested hints.
  // rankTimeSlots already weights requested day + period + hour, so its top
  // result is the best day to lead with.
  const ranked = rankTimeSlots(allSlots, hints);
  const anchorKey = ranked[0]?.dateKey ?? allSlots[0].dateKey;
  const anchorSlots = ranked.filter((s) => s.dateKey === anchorKey);

  // ── SPECIFIC-TIME branch ────────────────────────────────────────────────
  // The user pinned an exact hour ("tomorrow at 5"). Answer the yes/no question
  // directly rather than dumping a range. Look on the anchor day for that hour.
  if (hints.hour24 !== null && hints.timeFlexibility === "exact") {
    const asked = hints.hour24;
    const dayName = anchorSlots[0]?.dayLabel
      ? DAY_FULL_FROM_SHORT[anchorSlots[0].dayLabel] ?? anchorSlots[0].dayLabel
      : null;
    const askedLabel = formatHour(asked).toUpperCase().replace("PM", " PM").replace("AM", " AM");
    // Exact hit (within 15 min)?
    const exact = anchorSlots.find((s) => Math.abs(s.hour24 - asked) <= 0.25);
    if (exact) {
      return {
        intro: `Yes — ${exact.timeLabel}${dayName ? ` ${dayName}` : ""} is open 💛 Want me to grab it?`,
        recommended: [exact],
        seeAllLabel: anchorSlots.length > 1 ? `See all ${dayName ?? "that day's"} times` : null,
        exactStatus: "hit",
        exactSlot: exact,
      };
    }
    // No exact hit — offer the closest times on the anchor day.
    const closest = [...anchorSlots]
      .sort((a, b) => Math.abs(a.hour24 - asked) - Math.abs(b.hour24 - asked))
      .slice(0, Math.min(4, anchorSlots.length))
      .sort((a, b) => a.hour24 - b.hour24);
    if (closest.length > 0) {
      return {
        intro: `${askedLabel}${dayName ? ` ${dayName}` : ""} isn't open, but I've got these close by 💛`,
        recommended: closest,
        seeAllLabel: anchorSlots.length > closest.length ? `See all ${dayName ?? "that day's"} times` : null,
        exactStatus: "near",
        exactSlot: null,
      };
    }
    // Anchor day has nothing at all → fall through to the range logic below
    // (which will surface the nearest open day).
  }

  // "Closest then spread" within the anchor day:
  //   - lead with the slots nearest the requested hour/period (already ordered
  //     by rankTimeSlots), then
  //   - if room remains, add a spread pick from later in the day for range.
  const sortedByTime = [...anchorSlots].sort((a, b) => a.hour24 - b.hour24);
  const lead = anchorSlots.slice(0, Math.min(3, anchorSlots.length));
  const recommended: TimeSlot[] = [...lead];
  if (recommended.length < MAX_RECOMMENDED) {
    for (const s of sortedByTime) {
      if (recommended.length >= MAX_RECOMMENDED) break;
      if (!recommended.find((r) => r.id === s.id)) recommended.push(s);
    }
  }
  // Keep the final shown set in chronological order so it reads naturally.
  recommended.sort((a, b) => a.hour24 - b.hour24);

  // Intro copy — context-aware. Mention the day if we have one; period if asked.
  const dayLabel = ranked[0]?.dayLabel;
  const periodWord =
    hints.period === "morning" ? "morning" :
    hints.period === "afternoon" ? "afternoon" :
    hints.period === "evening" ? "evening" : null;
  const whenBits: string[] = [];
  if (dayLabel) whenBits.push(DAY_FULL_FROM_SHORT[dayLabel] ?? dayLabel);
  if (periodWord) whenBits.push(periodWord);
  const whenPhrase = whenBits.length > 0 ? ` ${whenBits.join(" ")}` : "";
  const intro = `Found a few good times for your ${serviceName}${whenPhrase} 💛`;

  // Expansion: only offer if there are more slots than we're recommending
  // (either more on the anchor day, or slots on other days).
  const moreOnDay = anchorSlots.length > recommended.length;
  const moreOtherDays = allSlots.length > anchorSlots.length;
  const seeAllLabel =
    moreOnDay || moreOtherDays
      ? dayLabel && !moreOtherDays
        ? `See all ${DAY_FULL_FROM_SHORT[dayLabel] ?? dayLabel} times`
        : "See all times"
      : null;

  return { intro, recommended, seeAllLabel };
}

const DAY_FULL_FROM_SHORT: Record<string, string> = {
  Sun: "Sunday", Mon: "Monday", Tue: "Tuesday", Wed: "Wednesday",
  Thu: "Thursday", Fri: "Friday", Sat: "Saturday",
};

/**
 * Group slots for the expanded "See all" view: Date → {Morning, Afternoon,
 * Evening} → times. The date lives in the section header (once), so the cards
 * themselves show only the time — no per-card date eyebrow, no mobile
 * truncation, faster scanning. Empty part-of-day buckets are dropped.
 */
type PartBucket = { label: "Morning" | "Afternoon" | "Evening"; slots: TimeSlot[] };
type DateGroup = { dateKey: string; dayLabel: string; dateLabel: string; buckets: PartBucket[] };

function groupSlotsByDateAndPart(slots: TimeSlot[]): DateGroup[] {
  const byDate = new Map<string, TimeSlot[]>();
  for (const s of slots) {
    const arr = byDate.get(s.dateKey) ?? [];
    arr.push(s);
    byDate.set(s.dateKey, arr);
  }
  const dateKeys = Array.from(byDate.keys()).sort();
  const groups: DateGroup[] = [];
  for (const dateKey of dateKeys) {
    const daySlots = (byDate.get(dateKey) ?? []).sort((a, b) => a.hour24 - b.hour24);
    const morning = daySlots.filter((s) => s.hour24 < 12);
    const afternoon = daySlots.filter((s) => s.hour24 >= 12 && s.hour24 < 17);
    const evening = daySlots.filter((s) => s.hour24 >= 17);
    const buckets: PartBucket[] = [];
    if (morning.length) buckets.push({ label: "Morning", slots: morning });
    if (afternoon.length) buckets.push({ label: "Afternoon", slots: afternoon });
    if (evening.length) buckets.push({ label: "Evening", slots: evening });
    const first = daySlots[0];
    groups.push({
      dateKey,
      dayLabel: DAY_FULL_FROM_SHORT[first.dayLabel] ?? first.dayLabel,
      dateLabel: first.dateLabel,
      buckets,
    });
  }
  return groups;
}

/**
 * Given a slot's dateKey, figure out which week-shift it falls in (0/1/2)
 * relative to MOCK_TODAY. Anything past week-shift 2 returns null.
 */
function deriveWeekShift(dateKey: string): number | null {
  // Mon May 4 = week 0 start. Must match getWeekRange in parser.
  const ranges = [
    { start: "2026-05-04", end: "2026-05-10", shift: 0 },
    { start: "2026-05-11", end: "2026-05-17", shift: 1 },
    { start: "2026-05-18", end: "2026-05-24", shift: 2 },
  ];
  for (const r of ranges) {
    if (dateKey >= r.start && dateKey <= r.end) return r.shift;
  }
  return null;
}

/**
 * Decide which navigation chips should render below a slot grid. The brief
 * called for hiding chips that wouldn't return anything — this prevents the
 * user from tapping "Earlier that day" only to be told there's nothing.
 *
 * Approach: derive availability from the full service slot list against the
 * current display state. Cheap to compute once per turn.
 */
function computeChipAvailability(
  allServiceSlots: TimeSlot[],
  anchorDateKey: string | null,
  currentWeekShift: number | null,
  displayedSlots: TimeSlot[]
): Record<NavChipKey, boolean> {
  // Day-relative chips need an anchor day
  let earlierDay = false;
  let laterDay = false;
  let nextDay = false;

  if (anchorDateKey) {
    const anchorSlots = allServiceSlots.filter(
      (s) => s.dateKey === anchorDateKey
    );
    // Pivot is the lowest/highest hour shown. If displayedSlots has slots on
    // the anchor day, use those; otherwise use any anchor-day slot.
    const onAnchor = displayedSlots.filter(
      (s) => s.dateKey === anchorDateKey
    );
    if (onAnchor.length > 0 && anchorSlots.length > 0) {
      const minShown = Math.min(...onAnchor.map((s) => s.hour24));
      const maxShown = Math.max(...onAnchor.map((s) => s.hour24));
      earlierDay = anchorSlots.some((s) => s.hour24 < minShown);
      laterDay = anchorSlots.some((s) => s.hour24 > maxShown);
    }
    // Next day chip: any slot strictly after the anchor day
    nextDay = allServiceSlots.some((s) => s.dateKey > anchorDateKey);
  }

  // Week chips — hide the current week, show others when they have data
  const weekHas = (shift: number) => {
    const ranges = [
      { start: "2026-05-04", end: "2026-05-10" },
      { start: "2026-05-11", end: "2026-05-17" },
      { start: "2026-05-18", end: "2026-05-24" },
    ];
    const r = ranges[shift];
    if (!r) return false;
    return allServiceSlots.some(
      (s) => s.dateKey >= r.start && s.dateKey <= r.end
    );
  };

  return {
    "earlier-day": earlierDay,
    "later-day": laterDay,
    "next-day": nextDay,
    "this-week": currentWeekShift !== 0 && weekHas(0),
    "next-week": currentWeekShift !== 1 && weekHas(1),
    "week-after": currentWeekShift !== 2 && weekHas(2),
    "pick-date": true, // always offered as honest prototype affordance
    "see-all": allServiceSlots.length > displayedSlots.length,
  };
}

/* -------------------------------------------------------------------------- */
/* Home view                                                                   */
/* -------------------------------------------------------------------------- */

type HomeProps = {
  assistantRef: React.MutableRefObject<HTMLDivElement | null>;
  turns: AssistantTurn[];
  chipsLocked: boolean;
  onPromptChip: (preset: string) => void;
  onTextSubmit: (input: string) => void;
  onClarifyTap: (turnId: string, opt: { label: string; key: string }) => void;
  onBookThis: (turnId: string) => void;
  onShowAlternates: (turnId: string) => void;
  onAlternatePick: (svc: Service) => void;
  onSlotPick: (slot: TimeSlot) => void;
  onNavChip: (chipKey: NavChipKey, anchorDateKey: string | null, weekShift: number | null) => void;
  onConsultationCta: () => void;
  onCustomCta: () => void;
  onBrowseAllCta: () => void;
  onResetConversation: () => void;
  onChangeService: () => void;
  serviceLocked: boolean;
  conversationStarted: boolean;
  mode: ManageMode;
  onModePick: (picked: Exclude<ManageMode, null>) => void;
  onAppointmentPick: (turnId: string, appt: Appointment) => void;
  onManageChip: (turnId: string, key: ManageChipKey) => void;
  onSubmitHandoff: (
    turnId: string,
    data: {
      clientName: string;
      clientPhone: string;
      clientEmail: string;
      summary: string;
      sourceMessage: string;
    }
  ) => Promise<boolean>;
  /** Opens an empty handoff turn from the "Need Shen directly?" link. */
  onOpenHandoff: () => void;
  stylistName: string;
  stylistLocation: string;
  stylistInitials: string;
};

function HomeView(props: HomeProps) {
  return (
    <div className="animate-fade-up">
      {/* Hero — always visible, same on all sizes. Simple and stable. */}
      <div className="mb-8 flex flex-col items-center text-center">
        <div className="flex h-16 w-16 items-center justify-center rounded-full bg-accent-soft font-display text-2xl font-medium text-accent-dark">
          {props.stylistInitials}
        </div>
        <h1 className="mt-4 font-display text-[32px] font-medium leading-tight tracking-tight text-ink-900 sm:text-[34px]">
          Book with {props.stylistName}
        </h1>
        <p className="mt-2 text-[15px] text-ink-500">
          Find a time in under 30 seconds.
        </p>
      </div>

      <section ref={props.assistantRef}>
        <AssistantBlock {...props} />
      </section>

      <p className="mt-8 text-center text-xs text-ink-400">
        {props.stylistLocation}
      </p>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Entry screen — the first thing a client sees. Confident clients can fast-  */
/* book without engaging the chat. The "Help me choose" card and the text    */
/* input both open the assistant (assistantOpen=true), at which point the    */
/* existing HomeView / MobileChatShell renders instead.                       */
/* -------------------------------------------------------------------------- */

type EntryGroupedServices = { category: string; services: Service[] }[];

type EntryScreenProps = {
  stylistName: string;
  popularServices: Service[];
  // When the parser produces a confident single recommendation for the user's
  // intent input, the parent passes it in here and we render the inline card
  // in place of (most of) the page. When null, the normal entry screen shows.
  recommendation: { userText: string; rec: Recommendation } | null;
  // Up to 3 same-category alternates surfaced under the recommendation card.
  recommendationAlternates: Service[];
  // True when the recommendation's category has more services than the 3
  // shown — used to toggle the "Show all [category]" link.
  recommendationHasMoreInCategory: boolean;
  onSubmitIntent: (text: string) => void;
  onOpenAssistant: (prefilledMessage?: string) => void;
  onAcceptRecommendation: () => void;
  onAcceptAlternate: (svc: Service) => void;
  onShowAllInRecommendationCategory: () => void;
  onDismissRecommendation: () => void;
  onRefineRecommendation: () => void;
  onAddAnotherToRecommendation: (svc: Service) => void;
  onServicePick: (svc: Service) => void;
  // Service-shorthand chip tap. Routes to the top-ranked service in the
  // given category for a guaranteed confident recommendation, bypassing
  // the NLU's clarification step (e.g. "color" would otherwise ask
  // root-touch-up vs full-color).
  onCategoryShortcut: (
    category: "Haircut" | "Color" | "Perm" | "Treatment"
  ) => void;
  onBrowseAll: () => void;
  onManageTap: () => void;
  onUsualTap: () => void;
};

// Service-shorthand chips. These are the most likely things a client will
// actually book — not example phrases for the assistant. Each chip routes
// to the most popular service in that category via onCategoryShortcut.
const SHORTCUT_CHIPS: ("Haircut" | "Color" | "Perm" | "Treatment")[] = [
  "Haircut",
  "Color",
  "Perm",
  "Treatment",
];

function EntryScreen(props: EntryScreenProps) {
  const {
    stylistName,
    popularServices,
    recommendation,
    recommendationAlternates,
    recommendationHasMoreInCategory,
    onSubmitIntent,
    onOpenAssistant,
    onAcceptRecommendation,
    onAcceptAlternate,
    onShowAllInRecommendationCategory,
    onDismissRecommendation,
    onRefineRecommendation,
    onAddAnotherToRecommendation,
    onServicePick,
    onCategoryShortcut,
    onBrowseAll,
    onManageTap,
    onUsualTap,
  } = props;

  const [input, setInput] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  // Grow the textarea vertically with the content, capped at ~120px (about
  // 5 lines) so the input never dominates the screen. Same pattern used by
  // the assistant composer in MobileChatShell / AssistantBlock. Empty input
  // resets to natural height so the field is single-line by default.
  function autoGrow() {
    const el = textareaRef.current;
    if (!el) return;
    if (!el.value) {
      el.style.height = "";
      return;
    }
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 120)}px`;
  }

  useEffect(() => {
    autoGrow();
  }, [input]);

  function submitIntent() {
    const trimmed = input.trim();
    if (!trimmed) {
      onOpenAssistant();
      return;
    }
    onSubmitIntent(trimmed);
    setInput("");
    // Reset height after clearing so the textarea snaps back to single-line.
    requestAnimationFrame(() => {
      if (textareaRef.current) textareaRef.current.style.height = "";
    });
  }

  return (
    <div className="animate-fade-up">
      {/* Bare entry state: page title + intent input + chips. When a
          recommendation is showing, this is replaced by BackBar + card
          (same pattern as TimeStage / DetailsStage / etc.). The stylist
          profile / location is intentionally absent — clients arriving at
          a stylist's booking link already know who the stylist is. The
          location surfaces in ConfirmedStage where it's actually useful. */}
      {recommendation ? (
        <section className="mx-auto max-w-md">
          <BackBar onBack={onDismissRecommendation} />
          <InlineRecommendationCard
            userText={recommendation.userText}
            rec={recommendation.rec}
            stylistName={stylistName}
            onAccept={onAcceptRecommendation}
            onRefine={onRefineRecommendation}
            onAddAnother={onAddAnotherToRecommendation}
            onBrowseAll={onBrowseAll}
          />
        </section>
      ) : (
        <section className="text-center">
          <h1 className="font-display text-[26px] font-medium leading-tight tracking-tight text-ink-900 sm:text-[30px]">
            Book with {stylistName}
          </h1>
          <p className="mx-auto mt-2 max-w-md text-[14px] text-ink-600">
            What are you looking to do?
          </p>
          <div className="mx-auto mt-5 max-w-md">
            {/* Claude-style composer: textarea on top (full width), action
                row below (send button right-aligned). The footer bar gives
                the input a stable "floor" — text never has to fight the
                button for horizontal space, and the layout doesn't shift
                when the textarea grows. Reserves left-side space for future
                affordances (mic, attachments, etc.) without redesign. */}
            <div className="rounded-2xl border border-ink-200 bg-cream-50 px-3 pt-3 pb-2 text-left focus-within:border-ink-900">
              <textarea
                ref={textareaRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  // Enter submits, Shift+Enter inserts a newline — matches
                  // the assistant chat composer's behavior so the input
                  // feels consistent across the app.
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    submitIntent();
                  }
                }}
                rows={1}
                placeholder="What are you looking to book?"
                maxLength={800}
                className="block w-full resize-none overflow-y-auto bg-transparent px-1 text-[15px] leading-[1.4] text-ink-900 placeholder:text-ink-400 focus:outline-none"
              />
              {/* Action row — the "footer bar" under the text. Right-aligned
                  send button keeps the visual weight at the natural tap
                  zone for a thumb. Space on the left is intentional. */}
              <div className="mt-2 flex items-center justify-end">
                <button
                  type="button"
                  onClick={submitIntent}
                  disabled={input.trim().length === 0}
                  className={cn(
                    "inline-flex h-9 min-w-[36px] items-center justify-center rounded-full px-4 text-[13px] font-medium transition",
                    input.trim().length === 0
                      ? "cursor-not-allowed bg-cream-200 text-ink-400"
                      : "bg-ink-900 text-cream-50 hover:bg-ink-800 active:bg-ink-700"
                  )}
                  aria-label="Send message"
                >
                  Ask {stylistName}
                </button>
              </div>
            </div>

            <div className="mt-4 flex flex-wrap justify-center gap-2">
              {SHORTCUT_CHIPS.map((chip) => (
                <button
                  key={chip}
                  type="button"
                  onClick={() => onCategoryShortcut(chip)}
                  className="min-h-[44px] rounded-full border border-ink-200 bg-cream-50 px-5 py-2 text-[14px] font-medium text-ink-800 transition hover:border-ink-900 hover:text-ink-900 active:bg-cream-100"
                >
                  {chip}
                </button>
              ))}
            </div>
          </div>
        </section>
      )}

      {/* ── 3. Secondary services section.
              • No recommendation: shows "Popular" — top 3 services by rank.
              • Recommendation showing: shows "Other [Category]" — the same
                category's other services (the in-card "Or pick another" is
                gone; these alternates live here where they belong, next
                to the Browse link).
              • Hidden entirely when in recommendation mode AND the category
                has no other online services (per design decision A). */}
      {recommendation ? (
        recommendationAlternates.length > 0 && (
          <section className="mt-8">
            <h2 className="mb-3 text-center text-[11px] uppercase tracking-[0.18em] text-ink-500">
              Other {recommendation.rec.primary.category.toLowerCase()}
            </h2>
            <div className="space-y-2">
              {recommendationAlternates.map((svc) => (
                <button
                  key={svc.id}
                  type="button"
                  onClick={() => onAcceptAlternate(svc)}
                  className="block w-full rounded-2xl border border-ink-200 bg-cream-50 p-4 text-left transition hover:border-ink-900 active:bg-cream-100"
                >
                  <div className="flex items-baseline justify-between gap-3">
                    <p className="font-display text-[15px] font-medium text-ink-900">
                      {svc.name}
                    </p>
                    <p className="shrink-0 text-[14px] text-ink-700">
                      {svc.priceLabel}
                    </p>
                  </div>
                  <p className="mt-1 text-[12px] text-ink-500">
                    {svc.durationLabel}
                  </p>
                </button>
              ))}
            </div>
            {recommendationHasMoreInCategory && (
              <div className="mt-3 text-center">
                <button
                  type="button"
                  onClick={onShowAllInRecommendationCategory}
                  className="min-h-[44px] px-3 py-2 text-[13px] text-ink-500 underline-offset-4 hover:text-ink-900 hover:underline"
                >
                  Show all {recommendation.rec.primary.category.toLowerCase()} →
                </button>
              </div>
            )}
          </section>
        )
      ) : (
        popularServices.length > 0 && (
          <section className="mt-8">
            <h2 className="mb-3 text-center text-[11px] uppercase tracking-[0.18em] text-ink-500">
              Popular
            </h2>
            <div className="space-y-2">
              {popularServices.map((svc) => (
                <button
                  key={svc.id}
                  type="button"
                  onClick={() => onServicePick(svc)}
                  className="block w-full rounded-2xl border border-ink-200 bg-cream-50 p-4 text-left transition hover:border-ink-900 active:bg-cream-100"
                >
                  <div className="flex items-baseline justify-between gap-3">
                    <p className="font-display text-[15px] font-medium text-ink-900">
                      {svc.name}
                    </p>
                    <p className="shrink-0 text-[14px] text-ink-700">
                      {svc.priceLabel}
                    </p>
                  </div>
                  <p className="mt-1 text-[12px] text-ink-500">
                    {svc.durationLabel}
                  </p>
                </button>
              ))}
            </div>
            <div className="mt-3 text-center">
              <button
                type="button"
                onClick={onBrowseAll}
                className="min-h-[44px] px-3 py-2 text-[13px] text-ink-500 underline-offset-4 hover:text-ink-900 hover:underline"
              >
                Browse all services →
              </button>
            </div>
          </section>
        )
      )}

      {/* ── 4. Utility buttons. Hidden entirely when a recommendation is
              showing — the user is in a booking decision moment and these
              are unrelated paths. */}
      {!recommendation && (
        <section className="mt-8 space-y-2">
          <button
            type="button"
            onClick={onUsualTap}
            className="flex w-full min-h-[52px] items-center justify-center gap-2 rounded-2xl border border-ink-200 bg-cream-50 px-4 py-3 text-[15px] font-medium text-ink-900 transition hover:border-ink-900 active:bg-cream-100"
          >
            <RepeatIcon className="h-[18px] w-[18px] text-ink-700" />
            Book your usual
          </button>
          <button
            type="button"
            onClick={onManageTap}
            className="flex w-full min-h-[52px] items-center justify-center gap-2 rounded-2xl border border-ink-200 bg-cream-50 px-4 py-3 text-[15px] font-medium text-ink-900 transition hover:border-ink-900 active:bg-cream-100"
          >
            <CalendarIcon className="h-[18px] w-[18px] text-ink-700" />
            I have a booking
          </button>
        </section>
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Tiny inline icons used by the entry screen. Stays consistent with the      */
/* existing SVG-inline pattern (no icon library).                              */
/* -------------------------------------------------------------------------- */

function RepeatIcon({ className }: { className?: string }) {
  return (
    <svg
      aria-hidden
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <path d="M17 1l4 4-4 4" />
      <path d="M3 11V9a4 4 0 014-4h14" />
      <path d="M7 23l-4-4 4-4" />
      <path d="M21 13v2a4 4 0 01-4 4H3" />
    </svg>
  );
}

function CalendarIcon({ className }: { className?: string }) {
  return (
    <svg
      aria-hidden
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
      <line x1="16" y1="2" x2="16" y2="6" />
      <line x1="8" y1="2" x2="8" y2="6" />
      <line x1="3" y1="10" x2="21" y2="10" />
    </svg>
  );
}

/* -------------------------------------------------------------------------- */
/* Inline recommendation card — rendered on the entry screen when the parser */
/* produces a confident single-service match for the user's intent. Replaces */
/* the prompt+input area; Popular + Footer stay visible below. The "Not     */
/* quite right?" link drops to the chat for multi-turn refinement.          */
/* -------------------------------------------------------------------------- */

function InlineRecommendationCard({
  userText,
  rec,
  stylistName,
  onAccept,
  onRefine,
  onAddAnother,
  onBrowseAll,
}: {
  userText: string;
  rec: Recommendation;
  stylistName: string;
  onAccept: () => void;
  onRefine: () => void;
  // Called when the user picks a service from the "+ Add another service"
  // affordance. Parent merges the service into the recommendation's
  // additionalServices array so the card re-renders with combined totals.
  onAddAnother: (svc: Service) => void;
  // Escape hatch — opens the full BrowseAllServicesStage. For users who
  // want to scan the entire menu instead of riffing on the recommendation.
  onBrowseAll: () => void;
}) {
  const primary = rec.primary;
  const additional = rec.additionalServices ?? [];
  // Parser copy uses "Shen" as the demo default. When a real stylist
  // connects Square, /api/stylist resolves their actual display name —
  // swap it into the parser's reason text so the card reads correctly
  // under any account. Cheap runtime transform; no parser change.
  const reason = (rec.reason ?? "").replace(/\bShen\b/g, stylistName);

  // "+ Add another service" — closed by default. When open, the user
  // first picks a category (only ones not already in the booking), then
  // picks a specific service. Tap a service → onAddAnother is called and
  // the card collapses the picker.
  const [pickerCategory, setPickerCategory] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);

  // Categories already in the booking — primary + each additional. The
  // picker hides these so the user can't double-book the same category.
  const bookedCategories = new Set<string>([
    primary.category,
    ...additional.map((s) => s.category),
  ]);
  const availableCategories = ["Haircut", "Color", "Perm", "Treatment"].filter(
    (c) => !bookedCategories.has(c)
  );

  // Services to show inside the category-picked sub-step. Filter to online,
  // exclude consultation-only.
  const servicesInPickerCategory = pickerCategory
    ? SERVICES.filter(
        (s) => s.category === pickerCategory && s.status === "online"
      )
    : [];

  function closePicker() {
    setPickerOpen(false);
    setPickerCategory(null);
  }

  return (
    <div className="rounded-2xl border border-ink-200 bg-cream-50 p-5">
      <p className="text-[12px] uppercase tracking-[0.14em] text-ink-500">
        You said
      </p>
      <p className="mt-1 text-[14px] italic text-ink-700">
        &ldquo;{userText}&rdquo;
      </p>

      <div className="my-4 h-px bg-ink-100" />

      {additional.length === 0 ? (
        // Single service — keep the simple presentation.
        <>
          <p className="font-display text-[18px] font-medium text-ink-900">
            {primary.name}
          </p>
          <p className="mt-1 text-[13px] text-ink-600">
            {primary.priceLabel}
            <span className="px-1.5 text-ink-300">·</span>
            {primary.durationLabel}
          </p>
        </>
      ) : (
        // Multi-service — render each service as a line item plus a totals
        // row so the client sees the full price and time before tapping
        // Find times. The booking's Square calendar time block matches the
        // combined duration.
        <div className="space-y-2">
          <div className="flex items-baseline justify-between gap-3">
            <p className="font-display text-[16px] font-medium text-ink-900">
              {primary.name}
            </p>
            <p className="shrink-0 text-[13px] text-ink-700">
              {primary.priceLabel}
              <span className="px-1.5 text-ink-300">·</span>
              {primary.durationLabel}
            </p>
          </div>
          {additional.map((s) => (
            <div
              key={s.id}
              className="flex items-baseline justify-between gap-3"
            >
              <p className="font-display text-[16px] font-medium text-ink-900">
                {s.name}
              </p>
              <p className="shrink-0 text-[13px] text-ink-700">
                {s.priceLabel}
                <span className="px-1.5 text-ink-300">·</span>
                {s.durationLabel}
              </p>
            </div>
          ))}
          {(() => {
            const synth = {
              selectedService: primary,
              selectedSlot: null,
              additionalServices: additional,
              bookingNotes: "",
              lastRecommendedService: null,
              lastShownSlots: [],
              lastAnchorDateKey: null,
              lastIntentTags: [],
              lastIntentColorDirection: null,
              lastIntentTimeHints: emptyHints(),
              pendingClarification: null,
              pendingSwitch: null,
              pendingFuzzy: null,
              pendingAdditionalService: null,
            } as AssistantContext;
            const totalPrice = getEstimatedTotalPrice(synth);
            const totalDuration = getEstimatedTotalDuration(synth);
            return (
              <div className="mt-1 flex items-baseline justify-between gap-3 border-t border-ink-100 pt-2">
                <p className="text-[13px] font-medium text-ink-900">
                  Estimated total
                </p>
                <p className="shrink-0 text-[13px] text-ink-700">
                  {totalPrice.label ?? "—"}
                  <span className="px-1.5 text-ink-300">·</span>
                  about {totalDuration.label}
                </p>
              </div>
            );
          })()}
        </div>
      )}

      {reason && (
        <p className="mt-3 text-[13px] leading-snug text-ink-700">{reason}</p>
      )}

      {/* "+ Add another service" affordance — appears between the recommendation
          summary and the Find times CTA. Only renders if at least one category
          isn't already in the booking. Two sub-steps:
          1. Tap to open → category chips (only un-booked categories).
          2. Tap a category → service list for that category.
          3. Tap a service → onAddAnother fires, picker collapses. */}
      {availableCategories.length > 0 && (
        <div className="mt-5">
          {!pickerOpen ? (
            <button
              type="button"
              onClick={() => setPickerOpen(true)}
              className="inline-flex min-h-[40px] items-center gap-1 rounded-full border border-dashed border-ink-300 bg-cream-50 px-4 py-2 text-[13px] font-medium text-ink-700 transition hover:border-ink-900 hover:text-ink-900 active:bg-cream-100"
            >
              <span aria-hidden className="text-base leading-none">+</span>
              Add another service
            </button>
          ) : (
            <div className="rounded-2xl border border-ink-200 bg-cream-100/60 p-3">
              {!pickerCategory ? (
                <>
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <p className="text-[12px] uppercase tracking-[0.14em] text-ink-500">
                      What else?
                    </p>
                    <button
                      type="button"
                      onClick={closePicker}
                      aria-label="Close add picker"
                      className="text-[12px] text-ink-500 hover:text-ink-900"
                    >
                      Cancel
                    </button>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {availableCategories.map((c) => (
                      <button
                        key={c}
                        type="button"
                        onClick={() => setPickerCategory(c)}
                        className="min-h-[36px] rounded-full border border-ink-200 bg-cream-50 px-4 py-2 text-[13px] font-medium text-ink-800 transition hover:border-ink-900 active:bg-cream-100"
                      >
                        {c}
                      </button>
                    ))}
                  </div>
                </>
              ) : (
                <>
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <button
                      type="button"
                      onClick={() => setPickerCategory(null)}
                      className="text-[12px] text-ink-500 hover:text-ink-900"
                    >
                      ← Back
                    </button>
                    <button
                      type="button"
                      onClick={closePicker}
                      aria-label="Close add picker"
                      className="text-[12px] text-ink-500 hover:text-ink-900"
                    >
                      Cancel
                    </button>
                  </div>
                  <div className="space-y-2">
                    {servicesInPickerCategory.map((svc) => (
                      <button
                        key={svc.id}
                        type="button"
                        onClick={() => {
                          onAddAnother(svc);
                          closePicker();
                        }}
                        className="block w-full rounded-xl border border-ink-200 bg-cream-50 p-3 text-left transition hover:border-ink-900 active:bg-cream-100"
                      >
                        <div className="flex items-baseline justify-between gap-3">
                          <p className="font-display text-[14px] font-medium text-ink-900">
                            {svc.name}
                          </p>
                          <p className="shrink-0 text-[13px] text-ink-700">
                            {svc.priceLabel}
                          </p>
                        </div>
                        <p className="mt-0.5 text-[11px] text-ink-500">
                          {svc.durationLabel}
                        </p>
                      </button>
                    ))}
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      )}

      <button
        type="button"
        onClick={onAccept}
        className="mt-5 w-full min-h-[48px] rounded-full bg-ink-900 px-6 py-3 text-[15px] font-medium text-cream-50 transition hover:bg-ink-800 active:bg-ink-700"
      >
        Find times
      </button>

      <div className="mt-3 flex flex-col items-center gap-1 text-center">
        <button
          type="button"
          onClick={onRefine}
          className="min-h-[40px] px-3 py-2 text-[13px] text-ink-500 underline-offset-4 hover:text-ink-900 hover:underline"
        >
          Not quite right? Ask {stylistName}
        </button>
        <button
          type="button"
          onClick={onBrowseAll}
          className="min-h-[40px] px-3 py-2 text-[13px] text-ink-500 underline-offset-4 hover:text-ink-900 hover:underline"
        >
          Browse all services →
        </button>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Browse all services — full grouped catalog. Reached via the entry         */
/* screen's "Browse all services" link for clients who want to scan the     */
/* full menu. Not the default path.                                          */
/* -------------------------------------------------------------------------- */

function BrowseAllServicesStage({
  groupedServices,
  initialCategory,
  onPick,
  onBack,
}: {
  groupedServices: EntryGroupedServices;
  // When set, the page opens with this category filter applied so the user
  // lands on the category that triggered "Show all" — no scroll-hunting.
  // A "All" tab is always available to widen back out.
  initialCategory?: string | null;
  onPick: (svc: Service) => void;
  onBack: () => void;
}) {
  const categories = groupedServices.map((g) => g.category);
  // Default to the requested filter if it exists in the data; otherwise "All".
  const startFilter =
    initialCategory && categories.includes(initialCategory)
      ? initialCategory
      : null;
  const [activeFilter, setActiveFilter] = useState<string | null>(startFilter);

  const empty = groupedServices.length === 0;
  const visibleGroups = activeFilter
    ? groupedServices.filter((g) => g.category === activeFilter)
    : groupedServices;

  return (
    <div className="animate-fade-up">
      <BackBar onBack={onBack} />
      <h1 className="mt-2 font-display text-2xl font-medium tracking-tight text-ink-900">
        {activeFilter ?? "All services"}
      </h1>
      {empty ? (
        <p className="mt-3 rounded-2xl border border-ink-100 bg-cream-100/60 p-4 text-sm text-ink-600">
          This stylist isn&apos;t accepting bookings yet.
        </p>
      ) : (
        <>
          {categories.length > 1 && (
            <div className="mt-4 flex flex-wrap gap-2" role="tablist">
              <button
                type="button"
                role="tab"
                aria-selected={activeFilter === null}
                onClick={() => setActiveFilter(null)}
                className={cn(
                  "min-h-[36px] rounded-full border px-3 py-1.5 text-[13px] font-medium transition",
                  activeFilter === null
                    ? "border-ink-900 bg-ink-900 text-cream-50"
                    : "border-ink-200 bg-cream-50 text-ink-700 hover:border-ink-400"
                )}
              >
                All
              </button>
              {categories.map((c) => (
                <button
                  key={c}
                  type="button"
                  role="tab"
                  aria-selected={activeFilter === c}
                  onClick={() => setActiveFilter(c)}
                  className={cn(
                    "min-h-[36px] rounded-full border px-3 py-1.5 text-[13px] font-medium transition",
                    activeFilter === c
                      ? "border-ink-900 bg-ink-900 text-cream-50"
                      : "border-ink-200 bg-cream-50 text-ink-700 hover:border-ink-400"
                  )}
                >
                  {c}
                </button>
              ))}
            </div>
          )}
          <div className="mt-6 space-y-5">
            {visibleGroups.map((group) => (
              <div key={group.category}>
                {!activeFilter && (
                  <p className="mb-2 text-[12px] font-medium text-ink-500">
                    {group.category}
                  </p>
                )}
                <div className="space-y-2">
                  {group.services.map((svc) => (
                    <button
                      key={svc.id}
                      type="button"
                      onClick={() => onPick(svc)}
                      className="block w-full rounded-2xl border border-ink-200 bg-cream-50 p-4 text-left transition hover:border-ink-900 active:bg-cream-100"
                    >
                      <div className="flex items-baseline justify-between gap-3">
                        <p className="font-display text-[15px] font-medium text-ink-900">
                          {svc.name}
                        </p>
                        <p className="shrink-0 text-[14px] text-ink-700">
                          {svc.priceLabel}
                        </p>
                      </div>
                      <p className="mt-1 text-[12px] text-ink-500">
                        {svc.durationLabel}
                      </p>
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Manage appointment lookup — phone → list → reschedule/cancel.               */
/*                                                                             */
/* The booking ID is never shown to the client. Cancel requires inline last-4 */
/* verification, which calls the server-side verify endpoint before issuing   */
/* the cancel (the cancel endpoint also re-verifies — defense in depth).      */
/* -------------------------------------------------------------------------- */

type LookupRow = Appointment & { cancelled?: boolean };

function ManageLookupStage({
  onBack,
  onReschedule,
}: {
  onBack: () => void;
  onReschedule: (appt: Appointment) => void;
}) {
  const [phone, setPhone] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [results, setResults] = useState<LookupRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Per-row cancel state machine:
  //   idle      — no cancel in progress
  //   verify    — last-4 input visible, server hasn't accepted it yet
  //   review    — last-4 verified, showing "Yes, cancel / Keep it" card
  //                before the destructive API call fires
  // The cancel API only fires from `review` after explicit confirmation.
  type CancelStep = "verify" | "review";
  const [cancelTargetId, setCancelTargetId] = useState<string | null>(null);
  const [cancelStep, setCancelStep] = useState<CancelStep>("verify");
  const [last4, setLast4] = useState("");
  // Holds the digits that successfully passed /api/bookings/verify so we can
  // pass them to /api/bookings/cancel from the review step. Never displayed.
  const [verifiedLast4, setVerifiedLast4] = useState<string>("");
  const [cancelError, setCancelError] = useState<string | null>(null);
  const [verifying, setVerifying] = useState(false);
  const [cancelling, setCancelling] = useState(false);

  function resetCancelFlow() {
    setCancelTargetId(null);
    setCancelStep("verify");
    setLast4("");
    setVerifiedLast4("");
    setCancelError(null);
  }

  async function runLookup() {
    const digits = extractPhoneDigits(phone) ?? phone.replace(/\D/g, "");
    if (digits.length < 7) {
      setError("Enter the full phone number you used to book.");
      return;
    }
    setError(null);
    setSubmitting(true);
    try {
      const res = await fetch(
        `/api/bookings/lookup?phone=${encodeURIComponent(digits)}`
      );
      const data = await res.json();
      const appts: Appointment[] = data?.appointments ?? [];
      setResults(appts.map((a) => ({ ...a })));
    } catch {
      setError("Couldn't reach the server. Try again in a moment.");
    } finally {
      setSubmitting(false);
    }
  }

  // Step 1 of cancel: verify the last-4. On success, transition to the
  // review step. The cancel API is NOT fired here — only in finalizeCancel.
  async function verifyAndShowReview(appt: LookupRow) {
    const clean = last4.replace(/\D/g, "").slice(-4);
    if (clean.length !== 4) {
      setCancelError("Enter the last 4 digits of your phone number.");
      return;
    }
    setCancelError(null);
    setVerifying(true);
    try {
      const verifyRes = await fetch("/api/bookings/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bookingId: appt.id, last4: clean }),
      });
      const verifyData = await verifyRes.json();
      if (!verifyData?.ok) {
        setCancelError("Couldn't verify — check the digits and try again.");
        setVerifying(false);
        return;
      }
      setVerifiedLast4(clean);
      setCancelStep("review");
    } catch {
      setCancelError("Couldn't reach the server. Try again.");
    } finally {
      setVerifying(false);
    }
  }

  // Step 2 of cancel: confirm the destructive action. This is the only
  // place that calls /api/bookings/cancel. last4 has already been verified.
  async function finalizeCancel(appt: LookupRow) {
    if (!verifiedLast4) {
      // Defensive: should never happen since the review step only renders
      // after a successful verify. Snap back to verify just in case.
      setCancelStep("verify");
      return;
    }
    setCancelError(null);
    setCancelling(true);
    try {
      const cancelRes = await fetch("/api/bookings/cancel", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bookingId: appt.id, last4: verifiedLast4 }),
      });
      if (!cancelRes.ok) {
        setCancelError("Something went wrong on our end. Try again.");
        setCancelling(false);
        return;
      }
      setResults((prev) =>
        (prev ?? []).map((r) => (r.id === appt.id ? { ...r, cancelled: true } : r))
      );
      resetCancelFlow();
      track("cancel_completed", { serviceId: appt.serviceId });
    } catch {
      setCancelError("Couldn't reach the server. Try again.");
    } finally {
      setCancelling(false);
    }
  }

  return (
    <div className="animate-fade-up">
      <BackBar onBack={onBack} />
      <h1 className="mt-2 font-display text-2xl font-medium tracking-tight text-ink-900">
        Manage your appointment
      </h1>
      <p className="mt-1 text-sm text-ink-500">
        Look up your bookings to reschedule or cancel.
      </p>

      <div className="mt-6 space-y-3">
        <Field label="Phone number" required>
          <input
            type="tel"
            inputMode="numeric"
            autoComplete="tel-national"
            value={phone}
            onChange={(e) => setPhone(formatPhoneAsTyped(e.target.value))}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                runLookup();
              }
            }}
            placeholder="(555) 123-4567"
            className="w-full rounded-xl border border-ink-200 bg-cream-50 px-4 py-3 text-[15px] text-ink-900 placeholder:text-ink-400 focus:border-ink-900 focus:outline-none"
          />
        </Field>
        {error && (
          <p role="alert" className="text-sm text-red-700">
            {error}
          </p>
        )}
        <button
          type="button"
          onClick={runLookup}
          disabled={submitting}
          className={cn(
            "w-full rounded-full px-6 py-3 text-[15px] font-medium transition",
            submitting
              ? "cursor-wait bg-cream-200 text-ink-400"
              : "bg-ink-900 text-cream-50 hover:bg-ink-800"
          )}
        >
          {submitting ? "Looking…" : "Find my bookings"}
        </button>
      </div>

      {results !== null && results.length === 0 && (
        <div className="mt-6 rounded-2xl border border-ink-100 bg-cream-100/60 p-4 text-sm text-ink-600">
          No upcoming bookings found for that number. Double-check the phone
          you used to book.
        </div>
      )}

      {results !== null && results.length > 0 && (
        <div className="mt-6 space-y-2.5">
          {results.map((appt) => (
            <div
              key={appt.id}
              className={cn(
                "rounded-2xl border bg-cream-50 p-4 transition",
                appt.cancelled ? "border-ink-100 opacity-60" : "border-ink-200"
              )}
            >
              <div className="flex items-baseline justify-between gap-3">
                <p className="font-display text-[16px] font-medium text-ink-900">
                  {appt.serviceName}
                </p>
                <p className="text-sm text-ink-600">{appt.durationLabel}</p>
              </div>
              <p className="mt-0.5 text-[13px] text-ink-500">
                {appt.dayLabel} · {appt.timeLabel}
              </p>

              {appt.cancelled ? (
                <p className="mt-3 text-[13px] font-medium text-ink-500">
                  Cancelled
                </p>
              ) : cancelTargetId === appt.id && cancelStep === "verify" ? (
                <div className="mt-3 space-y-2">
                  <p className="text-[13px] text-ink-600">
                    Enter the last 4 digits of your phone to continue.
                  </p>
                  <input
                    type="tel"
                    inputMode="numeric"
                    maxLength={4}
                    value={last4}
                    onChange={(e) =>
                      setLast4(e.target.value.replace(/\D/g, "").slice(0, 4))
                    }
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        verifyAndShowReview(appt);
                      }
                    }}
                    placeholder="1234"
                    className="w-full rounded-xl border border-ink-200 bg-cream-50 px-4 py-2.5 text-[15px] text-ink-900 placeholder:text-ink-400 focus:border-ink-900 focus:outline-none"
                    autoFocus
                  />
                  {cancelError && (
                    <p role="alert" className="text-sm text-red-700">
                      {cancelError}
                    </p>
                  )}
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={resetCancelFlow}
                      className="min-h-[40px] flex-1 rounded-full border border-ink-200 px-4 py-2 text-sm text-ink-700 hover:border-ink-400"
                    >
                      Back
                    </button>
                    <button
                      type="button"
                      onClick={() => verifyAndShowReview(appt)}
                      disabled={verifying}
                      className={cn(
                        "min-h-[40px] flex-1 rounded-full px-4 py-2 text-sm font-medium transition",
                        verifying
                          ? "cursor-wait bg-cream-200 text-ink-400"
                          : "bg-ink-900 text-cream-50 hover:bg-ink-800"
                      )}
                    >
                      {verifying ? "Checking…" : "Continue"}
                    </button>
                  </div>
                </div>
              ) : cancelTargetId === appt.id && cancelStep === "review" ? (
                // Step 2: confirmation card. The destructive API call only
                // fires from "Yes, cancel appointment" here — never from
                // the verify step above.
                <div className="mt-3 space-y-3 rounded-xl border border-red-200 bg-red-50/40 p-3">
                  <div>
                    <p className="text-[12px] uppercase tracking-[0.14em] text-red-700">
                      Cancel this appointment?
                    </p>
                    <p className="mt-1.5 text-[14px] font-medium text-ink-900">
                      {appt.serviceName}
                    </p>
                    <p className="mt-0.5 text-[12px] text-ink-600">
                      {appt.dayLabel} · {appt.timeLabel}
                    </p>
                  </div>
                  <p className="text-[12px] text-ink-600">
                    This can&apos;t be undone. You&apos;ll need to rebook if you
                    change your mind.
                  </p>
                  {cancelError && (
                    <p role="alert" className="text-sm text-red-700">
                      {cancelError}
                    </p>
                  )}
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={resetCancelFlow}
                      disabled={cancelling}
                      className="min-h-[40px] flex-1 rounded-full border border-ink-200 bg-cream-50 px-4 py-2 text-sm font-medium text-ink-800 hover:border-ink-400"
                    >
                      Keep it
                    </button>
                    <button
                      type="button"
                      onClick={() => finalizeCancel(appt)}
                      disabled={cancelling}
                      className={cn(
                        "min-h-[40px] flex-1 rounded-full px-4 py-2 text-sm font-medium transition",
                        cancelling
                          ? "cursor-wait bg-cream-200 text-ink-400"
                          : "bg-red-600 text-cream-50 hover:bg-red-700"
                      )}
                    >
                      {cancelling ? "Cancelling…" : "Yes, cancel"}
                    </button>
                  </div>
                </div>
              ) : (
                <div className="mt-3 flex gap-2">
                  <button
                    type="button"
                    onClick={() => onReschedule(appt)}
                    className="min-h-[40px] flex-1 rounded-full border border-ink-200 px-4 py-2 text-sm font-medium text-ink-800 hover:border-ink-900 hover:text-ink-900"
                  >
                    Reschedule
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setCancelTargetId(appt.id);
                      setCancelStep("verify");
                      setLast4("");
                      setVerifiedLast4("");
                      setCancelError(null);
                    }}
                    className="min-h-[40px] flex-1 rounded-full border border-ink-200 px-4 py-2 text-sm font-medium text-ink-800 hover:border-ink-900 hover:text-ink-900"
                  >
                    Cancel
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Book my usual — phone lookup → most recent service → TimeStage.             */
/*                                                                             */
/* No last-4 verification: we only expose the previous SERVICE name (already   */
/* in the user's mental model — "you booked a haircut last time"), not the    */
/* time, date, or any other appointment detail. The lookup endpoint never     */
/* returns phone numbers, and the service name alone is not sensitive PII.    */
/* -------------------------------------------------------------------------- */

function UsualLookupStage({
  onBack,
  onBookSame,
  onHelpMeChoose,
}: {
  onBack: () => void;
  // Carries the previous service plus a contact prefill (name + phone + email)
  // so DetailsStage doesn't make returning clients retype info they've
  // already given us. Contact is only populated when the phone matched
  // exactly one upcoming booking — otherwise undefined, falling back to
  // manual entry.
  onBookSame: (
    svc: Service,
    prefill?: { name: string; phone: string; email: string }
  ) => void;
  onHelpMeChoose: () => void;
}) {
  const [phone, setPhone] = useState("");
  const [submitting, setSubmitting] = useState(false);
  // null = haven't searched yet, undefined = searched and found nothing
  const [foundService, setFoundService] = useState<Service | null | undefined>(null);
  // Contact details returned by the lookup (single-match only). Held in
  // state so the "Yes, find a time" CTA can pass them up to the parent.
  const [foundContact, setFoundContact] = useState<{
    name: string;
    email: string;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function runLookup() {
    const digits = extractPhoneDigits(phone) ?? phone.replace(/\D/g, "");
    if (digits.length < 7) {
      setError("Enter the full phone number you used to book.");
      return;
    }
    setError(null);
    setSubmitting(true);
    try {
      // includeContact=1 opts into the prefill payload; the API only returns
      // it when the phone matches exactly one upcoming booking.
      const res = await fetch(
        `/api/bookings/lookup?phone=${encodeURIComponent(digits)}&includeContact=1`
      );
      const data = await res.json();
      const appts: Appointment[] = data?.appointments ?? [];
      if (appts.length === 0) {
        setFoundService(undefined);
        setFoundContact(null);
        return;
      }
      // The lookup returns upcoming bookings sorted ascending by start time.
      // For "book my usual," we want the most recent past booking — but the
      // endpoint only returns future bookings (today onward). That's fine:
      // an upcoming booking's serviceId is just as good a "usual" signal.
      // Pick the first (soonest) one.
      const recent = appts[0];
      const svc =
        SERVICES.find((s) => s.id === recent.serviceId) ?? null;
      setFoundService(svc ?? undefined);
      // Capture contact only when the API returned it (single-match path).
      if (data?.contact && typeof data.contact === "object") {
        setFoundContact({
          name: String(data.contact.name ?? ""),
          email: String(data.contact.email ?? ""),
        });
      } else {
        setFoundContact(null);
      }
    } catch {
      setError("Couldn't reach the server. Try again in a moment.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="animate-fade-up">
      <BackBar onBack={onBack} />
      <h1 className="mt-2 font-display text-2xl font-medium tracking-tight text-ink-900">
        Book my usual
      </h1>
      <p className="mt-1 text-sm text-ink-500">
        Enter your phone and we&apos;ll line up the same service as last time.
      </p>

      <div className="mt-6 space-y-3">
        <Field label="Phone number" required>
          <input
            type="tel"
            inputMode="numeric"
            autoComplete="tel-national"
            value={phone}
            onChange={(e) => setPhone(formatPhoneAsTyped(e.target.value))}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                runLookup();
              }
            }}
            placeholder="(555) 123-4567"
            className="w-full rounded-xl border border-ink-200 bg-cream-50 px-4 py-3 text-[15px] text-ink-900 placeholder:text-ink-400 focus:border-ink-900 focus:outline-none"
          />
        </Field>
        {error && (
          <p role="alert" className="text-sm text-red-700">
            {error}
          </p>
        )}
        <button
          type="button"
          onClick={runLookup}
          disabled={submitting}
          className={cn(
            "w-full rounded-full px-6 py-3 text-[15px] font-medium transition",
            submitting
              ? "cursor-wait bg-cream-200 text-ink-400"
              : "bg-ink-900 text-cream-50 hover:bg-ink-800"
          )}
        >
          {submitting ? "Looking…" : "Find my usual"}
        </button>
      </div>

      {foundService && (
        <div className="mt-6 rounded-2xl border border-ink-200 bg-cream-50 p-4">
          <p className="text-xs uppercase tracking-[0.14em] text-ink-500">
            Your last visit
          </p>
          <div className="mt-1 flex items-baseline justify-between gap-3">
            <p className="font-display text-[16px] font-medium text-ink-900">
              {foundService.name}
            </p>
            <p className="text-sm text-ink-600">
              {foundService.priceLabel}
              <span className="px-1.5 text-ink-300">·</span>
              {foundService.durationLabel}
            </p>
          </div>
          <button
            type="button"
            onClick={() =>
              onBookSame(
                foundService,
                foundContact
                  ? {
                      name: foundContact.name,
                      // Format the phone for display consistency in DetailsStage.
                      phone: formatPhoneAsTyped(phone),
                      email: foundContact.email,
                    }
                  : undefined
              )
            }
            className="mt-4 w-full rounded-full bg-ink-900 px-6 py-3 text-[15px] font-medium text-cream-50 transition hover:bg-ink-800"
          >
            Yes, find a time
          </button>
        </div>
      )}

      {foundService === undefined && (
        <div className="mt-6 rounded-2xl border border-ink-100 bg-cream-100/60 p-4">
          <p className="text-sm text-ink-600">
            No previous booking found for that number — let&apos;s start fresh.
          </p>
          <button
            type="button"
            onClick={onHelpMeChoose}
            className="mt-3 w-full rounded-full border border-ink-200 px-6 py-3 text-[15px] font-medium text-ink-800 transition hover:border-ink-900"
          >
            Help me choose
          </button>
        </div>
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Service picker — category fast path. Shows a category's services as cards   */
/* so confident clients can skip the assistant entirely.                       */
/* -------------------------------------------------------------------------- */

function ServicePickerStage({
  category,
  services,
  onPick,
  onBack,
}: {
  category: string;
  services: Service[];
  onPick: (svc: Service) => void;
  onBack: () => void;
}) {
  return (
    <div className="animate-fade-up">
      <BackBar onBack={onBack} />
      <h1 className="mt-2 font-display text-2xl font-medium tracking-tight text-ink-900">
        {category}
      </h1>
      <p className="mt-1 text-sm text-ink-500">
        Pick a service to see open times.
      </p>
      <div className="mt-6 space-y-2.5">
        {services.map((s) => (
          <button
            key={s.id}
            type="button"
            onClick={() => onPick(s)}
            className="block w-full rounded-2xl border border-ink-200 bg-cream-50 p-4 text-left transition hover:border-ink-900"
          >
            <div className="flex items-baseline justify-between gap-3">
              <p className="font-display text-[16px] font-medium text-ink-900">
                {s.name}
              </p>
              <p className="text-sm text-ink-600">
                {s.priceLabel}
                <span className="px-1.5 text-ink-300">·</span>
                {s.durationLabel}
              </p>
            </div>
            <p className="mt-1 text-[13px] text-ink-500">Book →</p>
          </button>
        ))}
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Mobile chat shell — focused full-viewport chat, replaces PageShell entirely */
/* on phones. Uses visualViewport to stay above the iOS keyboard.              */
/* -------------------------------------------------------------------------- */

type MobileChatShellProps = HomeProps & {
  viewport: {
    viewportHeight: number;
    viewportOffsetTop: number;
    keyboardOffset: number;
    keyboardOpen: boolean;
  };
};

function MobileChatShell(props: MobileChatShellProps) {
  const {
    assistantRef,
    turns,
    chipsLocked,
    onPromptChip,
    onTextSubmit,
    onClarifyTap,
    onBookThis,
    onShowAlternates,
    onAlternatePick,
    onSlotPick,
    onNavChip,
    onConsultationCta,
    onCustomCta,
    onBrowseAllCta,
    onResetConversation,
    onChangeService,
    serviceLocked,
    conversationStarted,
    mode,
    onModePick,
    onAppointmentPick,
    onManageChip,
    onSubmitHandoff,
    onOpenHandoff,
    stylistName,
    stylistInitials,
    viewport,
  } = props;

  const [input, setInput] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const messagesPaneRef = useRef<HTMLDivElement | null>(null);
  // Tracks whether the textarea is the most recent focus target. We can't
  // rely on document.activeElement at chip-click time because iOS gives
  // the chip button focus on pointerdown, which fires before React onClick.
  const textareaFocusedRef = useRef(false);

  // Lock the body while this shell is mounted so iOS rubber-banding can't
  // drag the underlying page when the user scrolls inside the messages pane.
  useEffect(() => {
    document.body.classList.add("body-locked");
    return () => {
      document.body.classList.remove("body-locked");
    };
  }, []);

  function autoGrow() {
    const el = textareaRef.current;
    if (!el) return;
    if (!el.value) {
      el.style.height = "";
      return;
    }
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 120)}px`;
  }

  useEffect(() => {
    autoGrow();
  }, [input]);

  // Keep latest message visible whenever turns change OR the keyboard opens.
  // Without the keyboard dependency, focusing the input would leave the
  // previous-anchored message hidden behind the now-shorter messages pane.
  useEffect(() => {
    const pane = messagesPaneRef.current;
    if (!pane) return;
    pane.scrollTo({ top: pane.scrollHeight, behavior: "smooth" });
  }, [turns.length, viewport.keyboardOpen]);

  function submit() {
    if (!input.trim()) return;
    onTextSubmit(input);
    setInput("");
    requestAnimationFrame(() => {
      if (textareaRef.current) textareaRef.current.style.height = "auto";
      textareaRef.current?.focus();
    });
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  }

  /**
   * Wraps any chip / option handler so that the textarea keeps focus IF
   * it was focused at the moment of the tap. This preserves the keyboard
   * across chip taps (the user is mid-flow and might want to type) but
   * doesn't pop the keyboard up unprompted (when they hadn't been typing).
   *
   * The refocus has to happen inside the user gesture for iOS Safari to
   * allow it — that's why we use a wrapper rather than a post-hoc effect.
   */
  function keepFocus<A extends unknown[]>(fn: (...args: A) => void) {
    return (...args: A) => {
      const wasFocused = textareaFocusedRef.current;
      fn(...args);
      if (wasFocused) {
        // rAF lets React flush its state update first, then we refocus.
        // Still inside the user-gesture window on iOS.
        requestAnimationFrame(() => textareaRef.current?.focus());
      }
    };
  }

  /**
   * iOS gives a button focus on pointerdown, which blurs the textarea and
   * dismisses the keyboard *before* our onClick fires — at which point our
   * keepFocus check sees `wasFocused = false` and doesn't refocus.
   * Calling preventDefault on pointerdown stops the implicit focus shift,
   * keeping the textarea focused throughout the chip tap.
   */
  function preventFocusSteal(e: React.PointerEvent | React.MouseEvent) {
    if (textareaFocusedRef.current) {
      e.preventDefault();
    }
  }

  // Wrapped versions of every handler that fires from a chip / option tap
  // inside the shell or inside any TurnRow.
  const wOnPromptChip = keepFocus(onPromptChip);
  const wOnClarifyTap = keepFocus(onClarifyTap);
  const wOnBookThis = keepFocus(onBookThis);
  const wOnShowAlternates = keepFocus(onShowAlternates);
  const wOnAlternatePick = keepFocus(onAlternatePick);
  const wOnSlotPick = keepFocus(onSlotPick);
  const wOnNavChip = keepFocus(onNavChip);
  const wOnConsultationCta = keepFocus(onConsultationCta);
  const wOnCustomCta = keepFocus(onCustomCta);
  const wOnBrowseAllCta = keepFocus(onBrowseAllCta);
  const wOnModePick = keepFocus(onModePick);
  const wOnAppointmentPick = keepFocus(onAppointmentPick);
  const wOnManageChip = keepFocus(onManageChip);
  const wOnChangeService = keepFocus(onChangeService);

  // Shell anchored to the visual viewport — top offset + height both
  // tracked, so the shell sits exactly inside the visible area on iOS
  // even when the keyboard is open or when Safari has shifted the layout
  // viewport up to keep the focused input on screen.
  // Falls back to top:0 + 100dvh when visualViewport isn't available.
  const shellStyle: React.CSSProperties = viewport.viewportHeight
    ? {
        top: `${viewport.viewportOffsetTop}px`,
        height: `${viewport.viewportHeight}px`,
      }
    : { top: 0, height: "100dvh" };

  // When the keyboard is open, the bottom safe-area inset doesn't apply
  // (the home indicator is hidden behind the keyboard). Squash it to 0
  // so the composer doesn't have a phantom gap.
  const composerPadBottom = viewport.keyboardOpen
    ? "0.5rem"
    : "max(env(safe-area-inset-bottom), 0.5rem)";

  return (
    <div
      className="fixed inset-x-0 z-40 flex flex-col bg-cream-50"
      style={shellStyle}
    >
      {/* Compact header — back, avatar, name. ~52px tall + safe-area top. */}
      <header className="flex shrink-0 items-center gap-2 border-b border-ink-100 px-3 pt-safe">
        <button
          type="button"
          onClick={() => {
            // BACK ≠ START OVER. The arrow steps back through the conversation
            // (previous stage / collapses availability) via browser history,
            // preserving service + time context and the message thread. The
            // explicit "Start over" control is the ONLY full reset.
            if (typeof window !== "undefined" && window.history.length > 1) {
              window.history.back();
            }
          }}
          aria-label="Back"
          className="-ml-1 inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-ink-700 active:bg-cream-100"
        >
          <span aria-hidden className="text-xl leading-none">←</span>
        </button>
        <div ref={assistantRef} className="flex min-w-0 flex-1 items-center gap-2 py-2.5">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-accent-soft font-display text-sm text-accent-dark">
            {stylistInitials}
          </div>
          <div className="min-w-0">
            <p className="truncate text-[15px] font-medium leading-tight text-ink-900">
              {stylistName}
            </p>
            <p className="truncate text-[11px] leading-snug text-ink-500">
              Booking with {stylistName}
            </p>
          </div>
        </div>
        {/* "Message {stylist}" — opens a handoff card so the user can send a
            quick message to the stylist. Renamed from "Need {stylist}?" which
            misleadingly implied talking to her directly; this opens a form. */}
        <button
          type="button"
          onClick={onOpenHandoff}
          className="shrink-0 rounded-full px-2.5 py-2 text-[11px] font-medium text-ink-600 hover:text-ink-900 active:bg-cream-100"
        >
          Message {stylistName}
        </button>
        {conversationStarted && (
          <button
            type="button"
            onClick={onResetConversation}
            aria-label="Start over — clear this conversation"
            className="shrink-0 rounded-full px-3 py-2 text-xs font-medium text-ink-500 active:bg-cream-100"
          >
            Start over
          </button>
        )}
      </header>

      {/* Messages — the only scrollable region. The mousedown handler is
          delegated: any button tap inside (clarify chips, alternates, slot
          cards, etc.) calls preventDefault when the textarea is focused, so
          iOS doesn't steal focus from the textarea on pointerdown and
          dismiss the keyboard. */}
      <div
        ref={messagesPaneRef}
        onMouseDown={(e) => {
          if (e.target instanceof HTMLElement && e.target.closest("button")) {
            preventFocusSteal(e);
          }
        }}
        className="scroll-pane min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-4"
      >
        {/* When the conversation hasn't started, show a tiny inline hint
            instead of the giant Book-with-X hero. The hero is desktop-only;
            mobile gets right to the chat. */}
        {!conversationStarted && turns.length === 0 && (
          <p className="pt-2 text-center text-sm text-ink-500">
            Tell me what you want — I'll find the right booking.
          </p>
        )}
        {turns.map((turn) => (
          <TurnRow
            key={turn.id}
            turn={turn}
            onClarifyTap={wOnClarifyTap}
            onBookThis={wOnBookThis}
            onShowAlternates={wOnShowAlternates}
            onAlternatePick={wOnAlternatePick}
            onSlotPick={wOnSlotPick}
            onNavChip={wOnNavChip}
            onConsultationCta={wOnConsultationCta}
            onCustomCta={wOnCustomCta}
            onBrowseAllCta={wOnBrowseAllCta}
            onAppointmentPick={wOnAppointmentPick}
            onManageChip={wOnManageChip}
            onSubmitHandoff={onSubmitHandoff}
            stylistName={stylistName}
          />
        ))}
      </div>

      {/* Suggestion chips — directly above composer, horizontally
          scrollable on mobile so they never wrap into a stack.
          Surfaced only when the conversation hasn't started yet
          (no turns) so first-time visitors have one-tap starters.
          As soon as the user sends a message the chips disappear —
          the chat infers intent from there, no mode picker. */}
      {turns.length === 0 && !chipsLocked && !serviceLocked && (
        <div className="shrink-0 border-t border-ink-100 px-3 py-2">
          <div className="no-scrollbar flex gap-2 overflow-x-auto">
            {PROMPT_CHIPS.map((chip) => (
              <button
                key={chip.label}
                type="button"
                onMouseDown={preventFocusSteal}
                onClick={() => wOnPromptChip(chip.preset)}
                className="shrink-0 whitespace-nowrap rounded-full border border-ink-200 bg-cream-50 px-3.5 py-2 text-sm font-medium text-ink-800 active:bg-cream-100"
              >
                {chip.label}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Composer — pinned at the bottom of the shell. Because the shell's
          height tracks visualViewport, the composer is automatically just
          above the keyboard when it's open. */}
      <div
        className="shrink-0 border-t border-ink-100 bg-cream-50 px-3 pt-2"
        style={{ paddingBottom: composerPadBottom }}
      >
        {serviceLocked && (
          <button
            type="button"
            onMouseDown={preventFocusSteal}
            onClick={wOnChangeService}
            className="mb-2 inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-medium text-ink-500 active:bg-cream-100"
          >
            Change service
          </button>
        )}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
          className="flex items-end gap-2"
        >
          <textarea
            ref={textareaRef}
            rows={1}
            inputMode="text"
            autoComplete="off"
            enterKeyHint="send"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            onFocus={() => {
              textareaFocusedRef.current = true;
              // Snap to the latest message on focus. The visualViewport
              // resize fires *after* the keyboard animation, which can
              // leave the previous-anchored message momentarily hidden.
              // This nudge keeps the conversation context visible during
              // the keyboard slide-in.
              const pane = messagesPaneRef.current;
              if (!pane) return;
              requestAnimationFrame(() => {
                pane.scrollTo({ top: pane.scrollHeight, behavior: "smooth" });
              });
            }}
            onBlur={() => {
              textareaFocusedRef.current = false;
            }}
            placeholder={`Message ${stylistName}…`}
            maxLength={800}
            style={{ resize: "none", maxHeight: "120px" }}
            // text-base = 16px to suppress iOS Safari focus auto-zoom.
            className="min-w-0 flex-1 overflow-y-hidden rounded-2xl border border-ink-200 bg-cream-50 px-4 py-2.5 text-base leading-snug text-ink-900 placeholder:text-ink-400 focus:border-ink-900 focus:outline-none focus-visible:outline-none"
          />
          <button
            type="submit"
            disabled={!input.trim()}
            aria-label="Send"
            className={cn(
              "flex h-11 w-11 shrink-0 items-center justify-center rounded-full transition active:scale-[0.96]",
              input.trim()
                ? "bg-ink-900 text-cream-50"
                : "cursor-not-allowed bg-cream-200 text-ink-400"
            )}
          >
            <SendIcon />
          </button>
        </form>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Assistant block                                                             */
/* -------------------------------------------------------------------------- */

function AssistantBlock(props: HomeProps) {
  const {
    turns,
    chipsLocked,
    onPromptChip,
    onTextSubmit,
    onClarifyTap,
    onBookThis,
    onShowAlternates,
    onAlternatePick,
    onSlotPick,
    onNavChip,
    onConsultationCta,
    onCustomCta,
    onBrowseAllCta,
    onResetConversation,
    onChangeService,
    serviceLocked,
    conversationStarted,
    mode,
    onModePick,
    onAppointmentPick,
    onManageChip,
    onSubmitHandoff,
    onOpenHandoff,
  } = props;

  const [input, setInput] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const scrollAnchorRef = useRef<HTMLDivElement | null>(null);
  const messagesPaneRef = useRef<HTMLDivElement | null>(null);

  function autoGrow() {
    const el = textareaRef.current;
    if (!el) return;
    // When empty, reset to the natural rows=1 height so browsers that include
    // placeholder text in scrollHeight don't inflate the textarea to 2 rows.
    if (!el.value) {
      el.style.height = "";
      return;
    }
    el.style.height = "auto";
    const next = Math.min(el.scrollHeight, 120);
    el.style.height = `${next}px`;
  }

  useEffect(() => {
    autoGrow();
  }, [input]);

  useEffect(() => {
    // Scroll only the messages pane (not the document) so iOS doesn't
    // shift the whole page when a new turn arrives. Falls back to the
    // anchor's scrollIntoView when the pane isn't mounted yet (the
    // hero state, before conversationStarted).
    const pane = messagesPaneRef.current;
    if (pane) {
      pane.scrollTo({ top: pane.scrollHeight, behavior: "smooth" });
    } else {
      scrollAnchorRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
  }, [turns.length]);

  function submit() {
    if (!input.trim()) return;
    onTextSubmit(input);
    setInput("");
    requestAnimationFrame(() => {
      if (textareaRef.current) {
        textareaRef.current.style.height = "auto";
      }
      textareaRef.current?.focus();
    });
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  }

  // Desktop-only path. Mobile is rendered by MobileChatShell instead, so
  // we don't need any of the fixed-viewport handling here.
  return (
    <div
      className={cn(
        "flex flex-col rounded-3xl border border-ink-100 bg-cream-50 shadow-soft transition-[height]",
        conversationStarted &&
          "h-[68vh] min-h-[480px] max-h-[760px] overflow-hidden"
      )}
    >
      {/* Fixed-height header: avatar + title left, action buttons right.
          min-w-0 + truncate on the title keeps "Shen's booking helper"
          from wrapping into the buttons; shrink-0 on the button group
          keeps the buttons from being squeezed when the studio name is
          long. */}
      <div className="flex h-[52px] shrink-0 items-center justify-between gap-3 border-b border-ink-100 px-4">
        <div className="flex min-w-0 flex-1 items-center gap-2.5">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-accent-soft font-display text-sm text-accent-dark">
            {props.stylistInitials}
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium leading-tight text-ink-900">
              {props.stylistName}
            </p>
            {/* Hide once the conversation starts — the hint is no longer
                needed and the buttons on the right need the space. */}
            {!conversationStarted && (
              <p className="truncate text-[11px] leading-snug text-ink-500">
                Tell me what you want — I&rsquo;ll find the right booking
              </p>
            )}
          </div>
        </div>
        {/* Hidden (not invisible) before the conversation starts so the
            left side gets the full width and the subtitle isn't squeezed.
            Once conversation is underway the subtitle is gone, so the
            buttons can appear without causing a height shift. */}
        <div
          className={cn(
            "flex shrink-0 items-center gap-1.5",
            !conversationStarted && "hidden"
          )}
        >
          {/* "Change service" removed from the header — as a persistent header
              action it felt like a jarring reset mid-chat. Service changes
              happen conversationally ("actually a color") or via the composer's
              contextual "Change service" affordance. */}
          <button
            type="button"
            onClick={onResetConversation}
            className="whitespace-nowrap rounded-full border border-ink-200 px-3 py-1 text-[11px] font-medium text-ink-700 hover:border-ink-300 hover:bg-cream-100"
          >
            Start over
          </button>
        </div>
      </div>

      <div
        ref={messagesPaneRef}
        className={cn(
          "space-y-3 px-4 py-4",
          // The messages region grows to fill available space and scrolls
          // when overflowed. Without this, long conversations push the
          // input bar off-screen. scroll-pane adds touch momentum +
          // overscroll containment so the scroll doesn't bubble up to
          // the body on iOS.
          conversationStarted ? "min-h-0 flex-1 overflow-y-auto scroll-pane" : ""
        )}
      >
        {turns.map((turn) => (
          <TurnRow
            key={turn.id}
            turn={turn}
            onClarifyTap={onClarifyTap}
            onBookThis={onBookThis}
            onShowAlternates={onShowAlternates}
            onAlternatePick={onAlternatePick}
            onSlotPick={onSlotPick}
            onNavChip={onNavChip}
            onConsultationCta={onConsultationCta}
            onCustomCta={onCustomCta}
            onBrowseAllCta={onBrowseAllCta}
            onAppointmentPick={onAppointmentPick}
            onManageChip={onManageChip}
            onSubmitHandoff={onSubmitHandoff}
            stylistName={props.stylistName}
          />
        ))}
        <div ref={scrollAnchorRef} />
      </div>

      {/* Suggestion chips — surfaced only before the conversation
          starts (no turns yet) so first-time visitors have one-tap
          starters. After the first message the chat infers intent
          from the user's words; no mode picker. */}
      {turns.length === 0 && !chipsLocked && !serviceLocked && (
        <div className="shrink-0 border-t border-ink-100 px-4 pb-3 pt-3">
          <div className="flex flex-wrap gap-2">
            {PROMPT_CHIPS.map((chip) => (
              <button
                key={chip.label}
                type="button"
                onClick={() => onPromptChip(chip.preset)}
                className="rounded-full border border-ink-200 bg-cream-50 px-3.5 py-2.5 text-sm font-medium text-ink-800 transition hover:border-ink-300 hover:bg-cream-100 active:scale-[0.98]"
              >
                {chip.label}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="shrink-0 border-t border-ink-100 px-3 py-3">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
          className="flex items-end gap-2"
        >
          <textarea
            ref={textareaRef}
            rows={1}
            inputMode="text"
            autoComplete="off"
            enterKeyHint="send"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={`Message ${props.stylistName}…`}
            maxLength={800}
            style={{ resize: "none", maxHeight: "120px" }}
            className="min-w-0 flex-1 overflow-y-hidden rounded-2xl border border-ink-200 bg-cream-50 px-4 py-2.5 text-[15px] leading-snug text-ink-900 placeholder:text-ink-400 focus:border-ink-900 focus:outline-none focus-visible:outline-none"
          />
          <button
            type="submit"
            disabled={!input.trim()}
            aria-label="Send"
            className={cn(
              "flex h-11 w-11 shrink-0 items-center justify-center rounded-full transition active:scale-[0.96]",
              input.trim()
                ? "bg-ink-900 text-cream-50 hover:bg-ink-800"
                : "cursor-not-allowed bg-cream-200 text-ink-400"
            )}
          >
            <SendIcon />
          </button>
        </form>
      </div>
    </div>
  );
}

function SendIcon() {
  return (
    <svg
      className="h-4 w-4"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M2 8L14 2L9 14L7 9L2 8Z" />
    </svg>
  );
}

/* -------------------------------------------------------------------------- */
/* Turn renderer                                                               */
/* -------------------------------------------------------------------------- */

function TurnRow({
  turn,
  onClarifyTap,
  onBookThis,
  onShowAlternates,
  onAlternatePick,
  onSlotPick,
  onNavChip,
  onConsultationCta,
  onCustomCta,
  onBrowseAllCta,
  onAppointmentPick,
  onManageChip,
  onSubmitHandoff,
  stylistName,
}: {
  turn: AssistantTurn;
  onClarifyTap: (turnId: string, opt: { label: string; key: string }) => void;
  onBookThis: (turnId: string) => void;
  onShowAlternates: (turnId: string) => void;
  onAlternatePick: (svc: Service) => void;
  onSlotPick: (slot: TimeSlot) => void;
  onNavChip: (chipKey: NavChipKey, anchorDateKey: string | null, weekShift: number | null) => void;
  onConsultationCta: () => void;
  onCustomCta: () => void;
  onBrowseAllCta: () => void;
  onAppointmentPick: (turnId: string, appt: Appointment) => void;
  onManageChip: (turnId: string, key: ManageChipKey) => void;
  // Handoff submission — the form inside HandoffCard calls this on Send.
  // Parent owns the network call and marks the turn submitted on success.
  onSubmitHandoff: (
    turnId: string,
    data: {
      clientName: string;
      clientPhone: string;
      clientEmail: string;
      summary: string;
      sourceMessage: string;
    }
  ) => Promise<boolean>;
  stylistName: string;
}) {
  // Library strings (parser, booking-summary) use "Shen" as the demo default.
  // Swap it to the live stylist name at render time so the chat reads
  // correctly once a real Square account is connected. User-typed turns
  // are left untouched.
  const personalize = (text: string) =>
    text.replace(/\bShen\b/g, stylistName);

  // Expand state for the recommendation-first availability turn ("See all").
  // Declared unconditionally (every TurnRow gets one; only the times turn uses
  // it) so hooks order stays stable across turn kinds.
  const [showAllTimes, setShowAllTimes] = useState(false);

  if (turn.kind === "bot-text") {
    return (
      <div>
        <BotBubble>{personalize(turn.text)}</BotBubble>
        <DebugSourceLabel source={turn.source} />
      </div>
    );
  }

  if (turn.kind === "typing") {
    return <TypingBubble label={personalize(turn.label)} />;
  }
  if (turn.kind === "user-text") return <UserBubble>{turn.text}</UserBubble>;

  if (turn.kind === "clarify") {
    return (
      <div className="space-y-2 animate-fade-up">
        <BotBubble>{personalize(turn.text)}</BotBubble>
        {!turn.consumed && (
          <div className="flex flex-wrap gap-2">
            {turn.options.map((opt) => (
              <button
                key={opt.key}
                type="button"
                onClick={() => onClarifyTap(turn.id, opt)}
                className="rounded-full border border-ink-200 bg-cream-50 px-3.5 py-2.5 text-sm font-medium text-ink-800 transition hover:border-ink-300 hover:bg-cream-100 active:scale-[0.98]"
              >
                {opt.label}
              </button>
            ))}
          </div>
        )}
      </div>
    );
  }

  if (turn.kind === "recommendation") {
    return (
      <RecommendationBubble
        turn={turn}
        onBookThis={() => onBookThis(turn.id)}
        onShowAlternates={() => onShowAlternates(turn.id)}
        stylistName={stylistName}
      />
    );
  }

  if (turn.kind === "alternates") {
    return (
      <div className="animate-fade-up space-y-2">
        {turn.services.map((svc) => {
          const isRecommended = svc.id === turn.recommendedId;
          return (
            <button
              key={svc.id}
              type="button"
              onClick={() => onAlternatePick(svc)}
              className={cn(
                "group flex w-full items-center justify-between gap-4 rounded-2xl border bg-cream-50 p-4 text-left transition hover:shadow-soft",
                isRecommended
                  ? "border-accent/40 bg-accent-soft/40 hover:border-accent/60"
                  : "border-ink-100 hover:border-ink-300"
              )}
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <p className="text-[15px] font-medium text-ink-900">
                    {svc.name}
                  </p>
                  {isRecommended && (
                    <span className="rounded-full bg-accent/15 px-2 py-0.5 text-[10.5px] font-medium uppercase tracking-wide text-accent-dark">
                      Recommended
                    </span>
                  )}
                </div>
                <p className="mt-1 text-sm text-ink-500">{svc.durationLabel}</p>
              </div>
              <div className="text-right">
                <p className="text-[15px] font-medium text-ink-900">
                  {svc.priceLabel}
                </p>
                {svc.status === "consultation" && (
                  <p className="mt-1 text-xs text-accent">Consultation</p>
                )}
              </div>
            </button>
          );
        })}
        {/* Escape hatch for the alternates panel — two affordances:
            - Primary: see the full menu (most users actually want this).
            - Secondary: small text link to the Instagram DM handoff for
              truly custom requests. Replaces the previous single button
              that wrongly assumed "frustrated user = custom request." */}
        <button
          type="button"
          onClick={onBrowseAllCta}
          className="flex w-full items-center justify-between gap-3 rounded-2xl border border-ink-200 bg-cream-50 p-3 text-sm font-medium text-ink-800 hover:border-ink-900 hover:text-ink-900"
        >
          <span>Browse all services</span>
          <span aria-hidden className="text-ink-400">→</span>
        </button>
        <div className="mt-2 text-center">
          <button
            type="button"
            onClick={onCustomCta}
            className="text-[12px] text-ink-500 underline-offset-4 hover:text-ink-900 hover:underline"
          >
            Have a custom request? Message {stylistName}
          </button>
        </div>
      </div>
    );
  }

  if (turn.kind === "service-browser") {
    return (
      <div className="animate-fade-up space-y-5">
        {turn.groups.map((group) => (
          <div key={group.category}>
            <p className="mb-2 text-[11px] font-medium uppercase tracking-[0.14em] text-ink-400">
              {group.category}
            </p>
            <div className="space-y-1.5">
              {group.services.map((svc) => (
                <button
                  key={svc.id}
                  type="button"
                  onClick={() => onAlternatePick(svc)}
                  className="flex w-full items-center justify-between gap-4 rounded-2xl border border-ink-100 bg-cream-50 p-3.5 text-left transition hover:border-ink-300 hover:shadow-soft active:scale-[0.99]"
                >
                  <div className="min-w-0 flex-1">
                    <p className="text-[14.5px] font-medium text-ink-900 leading-snug">{svc.name}</p>
                    <p className="mt-0.5 text-xs text-ink-400">{svc.durationLabel}</p>
                  </div>
                  <div className="shrink-0 text-right">
                    <p className="text-sm font-medium text-ink-700">{svc.priceLabel}</p>
                    {svc.status === "consultation" && (
                      <p className="text-[10px] text-accent leading-none mt-0.5">Consultation required</p>
                    )}
                  </div>
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
    );
  }

  if (turn.kind === "handoff") {
    return (
      <HandoffCard
        turn={turn}
        stylistName={stylistName}
        onSubmit={(data) => onSubmitHandoff(turn.id, data)}
      />
    );
  }

  if (turn.kind === "times") {
    const availability = turn.chipAvailability;

    // Date-range chips — extending search forward in time
    const rangeChips = (
      [
        { key: "this-week", label: "This week" },
        { key: "next-week", label: "Next week" },
        { key: "week-after", label: "Week after" },
        // "See all openings" opens the full day-picker. "Pick a date" was
        // removed — it duplicated that and confused users (it wasn't clear what
        // it did); the full schedule already lets you choose any day.
        { key: "see-all", label: "See all openings" },
      ] as const
    ).filter((c) => availability[c.key]);

    // Day-relative chips — pivoting off current day's results
    const navChips = (
      [
        { key: "earlier-day", label: "Earlier that day" },
        { key: "later-day", label: "Later that day" },
        { key: "next-day", label: "Next day" },
      ] as const
    ).filter((c) => availability[c.key]);

    const hasAnyChips = rangeChips.length > 0 || navChips.length > 0;

    // Recommendation-first presentation. When the turn carries `recommended`
    // (the 3–6 context-ranked hero set), lead with those + an intro, and gate
    // the full list behind "See all". Falls back to the flat grid for turns
    // built before this (or with no recommendation).
    const recommended = turn.recommended ?? null;
    const hasReco = recommended !== null && recommended.length > 0;
    const expanded = showAllTimes || !hasReco;

    return (
      <div className="animate-fade-up space-y-3">
        {turn.intro && !expanded && (
          <BotBubble>{personalize(turn.intro)}</BotBubble>
        )}

        {/* Hero (collapsed): RECOMMENDATION — visually distinct from the
            calendar grid. Date stated ONCE as a heading; time-first pills below
            (no per-card date, so no truncation). Responsive 2→3→4 columns. */}
        {!expanded && (() => {
          const recos = recommended ?? turn.slots;
          // Date heading only when all recommendations share one day (the
          // common case). When they span days, omit it and let pills carry a
          // tiny date — avoids a heading that lies.
          const oneDay = recos.length > 0 && recos.every((s) => s.dateKey === recos[0].dateKey);
          const headingDay = oneDay
            ? `${DAY_FULL_FROM_SHORT[recos[0].dayLabel] ?? recos[0].dayLabel} · ${recos[0].dateLabel}`
            : null;
          // "near"/range get the "Recommended for you" label; an exact "hit"
          // (single open slot) reads better without it (the intro says yes).
          const showRecoLabel = turn.exactStatus !== "hit";
          return (
            <div className="rounded-2xl border border-accent/25 bg-accent-soft/30 p-4">
              {headingDay && (
                <p className="font-display text-[15px] font-medium text-ink-900">
                  {headingDay}
                </p>
              )}
              {showRecoLabel && (
                <p className="mt-0.5 text-[11px] uppercase tracking-[0.14em] text-accent-dark/80">
                  Recommended for you
                </p>
              )}
              <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4">
                {recos.map((slot) => (
                  <button
                    key={slot.id}
                    type="button"
                    onClick={() => onSlotPick(slot)}
                    className="flex min-h-[52px] items-center justify-center rounded-xl border border-accent/30 bg-cream-50 px-3 py-3 font-display text-lg font-medium text-ink-900 shadow-soft transition hover:border-accent/60 hover:shadow-md active:scale-[0.98]"
                  >
                    {oneDay ? (
                      slot.timeLabel
                    ) : (
                      <span className="flex flex-col items-center leading-tight">
                        <span className="text-[10px] uppercase tracking-wide text-ink-400">
                          {slot.dayLabel} · {slot.dateLabel}
                        </span>
                        <span>{slot.timeLabel}</span>
                      </span>
                    )}
                  </button>
                ))}
              </div>
            </div>
          );
        })()}

        {/* Expanded "See all": grouped Date → part-of-day → time-only chips.
            Date is in the header (once), so cards never repeat/truncate it. */}
        {expanded && (
          <div className="space-y-4">
            {groupSlotsByDateAndPart(turn.slots).map((group) => (
              <div key={group.dateKey}>
                <p className="font-display text-sm font-medium text-ink-900">
                  {group.dayLabel} · {group.dateLabel}
                </p>
                {group.buckets.map((bucket) => (
                  <div key={bucket.label} className="mt-2">
                    <p className="text-[11px] uppercase tracking-[0.14em] text-ink-400">
                      {bucket.label}
                    </p>
                    <div className="mt-1.5 flex flex-wrap gap-1.5">
                      {bucket.slots.map((slot) => (
                        <button
                          key={slot.id}
                          type="button"
                          onClick={() => onSlotPick(slot)}
                          className="min-h-[40px] rounded-xl border border-ink-100 bg-cream-50 px-3.5 py-2 font-display text-[15px] font-medium text-ink-900 transition hover:border-ink-300 hover:shadow-soft active:scale-[0.98]"
                        >
                          {slot.timeLabel}
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            ))}
          </div>
        )}

        {/* See all — progressive disclosure into the full schedule. */}
        {hasReco && !expanded && turn.seeAllLabel && (
          <button
            type="button"
            onClick={() => setShowAllTimes(true)}
            className="min-h-[40px] w-full rounded-xl border border-ink-200 bg-cream-50 px-4 py-2.5 text-sm font-medium text-ink-700 transition hover:border-ink-300 active:scale-[0.99]"
          >
            {turn.seeAllLabel}
          </button>
        )}

        {/* Collapse back to recommendations (only when reco exists). */}
        {hasReco && expanded && showAllTimes && (
          <button
            type="button"
            onClick={() => setShowAllTimes(false)}
            className="min-h-[40px] w-full rounded-xl border border-ink-200 bg-cream-50 px-4 py-2.5 text-sm font-medium text-ink-700 transition hover:border-ink-300 active:scale-[0.99]"
          >
            Show recommended times
          </button>
        )}

        {hasAnyChips && (
          <div className="space-y-2 pt-1">
            <p className="text-[11px] uppercase tracking-[0.14em] text-ink-400">
              Looking for something else?
            </p>

            {navChips.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {navChips.map((c) => (
                  <NavChip
                    key={c.key}
                    label={c.label}
                    onClick={() =>
                      onNavChip(
                        c.key,
                        turn.anchorDateKey,
                        turn.currentWeekShift
                      )
                    }
                  />
                ))}
              </div>
            )}

            {rangeChips.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {rangeChips.map((c) => (
                  <NavChip
                    key={c.key}
                    label={c.label}
                    variant={c.key === "see-all" ? "ghost" : "default"}
                    onClick={() =>
                      onNavChip(
                        c.key,
                        turn.anchorDateKey,
                        turn.currentWeekShift
                      )
                    }
                  />
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    );
  }

  if (turn.kind === "consult-cta") {
    return (
      <div className="animate-fade-up">
        <button
          type="button"
          onClick={onConsultationCta}
          className="w-full rounded-2xl bg-accent-soft/70 p-4 text-left transition hover:bg-accent-soft"
        >
          <p className="text-xs font-medium uppercase tracking-[0.14em] text-accent-dark">
            Consultation
          </p>
          <p className="mt-1 text-[15px] font-medium text-ink-900">
            Pick a quick consult time →
          </p>
          {turn.reason && (
            <p className="mt-1 text-xs text-ink-600">{turn.reason}</p>
          )}
        </button>
      </div>
    );
  }

  if (turn.kind === "custom-cta") {
    return (
      <div className="animate-fade-up">
        <button
          type="button"
          onClick={onCustomCta}
          className="w-full rounded-2xl border border-dashed border-ink-200 bg-cream-50 p-4 text-left text-sm text-ink-600 hover:border-ink-300 hover:text-ink-900"
        >
          Sounds custom — message {stylistName} directly →
        </button>
      </div>
    );
  }

  if (turn.kind === "appointment-list") {
    const selectable = !turn.consumed && turn.appointments.length > 1;
    return (
      <div className="animate-fade-up space-y-2">
        {turn.appointments.map((appt) => (
          <AppointmentCard
            key={appt.id}
            appointment={appt}
            variant="client"
            onClick={
              selectable ? () => onAppointmentPick(turn.id, appt) : undefined
            }
          />
        ))}
      </div>
    );
  }

  if (turn.kind === "manage-chips") {
    if (turn.consumed) return null;
    return (
      <div className="animate-fade-up">
        <div className="flex flex-wrap gap-2">
          {turn.chips.map((chip) => (
            <button
              key={chip.key}
              type="button"
              onClick={() => onManageChip(turn.id, chip.key)}
              className="rounded-full border border-ink-200 bg-cream-50 px-3.5 py-1.5 text-sm font-medium text-ink-800 transition hover:border-ink-300 hover:bg-cream-100 active:scale-[0.98]"
            >
              {chip.label}
            </button>
          ))}
        </div>
      </div>
    );
  }

  return null;
}

/* -------------------------------------------------------------------------- */
/* Bubbles                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Small navigation chip rendered below a slot grid. Quiet visual weight by
 * design — these are discovery affordances, not primary actions. The slot
 * grid stays the focal point.
 */
function NavChip({
  label,
  onClick,
  variant = "default",
}: {
  label: string;
  onClick: () => void;
  variant?: "default" | "ghost";
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "rounded-full px-3 py-1.5 text-[13px] font-medium transition active:scale-[0.98]",
        variant === "default"
          ? "border border-ink-200 bg-cream-50 text-ink-700 hover:border-ink-300 hover:text-ink-900"
          : "border border-dashed border-ink-200 bg-transparent text-ink-500 hover:border-ink-300 hover:text-ink-700"
      )}
    >
      {label}
    </button>
  );
}

/* -------------------------------------------------------------------------- */
/* Handoff card — name + phone + editable summary + Send                      */
/*                                                                             */
/* Rendered when a chat response decides the request needs Shen directly.    */
/* The form collects required name/phone (+ optional email), lets the user   */
/* tweak the auto-generated summary, and posts to /api/handoff. Marks the    */
/* turn submitted on success so the user can't double-send.                  */
/* -------------------------------------------------------------------------- */

function HandoffCard({
  turn,
  stylistName,
  onSubmit,
}: {
  turn: Extract<AssistantTurn, { kind: "handoff" }>;
  stylistName: string;
  onSubmit: (data: {
    clientName: string;
    clientPhone: string;
    clientEmail: string;
    summary: string;
    sourceMessage: string;
  }) => Promise<boolean>;
}) {
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [summary, setSummary] = useState(turn.summary);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canSubmit =
    !submitting &&
    !turn.submitted &&
    name.trim().length > 0 &&
    phone.replace(/\D/g, "").length >= 7 &&
    summary.trim().length > 0;

  async function handleSend() {
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);
    try {
      const ok = await onSubmit({
        clientName: name.trim(),
        clientPhone: phone,
        clientEmail: email.trim(),
        summary: summary.trim(),
        sourceMessage: turn.sourceMessage,
      });
      if (!ok) {
        setError(
          `Something went wrong. Try again, or message ${stylistName} directly.`
        );
      }
    } catch {
      setError(
        `Something went wrong. Try again, or message ${stylistName} directly.`
      );
    } finally {
      setSubmitting(false);
    }
  }

  if (turn.submitted) {
    return (
      <div className="animate-fade-up rounded-2xl border border-ink-100 bg-cream-50 p-4">
        <p className="text-[13px] font-medium text-ink-900">
          Sent to {stylistName}.
        </p>
        <p className="mt-1 text-[12px] text-ink-600">
          She'll get back to you on the phone number you provided.
        </p>
      </div>
    );
  }

  return (
    <div className="animate-fade-up rounded-2xl border border-ink-200 bg-cream-50 p-4">
      <p className="text-[12px] uppercase tracking-[0.14em] text-ink-500">
        Send to {stylistName}
      </p>
      <p className="mt-1 text-[13px] text-ink-600">
        I'll send {stylistName} a quick summary so she can get back to you.
      </p>

      <div className="mt-3 space-y-2">
        <label className="block">
          <span className="text-[11px] font-medium uppercase tracking-[0.14em] text-ink-500">
            Your name
          </span>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Jane Park"
            className="mt-1 w-full rounded-xl border border-ink-200 bg-cream-50 px-3 py-2 text-[14px] text-ink-900 placeholder:text-ink-400 focus:border-ink-900 focus:outline-none"
          />
        </label>
        <label className="block">
          <span className="text-[11px] font-medium uppercase tracking-[0.14em] text-ink-500">
            Phone
          </span>
          <input
            type="tel"
            inputMode="numeric"
            autoComplete="tel-national"
            value={phone}
            onChange={(e) => setPhone(formatPhoneAsTyped(e.target.value))}
            placeholder="(555) 123-4567"
            className="mt-1 w-full rounded-xl border border-ink-200 bg-cream-50 px-3 py-2 text-[14px] text-ink-900 placeholder:text-ink-400 focus:border-ink-900 focus:outline-none"
          />
        </label>
        <label className="block">
          <span className="text-[11px] font-medium uppercase tracking-[0.14em] text-ink-500">
            Email <span className="text-ink-400">(optional)</span>
          </span>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="jane@example.com"
            className="mt-1 w-full rounded-xl border border-ink-200 bg-cream-50 px-3 py-2 text-[14px] text-ink-900 placeholder:text-ink-400 focus:border-ink-900 focus:outline-none"
          />
        </label>
        <label className="block">
          <span className="text-[11px] font-medium uppercase tracking-[0.14em] text-ink-500">
            Message
          </span>
          <textarea
            value={summary}
            onChange={(e) => setSummary(e.target.value)}
            rows={4}
            className="mt-1 w-full resize-none rounded-xl border border-ink-200 bg-cream-50 px-3 py-2 text-[14px] leading-snug text-ink-900 placeholder:text-ink-400 focus:border-ink-900 focus:outline-none"
          />
        </label>
      </div>

      {error && (
        <p role="alert" className="mt-2 text-[12px] text-red-700">
          {error}
        </p>
      )}

      <button
        type="button"
        onClick={handleSend}
        disabled={!canSubmit}
        className={cn(
          "mt-3 w-full min-h-[44px] rounded-full px-4 py-2 text-[14px] font-medium transition",
          canSubmit
            ? "bg-ink-900 text-cream-50 hover:bg-ink-800"
            : "cursor-not-allowed bg-cream-200 text-ink-400"
        )}
      >
        {submitting ? "Sending…" : `Send to ${stylistName}`}
      </button>
    </div>
  );
}

function BotBubble({ children }: { children: React.ReactNode }) {
  return (
    <div className="max-w-[88%] whitespace-pre-line break-words rounded-2xl rounded-tl-sm bg-cream-100 px-3.5 py-2.5 text-[14.5px] leading-relaxed text-ink-800 animate-fade-up">
      {children}
    </div>
  );
}

/**
 * Transient "Shen is typing…" bubble: context-aware label + three pulsing dots.
 * Matches BotBubble styling so it reads as Shen composing a reply. Pure
 * presentation — shown only while a response is in flight.
 */
function TypingBubble({ label }: { label: string }) {
  return (
    <div className="flex max-w-[88%] items-center gap-2 rounded-2xl rounded-tl-sm bg-cream-100 px-3.5 py-2.5 animate-fade-up">
      <span className="flex gap-1" aria-hidden>
        <span className="h-1.5 w-1.5 rounded-full bg-ink-400 animate-pulse [animation-delay:0ms]" />
        <span className="h-1.5 w-1.5 rounded-full bg-ink-400 animate-pulse [animation-delay:150ms]" />
        <span className="h-1.5 w-1.5 rounded-full bg-ink-400 animate-pulse [animation-delay:300ms]" />
      </span>
      <span className="text-[13px] italic text-ink-500">{label}</span>
    </div>
  );
}

/**
 * Tiny gray label under bot bubbles — only visible when the local debug
 * flag is on (`localStorage.kasa_debug = "1"`). Useful for verifying
 * which routing path produced a given response during testing. Never
 * touches env vars, never visible in production unless the user
 * explicitly sets the key.
 *
 * Source values:
 *   - "deterministic-facts+ai" — AI replied using deterministic facts
 *   - "deterministic-fallback" — AI failed, fell back to deterministic FAQ
 *   - "ai" — pure AI response, no deterministic match upstream
 *   - "fallback" — safe generic message (AI unavailable, no FAQ match)
 *   - "cached" — 5s dedup cache hit, didn't call AI again
 */
function DebugSourceLabel({ source }: { source?: string }) {
  // useState so the label is reactive — toggling localStorage at runtime
  // updates without a refresh. Hydration-safe: starts false, runs once
  // on mount to read the actual flag.
  const [debugOn, setDebugOn] = useState(false);
  useEffect(() => {
    setDebugOn(isLocalDebugOn());
  }, []);
  if (!debugOn || !source) return null;
  return (
    <p className="mt-1 ml-1 text-[10px] font-mono text-ink-400">
      source: {source}
    </p>
  );
}

function UserBubble({ children }: { children: React.ReactNode }) {
  return (
    <div className="ml-auto max-w-[88%] break-words rounded-2xl rounded-tr-sm bg-ink-900 px-3.5 py-2.5 text-[14.5px] leading-relaxed text-cream-50 animate-fade-up">
      {children}
    </div>
  );
}

function RecommendationBubble({
  turn,
  onBookThis,
  onShowAlternates,
  stylistName,
}: {
  turn: Extract<AssistantTurn, { kind: "recommendation" }>;
  onBookThis: () => void;
  onShowAlternates: () => void;
  stylistName: string;
}) {
  const { rec, ackText, acted } = turn;
  const hasAdditional = rec.additionalServices.length > 0;
  const additionalNames = rec.additionalServices
    .map((s) => shortServiceName(s.name))
    .join(" + ");
  const ctaLabel = hasAdditional
    ? `Book ${shortServiceName(rec.primary.name)} + ${additionalNames}`
    : "Book this";

  // For multi-service, compute the estimated total via the unified helper
  // so the rec bubble matches confirmation/details and preserves "+" suffix.
  const recCtx = {
    selectedService: rec.primary,
    selectedSlot: null,
    additionalServices: rec.additionalServices,
    bookingNotes: "",
    lastRecommendedService: null,
    lastShownSlots: [],
    lastAnchorDateKey: null,
    lastIntentTags: [],
    lastIntentColorDirection: null,
    lastIntentTimeHints: emptyHints(),
    pendingClarification: null,
    pendingSwitch: null,
    pendingFuzzy: null,
    pendingAdditionalService: null,
  } as AssistantContext;
  const totalPriceInfo = hasAdditional
    ? getEstimatedTotalPrice(recCtx)
    : { label: null, total: null, hasPlus: false };

  return (
    <div className="max-w-[92%] space-y-2.5 rounded-2xl rounded-tl-sm bg-cream-100 px-3.5 py-3 animate-fade-up">
      <p className="text-[14.5px] leading-relaxed text-ink-800">{ackText}</p>

      <div className="rounded-xl border border-ink-200/70 bg-cream-50 px-3.5 py-2.5">
        {hasAdditional ? (
          <>
            {/* Per-service line items so the user sees exactly what they're
                being booked for and what each piece costs. */}
            <ServiceLineItem service={rec.primary} role="primary" />
            {rec.additionalServices.map((s) => (
              <ServiceLineItem key={s.id} service={s} role="addon" />
            ))}
            {totalPriceInfo.label && (
              <div className="mt-1.5 flex items-center justify-between border-t border-ink-200/50 pt-1.5">
                <span className="text-[13px] font-medium text-ink-900">
                  Estimated total
                </span>
                <span className="text-[13px] font-medium text-ink-900">
                  {totalPriceInfo.label}
                </span>
              </div>
            )}
            <p className="mt-2 text-[12px] italic text-ink-500">
              Slot sized for {shortServiceName(rec.primary.name)}; {stylistName} confirms
              the {shortServiceName(rec.additionalServices[0].name).toLowerCase()}{" "}
              add-on.
            </p>
          </>
        ) : (
          <>
            <p className="text-[15px] font-medium text-ink-900">
              {rec.primary.name}
            </p>
            <p className="mt-0.5 text-xs text-ink-500">
              {rec.primary.priceLabel}
              <span className="px-1.5 text-ink-300">·</span>
              {rec.primary.durationLabel}
            </p>
            <p className="mt-1.5 text-[12.5px] italic text-ink-500">
              {rec.reason}
            </p>
          </>
        )}
      </div>

      {!acted && (
        <div className="flex flex-wrap gap-2 pt-0.5">
          <button
            type="button"
            onClick={onBookThis}
            className="rounded-full bg-ink-900 px-3.5 py-1.5 text-[13px] font-medium text-cream-50 hover:bg-ink-800 active:scale-[0.98]"
          >
            {ctaLabel}
          </button>
          {rec.alternates.length > 0 && (
            <button
              type="button"
              onClick={onShowAlternates}
              className="rounded-full border border-ink-200 bg-cream-50 px-3.5 py-1.5 text-[13px] font-medium text-ink-800 hover:border-ink-300 hover:bg-cream-50 active:scale-[0.98]"
            >
              Show other options
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * One service row in the multi-service recommendation card. The primary row
 * shows duration too; addon rows are price-only since the slot is sized for
 * the primary.
 */
function ServiceLineItem({
  service,
  role,
}: {
  service: Service;
  role: "primary" | "addon";
}) {
  return (
    <div className="flex items-center justify-between gap-3 py-0.5 first:mt-0">
      <div className="min-w-0">
        <p className="text-[14px] font-medium text-ink-900">{service.name}</p>
        {role === "primary" && (
          <p className="text-[11.5px] text-ink-500">{service.durationLabel}</p>
        )}
        {role === "addon" && (
          <p className="text-[11.5px] text-ink-500">add-on, noted on booking</p>
        )}
      </div>
      <span className="shrink-0 text-[13.5px] font-medium text-ink-700">
        {service.priceLabel}
      </span>
    </div>
  );
}

/**
 * Strip "Shen's" / category prefixes from service names for compact CTAs.
 * "Medium / Long Hair Cut" → "Haircut" via heuristic — the CTA is short and
 * the full name lives in the bubble title above.
 */
function shortServiceName(full: string): string {
  if (/hair\s*cut/i.test(full)) return "Haircut";
  if (/full\s*color/i.test(full)) return "Full Color";
  if (/root\s*touch/i.test(full)) return "Root Touch-up";
  if (/head\s*spa/i.test(full)) return "Head Spa";
  if (/perm/i.test(full)) return "Perm";
  if (/treatment/i.test(full)) return "Treatment";
  return full;
}

/* -------------------------------------------------------------------------- */
/* Time stage (full picker)                                                    */
/* -------------------------------------------------------------------------- */

function TimeStage({
  service,
  slug,
  onPick,
  onBack,
}: {
  service: Service;
  slug?: string;
  timeHints: TimeHints;
  onPick: (slot: TimeSlot) => void;
  onBack: () => void;
}) {
  // Real availability from /api/availability. null = loading; [] = loaded but
  // no openings (honest empty state). For slug providers, getRealSlots never
  // returns mock; for the legacy slug-less demo it falls back to mock.
  const [loadedSlots, setLoadedSlots] = useState<TimeSlot[] | null>(null);
  useEffect(() => {
    let cancelled = false;
    setLoadedSlots(null);
    getRealSlots(service.id, slug).then((s) => {
      if (!cancelled) setLoadedSlots(s);
    });
    return () => {
      cancelled = true;
    };
  }, [service.id, slug]);

  // Downstream week-bucketing logic operates on an array; use [] while loading
  // (we render a loading state separately below before the slot grid).
  const allSlots = loadedSlots ?? [];

  // Week tab state. 0 = this week (starting today), 1 = next week, 2 = in two
  // weeks. Defaults to whichever week the earliest available slot falls in,
  // so the user sees real availability immediately rather than an empty "this
  // week" if all open slots are further out.
  const todayKey = useMemo(() => {
    const d = new Date();
    const y = d.getFullYear();
    const mo = String(d.getMonth() + 1).padStart(2, "0");
    const da = String(d.getDate()).padStart(2, "0");
    return `${y}-${mo}-${da}`;
  }, []);

  function weekIndexFor(dateKey: string): number {
    // Day delta from today, divided by 7. Slots are always in the future so
    // the result is non-negative. Anything past week 2 is clamped to 2.
    const a = new Date(`${dateKey}T12:00:00`).getTime();
    const b = new Date(`${todayKey}T12:00:00`).getTime();
    const days = Math.floor((a - b) / (24 * 60 * 60 * 1000));
    if (days < 7) return 0;
    if (days < 14) return 1;
    return 2;
  }

  const slotsByWeek = useMemo(() => {
    const buckets: [TimeSlot[], TimeSlot[], TimeSlot[]] = [[], [], []];
    for (const s of allSlots) {
      const idx = weekIndexFor(s.dateKey);
      buckets[idx].push(s);
    }
    return buckets;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allSlots, todayKey]);

  const defaultWeek = useMemo(() => {
    if (slotsByWeek[0].length > 0) return 0;
    if (slotsByWeek[1].length > 0) return 1;
    if (slotsByWeek[2].length > 0) return 2;
    return 0;
  }, [slotsByWeek]);

  const [activeWeek, setActiveWeek] = useState<number>(defaultWeek);

  // If the underlying slots change (e.g. user picks a different service via
  // Change) and the active week is empty, hop to the first week with slots.
  useEffect(() => {
    if (slotsByWeek[activeWeek].length === 0) {
      setActiveWeek(defaultWeek);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [defaultWeek]);

  const visibleSlots = slotsByWeek[activeWeek];

  // Group within the active week, preserving chronological order. Empty days
  // are automatically excluded because we only iterate over what's in
  // visibleSlots — no day appears unless it has at least one slot.
  const grouped = useMemo(() => {
    const groups = new Map<string, TimeSlot[]>();
    visibleSlots.forEach((s) => {
      const key = `${s.dayLabel}, ${s.dateLabel}`;
      const arr = groups.get(key) ?? [];
      arr.push(s);
      groups.set(key, arr);
    });
    return Array.from(groups.entries());
  }, [visibleSlots]);

  // Date-first navigation (Square-style): pick a DAY, then see only that day's
  // times — instead of stacking every day's wall of slots. activeDay indexes
  // into `grouped`. Reset to the first day whenever the week (and thus the day
  // list) changes, clamped so it never points past the available days.
  const [activeDay, setActiveDay] = useState(0);
  useEffect(() => {
    setActiveDay(0);
  }, [activeWeek]);
  const safeActiveDay = activeDay < grouped.length ? activeDay : 0;
  const activeDaySlots = grouped[safeActiveDay]?.[1] ?? [];

  const weekTabs: { idx: number; label: string }[] = [
    { idx: 0, label: "This week" },
    { idx: 1, label: "Next week" },
    { idx: 2, label: "In 2 weeks" },
  ];

  return (
    <div className="animate-fade-up">
      <BackBar onBack={onBack} />
      {/* Sticky service context — stays at the top while the slot list scrolls
          so the user always sees what they're picking time for. The translucent
          backdrop keeps it legible over the long list. */}
      <div className="sticky top-0 z-10 -mx-5 bg-cream-50/90 px-5 pt-1 pb-3 backdrop-blur supports-[backdrop-filter]:bg-cream-50/70 sm:-mx-8 sm:px-8">
        <ServiceContextBar service={service} />
      </div>
      <h1 className="mt-4 font-display text-2xl font-medium tracking-tight text-ink-900">
        Pick a time
      </h1>
      <p className="mt-1 text-sm text-ink-500">All available openings.</p>

      {/* Loading state — real availability is being fetched. Skeleton grid
          mirrors the real slot layout so it reads as loading, not broken. */}
      {loadedSlots === null && (
        <>
          <p className="mt-6 text-sm text-ink-400">Finding openings…</p>
          <TimeSlotGridSkeleton count={6} />
        </>
      )}

      {/* Loaded but ZERO openings across all weeks — honest empty state, not
          mock, not blank. */}
      {loadedSlots !== null && allSlots.length === 0 && (
        <div className="mt-6 rounded-2xl border border-dashed border-ink-200 bg-cream-50 p-5 text-center">
          <p className="text-sm font-medium text-ink-700">No openings right now</p>
          <p className="mt-1 text-sm text-ink-500">
            {sName()} has no available times in the next few weeks. Check back
            soon, or message {sName()} directly.
          </p>
        </div>
      )}

      {/* Week tabs + slot grid — only when we have real slots. */}
      {loadedSlots !== null && allSlots.length > 0 && (
      <>
      {/* Week tabs */}
      <div className="mt-4 flex gap-2 overflow-x-auto" role="tablist">
        {weekTabs.map((t) => {
          const count = slotsByWeek[t.idx].length;
          const disabled = count === 0;
          const active = t.idx === activeWeek;
          return (
            <button
              key={t.idx}
              type="button"
              role="tab"
              aria-selected={active}
              disabled={disabled}
              onClick={() => setActiveWeek(t.idx)}
              className={cn(
                "shrink-0 rounded-full border px-4 py-1.5 text-[13px] font-medium transition",
                active
                  ? "border-ink-900 bg-ink-900 text-cream-50"
                  : disabled
                  ? "cursor-not-allowed border-ink-100 bg-cream-50 text-ink-300"
                  : "border-ink-200 bg-cream-50 text-ink-700 hover:border-ink-400"
              )}
            >
              {t.label}
              {!disabled && (
                <span className={cn("ml-1.5", active ? "text-cream-200" : "text-ink-400")}>
                  · {count}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {grouped.length === 0 ? (
        <p className="mt-6 text-sm text-ink-500">
          No openings this week. Try another week.
        </p>
      ) : (
        <>
          {/* DAY STRIP — date-first navigation. Tap a day to see only its
              times (Square-style), instead of stacking every day's wall of
              slots. Horizontal-scroll on narrow screens. */}
          <div
            className="mt-4 flex gap-2 overflow-x-auto pb-1"
            role="tablist"
            aria-label="Choose a day"
          >
            {grouped.map(([day, daySlots], i) => {
              const active = i === safeActiveDay;
              // "Fri, Jun 19" → top line "Fri", bottom "Jun 19".
              const [dow, date] = day.split(", ");
              return (
                <button
                  key={day}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  onClick={() => setActiveDay(i)}
                  className={cn(
                    "flex shrink-0 flex-col items-center rounded-2xl border px-3.5 py-2 transition",
                    active
                      ? "border-ink-900 bg-ink-900 text-cream-50"
                      : "border-ink-100 bg-cream-50 text-ink-700 hover:border-ink-300"
                  )}
                >
                  <span className="text-[13px] font-medium leading-tight">{dow}</span>
                  <span className={cn("text-[11px] leading-tight", active ? "text-cream-50/80" : "text-ink-400")}>
                    {date}
                  </span>
                  <span className={cn("mt-0.5 text-[10px] leading-none", active ? "text-cream-50/70" : "text-ink-400")}>
                    {daySlots.length} {daySlots.length === 1 ? "time" : "times"}
                  </span>
                </button>
              );
            })}
          </div>

          {/* Selected day heading + that day's times in a UNIFORM grid — every
              cell the same size (no last-row stretching), equal tap targets for
              accessibility, full time labels (no truncation). Responsive
              3→4→5 columns by width. */}
          <p className="mt-5 font-display text-sm font-medium text-ink-900">
            {grouped[safeActiveDay]?.[0]}
          </p>
          <div className="mt-3 grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-5">
            {activeDaySlots.map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => onPick(s)}
                className="flex min-h-[48px] items-center justify-center rounded-xl border border-ink-100 bg-cream-50 px-2 py-2.5 text-center font-display text-[15px] font-medium text-ink-900 transition hover:border-ink-300 hover:shadow-soft active:scale-[0.98]"
              >
                {s.timeLabel}
              </button>
            ))}
          </div>
        </>
      )}
      </>
      )}
    </div>
  );
}

function ServiceContextBar({
  service,
  additional,
}: {
  service: Service;
  additional?: Service[];
}) {
  const additionals = additional ?? [];
  const hasAdditional = additionals.length > 0;
  return (
    <div className="rounded-2xl border border-ink-100 bg-cream-100/60 p-4">
      <p className="text-xs uppercase tracking-[0.14em] text-ink-500">
        Booking
      </p>
      <div className="mt-1 flex items-baseline justify-between gap-3">
        <p className="min-w-0 truncate text-[15px] font-medium text-ink-900">{service.name}</p>
        <p className="shrink-0 whitespace-nowrap text-sm text-ink-600">
          {service.priceLabel}
          <span className="px-1.5 text-ink-300">·</span>
          {service.durationLabel}
        </p>
      </div>
      {hasAdditional && additionals.map((s) => (
        <div
          key={s.id}
          className="mt-1 flex items-baseline justify-between gap-3"
        >
          <p className="min-w-0 truncate text-[15px] font-medium text-ink-900">{s.name}</p>
          <p className="shrink-0 whitespace-nowrap text-sm text-ink-600">
            {s.priceLabel}
            <span className="px-1.5 text-ink-300">·</span>
            {s.durationLabel}
          </p>
        </div>
      ))}
    </div>
  );
}

function BackBar({ onBack }: { onBack: () => void }) {
  return (
    <button
      type="button"
      onClick={onBack}
      className="-mt-2 mb-3 inline-flex items-center gap-1 text-sm text-ink-500 hover:text-ink-900"
    >
      <span aria-hidden>←</span> Back
    </button>
  );
}

/* -------------------------------------------------------------------------- */
/* Details                                                                     */
/* -------------------------------------------------------------------------- */

type ClientInfo = { name: string; phone: string; email: string; notes: string };

function DetailsStage({
  service,
  additionalServices,
  slot,
  prefilledNotes,
  prefilledClientInfo,
  onConfirm,
  onBack,
  stylistName,
  stylistLocation,
}: {
  service: Service;
  additionalServices: Service[];
  slot: TimeSlot;
  prefilledNotes?: string;
  // When returning from ReviewStage via "Change details," the parent passes
  // back the previously-entered values so the user doesn't re-type.
  prefilledClientInfo?: ClientInfo | null;
  // Now a transition only — actual booking happens in ReviewStage. The
  // parent stores the info and advances stage to "review".
  onConfirm: (clientInfo: ClientInfo) => void;
  onBack: () => void;
  stylistName: string;
  stylistLocation: string;
}) {
  const [name, setName] = useState(prefilledClientInfo?.name ?? "");
  const [phone, setPhone] = useState(prefilledClientInfo?.phone ?? "");
  const [email, setEmail] = useState(prefilledClientInfo?.email ?? "");
  const [notes, setNotes] = useState(
    prefilledClientInfo?.notes ?? prefilledNotes ?? ""
  );
  const canConfirm = name.trim().length > 0 && phone.trim().length >= 7;

  function handleSubmit() {
    if (!canConfirm) return;
    onConfirm({ name, phone, email, notes });
  }

  const hasAdditional = additionalServices.length > 0;

  // Build a synthetic context for the summary helpers — DetailsStage runs as
  // a top-level child without access to the parser context. We feed in the
  // primary + additionals to produce the same totals.
  const summaryContext = {
    selectedService: service,
    selectedSlot: slot,
    additionalServices,
    bookingNotes: notes,
    lastRecommendedService: null,
    lastShownSlots: [],
    lastAnchorDateKey: null,
    lastIntentTags: [],
    lastIntentColorDirection: null,
    lastIntentTimeHints: emptyHints(),
    pendingClarification: null,
    pendingSwitch: null,
    pendingFuzzy: null,
    pendingAdditionalService: null,
  } as AssistantContext;
  const totalPrice = getEstimatedTotalPrice(summaryContext);
  const totalDuration = getEstimatedTotalDuration(summaryContext);

  return (
    <div className="animate-fade-up">
      <BackBar onBack={onBack} />
      <ServiceContextBar service={service} additional={additionalServices} />

      <div className="mt-3 rounded-2xl border border-ink-100 bg-cream-100/60 p-4">
        <p className="text-xs uppercase tracking-[0.14em] text-ink-500">Time</p>
        <p className="mt-1 text-[15px] font-medium text-ink-900">
          {slot.dayLabel}, {slot.dateLabel} · {slot.timeLabel}
        </p>
        {hasAdditional && (
          <>
            <p className="mt-3 text-xs uppercase tracking-[0.14em] text-ink-500">
              Estimated time
            </p>
            <p className="mt-1 text-[15px] text-ink-700">
              about {totalDuration.label}
            </p>
            {totalPrice.label && (
              <>
                <p className="mt-3 text-xs uppercase tracking-[0.14em] text-ink-500">
                  Estimated total
                </p>
                <p className="mt-1 text-[15px] text-ink-700">
                  {totalPrice.label}
                </p>
              </>
            )}
            <p className="mt-3 text-xs text-ink-500">
              {additionalServices.map((s) => s.name).join(" and ")} added to
              appointment notes for {stylistName} to confirm.
            </p>
          </>
        )}
      </div>

      <h1 className="mt-6 font-display text-2xl font-medium tracking-tight text-ink-900">
        Your details
      </h1>
      <p className="mt-1 text-sm text-ink-500">
        We&apos;ll text you a confirmation. No account needed.
      </p>

      <div className="mt-6 space-y-3">
        <Field label="Full name" required>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Jane Park"
            className="w-full rounded-xl border border-ink-200 bg-cream-50 px-4 py-3 text-[15px] text-ink-900 placeholder:text-ink-400 focus:border-ink-900 focus:outline-none"
          />
        </Field>
        <Field label="Phone" required>
          <input
            type="tel"
            inputMode="numeric"
            autoComplete="tel-national"
            value={phone}
            onChange={(e) => setPhone(formatPhoneAsTyped(e.target.value))}
            placeholder="(555) 123-4567"
            className="w-full rounded-xl border border-ink-200 bg-cream-50 px-4 py-3 text-[15px] text-ink-900 placeholder:text-ink-400 focus:border-ink-900 focus:outline-none"
          />
        </Field>
        <Field label="Email" hint="optional">
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="jane@example.com"
            className="w-full rounded-xl border border-ink-200 bg-cream-50 px-4 py-3 text-[15px] text-ink-900 placeholder:text-ink-400 focus:border-ink-900 focus:outline-none"
          />
        </Field>
        <Field label="Anything I should know?" hint="optional">
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={3}
            placeholder="Reference photo, allergies, parking notes..."
            className="w-full resize-none rounded-xl border border-ink-200 bg-cream-50 px-4 py-3 text-[15px] text-ink-900 placeholder:text-ink-400 focus:border-ink-900 focus:outline-none"
          />
        </Field>
      </div>

      <button
        type="button"
        onClick={handleSubmit}
        disabled={!canConfirm}
        className={cn(
          "mt-8 w-full rounded-full px-6 py-4 text-[15px] font-medium transition",
          canConfirm
            ? "bg-ink-900 text-cream-50 hover:bg-ink-800"
            : "cursor-not-allowed bg-cream-200 text-ink-400"
        )}
      >
        Continue to review
      </button>
    </div>
  );
}

function Field({
  label,
  required,
  hint,
  children,
}: {
  label: string;
  required?: boolean;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <div className="mb-1.5 flex items-baseline justify-between">
        <span className="text-sm font-medium text-ink-800">
          {label}
          {required && <span className="ml-1 text-accent">*</span>}
        </span>
        {hint && <span className="text-xs text-ink-400">{hint}</span>}
      </div>
      {children}
    </label>
  );
}

/* -------------------------------------------------------------------------- */
/* Review                                                                      */
/*                                                                             */
/* Sits between DetailsStage and the booking POST. Surfaces the appointment    */
/* summary, location, client info, and cancellation policy so the user can     */
/* verify before committing. Owns the actual booking submission, the error    */
/* state, and all analytics calls associated with the booking attempt.        */
/* -------------------------------------------------------------------------- */

function ReviewStage({
  service,
  additionalServices,
  slot,
  clientInfo,
  stylistName,
  stylistLocation,
  onChangeService,
  onChangeTime,
  onChangeDetails,
  onConfirm,
  onMessageStylist,
}: {
  service: Service;
  additionalServices: Service[];
  slot: TimeSlot;
  clientInfo: ClientInfo;
  stylistName: string;
  stylistLocation: string;
  onChangeService: () => void;
  onChangeTime: () => void;
  onChangeDetails: () => void;
  // Resolves true on success (parent already transitioned to confirmed),
  // false on failure (we show the error inline and let the user retry).
  onConfirm: () => Promise<boolean>;
  // Escape hatch when a booking fails — opens the handoff flow so the client
  // can message the stylist directly instead of being stuck.
  onMessageStylist?: () => void;
}) {
  const [submitting, setSubmitting] = useState(false);
  const [bookingError, setBookingError] = useState<string | null>(null);

  const summaryContext = {
    selectedService: service,
    selectedSlot: slot,
    additionalServices,
    bookingNotes: clientInfo.notes,
    lastRecommendedService: null,
    lastShownSlots: [],
    lastAnchorDateKey: null,
    lastIntentTags: [],
    lastIntentColorDirection: null,
    lastIntentTimeHints: emptyHints(),
    pendingClarification: null,
    pendingSwitch: null,
    pendingFuzzy: null,
    pendingAdditionalService: null,
  } as AssistantContext;
  const totalPrice = getEstimatedTotalPrice(summaryContext);
  const totalDuration = getEstimatedTotalDuration(summaryContext);
  const hasAdditional = additionalServices.length > 0;

  async function handleConfirm() {
    if (submitting) return;
    setSubmitting(true);
    setBookingError(null);
    try {
      const ok = await onConfirm();
      if (!ok) {
        setBookingError(
          `Something went wrong on our end — your booking wasn't placed. Try again, or contact ${stylistName} directly.`
        );
      }
    } catch {
      setBookingError(
        `Something went wrong on our end — your booking wasn't placed. Try again, or contact ${stylistName} directly.`
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="animate-fade-up">
      <BackBar onBack={onChangeDetails} />
      <h1 className="mt-2 font-display text-2xl font-medium tracking-tight text-ink-900">
        Review your appointment
      </h1>
      <p className="mt-1 text-sm text-ink-500">
        Double-check the details, then confirm.
      </p>

      {bookingError && (
        <div
          role="alert"
          className="mt-4 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800"
        >
          <p>{bookingError}</p>
          {onMessageStylist && (
            <button
              type="button"
              onClick={onMessageStylist}
              className="mt-2 inline-flex min-h-[44px] items-center rounded-full border border-red-300 bg-white px-4 text-sm font-medium text-red-700"
            >
              Message {stylistName} instead
            </button>
          )}
        </div>
      )}

      {/* Appointment summary */}
      <ReviewSection
        title="Appointment"
        onChange={onChangeService}
        changeLabel="Change service"
      >
        <p className="text-[15px] font-medium text-ink-900">{service.name}</p>
        <p className="mt-0.5 text-[13px] text-ink-600">
          {service.priceLabel}
          <span className="px-1.5 text-ink-300">·</span>
          {service.durationLabel}
        </p>
        {hasAdditional && (
          <div className="mt-2 space-y-1 border-t border-ink-100 pt-2">
            {additionalServices.map((s) => (
              <div key={s.id}>
                <p className="text-[14px] font-medium text-ink-900">{s.name}</p>
                <p className="text-[12px] text-ink-600">
                  {s.priceLabel}
                  <span className="px-1.5 text-ink-300">·</span>
                  {s.durationLabel}
                </p>
              </div>
            ))}
            {totalPrice.label && (
              <p className="mt-2 text-[13px] text-ink-700">
                Estimated total: {totalPrice.label} · about {totalDuration.label}
              </p>
            )}
          </div>
        )}
      </ReviewSection>

      {/* Time */}
      <ReviewSection
        title="Date & time"
        onChange={onChangeTime}
        changeLabel="Change time"
      >
        <p className="text-[15px] font-medium text-ink-900">
          {slot.dayLabel}, {slot.dateLabel}
        </p>
        <p className="mt-0.5 text-[13px] text-ink-600">{slot.timeLabel}</p>
      </ReviewSection>

      {/* Stylist + location */}
      <ReviewSection title="Stylist">
        <p className="text-[15px] font-medium text-ink-900">{stylistName}</p>
        {stylistLocation && (
          <p className="mt-0.5 text-[13px] text-ink-600">{stylistLocation}</p>
        )}
      </ReviewSection>

      {/* Client details */}
      <ReviewSection
        title="Your details"
        onChange={onChangeDetails}
        changeLabel="Change details"
      >
        <p className="text-[15px] font-medium text-ink-900">{clientInfo.name}</p>
        <p className="mt-0.5 text-[13px] text-ink-600">{clientInfo.phone}</p>
        {clientInfo.email && (
          <p className="mt-0.5 text-[13px] text-ink-600">{clientInfo.email}</p>
        )}
        {clientInfo.notes && (
          <p className="mt-2 rounded-lg bg-cream-100 p-2 text-[13px] italic text-ink-600">
            {clientInfo.notes}
          </p>
        )}
      </ReviewSection>

      {/* Cancellation policy */}
      <ReviewSection title="Cancellation policy">
        <p className="text-[13px] text-ink-600">
          Free cancellation up to 24 hours before your appointment.
        </p>
      </ReviewSection>

      <button
        type="button"
        onClick={handleConfirm}
        disabled={submitting}
        className={cn(
          "mt-8 w-full rounded-full px-6 py-4 text-[15px] font-medium transition",
          submitting
            ? "cursor-wait bg-cream-200 text-ink-400"
            : "bg-ink-900 text-cream-50 hover:bg-ink-800"
        )}
      >
        {submitting
          ? "Confirming…"
          : bookingError
          ? "Try again"
          : "Confirm appointment"}
      </button>
      <p className="mt-3 text-center text-xs text-ink-400">
        {clientInfo.email
          ? "You'll get a confirmation email shortly."
          : `By confirming, you agree to ${stylistName}'s cancellation policy.`}
      </p>
    </div>
  );
}

function ReviewSection({
  title,
  onChange,
  changeLabel,
  children,
}: {
  title: string;
  onChange?: () => void;
  changeLabel?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mt-4 rounded-2xl border border-ink-100 bg-cream-50 p-4">
      <div className="mb-2 flex items-baseline justify-between gap-3">
        <p className="text-xs uppercase tracking-[0.14em] text-ink-500">{title}</p>
        {onChange && (
          <button
            type="button"
            onClick={onChange}
            className="text-[12px] font-medium text-ink-600 underline-offset-2 hover:text-ink-900 hover:underline"
          >
            {changeLabel ?? "Change"}
          </button>
        )}
      </div>
      {children}
    </section>
  );
}

/* -------------------------------------------------------------------------- */
/* Reschedule review                                                           */
/*                                                                             */
/* Sits between TimeStage (in reschedule mode) and the actual swap. Shows the */
/* old appointment alongside the picked new time so the user can verify the   */
/* move before it commits. Only "Confirm reschedule" triggers the swap; the   */
/* user can back out to ManageLookupStage or pick a different time.           */
/* -------------------------------------------------------------------------- */

function RescheduleReviewStage({
  appointment,
  newSlot,
  stylistName,
  onConfirm,
  onKeepOriginal,
  onChangeTime,
}: {
  appointment: Appointment;
  newSlot: TimeSlot;
  stylistName: string;
  onConfirm: () => Promise<void> | void;
  onKeepOriginal: () => void;
  onChangeTime: () => void;
}) {
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleConfirm() {
    if (submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      await onConfirm();
    } catch {
      setError(
        "Something went wrong on our end. Try again, or contact " +
          `${stylistName} directly.`
      );
      setSubmitting(false);
    }
    // Note: on success the parent transitions stage, so we don't unset
    // submitting here — the component unmounts.
  }

  return (
    <div className="animate-fade-up">
      <BackBar onBack={onKeepOriginal} />
      <h1 className="mt-2 font-display text-2xl font-medium tracking-tight text-ink-900">
        Review your reschedule
      </h1>
      <p className="mt-1 text-sm text-ink-500">
        Confirm the new time for your appointment.
      </p>

      {error && (
        <div
          role="alert"
          className="mt-4 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800"
        >
          {error}
        </div>
      )}

      <ReviewSection title="Service">
        <p className="text-[15px] font-medium text-ink-900">
          {appointment.serviceName}
        </p>
        <p className="mt-0.5 text-[13px] text-ink-600">
          {appointment.durationLabel}
        </p>
      </ReviewSection>

      <ReviewSection title="From">
        <p className="text-[15px] font-medium text-ink-900">
          {appointment.dayLabel}
        </p>
        <p className="mt-0.5 text-[13px] text-ink-600">
          {appointment.timeLabel}
        </p>
      </ReviewSection>

      <ReviewSection
        title="To"
        onChange={onChangeTime}
        changeLabel="Change time"
      >
        <p className="text-[15px] font-medium text-ink-900">
          {newSlot.dayLabel}, {newSlot.dateLabel}
        </p>
        <p className="mt-0.5 text-[13px] text-ink-600">{newSlot.timeLabel}</p>
      </ReviewSection>

      <ReviewSection title="Stylist">
        <p className="text-[15px] font-medium text-ink-900">{stylistName}</p>
      </ReviewSection>

      <button
        type="button"
        onClick={handleConfirm}
        disabled={submitting}
        className={cn(
          "mt-8 w-full min-h-[48px] rounded-full px-6 py-4 text-[15px] font-medium transition",
          submitting
            ? "cursor-wait bg-cream-200 text-ink-400"
            : "bg-ink-900 text-cream-50 hover:bg-ink-800 active:bg-ink-700"
        )}
      >
        {submitting ? "Rescheduling…" : "Confirm reschedule"}
      </button>
      <button
        type="button"
        onClick={onKeepOriginal}
        disabled={submitting}
        className="mt-2 w-full min-h-[44px] rounded-full border border-ink-200 bg-cream-50 px-6 py-3 text-[14px] font-medium text-ink-700 transition hover:border-ink-400"
      >
        Keep original time
      </button>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Confirmed                                                                   */
/* -------------------------------------------------------------------------- */

function ConfirmedStage({
  service,
  additionalServices,
  slot,
  onDone,
  stylistName,
  stylistLocation,
}: {
  service: Service;
  additionalServices: Service[];
  slot: TimeSlot;
  onDone: () => void;
  stylistName: string;
  stylistLocation: string;
}) {
  const hasAdditional = additionalServices.length > 0;

  // Use the unified summary helpers so the confirmation matches what the
  // user saw in DetailsStage and what the assistant said in chat.
  const summaryContext = {
    selectedService: service,
    selectedSlot: slot,
    additionalServices,
    bookingNotes: "",
    lastRecommendedService: null,
    lastShownSlots: [],
    lastAnchorDateKey: null,
    lastIntentTags: [],
    lastIntentColorDirection: null,
    lastIntentTimeHints: emptyHints(),
    pendingClarification: null,
    pendingSwitch: null,
    pendingFuzzy: null,
    pendingAdditionalService: null,
  } as AssistantContext;
  const summary = formatCombinedBookingSummary(summaryContext);

  return (
    <div className="animate-fade-up text-center">
      <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-success-soft">
        <svg
          className="h-7 w-7 text-success"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden
        >
          <path d="M5 12.5L10 17.5L19 7.5" />
        </svg>
      </div>
      <h1 className="mt-5 font-display text-3xl font-medium tracking-tight text-ink-900">
        You&apos;re booked
      </h1>
      <p className="mt-2 text-[15px] text-ink-500">
        Confirmation sent. See you soon.
      </p>

      <div className="mt-8 space-y-3 rounded-2xl border border-ink-100 bg-cream-50 p-5 text-left">
        {hasAdditional ? (
          <>
            {/* Per-service breakdown using the unified summary */}
            <div className="space-y-2">
              {summary.lines.map((line, idx) => (
                <div
                  key={`${line.name}-${idx}`}
                  className="flex items-baseline justify-between gap-3"
                >
                  <span className="text-[14px] font-medium text-ink-900">
                    {line.name}
                  </span>
                  <span className="text-[14px] text-ink-700">
                    {line.priceLabel}
                    <span className="px-1.5 text-ink-300">·</span>
                    {line.durationLabel}
                  </span>
                </div>
              ))}
              {summary.totalPriceLabel && (
                <div className="flex items-baseline justify-between gap-3 border-t border-ink-200/50 pt-2">
                  <span className="text-[14px] font-medium text-ink-900">
                    Estimated total
                  </span>
                  <span className="text-[14px] font-medium text-ink-900">
                    {summary.totalPriceLabel}
                  </span>
                </div>
              )}
              <div className="flex items-baseline justify-between gap-3">
                <span className="text-[14px] font-medium text-ink-900">
                  Estimated time
                </span>
                <span className="text-[14px] font-medium text-ink-900">
                  about {summary.totalDurationLabel}
                </span>
              </div>
            </div>
            {summary.noteLine && (
              <p className="text-[12px] italic text-ink-500">
                {summary.noteLine.replace(/\bShen\b/g, stylistName)}
              </p>
            )}
            <Divider />
            <Row
              label="Date & time"
              value={`${slot.dayLabel}, ${slot.dateLabel} · ${slot.timeLabel}`}
            />
            <Divider />
            <Row label="Stylist" value={stylistName} />
            <Divider />
            <LocationRow location={stylistLocation} />
          </>
        ) : (
          <>
            <Row label="Service" value={service.name} />
            <Divider />
            <Row label="Price" value={service.priceLabel} />
            <Divider />
            <Row
              label="Date & time"
              value={`${slot.dayLabel}, ${slot.dateLabel} · ${slot.timeLabel}`}
            />
            <Divider />
            <Row label="Duration" value={service.durationLabel} />
            <Divider />
            <Row label="Stylist" value={stylistName} />
            <Divider />
            <LocationRow location={stylistLocation} />
          </>
        )}
      </div>

      <div className="mt-6 grid gap-2">
        <button
          type="button"
          onClick={() =>
            alert(
              "Calendar invite would download here in the production version."
            )
          }
          className="w-full rounded-full border border-ink-200 bg-cream-50 px-6 py-3.5 text-[15px] font-medium text-ink-800 hover:border-ink-300"
        >
          Add to calendar
        </button>
        <button
          type="button"
          onClick={onDone}
          className="w-full rounded-full bg-ink-900 px-6 py-3.5 text-[15px] font-medium text-cream-50 hover:bg-ink-800"
        >
          Done
        </button>
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <span className="text-xs uppercase tracking-[0.14em] text-ink-500">
        {label}
      </span>
      <span className="text-right text-[15px] text-ink-900">{value}</span>
    </div>
  );
}

/**
 * Confirmed-stage location row: same visual shape as Row, but the value is
 * a tappable link that opens Google/Apple Maps in a new tab so booked
 * clients can navigate to the studio without copy-pasting. Falls back to a
 * plain Row when no location is available (defensive — would render an
 * empty value otherwise).
 */
function LocationRow({ location }: { location: string }) {
  if (!location || !location.trim()) {
    return <Row label="Location" value={location} />;
  }
  const href = `https://maps.google.com/?q=${encodeURIComponent(location.trim())}`;
  return (
    <div className="flex items-baseline justify-between gap-4">
      <span className="text-xs uppercase tracking-[0.14em] text-ink-500">
        Location
      </span>
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        aria-label={`Open ${location} in Maps`}
        className="inline-flex items-baseline gap-1 text-right text-[15px] text-ink-900 underline underline-offset-4 hover:text-ink-700"
      >
        <span>{location}</span>
        <span aria-hidden className="text-[10px] text-ink-500">↗</span>
      </a>
    </div>
  );
}

function Divider() {
  return <div className="h-px bg-ink-100" />;
}

/* -------------------------------------------------------------------------- */
/* Consultation                                                                */
/* -------------------------------------------------------------------------- */

function ConsultationStage({
  service,
  onPick,
  onBack,
  stylistName,
}: {
  service: Service | null;
  onPick: (slot: TimeSlot) => void;
  onBack: () => void;
  stylistName: string;
}) {
  return (
    <div className="animate-fade-up">
      <BackBar onBack={onBack} />
      <div className="rounded-2xl bg-accent-soft/60 p-5">
        <p className="font-display text-xs uppercase tracking-[0.14em] text-accent-dark">
          Consultation needed
        </p>
        <p className="mt-2 text-[15px] leading-relaxed text-ink-800">
          {service && service.status === "consultation" ? (
            <>
              <span className="font-medium">{service.name}</span> needs a quick
              consult first so {stylistName} can plan the right approach. It&apos;s short
              and free.
            </>
          ) : (
            <>
              {stylistName} wants to chat briefly before booking, so {stylistName} can recommend the
              right service. The consult is short and free.
            </>
          )}
        </p>
      </div>

      <h1 className="mt-6 font-display text-2xl font-medium tracking-tight text-ink-900">
        Pick a consultation time
      </h1>
      <div className="mt-4 space-y-2">
        {CONSULTATION_SLOTS.map((s) => (
          <TimeSlotCard
            key={s.id}
            slot={s}
            variant="inline"
            onClick={() => onPick(s)}
          />
        ))}
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Custom request                                                              */
/* -------------------------------------------------------------------------- */

function CustomStage({ onDone, stylistName }: { onDone: () => void; stylistName: string }) {
  return (
    <div className="animate-fade-up text-center">
      <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-cream-100 font-display text-2xl text-ink-700">
        ✎
      </div>
      <h1 className="mt-5 font-display text-2xl font-medium tracking-tight text-ink-900">
        This sounds custom
      </h1>
      <p className="mx-auto mt-2 max-w-xs text-[15px] leading-relaxed text-ink-600">
        {stylistName} should review it directly. Please DM {stylistName} and mention:
      </p>
      <p className="mx-auto mt-3 inline-block rounded-full bg-cream-100 px-4 py-2 font-mono text-sm text-ink-800">
        custom booking request
      </p>

      <div className="mt-8 grid gap-2">
        <a
          href="https://instagram.com"
          target="_blank"
          rel="noreferrer"
          className="w-full rounded-full bg-ink-900 px-6 py-3.5 text-[15px] font-medium text-cream-50 hover:bg-ink-800"
        >
          Open Instagram
        </a>
        <button
          type="button"
          onClick={onDone}
          className="w-full rounded-full border border-ink-200 bg-cream-50 px-6 py-3.5 text-[15px] font-medium text-ink-800 hover:border-ink-300"
        >
          Back to start
        </button>
      </div>
    </div>
  );
}
