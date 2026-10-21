/**
 * Desktop Settings popup navigation.
 *
 * Labels use "Campus", never "Church". Order is the product order: Profile,
 * Campus & branding, Plan & billing, Campus setup, Danger zone.
 *
 * Deep links (`?section=`, hash, Stripe/Dodo return query params) map onto
 * these ids so a billing-portal return opens Plan & billing rather than
 * Profile.
 */

export const SETTINGS_NAV = [
  { id: 'profile', label: 'Profile' },
  { id: 'campus', label: 'Campus & branding' },
  { id: 'billing', label: 'Plan & billing' },
  { id: 'setup', label: 'Campus setup' },
  { id: 'danger', label: 'Danger zone' },
] as const;

export type SettingsNavId = (typeof SETTINGS_NAV)[number]['id'];

const NAV_IDS = new Set<string>(SETTINGS_NAV.map((item) => item.id));

const ALIASES: Record<string, SettingsNavId> = {
  profile: 'profile',
  account: 'profile',
  me: 'profile',
  campus: 'campus',
  branding: 'campus',
  appearance: 'campus',
  theme: 'campus',
  billing: 'billing',
  plan: 'billing',
  plans: 'billing',
  upgrade: 'billing',
  subscription: 'billing',
  setup: 'setup',
  onboarding: 'setup',
  giving: 'setup',
  'giving-statements': 'setup',
  statements: 'setup',
  danger: 'danger',
  cancel: 'danger',
  'cancel-plan': 'danger',
};

function aliasOf(raw: string): SettingsNavId | null {
  const key = raw.trim().toLowerCase().replace(/^#/, '');
  if (!key) return null;
  if (NAV_IDS.has(key)) return key as SettingsNavId;
  return ALIASES[key] ?? null;
}

/**
 * Which popup section a landing URL should open.
 *
 * Stripe/Dodo returns (`stripe=`, `addon=`) open Plan & billing. A Connect
 * return still names Payments in the mobile accordion; on desktop that row is
 * hidden, so the same URL opens Campus setup rather than a missing pane.
 */
export function settingsSectionFromLocation(
  search: string = typeof window === 'undefined' ? '' : window.location.search,
  hash: string = typeof window === 'undefined' ? '' : window.location.hash,
): SettingsNavId {
  const params = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search);
  if (params.get('stripe') || params.get('addon')) return 'billing';
  if (params.get('stripe_connect')) return 'setup';
  const fromQuery = aliasOf(params.get('section') || '');
  if (fromQuery) return fromQuery;
  const fromHash = aliasOf(hash);
  if (fromHash) return fromHash;
  return 'profile';
}
