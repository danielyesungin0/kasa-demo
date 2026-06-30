// MonthCalendar — a compact month grid for picking a booking date (Calendly /
// Square pattern). Pages by month; today and past days handled; days the picker
// marks unavailable are dimmed + non-tappable. Pure layout — the parent decides
// which days are selectable via `isDisabled`.
import { useState } from "react";
import { View, Pressable } from "react-native";
import { Text } from "./Text";
import { Icon } from "./Icon";
import { monthGrid, monthLabel, todayKey, parseKey } from "@/lib/calendar";
import { colors } from "@/theme/colors";

const DOW = ["S", "M", "T", "W", "T", "F", "S"];

export function MonthCalendar({
  selectedKey,
  onSelect,
  isDisabled,
}: {
  selectedKey: string;
  onSelect: (key: string) => void;
  isDisabled?: (key: string) => boolean;
}) {
  const today = todayKey();
  const sel = parseKey(selectedKey);
  const [year, setYear] = useState(sel.y);
  const [monthIdx, setMonthIdx] = useState(sel.mo - 1);

  const cells = monthGrid(year, monthIdx);

  function step(dir: -1 | 1) {
    let m = monthIdx + dir;
    let y = year;
    if (m < 0) { m = 11; y -= 1; }
    if (m > 11) { m = 0; y += 1; }
    setMonthIdx(m); setYear(y);
  }
  // Don't page before the current month.
  const t = parseKey(today);
  const atFloor = year === t.y && monthIdx === t.mo - 1;

  return (
    <View>
      {/* month header + paging */}
      <View className="flex-row items-center justify-between" style={{ marginBottom: 8 }}>
        <Pressable onPress={() => !atFloor && step(-1)} disabled={atFloor} hitSlop={8} accessibilityRole="button" accessibilityLabel="Previous month"
          className="items-center justify-center rounded-full" style={{ width: 32, height: 32, opacity: atFloor ? 0.3 : 1 }}>
          <Icon name="back" size={16} color={colors.ink2} />
        </Pressable>
        <Text style={{ fontSize: 15, fontFamily: "Inter_600SemiBold", color: colors.ink }}>{monthLabel(monthIdx, year)}</Text>
        <Pressable onPress={() => step(1)} hitSlop={8} accessibilityRole="button" accessibilityLabel="Next month"
          className="items-center justify-center rounded-full" style={{ width: 32, height: 32 }}>
          <Icon name="chevR" size={16} color={colors.ink2} />
        </Pressable>
      </View>

      {/* weekday header */}
      <View className="flex-row" style={{ marginBottom: 4 }}>
        {DOW.map((d, i) => (
          <View key={i} style={{ flex: 1, alignItems: "center" }}>
            <Text style={{ fontSize: 11, fontFamily: "Inter_600SemiBold", color: colors.ink4 }}>{d}</Text>
          </View>
        ))}
      </View>

      {/* grid */}
      <View className="flex-row flex-wrap">
        {cells.map((cell, i) => {
          if (!cell) return <View key={i} style={{ width: `${100 / 7}%`, height: 42 }} />;
          const past = cell.key < today;
          const disabled = past || (isDisabled?.(cell.key) ?? false);
          const on = cell.key === selectedKey;
          return (
            <View key={i} style={{ width: `${100 / 7}%`, height: 42, alignItems: "center", justifyContent: "center" }}>
              <Pressable
                onPress={() => { if (!disabled) onSelect(cell.key); }}
                disabled={disabled}
                accessibilityRole="button"
                accessibilityState={{ disabled, selected: on }}
                className={`items-center justify-center rounded-full ${on ? "bg-ink" : ""}`}
                style={{ width: 36, height: 36, opacity: disabled ? 0.28 : 1 }}
              >
                <Text
                  tabular
                  style={{
                    fontSize: 14.5,
                    fontFamily: on ? "Inter_700Bold" : "Inter_500Medium",
                    color: on ? "#fff" : cell.isToday ? colors.accent : colors.ink,
                  }}
                >
                  {cell.date}
                </Text>
              </Pressable>
            </View>
          );
        })}
      </View>
    </View>
  );
}
