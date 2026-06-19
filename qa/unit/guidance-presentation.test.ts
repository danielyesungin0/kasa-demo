import { describe, it, expect } from "vitest";
import { decideGuidancePresentation } from "@/lib/ai/guidance-presentation";

/**
 * The "answer-first, don't assume a booking" contract — the fix for the bug
 * where asking "what's the difference between all of them?" stacked every perm
 * option into a cart with an estimated total.
 *
 * Rule:
 *   - service_guidance + multiple options  → a chooser ("options"), NO cart
 *   - genuine multi-service booking         → recommendation WITH cart
 *   - single service (guidance or booking)  → recommendation, NO cart
 *
 * Tested across EVERY category (haircut, perm, color, treatment, nails) because
 * the bug was category-agnostic — it just needed >1 matching service.
 */

// Representative multi-option counts per category (mirrors the real catalog:
// 6 perms, 3 treatments, 2 colors, 2 haircuts, plus nails).
const CATEGORIES: { name: string; count: number }[] = [
  { name: "Perm", count: 6 },
  { name: "Treatment", count: 3 },
  { name: "Color", count: 2 },
  { name: "Haircut", count: 2 },
  { name: "Manicure", count: 4 },
  { name: "Pedicure", count: 3 },
];

describe("decideGuidancePresentation — 'which of these?' is a chooser, never a cart", () => {
  for (const c of CATEGORIES) {
    it(`${c.name}: ${c.count} options via service_guidance → options (no cart)`, () => {
      const p = decideGuidancePresentation({
        intent: "service_guidance",
        resolvedServiceCount: c.count,
        multiServiceRequest: false,
      });
      expect(p).toEqual({ kind: "options" });
    });
  }

  it("does NOT cart even if the model mislabels multiServiceRequest on guidance", () => {
    // Guidance is a question, not a commitment — multiServiceRequest on a
    // guidance intent must not produce a cart.
    const p = decideGuidancePresentation({
      intent: "service_guidance",
      resolvedServiceCount: 6,
      multiServiceRequest: true,
    });
    expect(p).toEqual({ kind: "options" });
  });
});

describe("decideGuidancePresentation — single service is a normal recommendation", () => {
  for (const intent of ["service_guidance", "booking"] as const) {
    it(`${intent} + 1 service → recommendation without cart`, () => {
      const p = decideGuidancePresentation({
        intent,
        resolvedServiceCount: 1,
        multiServiceRequest: false,
      });
      expect(p).toEqual({ kind: "recommendation", withCart: false });
    });
  }
});

describe("decideGuidancePresentation — genuine multi-service booking gets a cart", () => {
  it("booking + multiServiceRequest + 2 services → recommendation WITH cart", () => {
    const p = decideGuidancePresentation({
      intent: "booking",
      resolvedServiceCount: 2,
      multiServiceRequest: true,
    });
    expect(p).toEqual({ kind: "recommendation", withCart: true });
  });

  it("booking with multiple services but NOT flagged multi → no cart (picks primary)", () => {
    const p = decideGuidancePresentation({
      intent: "booking",
      resolvedServiceCount: 3,
      multiServiceRequest: false,
    });
    expect(p).toEqual({ kind: "recommendation", withCart: false });
  });
});

describe("decideGuidancePresentation — nothing service-shaped", () => {
  it("zero services → none", () => {
    expect(
      decideGuidancePresentation({
        intent: "service_guidance",
        resolvedServiceCount: 0,
        multiServiceRequest: false,
      })
    ).toEqual({ kind: "none" });
  });
  for (const intent of ["faq", "consultation", "handoff", "unsupported", "unknown"] as const) {
    it(`${intent} intent → none (handled elsewhere)`, () => {
      expect(
        decideGuidancePresentation({
          intent,
          resolvedServiceCount: 2,
          multiServiceRequest: false,
        })
      ).toEqual({ kind: "none" });
    });
  }
});
