import { describe, it, expect } from "vitest";
import { labelTo24h, dayAbbrToIndex } from "@/lib/stylists/availability-seed";

/**
 * The onboarding availability model speaks 12h labels + day abbreviations; the
 * stylist_availability table stores 24h "HH:MM" + integer day_of_week. A wrong
 * conversion here silently produces bad hours, so these edges are load-bearing.
 */

describe("labelTo24h", () => {
  it("converts AM times", () => {
    expect(labelTo24h("10:00 AM")).toBe("10:00");
    expect(labelTo24h("9 am")).toBe("09:00");
  });
  it("converts PM times", () => {
    expect(labelTo24h("6:00 PM")).toBe("18:00");
    expect(labelTo24h("7:30 PM")).toBe("19:30");
  });
  it("handles the 12 AM / 12 PM edge cases correctly", () => {
    expect(labelTo24h("12:00 AM")).toBe("00:00"); // midnight
    expect(labelTo24h("12:00 PM")).toBe("12:00"); // noon
  });
  it("passes through already-24h values", () => {
    expect(labelTo24h("14:00")).toBe("14:00");
    expect(labelTo24h("00:30")).toBe("00:30");
  });
  it("returns null for unparseable input", () => {
    expect(labelTo24h("")).toBeNull();
    expect(labelTo24h(null)).toBeNull();
    expect(labelTo24h("noon")).toBeNull();
    expect(labelTo24h("25:00")).toBeNull();
    expect(labelTo24h("9:99 AM")).toBeNull();
  });
});

describe("dayAbbrToIndex", () => {
  it("maps abbreviations to 0=Sun..6=Sat", () => {
    expect(dayAbbrToIndex("Sun")).toBe(0);
    expect(dayAbbrToIndex("Mon")).toBe(1);
    expect(dayAbbrToIndex("Tue")).toBe(2);
    expect(dayAbbrToIndex("Wed")).toBe(3);
    expect(dayAbbrToIndex("Thu")).toBe(4);
    expect(dayAbbrToIndex("Fri")).toBe(5);
    expect(dayAbbrToIndex("Sat")).toBe(6);
  });
  it("is case-insensitive and tolerant of full names", () => {
    expect(dayAbbrToIndex("tuesday")).toBe(2);
    expect(dayAbbrToIndex("SAT")).toBe(6);
  });
  it("returns null for unknown days", () => {
    expect(dayAbbrToIndex("xyz")).toBeNull();
    expect(dayAbbrToIndex("")).toBeNull();
  });
});
