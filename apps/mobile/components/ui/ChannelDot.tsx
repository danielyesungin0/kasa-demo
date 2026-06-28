// Channel indicators. Two forms (DESIGN.md §6):
//   <ChannelDot> — filled high-contrast dot with the channel's own glyph
//                  (lists/threads). Kakao = dark glyph on yellow (per-channel
//                  `glyph` color). Glyph SVGs ported verbatim from the prototype.
//   <ChannelBadge> — soft tinted pill with label (profile/settings).
import { View } from "react-native";
import { SvgXml } from "react-native-svg";
import { channels, type ChannelKey } from "@/theme/colors";
import { Text } from "./Text";

// Channel glyph path data — copied verbatim from the prototype's CHAN[].ic.
const GLYPH: Record<ChannelKey, string> = {
  instagram:
    '<rect x="2" y="2" width="20" height="20" rx="5"/><circle cx="12" cy="12" r="4"/><circle cx="17.5" cy="6.5" r="1" fill="GLYPH" stroke="none"/>',
  sms:
    '<path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5Z"/>',
  wechat:
    '<path d="M8.6 4C5 4 2 6.5 2 9.7c0 1.8.9 3.4 2.5 4.5L4 16.5l2.4-1.2c.7.2 1.5.3 2.2.3h.5"/><path d="M22 14.4c0-2.7-2.6-4.9-5.8-4.9s-5.8 2.2-5.8 4.9 2.6 4.9 5.8 4.9c.7 0 1.3-.1 1.9-.3l1.9 1-.4-1.6c1.4-.9 2.4-2.3 2.4-3.9Z"/><circle cx="14.3" cy="13.6" r=".5" fill="GLYPH" stroke="none"/><circle cx="18.1" cy="13.6" r=".5" fill="GLYPH" stroke="none"/>',
  kakao:
    '<path d="M12 4C6.8 4 2.6 7.2 2.6 11.2c0 2.6 1.8 4.9 4.4 6.2-.2.7-.7 2.5-.8 2.9-.1.4.2.4.4.3.3-.2 2.7-1.8 3.7-2.5.6.1 1.2.1 1.7.1 5.2 0 9.4-3.2 9.4-7.2S17.2 4 12 4Z"/>',
};

function glyphSvg(ch: ChannelKey, size: number, color: string): string {
  const body = GLYPH[ch].replaceAll("GLYPH", color);
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24" ` +
    `fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`
  );
}

export function ChannelDot({ ch, size = 18 }: { ch: ChannelKey; size?: number }) {
  const meta = channels[ch];
  const glyphSize = Math.round(size * 0.58);
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        backgroundColor: meta.dot, // exact token fill (Kakao #F4C300)
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <SvgXml xml={glyphSvg(ch, glyphSize, meta.glyph)} />
    </View>
  );
}

export function ChannelBadge({ ch }: { ch: ChannelKey }) {
  const meta = channels[ch];
  return (
    <View
      className="flex-row items-center gap-1 rounded-pill px-2.5 py-1"
      style={{ backgroundColor: meta.soft }}
    >
      <SvgXml xml={glyphSvg(ch, 11, meta.text)} />
      <Text className="text-caption font-semibold" style={{ color: meta.text }}>
        {meta.label}
      </Text>
    </View>
  );
}
