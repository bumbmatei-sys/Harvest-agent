/**
 * THE-350 — 🔴 THE ONE PLACE DOLLARS BECOME CENTS.
 *
 * `lib/donation-history.ts` owns the other direction and says why: invoices
 * store `amount` in CENTS, and `AdminAccounting` shipped the inverse bug —
 * summed cents, formatted as dollars, showed `$10,550,000` for `$105,500`. That
 * bug had a mirror image waiting on the WRITE side, and this is the module that
 * removes it: an admin types dollars into the CRM, the ledger takes cents, and
 * the conversion happens exactly once, here, with the float rounded rather than
 * trusted.
 *
 * 🔴 WHY THIS IS NOT IN `lib/manual-donation.ts`. That module imports `adminDb`
 * and is server-only; the CRM screen that needs the conversion is a client
 * component, and importing the writer there would drag the Admin SDK into the
 * browser bundle. So the pure arithmetic lives on its own, client-safe, with no
 * imports at all — the same reason `donation-history.ts` holds `formatCents`
 * rather than the route that uses it.
 *
 * ⚠️ IT IS NOT IN `donation-history.ts` EITHER, because that file is pinned
 * byte-for-byte by `AdminDonations.section.test.tsx` as a money path this ticket
 * must not touch. Adding to it would have meant re-recording a digest whose
 * whole job is to say the receipt contract did not move.
 */

/**
 * Parse an admin-typed dollar amount into INTEGER CENTS, or `null` if it is not
 * a usable amount of money.
 *
 * 🔴 `Math.round`, AND IT IS LOAD-BEARING. `Number('105.50') * 100` is
 * `10550.000000000002` in IEEE 754 — a value that is not a safe integer, which
 * {@link recordManualDonation} refuses outright. Without the rounding, one gift
 * in a handful would be rejected for a reason no admin could act on, and the
 * obvious "fix" (relaxing the writer to accept floats) would reopen the door to
 * a caller passing dollars straight through as cents.
 *
 * 🔴 REFUSES RATHER THAN COERCES. An empty field, a stray letter, a negative, a
 * zero, an infinity or an amount too large to be a safe integer all come back
 * `null` — never `0`. A gift silently recorded as $0.00 is the quiet lie in
 * miniature: the timeline would show an entry, the dashboard would move by
 * nothing, and no error would ever be shown.
 *
 * ⚠️ SUB-CENT INPUT ROUNDS, and that is deliberate rather than an oversight:
 * `'0.004'` is 0.4 of a cent, rounds to 0, and is therefore REFUSED by the
 * zero check below — so the smallest amount this accepts is one cent, which is
 * the smallest amount the ledger can hold.
 */
export function dollarsToCents(input: string | number | null | undefined): number | null {
  if (input === null || input === undefined) return null;
  const raw = typeof input === 'number' ? input : String(input).trim();
  if (raw === '') return null;
  const dollars = Number(raw);
  if (!Number.isFinite(dollars) || dollars <= 0) return null;
  const cents = Math.round(dollars * 100);
  if (!Number.isSafeInteger(cents) || cents <= 0) return null;
  return cents;
}
