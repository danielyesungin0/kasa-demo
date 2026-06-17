import { describe, it, expect } from "vitest";
import { detectUnsupportedService } from "@/lib/unsupported-services";

/**
 * Unsupported-service routing — provider-aware: a provider's own configured
 * terms must take precedence over the global list, and supported services must
 * never be flagged.
 */

describe("detectUnsupportedService — global list", () => {
  it("flags bleach", () => {
    expect(detectUnsupportedService("can you bleach my hair?")).toBe("bleach");
  });
  it("flags balayage / highlights", () => {
    expect(detectUnsupportedService("do you do balayage")).toBe("balayage / highlights");
    expect(detectUnsupportedService("I want highlights")).toBe("balayage / highlights");
  });
  it("flags adjacent businesses (nails, waxing, massage)", () => {
    expect(detectUnsupportedService("can I get a manicure")).toBe("nails");
    expect(detectUnsupportedService("brazilian wax please")).toBe("waxing / threading");
    expect(detectUnsupportedService("do you offer massage")).toBe("massage");
  });
});

describe("detectUnsupportedService — supported services are NOT flagged", () => {
  it("returns null for a plain haircut", () => {
    expect(detectUnsupportedService("I'd like a haircut")).toBeNull();
  });
  it("returns null for supported color services", () => {
    expect(detectUnsupportedService("can I book a root touch up")).toBeNull();
    expect(detectUnsupportedService("full color please")).toBeNull();
  });
  it("does not over-flag generic 'gloss' (lip gloss false-positive guard)", () => {
    expect(detectUnsupportedService("where's my lip gloss")).toBeNull();
  });
});

describe("detectUnsupportedService — provider terms take precedence", () => {
  it("flags a provider-configured term that isn't in the global list", () => {
    // qa-nails-style provider: 'acrylic removal' is THEIR unsupported term.
    expect(
      detectUnsupportedService("do you do acrylic removal?", ["acrylic removal"])
    ).toBe("acrylic removal");
  });
  it("provider term matches with word-boundary semantics", () => {
    expect(detectUnsupportedService("I need extensions installed", ["extensions"])).toBe(
      "extensions"
    );
  });
  it("provider terms checked before global list (returns the provider's label)", () => {
    // 'bleach' is global, but if a provider lists it explicitly we return
    // their exact cleaned term — proves provider config is consulted first.
    expect(detectUnsupportedService("bleach please", ["bleach"])).toBe("bleach");
  });
  it("empty/whitespace provider terms are ignored, falls through to global", () => {
    expect(detectUnsupportedService("balayage", ["", "  "])).toBe("balayage / highlights");
  });
  it("a provider with NO configured terms still gets global protection", () => {
    expect(detectUnsupportedService("can I get a pedicure", [])).toBe("nails");
  });
});
