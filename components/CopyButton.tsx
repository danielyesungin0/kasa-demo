"use client";

import { useState } from "react";
import { cn } from "@/lib/cn";

type CopyButtonProps = {
  value: string;
  label?: string;
  copiedLabel?: string;
  variant?: "primary" | "ghost" | "outline";
  size?: "sm" | "md";
  className?: string;
};

export function CopyButton({
  value,
  label = "Copy",
  copiedLabel = "Copied",
  variant = "outline",
  size = "md",
  className,
}: CopyButtonProps) {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      // Silent fail — prototype only
    }
  }

  const base =
    "inline-flex items-center justify-center gap-1.5 font-medium transition select-none active:scale-[0.97]";
  const sizes = {
    sm: "rounded-full px-3 py-2 text-xs min-h-[36px]",
    md: "rounded-full px-4 py-2.5 text-sm min-h-[44px]",
  };
  const variants = {
    primary: "bg-ink-900 text-cream-50 hover:bg-ink-800",
    ghost: "text-ink-600 hover:bg-cream-100 hover:text-ink-900",
    outline:
      "border border-ink-200 bg-cream-50 text-ink-800 hover:border-ink-300 hover:bg-cream-100",
  };

  return (
    <button
      type="button"
      onClick={handleCopy}
      className={cn(base, sizes[size], variants[variant], className)}
      aria-live="polite"
    >
      {copied ? (
        <>
          <CheckIcon className="h-3.5 w-3.5" />
          {copiedLabel}
        </>
      ) : (
        <>
          <CopyIcon className="h-3.5 w-3.5" />
          {label}
        </>
      )}
    </button>
  );
}

function CopyIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <rect x="5" y="5" width="9" height="9" rx="1.5" />
      <path d="M11 5V3a1 1 0 0 0-1-1H3a1 1 0 0 0-1 1v7a1 1 0 0 0 1 1h2" />
    </svg>
  );
}

function CheckIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M3 8.5L6.5 12 13 4.5" />
    </svg>
  );
}
