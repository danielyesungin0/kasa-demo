import { describe, it, expect } from "vitest";
import { slugifyBase, deriveSlugBase } from "@/lib/stylists/slug";

/**
 * Pure slug helpers (no DB). generateUniqueSlug's dedup loop is DB-backed and
 * covered by integration/manual checks; here we lock the deterministic pieces:
 * slugify normalization + the candidate fallback chain.
 */

describe("slugifyBase", () => {
  it("lowercases and dashes spaces/punctuation", () => {
    expect(slugifyBase("Shen's Hair Studio")).toBe("shen-s-hair-studio");
  });
  it("folds accents", () => {
    expect(slugifyBase("Café Déjà")).toBe("cafe-deja");
  });
  it("trims surrounding whitespace and dashes", () => {
    expect(slugifyBase("  --Hello--  ")).toBe("hello");
  });
  it("collapses repeated separators", () => {
    expect(slugifyBase("a   &&&   b")).toBe("a-b");
  });
  it("passes through an already-clean slug", () => {
    expect(slugifyBase("shen")).toBe("shen");
  });
  it("returns '' for empty/nullish/punctuation-only input", () => {
    expect(slugifyBase("")).toBe("");
    expect(slugifyBase(null)).toBe("");
    expect(slugifyBase(undefined)).toBe("");
    expect(slugifyBase("!!!")).toBe("");
  });
  it("caps length (does not explode on long names)", () => {
    const out = slugifyBase("a".repeat(200));
    expect(out.length).toBeLessThanOrEqual(40);
  });
});

describe("deriveSlugBase — candidate fallback chain", () => {
  it("prefers the first usable candidate (preferred slug)", () => {
    expect(deriveSlugBase(["shen", "Some Business", "Team Name"])).toBe("shen");
  });
  it("falls through to the next when earlier ones are empty/unusable", () => {
    expect(deriveSlugBase([null, "", "Jane's Salon"])).toBe("jane-s-salon");
  });
  it("skips punctuation-only candidates", () => {
    expect(deriveSlugBase(["!!!", "   ", "Real Name"])).toBe("real-name");
  });
  it("defaults to 'provider' when nothing is usable", () => {
    expect(deriveSlugBase([null, undefined, "", "###"])).toBe("provider");
  });
});
