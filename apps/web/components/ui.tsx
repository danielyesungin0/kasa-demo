"use client";
import { ReactNode } from "react";

// Small web UI kit matching the Kasa design system (warm, editorial, premium).

export function Button({
  children, onClick, variant = "primary", disabled, type = "button", full,
}: {
  children: ReactNode;
  onClick?: () => void;
  variant?: "primary" | "secondary" | "ghost";
  disabled?: boolean;
  type?: "button" | "submit";
  full?: boolean;
}) {
  const base =
    "inline-flex items-center justify-center rounded-control-lg font-semibold transition active:scale-[0.99] disabled:opacity-40 disabled:active:scale-100";
  const size = "h-[52px] px-6 text-[15.5px]";
  const styles =
    variant === "primary"
      ? "bg-ink text-white hover:bg-[#000]"
      : variant === "secondary"
      ? "bg-bg-warm text-ink hover:bg-[#E4DCCD]"
      : "bg-transparent text-ink-3 hover:text-ink";
  return (
    <button type={type} onClick={onClick} disabled={disabled}
      className={`${base} ${size} ${styles} ${full ? "w-full" : ""}`}>
      {children}
    </button>
  );
}

export function Chip({
  label, selected, onClick,
}: { label: string; selected?: boolean; onClick?: () => void }) {
  return (
    <button type="button" onClick={onClick}
      className={`rounded-full border px-4 py-2 text-[13.5px] font-medium transition ${
        selected ? "border-ink bg-ink text-white" : "border-line-2 bg-surface text-ink-2 hover:border-ink-4"
      }`}>
      {label}
    </button>
  );
}

export function SelectCard({
  label, sub, selected, onClick,
}: { label: string; sub?: string; selected?: boolean; onClick?: () => void }) {
  return (
    <button type="button" onClick={onClick}
      className={`w-full rounded-card border p-4 text-left transition ${
        selected ? "border-ink bg-surface ring-2 ring-ink" : "border-line-2 bg-surface hover:border-ink-4"
      }`}>
      <div className="text-[15.5px] font-semibold text-ink">{label}</div>
      {sub ? <div className="mt-0.5 text-[13px] text-ink-3">{sub}</div> : null}
    </button>
  );
}

export function Field({
  label, children, hint,
}: { label: string; children: ReactNode; hint?: string }) {
  return (
    <label className="block">
      <div className="mb-1.5 text-[12px] font-bold uppercase tracking-wide text-ink-4">{label}</div>
      {children}
      {hint ? <div className="mt-1 text-[12px] text-ink-4">{hint}</div> : null}
    </label>
  );
}

export function TextInput({
  value, onChange, placeholder, type = "text",
}: { value: string; onChange: (v: string) => void; placeholder?: string; type?: string }) {
  return (
    <input type={type} value={value} placeholder={placeholder}
      onChange={(e) => onChange(e.target.value)}
      className="w-full rounded-control-lg border border-line-2 bg-surface px-4 py-3 text-[15px] text-ink outline-none placeholder:text-ink-4 focus:border-accent focus:ring-2 focus:ring-accent-soft" />
  );
}

export function TextArea({
  value, onChange, placeholder, rows = 4,
}: { value: string; onChange: (v: string) => void; placeholder?: string; rows?: number }) {
  return (
    <textarea value={value} placeholder={placeholder} rows={rows}
      onChange={(e) => onChange(e.target.value)}
      className="w-full resize-none rounded-control-lg border border-line-2 bg-surface px-4 py-3 text-[15px] leading-relaxed text-ink outline-none placeholder:text-ink-4 focus:border-accent focus:ring-2 focus:ring-accent-soft" />
  );
}

export function Toggle({
  on, onChange, label,
}: { on: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button type="button" onClick={() => onChange(!on)}
      className="flex w-full items-center justify-between rounded-control-lg border border-line-2 bg-surface px-4 py-3 text-left">
      <span className="text-[14.5px] text-ink">{label}</span>
      <span className={`relative h-6 w-10 rounded-full transition ${on ? "bg-ink" : "bg-line-2"}`}>
        <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition ${on ? "left-[18px]" : "left-0.5"}`} />
      </span>
    </button>
  );
}

export function ProgressBar({ value }: { value: number }) {
  return (
    <div className="h-[5px] w-full overflow-hidden rounded-full bg-bg-warm">
      <div className="h-full rounded-full bg-accent transition-all duration-300"
        style={{ width: `${Math.round(value * 100)}%` }} />
    </div>
  );
}

export function StepTitle({ kicker, title }: { kicker?: string; title: string }) {
  return (
    <div className="mb-5">
      {kicker ? <div className="mb-1.5 text-[12px] font-bold uppercase tracking-wide text-accent">{kicker}</div> : null}
      <h1 className="font-serif text-[28px] leading-tight text-ink">{title}</h1>
    </div>
  );
}
