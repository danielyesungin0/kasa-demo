import { describe, it, expect } from "vitest";
import {
  categoryBrowseOptions,
  detectBareCategory,
  bookableInCategory,
  permsForGoal,
  matchServiceByName,
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
  svc({ id: "perm-bang", name: "Bang Perm", category: "Perm" }),
  svc({ id: "perm-womens-regular", name: "Women's Regular Perm", category: "Perm" }),
  svc({ id: "perm-womens-digital", name: "Women's Digital Perm", category: "Perm", status: "consultation" }),
  svc({ id: "perm-straightening", name: "Straightening Perm", category: "Perm" }),
  svc({ id: "perm-cut-down", name: "Hair Cut + Down Perm", category: "Perm" }),
  svc({ id: "perm-mens-cut", name: "Men's Perm + Hair Cut", category: "Perm" }),
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

describe("permsForGoal — goal narrows the 6 perms client-friendly", () => {
  it("curl → standalone curl perms (regular + digital), no bangs/straighten/combo", () => {
    const ids = permsForGoal("curl", CATALOG).map((s) => s.id).sort();
    expect(ids).toEqual(["perm-womens-digital", "perm-womens-regular"]);
  });
  it("straighten → just the straightening perm", () => {
    expect(permsForGoal("straighten", CATALOG).map((s) => s.id)).toEqual([
      "perm-straightening",
    ]);
  });
  it("bangs → just the bang perm", () => {
    expect(permsForGoal("bangs", CATALOG).map((s) => s.id)).toEqual(["perm-bang"]);
  });
  it("with-haircut → the two combo perms", () => {
    const ids = permsForGoal("with-haircut", CATALOG).map((s) => s.id).sort();
    expect(ids).toEqual(["perm-cut-down", "perm-mens-cut"]);
  });
  it("every perm is reachable from exactly one goal", () => {
    const all = new Set(bookableInCategory("Perm", CATALOG).map((s) => s.id));
    const reached = new Set<string>();
    for (const g of ["curl", "straighten", "bangs", "with-haircut"] as const) {
      for (const s of permsForGoal(g, CATALOG)) reached.add(s.id);
    }
    expect([...reached].sort()).toEqual([...all].sort());
  });
});

describe("matchServiceByName — pick a named service from the shown set", () => {
  const treatments = [
    svc({ id: "t-headspa", name: "Head Spa (Scalp Treatment)", category: "Treatment" }),
    svc({ id: "t-milbon", name: "Milbon Treatment", category: "Treatment" }),
    svc({ id: "t-keratin", name: "Keratin Treatment", category: "Treatment" }),
  ];
  it("'ill do a head spa' → Head Spa", () => {
    expect(matchServiceByName("ill do a head spa", treatments)?.id).toBe("t-headspa");
  });
  it("'the milbon one' → Milbon", () => {
    expect(matchServiceByName("the milbon one", treatments)?.id).toBe("t-milbon");
  });
  it("'do the keratin' → Keratin", () => {
    expect(matchServiceByName("do the keratin", treatments)?.id).toBe("t-keratin");
  });
  it("'head spa' (exact) → Head Spa", () => {
    expect(matchServiceByName("head spa", treatments)?.id).toBe("t-headspa");
  });
  it("ambiguous 'treatment' → null (let chooser handle)", () => {
    expect(matchServiceByName("a treatment", treatments)).toBeNull();
  });
  it("no match → null", () => {
    expect(matchServiceByName("a perm", treatments)).toBeNull();
  });
  it("perm subset: 'the digital one' → Women's Digital", () => {
    const perms = [
      svc({ id: "p-reg", name: "Women's Regular Perm", category: "Perm" }),
      svc({ id: "p-dig", name: "Women's Digital Perm", category: "Perm" }),
    ];
    expect(matchServiceByName("the digital one", perms)?.id).toBe("p-dig");
  });
});

describe("bookableInCategory — hidden excluded, popular-first", () => {
  it("excludes hidden perms", () => {
    const ids = bookableInCategory("Perm", CATALOG).map((s) => s.id);
    expect(ids).not.toContain("perm-hidden");
    expect(ids.length).toBe(6);
  });
});
