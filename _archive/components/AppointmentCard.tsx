import type { Appointment } from "@/lib/types";
import { cn } from "@/lib/cn";

type AppointmentCardProps = {
  appointment: Appointment;
  variant?: "today" | "upcoming" | "client";
  onClick?: () => void;
};

export function AppointmentCard({
  appointment,
  variant = "upcoming",
  onClick,
}: AppointmentCardProps) {
  const isClient = variant === "client";

  const inner = (
    <>
      <div className="min-w-0 flex-1">
        {isClient ? (
          <p className="text-[15px] font-medium text-ink-900">
            {appointment.serviceName}
          </p>
        ) : (
          <div className="flex items-center gap-2">
            <p className="text-[15px] font-medium text-ink-900">
              {appointment.clientName}
            </p>
            <span className="text-ink-300">·</span>
            <p className="truncate text-sm text-ink-500">
              {appointment.serviceName}
            </p>
          </div>
        )}
        <p className="mt-1 text-sm text-ink-500">
          {variant === "today" ? (
            <>
              <span className="font-medium text-ink-700">
                {appointment.timeLabel}
              </span>
              <span className="px-1.5 text-ink-300">·</span>
              {appointment.durationLabel}
            </>
          ) : (
            <>
              {appointment.dayLabel}
              <span className="px-1.5 text-ink-300">·</span>
              {appointment.timeLabel}
              <span className="px-1.5 text-ink-300">·</span>
              {appointment.durationLabel}
            </>
          )}
        </p>
      </div>
      {!isClient && (
        <span className="shrink-0 rounded-full bg-cream-100 px-2.5 py-1 text-[11px] font-medium text-ink-600">
          {appointment.channel}
        </span>
      )}
    </>
  );

  const baseClasses =
    "flex w-full items-center justify-between gap-4 rounded-2xl border border-ink-100 bg-cream-50 p-4 text-left";

  if (onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        className={cn(
          baseClasses,
          "transition hover:border-ink-300 hover:bg-cream-100 active:scale-[0.99]"
        )}
      >
        {inner}
      </button>
    );
  }

  return <div className={baseClasses}>{inner}</div>;
}
