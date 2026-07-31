import type { Config } from "tailwindcss";

const config: Config = {
  // ── Theming stage 2: the theme mechanism ────────────────────────────────
  // Without this key Tailwind 3 defaults to `media`, so `dark:` utilities key
  // off the OS setting only — which can never agree with a CSS-variable theme
  // switched by an attribute. Both selectors are accepted deliberately:
  //   • `.dark`               — what third-party/shadcn components look for.
  //   • `[data-theme="dark"]` — what the CSS variable overrides key off, and
  //                             the one React never renders, so it survives
  //                             hydration untouched (see src/app/layout.tsx).
  // `:where()` keeps specificity at 0 so a dark override never out-ranks a
  // more specific light rule by accident.
  // NOTE: this is mechanism only. No dark palette is defined yet, so neither
  // selector changes a single pixel today — see the empty stage-3 block in
  // src/app/globals.css.
  darkMode: ['variant', [
    '&:where(.dark, .dark *)',
    '&:where([data-theme="dark"], [data-theme="dark"] *)',
  ]],
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
          // Completes the surface scale rather than adding vocabulary:
          // --surface-sunken already exists (globals.css) but had no utility,
          // so bg-stone-100 — the largest unmapped surface in the audit
          // (392 uses / 74 files) — had nowhere to convert to.
          sunken: "var(--surface-sunken)",
          chip: "var(--surface-chip)",
          tint: "var(--surface-tint)",
        },
        line: {
          DEFAULT: "var(--border-default)",
          subtle: "var(--border-subtle)",
          strong: "var(--border-strong)",
          hairline: "var(--border-hairline)",
        },
      },
      // ── Theming stage 2: semantic TEXT tokens ───────────────────────────
      // Deliberately under `textColor`, not `colors`. Putting strong/muted/faint
      // in `colors` would also mint bg-*, border-*, ring-* etc. for them — and
      // `border-strong` would then resolve to --text-strong (earth #2D2519)
      // while the existing `border-line-strong` resolves to --border-strong
      // (stone-300 #D6CCBE). Two different colours behind near-identical class
      // names is precisely the ambiguity the `line` naming was chosen to avoid.
      // These are text roles, so scoping them to textColor makes the wrong
      // utility unspellable instead of merely discouraged.
      // No key collision: `strong`/`muted`/`faint` are absent from `colors`, and
      // Tailwind's text-* fontSize scale (text-sm/-lg/…) shares the namespace
      // but has no entry of these names.
      textColor: {
        strong: "var(--text-strong)", // = text-earth
        body: "var(--text-body)",     // = text-[color:var(--text-body)]
        muted: "var(--text-muted)",   // = text-warm-brown
        faint: "var(--text-faint)",   // = text-[color:var(--text-faint)]
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
