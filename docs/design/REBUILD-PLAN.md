# The Harvest — Rebuild Plan (Phase 2)

Phase 2 adds **Studio**, a second selectable theme built from the visual language in `docs/design/DESIGN.md`, and then makes every page look right in both themes, one PR at a time. The current Harvest look stays the default theme and must not regress. "Studio" is a placeholder name; nothing user-facing mentions Eden. Matei approves each PR before the next coding run begins. Nothing merges or deploys without Matei.

## Per-PR rules (apply to every PR)

- Pull latest `main` before starting. Never force-push.
- Harvest copy and Harvest illustrations only. No Eden logos, images, illustrations, or text.
- Light **and** dark screenshots at 1440 and 390, placed next to the mapped Eden screenshots.
- Guard checksum/fixture updates are called out explicitly in the PR body.
- Contrast test must be green (`src/__tests__/theming-shadcn-tokens.test.ts`) for all four palettes: Harvest light/dark and Studio light/dark.
- Screenshots in both themes: Harvest (default, must match `main`) and Studio (next to the mapped Eden shots).
- Primary buttons are gold (`--brand-color`, `--earth` `#2D2519` text, 5.69:1) in both themes. Decided by Matei 2026-11-03.
- Layout changes: purely visual differences go through theme-scoped CSS variables (for example `--shell-inset`, `--shell-radius`, `--sidebar-item-height`), never through components branching on the theme name. Structural changes (moved elements, new panes) must either work in both themes and be approved for Harvest too, or be gated by a theme-scoped variable/attribute so Harvest is unchanged.

## PR summary

| PR | Scope | Harvest files / sections | Size |
|----|-------|--------------------------|------|
| PR1 | Theme infrastructure + Studio token set + theme picker | `src/lib/theme.ts`, `src/app/layout.tsx`, `src/app/globals.css`, `AdminBranding.tsx`, theme toggle/menu | L |
| PR2 | App shell + shared primitives working in both themes | `src/components/admin-shell/*`, `src/components/layout/*`, `src/components/ui` | L |
| PR3 | Dashboard home | `AdminHome`, `AdminDashboardHome`, `home-kpis`, `BoardsSection` | M |
| PR4 | People / CRM | `AdminCRM`, `AdminSignups`, `AdminRoles`, member detail | M |
| PR5 | Communities | `AdminCommunity`, community-setup editor, member community space | L |
| PR6 | Products, courses, storefront, blog | `product-wizard`, `AdminCourses`, `CourseEditor`, digital-products, storefront editor, `AdminBlog` | L |
| PR7 | Newsletter / email | `NewsletterCampaigns`, `NewsletterEditor`, email themes, subscribe settings | M |
| PR8 | Events, calendar, check-in, livestream | `AdminEvents`, `AdminCheckin`, `AdminLivestream`, `PublicCalendar` | M |
| PR9 | Forms, sign-up pages, services/rota | `AdminForms`, signup-pages, `AdminServices` | M |
| PR10 | Giving | `AdminFundraising`, `AdminDonations`, `AdminAccounting`, `AdminGivingStatements`, campaigns | M |
| PR11 | Social scheduler | social | S/M |
| PR12 | Notes, boards, inbox, AI chat | `AdminDocs`, boards, `AIChat`, `PlatformInbox` | M |
| PR13 | Settings, branding, roles, billing, nav customizer, affiliate, integrations | settings, branding, roles, billing, nav customizer, affiliate, integrations | M |
| PR14 | Member app | `MainApp` desktop + mobile | L |
| PR15 | Public tenant pages + auth | `src/app` public routes, `AuthPage.tsx` | L |
| PR16 | Super-admin | tenants, campuses, library, platform inbox | S |

Order rationale: theme infrastructure and tokens first, then shell and primitives, so later page PRs are mostly layout; high-traffic admin pages next; member and public pages after; super-admin last. Each S/M page PR is ~0.5–1 coding run; each L PR is ~2 runs.

---

## PR1 — Theme infrastructure + Studio token set + picker (L)

Scope:
- Second theme axis: `BRAND_THEMES` in `src/lib/theme.ts` becomes `['harvest', 'studio']`; `applyTheme` stamps `data-brand-theme`; `data-theme` stays light/dark.
- Studio token set in `src/app/globals.css`: one light block `:root[data-brand-theme="studio"]` and one dark block `:root[data-brand-theme="studio"][data-theme="dark"]` (plus the `.dark` twin), overriding only the variables in the DESIGN.md §6 tables (surfaces, borders, text, sidebar, radii, shadows, motion, `category-*` badge palette, `--font-sans` = Geist). Harvest `:root` / dark values stay byte-identical.
- Gold primary in both themes: `--primary` / `--action` = `--brand-color`, text `--earth` `#2D2519` (5.69:1 on `#C9963A`). Fix the hover: light `--action-hover` today is `#A17C3A` (3.93:1 with earth, fails AA); use `color-mix(in srgb, var(--brand-color) 90%, white)` = `#CEA04E` (6.30:1) in Studio and, with Matei's OK, in Harvest too. For tenant brand colours, pick earth or white per colour via `contrastRatio()`, whichever reaches 4.5:1.
- Per-theme dark grounds for `deriveOnDarkAccent` / `deriveOnTintAccent` (Harvest `#171717` / `#202020`, Studio `#1A1A1A` / `#212121`).
- Picker: "Appearance" card in Admin → Branding (tenant default Harvest / Studio, live preview). Optional per-user override in the profile/account menu next to light/dark ("Use ministry default" / Harvest / Studio).
- Persistence: tenant `brandTheme` on branding settings (absent = `harvest`, so no migration); user override in `localStorage` `harvest-brand-theme` (optionally on the profile). Resolution: user → tenant → `harvest`.
- No flash: server layout injects the tenant's `brandTheme`; the pre-paint script in `layout.tsx` stamps `data-brand-theme` before paint. Public tenant pages follow the tenant setting only.
- Tests/checksums: update deliberately and list in the PR body: `eden-shell-brand-theme.test.ts` (pins "Harvest is the only brand theme" and no third custom-property scope), `the-271-one-theme-system.test.tsx`, `theming-neutral-palette.test.ts`, `the-266-shadcn-batch-a.test.ts`, `tailwind-v4-migration.test.ts`, the storage-key/pre-paint pin for `layout.tsx`, `ds-primitives.test.tsx` (if `tailwind.config.ts` changes), `AdminBranding`/`AdminDashboard` ownership fixtures (`THE-NNN.json` / `#NNN.json`), and Firestore rules + rules digest if the `brandTheme` field needs allowing. Extend `theming-shadcn-tokens.test.ts` to all four palettes.
- No layout changes in this PR: pages look the same in both themes apart from tokens.

Harvest files: `src/lib/theme.ts`, `src/app/layout.tsx`, `src/app/globals.css`, `src/components/AdminBranding.tsx`, `src/components/ThemeToggle.tsx`, `src/components/admin-shell/use-shell-theme.ts`, `src/components/MyAccountMenu.tsx`, tests listed above.

Eden screenshot references (token check only):
- eden-archive/00-map/01-home
- eden-archive/00-map/59-settings-preferences
- eden-archive/00-map/71-settings-personalization
- reference-shots/eden-2026-10-17/light-02-sidebar
- reference-shots/eden-2026-10-17/dark-02-sidebar

Acceptance checks:
- [ ] Default theme is Harvest for every existing tenant and user; Harvest screenshots match `main` and Harvest CSS digests are unchanged.
- [ ] Switching to Studio in Branding changes tokens app-wide with no flash on reload, light and dark.
- [ ] Optional user override works and "Use ministry default" falls back to the tenant setting.
- [ ] Primary buttons are gold with `#2D2519` text in both themes; button text and hover pass 4.5:1 (contrast test covers all four palettes).
- [ ] The user-facing theme name does not mention Eden.
- [ ] Studio card whiteness confirmed with side-by-side screenshots (open decision from 1 Nov).
- [ ] Guard checksum/fixture updates listed in the PR body.

## PR2 — App shell + shared primitives in both themes (L)

Scope:
- App shell (moved here from the old PR1): `AdminDesktopSidebar` floating inset panel, nav rows, 12px section labels, collapsible groups with dot sub-items, workspace switcher row, mobile sheet, `PageHeader` (title, one-line description, gold primary action). Inset, radius and row heights come from theme-scoped variables, so Harvest keeps its current shell unless Matei approves the change for both.
- `Button` variants (primary/secondary/ghost/destructive, 32px), `Input`/`Select`/`Textarea`, search field, filter chip, `SegmentedTabs`, `Dialog`/`Sheet`, `DropdownMenu`/`Popover`, `Badge`, `Table` (`data-table`), `EmptyState` split card, `Toast`.
- Patterns per `docs/design/DESIGN.md` component patterns (search field 36px radius 10px, chips 28px radius 9px, dialogs 300–480px radius 16px, empty state split card with Harvest illustration or live UI preview).

Harvest files: `src/components/ui` (Button, Input, Select, Textarea, search field, filter chip, SegmentedTabs, Dialog, Sheet, DropdownMenu, Popover, Badge, Table/data-table, EmptyState, Toast), `src/components/ui/__tests__/ds-primitives.test.tsx`, `tailwind.config.ts`.

Eden screenshot references:
- eden-archive/02-store/11-coupons-new-dialog
- eden-archive/02-store/13-promotions-new-sale-dialog
- eden-archive/02-store/18-customers-add-one-dialog
- eden-archive/02-store/19-customers-import-list-dialog
- eden-archive/02-store/20-subscribers-import-contacts-dialog
- eden-archive/02-store/04-coupons-empty
- eden-archive/02-store/12-promotions-empty
- eden-archive/02-store/15-subscribers-list
- eden-archive/02-store/10-products-community-click-plan-limit-toast
- eden-archive/01-create/26-publish-schedule-switcher-menu
- eden-archive/01-create/05-library-filter-menu

Additional Eden screenshot references (shell):
- eden-archive/00-map/22-sidebar-new-menu
- eden-archive/00-map/23-sidebar-chats-more-expanded
- eden-archive/00-map/57-workspace-menu
- eden-archive/00-map/80-workspace-menu-apps-extras
- eden-archive/mobile/01-home

Acceptance checks:
- [ ] Shell and every primitive render per the DESIGN.md spec in Studio at 1440 and 390, light and dark.
- [ ] Harvest (default) shell and primitives unchanged or changed only where Matei approved, with before/after screenshots.
- [ ] No component branches on the theme name; differences come from theme-scoped variables.
- [ ] Primary buttons gold (`--brand-color`, `#2D2519` text) in both themes; destructive uses `#C0272E`.
- [ ] Empty states use Harvest illustrations or live UI previews only.
- [ ] Guard checksum/fixture updates listed in the PR body.
- [ ] Contrast test green for all four palettes.

## PR3 — Dashboard home (M)

Scope: Rebuild `AdminHome` / `AdminDashboardHome`, `home-kpis`, `BoardsSection` to the Studio shell and card patterns, working in both themes.

Harvest files: `src/components/admin-shell/AdminHome`, `AdminDashboardHome`, `home-kpis`, `src/components/admin-shell/BoardsSection`, `src/components/AdminDashboard.tsx`.

Eden screenshot references:
- eden-archive/00-map/01-home
- eden-archive/00-map/24-store-home
- eden-archive/02-store/01-home
- eden-archive/02-store/05-home-bottom
- eden-archive/01-create/01-03
- docs/design/eden/07
- docs/design/eden/08

Acceptance checks:
- [ ] KPI/stat cards, boards, and header follow the mapped Eden layouts at 1440 and 390, light and dark.
- [ ] Guard checksum/fixture updates listed in the PR body.
- [ ] Contrast test green.

## PR4 — People / CRM (M)

Scope: Rebuild `AdminCRM`, `AdminSignups` list, `AdminRoles`, and member detail to the list/table/detail patterns.

Harvest files: `src/components/AdminCRM.tsx`, `AdminSignups`, `AdminRoles`, member detail.

Eden screenshot references:
- eden-archive/00-map/32-34
- eden-archive/02-store/14-21
- eden-archive/03-community/33-37

Acceptance checks:
- [ ] Lists and tables use the white rounded card, 12px muted headers, 40–44px rows, tinted status pills at 1440 and 390, light and dark.
- [ ] Harvest copy only.
- [ ] Guard checksum/fixture updates listed in the PR body.
- [ ] Contrast test green.

## PR5 — Communities (L)

Scope:
- `AdminCommunity` and the community-setup editor.
- Member community space: narrow icon rail (~48px, 10px labels), section sidebar with counts, content card with header bar (icon + title + count + "N here now" avatars), member cards with cover strip, overlapping avatar, role badge, bio, social icon row.
- Chat, forum, events, members, messages.

Harvest files: `src/components/AdminCommunity.tsx`, community-setup editor, member community space components.

Eden screenshot references:
- eden-archive/03-community/ (all 93)
- docs/design/eden/01-28
- eden-archive/00-map/26-store-communities

Acceptance checks:
- [ ] Rail + section sidebar + content card layout matches at 1440 and 390, light and dark.
- [ ] Harvest community copy, names, and illustrations only.
- [ ] Guard checksum/fixture updates listed in the PR body.
- [ ] Contrast test green.

## PR6 — Products, courses, storefront, blog (L)

Scope:
- Products list + type picker, `product-wizard`, `AdminCourses`/`CourseEditor`, course player, digital-products, storefront editor, `AdminBlog`.
- May split into PR6a (products + courses) and PR6b (storefront + blog).

Harvest files: Products list, `product-wizard`, `src/components/AdminCourses.tsx`, `CourseEditor`, course player, digital-products, storefront editor, `src/components/AdminBlog.tsx`.

Eden screenshot references:
- eden-archive/00-map/28-31
- eden-archive/00-map/56
- eden-archive/02-store/02, 03, 06-09, 72-121
- reference-shots/eden-courses-2026-10-20/
- eden-ref/20-27

Acceptance checks:
- [ ] Product cards (gradient cover top 40%, icon disc, 13px/600 title, 12px meta, "Finish setup →" footer) match the pattern at 1440 and 390, light and dark.
- [ ] Course player and editor layouts match.
- [ ] Guard checksum/fixture updates listed in the PR body.
- [ ] Contrast test green.

## PR7 — Newsletter / email (M)

Scope: `NewsletterCampaigns`, `NewsletterEditor` (centered document card, right action rail, "Write › Send" stepper, "Saved", "Next →"), email themes, subscribe settings.

Harvest files: `src/components/NewsletterCampaigns.tsx`, `NewsletterEditor.tsx`, email themes, subscribe settings.

Eden screenshot references:
- eden-archive/00-map/38-45
- eden-archive/02-store/27-43
- reference-shots/eden-email-2026-10-20/
- website-ref/eden-email-themes/
- eden-ref/40-41

Acceptance checks:
- [ ] Editor, campaign list, and theme picker match at 1440 and 390, light and dark.
- [ ] Harvest email copy and themes only.
- [ ] Guard checksum/fixture updates listed in the PR body.
- [ ] Contrast test green.

## PR8 — Events, calendar, check-in, livestream (M)

Scope: `AdminEvents`, `AdminCheckin`, `AdminLivestream`, `PublicCalendar`.

Harvest files: `src/components/AdminEvents.tsx`, `AdminCheckin.tsx`, `AdminLivestream.tsx`, `PublicCalendar`.

Eden screenshot references:
- eden-archive/02-store/50
- eden-archive/02-store/58-67
- eden-archive/02-store/122-127
- eden-archive/00-map/52-53
- eden-archive/03-community/26-31

Acceptance checks:
- [ ] Event lists, calendar, check-in, and livestream screens match at 1440 and 390, light and dark.
- [ ] Guard checksum/fixture updates listed in the PR body.
- [ ] Contrast test green.

## PR9 — Forms, sign-up pages, services/rota (M)

Scope: `AdminForms`, signup-pages, `AdminServices`.

Harvest files: `src/components/AdminForms.tsx`, signup-pages, `src/components/AdminServices.tsx`.

Eden screenshot references:
- eden-archive/02-store/37-40
- eden-archive/02-store/47
- eden-archive/02-store/51
- eden-archive/02-store/54-57
- eden-archive/00-map/44
- eden-archive/00-map/49
- eden-ref/60-marketing-forms

Acceptance checks:
- [ ] Form builder, sign-up pages, and rota screens match at 1440 and 390, light and dark.
- [ ] Guard checksum/fixture updates listed in the PR body.
- [ ] Contrast test green.

## PR10 — Giving (M)

Scope: `AdminFundraising`, `AdminDonations`, `AdminAccounting`, `AdminGivingStatements`, campaigns. No direct Eden equivalent — apply the list/table/stat-card/empty-state patterns.

Harvest files: `src/components/AdminFundraising.tsx`, `AdminDonations.tsx`, `AdminAccounting.tsx`, `AdminGivingStatements.tsx`, campaigns.

Eden screenshot references (patterns only):
- eden-archive/02-store/01-home (stats)
- eden-archive/02-store/12-13 promotions
- eden-archive/02-store/14 customers
- eden-archive/00-map/70-settings-billing

Acceptance checks:
- [ ] Stat cards, tables, and empty states follow the shared patterns at 1440 and 390, light and dark.
- [ ] Harvest giving copy only.
- [ ] Guard checksum/fixture updates listed in the PR body.
- [ ] Contrast test green.

## PR11 — Social scheduler (S/M)

Scope: Social scheduler screens; already largely matched in phase 2, so this is a consistency pass.

Harvest files: social.

Eden screenshot references:
- eden-archive/01-create/19-34
- reference-shots/eden-2026-10-17/
- eden-archive/mobile/06-09

Acceptance checks:
- [ ] Screens are consistent with the new tokens/primitives at 1440 and 390, light and dark.
- [ ] Guard checksum/fixture updates listed in the PR body.
- [ ] Contrast test green.

## PR12 — Notes, boards, inbox, AI chat (M)

Scope: `AdminDocs` (Notes), boards, `AIChat`, `PlatformInbox`.

Harvest files: `src/components/AdminDocs.tsx`, boards, `AIChat`, `PlatformInbox`.

Eden screenshot references:
- eden-archive/01-create/04-17
- eden-archive/01-create/35-44
- reference-shots/eden-notes-2026-10-20/
- eden-archive/00-map/35-37

Acceptance checks:
- [ ] Notes, boards, inbox, and AI chat screens match at 1440 and 390, light and dark.
- [ ] Guard checksum/fixture updates listed in the PR body.
- [ ] Contrast test green.

## PR13 — Settings, branding, roles, billing, nav customizer, affiliate, integrations (M)

Scope: Settings (full-height left settings nav with Back link, "Settings" title, search, grouped sections with 12px muted headers; content column ~460–520px with grouped list cards), branding, roles, billing, nav customizer, affiliate, integrations.

Harvest files: settings, branding, roles, billing, nav customizer, affiliate, integrations.

Eden screenshot references:
- eden-archive/00-map/57-78
- eden-archive/02-store/68-71

Acceptance checks:
- [ ] Settings nav and grouped list cards match at 1440 and 390, light and dark.
- [ ] Tenant-overridable `--brand-color` behaviour preserved in branding.
- [ ] Guard checksum/fixture updates listed in the PR body.
- [ ] Contrast test green.

## PR14 — Member app (L)

Scope: `MainApp` desktop and mobile — home, feed, courses, events, messages, prayer, profile, discover, give.

Harvest files: `MainApp` and member app tabs (home, news/feed, courses, events, messages, prayer, bible, map, products, partner/give, livestream, profile, desktop-discover, desktop-communities).

Eden screenshot references:
- eden-archive/00-map/25-your-access
- eden-archive/00-map/27-store-explore
- eden-archive/03-community/96-99b
- eden-ref/03-discover
- eden-archive/mobile/
- docs/design/eden/09
- docs/design/eden/11

Acceptance checks:
- [ ] Desktop and mobile member tabs match at 1440 and 390, light and dark.
- [ ] Harvest member copy and illustrations only.
- [ ] Guard checksum/fixture updates listed in the PR body.
- [ ] Contrast test green.

## PR15 — Public tenant pages + auth (L)

Scope: storefront, `storefront/blog`, `s/[handle]` link-in-bio, `blog/[id]`, `courses/[id]`, `event/[eventId]`, `form/[formId]`, `giving`, `pledge/[campaignId]`, `campaign/[campaignId]`, `subscribe`, `checkin/[sessionId]`, `rota/[token]`, `n/[token]`, `post/[postId]`, `calendar`, `discover`, `p`, and `AuthPage.tsx`. Tenant brand colour drives CTAs on public pages. Marketing display type applies here (see DESIGN.md marketing section).

Harvest files: `src/app/storefront`, `src/app/storefront/blog`, `src/app/s/[handle]`, `src/app/blog/[id]`, `src/app/courses/[id]`, `src/app/event/[eventId]`, `src/app/form/[formId]`, `src/app/giving`, `src/app/pledge/[campaignId]`, `src/app/campaign/[campaignId]`, `src/app/subscribe`, `src/app/checkin/[sessionId]`, `src/app/rota/[token]`, `src/app/n/[token]`, `src/app/post/[postId]`, `src/app/calendar`, `src/app/discover`, `src/app/p`, `AuthPage.tsx`.

Eden screenshot references:
- eden-archive/02-store/02
- eden-archive/02-store/06
- eden-archive/02-store/116-121
- eden-ref/11-storefront
- eden-ref/12-13 link-in-bio
- reference-shots/eden-courses-2026-10-20/*-02-landing
- app sign-in screenshot (Dembrandt run) for `AuthPage` layout

Acceptance checks:
- [ ] Public pages and auth match at 1440 and 390, light and dark.
- [ ] Tenant `--brand-color` drives CTAs; public pages are white-label.
- [ ] Harvest copy and illustrations only.
- [ ] Guard checksum/fixture updates listed in the PR body.
- [ ] Contrast test green.

## PR16 — Super-admin (S)

Scope: tenants, campuses, library, platform inbox. Inherits tokens and primitives from PR1–PR2; last.

Harvest files: library/tenants (super admin), campuses, platform inbox.

Eden screenshot references:
- eden-archive/00-map/57-78
- eden-archive/02-store/68-71

Acceptance checks:
- [ ] Super-admin screens consistent with the shared primitives at 1440 and 390, light and dark.
- [ ] Guard checksum/fixture updates listed in the PR body.
- [ ] Contrast test green.

---

## Page inventory

**Admin sections** (`src/components/AdminDashboard.tsx` `allTabs`): dashboard, churches (Campus), courses, products, blog, storefront, ai (hidden), newsletter, fundraising, donations, events, services, docs (Notes), crm, signups, accounting (Giving records), forms, signup-pages, checkin, livestream, social, sms (hidden), community, community-setup (Communities), library/tenants (super admin), affiliate, branding, inbox (platform), settings.

**Shell**: `src/components/admin-shell/*` (AdminDesktopSidebar, AdminHome, PageHeader, SegmentedTabs, data-table, AdminContentBar, BoardsSection), `src/components/layout/*` (nav-rail, nav-groups, DesktopLayout).

**Member app `MainApp` tabs**: home, news/feed, courses, events, messages, prayer, bible, map, products, partner/give, livestream, profile, desktop-discover, desktop-communities.

**Public routes** (`src/app`): storefront, storefront/blog, s/[handle], blog/[id], courses/[id], event/[eventId], form/[formId], giving, pledge/[campaignId], campaign/[campaignId], subscribe, checkin/[sessionId], rota/[token], n/[token], post/[postId], calendar, discover, p. Auth: `AuthPage.tsx`.

## Note on screenshot paths

Eden screenshot paths referenced in this plan live on the shared box (relative to `/workspace`: `eden-archive/`, `reference-shots/`, `eden-ref/`, `website-ref/`), not in the repo — except the 28 shots under `docs/design/eden/`.

Coding runs on the box can open these paths directly. A Claude Code session on another machine cannot, so attach the listed shots (or copy the folders over) when running a PR from there.
