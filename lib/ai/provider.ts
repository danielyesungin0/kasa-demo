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

export type AIIntent =
  | "faq"
  | "service_guidance"
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

/**
 * Single entry point. Returns null on any failure — the caller falls back
 * to deterministic chat.
 */
export async function callAI(
  ctx: AIRequestContext,
  opts: AIRequestOptions = {}
): Promise<AIResponse | null> {
  if (process.env.AI_ENABLED !== "true") {
    if (opts.debug) console.log("[ai] disabled via AI_ENABLED env var");
    return null;
  }

  const provider = process.env.AI_PROVIDER ?? "groq";
  switch (provider) {
    case "groq":
      return callGroq(ctx, opts);
    default:
      if (opts.debug) console.log(`[ai] unknown provider: ${provider}`);
      return null;
  }
}

/* -------------------------------------------------------------------------- */
/* Groq                                                                       */
/* -------------------------------------------------------------------------- */

const GROQ_ENDPOINT = "https://api.groq.com/openai/v1/chat/completions";

async function callGroq(
  ctx: AIRequestContext,
  opts: AIRequestOptions
): Promise<AIResponse | null> {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    if (opts.debug) console.log("[ai] groq: no GROQ_API_KEY");
    return null;
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
        // wrapped in try/catch below because the *content* of the JSON
        // (the AIResponse fields) may still be malformed.
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
      return null;
    }

    const data = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const raw = data.choices?.[0]?.message?.content;
    if (!raw) {
      if (opts.debug) console.log("[ai] groq: empty content");
      return null;
    }

    if (opts.debug) console.log("[ai] groq raw response:", raw.slice(0, 500));

    return parseStructured(raw, opts);
  } catch (err) {
    if (opts.debug) console.log("[ai] groq fetch failed:", err);
    return null;
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
    if (opts.debug) console.log("[ai] response not valid JSON");
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;
  const obj = parsed as Record<string, unknown>;

  const intentRaw = String(obj.intent ?? "");
  const intent: AIIntent =
    intentRaw === "faq" ||
    intentRaw === "service_guidance" ||
    intentRaw === "booking" ||
    intentRaw === "handoff" ||
    intentRaw === "unsupported"
      ? intentRaw
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
        `  - id: ${s.id} | name: ${s.name} | category: ${s.category} | price: ${s.priceLabel} | duration: ${s.durationLabel}${s.status === "consultation" ? " | consultation-only" : ""}`
    )
    .join("\n");

  return `You are ${stylist}'s booking helper${studio} — a friendly, concise messaging interface that helps clients book appointments, understand services, and get questions answered.

You are NOT ${stylist} herself. If asked directly, say: "I'm ${stylist}'s booking helper. I can answer common questions, help you choose the right appointment, and send ${stylist} a summary if she needs to confirm." Never say you are an AI, an assistant, or a bot — just ${stylist}'s booking helper.

Tone: short, warm, natural, conversational. One follow-up question at a time. Avoid jargon. Avoid robotic phrases like "as an AI", "I cannot", "my apologies". Speak the way a thoughtful receptionist would.

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

EXTRACTION — your job is to UNDERSTAND the client's free-text request and produce a STRUCTURED INTENT. You do NOT execute anything. A deterministic executor handles booking, availability, and cancellation. Be a good interpreter, not a planner.

You MUST respond with valid JSON only, matching this exact schema:

{
  "reply": "string — short, warm reply shown to the client",
  "intent": "faq" | "service_guidance" | "booking" | "handoff" | "unsupported" | "unknown",
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
- "faq": simple factual answer (location, hours, "do you offer X", price/duration of a specific service). Set questionType.
- "service_guidance": user is shopping for a service but hasn't committed; recommend from the list.
- "booking": user wants to book something specific — pick the matching service id(s).
- "handoff": multi-person, "for me and my mom", custom requests, scheduling within another appointment, multiple unrelated questions, anything that needs ${stylist} personally.
- "unsupported": user asked for a service ${stylist} doesn't offer.
- "unknown": you can't tell what they want yet — ask one clarifying question.

Time extraction rules (very important — be precise, don't guess):
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

People count rules:
- Default to 1.
- "for me and my mom", "for two of us", "my friend and I" → peopleCount=2 (or higher). Also set needsHumanHandoff=true with a handoffSummary, because the booking flow only handles one person at a time.

Manage-action rules — set when the user is talking about an EXISTING appointment, not a new one:
- "cancel my appointment", "I need to cancel", "I want to cancel tomorrow's haircut" → manageAction="cancel".
- "reschedule my booking", "can I move my appointment", "change my time" → manageAction="reschedule".
- "what time is my appointment", "when is my next visit", "look up my booking", "do I have an appointment" → manageAction="lookup".
- New booking requests ("I want to book", "I need a haircut") → manageAction=null.
- When manageAction is set, set intent="booking" or "unknown" depending on whether the user also asked something else. The chat routes manage actions before service resolution.

Multi-service:
- "color and haircut", "haircut + perm" → multiServiceRequest=true, list ALL matching service ids in recommendedServiceIds.

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
- When the user asks about ANY of the above, OR anything you're not 90%+ sure maps to a NAMED service in the list, set intent="unsupported", set needsHumanHandoff=true, and write a handoffSummary so ${stylist} can clarify directly. Do NOT recommend the closest service. It's safer to escalate than to suggest a service ${stylist} doesn't actually perform.
- When in doubt, prefer "unsupported" over "service_guidance" or "booking". The cost of escalating is low; the cost of booking the wrong service is high.

Always return valid JSON. No prose outside the JSON object.`;
}
