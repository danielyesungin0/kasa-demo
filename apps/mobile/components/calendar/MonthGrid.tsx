// Month view — date grid (Mon-first) with per-day booking dots (DESIGN.md §7).
// Tapping a day jumps to Day view for that date.
import { View, Pressable } from "react-native";
import { Text } from "@/components/ui/Text";
import { colors } from "@/theme/colors";
import { monthGrid, type MonthCell } from "@/lib/calendar";
import { dayKeyOf, type Appointment } from "@/lib/useAppointments";

const WD = ["M", "T", "W", "T", "F", "S", "S"];

export function MonthGrid({
  year,
  monthIdx,
  appts,
  onPickDay,
}: {
  year: number;
  monthIdx: number;
  appts: Appointment[];
  onPickDay: (key: string) => void;
}) {
  const cells = monthGrid(year, monthIdx);
  const countByDay = new Map<string, number>();
  for (const a of appts) {
    const k = dayKeyOf(a.starts_at);
    countByDay.set(k, (countByDay.get(k) ?? 0) + 1);
  }

  return (
    <View style={{ padding: 16 }}>
      <View className="flex-row" style={{ marginBottom: 7 }}>
        {WD.map((w, i) => (
          <Text key={i} className="flex-1 text-center" style={{ fontSize: 11, fontFamily: "Inter_700Bold", color: colors.ink4, opacity: i >= 5 ? 0.55 : 1 }}>{w}</Text>
        ))}
      </View>
      <View className="flex-row flex-wrap">
        {cells.map((c: MonthCell, i) => {
          if (!c) return <View key={`pad-${i}`} style={{ width: `${100 / 7}%`, aspectRatio: 1 / 1.08 }} />;
          const count = countByDay.get(c.key) ?? 0;
          return (
            <View key={c.key} style={{ width: `${100 / 7}%`, aspectRatio: 1 / 1.08, padding: 2 }}>
              <Pressable
                onPress={() => onPickDay(c.key)}
                accessibilityRole="button"
                accessibilityLabel={`${c.date}, ${count} bookings`}
                className="flex-1 items-center rounded-control"
                style={{ paddingTop: 7, gap: 4, backgroundColor: c.isToday ? colors.accentStrong : colors.surface2 }}
              >
                <Text tabular style={{ fontSize: 13, fontFamily: "Inter_600SemiBold", color: c.isToday ? "#fff" : colors.ink2 }}>{c.date}</Text>
                {count > 0 ? (
                  <View className="flex-row" style={{ gap: 2 }}>
                    {Array.from({ length: Math.min(count, 4) }).map((_, k) => (
                      <View key={k} style={{ width: 4, height: 4, borderRadius: 2, backgroundColor: c.isToday ? "#fff" : colors.plumStrong }} />
                    ))}
                  </View>
                ) : null}
              </Pressable>
            </View>
          );
        })}
      </View>
    </View>
  );
}
