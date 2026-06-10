"use client";

import Link from "next/link";
import { PageShell } from "@/components/PageShell";
import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

const PROFESSIONS = [
  "stylists",
  "barbers",
  "photographers",
  "coaches",
  "nail artists",
  "trainers",
  "tutors",
  "therapists",
];

function CyclingProfession() {
  const [index, setIndex] = useState(0);
  const [fading, setFading] = useState(false);

  useEffect(() => {
    const id = setInterval(() => {
      setFading(true);
      setTimeout(() => {
        setIndex((i) => (i + 1) % PROFESSIONS.length);
        setFading(false);
      }, 280);
    }, 2600);
    return () => clearInterval(id);
  }, []);

  return (
    <span
      style={{
        display: "inline-block",
        opacity: fading ? 0 : 1,
        transform: fading ? "translateY(-5px)" : "translateY(0)",
        transition: "opacity 0.28s ease, transform 0.28s ease",
      }}
    >
      {PROFESSIONS[index]}
    </span>
  );
}

function useAuthRedirect() {
  const router = useRouter();
  useEffect(() => {
    const supabase = createClient();
    supabase.auth.getUser().then(({ data }) => {
      if (data.user) router.replace("/dashboard");
    });
  }, [router]);
}

export default function HomePage() {
  useAuthRedirect();
  return (
    <PageShell variant="marketing">
      <section className="grid gap-12 pt-6 sm:pt-12 lg:grid-cols-[1.1fr_1fr] lg:gap-20">
        {/* Hero copy */}
        <div className="flex flex-col justify-center">
          <p className="font-display text-sm uppercase tracking-[0.2em] text-accent">
            For solo <CyclingProfession />
          </p>
          <h1 className="mt-5 font-display text-[36px] font-medium leading-[1.05] tracking-tightest text-ink-900 sm:text-[52px] lg:text-[64px]">
            Stop replying to{" "}
            <span className="italic text-accent">appointment DMs.</span>
          </h1>
          <p className="mt-6 max-w-md text-lg leading-relaxed text-ink-600">
            Send one link. Clients pick a time instantly. Bookings stay
            organized in Square.
          </p>

          <div className="mt-10 flex flex-wrap items-center gap-3">
            <Link
              href="/setup"
              className="rounded-full bg-ink-900 px-6 py-3.5 text-[15px] font-medium text-cream-50 transition hover:bg-ink-800 active:scale-[0.97] min-h-[48px] inline-flex items-center"
            >
              Join the beta
            </Link>
            {/* The "See client view" link to /shen was removed: the public
                landing page must not expose a live provider's client chat.
                Providers reach their own client link after onboarding. */}
          </div>

          <ul className="mt-12 grid gap-4 text-sm text-ink-600 sm:grid-cols-3">
            <li className="flex items-start gap-2">
              <Dot />
              <span>One link — works in any app or chat</span>
            </li>
            <li className="flex items-start gap-2">
              <Dot />
              <span>No app for clients to download</span>
            </li>
            <li className="flex items-start gap-2">
              <Dot />
              <span>Set up in under 3 minutes</span>
            </li>
          </ul>
        </div>

        {/* Preview card */}
        <PreviewStack />
      </section>

      <section className="mt-24 border-t border-ink-100 pt-16">
        <div className="grid gap-10 sm:grid-cols-3">
          <Step
            n="01"
            title="Share your link"
            body="Drop book.kasa.app/shen in your bio or paste a quick reply into any DM — wherever clients already reach you."
          />
          <Step
            n="02"
            title="Clients tap a time"
            body="They see your real availability and book in seconds. No login, no app."
          />
          <Step
            n="03"
            title="You stay focused"
            body="Appointments land in Square. You stay in your flow."
          />
        </div>
      </section>

      <footer className="mt-24 border-t border-ink-100 pt-8 text-sm text-ink-500">
        <p>Prototype · Mock data only</p>
      </footer>
    </PageShell>
  );
}

function Dot() {
  return (
    <span className="mt-1.5 inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-accent" />
  );
}

function Step({
  n,
  title,
  body,
}: {
  n: string;
  title: string;
  body: string;
}) {
  return (
    <div>
      <p className="font-display text-sm tracking-[0.14em] text-ink-400">
        {n}
      </p>
      <h3 className="mt-3 font-display text-xl font-medium text-ink-900">
        {title}
      </h3>
      <p className="mt-2 text-[15px] leading-relaxed text-ink-600">{body}</p>
    </div>
  );
}

function PreviewStack() {
  return (
    <div className="relative">
      {/* Soft background blob */}
      <div
        className="absolute -inset-6 -z-10 rounded-[40px] bg-accent-soft/60 blur-3xl"
        aria-hidden
      />

      <div className="space-y-3">
        {/* Booking link card */}
        <div className="rounded-2xl border border-ink-100 bg-cream-50 p-5 shadow-card">
          <div className="flex items-center justify-between">
            <p className="text-xs uppercase tracking-[0.14em] text-ink-400">
              Your booking link
            </p>
            <span className="rounded-full bg-success-soft px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-success">
              Live
            </span>
          </div>
          <p className="mt-3 font-display text-lg text-ink-900">
            book.kasa.app/shen
          </p>
        </div>

        {/* Quick reply card */}
        <div className="rounded-2xl border border-ink-100 bg-cream-50 p-5 shadow-card">
          <p className="text-xs uppercase tracking-[0.14em] text-ink-400">
            Quick reply · Friendly
          </p>
          <p className="mt-2 text-[15px] leading-relaxed text-ink-700">
            Hey! I&apos;m with a client right now 💇‍♀️ Fastest way to book is
            here: book.kasa.app/shen
          </p>
        </div>

        {/* Upcoming appointment */}
        <div className="rounded-2xl border border-ink-100 bg-cream-50 p-5 shadow-card">
          <p className="text-xs uppercase tracking-[0.14em] text-ink-400">
            Next appointment
          </p>
          <div className="mt-2 flex items-baseline gap-3">
            <p className="font-display text-xl font-medium text-ink-900">
              Tue 10:30 AM
            </p>
            <p className="text-sm text-ink-500">Priya · Full Color</p>
          </div>
        </div>
      </div>
    </div>
  );
}
