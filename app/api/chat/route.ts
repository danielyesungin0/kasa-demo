import { type NextRequest, NextResponse } from "next/server";
import { isSameOrigin } from "@/lib/api/origin-check";
import { checkRateLimit } from "@/lib/api/rate-limit";
import { resolveStylist } from "@/lib/stylists/resolve";
import { SERVICES, STYLIST } from "@/lib/mock-data";
import type { Service } from "@/lib/types";
import { callAI, type AIResponse } from "@/lib/ai/provider";
import { lastCallWasRateLimited } from "@/lib/ai/metrics";
import {
  tryDeterministicAnswer,
  type FAQContext,
} from "@/lib/ai/deterministic-faq";
import { detectUnsupportedService } from "@/lib/unsupported-services";
import {
  getProviderServices,
  getProviderUnsupportedTerms,
  getProviderWorkingDays,
} from "@/lib/provider-services";

/**
 * Ask Shen chat endpoint — AI-first conversational layer, deterministic
 * source of truth for booking facts.
 *
 * Routing model (Interpretation B):
 *   1. Reject cross-origin + rate-limit (15/min/IP).
 *   2. Cap input at 800 chars. Dedup identical messages within 5s.
 *   3. Gather grounding facts: stylist profile + catalog + recent turns.
 *      Also try to identify the SPECIFIC service the message references
 *      so AI can quote real price/duration without inventing.
 *   4. Call AI with the message + facts + conversation. Single round trip,
 *      no tool calling. AI generates a warm reply grounded in the facts.
 *   5. Validate every service ID the AI returned against the live catalog.
 *      Drop invalid ones; downgrade intent if the array empties.
 *   6. If AI is disabled or fails, fall back to deterministic FAQ so the
 *      user never hits a dead end.
 *
 * Booking actions never reach this endpoint — they're handled by the chat
 * client's deterministic action router. The AI here only does conversation
 * and recommendation; it cannot create, modify, cancel, or reschedule.
 */

type ChatRequest = {
  message?: string;
  conversation?: Array<{ role: "user" | "assistant"; content: string }>;
  /** Provider slug. When present, resolves that provider strictly; when
   *  absent (legacy /shen), falls back to the first stylist row. */
  slug?: string;
};

type ChatResponseBody = {
  reply: string;
  intent: AIResponse["intent"];
  recommendedServiceIds: string[];
  needsHumanHandoff: boolean;
  handoffSummary: string | null;
  confidence: number;
  /** Structured intent envelope (Architecture B). Client converts to Intent. */
  serviceQuery: string | null;
  timePreference: AIResponse["timePreference"];
  peopleCount: number;
  multiServiceRequest: boolean;
  questionType: AIResponse["questionType"];
  manageAction: AIResponse["manageAction"];
  /** Where this response came from. Surfaced in UI only when client-side debug flag set. */
  source: "deterministic-facts+ai" | "deterministic-fallback" | "ai" | "fallback" | "cached";
  /** Optional debug payload exposed when AI_DEBUG_MODE=true on the server. */
  debug?: {
    routingPath: string;
    aiCalled: boolean;
    aiOutcome?: "success" | "skipped" | "failed";
    matchedServiceId?: string | null;
    elapsedMs?: number;
  };
};

const MAX_MESSAGE_LENGTH = 800;
const DEDUP_WINDOW_MS = 5_000;

/**
 * 5-second dedup cache keyed by (ip, message). Prevents accidental
 * double-submits or refresh loops from burning AI quota. In-memory,
 * cleared on every server restart — acceptable for this scope.
 */
type DedupEntry = { response: ChatResponseBody; expiresAt: number };
const dedupCache = new Map<string, DedupEntry>();

function dedupKey(ip: string, message: string): string {
  return `${ip}::${message}`;
}

function getDedupedResponse(key: string): ChatResponseBody | null {
  const entry = dedupCache.get(key);
  if (!entry) return null;
  if (entry.expiresAt < Date.now()) {
    dedupCache.delete(key);
    return null;
  }
  return entry.response;
}

function setDedupedResponse(key: string, response: ChatResponseBody) {
  dedupCache.set(key, {
    response,
    expiresAt: Date.now() + DEDUP_WINDOW_MS,
  });
  // Cheap prune: every 50 inserts, drop expired entries so the Map doesn't
  // grow unbounded across long-lived dev sessions.
  if (dedupCache.size > 50) {
    const now = Date.now();
    for (const [k, v] of dedupCache) {
      if (v.expiresAt < now) dedupCache.delete(k);
    }
  }
}

export async function POST(request: NextRequest) {
  const startedAt = Date.now();
  const debug = process.env.AI_DEBUG_MODE === "true";

  if (!isSameOrigin(request)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const rate = checkRateLimit(request, "chat");
  if (!rate.allowed) {
    if (debug) console.log("[chat] rate limited", { retryAfter: rate.retryAfterSec });
    return NextResponse.json(
      { error: "rate_limited" },
      { status: 429, headers: { "Retry-After": String(rate.retryAfterSec ?? 60) } }
    );
  }

  let body: ChatRequest;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const rawMessage = (body.message ?? "").trim();
  if (!rawMessage) {
    return NextResponse.json({ error: "empty_message" }, { status: 400 });
  }
  if (rawMessage.length > MAX_MESSAGE_LENGTH) {
    return NextResponse.json(
      { error: "message_too_long", maxLength: MAX_MESSAGE_LENGTH },
      { status: 413 }
    );
  }
  const message = rawMessage;

  // ── Dedup check ──────────────────────────────────────────────────────
  // Identical messages within 5s from the same IP get the cached response.
  // This is the cheapest possible defense against double-submit bugs and
  // a bored user spamming Enter.
  const ip = extractIp(request);
  const cacheKey = dedupKey(ip, message);
  const cached = getDedupedResponse(cacheKey);
  if (cached) {
    if (debug) console.log("[chat] dedup hit", { ip: redactIp(ip), message: message.slice(0, 60) });
    return NextResponse.json({ ...cached, source: "cached" as const });
  }

  // ── Conversation history — last 8 turns, sanitized ───────────────────
  const conversation = Array.isArray(body.conversation)
    ? body.conversation
        .filter(
          (t): t is { role: "user" | "assistant"; content: string } =>
            Boolean(t) &&
            (t.role === "user" || t.role === "assistant") &&
            typeof t.content === "string"
        )
        .map((t) => ({ role: t.role, content: t.content.slice(0, 400) }))
        .slice(-8)
    : [];

  // ── 1. Grounding facts ───────────────────────────────────────────────
  // Resolve the provider strictly by slug when one is sent; otherwise fall
  // back to the first stylist row (legacy /shen path). One resolve, reused
  // for the profile, provider services, and unsupported rules below.
  const resolvedStylist = await resolveStylist(body.slug);
  const profile = await loadStylistProfile(body.slug);
  const stylistName = profile.name;

  // Provider-aware service grounding (Pass 2A). If the provider has synced
  // services in provider_services, ground the AI on those (real names,
  // prices, durations, aliases). Otherwise fall back to the mock demo
  // catalog so /book/shen keeps working before Square is synced.
  const providerServices = resolvedStylist
    ? await getProviderServices(resolvedStylist.id)
    : [];
  const providerUnsupportedTerms = resolvedStylist
    ? await getProviderUnsupportedTerms(resolvedStylist.id)
    : [];

  // Real working days from stylist_availability (same source as slots), so the
  // AI's text answers about which days she's open match the actual schedule.
  // Falls back to the legacy hardcoded list only when no availability is set.
  const providerWorkingDays = resolvedStylist
    ? await getProviderWorkingDays(resolvedStylist.id)
    : [];
  const workingDays =
    providerWorkingDays.length > 0 ? providerWorkingDays : WORKING_DAYS_LABELS;

  // Build the grounding service list the AI sees. Provider rows win when
  // present; aliases are appended to each name so the model matches broad
  // terms like "treatment". Falls back to the mock SERVICES shape.
  const groundingServices =
    providerServices.length > 0
      ? providerServices
          .filter((s) => s.visible_in_chat)
          .map((s) => ({
            id: s.id,
            name:
              s.aliases.length > 0
                ? `${s.name} (also: ${s.aliases.join(", ")})`
                : s.name,
            category: s.category ?? "Other",
            priceLabel:
              s.price_cents != null
                ? `$${Math.round(s.price_cents / 100)}`
                : "Price varies",
            durationLabel:
              s.duration_minutes != null ? `${s.duration_minutes} min` : "—",
            status:
              s.behavior === "consultation"
                ? ("consultation" as const)
                : ("online" as const),
          }))
      : SERVICES.map((s) => ({
          id: s.id,
          name: s.name,
          category: s.category,
          priceLabel: s.priceLabel,
          durationLabel: s.durationLabel,
          status: s.status,
        }));

  const faqCtx: FAQContext = {
    stylistName,
    location: profile.location,
    workingDays: workingDays,
    services: SERVICES,
  };

  // Pre-resolve a candidate service from the message. Used in two places:
  //   (a) as the matchedServiceId fact when we call AI — so the model can
  //       quote real price/duration instead of guessing
  //   (b) as a deterministic fallback target if AI is unavailable
  const deterministicAnswer = tryDeterministicAnswer(message, faqCtx);
  const matchedServiceId =
    deterministicAnswer?.recommendedServiceIds?.[0] ?? null;

  // ── 2. AI path (default) ─────────────────────────────────────────────
  // We try AI first now even for "factual" questions — the model gets the
  // grounded facts in its prompt and answers conversationally. AI failure
  // falls back to the deterministic FAQ below.
  if (debug) {
    console.log("[chat] routing", {
      ip: redactIp(ip),
      messagePreview: message.slice(0, 80),
      messageLength: message.length,
      hasDeterministicMatch: !!deterministicAnswer,
      matchedServiceId,
    });
  }

  const ai = await callAI(
    {
      stylistName,
      studioName: profile.businessName,
      location: profile.location,
      workingDays: workingDays,
      services: groundingServices,
      conversation,
      userMessage: message,
    },
    { debug }
  );

  if (ai) {
    const validIds = filterValidServiceIds(ai.recommendedServiceIds);
    let finalIntent = ai.intent;

    // If the AI recommended services but none survived validation, the
    // recommendation is fake — downgrade to "unknown" so the chat asks a
    // follow-up rather than rendering nothing.
    if (
      validIds.length === 0 &&
      (ai.intent === "service_guidance" || ai.intent === "booking")
    ) {
      finalIntent = "unknown";
    }

    // When deterministic matched a service but the AI didn't reference it,
    // surface it anyway — the model may have answered conversationally
    // without explicitly recommending. This makes "how much is a perm" feel
    // useful even when the AI doesn't bother repeating the service id.
    let mergedIds = validIds;
    if (
      mergedIds.length === 0 &&
      matchedServiceId &&
      (finalIntent === "faq" || finalIntent === "service_guidance")
    ) {
      mergedIds = [matchedServiceId];
    }

    const source: ChatResponseBody["source"] =
      matchedServiceId || deterministicAnswer
        ? "deterministic-facts+ai"
        : "ai";

    // Multi-person bookings aren't supported by the existing flow — force
    // the response into handoff regardless of what the model picked.
    const isGroup = ai.peopleCount > 1;

    // Deterministic safety net for unsupported services. The model has a
    // known weakness of over-generalizing within a category (e.g. mapping
    // "bleach my hair" to the Color category even when the stylist doesn't
    // do bleach). When the user's message contains an unambiguous
    // unsupported-service keyword, override the AI's intent so the chat
    // routes to handoff regardless of what the model returned.
    const detectedUnsupported = detectUnsupportedService(message, providerUnsupportedTerms);
    const isHardUnsupported = detectedUnsupported !== null;

    let effectiveIntent: AIResponse["intent"];
    let effectiveNeedsHandoff: boolean;
    let effectiveHandoffSummary: string | null;
    let effectiveIds = mergedIds;
    let effectiveReply = ai.reply;

    if (isHardUnsupported) {
      effectiveIntent = "unsupported";
      effectiveNeedsHandoff = true;
      effectiveHandoffSummary = `Client asked about "${detectedUnsupported}", which isn't in ${stylistName}'s current service list. Most recent message: "${message}".`;
      // Drop any service ids the model attached — they'd be misleading for
      // a service the stylist doesn't actually do.
      effectiveIds = [];
      // Replace the reply with a clean, on-brand redirect. The model's
      // reply may have falsely implied we offer the service.
      effectiveReply = `That isn't something ${stylistName} currently offers — I don't want to point you at the wrong service. Want me to send ${stylistName} a quick message so she can let you know directly?`;
    } else if (isGroup) {
      effectiveIntent = "handoff";
      effectiveNeedsHandoff = true;
      effectiveHandoffSummary =
        ai.handoffSummary ??
        `Client is booking for ${ai.peopleCount} people${ai.serviceQuery ? ` (${ai.serviceQuery})` : ""}. Most recent message: "${message}".`;
    } else {
      effectiveIntent = finalIntent;
      effectiveNeedsHandoff = ai.needsHumanHandoff;
      effectiveHandoffSummary = ai.handoffSummary;
    }

    const responseBody: ChatResponseBody = {
      reply: effectiveReply,
      intent: effectiveIntent,
      recommendedServiceIds: effectiveIds,
      needsHumanHandoff: effectiveNeedsHandoff,
      handoffSummary: effectiveHandoffSummary,
      confidence: ai.confidence,
      serviceQuery: ai.serviceQuery,
      timePreference: ai.timePreference,
      peopleCount: ai.peopleCount,
      multiServiceRequest: ai.multiServiceRequest,
      questionType: ai.questionType,
      manageAction: ai.manageAction,
      source,
      ...(debug && {
        debug: {
          routingPath: "ai",
          aiCalled: true,
          aiOutcome: "success" as const,
          matchedServiceId,
          elapsedMs: Date.now() - startedAt,
        },
      }),
    };

    setDedupedResponse(cacheKey, responseBody);
    if (debug) console.log("[chat] ai success", { intent: finalIntent, ids: mergedIds, ms: Date.now() - startedAt });
    return NextResponse.json(responseBody);
  }

  // ── 3. AI unavailable — deterministic fallback ───────────────────────
  // Even without AI, an unambiguous unsupported keyword should route the
  // user to a handoff rather than the generic prompt. Otherwise "bleach
  // my hair" with AI down would dead-end at "tell me what you're looking
  // for", which is worse than offering to message the stylist.
  const offlineUnsupported = detectUnsupportedService(message, providerUnsupportedTerms);
  if (offlineUnsupported) {
    const responseBody: ChatResponseBody = {
      reply: `That isn't something ${stylistName} currently offers — I don't want to point you at the wrong service. Want me to send ${stylistName} a quick message so she can let you know directly?`,
      intent: "unsupported",
      recommendedServiceIds: [],
      needsHumanHandoff: true,
      handoffSummary: `Client asked about "${offlineUnsupported}", which isn't in ${stylistName}'s current service list. Most recent message: "${message}".`,
      confidence: 1.0,
      serviceQuery: null,
      timePreference: null,
      peopleCount: 1,
      multiServiceRequest: false,
      questionType: null,
      manageAction: null,
      source: "deterministic-fallback",
      ...(debug && {
        debug: {
          routingPath: "deterministic-unsupported",
          aiCalled: true,
          aiOutcome: "failed" as const,
          matchedServiceId,
          elapsedMs: Date.now() - startedAt,
        },
      }),
    };
    setDedupedResponse(cacheKey, responseBody);
    return NextResponse.json(responseBody);
  }

  // This is the brief's "user never hits a dead end" guarantee. If we had
  // a deterministic FAQ match earlier, return it as a stiff-but-correct
  // answer. Otherwise return a safe generic prompt.
  if (deterministicAnswer) {
    if (debug) console.log("[chat] ai unavailable, returning deterministic answer");
    const validIds = filterValidServiceIds(deterministicAnswer.recommendedServiceIds);
    const responseBody: ChatResponseBody = {
      reply: deterministicAnswer.reply,
      intent: deterministicAnswer.intent,
      recommendedServiceIds: validIds,
      needsHumanHandoff: false,
      handoffSummary: null,
      confidence: 1.0,
      serviceQuery: null,
      timePreference: null,
      peopleCount: 1,
      multiServiceRequest: false,
      questionType: null,
      manageAction: null,
      source: "deterministic-fallback",
      ...(debug && {
        debug: {
          routingPath: "deterministic-fallback",
          aiCalled: true,
          aiOutcome: "failed" as const,
          matchedServiceId,
          elapsedMs: Date.now() - startedAt,
        },
      }),
    };
    setDedupedResponse(cacheKey, responseBody);
    return NextResponse.json(responseBody);
  }

  if (debug) console.log("[chat] ai unavailable and no deterministic match, returning safe fallback");
  // Distinguish a transient rate-limit (free-tier AI temporarily busy) from a
  // genuine "didn't understand". On a rate limit we say so plainly and offer a
  // real path forward — never a raw API error, never a dead end.
  const wasRateLimited = lastCallWasRateLimited();
  const fallbackReply = wasRateLimited
    ? `Sorry — the assistant is getting a lot of requests right now and needs a moment. Please try again in a few seconds. In the meantime you can tap "Browse all services" to see everything ${stylistName} offers, or ask to message ${stylistName} directly.`
    : `I can still help with booking, services, and basic questions. Tell me what you're looking for, or tap "Browse all services" to see everything ${stylistName} offers.`;
  const fallback: ChatResponseBody = {
    reply: fallbackReply,
    intent: "unknown",
    recommendedServiceIds: [],
    // Offer the human escape hatch when the AI is rate-limited, so a client who
    // can't get through to the assistant still has a way to reach the provider.
    needsHumanHandoff: wasRateLimited,
    handoffSummary: wasRateLimited
      ? `Client tried to chat while the assistant was temporarily unavailable (rate limited). They may want help booking with ${stylistName}.`
      : null,
    confidence: 0,
    serviceQuery: null,
    timePreference: null,
    peopleCount: 1,
    multiServiceRequest: false,
    questionType: null,
    manageAction: null,
    source: "fallback",
    ...(debug && {
      debug: {
        routingPath: "fallback",
        aiCalled: true,
        aiOutcome: "failed" as const,
        matchedServiceId: null,
        elapsedMs: Date.now() - startedAt,
      },
    }),
  };
  setDedupedResponse(cacheKey, fallback);
  return NextResponse.json(fallback);
}

/* -------------------------------------------------------------------------- */
/* Helpers                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Restrict AI's service id recommendations to ids that exist as ONLINE
 * services in the live catalog. Filters out invented ids, hidden SKUs, and
 * consultation-only SKUs (those aren't bookable through the standard flow).
 */
function filterValidServiceIds(ids: string[]): string[] {
  const onlineIds = new Set(
    SERVICES.filter((s) => s.status === "online").map((s) => s.id)
  );
  return ids.filter((id) => onlineIds.has(id));
}

/** Pull the client IP for rate-limit/dedup keying. */
function extractIp(request: NextRequest): string {
  const fwd = request.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0].trim();
  const real = request.headers.get("x-real-ip");
  if (real) return real;
  return "unknown";
}

/** Truncate IP for logs — even in debug we never want full IPs in console. */
function redactIp(ip: string): string {
  if (ip === "unknown") return ip;
  return ip.replace(/\.\d+$/, ".xxx");
}

const WORKING_DAYS_LABELS = ["Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/**
 * Pull stylist display name + business name + joined location from the DB.
 * Resolves strictly by slug when one is provided; otherwise falls back to
 * the first stylist row (legacy /shen path). Falls back to mock STYLIST if
 * no row resolves (dev / fresh setup).
 */
async function loadStylistProfile(slug?: string): Promise<{
  name: string;
  businessName: string | null;
  location: string | null;
}> {
  try {
    const data = await resolveStylist(slug);
    if (!data) throw new Error("no stylist row");

    const name =
      data.display_name ??
      data.square_team_member_name ??
      data.square_business_name ??
      STYLIST.name;

    const businessName = data.square_business_name ?? null;

    const location =
      [data.square_business_name, data.square_location_name]
        .filter(Boolean)
        .join(" · ") || null;

    return { name, businessName, location };
  } catch {
    return {
      name: STYLIST.name,
      businessName: null,
      location: STYLIST.location,
    };
  }
}
