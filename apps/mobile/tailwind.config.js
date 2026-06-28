/**
 * Kasa design tokens — SINGLE SOURCE OF TRUTH.
 * Ported verbatim from design/reference.html :root + kasa-handoff/DESIGN.md.
 * Every screen consumes these; never hardcode a hex/size in a component.
 *
 * Note on type sizes: DESIGN.md §3 requires scalable units that honor Dynamic
 * Type. These px values are the *design* sizes; components render text via the
 * <Text> wrapper (components/ui/Text.tsx) which applies allowFontScaling and
 * the platform font scale, so these stay design-accurate AND accessible.
 */
/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  presets: [require("nativewind/preset")],
  theme: {
    extend: {
      colors: {
        // surfaces
        bg: "#F4F0E9",
        surface: "#FFFFFF",
        "surface-2": "#FAF7F1",
        "bg-warm": "#ECE6DB",
        // ink (text)
        ink: "#211D18",
        "ink-2": "#534B41",
        "ink-3": "#746A5C",
        "ink-4": "#9A9082",
        line: "#E9E2D6",
        "line-2": "#DED6C7",
        // brand — accent (clay-rose), plum (booking/Square)
        accent: "#C56B5C",
        "accent-strong": "#A94B3E",
        "accent-soft": "#F5E3DD",
        "accent-ink": "#9A4A3D",
        plum: "#7E6488",
        "plum-strong": "#6A5074",
        "plum-soft": "#ECE3EE",
        "plum-ink": "#5F4868",
        // semantic
        ok: "#5E9B73",
        "ok-soft": "#E2EFE6",
        "ok-ink": "#3C6F50",
        warn: "#B98A3C",
        "warn-soft": "#F4EAD6",
        "warn-ink": "#85601F",
        err: "#C2554E",
        "err-soft": "#F5E1DF",
        "err-ink": "#8F3832",
        blue: "#5B7FA6",
        "blue-soft": "#E3EAF2",
        // channels — text/tint + dot fill/glyph (DESIGN.md §2)
        ig: "#B5547F",
        "ig-soft": "#F6E5EE",
        "ig-dot": "#C2548A",
        sms: "#5B7FA6",
        "sms-soft": "#E3EAF2",
        "sms-dot": "#4F86C6",
        wechat: "#3FA56E",
        "wechat-soft": "#E1F0E7",
        "wechat-dot": "#1FA855",
        kakao: "#A98A00",
        "kakao-soft": "#FBF2C9",
        "kakao-dot": "#F4C300",
        "kakao-glyph": "#3A2E00",
      },
      fontFamily: {
        // UI = Inter; display = Fraunces (sparingly). Loaded in _layout.
        sans: ["Inter_400Regular"],
        medium: ["Inter_500Medium"],
        semibold: ["Inter_600SemiBold"],
        bold: ["Inter_700Bold"],
        serif: ["Fraunces_500Medium"],
        "serif-semibold": ["Fraunces_600SemiBold"],
      },
      fontSize: {
        // DESIGN.md §3 scale (design px; scaled at render for Dynamic Type)
        eyebrow: ["12px", { lineHeight: "14px", letterSpacing: "1px" }],
        caption: ["12.5px", { lineHeight: "17px" }],
        label: ["11px", { lineHeight: "13px", letterSpacing: "0.6px" }],
        body: ["15px", { lineHeight: "22px" }],
        "body-sm": ["13.5px", { lineHeight: "19px" }],
        section: ["15px", { lineHeight: "20px" }],
        title: ["22px", { lineHeight: "27px" }],
        "title-lg": ["27px", { lineHeight: "32px" }],
        display: ["28px", { lineHeight: "30px" }],
        "display-lg": ["35px", { lineHeight: "37px" }],
      },
      spacing: {
        // 4/8/12/16/20/24 rhythm; screen gutter = 20 (DESIGN.md §4)
        1: "4px",
        2: "8px",
        3: "12px",
        4: "16px",
        5: "20px",
        6: "24px",
        gutter: "20px",
      },
      borderRadius: {
        control: "12px",
        "control-lg": "14px",
        card: "18px",
        sheet: "26px",
        pill: "999px",
        full: "999px",
      },
    },
  },
  plugins: [],
};
