/**
 * Provider-agnostic AI wrapper.
 *
 * Today: Groq (free, fast). Tomorrow: swap in Gemini, OpenRouter, etc. by
 * adding another switch arm in callProvider — the rest of the app talks to
 * AIResponse only and doesn't care which provider returned it.
 *
 * Hard rules baked into this layer:
 *   - The AI returns STRUCTURED JSON only. We never render free-form
 *     model output as a final answer — the structured fields drive the UI.
 *   - All service references are validated against the live catalog at the
 *     route boundary (see app/api/chat/route.ts). Invalid IDs are dropped
 *     before they reach the client.
 *   - Failures (no key, network, rate limit, malformed JSON) return a
 *     null AIResponse so the route can fall back to deterministic chat.
 *     Never throws — the chat must never dead-end because Groq blinked.
 */

import { recordAIRequest, recordAIOutcome } from "@/lib/ai/metrics";

export type AIIntent =
  | "faq"
  | "service_guidance"
  | "consultation" // open-ended advice ("what's the difference", "which should
  // I get", "would you recommend", "will this work for me"). ANSWER first; the
  // chat never auto-books a consultation — it offers booking after.
  | "booking"
  | "handoff"
  | "unsupported"
  | "unknown";

/**
 * Structured time preference extracted by the model. Server converts this
 * into TimeHints before handing it back to the deterministic executor —
 * the model never invents calendar facts on its own.
 */
export type AITimePreference = {
  /** Original phrase the user typed, for logging/handoff context only. */
  raw: string;
  /**
   * Categorical bucket. Mirrors the deterministic parser's vocabulary so
   * conversion is a switch statement, not a free-text interpretation.
   */
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
  /** Full weekday name when type=specific_day. "Monday".."Sunday" or null. */
  dayOfWeek: string | null;
  /** ISO yyyy-mm-dd when type=specific_date. Validated server-side. */
  date: string | null;
  /** Time-of-day bucket. Combined with any other type. */
  partOfDay: "morning" | "afternoon" | "evening" | null;
};

export type AIResponse = {
  /** What the chat shows to the client. Short, warm, natural. */
  reply: string;
  /** Routing decision used by the chat to choose a turn type. */
  intent: AIIntent;
  /**
   * Service IDs the model thinks match the user's intent. Validated by the
   * caller — invalid IDs are discarded, and if the array empties out the
   * intent is downgraded to "unsupported".
   */
  recommendedServiceIds: string[];
  /** True when the chat should offer a "Send to Shen" handoff. */
  needsHumanHandoff: boolean;
  /**
   * Pre-written summary the user can review/edit before sending. Generated
   * by the model when the request is complex or ambiguous enough to warrant
   * a direct message to the stylist.
   */
  handoffSummary: string | null;
  /** 0..1 — drives the chat's low-confidence follow-up vs handoff logic. */
  confidence: number;

  /* -------- Structured intent extraction (Architecture B) -------- */
  /**
   * Free-text label for the service the user described. Used only as a
   * fallback for handoff summaries — the executor relies on
   * recommendedServiceIds for any real action.
   */
  serviceQuery: string | null;
  /** Structured time preference, or null when the user didn't mention time. */
  timePreference: AITimePreference | null;
  /**
   * Number of people the booking is for. 1 = normal flow.
   * >1 triggers a handoff because the prototype doesn't support group bookings.
   */
  peopleCount: number;
  /**
   * The user asked about multiple services in one message
   * (e.g. "color and haircut"). Lets the executor route to add_services.
   */
  multiServiceRequest: boolean;
  /**
   * What kind of factual question was asked, when intent=faq. Drives
   * deterministic price/duration response formatting downstream.
   */
  questionType: "price" | "duration" | "hours" | "location" | "other" | null;
  /**
   * Manage-flow signal. Set when the user's message clearly wants to
   * cancel, reschedule, or look up an existing appointment — the chat
   * routes these directly into ManageLookupStage / name lookup, skipping
   * the booking flow. null when the message is not about an existing
   * appointment.
   */
  manageAction: "cancel" | "reschedule" | "lookup" | null;
};

/**
 * Context the route gathers and hands to the provider. Grounding inputs only —
 * the route is the source of truth, the model never invents service / price /
 * duration facts.
 */
export type AIRequestContext = {
  stylistName: string;
  studioName: string | null;
  location: string | null;
  workingDays: string[] | null;
  services: Array<{
    id: string;
    name: string;
    category: string;
    priceLabel: string;
    durationLabel: string;
    status: "online" | "consultation" | "hidden";
    // Optional provider-written description — used to ground consultation /
    // comparison answers in real detail instead of guessing.
    description?: string | null;
  }>;
  /** Up to ~10 most recent turns, oldest first. Plain user/bot strings only. */
  conversation: Array<{ role: "user" | "assistant"; content: string }>;
  /** The current user message we want to respond to. */
  userMessage: string;
};

export type AIRequestOptions = {
  /** Server console logging when AI_DEBUG_MODE=true. Never user-facing. */
  debug?: boolean;
};

/* -------------------------------------------------------------------------- */
/* Provider abstraction                                                        */
/* -------------------------------------------------------------------------- */

export type ProviderName = "groq" | "claude";

/**
 * What every provider returns: the raw model text (a JSON string we parse into
 * AIResponse), plus a coarse outcome so callAI can record metrics and decide
 * whether to fall back. Providers do NOT parse or record metrics themselves —
 * that's centralized in callAI so behavior is identical across providers.
 */
export type ProviderRawResult = {
  ok: boolean;
  raw: string | null;
  outcome: "success" | "rate_limited" | "error" | "timeout";
  /** True only when this provider has no API key configured — lets callAI
   *  fall through to the default provider without counting it as a failure. */
  notConfigured?: boolean;
};

type ProviderFn = (
  ctx: AIRequestContext,
  opts: AIRequestOptions
) => Promise<ProviderRawResult>;

const PROVIDERS: Record<ProviderName, ProviderFn> = {
  groq: callGroqRaw,
  claude: callClaudeRaw,
};

/** The safe default. Groq stays the default until AI_PROVIDER explicitly says
 *  otherwise — Shen's beta keeps working with no Claude key present. */
const DEFAULT_PROVIDER: ProviderName = "groq";

function resolveProviderName(): ProviderName {
  const raw = (process.env.AI_PROVIDER ?? "").trim().toLowerCase();
  if (raw === "claude") return "claude";
  if (raw === "groq") return "groq";
  // Unknown / unset → default. Never throw; never silently break the beta.
  // TODO(per-provider): a future per-stylist override (e.g. Shen on Claude,
  // others on Groq) would resolve here using the slug/stylist id. Kept as a
  // single global env switch for now to avoid overbuilding.
  return DEFAULT_PROVIDER;
}

/**
 * Single entry point for the whole app. Returns a parsed AIResponse or null
 * (null → caller falls back to deterministic chat). Owns: provider selection,
 * parsing, metrics, the Claude→Groq fallback chain, and provider logging.
 */
export async function callAI(
  ctx: AIRequestContext,
  opts: AIRequestOptions = {}
): Promise<AIResponse | null> {
  if (process.env.AI_ENABLED !== "true") {
    if (opts.debug) console.log("[ai] disabled via AI_ENABLED env var");
    return null;
  }

  const primary = resolveProviderName();

  // Try the selected provider; on a real failure (not "not configured"), and
  // when it isn't already Groq, fall back to Groq as the safety net.
  const first = await runProvider(primary, ctx, opts);
  if (first) return first;

  if (primary !== DEFAULT_PROVIDER) {
    if (opts.debug) {
      console.log(`[ai] ${primary} unavailable → falling back to ${DEFAULT_PROVIDER}`);
    }
    const fallback = await runProvider(DEFAULT_PROVIDER, ctx, opts);
    if (fallback) return fallback;
  }

  // Both failed (or default failed). Null → the chat route shows its warm
  // "assistant is busy, try again" message with the handoff escape hatch.
  return null;
}

/**
 * Run one named provider end-to-end: call it, record metrics, parse. Returns a
 * parsed AIResponse on success, or null on any failure (so callAI can fall
 * back). Centralizing this keeps metrics + parsing identical across providers.
 */
async function runProvider(
  name: ProviderName,
  ctx: AIRequestContext,
  opts: AIRequestOptions
): Promise<AIResponse | null> {
  const fn = PROVIDERS[name];
  recordAIRequest();
  const startedAt = Date.now();
  const result = await fn(ctx, opts);
  const elapsed = Date.now() - startedAt;

  if (result.notConfigured) {
    // No key for this provider — not a failure, just unavailable. Don't record
    // an outcome (it never actually ran).
    if (opts.debug) console.log(`[ai-provider] ${name}: not configured (no key)`);
    return null;
  }

  recordAIOutcome(result.outcome, elapsed);

  // Comparison logging: which provider handled this, and how it went. No keys,
  // no user data — just provider/outcome/latency.
  console.log(
    `[ai-provider] ${JSON.stringify({ provider: name, outcome: result.outcome, latencyMs: elapsed })}`
  );

  if (!result.ok || !result.raw) return null;

  const parsed = parseStructured(result.raw, opts);
  if (!parsed) {
    if (opts.debug) console.log(`[ai-provider] ${name}: response failed to parse`);
  }
  return parsed;
}

/* -------------------------------------------------------------------------- */
/* Groq                                                                       */
/* -------------------------------------------------------------------------- */

const GROQ_ENDPOINT = "https://api.groq.com/openai/v1/chat/completions";

/**
 * Groq provider. Returns the raw model JSON string (or a failure outcome).
 * Parsing + metrics + fallback are owned by callAI/runProvider — this function
 * only does the HTTP call. Behavior is unchanged from the previous callGroq.
 */
async function callGroqRaw(
  ctx: AIRequestContext,
  opts: AIRequestOptions
): Promise<ProviderRawResult> {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    if (opts.debug) console.log("[ai] groq: no GROQ_API_KEY");
    return { ok: false, raw: null, outcome: "error", notConfigured: true };
  }
  const model = process.env.GROQ_MODEL ?? "llama-3.1-8b-instant";

  const systemPrompt = buildSystemPrompt(ctx);
  const messages = [
    { role: "system" as const, content: systemPrompt },
    ...ctx.conversation.map((t) => ({
      role: t.role as "user" | "assistant",
      content: t.content,
    })),
    { role: "user" as const, content: ctx.userMessage },
  ];

  if (opts.debug) {
    console.log("[ai] groq request:", {
      model,
      messages: messages.map((m) => ({
        role: m.role,
        content: m.content.slice(0, 200),
      })),
    });
  }

  try {
    const controller = new AbortController();
    // 8 second cap — Groq is normally <500ms. If we're past 8s, fall back
    // to deterministic rather than hang the user.
    const timeout = setTimeout(() => controller.abort(), 8000);

    const res = await fetch(GROQ_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        // JSON mode — Groq guarantees the response is valid JSON. Still
        // validated downstream because the JSON's *fields* may be malformed.
        response_format: { type: "json_object" },
        temperature: 0.3,
        max_tokens: 600,
        messages,
      }),
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (!res.ok) {
      if (opts.debug) {
        const text = await res.text().catch(() => "<unreadable>");
        console.log(`[ai] groq error ${res.status}:`, text.slice(0, 500));
      }
      // 429 = free-tier rate limit. Recorded distinctly so the chat route can
      // show a friendly "assistant is busy" message rather than a generic miss.
      return { ok: false, raw: null, outcome: res.status === 429 ? "rate_limited" : "error" };
    }

    const data = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const raw = data.choices?.[0]?.message?.content ?? null;
    if (!raw) {
      if (opts.debug) console.log("[ai] groq: empty content");
      return { ok: false, raw: null, outcome: "error" };
    }

    if (opts.debug) console.log("[ai] groq raw response:", raw.slice(0, 500));
    return { ok: true, raw, outcome: "success" };
  } catch (err) {
    if (opts.debug) console.log("[ai] groq fetch failed:", err);
    const isAbort =
      err instanceof Error && (err.name === "AbortError" || err.name === "TimeoutError");
    return { ok: false, raw: null, outcome: isAbort ? "timeout" : "error" };
  }
}

/* -------------------------------------------------------------------------- */
/* Claude (Anthropic) — the smarter optional brain                            */
/* -------------------------------------------------------------------------- */

/**
 * Claude Haiku provider. Same contract as Groq: reuses buildSystemPrompt and
 * returns the raw JSON string for callAI to parse into AIResponse. Uses the
 * same prompt + tool/intent schema, so switching providers is behavior-
 * compatible. Claude-specific tweaks are intentionally minimal: we just nudge
 * it to emit JSON only (the system prompt already specifies the exact schema).
 *
 * Model default is a Haiku tier; override with ANTHROPIC_MODEL.
 */
const DEFAULT_ANTHROPIC_MODEL = "claude-haiku-4-5-20251001";

async function callClaudeRaw(
  ctx: AIRequestContext,
  opts: AIRequestOptions
): Promise<ProviderRawResult> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    if (opts.debug) console.log("[ai] claude: no ANTHROPIC_API_KEY");
    return { ok: false, raw: null, outcome: "error", notConfigured: true };
  }
  const model = process.env.ANTHROPIC_MODEL ?? DEFAULT_ANTHROPIC_MODEL;

  // System prompt is identical to Groq's. We append one line reinforcing
  // JSON-only output, since Claude has no equivalent of Groq's JSON mode flag.
  const systemPrompt =
    buildSystemPrompt(ctx) +
    `\n\nIMPORTANT: Respond with ONLY the JSON object described above — no prose, no markdown, no code fences. The first character of your reply must be "{".`;

  // Anthropic takes a separate system field; conversation is user/assistant only.
  const messages = [
    ...ctx.conversation.map((t) => ({
      role: t.role as "user" | "assistant",
      content: t.content,
    })),
    { role: "user" as const, content: ctx.userMessage },
  ];

  if (opts.debug) {
    console.log("[ai] claude request:", {
      model,
      messages: messages.map((m) => ({ role: m.role, content: m.content.slice(0, 200) })),
    });
  }

  try {
    // Lazy import so projects without the key/runtime never load the SDK.
    const { default: Anthropic } = await import("@anthropic-ai/sdk");
    const client = new Anthropic({ apiKey });

    const res = await client.messages.create(
      {
        model,
        max_tokens: 700,
        temperature: 0.3,
        system: systemPrompt,
        messages,
      },
      // 12s cap — slightly more headroom than Groq; still bounded so a slow
      // call can't hang the user (we fall back to Groq / deterministic).
      { timeout: 12000 }
    );

    // Concatenate any text blocks into the raw JSON string.
    const raw = res.content
      .map((b) => (b.type === "text" ? b.text : ""))
      .join("")
      .trim();

    if (!raw) {
      if (opts.debug) console.log("[ai] claude: empty content");
      return { ok: false, raw: null, outcome: "error" };
    }

    if (opts.debug) console.log("[ai] claude raw response:", raw.slice(0, 500));
    return { ok: true, raw, outcome: "success" };
  } catch (err: unknown) {
    // Map Anthropic errors to our outcomes without leaking the key/body.
    const e = err as { status?: number; name?: string };
    const status = e?.status;
    const isTimeout = e?.name === "APIConnectionTimeoutError" || e?.name === "AbortError";
    if (opts.debug) console.log(`[ai] claude error: status=${status ?? "?"} name=${e?.name ?? "?"}`);
    return {
      ok: false,
      raw: null,
      outcome: isTimeout ? "timeout" : status === 429 ? "rate_limited" : "error",
    };
  }
}

/**
 * Parse the model's JSON content into an AIResponse. Defensive — any shape
 * mismatch returns null so the caller falls back to deterministic chat.
 */
function parseStructured(raw: string, opts: AIRequestOptions): AIResponse | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    // Groq's JSON mode returns clean JSON, but Claude (no JSON-mode flag) may
    // occasionally wrap the object in a ```json fence or stray prose. Recover by
    // extracting the first {...} block, then retry. Still defensive — gives up
    // (returns null → deterministic fallback) if that also fails.
    const fenced = raw.replace(/```(?:json)?/gi, "").trim();
    const start = fenced.indexOf("{");
    const end = fenced.lastIndexOf("}");
    if (start !== -1 && end > start) {
      try {
        parsed = JSON.parse(fenced.slice(start, end + 1));
      } catch {
        if (opts.debug) console.log("[ai] response not valid JSON (after recovery)");
        return null;
      }
    } else {
      if (opts.debug) console.log("[ai] response not valid JSON");
      return null;
    }
  }
  if (!parsed || typeof parsed !== "object") return null;
  const obj = parsed as Record<string, unknown>;

  const intentRaw = String(obj.intent ?? "");
  const intent: AIIntent =
    intentRaw === "faq" ||
    intentRaw === "service_guidance" ||
    intentRaw === "consultation" ||
    intentRaw === "booking" ||
    intentRaw === "handoff" ||
    intentRaw === "unsupported"
      ? (intentRaw as AIIntent)
      : "unknown";

  const reply = typeof obj.reply === "string" ? obj.reply.trim() : "";
  if (!reply) {
    if (opts.debug) console.log("[ai] missing reply");
    return null;
  }

  const ids = Array.isArray(obj.recommendedServiceIds)
    ? obj.recommendedServiceIds
        .filter((x): x is string => typeof x === "string" && x.length > 0)
        .slice(0, 5)
    : [];

  const needsHumanHandoff = obj.needsHumanHandoff === true;
  const handoffSummary =
    typeof obj.handoffSummary === "string" && obj.handoffSummary.trim().length > 0
      ? obj.handoffSummary.trim().slice(0, 600)
      : null;

  const confidenceRaw = Number(obj.confidence);
  const confidence =
    Number.isFinite(confidenceRaw) && confidenceRaw >= 0 && confidenceRaw <= 1
      ? confidenceRaw
      : 0.5;

  const serviceQuery =
    typeof obj.serviceQuery === "string" && obj.serviceQuery.trim().length > 0
      ? obj.serviceQuery.trim().slice(0, 120)
      : null;

  const peopleCountRaw = Number(obj.peopleCount);
  const peopleCount =
    Number.isFinite(peopleCountRaw) && peopleCountRaw >= 1 && peopleCountRaw <= 50
      ? Math.floor(peopleCountRaw)
      : 1;

  const multiServiceRequest = obj.multiServiceRequest === true;

  const qt = obj.questionType;
  const questionType: AIResponse["questionType"] =
    qt === "price" || qt === "duration" || qt === "hours" || qt === "location" || qt === "other"
      ? qt
      : null;

  const ma = obj.manageAction;
  const manageAction: AIResponse["manageAction"] =
    ma === "cancel" || ma === "reschedule" || ma === "lookup" ? ma : null;

  const timePreference = parseTimePreference(obj.timePreference);

  return {
    reply: reply.slice(0, 600),
    intent,
    recommendedServiceIds: ids,
    needsHumanHandoff,
    handoffSummary,
    confidence,
    serviceQuery,
    timePreference,
    peopleCount,
    multiServiceRequest,
    questionType,
    manageAction,
  };
}

/** Defensive parse for the timePreference sub-object. Returns null if shape is wrong. */
function parseTimePreference(input: unknown): AITimePreference | null {
  if (!input || typeof input !== "object") return null;
  const o = input as Record<string, unknown>;

  const rawTxt = typeof o.raw === "string" ? o.raw.trim().slice(0, 120) : "";

  const t = o.type;
  const type: AITimePreference["type"] =
    t === "specific_day" ||
    t === "specific_date" ||
    t === "this_week" ||
    t === "next_week" ||
    t === "week_after" ||
    t === "weekend" ||
    t === "tomorrow" ||
    t === "today" ||
    t === "soonest" ||
    t === "part_of_day_only"
      ? t
      : null;

  const dayOfWeek =
    typeof o.dayOfWeek === "string" && o.dayOfWeek.trim().length > 0
      ? o.dayOfWeek.trim()
      : null;

  // Date format check — yyyy-mm-dd. Real date sanity (calendar validity, not
  // in the past) happens in the route handler where we have a clock.
  const dateRaw = typeof o.date === "string" ? o.date.trim() : "";
  const date = /^\d{4}-\d{2}-\d{2}$/.test(dateRaw) ? dateRaw : null;

  const p = o.partOfDay;
  const partOfDay: AITimePreference["partOfDay"] =
    p === "morning" || p === "afternoon" || p === "evening" ? p : null;

  // If nothing useful came back, treat as null so the caller doesn't have to.
  if (!type && !dayOfWeek && !date && !partOfDay && !rawTxt) return null;

  return { raw: rawTxt, type, dayOfWeek, date, partOfDay };
}

/* -------------------------------------------------------------------------- */
/* System prompt                                                              */
/* -------------------------------------------------------------------------- */

function buildSystemPrompt(ctx: AIRequestContext): string {
  const stylist = ctx.stylistName || "the stylist";
  const studio = ctx.studioName ? ` (${ctx.studioName})` : "";
  const locationLine = ctx.location
    ? `Location: ${ctx.location}`
    : "Location: (not provided)";
  const workingDaysLine = ctx.workingDays?.length
    ? `Working days: ${ctx.workingDays.join(", ")}`
    : "Working days: (not provided)";

  const servicesBlock = ctx.services
    .filter((s) => s.status !== "hidden")
    .map(
      (s) =>
        `  - id: ${s.id} | name: ${s.name} | category: ${s.category} | price: ${s.priceLabel} | duration: ${s.durationLabel}${s.status === "consultation" ? " | consultation-only" : ""}${s.description ? ` | about: ${s.description}` : ""}`
    )
    .join("\n");

  return `You ARE ${stylist}${studio}, chatting with a client to help them book. Speak in the FIRST PERSON as ${stylist} — "I", "my", "let me check my book" — warm and personal, like texting a client you like. This is ${stylist}'s own booking chat; it should feel like talking to her, not to an assistant or a front desk.

PERSONA: warm, friendly, a little playful, genuinely happy to see the client. Greet naturally ("Hey! So glad you reached out 💛"). Use the client's name if you know it. Short, human texts — contractions, the occasional emoji, never corporate or robotic. Never say "as an AI", "I'm an assistant", "I cannot", or "my apologies".

HONESTY (important): you may warmly speak as ${stylist}, but never deny being an assistant if a client EARNESTLY asks whether they're talking to a bot/AI or to the real ${stylist}. If they directly ask "is this really you / am I talking to a bot?", be honest and kind: "You're chatting with my booking assistant — I set it up so I can get you booked fast even when I'm with a client. I'll personally see every appointment 💛". Don't volunteer this otherwise; just be ${stylist} and help them book.

Tone: short, warm, natural. One follow-up question at a time. No jargon, no robotic phrases. Texting a client, not filling a form.

Language: reply in the SAME language the client wrote in. If they write in Korean, reply in Korean. If they write in Chinese, reply in Chinese. If they write in English, reply in English. Match their language naturally; never announce that you are translating.

GROUNDING — these are the only facts you may rely on:

Stylist: ${stylist}
${locationLine}
${workingDaysLine}

Services offered (ONLY these — never invent, substitute, or imply availability of services not in this list):
${servicesBlock || "  (no services configured)"}

HARD RULES:
1. NEVER invent services, prices, durations, or availability not in the list above.
2. NEVER confirm or schedule appointments yourself — the booking flow handles that.
3. If the user asks about a service NOT in the list, set intent="unsupported" and offer to send ${stylist} a message.
4. Recommend services ONLY by id from the list above. If unsure which service matches, set intent="unknown" and ask one clarifying question.
5. For complex requests (multi-person, scheduling within another appointment, custom asks, several questions at once), set intent="handoff" and write a clear handoffSummary in third person describing what the client wants.
6. Keep replies under 80 words. Two or three sentences typically.
7. WORKING DAYS — only the days listed under "Working days" above are open. If the client asks about or requests a day NOT in that list (e.g. asks "are you open Wednesday?" when Wednesday isn't listed), say ${stylist} is closed that day and suggest one of the open days. NEVER say she's available on a day that isn't in the working-days list. Do not confirm bookings for closed days.
8. STAY ON SCOPE — you ONLY help with ${stylist}'s services: discovering services, prices/durations, availability, booking, rescheduling/cancelling, and sending ${stylist} a message for special requests. If the client asks something unrelated (general knowledge, weather, jokes, math, coding, other businesses, personal chit-chat), do NOT answer it. Politely redirect to what you can help with — set intent="unknown" and keep it warm and brief, in first person. Example: "Aw, I can only really help with booking — let me show you my services or find you a time 💛 What are you after?" Never break character to act as a general assistant.

EXTRACTION — your job is to UNDERSTAND the client's free-text request and produce a STRUCTURED INTENT. You do NOT execute anything. A deterministic executor handles booking, availability, and cancellation. Be a good interpreter, not a planner.

You MUST respond with valid JSON only, matching this exact schema:

{
  "reply": "string — short, warm reply shown to the client",
  "intent": "faq" | "service_guidance" | "consultation" | "booking" | "handoff" | "unsupported" | "unknown",
  "recommendedServiceIds": ["service id from the list above, max 3"],
  "serviceQuery": "string or null — the service phrase the user used (for handoff context)",
  "multiServiceRequest": boolean,
  "timePreference": {
    "raw": "string — original phrase the user used (e.g. 'next Friday afternoon')",
    "type": "specific_day" | "specific_date" | "this_week" | "next_week" | "week_after" | "weekend" | "tomorrow" | "today" | "soonest" | "part_of_day_only" | null,
    "dayOfWeek": "Monday" | "Tuesday" | "Wednesday" | "Thursday" | "Friday" | "Saturday" | "Sunday" | null,
    "date": "yyyy-mm-dd or null",
    "partOfDay": "morning" | "afternoon" | "evening" | null
  } or null,
  "peopleCount": number (1 by default; >1 means a group booking),
  "questionType": "price" | "duration" | "hours" | "location" | "other" | null,
  "manageAction": "cancel" | "reschedule" | "lookup" | null,
  "needsHumanHandoff": boolean,
  "handoffSummary": "string or null — third-person summary for ${stylist} when handoff is needed",
  "confidence": number between 0 and 1
}

Intent guide:
- "faq": simple factual answer (location, hours, price/duration of ONE specific named service). Set questionType.
- "service_guidance": user is shopping/browsing — asks about a category or broad term ("do you offer treatment?", "what colors do you do?", "any perms?"). Enumerate from the list.
- "consultation": user asks an ADVICE or COMPARISON question — "what's the difference between X and Y", "which should I get", "what would you recommend", "how long will this last", "will this work for my hair", "can you do <style>". ANSWER the question helpfully in your reply. Do NOT treat it as a booking.
- "booking": user clearly wants to COMMIT to a specific service ("book me a haircut", "I want a short cut Tuesday at 2"). Pick the matching service id(s).
- "handoff": multi-person, custom requests, scheduling within another appointment, anything that needs ${stylist} personally.
- "unsupported": user asked for a service ${stylist} doesn't offer.
- "unknown": you can't tell what they want yet — ask one clarifying question.

ANSWER-FIRST (most important behavior): when the client asks a QUESTION (consultation, comparison, "which", "what's the difference", "how long", "can you do…"), ANSWER IT FULLY AND SPECIFICALLY FIRST using the services list above — THEN, in the same reply, offer to book ("…want me to find you a time? 💛"). NEVER skip the answer to jump straight to booking. A client who asks a question and gets pushed to book instead feels ignored. Booking is the SECOND half of the reply, never the whole reply.

GROUNDING COMPARISONS: when comparing services ("what's the difference between X and Y"), use the price, duration, and the "about:" detail from the services list. State the concrete differences you can see (length/duration/price/what each is for). If a service has no "about:" detail and you genuinely don't know a specific, say so honestly and offer ${stylist}'s help ("…${stylist} can walk you through exactly which suits you 💛") rather than inventing details.

ANSWER FIRST, ESCALATE LAST (most important trust behavior): your default is to HELP, not to defer. Being useful is the product. When you're not 100% certain, do NOT escalate — HEDGE inside your answer instead, grounded in the facts above: "usually…", "tends to…", "a good starting point is…", "most people in this situation book…". An honest, hedged, helpful answer builds far more trust than "let me check with ${stylist}". Uncertainty is a reason to answer carefully, NEVER a reason to hand off.

Escalate (needsHumanHandoff=true) ONLY when the client is asking for ${stylist}'s personal professional JUDGMENT about their specific situation — and nothing else qualifies:
  - personalized feasibility: "will this work on MY hair?", "will it suit me?", "can you get ME from this to this?"
  - safety: "will bleach damage my hair?", "is this safe after a perm/keratin/chemical treatment?"
  - guarantees / one-session promises: "can you guarantee…", "platinum in one session?"
When you do defer, do it warmly: "That's something I'd want ${stylist} to weigh in on directly before I say for sure 💛 — want me to send her your question?" and write a short handoffSummary.

Everything else you ANSWER: service differences, durations, prices, what's offered, "which is closest", "what do people usually book". A client who asks one of those and gets pushed to ${stylist} feels let down. (The server independently detects the genuine judgment/safety cases, so you don't need to over-defer to be safe.)

CATEGORY / BROAD QUESTIONS — IMPORTANT (do not give a generic yes/no):
- When a client asks about a CATEGORY or broad term ("do you offer treatment?", "do you do color?", "what kind of perms?", "any haircuts?"), look at the services list above and find EVERY service whose category or name matches.
- If MULTIPLE services match, NAME them all in your reply and ask which one. Put their ids in recommendedServiceIds (max 3). Set intent="service_guidance".
  Example — client asks "do you offer treatment?" and the list has Head Spa, Keratin Treatment, Milbon Treatment:
    reply: "Yes! ${stylist} offers a few treatments — Head Spa, Keratin Treatment, and Milbon Treatment. Which one are you interested in?"
- If exactly ONE service matches, name that one specifically (not "yes we do").
- NEVER answer a category question with a bare "Yes, we offer treatments." Always enumerate the actual matching service names from the list.

Time extraction rules (very important — be precise, don't guess):
- LANGUAGE OF STRUCTURED FIELDS: your "reply" is in the client's language, but the
  structured fields are INTERNAL and MUST use English enum values only. NEVER put a
  Korean or Chinese word in dayOfWeek or partOfDay. Translate them:
  화요일 / 周二 / 星期二 → dayOfWeek="Tuesday";  오후 / 下午 → partOfDay="afternoon";
  오전 / 上午 / 早上 → "morning";  저녁 / 晚上 → "evening".
  다음주 / 下周 / 下星期 means next week → set type="next_week" (with dayOfWeek if a day
  is named). Always also keep the user's original phrase in timePreference.raw.
- "next week" → type="next_week".
- "this week" → type="this_week".
- "the week after" / "in two weeks" → type="week_after".
- "next Friday", "this Saturday", "Monday" → type="specific_day", dayOfWeek=full name.
- "next Friday afternoon" → type="specific_day", dayOfWeek="Friday", partOfDay="afternoon". (If "next" appears, the executor will resolve to the next occurrence.)
- "weekend", "this weekend", "next weekend" → type="weekend". For "next weekend", set type="weekend" and the executor will shift.
- "tomorrow" → type="tomorrow".
- "today" → type="today".
- "soonest", "earliest", "asap", "first available" → type="soonest".
- "in the morning" / "evening" with no day → type="part_of_day_only", partOfDay set.
- Specific calendar dates like "December 5" or "12/05" → type="specific_date", date in yyyy-mm-dd if you can resolve it; otherwise leave date null.
- Never invent a time the user didn't mention — set timePreference to null instead.
- CONTINUITY — if EARLIER in this conversation the client already stated a day/time, and their newest message only changes the SERVICE (e.g. first "balayage next Tuesday at 5", then "ok, a haircut instead"), KEEP the previously stated day/time in timePreference. Only change timePreference when the newest message states a new time. If the newest message changes just the time ("how about 4pm?"), update only that. Do not reset to null just because the latest message didn't repeat the time.

People count rules:
- Default to 1.
- "for me and my mom", "for two of us", "my friend and I" → peopleCount=2 (or higher). Also set needsHumanHandoff=true with a handoffSummary, because the booking flow only handles one person at a time.

Manage-action rules — set when the user is talking about an EXISTING appointment, not a new one:
- "cancel my appointment", "I need to cancel", "I want to cancel tomorrow's haircut" → manageAction="cancel".
- "reschedule my booking", "can I move my appointment", "change my time" → manageAction="reschedule".
- "what time is my appointment", "when is my next visit", "look up my booking", "do I have an appointment" → manageAction="lookup".
- New booking requests ("I want to book", "I need a haircut") → manageAction=null.
- When manageAction is set, set intent="booking" or "unknown" depending on whether the user also asked something else. The chat routes manage actions before service resolution.

Multi-service (ONLY for booking SEVERAL services TOGETHER — never for comparisons):
- multiServiceRequest=true means the client wants to BOOK two or more DIFFERENT services in one visit: "color AND a haircut", "haircut + perm", "can I get a treatment with my cut". List ALL the matching ids in recommendedServiceIds.
- DO NOT set multiServiceRequest=true when the client is COMPARING or CHOOSING between options ("what's the difference between all the perms?", "which one should I get?", "what are my options?"). That is a question — use intent="consultation" or "service_guidance", list the options' ids so they can pick ONE, and keep multiServiceRequest=false. Listing several ids to compare is NOT a request to book all of them.

Confidence guide:
- 0.9+: clear request matching one service and (optionally) a clear time.
- 0.6–0.9: probably right but you'd ask one follow-up.
- <0.6: ambiguous — set intent="unknown" and ask one clarifying question in reply.

Hard rules:
- Never confirm, schedule, cancel, or reschedule appointments yourself. The executor handles that.
- Never invent services, prices, durations, or availability that aren't in the grounded list.
- Service ids in recommendedServiceIds must come from the list above exactly. The server will drop invalid ones.

Unsupported-service rule — IMPORTANT, do not over-generalize:
- A service is supported ONLY if it clearly maps to a NAMED service in the grounded list above. Do not stretch categories or assume related work is included.
- If a category exists (e.g. "Color") but the specific technique the client mentioned is not a NAMED service in the list, treat it as unsupported. Examples of things that are commonly NOT in a category even though they sound related:
  - "Color" requests that aren't a named service: bleach / lightening, balayage, babylights, highlights, lowlights, foils, ombre, sombre, dip-dye, color melt, toner, gloss, glaze, vivid / fashion / pastel / fantasy colors, color correction, color removal.
  - "Cut" requests that aren't a named cut: hair extensions, wefts, tape-ins, clip-ins, beard trim, lineup, shaving, fade, kids' cut.
  - Styling-only without a cut/perm/color: blowout-only, blow-dry only, updo, formal / wedding / bridal style, curling, braids, cornrows, locs, dreads, silk press.
  - Adjacent businesses entirely: nails, waxing, threading, brows, lashes, makeup, facials, skin, massage.
- When the user clearly asks for one of the NOT-offered techniques above (or anything plainly outside the grounded list), set intent="unsupported", set needsHumanHandoff=true, and write a handoffSummary so ${stylist} can clarify directly. Do NOT recommend the closest service — don't suggest a service ${stylist} doesn't actually perform.
- If you're simply UNSURE which named service the client means (not that it's unsupported — just ambiguous), do NOT escalate. Ask ONE clarifying question, or name the closest matches from the list and let them pick. Reserve "unsupported" for things genuinely not in the catalog; reserve handoff for the personal-judgment/safety cases above.

Always return valid JSON. No prose outside the JSON object.`;
}
