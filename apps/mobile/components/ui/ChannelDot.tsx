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
  // WhatsApp — speech bubble with a phone handset (simplified, legible at 42px).
  whatsapp:
    '<path d="M12 3a9 9 0 0 0-7.7 13.6L3 21l4.5-1.2A9 9 0 1 0 12 3Z"/><path d="M9 8.5c0 4 3 6.5 6 6.5.6 0 1-.5 1-1l-1.5-1-1.2.8c-1-.5-1.9-1.4-2.4-2.4l.8-1.2-1-1.5c-.5 0-1 .4-1 1Z" fill="GLYPH" stroke="none"/>',
  // Messenger — the classic rounded chat bubble with a lightning/check tail.
  messenger:
    '<path d="M12 3C6.9 3 3 6.8 3 11.4c0 2.5 1.2 4.7 3 6.2V21l2.7-1.5c1 .3 2.1.4 3.3.4 5.1 0 9-3.8 9-8.5S17.1 3 12 3Z"/><path d="m7.5 13.5 3-3 2 1.5 2.5-2.5-3 3-2-1.5-2.5 2.5Z" fill="GLYPH" stroke="none"/>',
  // LINE — rounded speech bubble (their signature shape).
  line:
    '<path d="M12 4C7 4 3 7.2 3 11.2c0 3.6 3.3 6.6 7.7 7.1.9.1.7.6.6 1.1l-.2 1c-.1.4.3.6.6.4 1.2-.6 5.6-3.3 6.9-5.6A6.7 6.7 0 0 0 21 11.2C21 7.2 17 4 12 4Z"/>',
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
