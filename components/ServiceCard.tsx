"use client";

import { cn } from "@/lib/cn";
import type { Service, ServiceStatus } from "@/lib/types";

type ServiceCardProps = {
  service: Service;
  // Setup mode — shows status selector
  mode?: "setup" | "select";
  selected?: boolean;
  onClick?: () => void;
  onStatusChange?: (status: ServiceStatus) => void;
};

export function ServiceCard({
  service,
  mode = "select",
  selected = false,
  onClick,
  onStatusChange,
}: ServiceCardProps) {
  if (mode === "setup") {
    return (
      <div className="rounded-2xl border border-ink-100 bg-cream-50 p-4 transition hover:border-ink-200">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0 flex-1">
            <p className="text-[15px] font-medium text-ink-900">
              {service.name}
            </p>
            <p className="mt-1 text-sm text-ink-500">
              {service.priceLabel}
              <span className="px-1.5 text-ink-300">·</span>
              {service.durationLabel}
            </p>
          </div>
          <StatusSelector
            value={service.status}
            onChange={(s) => onStatusChange?.(s)}
          />
        </div>
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "group flex w-full items-center justify-between gap-4 rounded-2xl border p-4 text-left transition",
        selected
          ? "border-ink-900 bg-cream-100 shadow-soft"
          : "border-ink-100 bg-cream-50 hover:border-ink-300 hover:shadow-soft"
      )}
    >
      <div className="min-w-0 flex-1">
        <p className="text-[15px] font-medium text-ink-900">{service.name}</p>
        <p className="mt-1 text-sm text-ink-500">{service.durationLabel}</p>
      </div>
      <div className="text-right">
        <p className="text-[15px] font-medium text-ink-900">
          {service.priceLabel}
        </p>
        {service.status === "consultation" && (
          <p className="mt-1 text-xs text-accent">Consultation</p>
        )}
      </div>
    </button>
  );
}

function StatusSelector({
  value,
  onChange,
}: {
  value: ServiceStatus;
  onChange: (status: ServiceStatus) => void;
}) {
  const options: { value: ServiceStatus; label: string }[] = [
    { value: "online", label: "Bookable" },
    { value: "consultation", label: "Consult" },
    { value: "hidden", label: "Hidden" },
  ];
  return (
    <div className="flex shrink-0 items-center gap-1 rounded-full bg-cream-100 p-1">
      {options.map((opt) => (
        <button
          key={opt.value}
          type="button"
          onClick={() => onChange(opt.value)}
          className={cn(
            "rounded-full px-2.5 py-1 text-[11px] font-medium transition",
            value === opt.value
              ? "bg-ink-900 text-cream-50"
              : "text-ink-500 hover:text-ink-900"
          )}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}
