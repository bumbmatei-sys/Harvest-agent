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
          // 50/100/200 are TINT fills and theme; 300+ are solid and do not.
          50: "rgb(var(--c-wheat-50) / <alpha-value>)",
          100: "rgb(var(--c-wheat-100) / <alpha-value>)",
          200: "rgb(var(--c-wheat-200) / <alpha-value>)",
          300: "#DCBB74", 400: "#D4A94F", 500: "#C9963A", 600: "#B5862F", 700: "#8F6822",
        },
        sky: {
          100: "rgb(var(--c-sky-100) / <alpha-value>)",
          200: "#BFDCF2", 300: "#93C1E7", 400: "#6BA8DD",
          500: "#4F97D6", 600: "#3A78B5", 700: "#2C5C8C",
        },
        field: {
          100: "rgb(var(--c-field-100) / <alpha-value>)",
          200: "rgb(var(--c-field-200) / <alpha-value>)",
          300: "#A6C085", 400: "#8CA96E",
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
          // THE-61, same rationale as `sunken` above: --surface-gold and
          // --surface-night have existed in globals.css since the member
          // desktop pass — with dark values since stage 3 — but had no utility,
          // so every consumer spelled bg-[var(--surface-gold)] by hand. Card
          // and Badge need both. This completes the surface scale; it adds no
          // vocabulary.
          //
          // ⚠️ Their absence was invisible: `bg-surface-gold` is a well-formed
          // class name that simply produced no rule.
          //
          // This comment used to credit ds-primitives.test.tsx with catching
          // that. It did not: no such file existed anywhere in the repo, so
          // THE-61 found the missing utilities by eye and the guard was only
          // ever described. THE-260 wrote it — src/components/ui/__tests__/
          // ds-primitives.test.tsx — and it now asserts that every token class
          // the primitives spell resolves against this config plus globals.css.
          // It is quarantined and failing on purpose: the primitives spell
          // shadcn's default tokens, which globals.css does not define, and
          // defining them is Phase 2.
          gold: "var(--surface-gold)",
          night: "var(--surface-night)",
        },
        // Stage 4: TINT shades only -- see globals.css. 300+ stay Tailwind's.
        red: { 50: "rgb(var(--c-red-50) / <alpha-value>)", 100: "rgb(var(--c-red-100) / <alpha-value>)", 200: "rgb(var(--c-red-200) / <alpha-value>)", },
        green: { 50: "rgb(var(--c-green-50) / <alpha-value>)", 100: "rgb(var(--c-green-100) / <alpha-value>)", },
        amber: { 50: "rgb(var(--c-amber-50) / <alpha-value>)", 100: "rgb(var(--c-amber-100) / <alpha-value>)", 200: "rgb(var(--c-amber-200) / <alpha-value>)", },
        blue: { 50: "rgb(var(--c-blue-50) / <alpha-value>)", 100: "rgb(var(--c-blue-100) / <alpha-value>)", },
        yellow: { 50: "rgb(var(--c-yellow-50) / <alpha-value>)", 100: "rgb(var(--c-yellow-100) / <alpha-value>)", },
        purple: { 50: "rgb(var(--c-purple-50) / <alpha-value>)", 100: "rgb(var(--c-purple-100) / <alpha-value>)", },
        // Harvest danger. DEFAULT does NOT invert (solid delete button);
        // the ink counterparts under textColor do.
        danger: { DEFAULT: "var(--brand-danger)", tint: "rgb(var(--c-danger-tint) / <alpha-value>)" },
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
        danger: { DEFAULT: "rgb(var(--ink-danger) / <alpha-value>)", strong: "rgb(var(--ink-danger-strong) / <alpha-value>)" },
        red: { 300: "rgb(var(--ink-red-300) / <alpha-value>)", 400: "rgb(var(--ink-red-400) / <alpha-value>)", 500: "rgb(var(--ink-red-500) / <alpha-value>)", 600: "rgb(var(--ink-red-600) / <alpha-value>)", 700: "rgb(var(--ink-red-700) / <alpha-value>)", 800: "rgb(var(--ink-red-800) / <alpha-value>)", },
        green: { 400: "rgb(var(--ink-green-400) / <alpha-value>)", 500: "rgb(var(--ink-green-500) / <alpha-value>)", 600: "rgb(var(--ink-green-600) / <alpha-value>)", 700: "rgb(var(--ink-green-700) / <alpha-value>)", 800: "rgb(var(--ink-green-800) / <alpha-value>)", },
        amber: { 500: "rgb(var(--ink-amber-500) / <alpha-value>)", 600: "rgb(var(--ink-amber-600) / <alpha-value>)", 700: "rgb(var(--ink-amber-700) / <alpha-value>)", 800: "rgb(var(--ink-amber-800) / <alpha-value>)", },
        field: { 500: "rgb(var(--ink-field-500) / <alpha-value>)", 600: "rgb(var(--ink-field-600) / <alpha-value>)", 700: "rgb(var(--ink-field-700) / <alpha-value>)", },
        // 800 is THE-61's addition: the AA-clearing gold ink for gold tints.
        wheat: { 500: "rgb(var(--ink-wheat-500) / <alpha-value>)", 600: "rgb(var(--ink-wheat-600) / <alpha-value>)", 700: "rgb(var(--ink-wheat-700) / <alpha-value>)", 800: "rgb(var(--ink-wheat-800) / <alpha-value>)", },
        sky: { 500: "rgb(var(--ink-sky-500) / <alpha-value>)", 600: "rgb(var(--ink-sky-600) / <alpha-value>)", 700: "rgb(var(--ink-sky-700) / <alpha-value>)", },
        blue: { 500: "rgb(var(--ink-blue-500) / <alpha-value>)", 600: "rgb(var(--ink-blue-600) / <alpha-value>)", 700: "rgb(var(--ink-blue-700) / <alpha-value>)", },
        yellow: { 500: "rgb(var(--ink-yellow-500) / <alpha-value>)", 600: "rgb(var(--ink-yellow-600) / <alpha-value>)", 700: "rgb(var(--ink-yellow-700) / <alpha-value>)", 800: "rgb(var(--ink-yellow-800) / <alpha-value>)", },
        purple: { 500: "rgb(var(--ink-purple-500) / <alpha-value>)", 700: "rgb(var(--ink-purple-700) / <alpha-value>)", },
        pink: { 500: "rgb(var(--ink-pink-500) / <alpha-value>)", },
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
      // ── THE-61: the only three scale values the design kit adds ──────────
      // Everything else in its tokens/ maps onto something that already
      // exists: --space-1..40 ARE Tailwind's spacing scale, --weight-* ARE
      // font-light..bold, --text-xs/sm/base/lg ARE Tailwind's, and
      // --radius-lg/xl/2xl (12/16/24) ARE borderRadius.brand/-lg/-xl above.
      //
      // These are literals, not CSS variables, because none of them theme —
      // a letter-spacing has no dark counterpart. Keeping them out of
      // globals.css keeps the key-parity guard's list meaningful.
      letterSpacing: {
        // Fraunces display tracking. Distinct from Tailwind's `tracking-tight`
        // (-0.025em), which is close enough to be mistaken for it but is not
        // the brand value — hence a name of its own rather than an override.
        display: "-0.02em",
        // The tracked uppercase gold kicker. Tailwind's widest is 0.1em, so
        // there is nothing to collide with.
        eyebrow: "0.19em",
      },
      transitionTimingFunction: {
        // The knob settle on Switch. Deliberately NOT overriding `out` or
        // `in-out`: the kit's curves for those differ from Tailwind's, and
        // redefining them would silently restyle every existing transition in
        // src. Only the genuinely-new curve gets a name.
        spring: "cubic-bezier(0.34, 1.56, 0.64, 1)",
      },
      backgroundImage: {
        "gold-gradient": "var(--background-image-gold-gradient)",
      },
      fontFamily: {
        sans: ["var(--font-sans)", "system-ui", "sans-serif"],
        display: ["var(--font-display)", "Georgia", "serif"],
        serif: ["var(--font-serif)", "Georgia", "serif"],
      },
      // ── Theming stage 4: `prose` ────────────────────────────────────────
      // @tailwindcss/typography does `require('tailwindcss/colors')` directly,
      // so its --tw-prose-* defaults are Tailwind's cool greys and are immune to
      // anything in `colors` here. That left every blog, course and lesson body
      // rendering gray-700 (#374151) on the dark ground at ~1.5:1 — the largest
      // remaining dark-mode gap, and invisible to the class-based guards because
      // no component spells the colour.
      //
      // Driving the variables off the ramp fixes all 10 prose call sites from
      // one place and needs no `dark:prose-invert` sprinkled through the tree —
      // prose-invert would only swap in a different set of hardcoded greys.
      typography: {
        DEFAULT: {
          css: {
            "--tw-prose-body": "var(--text-body)",
            "--tw-prose-headings": "var(--text-strong)",
            "--tw-prose-lead": "var(--text-muted)",
            "--tw-prose-links": "var(--text-strong)",
            "--tw-prose-bold": "var(--text-strong)",
            "--tw-prose-counters": "var(--text-muted)",
            "--tw-prose-bullets": "var(--border-strong)",
            "--tw-prose-hr": "var(--border-default)",
            "--tw-prose-quotes": "var(--text-strong)",
            "--tw-prose-quote-borders": "var(--border-default)",
            "--tw-prose-captions": "var(--text-muted)",
            "--tw-prose-code": "var(--text-strong)",
            "--tw-prose-pre-code": "var(--text-body)",
            "--tw-prose-pre-bg": "var(--surface-sunken)",
            "--tw-prose-th-borders": "var(--border-strong)",
            "--tw-prose-td-borders": "var(--border-default)",
            "--tw-prose-kbd": "var(--text-strong)",
            // consumed as rgb(var(--x) / 10%), so this one is a channel triplet
            // rather than a colour: earth #2D2519.
            "--tw-prose-kbd-shadows": "45 37 25",

            // `prose-invert` is NOT the dark theme. It is used once, by
            // TipTapReadOnly inside LivestreamView, which is bg-[#0b1121] in
            // BOTH themes — so these must stay light always and are pinned to
            // fixed warm brand tokens, never to the inverting ramp.
            "--tw-prose-invert-body": "var(--stone-200)",
            "--tw-prose-invert-headings": "var(--cream)",
            "--tw-prose-invert-lead": "var(--stone-300)",
            "--tw-prose-invert-links": "var(--cream)",
            "--tw-prose-invert-bold": "var(--cream)",
            "--tw-prose-invert-counters": "var(--stone-300)",
            "--tw-prose-invert-bullets": "var(--warm-brown)",
            "--tw-prose-invert-hr": "var(--warm-brown)",
            "--tw-prose-invert-quotes": "var(--cream)",
            "--tw-prose-invert-quote-borders": "var(--warm-brown)",
            "--tw-prose-invert-captions": "var(--stone-300)",
            "--tw-prose-invert-code": "var(--cream)",
            "--tw-prose-invert-pre-code": "var(--stone-200)",
            "--tw-prose-invert-pre-bg": "var(--warm-dark)",
            "--tw-prose-invert-th-borders": "var(--warm-brown)",
            "--tw-prose-invert-td-borders": "var(--warm-brown)",
            "--tw-prose-invert-kbd": "var(--cream)",
            "--tw-prose-invert-kbd-shadows": "250 248 245",
          },
        },
      },
    },
  },
  plugins: [
    require('@tailwindcss/typography'),
  ],
};
export default config;
