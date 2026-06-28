import Link from "next/link";
import { cn } from "@/lib/cn";

type PageShellProps = {
  children: React.ReactNode;
  variant?: "client" | "stylist" | "marketing";
  showBack?: boolean;
  backHref?: string;
  className?: string;
  headerRight?: React.ReactNode;
};

export function PageShell({
  children,
  variant = "stylist",
  showBack,
  backHref = "/",
  className,
  headerRight,
}: PageShellProps) {
  const maxWidth =
    variant === "client" ? "max-w-[440px]" : "max-w-[1080px]";

  return (
    <div className="min-h-screen bg-cream-50">
      <div className={cn("mx-auto px-5 py-6 sm:px-8 sm:py-10", maxWidth)}>
        {(variant === "stylist" || variant === "marketing") && (
          <header className="mb-6 flex items-center justify-between gap-3 sm:mb-8">
            <Link
              href="/"
              className="font-display text-lg font-medium tracking-tightest text-ink-900"
            >
              Kasa<span className="text-accent">.</span>
            </Link>
            {variant === "marketing" && (
              <nav className="flex items-center gap-4">
                <a
                  href="#pricing"
                  className="hidden text-sm font-medium text-ink-600 transition hover:text-ink-900 sm:inline"
                >
                  Pricing
                </a>
                <a
                  href="#faq"
                  className="hidden text-sm font-medium text-ink-600 transition hover:text-ink-900 sm:inline"
                >
                  FAQ
                </a>
                <Link
                  href="/setup"
                  className="rounded-full bg-ink-900 px-4 py-2.5 text-sm font-medium text-cream-50 transition hover:bg-ink-800 active:scale-[0.97]"
                >
                  Get started
                </Link>
              </nav>
            )}
            {variant === "stylist" && headerRight}
          </header>
        )}

        {variant === "client" && showBack && (
          <header className="mb-5">
            <Link
              href={backHref}
              className="inline-flex min-h-[44px] items-center gap-1.5 text-sm text-ink-500 hover:text-ink-900"
            >
              <span aria-hidden>←</span>
              <span>Back</span>
            </Link>
          </header>
        )}

        <main className={className}>{children}</main>
      </div>
    </div>
  );
}
