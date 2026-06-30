import Link from "next/link";
import { ARTIST } from "@/lib/mock";

// Public artist profile — the "storefront" the Instagram bio links to.
// (Prototype: always renders the sample artist regardless of the handle.)
export default async function ArtistProfile({ params }: { params: Promise<{ artist: string }> }) {
  const a = ARTIST;
  const { artist } = await params;
  const handle = artist || a.handle;

  return (
    <main className="mx-auto min-h-screen max-w-phone px-gutter pb-16 pt-12">
      {/* avatar */}
      <div className="flex flex-col items-center text-center">
        <div className="flex h-20 w-20 items-center justify-center rounded-full bg-accent-soft text-[26px] font-serif text-accent-ink">
          {a.displayName[0]}
        </div>
        <h1 className="mt-4 font-serif text-[30px] leading-tight text-ink">{a.displayName}</h1>
        <a href={`https://instagram.com/${a.instagram.replace("@", "")}`}
          className="mt-1 text-[14px] font-medium text-accent-ink">{a.instagram}</a>
        <div className="mt-1 text-[13.5px] text-ink-3">{a.studio} · {a.location}</div>
      </div>

      {/* booking status */}
      <div className="mt-5 flex justify-center">
        <span className="rounded-full bg-ok-soft px-3.5 py-1.5 text-[12.5px] font-bold text-ok-ink">
          {a.bookingStatus}
        </span>
      </div>

      {/* style tags */}
      <div className="mt-5 flex flex-wrap justify-center gap-2">
        {a.styleTags.map((t) => (
          <span key={t} className="rounded-full border border-line-2 bg-surface px-3 py-1.5 text-[12.5px] font-medium text-ink-2">
            {t}
          </span>
        ))}
      </div>

      {/* bio */}
      <p className="mt-6 text-center text-[15px] leading-relaxed text-ink-2">{a.bio}</p>

      {/* CTA */}
      <div className="mt-8">
        <Link href={`/${handle}/request`}
          className="flex h-[54px] w-full items-center justify-center rounded-control-lg bg-ink text-[16px] font-semibold text-white transition active:scale-[0.99]">
          Start tattoo request
        </Link>
        <p className="mt-3 text-center text-[12.5px] text-ink-4">{a.responseTime}</p>
      </div>

      {/* policy preview */}
      <details className="mt-8 rounded-card border border-line bg-surface p-4">
        <summary className="cursor-pointer list-none text-[13px] font-bold uppercase tracking-wide text-ink-4">
          Before you request →
        </summary>
        <div className="mt-3 space-y-3 text-[13.5px] leading-relaxed text-ink-2">
          <p><span className="font-semibold text-ink">Deposit.</span> {a.depositText}</p>
          <p><span className="font-semibold text-ink">Rescheduling.</span> {a.cancellationText}</p>
        </div>
      </details>

      <div className="mt-10 text-center text-[12px] text-ink-4">
        Powered by <span className="font-serif">Kasa</span>
      </div>
    </main>
  );
}
