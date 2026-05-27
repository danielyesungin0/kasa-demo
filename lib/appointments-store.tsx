"use client";

import { createContext, useCallback, useContext, useMemo, useState } from "react";
import type { Appointment, TimeSlot } from "./types";
import { TODAY_APPOINTMENTS, UPCOMING_APPOINTMENTS } from "./mock-data";

type AppointmentsStore = {
  today: Appointment[];
  upcoming: Appointment[];
  cancelAppointment: (id: string) => void;
  rescheduleAppointment: (id: string, slot: TimeSlot) => void;
};

const AppointmentsContext = createContext<AppointmentsStore | null>(null);

export function AppointmentsProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [today, setToday] = useState<Appointment[]>(TODAY_APPOINTMENTS);
  const [upcoming, setUpcoming] = useState<Appointment[]>(UPCOMING_APPOINTMENTS);

  const cancelAppointment = useCallback((id: string) => {
    setToday((prev) => prev.filter((a) => a.id !== id));
    setUpcoming((prev) => prev.filter((a) => a.id !== id));
  }, []);

  const rescheduleAppointment = useCallback((id: string, slot: TimeSlot) => {
    const apply = (a: Appointment): Appointment =>
      a.id === id
        ? {
            ...a,
            dayLabel: `${slot.dayLabel}, ${slot.dateLabel}`,
            dateLabel: slot.dateLabel,
            dateKey: slot.dateKey,
            isoTime: slot.isoTime,
            timeLabel: slot.timeLabel,
          }
        : a;
    setToday((prev) => prev.map(apply));
    setUpcoming((prev) => prev.map(apply));
  }, []);

  const value = useMemo<AppointmentsStore>(
    () => ({ today, upcoming, cancelAppointment, rescheduleAppointment }),
    [today, upcoming, cancelAppointment, rescheduleAppointment]
  );

  return (
    <AppointmentsContext.Provider value={value}>
      {children}
    </AppointmentsContext.Provider>
  );
}

export function useAppointments(): AppointmentsStore {
  const ctx = useContext(AppointmentsContext);
  if (!ctx) {
    throw new Error(
      "useAppointments must be used inside <AppointmentsProvider>"
    );
  }
  return ctx;
}
