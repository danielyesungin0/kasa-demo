// ============================================================
// parse-intent — the ONE Claude (Haiku) booking-intent call.
//
// Mined from lib/ai/provider.ts (the old Node app), scoped DOWN to the new
// job per AI_BEHAVIOR.md. It does exactly one thing:
//   classify a conversation as `booking` vs `none`, and when `booking`,
//   extract {service_guess, preferred, candidate_times, confidence}.
//
// HARD RULES (AI_BEHAVIOR.md / PRODUCT_BRIEF.md):
//   - NEVER drafts a reply. NEVER books. Output is a suggestion only.
//   - Conservative: when unsure → intent:'none' (a false nudge erodes trust).
//   - Strict JSON out, low temperature.
//   - Writes conversations.intent + intent_payload. The app shows a dismissible
//     nudge only when intent='booking' AND there's a concrete service or time.
//
// Called by inbound channel webhooks AFTER the message is written. Ingestion
// must never block on this — callers fire-and-forget / tolerate failure.
//
// Request:  { conversation_id: string, message: string, services?: string[] }
// Response: { intent: 'booking'|'none', intent_payload: {...}|null, wrote: bool }
// ============================================================

import { corsHeaders, jsonResponse } from "../_shared/cors.ts";
import { createAdminClient } from "../_shared/supabase-admin.ts";

const ANTHROPIC_MODEL = Deno.env.get("ANTHROPIC_MODEL") ??
  "claude-haiku-4-5-20251001";

type IntentPayload = {
  service_guess: string | null;
  preferred: string | null;
  candidate_times: string[];
  confidence: number;
};

type ParseResult = {
  intent: "booking" | "none";
  intent_payload: IntentPayload | null;
};

function buildSystemPrompt(services: string[]): string {
  const serviceList = services.length
    ? services.map((s) => `  - ${s}`).join("\n")
    : "  (none provided — map service_guess in free text)";

  return `You read ONE inbound message from a hair-salon client and decide a single thing:
is this conversation pointing toward BOOKING an appointment?

You do NOT reply, draft, book, or converse. You only classify and extract. Return STRICT JSON.

The stylist's services (map service_guess to one of these names when possible):
${serviceList}

Output EXACTLY this JSON shape, nothing else (first char must be "{"):
{
  "intent": "booking" | "none",
  "service_guess": string | null,      // a service name (prefer the list above) or null
  "preferred": string | null,          // natural-language time preference, e.g. "Friday evening", or null
  "candidate_times": string[],         // parsed concrete times if present, e.g. ["Fri 5:30 PM"]; else []
  "confidence": number                 // 0.0–1.0
}

Rules:
- intent="booking" ONLY when the message is genuinely heading toward booking an appointment
  (asking for availability, naming a service + time, "can I come in", "do you have anything Friday").
- intent="none" for greetings, thank-yous, vague chat, complaints, questions that aren't about
  booking, spam, or anything ambiguous. BE CONSERVATIVE — a false "wants to book" is worse than a
  miss. When unsure, choose "none".
- Extract service_guess / preferred / candidate_times ONLY from what the client actually wrote.
  Never invent a time or service. Leave fields null / [] when not present.
- Reply in JSON only. No prose, no markdown, no code fences.`;
}

function parseClaudeJson(raw: string): ParseResult | null {
  let obj: Record<string, unknown> | null = null;
  try {
    obj = JSON.parse(raw);
  } catch {
    // Recover if the model wrapped it in prose/fences.
    const cleaned = raw.replace(/```(?:json)?/gi, "").trim();
    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");
    if (start !== -1 && end > start) {
      try {
        obj = JSON.parse(cleaned.slice(start, end + 1));
      } catch {
        return null;
      }
    } else {
      return null;
    }
  }
  if (!obj || typeof obj !== "object") return null;

  const intent = obj.intent === "booking" ? "booking" : "none";
  if (intent === "none") return { intent: "none", intent_payload: null };

  const service_guess = typeof obj.service_guess === "string" &&
      obj.service_guess.trim()
    ? obj.service_guess.trim().slice(0, 120)
    : null;
  const preferred = typeof obj.preferred === "string" && obj.preferred.trim()
    ? obj.preferred.trim().slice(0, 120)
    : null;
  const candidate_times = Array.isArray(obj.candidate_times)
    ? obj.candidate_times
      .filter((x): x is string => typeof x === "string" && x.trim().length > 0)
      .map((x) => x.trim().slice(0, 60))
      .slice(0, 5)
    : [];
  const confRaw = Number(obj.confidence);
  const confidence = Number.isFinite(confRaw)
    ? Math.min(1, Math.max(0, confRaw))
    : 0.5;

  return {
    intent: "booking",
    intent_payload: { service_guess, preferred, candidate_times, confidence },
  };
}

async function callClaude(
  message: string,
  services: string[],
): Promise<ParseResult | null> {
  const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
  if (!apiKey) {
    console.log("[parse-intent] no ANTHROPIC_API_KEY — returning none");
    return null;
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12000);
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: ANTHROPIC_MODEL,
        max_tokens: 400,
        temperature: 0,
        system: buildSystemPrompt(services),
        messages: [{ role: "user", content: message }],
      }),
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (!res.ok) {
      console.log(`[parse-intent] anthropic ${res.status}`);
      return null;
    }
    const data = await res.json();
    const raw: string = (data?.content ?? [])
      .map((b: { type: string; text?: string }) =>
        b.type === "text" ? b.text ?? "" : ""
      )
      .join("")
      .trim();
    if (!raw) return null;
    return parseClaudeJson(raw);
  } catch (err) {
    console.log("[parse-intent] claude call failed:", (err as Error).name);
    return null;
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return jsonResponse({ error: "method_not_allowed" }, 405);
  }

  let payload: {
    conversation_id?: string;
    message?: string;
    services?: string[];
  };
  try {
    payload = await req.json();
  } catch {
    return jsonResponse({ error: "invalid_json" }, 400);
  }

  const message = (payload.message ?? "").trim();
  if (!message) return jsonResponse({ error: "missing_message" }, 400);
  const services = Array.isArray(payload.services) ? payload.services : [];

  // Classify + extract. On any failure, fall back to a safe `none` (never throw,
  // never block ingestion — see AI_BEHAVIOR.md / DECISIONS.md #12).
  const result = (await callClaude(message, services)) ??
    { intent: "none" as const, intent_payload: null };

  // Persist to the conversation when one is provided. Best-effort: a write
  // failure still returns the classification so the caller isn't blocked.
  let wrote = false;
  if (payload.conversation_id) {
    try {
      const admin = createAdminClient();
      const { error } = await admin
        .from("conversations")
        .update({
          intent: result.intent,
          intent_payload: result.intent_payload,
        })
        .eq("id", payload.conversation_id);
      wrote = !error;
      if (error) console.log("[parse-intent] update failed:", error.message);
    } catch (err) {
      console.log("[parse-intent] db write failed:", (err as Error).message);
    }
  }

  return jsonResponse({ ...result, wrote });
});
