"use client";

import Link from "next/link";
import { PageShell } from "@/components/PageShell";
import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Reveal, RevealGroup, RevealItem } from "@/components/Reveal";
import { motion, AnimatePresence, useReducedMotion } from "framer-motion";
import {
  MessageSquareText,
  Sparkles,
  CalendarCheck,
  ShieldCheck,
  Users,
  RefreshCw,
  Share2,
  MessagesSquare,
  CalendarClock,
  type LucideIcon,
} from "lucide-react";

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
      {/* ── Hero ──────────────────────────────────────────────────────────── */}
      <section className="grid gap-12 pt-6 sm:pt-12 lg:grid-cols-[1.1fr_1fr] lg:gap-20">
        <div className="flex flex-col justify-center">
          <p className="font-display text-sm uppercase tracking-[0.2em] text-accent">
            For solo <CyclingProfession />
          </p>
          <h1 className="mt-5 font-display text-[36px] font-medium leading-[1.05] tracking-tightest text-ink-900 sm:text-[52px] lg:text-[64px]">
            Booking that talks{" "}
            <span className="italic text-accent">like you do.</span>
          </h1>
          <p className="mt-6 max-w-md text-lg leading-relaxed text-ink-600">
            Share one link. Your clients chat naturally, pick a time, and book —
            no app, no back-and-forth. Every appointment lands in your Square
            calendar.
          </p>

          <div className="mt-10 flex flex-wrap items-center gap-3">
            <Link
              href="/setup"
              className="inline-flex min-h-[48px] items-center rounded-full bg-ink-900 px-6 py-3.5 text-[15px] font-medium text-cream-50 transition hover:bg-ink-800 active:scale-[0.97]"
            >
              Get started today
            </Link>
            <a
              href="#how"
              className="inline-flex min-h-[48px] items-center px-2 text-[15px] font-medium text-ink-600 transition hover:text-ink-900"
            >
              See how it works ↓
            </a>
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

        {/* Chat preview — what the assistant actually looks like */}
        <ChatPreview />
      </section>

      {/* ── How it works ──────────────────────────────────────────────────── */}
      <section id="how" className="mt-28 scroll-mt-24 border-t border-ink-100 pt-16">
        <Reveal>
          <p className="font-display text-sm uppercase tracking-[0.18em] text-accent">
            How it works
          </p>
          <h2 className="mt-3 font-display text-3xl font-medium tracking-tight text-ink-900 sm:text-4xl">
            From DM to booked in three steps.
          </h2>
        </Reveal>
        <RevealGroup className="mt-12 grid gap-10 sm:grid-cols-3">
          <RevealItem>
            <Step
              Icon={Share2}
              n="01"
              title="Share your link"
              body="Drop your Kasa link in your bio or paste it into any DM — wherever clients already reach you."
            />
          </RevealItem>
          <RevealItem>
            <Step
              Icon={MessagesSquare}
              n="02"
              title="Clients just chat"
              body="They ask for what they want in plain language. Your assistant understands, shows real openings, and books in seconds."
            />
          </RevealItem>
          <RevealItem>
            <Step
              Icon={CalendarClock}
              n="03"
              title="You stay focused"
              body="Confirmed appointments land in your Square calendar. No logins, no app, no back-and-forth."
            />
          </RevealItem>
        </RevealGroup>
      </section>

      {/* ── What the assistant does ───────────────────────────────────────── */}
      <section className="mt-28 border-t border-ink-100 pt-16">
        <Reveal>
          <p className="font-display text-sm uppercase tracking-[0.18em] text-accent">
            Meet your assistant
          </p>
          <h2 className="mt-3 max-w-2xl font-display text-3xl font-medium tracking-tight text-ink-900 sm:text-4xl">
            It books like your sharpest front desk — in your voice.
          </h2>
        </Reveal>
        <RevealGroup className="mt-12 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {(
            [
              [MessageSquareText, "Understands how people text", "“haircut tmrw at 130” just works. It reads natural language, typos, and shorthand — no rigid forms."],
              [Sparkles, "Warm, on-brand replies", "It chats in clear, friendly English that sounds like you — never robotic, never a rigid form."],
              [CalendarCheck, "Shows only real openings", "Pulls live availability from your Square calendar, so clients only ever see times you can actually take."],
              [ShieldCheck, "Confirms before booking", "Nothing is booked without the client's say-so. No double-bookings, no surprises on your calendar."],
              [Users, "Handles the odd ones", "Unsupported services, group requests, special asks — it sends you a clean summary instead of guessing."],
              [RefreshCw, "Reschedule & cancel built in", "Clients manage their own appointments through the same link, so your DMs stay quiet."],
            ] as const
          ).map(([Icon, title, body]) => (
            <RevealItem key={title} className="h-full">
              <Feature Icon={Icon} title={title} body={body} />
            </RevealItem>
          ))}
        </RevealGroup>
      </section>

      {/* ── Pricing ───────────────────────────────────────────────────────── */}
      <section id="pricing" className="mt-28 scroll-mt-24 border-t border-ink-100 pt-16">
        <Reveal className="text-center">
          <p className="font-display text-sm uppercase tracking-[0.18em] text-accent">
            Pricing
          </p>
          <h2 className="mt-3 font-display text-3xl font-medium tracking-tight text-ink-900 sm:text-4xl">
            One simple plan. No per-booking fees.
          </h2>
          <p className="mx-auto mt-3 max-w-xl text-[15px] leading-relaxed text-ink-600">
            Everything included — unlimited bookings, AI chat, and text
            reminders. Cancel anytime.
          </p>
        </Reveal>

        <Reveal delay={0.1} className="mx-auto mt-12 max-w-md">
          <div className="flex flex-col rounded-3xl border border-ink-900 bg-cream-50 p-8 shadow-card ring-1 ring-ink-900">
            <div className="flex items-center justify-between">
              <p className="font-display text-lg font-medium text-ink-900">
                Kasa Pro
              </p>
              <span className="rounded-full bg-accent-soft px-2.5 py-0.5 text-[10px] font-medium uppercase tracking-wider text-accent">
                Beta pricing
              </span>
            </div>
            <div className="mt-4 flex items-baseline gap-1.5">
              <span className="font-display text-5xl font-medium text-ink-900">
                $29
              </span>
              <span className="text-sm text-ink-500">/ month</span>
            </div>
            <p className="mt-2 text-[14px] leading-relaxed text-ink-600">
              Built for solo pros who book all day. One flat price — no matter
              how many clients you take.
            </p>
            <ul className="mt-6 space-y-2.5 text-[14.5px] text-ink-700">
              {[
                "Your own booking link",
                "Unlimited AI booking chats",
                "Real-time Square availability",
                "Confirmation + reminder texts",
                "Natural, friendly chat replies",
                "Reschedule & cancel for clients",
                "Smart handoff summaries to you",
              ].map((f) => (
                <li key={f} className="flex items-start gap-2">
                  <Check />
                  <span>{f}</span>
                </li>
              ))}
            </ul>
            <Link
              href="/setup"
              className="mt-8 inline-flex min-h-[48px] items-center justify-center rounded-full bg-ink-900 px-5 py-3.5 text-[15px] font-medium text-cream-50 transition hover:bg-ink-800 active:scale-[0.97]"
            >
              Get started today
            </Link>
            <p className="mt-4 text-center text-[12.5px] text-ink-400">
              Early providers keep this price as we grow.
            </p>
          </div>
        </Reveal>
      </section>

      {/* ── FAQ ───────────────────────────────────────────────────────────── */}
      <section id="faq" className="mt-28 scroll-mt-24 border-t border-ink-100 pt-16">
        <Reveal>
          <p className="font-display text-sm uppercase tracking-[0.18em] text-accent">
            FAQ
          </p>
          <h2 className="mt-3 font-display text-3xl font-medium tracking-tight text-ink-900 sm:text-4xl">
            Questions, answered.
          </h2>
        </Reveal>
        <Reveal delay={0.05} className="mt-10 max-w-2xl divide-y divide-ink-100 border-t border-ink-100">
          <Faq
            q="Do my clients need to download an app?"
            a="No. They tap your link and chat right in their browser. Nothing to install, no account to create."
          />
          <Faq
            q="Do I need Square?"
            a="Yes — Kasa connects to your Square Appointments so availability is real and every booking lands on your calendar. Connecting takes about a minute."
          />
          <Faq
            q="What does the assistant book against?"
            a="Your live Square availability. Clients only see times you can actually take, and nothing is booked until they confirm."
          />
          <Faq
            q="How well does it understand my clients?"
            a="It's built for natural English — typos, shorthand like “tmrw at 130,” and casual phrasing all just work. If a request is unclear or unusual, it asks a quick follow-up or hands it to you rather than guessing."
          />
          <Faq
            q="Do clients get reminders?"
            a="Yes — included. After booking, your client gets a confirmation text, plus a reminder before the appointment with a tap to reschedule or cancel. Fewer no-shows, no extra work for you."
          />
          <Faq
            q="What if a client asks for something I don't offer?"
            a="The assistant won't guess. It sends you a short summary so you can reply personally — your clients never hit a dead end."
          />
          <Faq
            q="Can I change my pricing or cancel?"
            a="Anytime. No contracts, no per-booking fees. Beta providers keep their pricing as we grow."
          />
        </Reveal>
      </section>

      {/* ── Final CTA ─────────────────────────────────────────────────────── */}
      <Reveal as="section" className="mt-28 rounded-3xl border border-ink-100 bg-cream-100/60 px-6 py-14 text-center sm:px-12">
        <h2 className="mx-auto max-w-xl font-display text-3xl font-medium tracking-tight text-ink-900 sm:text-4xl">
          Get your booking link in under 3 minutes.
        </h2>
        <p className="mx-auto mt-4 max-w-md text-[15px] leading-relaxed text-ink-600">
          Connect Square, share your link, and let your clients book themselves.
        </p>
        <Link
          href="/setup"
          className="mt-8 inline-flex min-h-[48px] items-center rounded-full bg-ink-900 px-7 py-3.5 text-[15px] font-medium text-cream-50 transition hover:bg-ink-800 active:scale-[0.97]"
        >
          Get started today
        </Link>
      </Reveal>

      <footer className="mt-20 border-t border-ink-100 pt-8 text-sm text-ink-500">
        <p>Kasa · Booking for solo service providers</p>
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
  Icon,
}: {
  n: string;
  title: string;
  body: string;
  Icon: LucideIcon;
}) {
  return (
    <div>
      <div className="flex items-center gap-3">
        <span className="inline-flex h-11 w-11 items-center justify-center rounded-2xl bg-ink-900 text-cream-50">
          <Icon className="h-5 w-5" strokeWidth={1.75} aria-hidden />
        </span>
        <span className="font-display text-sm tracking-[0.14em] text-ink-400">
          {n}
        </span>
      </div>
      <h3 className="mt-4 font-display text-xl font-medium text-ink-900">
        {title}
      </h3>
      <p className="mt-2 text-[15px] leading-relaxed text-ink-600">{body}</p>
    </div>
  );
}

function Feature({
  title,
  body,
  Icon,
}: {
  title: string;
  body: string;
  Icon: LucideIcon;
}) {
  return (
    <div className="group h-full rounded-2xl border border-ink-100 bg-cream-50 p-5 transition duration-200 hover:-translate-y-0.5 hover:border-ink-200 hover:shadow-card">
      <span className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-accent-soft text-accent-dark transition group-hover:bg-accent group-hover:text-cream-50">
        <Icon className="h-5 w-5" strokeWidth={1.75} aria-hidden />
      </span>
      <h3 className="mt-4 font-display text-[17px] font-medium text-ink-900">
        {title}
      </h3>
      <p className="mt-2 text-[14.5px] leading-relaxed text-ink-600">{body}</p>
    </div>
  );
}

function Check() {
  return (
    <svg
      className="mt-0.5 h-4 w-4 shrink-0 text-accent"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M5 12.5L10 17.5L19 7.5" />
    </svg>
  );
}

function Faq({ q, a }: { q: string; a: string }) {
  return (
    <details className="group py-5">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-4">
        <span className="font-display text-[17px] font-medium text-ink-900">
          {q}
        </span>
        <span className="text-ink-400 transition group-open:rotate-45" aria-hidden>
          +
        </span>
      </summary>
      <p className="mt-3 max-w-xl text-[14.5px] leading-relaxed text-ink-600">
        {a}
      </p>
    </details>
  );
}

/**
 * A small, looping mock of the booking chat so visitors see what their clients
 * will experience. Static (no real fetch) — purely illustrative.
 */
// The demo conversation, as ordered "steps". Each is revealed in sequence,
// with a brief Shen-is-typing pause before every bot reply, then the whole
// thing loops. Falls back to all-steps-shown under prefers-reduced-motion.
type ChatStep =
  | { kind: "user"; text: string }
  | { kind: "bot"; text: string }
  | { kind: "chips"; items: string[] }
  | { kind: "confirm" };

const CHAT_STEPS: ChatStep[] = [
  { kind: "user", text: "i need a haircut tomorrow at 130" },
  { kind: "bot", text: "Yes — 1:30 PM tomorrow is open 💛 Want me to grab it?" },
  { kind: "chips", items: ["1:30 PM", "2:00 PM", "2:30 PM"] },
  { kind: "user", text: "perfect, let's do 1:30" },
  { kind: "bot", text: "Booked! See you tomorrow at 1:30 PM 💛" },
  { kind: "confirm" },
];

// Per-step pacing (ms). Bot steps get a typing pause baked into the reveal.
const STEP_DELAY: Record<ChatStep["kind"], number> = {
  user: 900,
  bot: 1300,
  chips: 700,
  confirm: 900,
};
const LOOP_PAUSE = 2600;

function ChatPreview() {
  const reduce = useReducedMotion();
  // The chat demo is PRODUCT CONTENT (show-don't-tell), so it always plays.
  // But for reduce-motion users we make it calmer: soft fade-only (no slide),
  // slower pacing, and it plays ONCE (no loop) instead of looping forever.
  const [shown, setShown] = useState(0);
  const [typing, setTyping] = useState(false);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;

    function schedule(next: number) {
      if (next > CHAT_STEPS.length) {
        if (reduce) return; // calm mode: play once, don't loop
        timer = setTimeout(() => {
          setShown(0);
          schedule(1);
        }, LOOP_PAUSE);
        return;
      }
      const step = CHAT_STEPS[next - 1];
      const reveal = () => {
        setTyping(false);
        setShown(next);
        timer = setTimeout(() => schedule(next + 1), STEP_DELAY[step.kind]);
      };
      // Typing indicator before each bot reply (skipped in calm mode — the dots
      // are themselves motion; a plain pause reads quieter).
      if (step.kind === "bot" && !reduce) {
        setTyping(true);
        timer = setTimeout(reveal, 850);
      } else {
        reveal();
      }
    }

    setShown(0);
    timer = setTimeout(() => schedule(1), 600);
    return () => clearTimeout(timer);
  }, [reduce]);

  return (
    <div className="relative">
      <div
        className="absolute -inset-6 -z-10 rounded-[40px] bg-accent-soft/60 blur-3xl"
        aria-hidden
      />
      <div className="overflow-hidden rounded-3xl border border-ink-100 bg-cream-50 shadow-card">
        {/* header */}
        <div className="flex items-center gap-2.5 border-b border-ink-100 px-4 py-3">
          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-accent-soft font-display text-sm text-accent-dark">
            S
          </div>
          <div>
            <p className="text-[14px] font-medium leading-tight text-ink-900">
              Shen
            </p>
            <p className="text-[11px] leading-tight text-ink-500">
              Booking with Shen
            </p>
          </div>
        </div>
        {/* messages — fixed min-height so the loop doesn't jump the layout */}
        <div className="min-h-[340px] space-y-2.5 p-4">
          <AnimatePresence>
            {CHAT_STEPS.slice(0, shown).map((step, i) => (
              <motion.div
                key={i}
                // Calm mode: fade only (no slide). Normal: gentle fade + rise.
                initial={reduce ? { opacity: 0 } : { opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: reduce ? 0.5 : 0.3, ease: "easeOut" }}
              >
                <ChatStepView step={step} />
              </motion.div>
            ))}
          </AnimatePresence>
          {typing && <TypingDots />}
        </div>
      </div>
    </div>
  );
}

function ChatStepView({ step }: { step: ChatStep }) {
  if (step.kind === "user") return <Bubble side="user">{step.text}</Bubble>;
  if (step.kind === "bot") return <Bubble side="bot">{step.text}</Bubble>;
  if (step.kind === "chips") {
    return (
      <div className="flex flex-wrap gap-2 pt-1">
        {step.items.map((c) => (
          <PreviewChip key={c}>{c}</PreviewChip>
        ))}
      </div>
    );
  }
  // confirm
  return (
    <div className="mt-1 rounded-2xl border border-success/30 bg-success-soft/40 p-3.5">
      <div className="flex items-center gap-2">
        <span className="flex h-5 w-5 items-center justify-center rounded-full bg-success text-cream-50">
          <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M5 12.5L10 17.5L19 7.5" />
          </svg>
        </span>
        <p className="text-[13px] font-medium text-ink-900">Booking confirmed</p>
      </div>
      <p className="mt-1.5 pl-7 text-[12.5px] leading-snug text-ink-600">
        Added to your calendar · client gets a text reminder before it.
      </p>
    </div>
  );
}

function TypingDots() {
  return (
    <div className="flex w-fit items-center gap-1 rounded-2xl rounded-tl-sm bg-cream-100 px-3.5 py-3">
      {[0, 150, 300].map((d) => (
        <span
          key={d}
          className="h-1.5 w-1.5 rounded-full bg-ink-400 animate-pulse"
          style={{ animationDelay: `${d}ms` }}
        />
      ))}
    </div>
  );
}

function Bubble({
  side,
  children,
}: {
  side: "user" | "bot";
  children: React.ReactNode;
}) {
  if (side === "user") {
    return (
      <div className="flex justify-end">
        <div className="max-w-[80%] rounded-2xl rounded-tr-sm bg-ink-900 px-3.5 py-2 text-[14px] leading-relaxed text-cream-50">
          {children}
        </div>
      </div>
    );
  }
  return (
    <div className="max-w-[85%] rounded-2xl rounded-tl-sm bg-cream-100 px-3.5 py-2 text-[14px] leading-relaxed text-ink-800">
      {children}
    </div>
  );
}

function PreviewChip({ children }: { children: React.ReactNode }) {
  return (
    <span className="rounded-xl border border-ink-100 bg-cream-50 px-3 py-1.5 font-display text-[13px] font-medium text-ink-900">
      {children}
    </span>
  );
}
