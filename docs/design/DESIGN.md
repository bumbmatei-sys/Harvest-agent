# Design: the Studio theme (second selectable theme)

This document records the visual language extracted from Eden (app.eden.so and eden.so) on 3 Nov 2026 and turns it into **Studio**, a second selectable Harvest theme. Studio does not replace anything. The current Harvest look stays the default theme, and a tenant (optionally a user) can switch to Studio in settings. "Studio" is a placeholder name; the user-facing name must never mention Eden. It is the reference for all theme and component work described in [REBUILD-PLAN.md](./REBUILD-PLAN.md).

## 1. Purpose and ground rules

The purpose is to match Eden's **visual language only**: tokens, spacing, radii, shadows, motion, and layout patterns. The product remains Harvest.

Ground rules:

- Studio is an additional theme. The current Harvest theme stays the default for every tenant and user who has not picked Studio, and it is not changed by this work.
- The user-facing theme name never mentions Eden (placeholder: "Studio"). Eden appears only in internal docs as the reference.
- Primary buttons are Harvest gold (`--brand-color`) in **both** themes, admin app included (decided by Matei, 2026-11-03).
- Keep Harvest's own branding. Do not copy Eden logos, illustrations, images, copy/text, or the Eden name into the product.
- The tenant-overridable action colour stays `--brand-color` (Wheat Gold `#C9963A` by default). Eden's green `#66B08B` is **not** adopted as Harvest's brand colour.
- Where Eden uses its green for selected states, Harvest uses `--brand-color` (see the selected-background row in the mapping tables).
- Use Harvest copy and Harvest illustrations (or live UI previews) everywhere. Where Eden shows an illustrative preview in an empty state, Harvest shows its own.
- Everything in this document applies in both light and dark modes.

## 2. Sources and coverage

### Sources

1. **Dembrandt 0.39.2 CLI** (real Chromium) against public pages:
   - `https://eden.so` — crawl of `/`, `/pricing`, `/teams`, `/enterprise`, `/features/discover`, `/features/creators`, plus dark-mode and mobile runs.
   - `https://app.eden.so` — sign-in page only, light and dark.
   - Raw JSON is in `docs/design/tokens/` with logo/favicon fields stripped.
2. **Eden app's public CSS bundles** served from `app.eden.so/assets` (no login required). The app's theme custom properties (light `:root`, `.dark`, accent variants) were read from them and only the resulting values (HEX, sizes, radii, shadows) are recorded in the token tables below. The stylesheets themselves are not in the repo; a local reference copy is kept on the box at `/workspace/eden-design-ref/` (outside the repo). This is the most complete source for in-app tokens, because every logged-in page uses these variables.

### Not reachable

Logged-in pages were not crawled — there is no auth bypass. The visual reference for logged-in screens is the existing screenshot library listed below.

### Screenshot library locations

- `/workspace/eden-archive` — 00-map (81), 01-create (44), 02-store (127), 03-community (93), mobile (12)
- `/workspace/eden-ref` (25+)
- `/workspace/reference-shots/eden-*` (63)
- `/workspace/website-ref/eden-email-themes` (24)
- `docs/design/eden/` in repo (28)

Note: the marketing site (eden.so) uses a different type system (EB Garamond display + Figtree body, pill radius `9999px` everywhere) than the app. The **app** is the target for Harvest's admin and member app. Marketing values only matter for Harvest's public/marketing pages.

### Files in `docs/design/tokens/`

- `eden-app-signin.light.dembrandt.json`
- `eden-app-signin.dark.dembrandt.json`
- `eden-app-signin.shadcn.css`
- `eden-app-signin.tailwind-theme.css`
- `eden-marketing.crawl6.dembrandt.json`
- `eden-marketing.dark.dembrandt.json`
- `eden-marketing.mobile.dembrandt.json`
- `eden-marketing.dtcg.tokens.json`
- `eden-marketing.shadcn.css`
- `eden-marketing.tailwind-theme.css`

## 3. Tokens

### Colours — light

**Text**

| Role | Eden variable | HEX |
| --- | --- | --- |
| Primary text | text-primary | `#272523` |
| Secondary text | text-secondary | `#55524e` |
| Muted text | text-muted | `#77746f` |
| Dark secondary text | text-dark-secondary | `#686764` |
| Secondary icon | icon-secondary | `#91908e` |
| Error text | text-dark-error | `#c0272e` |

**Surfaces**

| Role | Eden variable | HEX |
| --- | --- | --- |
| Page background | background-page | `#f7f7f5` |
| Pane background | background-pane | `#ffffff` |
| Main background | background-main | `#ffffff` |
| Popover surface | surface-popover | `#ffffff` |
| Menu background | background-menu | `#ffffff` |
| Sidebar background | background-sidebar | `#f9f9f7` |
| Sidebar surface | surface-sidebar | `#f5f4f1` |
| Canvas surface | surface-canvas | `#fcfcfa` |
| Card surface | surface-card | `#ffffff` |
| Highlight surface | surface-highlight | `#f9f9f7` |
| Floating surface | surface-floating | `#fcfcfa` |
| Secondary background | background-secondary | `#f6f6f4` |
| Field background | background-field | `#f5f5f3` |
| Field hover | background-field-hover | `#e8e8e4` |
| Subtle surface | surface-subtle | `#eff2ee` |

**Lines**

| Role | Eden variable | HEX |
| --- | --- | --- |
| Border | border | `#2725231a` (ink at 10%) |
| Divider | divider | `#2725231a` |
| Subtle border | border-subtle | `#8e8e8e40` |
| Neutral dark 10 | neutral-dark-10 | `#2725231a` |

**Primary / accent (Eden green — reference only, not adopted as Harvest brand)**

| Role | Eden variable | HEX |
| --- | --- | --- |
| Primary | primary | `#66b08b` |
| Scale 5 | primary-5 | `#eff2ee` |
| Scale 10 | primary-10 | `#e3e7e3` |
| Scale 20 | primary-20 | `#ccd4cd` |
| Scale 30 | primary-30 | `#b3bfb7` |
| Scale 40 | primary-40 | `#90a297` |
| Scale 50 | primary-50 | `#6a8377` |
| Scale 60 | primary-60 | `#526f61` |
| Scale 70 | primary-70 | `#395a4b` |
| Scale 80 | primary-80 | `#224735` |
| Scale 90 | primary-90 | `#09321f` |
| Scale 100 | primary-100 | `#052415` |
| Translucent 10% | primary/10 | `#66b08b1a` |
| Translucent 5% | primary/5 | `#66b08b0d` |
| Selected background (12%) | background-primary-selected | `#66b08b1f` |
| Gradient dark | gradient-dark | `linear-gradient(90deg,#062a19 0%,#26553f 100%)` |

**Primary button (Eden reference only)**: background `#000000`, text `#ffffff` (`button-primary-default`). **Not adopted**: Harvest primary buttons stay gold in both themes (see §6).

**Danger**: `#e36a66`; hover `#d95d59`.

**Page background effect**: subtle radial gradients (rgba black 4% / 3%) + SVG grain, blended multiply. Light mode only; none in dark.

**Accent themes**: `data-accent` = `eden` (default green) | `mono` | `ocean` | `violet` | `amber` | `rose` | `graphite`. Each sets `--accent-seed-light/dark` and `--mood-tint-light/dark`; dark surfaces mix 5–8% of the mood tint in via `color-mix`. Mono light: page `#ffffff`, sidebar `#fbfbfb`, field `#f4f4f4`, border-subtle `#e4e4e4`, divider `#00000014`, primary `#2a2a2a`.

### Colours — dark

**Text**

| Role | Eden variable | HEX |
| --- | --- | --- |
| Primary text | text-dark-primary | `#d9dcd8` (editors use `#ffffff` / `#ededed`) |
| Secondary text | text-dark-secondary | `#919191` |
| Secondary icon | icon-secondary | `#c3c3c3` |
| Error text | text-dark-error | `#e5737a` |

**Surfaces and lines**

| Role | Eden variable | HEX |
| --- | --- | --- |
| Page background | background-page | `#222222` |
| Pane background | background-pane | `#212121` |
| Main background | background-main | `#212121` |
| Popover surface | surface-popover | `#222222` |
| Menu background | background-menu | `#222222` |
| Sidebar background | background-sidebar | `#1a1a1a` |
| Secondary background | background-secondary | `#2a2a2a` |
| Field background | background-field | `#2a2a2a` |
| Field hover | field-hover | `#222222` |
| Canvas surface | surface-canvas | `#1a1a1a` |
| Highlight surface | surface-highlight | `#242424` |
| Floating surface | surface-floating | `#212121` |
| Subtle border | border-subtle | `#2f2f2f` |
| Divider | divider | `#ffffff1a` |
| Neutral dark 10 | neutral-dark-10 | `#ffffff14` |

**Primary / accent (dark)**: `primary #73b490` (scale 100 `#9dd4b5` … 50 `#2e6444`); selected background `#73b49026`. Eden's dark primary button is background `#ffffff`, text `#000000` (reference only; not adopted, Harvest stays gold).

Each dark surface = `color-mix(in srgb, <base>, var(--mood-tint-dark) 5–8%)` (eden mood tint dark `#5fb07f`).

**Mono dark**: page `#000000`, pane `#0a0a0a`, sidebar `#050505`, field `#141414`, border-subtle `#242424`, divider `#ffffff17`.

### Category / badge palette (base / tint / ink)

| Name | Base | Tint | Ink |
| --- | --- | --- | --- |
| gray | `#7a7a7a` | `#e2e2e2` | `#2e2e2e` |
| amber | `#dcab6f` | `#f7eddf` | `#54412a` |
| orange | `#d17866` | `#f5e1dd` | `#4f2e27` |
| red | `#b9575e` | `#f0dadc` | `#462124` |
| pink | `#cf8fb0` | `#f4e6ee` | `#4f3643` |
| purple | `#7d6599` | `#e2dde9` | `#30263a` |
| indigo | `#6470b4` | `#dde0ef` | `#262b44` |
| blue | `#51708c` | `#d9e0e6` | `#1f2b35` |
| teal | `#5fa8a6` | `#dceceb` | `#24403f` |
| green | `#66b08b` | `#ddeee5` | `#274335` |

Text variants: red `#b9575e`, amber `#9a784e`, green `#4d8468`.

Harvest adopts these tint/ink pairs as its badge palette, renamed `category-*` (e.g. `category-green` `#66B08B` / `#DDEEE5` / `#274335`), replacing ad-hoc `c-*`/`ink-*` pairs over time.

### Typography

Families: `--font-eden` "Geist" (sans, all UI); mono "Geist Mono". Extra fonts loaded by Eden: Lora (serif, editor), Fraunces 600, Instrument Serif (+italic), Figtree (heading/wordmark), Inter Tight (wordmark), Virgil (whiteboard). Geist is OFL-licensed (Vercel), available as the `geist` npm package / `next/font`.

Type scale (Tailwind v4):

| Token | Size / line-height |
| --- | --- |
| xs | 12 / 16 |
| sm | 14 / 20 |
| base | 16 / 24 |
| lg | 18 / 28 |
| xl | 20 / 28 |
| 2xl | 24 / 32 |
| 3xl | 30 / 36 |
| 4xl | 36 / 40 |
| 5xl | 48 |

Weights: 300 / 400 / 500 / 600 / 700. `tracking-tight` `-0.035em`.

Measured styles (sign-in): H1 Geist 28px / 600 / line-height 1.25 / letter-spacing -0.7px; body 15–16px / 400; labels 12px / 500; small 12px / 300.

**Marketing (eden.so) only**: display EB Garamond 400 57.6–65.6px, lh 1.05, tracking -0.01em; h2 EB Garamond 38–54px; body Figtree 12.5–15.2px; secondary button background `rgba(17,17,17,.05)`, border 1px `rgba(17,17,17,.14)`, radius 12px, padding 10px 24px, 15.2px / 500 with layered soft shadow; email input background `#f5f4f1`, border 1px `rgba(0,0,0,.08)`, radius `9999px`, padding 8px 14px; text `#111111`, body grey `#52504c`; background `#fcfcfa`.

### Spacing

Tailwind 4px base (`--spacing: .25rem`). Most frequent on marketing: 16, 6, 4 px, then 8, 12, 20, 24, 40, 80.

### Radii

| Name | Value |
| --- | --- |
| chip | 9px |
| control | 10px |
| sm | 8px |
| md | 12px |
| lg | 18px |
| xl | 12px (`.75rem`) |
| 2xl | 16px |
| 3xl | 24px |
| full | 9999px |

Marketing: `9999px` pills dominant, then 8, 12, 10.

### Shadows

| Name | Value |
| --- | --- |
| md | `0 8px 20px #0f172a0f` |
| lg | `0 14px 32px #0f172a14` |
| popover / menu | `0 10px 24px #0f172a14, inset 0 1px #ffffff0d` |
| floating panel / dialog (light) | `0 24px 80px #0000001a, inset 0 .5px #ffffff99` |
| floating panel / dialog (dark) | `0 24px 80px #00000059, inset 0 .5px #ffffff14` |
| dark hairline ring | `inset 0 0 0 .5px #ffffff1a` / `#ffffff24` |

### Motion

Default 150ms `cubic-bezier(.4,0,.2,1)`; 300ms for panels; loader fade-in 500ms ease-out; respects `prefers-reduced-motion`.

### Breakpoints and containers

Breakpoints (Tailwind v4 defaults): sm 640 (40rem), md 768, lg 1024 (`64rem`, the shell's desktop switch), xl 1280, 2xl 1536; plus `max-width: 640` mobile rules. Marketing adds 1350, 480, 400, 359.

Containers: xs 320 … 6xl 1152 (Tailwind defaults).

## 4. Component styles

Component patterns below are measured from light-mode screenshots; dark behaviour is noted at the end.

### Shell / sidebar

- Page background is a `#f7f7f5`-ish canvas. The LEFT sidebar is a floating inset panel: 8px gutter, radius ~16–18px, sidebar surface, no hard border, soft shadow.
- Top: workspace logo + name and two small icon toggles; then a "+ New" and search icon row.
- Primary nav items: icon 16px + 13px label, 28–32px row height, radius 8–10px, active = filled chip `#ebeae7`-ish.
- Section label (12px muted), e.g. "Store"; collapsible groups with chevrons; sub-items with dot bullets indented under the parent.
- Bottom: workspace switcher row (avatar square + name + chevron) and a collapse icon.
- Optional RIGHT floating assistant pane in the same style. Content column is centred, comfortable max-width (~860–960px at 1440 wide), generous top padding.

### Page header

H1 ~24–28px semibold, tight tracking; one-line muted description (13–14px) under it; primary action button on the right (rounded-10 button, leading + icon, 32px tall, 13px / 500). Eden paints it black; Harvest paints it gold (`--action` = `--brand-color`, text `--earth` `#2D2519`).

### Buttons

Primary button (both themes): background `--action` = `--brand-color` (default wheat gold `#C9963A`), text `--action-foreground` = `--primary-foreground` = `--earth` `#2D2519`, 32px tall, radius 10px, 13px / 500. Contrast: `#2D2519` on `#C9963A` is **5.69:1** (passes AA 4.5:1). White on gold is 2.66:1 and is never used. Hover must also keep ≥4.5:1: the current light hover (`--action-hover`, gold 78% mixed toward navy-800 = `#A17C3A`) gives only **3.93:1** with `#2D2519`, so Studio uses a lighter hover, gold 90% + white 10% = `#CEA04E` (**6.30:1**), and PR1 should apply the same fix to the Harvest default. Dark mode: the button uses `--brand-color-on-dark`, hover mixes toward white (already lighter, so `#2D2519` text keeps passing). Tenant-overridden brand colours: PR1 must pick the button text per brand colour (`--earth` or white, whichever reaches ≥4.5:1, via `contrastRatio()` in `src/lib/theme.ts`) instead of assuming earth. Secondary, ghost and destructive variants follow the dialog/footer patterns below. Marketing secondary button specs are listed under Typography (marketing only).

### Inputs and search

- Search: full-width field, `background-field` fill, no border, radius 10px, 36px tall, leading magnifier, muted placeholder.
- Inputs: 32–36px tall, `background-field` fill or white with 1px `border-subtle`, radius 8–10px, 13px text, muted placeholder; suffix adornments inside (calendar icon, segmented unit toggle).

### Filter chips and segmented controls

- Chips: 28px tall, radius 9px, field fill; active = darker fill; count after the label in muted.
- Segmented control: field-fill track, active segment white with 1px shadow (e.g. "% off | $ off", "All paid products | Pick products").
- Dropdown filter buttons: text + chevron, no border ("All statuses ⌄", "Subscribed ⌄").

### Cards

White surface, 1px border ink at 10% or none + shadow-md-light, radius 12–16px. Product cards: coloured gradient cover (top 40%), small round icon disc overlapping the cover edge, title 13px / 600, meta 12px muted, footer link "Finish setup →" separated by a hairline. Grid 3 columns, 8–12px gap.

### Tables

Inside a white rounded card: header row 12px muted labels, no fill; rows 40–44px with hairline dividers; leading checkbox; status as a tinted pill badge (green tint background, green text, leading check icon, 11–12px).

### Badges

Small pills 18–20px tall, radius 6–9px, tint/ink pairs from the category palette. Draft on cover = dark translucent pill with dot; "Host" green tint; "New" blue tint.

### Dialogs

Centred, white, radius ~16px, width ~300–480px; header row with title 14–15px / 600 + close X; hairline under the header; body with label above fields (12–13px / 500) and helper text muted 12px; footer right: ghost "Cancel" + gold primary. Backdrop light dim (~black 20%), no blur.

### Menus / popovers

White surface, hairline border or popover shadow (`0 10px 24px #0f172a14, inset 0 1px #ffffff0d`). Filter menus and switcher menus use the same treatment.

### Tabs

Steppers and tab rows follow the segmented/label patterns: e.g. the editor top-right stepper "Write › Send", section tabs in the content bar.

### Empty states

Split card: left = title + short paragraph + primary button; right = illustrative preview of the feature. Use Harvest's own illustrations / live UI previews, not Eden's.

### Settings layout

Separate full-height left settings nav (Back link, "Settings" title, search, grouped sections Personal / Workspace / AI / Connections with 12px muted headers, 13px items with icons). Content is a centred narrow column (~460–520px) with grouped list cards: rows with label (13px / 500) + description (12px muted) on the left and control/value on the right, hairline separators.

### Community space

Narrow icon rail (~48px, icons with 10px labels: Chat, Forum, Events, Products, Members, Messages) + section sidebar (community name header, list with counts) + content in a rounded white card with a header bar (icon + title + subtitle count + "N here now" avatars right). Member cards: colour cover strip, avatar overlapping, name + role badge, bio 12px, social icon row.

### Editor pages

Broadcast/composer: centred document card with title/subject field, right rail of actions (Design, Check it, Templates, Duplicate, Delete in red), top-right stepper "Write › Send" + "Saved" + gold "Next →" button (Eden shows black/white).

### Dark mode notes

Same layouts; surfaces `#1a1a1a`–`#2a2a2a`; Eden flips its primary button to white; Harvest keeps it gold (`--brand-color-on-dark`, `#2D2519` text). Fields are lighter than panes in dark mode.

## 5. Layout patterns

- Floating inset shell panels (sidebar, optional assistant pane) with 8px gutters and 18px radius; content on the page canvas.
- Centred content column, ~860–960px at 1440 wide, generous top padding.
- Page header = title + one-line description left, primary action right (gold in both themes).
- List pages = search bar, filter chips / dropdown filters / segmented controls, then a table or card grid.
- Card grids: 3 columns, 8–12px gap; product cards with a coloured gradient cover strip.
- Settings = separate settings nav + narrow centred column of grouped list cards.
- Community = icon rail + section sidebar + rounded content card with a header bar.
- Editors = centred document card + right action rail + top-right stepper.
- Mobile: `max-width: 640` rules; the shell switches at `lg` (1024px).

## 6. Studio token set (mapping to Harvest theme variables)

These tables define the **Studio** theme. The "now" column is the Harvest default theme, which stays exactly as it is. The "proposed" column is the value Studio sets for the same variable. Studio declares them only inside its own scope:

- light: `:root[data-brand-theme="studio"]`
- dark: `:root[data-brand-theme="studio"][data-theme="dark"]` (and the `.dark` twin)

`data-theme` stays the light/dark mode axis; `data-brand-theme` (already stamped as `harvest` by `applyTheme`, see `src/lib/theme.ts` and `--brand-theme` in `globals.css`) is the theme axis. Components never branch on the theme name; they read the same variables. See §7 for the switch.

One open decision is called out inline and repeated after the tables.

### LIGHT — Studio scope `:root[data-brand-theme="studio"]`

| Harvest var | now | proposed | Eden source |
| --- | --- | --- | --- |
| `--surface` (page ground) | `#FAFAF8` | `#F7F7F5` | background-page |
| `--surface-raised` (cards, panels, popovers) | `#F3F2EF` | `#FFFFFF` | background-pane / surface-card — OPEN DECISION: Matei asked on 1 Nov for less white; Eden uses white cards on `#F7F7F5`. Default: follow Eden, confirm with side-by-side screenshots in PR1 |
| `--surface-sunken` (fields, toggles) | `#EFEFEF` | `#F5F5F3` | background-field |
| `--surface-tint` (inner rows) | `#F5F5F3` | `#F6F6F4` | background-secondary |
| `--surface-chip` (chips, active fills) | `#E0E0E0` | `#E8E8E4` | background-field-hover |
| `--border-default` | `#E9E9E9` | `#E9E9E9` (unchanged; = `#272523` at 10% on white) | border / divider |
| `--border-hairline` | `#EDEDED` | `#2725231A` | divider |
| `--border-subtle` | `#EFEFEF` | `#E3E3E3` (= `#8E8E8E40` on white) | border-subtle |
| `--text-strong` / `--text-heading` | `#1A1A1A` | `#272523` | text-primary |
| `--text-body` | `#404040` | `#55524E` | text-secondary |
| `--text-muted` | `#595959` | `#686764` | text-dark-secondary |
| `--text-faint` | `#696969` | `#696969` (unchanged) | Eden text-muted `#77746F` is only 4.34:1 on `#F7F7F5` (fails AA), so Harvest keeps `#696969` (5.1:1) |
| `--sidebar` | `#F3F2EF` | `#F5F4F1` | surface-sidebar |
| `--sidebar-accent` (active item) | `#E4E3E0` | `#E8E8E4` | background-field-hover |
| `--sidebar-hover` | `#E9E8E5` | `rgb(39 37 35 / 5%)` | ink 5% |
| `--sidebar-border` | `#E4E3E1` | `#2725231A` | divider |
| `--radius` (shadcn, controls) | `12px` | `10px` | radius-control |
| `--ds-radius-card` | `20px` | `16px` | radius-2xl (cards, dialogs); shell floating panels 18px (radius-lg) |
| new `--radius-chip` | — | `9px` | radius-chip |
| `--ds-sh-md` | warm brown | `0 8px 20px #0F172A0F` | shadow-md |
| `--ds-sh-lg` | warm brown | `0 14px 32px #0F172A14` | shadow-lg |
| `--ds-sh-xl` | `0 32px 80px rgba(12,21,38,.22)` | `0 24px 80px #0000001A, inset 0 .5px #FFFFFF99` | floating dialog |
| new `--shadow-popover` | — | `0 10px 24px #0F172A14, inset 0 1px #FFFFFF0D` | menus/popovers |
| `--seg-track` / `--seg-active` | `rgb(0 0 0/4.5%)` / surface-raised | `#F5F5F3` / `#FFFFFF` + `0 1px 2px rgb(0 0 0/8%)` | segmented controls |
| `--primary` / `--action` (primary button) | `var(--color-primary)` / `var(--brand-color)` gold | unchanged: `var(--brand-color)` (default `#C9963A`), gold in both themes. DECIDED 2026-11-03 (Matei) | not Eden (Eden uses black) |
| `--primary-foreground` / `--action-foreground` | `var(--earth)` `#2D2519` | unchanged: `var(--earth)` `#2D2519` (5.69:1 on `#C9963A`); per-tenant fallback to white only where earth fails | — |
| `--action-hover` | gold 78% + navy-800 = `#A17C3A` (3.93:1 with earth, fails AA) | `color-mix(in srgb, var(--brand-color) 90%, white)` = `#CEA04E` (6.30:1) | — |
| selected nav/background | — | `color-mix(in srgb, var(--brand-color) 12%, transparent)` | background-primary-selected (Eden uses its green; Harvest uses its brand colour) |
| `--brand-danger` / destructive | `#C4553B` / `rgb(162 60 40)` | destructive buttons and error text `#C0272E` (5.88:1 on white); `#E36A66` (hover `#D95D59`) only for icons, dots and tinted fills since white text on it is 3.22:1 | danger / text-dark-error |
| `--font-sans` | Inter | Geist (npm `geist`, GeistSans via `next/font`); Geist Mono for code | font-eden |
| `--font-display` / `--font-serif` | Fraunces / Newsreader | keep (Harvest brand voice for public page headings and long-form) | — |
| motion | — | 150ms `cubic-bezier(.4,0,.2,1)` default; 300ms panels | default transition |

Brand colour (`#C9963A` wheat gold, tenant-overridable `--brand-color`) is unchanged. Eden green `#66B08B` is **not** adopted.

Status/category colours: adopt the tint/ink pairs from the category palette as Harvest's badge palette (rename `category-*`, e.g. `category-green` `#66B08B` / `#DDEEE5` / `#274335`), replacing ad-hoc `c-*`/`ink-*` pairs over time.

### DARK — Studio scope `:root[data-brand-theme="studio"][data-theme="dark"]`

| Harvest var | now | proposed | Eden source |
| --- | --- | --- | --- |
| `--surface` | `#171717` | `#1A1A1A` | surface-canvas / sidebar |
| `--surface-raised` | `#202020` | `#212121` | background-pane |
| `--surface-sunken` | `#0C0C0C` | `#2A2A2A` | background-field (fields are LIGHTER than panes in dark) |
| `--surface-chip` | `#2A2A2A` | `#2A2A2A` | background-secondary |
| `--surface-tint` | `#222222` | `#242424` | surface-highlight |
| `--border-subtle` / `--border-hairline` | `#2A2A2A` | `#2F2F2F` | border-subtle |
| `--border-default` | `#363636` | `#FFFFFF1A` | divider |
| `--text-strong`/heading | `#F2F2F2` | `#EDEDED` | editor text |
| `--text-body` | `#CCCCCC` | `#D9DCD8` | text-dark-primary |
| `--text-muted` | `#ABABAB` | `#919191` | text-dark-secondary |
| `--text-faint` | `#969696` | `#969696` (unchanged) | — |
| `--sidebar` | — | `#1A1A1A` | background-sidebar |
| `--primary` / `--action` | `var(--brand-color-on-dark, var(--brand-color))` gold | unchanged, gold. DECIDED 2026-11-03 | not Eden (Eden uses white) |
| `--primary-foreground` / `--action-foreground` | `var(--earth)` `#2D2519` | unchanged `#2D2519` (gold `#C9963A` vs `#2D2519` = 5.69:1) | — |
| `--action-hover` | gold 84% + white | unchanged (lighter than gold, earth text passes) | — |

Optional later: 5% brand-colour mood tint mixed into dark surfaces (Eden mixes its accent at 5–8%).

### OPEN DECISIONS

1. **Card whiteness (Studio only)**: Studio `--surface-raised` proposed as `#FFFFFF` (Eden: white cards on `#F7F7F5`). Matei asked on 1 Nov for less white. Since Studio is opt-in and Harvest stays the default, the default is to follow Eden in Studio; confirm with side-by-side screenshots in PR1.

### DECIDED

- **2026-11-03, primary buttons**: gold (`--brand-color`) with `--earth` `#2D2519` text in both themes, admin app included. Eden's black/white button is not adopted.

## 7. How the theme switch works

1. **Two axes on `<html>`**: `data-theme` = `light` | `dark` (unchanged), `data-brand-theme` = `harvest` (default) | `studio`. `BRAND_THEMES` in `src/lib/theme.ts` grows from `['harvest']` to `['harvest', 'studio']`.
2. **CSS**: Harvest values stay on `:root` / dark as today. Studio adds one light block and one dark block (selectors in §6) that override only the variables in the tables. No component checks the theme name. Fonts: Studio sets `--font-sans` to Geist; Harvest keeps Inter. Both fonts are loaded with `next/font` (Geist only when Studio is active if the bundle cost matters).
3. **Picker**: an "Appearance" card in Admin → Branding (tenant default: Harvest / Studio, with a live preview) and, optionally, a per-user override in the member/admin profile menu next to the light/dark toggle ("Use ministry default" / Harvest / Studio).
4. **Persistence**: tenant choice saved on the tenant's branding settings (e.g. `brandTheme: 'harvest' | 'studio'`, default `harvest` when absent, so existing tenants see no change). The optional user override is stored in `localStorage` (`harvest-brand-theme`) and, if wanted across devices, on the user profile. Resolution: user override → tenant setting → `harvest`.
5. **No flash**: the server layout injects the tenant's `brandTheme` and the pre-paint script in `layout.tsx` stamps `data-brand-theme` before first paint (same pattern as `data-theme`); `applyTheme` keeps it in sync after hydration. Public tenant pages use the tenant setting only.
6. **Dark accent ground**: `deriveOnDarkAccent` / `deriveOnTintAccent` correct the tenant accent against `DARK_SURFACE` (`#171717`) / `DARK_SURFACE_RAISED` (`#202020`). Studio dark uses `#1A1A1A` / `#212121`, so those grounds become per-theme (the server derives `--brand-color-on-dark` for the active theme's ground).

## 8. Implementation notes and constraints

- **Theme-related tests that must change deliberately in PR1** (they currently pin "Harvest is the only brand theme" and "custom properties only on `:root` and `.dark`"): `src/__tests__/eden-shell-brand-theme.test.ts`, `src/__tests__/the-271-one-theme-system.test.tsx`, `src/__tests__/theming-neutral-palette.test.ts`, `src/__tests__/the-266-shadcn-batch-a.test.ts`, `src/__tests__/tailwind-v4-migration.test.ts`, and the pre-paint/storage-key pin for `layout.tsx`. `theming-shadcn-tokens.test.ts` must run its contrast matrix for all four palettes (Harvest light/dark, Studio light/dark). Harvest's own digests must stay identical, which proves the default theme did not move.
- If the tenant `brandTheme` field is written to Firestore, the rules and their tests (`firestore.rules`, rules digest register) need the field allowed; no data migration is needed because absent = `harvest`.
- `src/components/ui/__tests__/ds-primitives.test.tsx` hashes the non-comment content of `tailwind.config.ts`. Token changes that touch the config must update that expectation deliberately.
- Roughly 17 guard suites read `tailwind.config.ts`; update them as part of any token PR.
- Contrast for all foreground/background pairs is asserted in `src/__tests__/theming-shadcn-tokens.test.ts`. Keep every mapped pair passing AA — this is why `--text-faint` stays `#696969` and why `#E36A66` is restricted to icons, dots and tinted fills.
- `AdminDashboard.tsx` and nav files are checksummed by guard tests with ownership fixtures in `src/__tests__/__fixtures__/ownership/THE-NNN.json` or `#NNN.json`. Token PRs must update those checksums/fixtures deliberately.
- Tailwind v4 is used via the `tailwind.config.ts` `@config` escape hatch; keep that wiring intact.
- Geist is loaded via `next/font` (`geist` npm package, GeistSans); Geist Mono for code. `--font-display` / `--font-serif` (Fraunces / Newsreader) stay as Harvest's brand voice.
- The accent mood tint is optional: if added, mix 5% of the brand colour into dark surfaces the way Eden mixes its accent at 5–8%.
- Harvest copy and illustrations only; never ship Eden logos, illustrations, images, copy, or name.

## 9. Rebuild plan

The full PR-by-PR plan for applying this design — inventory of admin, member and public surfaces, per-PR scope (PR1 theme tokens + app shell through PR16 super-admin), owners, screenshot references, order rationale, and the per-PR working rules (pull latest `main`, never force-push, light+dark screenshots at 1440 and 390 against the mapped Eden shots, deliberate guard checksum/fixture updates, Harvest copy and illustrations only) — is in [docs/design/REBUILD-PLAN.md](./REBUILD-PLAN.md). Read it together with this document: this file defines the Studio theme and how it should look; the rebuild plan defines when and where each piece lands.
