import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        primary: "var(--color-primary)",
        secondary: "var(--color-secondary)",
        // Tenant-overridable action gold (defaults to Wheat Gold 500).
        gold: "var(--brand-color)",
        // navy keeps its single-token default (bg-navy) and gains the brand scale.
        navy: {
          DEFAULT: "var(--color-navy)",
          500: "#37568A", 600: "#274067", 700: "#1B2E4F",
          800: "#12203B", 900: "#0C1526", 950: "#080F1D",
        },
        // Fixed reference wheat-gold scale (tints/shades that shouldn't shift
        // with the tenant color — e.g. brand chrome). Live actions use `gold`.
        wheat: {
          50: "#FBF4E6", 100: "#F5EDE0", 200: "#EAD5A8", 300: "#DCBB74",
          400: "#D4A94F", 500: "#C9963A", 600: "#B5862F", 700: "#8F6822",
        },
        sky: {
          100: "#E4F0FA", 200: "#BFDCF2", 300: "#93C1E7", 400: "#6BA8DD",
          500: "#4F97D6", 600: "#3A78B5", 700: "#2C5C8C",
        },
        field: {
          100: "#EAF0E2", 200: "#C9D8B3", 300: "#A6C085", 400: "#8CA96E",
          500: "#6E8E52", 600: "#55703F", 700: "#40562F",
        },
        // Warm neutrals — grounds & text.
        cream: "#FAF8F5",
        stone: { 100: "#F3EEE7", 200: "#E8E2D9", 300: "#D6CCBE" },
        earth: "#2D2519",
        "warm-brown": "#8B7355",
        "warm-dark": "#1A1612",
        "background-light": "var(--color-background-light)",
        "background-alt": "var(--color-background-alt)",
        "background-dark": "var(--color-background-dark)",
        // Theming stage 1 — semantic surface/border tokens (vocabulary only,
        // same colours as the scales above). Borders are named `line` rather
        // than `border`: Tailwind's borderColor scale already extends
        // `colors`, so a `border` key here would generate a confusing
        // `border-border` utility instead of clashing outright — `line`
        // avoids that ambiguity entirely (`border-line`, `border-line-subtle`).
        surface: {
          DEFAULT: "var(--surface)",
          raised: "var(--surface-raised)",
        },
        line: {
          DEFAULT: "var(--border-default)",
          subtle: "var(--border-subtle)",
          strong: "var(--border-strong)",
        },
      },
      borderRadius: {
        // Brand corner radii (lg 12 / xl 16 / 2xl 24).
        brand: "12px",
        "brand-lg": "16px",
        "brand-xl": "24px",
      },
      backgroundImage: {
        "gold-gradient": "var(--background-image-gold-gradient)",
      },
      fontFamily: {
        sans: ["var(--font-sans)", "system-ui", "sans-serif"],
        display: ["var(--font-display)", "Georgia", "serif"],
        serif: ["var(--font-serif)", "Georgia", "serif"],
      },
    },
  },
  plugins: [
    require('@tailwindcss/typography'),
  ],
};
export default config;
