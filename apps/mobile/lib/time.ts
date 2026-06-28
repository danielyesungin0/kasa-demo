// Relative time label matching the prototype's inbox style:
// today → "8:42 AM"; yesterday → "Yesterday"; this week → "2d"; older → "Jun 3".
const TZ = "America/New_York";

export function inboxTime(iso: string | null): string {
  if (!iso) return "";
  const then = new Date(iso);
  const now = new Date();
  const dayMs = 86400000;
  const startOfDay = (d: Date) =>
    new Date(d.toLocaleDateString("en-CA", { timeZone: TZ })).getTime();
  const days = Math.round((startOfDay(now) - startOfDay(then)) / dayMs);

  if (days <= 0) {
    return then.toLocaleTimeString("en-US", {
      timeZone: TZ,
      hour: "numeric",
      minute: "2-digit",
    });
  }
  if (days === 1) return "Yesterday";
  if (days < 7) return `${days}d`;
  return then.toLocaleDateString("en-US", { timeZone: TZ, month: "short", day: "numeric" });
}
