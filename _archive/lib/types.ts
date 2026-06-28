export type ServiceStatus = "online" | "consultation" | "hidden";

export type ServiceCategory =
  | "Haircut"
  | "Treatment"
  | "Perm"
  | "Color"
  | "Manicure"
  | "Pedicure"
  | "Other";

export type Service = {
  id: string;
  name: string;
  category: ServiceCategory;
  priceLabel: string; // "$90" or "$130+"
  durationMinutes: number;
  durationLabel: string; // "1 hr"
  status: ServiceStatus;
};

export type TimeSlot = {
  id: string;
  // Display
  dayLabel: string; // "Tue"
  dateLabel: string; // "May 5"
  timeLabel: string; // "10:30 AM"
  fullLabel: string; // "Tue 10:30 AM"
  // Filter / matching
  dateKey: string; // "2026-05-05" — ISO yyyy-mm-dd
  dayOfMonth: number; // 12
  hour24: number; // 10.5 for 10:30 AM, 14.25 for 2:15 PM
  isoTime: string; // "10:30" — for "the 10:30" exact match
};

export type Appointment = {
  id: string;
  clientName: string;
  clientPhone: string; // digits-only canonical form, e.g. "5551234567"
  serviceId: string; // links to SERVICES for reschedule slot lookup
  serviceName: string;
  dayLabel: string;
  dateLabel: string; // "May 5"
  dateKey: string; // ISO yyyy-mm-dd, for filtering/comparison
  isoTime: string; // "10:30" 24h, matches TimeSlot.isoTime
  timeLabel: string;
  durationLabel: string;
  channel: "Booking link" | "Instagram" | "Text" | "WeChat";
};

export type QuickReply = {
  id: string;
  label: string;
  body: string;
};

export type Availability = {
  days: string[]; // ["Tue","Wed","Thu","Fri","Sat"]
  startLabel: string; // "10:00 AM"
  endLabel: string; // "6:00 PM"
  bufferMinutes: number;
  minNoticeHours: number;
};
