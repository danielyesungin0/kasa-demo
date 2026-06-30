import Link from "next/link";

// Placeholder marketing root. The product lives at /[artist] (e.g. /dizon).
export default function Home() {
  return (
    <main className="mx-auto flex min-h-screen max-w-phone flex-col items-center justify-center px-gutter text-center">
      <div className="font-serif text-[40px] text-ink">Kasa</div>
      <p className="mt-3 text-[16px] leading-relaxed text-ink-2">
        Turn messy tattoo requests into clean, artist-ready briefs.
      </p>
      <Link href="/dizon" className="mt-7 flex h-[52px] items-center justify-center rounded-control-lg bg-ink px-6 text-[15.5px] font-semibold text-white">
        See a sample artist page →
      </Link>
      <p className="mt-4 text-[12.5px] text-ink-4">Prototype · kasa.ink/dizon</p>
    </main>
  );
}
