import { describe, it, expect } from "vitest";
import { categoryBrowseOptions } from "@/lib/ai/category-browse";
import type { Service } from "@/lib/types";

/**
 * "Don't assume a single service for a bare category." Typing just "perm"
 * should surface the category's services to choose from, NOT pre-pick a
 * "closest match". A category with a dedicated clarifier (haircut length) or
 * only one service does NOT trigger the chooser.
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
  // 6 perms (the real catalog)
  svc({ id: "perm-bang", category: "Perm" }),
  svc({ id: "perm-womens-regular", category: "Perm" }),
  svc({ id: "perm-womens-digital", category: "Perm", status: "consultation" }),
  svc({ id: "perm-straightening", category: "Perm" }),
  svc({ id: "perm-cut-down", category: "Perm" }),
  svc({ id: "perm-mens-cut", category: "Perm" }),
  // 3 treatments
  svc({ id: "treat-headspa", category: "Treatment" }),
  svc({ id: "treat-keratin", category: "Treatment" }),
  svc({ id: "treat-milbon", category: "Treatment" }),
  // 2 haircuts
  svc({ id: "cut-short", category: "Haircut" }),
  svc({ id: "cut-long", category: "Haircut" }),
  // 1 hidden — must never be offered
  svc({ id: "perm-hidden", category: "Perm", status: "hidden" }),
];

describe("categoryBrowseOptions — bare multi-service category → chooser", () => {
  it("perm → lists all bookable perms (hidden excluded)", () => {
    const out = categoryBrowseOptions({ tags: ["Perm"] }, CATALOG);
    expect(out).not.toBeNull();
    const ids = out!.map((s) => s.id);
    expect(ids).toContain("perm-bang");
    expect(ids).toContain("perm-womens-regular");
    expect(ids).not.toContain("perm-hidden");
    expect(out!.length).toBe(6);
  });

  it("treatment → lists all treatments", () => {
    const out = categoryBrowseOptions({ tags: ["Treatment"] }, CATALOG);
    expect(out?.map((s) => s.id).sort()).toEqual([
      "treat-headspa",
      "treat-keratin",
      "treat-milbon",
    ]);
  });

  it("ignores a 'Consultation' tag alongside the category", () => {
    const out = categoryBrowseOptions({ tags: ["Perm", "Consultation"] }, CATALOG);
    expect(out).not.toBeNull();
  });
});

describe("categoryBrowseOptions — does NOT fire (falls through to recommendation)", () => {
  it("haircut has a dedicated clarifier → null", () => {
    expect(
      categoryBrowseOptions({ tags: ["Haircut"], hasClarifier: true }, CATALOG)
    ).toBeNull();
  });

  it("a pinned combo SKU → null", () => {
    expect(
      categoryBrowseOptions({ tags: ["Perm"], comboServiceId: "perm-mens-cut" }, CATALOG)
    ).toBeNull();
  });

  it("a specified perm style → null", () => {
    expect(
      categoryBrowseOptions({ tags: ["Perm"], permStyle: "digital" }, CATALOG)
    ).toBeNull();
  });

  it("a specified color direction → null", () => {
    expect(
      categoryBrowseOptions({ tags: ["Color"], colorDirection: "root" }, CATALOG)
    ).toBeNull();
  });

  it("multiple categories (a real multi-service request) → null", () => {
    expect(
      categoryBrowseOptions({ tags: ["Perm", "Haircut"] }, CATALOG)
    ).toBeNull();
  });

  it("no category tags → null", () => {
    expect(categoryBrowseOptions({ tags: [] }, CATALOG)).toBeNull();
  });

  it("a single-service category → null (nothing to choose between)", () => {
    const oneCut: Service[] = [svc({ id: "only-cut", category: "Haircut" })];
    expect(categoryBrowseOptions({ tags: ["Haircut"] }, oneCut)).toBeNull();
  });
});
