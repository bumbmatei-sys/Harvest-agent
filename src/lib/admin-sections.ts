/**
 * THE-227 — the admin section vocabulary, named once.
 *
 * ─── Why this file exists ────────────────────────────────────────────────────
 *
 * Two things needed the same list and did not have it:
 *
 *   • `AdminDashboard` turns a tab id into a URL segment and back again
 *     (`go()` → `/admin/<slug>`, `useParams().section` → `activeTab`). It held
 *     the two halves of that mapping as a pair of one-entry object literals
 *     that had to be kept mirror images of each other by hand.
 *   • `routes.ts` needs to know which `/admin/<segment>` values are FEATURE
 *     NAMES rather than identifiers, so PostHog can tell CRM from Accounting
 *     instead of filing every admin screen under one `/admin/[section]` bucket.
 *
 * ⚠️ THE SECOND READER IS WHY THIS IS A CLOSED TABLE AND NOT A HELPER. A list
 * that a section can be added to without anyone noticing is a list that will
 * eventually contain whatever segment nobody thought of. `admin-sections.test.ts`
 * asserts this table against the nav definition in `AdminDashboard.tsx` in BOTH
 * directions, so a new tab there with no row here fails, and a row here that no
 * screen serves fails too.
 *
 * ─── 🔴 What may be in here, and what may never be ───────────────────────────
 *
 * Every value below is a COMPILE-TIME LITERAL that names a FEATURE. `crm`,
 * `accounting`, `newsletter` — the same category of word as the
 * `app_surface: 'admin'` this app already sends, and a vocabulary the app
 * itself defines rather than one a user or a document supplies.
 *
 * 🔴 Nothing user-chosen and nothing tenant-specific may ever be added: not a
 * church's slug, not a document id, not a name somebody typed. Those live in
 * the `[itemId]` position (`/admin/crm/<contactId>`, `/admin/docs/<docId>`),
 * which `routes.ts` keeps as a parameter and never sends. Adding an identifier
 * here would be the one edit that turns an enumerated feature name back into a
 * live path segment.
 *
 * ─── Purity ──────────────────────────────────────────────────────────────────
 *
 * 🔴 This module imports NOTHING, and must not start to. `routes.ts` reads it,
 * `routes.ts` is imported by `/blog/[id]` — the most performance-sensitive page
 * in the product — and an import added here is an import added there.
 */

/**
 * Every admin section, as `[tab id, URL slug]`.
 *
 * The two spellings are written out even where they are identical. `ai` is the
 * only pair that actually differs today (`/admin/ai-knowledge`), and a table
 * that listed only the exceptions could not give the analytics union its
 * literal slug types — see `AdminSectionSlug` below.
 *
 * Order mirrors the nav: `allTabs` in `AdminDashboard.tsx`, then the two fixed
 * rows appended after it (Inbox, Settings), then the two sections that are
 * reachable without a nav entry.
 */
const ADMIN_SECTION_TABLE = [
  /* ── `allTabs`, in nav order ─────────────────────────────────────────────── */
  // ⚠️ `dashboard` is the admin home and `go()` sends it to `/admin`, not to
  // `/admin/dashboard`. It is listed because it IS a nav entry and a typed URL
  // reaches it (the redirect guard treats it as known), so leaving it out would
  // make the drift test's "every nav id has a row" direction a lie.
  ['dashboard', 'dashboard'],
  ['churches', 'churches'],
  ['courses', 'courses'],
  ['blog', 'blog'],
  ['ai', 'ai-knowledge'],
  ['newsletter', 'newsletter'],
  ['fundraising', 'fundraising'],
  ['donations', 'donations'],
  ['events', 'events'],
  ['docs', 'docs'],
  ['crm', 'crm'],
  ['signups', 'signups'],
  ['accounting', 'accounting'],
  ['forms', 'forms'],
  ['checkin', 'checkin'],
  ['livestream', 'livestream'],
  ['sms', 'sms'],
  ['community', 'community'],
  ['library', 'library'],
  ['tenants', 'tenants'],
  ['affiliate', 'affiliate'],
  ['branding', 'branding'],

  /* ── appended to the nav outside `allTabs` ───────────────────────────────── */
  // Platform-only (super admin on the apex domain) and permission-gated
  // respectively, but both are ordinary nav rows where they appear.
  ['inbox', 'inbox'],
  ['settings', 'settings'],

  /* ── reachable, but never a nav row ──────────────────────────────────────── */
  // Opened from inside another screen (Notes opens a canvas) and from the
  // upgrade prompts. Both are in the dashboard's `known` set — i.e. neither
  // redirects away — so both are real sections a session can sit on, and the
  // billing funnel in particular is a question this instrumentation is for.
  // ⚠️ The canvas's own id is component state, not a URL segment; `/admin/canvas`
  // carries nothing after it.
  ['canvas', 'canvas'],
  ['upgrade', 'upgrade'],
] as const satisfies readonly (readonly [string, string])[];

/** An admin tab id, as `AdminDashboard` spells it internally. */
export type AdminSectionTab = (typeof ADMIN_SECTION_TABLE)[number][0];

/**
 * An admin section as it appears in the URL.
 *
 * 🔴 A literal union, read from the `as const` table above rather than from any
 * annotated export — the same discipline `AnalyticsRoutePattern` follows in
 * `routes.ts`, and for the same reason: widened to `string` this type would let
 * any segment at all be treated as a known section.
 */
export type AdminSectionSlug = (typeof ADMIN_SECTION_TABLE)[number][1];

/** Every section slug, in nav order. The closed set, and nothing else. */
export const ADMIN_SECTION_SLUGS: readonly AdminSectionSlug[] = Object.freeze(
  ADMIN_SECTION_TABLE.map(([, slug]) => slug),
);

/** Every tab id, in nav order. */
export const ADMIN_SECTION_TABS: readonly AdminSectionTab[] = Object.freeze(
  ADMIN_SECTION_TABLE.map(([tab]) => tab),
);

/**
 * A lookup with NO prototype.
 *
 * ⚠️ Deliberate: these maps are read with a segment straight out of the address
 * bar, and `{}['constructor']` is truthy. A plain object literal would answer
 * `/admin/constructor` with a function.
 */
function lookup(pairs: readonly (readonly [string, string])[]): Readonly<Record<string, string>> {
  const map: Record<string, string> = Object.create(null);
  for (const [key, value] of pairs) map[key] = value;
  return Object.freeze(map);
}

/** URL slug → tab id. `'ai-knowledge'` → `'ai'`. */
export const SLUG_TO_TAB = lookup(ADMIN_SECTION_TABLE.map(([tab, slug]) => [slug, tab]));

/** Tab id → URL slug. `'ai'` → `'ai-knowledge'`. */
export const TAB_TO_SLUG = lookup(ADMIN_SECTION_TABLE);

/** True when a URL segment names a section this app defines. */
export function isAdminSectionSlug(segment: string): segment is AdminSectionSlug {
  return segment in SLUG_TO_TAB;
}
