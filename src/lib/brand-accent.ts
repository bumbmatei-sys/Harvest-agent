import { deriveOnDarkAccent, deriveOnTintAccent, DARK_SURFACE, DARK_SURFACE_RAISED } from './theme';

/**
 * Restating a tenant's accent on the client, as a SET.
 *
 * ─── Why this is its own file ────────────────────────────────────────────────
 *
 * 🔴 `theme.ts` IS BYTE-FROZEN. `the-271-one-theme-system.test.ts` and
 * `posthog-untouched.test.ts` both pin it, deliberately: it is the shared theme
 * vocabulary the server layout, the toggle and the tests all read, and a freeze
 * is how it stays that. This module COMPOSES those exports rather than being
 * appended to them, so the vocabulary is unchanged and the two pins still hold.
 *
 * ─── The desync this exists to make impossible ───────────────────────────────
 *
 * 🔴 `layout.tsx` stamps all THREE properties together, server-side, derived
 * from one hex: `--brand-color` raw, `--brand-color-on-dark` corrected against
 * the page ground and `--brand-color-on-tint` corrected one layer up. They are
 * only ever correct AS A SET — each derived value is a statement about the raw
 * one beside it.
 *
 * ⚠️ Two client paths used to set `--brand-color` ALONE, with
 * `documentElement.style.setProperty`. That is an INLINE style on <html>, so it
 * beats the server's `:root{}` block on specificity and the raw accent moves —
 * while the two DERIVED properties keep the value the server computed from the
 * PREVIOUS hex. On the dark theme every on-dark consumer then paints an accent
 * corrected against a colour that is no longer on screen.
 *
 *   · `TenantContext.applyBranding` — a real, if brief, disagreement on load:
 *     the server renders the platform default, the tenant read lands, and the
 *     raw accent changes under two derived values that do not.
 *   · `BrandingSection.handleColorChange` — the live colour picker, where the
 *     disagreement is NOT brief. It persists for as long as the admin is on the
 *     screen, which is exactly when they are judging the colour they picked.
 *
 * 🔵 Deriving on the client rather than re-fetching is deliberate: these are the
 * same two pure functions `layout.tsx` calls, on the same two ground constants,
 * so the client reaches the value the server would have sent for that hex. The
 * set of properties written here is pinned against `layout.tsx`'s own stamp by
 * THE-111's guard, so the two cannot drift — and `layout.tsx` is READ to derive
 * that, never written.
 */
export const BRAND_ACCENT_PROPERTIES = [
  '--brand-color',
  '--brand-color-on-dark',
  '--brand-color-on-tint',
] as const;

/**
 * Restate a tenant's accent on `el` — all three properties, or none.
 *
 * 🔴 A hex this cannot parse writes NOTHING. `deriveOnDarkAccent` never refuses
 * a well-formed hex, and for anything else it returns its input unchanged — so
 * writing on a malformed value would stamp the raw string into all three and
 * silently replace a correct derived accent with a broken one. Refusing leaves
 * the server's consistent set standing, which is the safe state.
 */
export function applyBrandAccent(el: HTMLElement | null | undefined, hex: string): boolean {
  if (!el || !/^#[0-9a-fA-F]{6}$/.test(hex)) return false;
  el.style.setProperty('--brand-color', hex);
  el.style.setProperty('--brand-color-on-dark', deriveOnDarkAccent(hex, DARK_SURFACE));
  el.style.setProperty('--brand-color-on-tint', deriveOnTintAccent(hex, DARK_SURFACE_RAISED));
  return true;
}
