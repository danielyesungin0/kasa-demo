import { describe, it, expect } from "vitest";
import {
  normalizeDayOfWeek,
  normalizePartOfDay,
  recoverDayFromRaw,
  recoverPartOfDayFromRaw,
  rawMeansNextWeek,
  normalizeTimePreferenceLocale,
} from "@/lib/ai/locale-normalize";

/**
 * Multilingual time-preference normalization (English / Korean / Simplified
 * Chinese). Guards the "다음주 화요일 오후" / "下周二下午" → wrong-day regression: the
 * booking flow must always receive English enums, recovered from raw if needed.
 */

describe("normalizeDayOfWeek — English / Korean / Chinese → English enum", () => {
  it("English passes through", () => {
    expect(normalizeDayOfWeek("Tuesday")).toBe("Tuesday");
    expect(normalizeDayOfWeek("tuesday")).toBe("Tuesday");
  });
  it("Korean weekday → English (malformed dayOfWeek:'화요일' still maps)", () => {
    expect(normalizeDayOfWeek("화요일")).toBe("Tuesday");
    expect(normalizeDayOfWeek("화")).toBe("Tuesday");
  });
  it("Chinese weekday → English (malformed dayOfWeek:'周二' still maps)", () => {
    expect(normalizeDayOfWeek("周二")).toBe("Tuesday");
    expect(normalizeDayOfWeek("星期二")).toBe("Tuesday");
    expect(normalizeDayOfWeek("礼拜二")).toBe("Tuesday");
  });
  it("Chinese Sunday variants all map", () => {
    for (const t of ["星期日", "星期天", "周日", "周天", "礼拜日", "礼拜天"]) {
      expect(normalizeDayOfWeek(t)).toBe("Sunday");
    }
  });
  it("unknown → null", () => {
    expect(normalizeDayOfWeek("blursday")).toBeNull();
    expect(normalizeDayOfWeek(null)).toBeNull();
  });
});

describe("normalizePartOfDay — multilingual → English enum", () => {
  it("Korean", () => {
    expect(normalizePartOfDay("오전")).toBe("morning");
    expect(normalizePartOfDay("오후")).toBe("afternoon");
    expect(normalizePartOfDay("저녁")).toBe("evening");
  });
  it("Chinese", () => {
    expect(normalizePartOfDay("上午")).toBe("morning");
    expect(normalizePartOfDay("早上")).toBe("morning");
    expect(normalizePartOfDay("下午")).toBe("afternoon");
    expect(normalizePartOfDay("晚上")).toBe("evening");
  });
  it("English + unknown", () => {
    expect(normalizePartOfDay("afternoon")).toBe("afternoon");
    expect(normalizePartOfDay("teatime")).toBeNull();
  });
});

describe("raw-text recovery when the structured field is missing", () => {
  it("missing partOfDay but raw contains '오후' recovers afternoon", () => {
    expect(recoverPartOfDayFromRaw("다음주 화요일 오후")).toBe("afternoon");
  });
  it("missing partOfDay but raw contains '下午' recovers afternoon", () => {
    expect(recoverPartOfDayFromRaw("下周二下午")).toBe("afternoon");
  });
  it("recovers day from Korean raw", () => {
    expect(recoverDayFromRaw("다음주 화요일 오후")).toBe("Tuesday");
  });
  it("recovers day from Chinese raw (longest token wins: 星期二 not 二)", () => {
    expect(recoverDayFromRaw("下周二下午")).toBe("Tuesday");
    expect(recoverDayFromRaw("下星期二")).toBe("Tuesday");
  });
});

describe("next-week detection across languages", () => {
  it("en/ko/zh", () => {
    expect(rawMeansNextWeek("next week tuesday")).toBe(true);
    expect(rawMeansNextWeek("다음주 화요일")).toBe(true);
    expect(rawMeansNextWeek("下周二")).toBe(true);
    expect(rawMeansNextWeek("下星期二")).toBe(true);
  });
  it("this-week phrasing is not next week", () => {
    expect(rawMeansNextWeek("this tuesday")).toBe(false);
  });
});

describe("normalizeTimePreferenceLocale — the 4 booking scenarios", () => {
  it("Korean next Tuesday afternoon (field='화요일', partOfDay=null, raw has 오후+다음주)", () => {
    const r = normalizeTimePreferenceLocale({
      dayOfWeek: "화요일",
      partOfDay: null,
      raw: "다음주 화요일 오후",
    });
    expect(r.dayOfWeek).toBe("Tuesday");
    expect(r.partOfDay).toBe("afternoon"); // recovered from raw
    expect(r.nextWeek).toBe(true);
  });

  it("Simplified Chinese next Tuesday afternoon (field='周二', raw has 下午+下周)", () => {
    const r = normalizeTimePreferenceLocale({
      dayOfWeek: "周二",
      partOfDay: null,
      raw: "下周二下午可以剪头发吗",
    });
    expect(r.dayOfWeek).toBe("Tuesday");
    expect(r.partOfDay).toBe("afternoon");
    expect(r.nextWeek).toBe(true);
  });

  it("Mixed Korean/English next Friday 3pm (day in English, raw mixed)", () => {
    const r = normalizeTimePreferenceLocale({
      dayOfWeek: "Friday",
      partOfDay: null,
      raw: "next Friday 3pm에 예약 가능해요",
    });
    expect(r.dayOfWeek).toBe("Friday");
    // "next Friday" names a DAY, not next calendar week — the day-occurrence
    // logic handles it. nextWeek is reserved for "next week" / 다음주 / 下周.
    expect(r.nextWeek).toBe(false);
  });

  it("English next Tuesday afternoon (already correct, untouched)", () => {
    const r = normalizeTimePreferenceLocale({
      dayOfWeek: "Tuesday",
      partOfDay: "afternoon",
      raw: "next Tuesday afternoon",
    });
    expect(r.dayOfWeek).toBe("Tuesday");
    expect(r.partOfDay).toBe("afternoon");
    expect(r.nextWeek).toBe(false); // "next Tuesday" = the day, not next week
  });
});
