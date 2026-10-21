/**
 * Settings popup hide-not-delete switch.
 *
 * ONE VALUE. Setting `SETTINGS_LEGACY_SECTIONS_ENABLED` to `true` restores the
 * three Settings rows this ticket hid — SMS, Integrations (the connected
 * mail and social providers), and Donations & payment links (Stripe Connect) — on both
 * the desktop popup and the mobile Settings page. Nothing behind the switch was
 * deleted: the rows, their panels, and their existing plan / master-switch
 * gates stay in `AdminSettings`. Flip this, and those gates are what decide
 * visibility again.
 *
 * ⚠️ THIS FILE IMPORTS NOTHING, same shape as `sms-feature.ts`. The flag is
 * read from the settings screen and from tests; it must stay cheap.
 *
 * Why these three, together: they are the Settings surfaces the founder asked
 * to take off the popup (and the matching mobile page) without losing the
 * restore path. SMS and Stripe Connect already have their own master switches;
 * this flag sits IN FRONT of those so a later restore of SMS-the-product does
 * not automatically put the Settings row back until this one is flipped too.
 */
export const SETTINGS_LEGACY_SECTIONS_ENABLED = false;
