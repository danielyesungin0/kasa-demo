// Day view — vertical time grid (9am–7pm), a now-line on today, and plum event
// blocks sized by duration (DESIGN.md §7). Matches the prototype's .grid/.ev.
import { View, Pressable } from "react-native";
import { Text } from "@/components/ui/Text";
import { colors } from "@/theme/colors";
import {
  HOURS, OPEN_HOUR, fmtHourShort, fmtHour, nowHour, todayKey,
} from "@/lib/calendar";
import { dayKeyOf, hourOf, type Appointment } from "@/lib/useAppointments";

const HOUR_H = 54; // px per hour (prototype HH)

export function DayGrid({
  dayKey,
  appts,
  onOpen,
}: {
  dayKey: string;
  appts: Appointment[];
  onOpen: (a: Appointment) => void;
}) {
  const dayAppts = appts.filter((a) => dayKeyOf(a.starts_at) === dayKey);
  const isToday = dayKey === todayKey();
  const now = nowHour();

  return (
    <View style={{ position: "relative", height: HOURS.length * HOUR_H }}>
      {/* hour rows */}
      {HOURS.map((h, i) => (
        <View
          key={h}
          style={{ height: HOUR_H, borderTopWidth: i === 0 ? 0 : 1, borderTopColor: colors.line }}
        >
          <Text tabular style={{ position: "absolute", top: 3, left: 14, fontSize: 11, color: colors.ink4, fontFamily: "Inter_600SemiBold" }}>
            {fmtHourShort(h)}
          </Text>
        </View>
      ))}

      {/* now-line (today only, within hours) */}
      {isToday && now >= OPEN_HOUR && now <= OPEN_HOUR + HOURS.length ? (
        <View style={{ position: "absolute", left: 52, right: 14, top: (now - OPEN_HOUR) * HOUR_H, height: 2, backgroundColor: colors.accentStrong, zIndex: 3 }}>
          <View style={{ position: "absolute", left: -4, top: -3, width: 8, height: 8, borderRadius: 4, backgroundColor: colors.accentStrong }} />
        </View>
      ) : null}

      {/* events */}
      <View style={{ position: "absolute", top: 0, left: 60, right: 14, bottom: 0 }}>
        {dayAppts.map((a) => {
          const start = hourOf(a.starts_at);
          const end = hourOf(a.ends_at);
          const top = (start - OPEN_HOUR) * HOUR_H + 2;
          const height = Math.max((end - start) * HOUR_H - 4, 30);
          const isNew = a.isNew;
          return (
            <Pressable
              key={a.id}
              onPress={() => onOpen(a)}
              accessibilityRole="button"
              accessibilityLabel={`${a.clientName}, ${a.serviceName ?? "appointment"}`}
              style={{ position: "absolute", left: 0, right: 0, top, height, flexDirection: "row", borderRadius: 11, overflow: "hidden", backgroundColor: colors.plumSoft }}
            >
              <View style={{ width: 4, backgroundColor: colors.plumStrong }} />
              <View style={{ flex: 1, minWidth: 0, paddingVertical: 7, paddingLeft: 9, paddingRight: 10 }}>
                <View className="flex-row items-center" style={{ gap: 6 }}>
                  <Text numberOfLines={1} style={{ fontSize: 13.5, fontFamily: "Inter_600SemiBold", color: colors.plumInk }}>
                    {a.clientName}
                  </Text>
                  {isNew ? (
                    <View style={{ backgroundColor: colors.plumStrong, borderRadius: 5, paddingHorizontal: 6, paddingVertical: 1 }}>
                      <Text style={{ fontSize: 9, fontFamily: "Inter_700Bold", color: "#fff" }}>New</Text>
                    </View>
                  ) : null}
                </View>
                <Text numberOfLines={1} style={{ fontSize: 11.5, color: colors.plumInk, opacity: 0.82, marginTop: 1 }}>
                  {(a.serviceName ?? "Appointment") + " · " + fmtHour(start)}
                </Text>
              </View>
            </Pressable>
          );
        })}
        {dayAppts.length === 0 ? (
          <View style={{ position: "absolute", top: "45%", left: 0, right: 0, alignItems: "center" }}>
            <Text className="text-ink-4" style={{ fontSize: 13 }}>No bookings — tap + to add one</Text>
          </View>
        ) : null}
      </View>
    </View>
  );
}
