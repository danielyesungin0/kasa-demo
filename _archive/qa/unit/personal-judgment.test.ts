import { describe, it, expect } from "vitest";
import { looksLikePersonalJudgment } from "@/lib/personal-judgment";

/**
 * Escalate-last: the deterministic trigger must fire ONLY for personalized
 * professional judgment (feasibility on THIS person, safety, guarantees,
 * one-session transformations) — and must NOT fire for ordinary consultation
 * questions the assistant should answer.
 *
 * The two `describe` blocks are the contract for the consultation-first vision:
 * the first is "must escalate", the second is "must answer (never escalate)".
 */

describe("looksLikePersonalJudgment — MUST escalate (stylist's call)", () => {
  const shouldEscalate = [
    // personalized feasibility
    "will this work on my hair?",
    "do you think this would suit me with my face shape?",
    "can you do this exact look on my hair?",
    "is my hair long enough for this?",
    "is my hair too damaged to bleach?",
    // safety / chemical history
    "will bleach damage my hair?",
    "is this safe after a perm?",
    "is it okay to color since I recently got a keratin treatment?",
    "my hair was chemically treated recently, is this safe?",
    "I just bleached it last week, would another round ruin it?",
    // one-session / transformation guarantees
    "can I go platinum in one session?",
    "can you get me from this to platinum in one appointment?",
    "can you take me from black to blonde in a single sitting?",
    // explicit guarantees
    "can you guarantee it won't look brassy?",
    "are you 100% sure it'll turn out the way I want?",
  ];

  for (const msg of shouldEscalate) {
    it(`escalates: "${msg}"`, () => {
      expect(looksLikePersonalJudgment(msg)).not.toBeNull();
    });
  }
});

describe("looksLikePersonalJudgment — MUST answer (never escalate)", () => {
  const shouldAnswer = [
    // the user's exact answer-first examples
    "what's the difference between short and medium?",
    "which service sounds closest to this?",
    "what do people usually book for this?",
    "how long does this take?",
    "what's included?",
    "how much does this cost?",
    // more ordinary consultation/booking phrasing
    "which one should I get?",
    "what would you recommend?",
    "how long will a balayage last?",
    "do you offer treatments?",
    "can I book a haircut tomorrow at 1?",
    "what's your cancellation policy?",
    "how much is a perm?",
    "is the head spa relaxing?", // 'safe'-adjacent word but not a safety question
  ];

  for (const msg of shouldAnswer) {
    it(`answers: "${msg}"`, () => {
      expect(looksLikePersonalJudgment(msg)).toBeNull();
    });
  }
});
