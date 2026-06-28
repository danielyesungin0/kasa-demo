import { describe, it, expect } from "vitest";
import {
  resolveBookingMode,
  decidePreSquare,
  decideFinalOutcome,
  isSquareReady,
} from "@/lib/bookings/mode";

/**
 * Money-path coverage: the rules that protect confirmed-vs-failed bookings.
 * No Square calls, no DB — pure decision logic mirrored from the bookings route.
 */

describe("resolveBookingMode", () => {
  it("'true' → live", () => expect(resolveBookingMode("true")).toBe("live"));
  it("'false' → test", () => expect(resolveBookingMode("false")).toBe("test"));
  it("undefined → legacy", () => expect(resolveBookingMode(undefined)).toBe("legacy"));
  it("any other value → legacy (fail-safe to existing behavior)", () => {
    expect(resolveBookingMode("")).toBe("legacy");
    expect(resolveBookingMode("yes")).toBe("legacy");
    expect(resolveBookingMode("1")).toBe("legacy");
  });
});

describe("isSquareReady", () => {
  const full = {
    accessToken: "tok",
    locationId: "loc",
    teamMemberId: "tm",
    serviceVariationId: "var",
  };
  it("all four present → ready", () => expect(isSquareReady(full)).toBe(true));

  it("any one missing → not ready", () => {
    expect(isSquareReady({ ...full, accessToken: null })).toBe(false);
    expect(isSquareReady({ ...full, locationId: null })).toBe(false);
    expect(isSquareReady({ ...full, teamMemberId: null })).toBe(false);
    expect(isSquareReady({ ...full, serviceVariationId: undefined })).toBe(false);
  });
});

describe("decidePreSquare", () => {
  it("LIVE + ready → must attempt Square", () => {
    expect(decidePreSquare("live", true)).toEqual({ action: "require_square_attempt" });
  });
  it("LIVE + NOT ready → error before any save (never a Supabase-only confirm)", () => {
    expect(decidePreSquare("live", false)).toEqual({ action: "error_square_not_ready" });
  });
  it("LEGACY + ready → attempt Square then fall back", () => {
    expect(decidePreSquare("legacy", true)).toEqual({ action: "attempt_square_then_fallback" });
  });
  it("LEGACY + not ready → skip Square (Supabase-only)", () => {
    expect(decidePreSquare("legacy", false)).toEqual({ action: "skip_square" });
  });
  it("TEST → always skip Square, regardless of readiness", () => {
    expect(decidePreSquare("test", true)).toEqual({ action: "skip_square" });
    expect(decidePreSquare("test", false)).toEqual({ action: "skip_square" });
  });
});

describe("decideFinalOutcome — confirmed vs failed", () => {
  it("LIVE + real Square id → confirmed", () => {
    expect(decideFinalOutcome("live", "sq_123")).toEqual({
      outcome: "save_confirmed",
      squareBookingId: "sq_123",
    });
  });

  it("LIVE + NO Square id → failed diagnostic + error (NEVER a fake confirm)", () => {
    expect(decideFinalOutcome("live", null)).toEqual({ outcome: "save_failed_and_error" });
  });

  it("TEST → confirmed with null Square id (Supabase-only, by design)", () => {
    expect(decideFinalOutcome("test", null)).toEqual({
      outcome: "save_confirmed",
      squareBookingId: null,
    });
  });

  it("LEGACY + Square id → confirmed with id", () => {
    expect(decideFinalOutcome("legacy", "sq_legacy")).toEqual({
      outcome: "save_confirmed",
      squareBookingId: "sq_legacy",
    });
  });

  it("LEGACY + fallback (no id) → still confirmed (legacy Supabase fallback allowed)", () => {
    expect(decideFinalOutcome("legacy", null)).toEqual({
      outcome: "save_confirmed",
      squareBookingId: null,
    });
  });
});

describe("end-to-end mode invariant: live never confirms without Square", () => {
  // The critical guarantee, expressed as a property over the two-step decision.
  const cases = [
    { ready: true, squareId: "sq_ok", expectConfirmed: true },
    { ready: true, squareId: null, expectConfirmed: false }, // Square attempted, failed
    { ready: false, squareId: null, expectConfirmed: false }, // bailed before save
  ];
  for (const c of cases) {
    it(`live ready=${c.ready} squareId=${c.squareId} → confirmed=${c.expectConfirmed}`, () => {
      const pre = decidePreSquare("live", c.ready);
      if (pre.action === "error_square_not_ready") {
        // Bailed early — definitionally not confirmed.
        expect(c.expectConfirmed).toBe(false);
        return;
      }
      const final = decideFinalOutcome("live", c.squareId);
      const confirmed = final.outcome === "save_confirmed";
      expect(confirmed).toBe(c.expectConfirmed);
    });
  }
});
