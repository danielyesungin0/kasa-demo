// Channel reply-window state for the thread composer. Honest states only —
// when a window is closed we surface "Reply on {Channel}" and refuse to send,
// never a fake success (PRODUCT_BRIEF / DESIGN.md §1 "honest states").
import { channels, type ChannelKey } from "@/theme/colors";

export type ChannelState = {
  /** Can the stylist free-reply in-app right now? */
  canSend: boolean;
  /** Closed-window banner, when canSend is false. */
  banner?: { kind: "warn" | "err"; title: string; body: string };
  /** Label for the restricted composer's open-externally button. */
  openLabel?: string;
};

export function channelState(
  channel: ChannelKey,
  windowExpiresAt: string | null,
): ChannelState {
  // null window = no limit (SMS) → always open.
  const open = !windowExpiresAt || new Date(windowExpiresAt).getTime() > Date.now();
  if (open) return { canSend: true };

  const label = channels[channel].label;
  if (channel === "instagram") {
    return {
      canSend: false,
      openLabel: `Reply on ${label}`,
      banner: {
        kind: "warn",
        title: "Instagram reply window closed",
        body: `Instagram only allows free replies within 24 hours of the last message. Open ${label} to continue.`,
      },
    };
  }
  if (channel === "wechat") {
    return {
      canSend: false,
      openLabel: `Reply on ${label}`,
      banner: {
        kind: "warn",
        title: "WeChat service window closed",
        body: `It's been over 48 hours since her last message, so WeChat only allows a notification now. Open ${label} to reply.`,
      },
    };
  }
  // SMS/Kakao shouldn't reach here (no window), but be safe.
  return { canSend: false, openLabel: `Reply on ${label}` };
}
