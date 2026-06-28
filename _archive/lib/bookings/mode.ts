/**
 * Pure booking-mode decision logic, extracted from app/api/bookings/route.ts so
 * the money-path (confirmed vs failed vs Square-required) is unit-testable
 * without any Square call or DB write.
 *
 * The route imports these and acts on the result; behavior is identical to the
 * previous inline logic. Keeping it pure means the regression suite can prove:
 *   - LIVE never confirms without a real Square booking id
 *   - LIVE with missing creds errors BEFORE saving anything
 *   - LIVE Square failure writes a 'failed' diagnostic row and errors (no fake confirm)
 *   - TEST saves Supabase-only, no Square call
 *   - LEGACY tries Square but falls back to Supabase
 */

export type BookingMode = "live" | "test" | "legacy";

/**
 * Map the SQUARE_BOOKING_ENABLED env value to a mode.
 *   "true"  → live   (Square required)
 *   "false" → test   (Supabase-only, no Square)
 *   unset/other → legacy (try Square, fall back to Supabase)
 */
export function resolveBookingMode(squareBookingEnabled: string | undefined): BookingMode {
  if (squareBookingEnabled === "true") return "live";
  if (squareBookingEnabled === "false") return "test";
  return "legacy";
}

/**
 * Step 1 — given the mode and whether Square is fully wired up, decide whether
 * the route should call Square, and (in live mode) whether it must bail early.
 */
export type PreSquareDecision =
  | { action: "require_square_attempt" } // live + ready → must call Square
  | { action: "error_square_not_ready" } // live + not ready → 502 before any save
  | { action: "attempt_square_then_fallback" } // legacy + ready → try Square, fall back
  | { action: "skip_square" }; // test, or legacy-not-ready → Supabase-only

export function decidePreSquare(
  mode: BookingMode,
  squareReady: boolean
): PreSquareDecision {
  if (mode === "live") {
    return squareReady
      ? { action: "require_square_attempt" }
      : { action: "error_square_not_ready" };
  }
  if (mode === "legacy" && squareReady) {
    return { action: "attempt_square_then_fallback" };
  }
  // test mode (never calls Square), or legacy without readiness.
  return { action: "skip_square" };
}

/**
 * Step 2 — after any Square attempt, decide the final outcome: confirm the
 * booking, or (live only) record a failed diagnostic row and return an error.
 *
 * `squareBookingId` is the result of the Square attempt (null if none/failed).
 */
export type FinalDecision =
  | { outcome: "save_confirmed"; squareBookingId: string | null }
  | { outcome: "save_failed_and_error" }; // live + no square id → 'failed' row + 502

export function decideFinalOutcome(
  mode: BookingMode,
  squareBookingId: string | null
): FinalDecision {
  // LIVE is the only mode that refuses to confirm without a real Square id.
  if (mode === "live" && !squareBookingId) {
    return { outcome: "save_failed_and_error" };
  }
  // live (with id), test (id null by design), legacy (id or fallback null).
  return { outcome: "save_confirmed", squareBookingId };
}

/**
 * Square readiness predicate — all four must be present to create a real
 * Square Appointments booking.
 */
export function isSquareReady(input: {
  accessToken: string | null | undefined;
  locationId: string | null | undefined;
  teamMemberId: string | null | undefined;
  serviceVariationId: string | null | undefined;
}): boolean {
  return Boolean(
    input.accessToken &&
      input.locationId &&
      input.teamMemberId &&
      input.serviceVariationId
  );
}
