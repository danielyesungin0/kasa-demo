import { describe, it, expect } from "vitest";
import {
  categoryBrowseOptions,
  detectBareCategory,
  bookableInCategory,
} from "@/lib/ai/category-browse";
import type { Service } from "@/lib/types";

/**
 * "Don't assume a single service for a bare category" + "cards for every
 * category". Typing just "perm" / "treatment" / "color" / "haircut" should
 * surface that category's services as cards, NOT pre-pick or ask abstract
 * button clarifiers. A specific service or a real multi-service request does
 * NOT trigger the chooser.
 */

const svc = (over: Partial<Service> & { id: string; category: Service["category"] }): Service => ({
  name: over.id,
  priceLabel: "$100",
  durationMinutes: 60,
  durationLabel: "1 hr",
  status: "online",
  ...over,
});

const CATALOG: Service[] = [
  svc({ id: "perm-bang", category: "Perm" }),
  svc({ id: "perm-womens-regular", category: "Perm" }),
  svc({ id: "perm-womens-digital", category: "Perm", status: "consultation" }),
  svc({ id: "perm-straightening", category: "Perm" }),
  svc({ id: "perm-cut-down", category: "Perm" }),
  svc({ id: "perm-mens-cut", category: "Perm" }),
  svc({ id: "treat-headspa", category: "Treatment" }),
  svc({ id: "treat-keratin", category: "Treatment" }),
  svc({ id: "treat-milbon", category: "Treatment" }),
  svc({ id: "color-root", category: "Color" }),
  svc({ id: "color-full", category: "Color" }),
  svc({ id: "cut-short", category: "Haircut" }),
  svc({ id: "cut-long", category: "Haircut" }),
  svc({ id: "perm-hidden", category: "Perm", status: "hidden" }),
];

describe("detectBareCategory — a bare category word", () => {
  const cases: [string, Service["category"] | null][] = [
    ["treatment", "Treatment"],
    ["a perm", "Perm"],
    ["any colors?", "Color"],
    ["haircut please", "Haircut"],
    ["hair cut", "Haircut"],
    ["i want a treatment", "Treatment"],
    // NOT bare — specific or a question, leave to other paths:
    ["straightening perm", "Perm"], // still a category word; specificity handled upstream by comboServiceId
    ["what's the difference between the perms and treatments", null], // too long / comparison
    ["", null],
  ];
  for (const [text, expected] of cases) {
    it(`"${text}" → ${expected}`, () => {
      expect(detectBareCategory(text)).toBe(expected);
    });
  }
});

describe("categoryBrowseOptions — cards for EVERY bare category", () => {
  it("perm → all bookable perms (hidden excluded), 6", () => {
    const out = categoryBrowseOptions({ rawText: "perm", tags: ["Perm"] }, CATALOG);
    expect(out?.length).toBe(6);
    expect(out!.map((s) => s.id)).not.toContain("perm-hidden");
  });
  it("treatment (parser tagged nothing) → 3 treatments via bare-word fallback", () => {
    const out = categoryBrowseOptions({ rawText: "treatment", tags: [] }, CATALOG);
    expect(out?.map((s) => s.id).sort()).toEqual([
      "treat-headspa",
      "treat-keratin",
      "treat-milbon",
    ]);
  });
  it("color → both color options (no more root/full button clarifier)", () => {
    const out = categoryBrowseOptions({ rawText: "color", tags: ["Color"] }, CATALOG);
    expect(out?.map((s) => s.id).sort()).toEqual(["color-full", "color-root"]);
  });
  it("haircut → both haircuts (no more short/long button clarifier)", () => {
    const out = categoryBrowseOptions({ rawText: "haircut", tags: ["Haircut"] }, CATALOG);
    expect(out?.length).toBe(2);
  });
});

describe("categoryBrowseOptions — does NOT fire (book directly / other path)", () => {
  it("a pinned combo SKU → null", () => {
    expect(
      categoryBrowseOptions(
        { rawText: "men's perm", tags: ["Perm"], comboServiceId: "perm-mens-cut" },
        CATALOG
      )
    ).toBeNull();
  });
  it("a specified perm style → null", () => {
    expect(
      categoryBrowseOptions({ rawText: "digital perm", tags: ["Perm"], permStyle: "digital" }, CATALOG)
    ).toBeNull();
  });
  it("a specified color direction → null", () => {
    expect(
      categoryBrowseOptions({ rawText: "root touch up", tags: ["Color"], colorDirection: "root" }, CATALOG)
    ).toBeNull();
  });
  it("multiple categories (real multi-service request) → null", () => {
    expect(
      categoryBrowseOptions({ rawText: "perm and haircut", tags: ["Perm", "Haircut"] }, CATALOG)
    ).toBeNull();
  });
  it("a single-service category → null", () => {
    const oneCut: Service[] = [svc({ id: "only-cut", category: "Haircut" })];
    expect(categoryBrowseOptions({ rawText: "haircut", tags: ["Haircut"] }, oneCut)).toBeNull();
  });
});

describe("bookableInCategory — hidden excluded, popular-first", () => {
  it("excludes hidden perms", () => {
    const ids = bookableInCategory("Perm", CATALOG).map((s) => s.id);
    expect(ids).not.toContain("perm-hidden");
    expect(ids.length).toBe(6);
  });
});
