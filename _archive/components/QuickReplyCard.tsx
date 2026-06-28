import type { QuickReply } from "@/lib/types";
import { CopyButton } from "./CopyButton";

type QuickReplyCardProps = {
  reply: QuickReply;
};

export function QuickReplyCard({ reply }: QuickReplyCardProps) {
  return (
    <div className="rounded-2xl border border-ink-100 bg-cream-50 p-4">
      <div className="flex items-center justify-between gap-3">
        <span className="rounded-full bg-cream-100 px-2.5 py-1 text-[11px] font-medium uppercase tracking-wider text-ink-600">
          {reply.label}
        </span>
        <CopyButton value={reply.body} size="sm" variant="ghost" label="Copy" />
      </div>
      <p className="mt-3 text-sm leading-relaxed text-ink-700">{reply.body}</p>
    </div>
  );
}
