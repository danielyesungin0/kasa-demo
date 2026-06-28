// TS mirror of the NativeWind color tokens for the rare cases where a raw color
// value is needed (icons, native props that don't take className). The
// className tokens in tailwind.config.js remain the primary source; keep these
// in sync with it. Ported from design/reference.html :root.
export const colors = {
  bg: "#F4F0E9",
  surface: "#FFFFFF",
  surface2: "#FAF7F1",
  bgWarm: "#ECE6DB",
  ink: "#211D18",
  ink2: "#534B41",
  ink3: "#746A5C",
  ink4: "#9A9082",
  line: "#E9E2D6",
  line2: "#DED6C7",
  accent: "#C56B5C",
  accentStrong: "#A94B3E",
  accentSoft: "#F5E3DD",
  accentInk: "#9A4A3D",
  plum: "#7E6488",
  plumStrong: "#6A5074",
  plumSoft: "#ECE3EE",
  plumInk: "#5F4868",
  ok: "#5E9B73",
  okSoft: "#E2EFE6",
  okInk: "#3C6F50",
  warn: "#B98A3C",
  warnSoft: "#F4EAD6",
  warnInk: "#85601F",
  err: "#C2554E",
  errSoft: "#F5E1DF",
  errInk: "#8F3832",
  blue: "#5B7FA6",
  blueSoft: "#E3EAF2",
} as const;

// Channel meta — fill/glyph/tint per DESIGN.md §2. The four channels only.
export const channels = {
  instagram: { label: "Instagram", text: "#B5547F", soft: "#F6E5EE", dot: "#C2548A", glyph: "#FFFFFF" },
  sms: { label: "SMS", text: "#5B7FA6", soft: "#E3EAF2", dot: "#4F86C6", glyph: "#FFFFFF" },
  wechat: { label: "WeChat", text: "#3FA56E", soft: "#E1F0E7", dot: "#1FA855", glyph: "#FFFFFF" },
  kakao: { label: "KakaoTalk", text: "#A98A00", soft: "#FBF2C9", dot: "#F4C300", glyph: "#3A2E00" },
} as const;

export type ChannelKey = keyof typeof channels;
