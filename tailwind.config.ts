import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        display: ["var(--font-display)", "Georgia", "serif"],
        sans: ["var(--font-sans)", "system-ui", "sans-serif"],
      },
      colors: {
        // Warm neutral palette
        cream: {
          50: "#FBF9F6",
          100: "#F6F2EC",
          200: "#EBE5DB",
        },
        ink: {
          900: "#1A1715",
          800: "#2B2622",
          700: "#3D3631",
          600: "#5A5048",
          500: "#7A6F65",
          400: "#9A9088",
          300: "#BFB6AD",
          200: "#DDD5CB",
          100: "#EDE7DE",
        },
        accent: {
          // muted terracotta
          DEFAULT: "#B85C3C",
          dark: "#9C4C2F",
          light: "#D88A6E",
          soft: "#F4E2D8",
        },
        success: {
          DEFAULT: "#5B7A4A",
          soft: "#E8EFE0",
        },
      },
      borderRadius: {
        xl: "14px",
        "2xl": "20px",
        "3xl": "28px",
      },
      boxShadow: {
        card: "0 1px 2px rgba(26, 23, 21, 0.04), 0 4px 16px rgba(26, 23, 21, 0.04)",
        "card-hover":
          "0 1px 2px rgba(26, 23, 21, 0.06), 0 8px 24px rgba(26, 23, 21, 0.08)",
        soft: "0 1px 3px rgba(26, 23, 21, 0.05)",
      },
      letterSpacing: {
        tightest: "-0.04em",
      },
    },
  },
  plugins: [],
};

export default config;
