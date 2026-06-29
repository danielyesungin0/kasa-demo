// Week view — 7-column grid (Mon..Sun) with an hour axis and mini plum event
// blocks (DESIGN.md §7). Tapping a day column header jumps to Day view.
import { View, Pressable } from "react-native";
import { Text } from "@/components/ui/Text";
import { colors } from "@/theme/colors";
import {
  HOURS, OPEN_HOUR, fmtHourShort, dayStrip, todayKey, nowHour,
} from "@/lib/calendar";
import { dayKeyOf, hourOf, type Appointment } from "@/lib/useAppointments";

const HOUR_H = 42; // prototype WHH

export function WeekGrid({
  weekStartKey,
  appts,
  onPickDay,
  onOpen,
}: {
  weekStartKey: string;
  appts: Appointment[];
  onPickDay: (key: string) => void;
  onOpen: (a: Appointment) => void;
}) {
  const days = dayStrip(weekStartKey, 7);
  const today = todayKey();
  const now = nowHour();

  return (
    <View>
      {/* day header row */}
      <View className="flex-row border-b border-line bg-surface" style={{ paddingBottom: 4 }}>
        <View style={{ width: 34 }} />
        {days.map((d) => (
          <Pressable
            key={d.key}
            onPress={() => onPickDay(d.key)}
            accessibilityRole="button"
            className={`flex-1 items-center rounded-control ${d.key === today ? "" : ""}`}
            style={{ paddingVertical: 7, marginHorizontal: 1, marginTop: 2, backgroundColor: d.key === today ? colors.bgWarm : "transparent" }}
          >
            <Text style={{ fontSize: 10, fontFamily: "Inter_600SemiBold", color: colors.ink4 }}>{d.dow}</Text>
            <Text tabular style={{ fontSize: 14, fontFamily: "Inter_600SemiBold", color: d.key === today ? colors.accentStrong : colors.ink2 }}>{d.n}</Text>
          </Pressable>
        ))}
      </View>

      {/* grid */}
      <View className="flex-row" style={{ position: "relative", height: HOURS.length * HOUR_H }}>
        {/* axis */}
        <View style={{ width: 34 }}>
          {HOURS.map((h, i) => (
            <View key={h} style={{ height: HOUR_H, borderTopWidth: i === 0 ? 0 : 1, borderTopColor: colors.line }}>
              <Text style={{ position: "absolute", top: 2, right: 5, fontSize: 9, color: colors.ink4, fontFamily: "Inter_600SemiBold" }}>{fmtHourShort(h)}</Text>
            </View>
          ))}
        </View>
        {/* day columns */}
        {days.map((d) => {
          const dayAppts = appts.filter((a) => dayKeyOf(a.starts_at) === d.key);
          return (
            <View key={d.key} className="flex-1 border-l border-line" style={{ position: "relative" }}>
              {HOURS.map((h, i) => (
                <View key={h} style={{ height: HOUR_H, borderTopWidth: i === 0 ? 0 : 1, borderTopColor: colors.line }} />
              ))}
              {d.key === today && now >= OPEN_HOUR && now <= OPEN_HOUR + HOURS.length ? (
                <View style={{ position: "absolute", left: 0, right: 0, top: (now - OPEN_HOUR) * HOUR_H, height: 2, backgroundColor: colors.accentStrong, zIndex: 2 }} />
              ) : null}
              {dayAppts.map((a) => {
                const start = hourOf(a.starts_at);
                const end = hourOf(a.ends_at);
                return (
                  <Pressable
                    key={a.id}
                    onPress={() => onOpen(a)}
                    accessibilityRole="button"
                    accessibilityLabel={a.clientName}
                    style={{ position: "absolute", left: 1, right: 1, top: (start - OPEN_HOUR) * HOUR_H + 1, height: Math.max((end - start) * HOUR_H - 2, 15), backgroundColor: colors.plumStrong, borderRadius: 5, paddingHorizontal: 3, paddingVertical: 2, overflow: "hidden" }}
                  >
                    <Text numberOfLines={1} style={{ fontSize: 9.5, fontFamily: "Inter_600SemiBold", color: "#fff" }}>{a.clientName.split(" ")[0]}</Text>
                  </Pressable>
                );
              })}
            </View>
          );
        })}
      </View>
    </View>
  );
}
