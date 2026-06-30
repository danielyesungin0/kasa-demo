import type { Config } from "tailwindcss";

// Design tokens ported verbatim from the mobile app (theme/colors.ts) — the warm,
// editorial, premium system. Kept identical so the brand carries across.
const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        bg: "#F4F0E9",
        surface: "#FFFFFF",
        "surface-2": "#FAF7F1",
        "bg-warm": "#ECE6DB",
        ink: "#211D18",
        "ink-2": "#534B41",
        "ink-3": "#746A5C",
        "ink-4": "#9A9082",
        line: "#E9E2D6",
        "line-2": "#DED6C7",
        accent: "#C56B5C",
        "accent-strong": "#A94B3E",
        "accent-soft": "#F5E3DD",
        "accent-ink": "#9A4A3D",
        plum: "#7E6488",
        "plum-strong": "#6A5074",
        "plum-soft": "#ECE3EE",
        "plum-ink": "#5F4868",
        ok: "#5E9B73",
        "ok-soft": "#E2EFE6",
        "ok-ink": "#3C6F50",
        warn: "#B98A3C",
        "warn-soft": "#F4EAD6",
        "warn-ink": "#85601F",
        err: "#C2554E",
        "err-soft": "#F5E1DF",
        "err-ink": "#8F3832",
      },
      fontFamily: {
        sans: ["var(--font-inter)", "system-ui", "sans-serif"],
        serif: ["var(--font-fraunces)", "Georgia", "serif"],
      },
      borderRadius: {
        control: "12px",
        "control-lg": "14px",
        card: "18px",
        sheet: "24px",
      },
      spacing: { gutter: "20px" },
      maxWidth: { phone: "440px" }, // mobile-first content column
    },
  },
  plugins: [],
};
export default config;
