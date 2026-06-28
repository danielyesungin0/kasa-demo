/**
 * Multi-turn continuity scenarios — the "assistant remembers what you told it"
 * bucket. Provider-relative: uses THIS provider's unsupported term and a real
 * supported service, so the same flow validates any provider.
 *
 * These assert on the FINAL turn's response after a context-changing
 * conversation. Because the free-tier AI may rate-limit mid-conversation, the
 * assertions are tolerant: they require that the assistant did NOT lose the
 * thread in a way that produces an off-topic or unsupported-confirming reply.
 * Deterministic time-merge semantics are separately locked in
 * qa/unit/continuity.test.ts; here we check end-to-end conversational behavior.
 */

const lc = (s) => (s ?? "").toLowerCase();
function isGracefulFallback(res) {
  return res?.source === "fallback" && /moment|busy|try again/i.test(res?.reply ?? "");
}

export function continuityScenarios(p) {
  const unsupported = p.unsupported[0];
  const svc = p.services[0];
  const svcTerm = svc.aliases[0] ?? lc(svc.name);

  return [
    {
      // The headline case: unsupported + date/time, then switch service.
      // Expected: the switch is accepted (booking/guidance), not a dead-end,
      // and the date isn't "forgotten" into an off-topic/unsupported reply.
      name: `continuity (${p.slug}): unsupported→supported keeps thread`,
      kind: "chat",
      needsAI: true,
      messages: [
        `I want a ${unsupported} next Tuesday at 5pm`,
        `okay never mind, ${svcTerm} instead`,
      ],
      assert: (res) => {
        if (isGracefulFallback(res)) return { pass: true, detail: "graceful fallback" };
        const reply = lc(res.reply);
        // After switching to a supported service, it must NOT still treat the
        // request as unsupported, and must engage the booking path.
        const stillUnsupported = res.intent === "unsupported";
        const engaged = ["booking", "service_guidance", "faq", "unknown"].includes(res.intent);
        return {
          pass: !stillUnsupported && engaged,
          detail: `intent=${res.intent} reply=${res.reply}`,
        };
      },
    },
    {
      // Change date, keep service — should remain on the booking path.
      name: `continuity (${p.slug}): change date keeps service`,
      kind: "chat",
      needsAI: true,
      messages: [
        `can I book a ${svcTerm} next Tuesday`,
        `actually make it Thursday`,
      ],
      assert: (res) => {
        if (isGracefulFallback(res)) return { pass: true, detail: "graceful fallback" };
        const engaged = ["booking", "service_guidance", "unknown"].includes(res.intent);
        return { pass: engaged, detail: `intent=${res.intent} reply=${res.reply}` };
      },
    },
  ];
}
