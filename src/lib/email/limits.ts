import type { TenantPlan } from '@/types/tenant.types';

/**
 * Newsletter limits, in ONE place and ONE shape.
 *
 * These are defaults, not constants the app reads directly: the live values
 * come from the server-only document `platform_config/email_limits`, which a
 * super admin edits in Email settings, so a number changes without a deploy.
 * A field missing from that document falls back to the value here.
 *
 * Contacts are never limited or priced. Nothing below counts or caps the
 * size of a list; only emails SENT are metered.
 *
 * The extra-pack price has no default on purpose. AGENTS.md: add-on prices are
 * settled outside this repo and must not be copied into it. It is `null`
 * (not set) until someone enters it.
 */
export interface EmailLimits {
  /** Emails a ministry may send per calendar month (UTC), by plan. 0 = none. */
  readonly monthlySends: Readonly<Record<TenantPlan, number>>;
  /** The extra email pack. Checkout is not built; this feeds the "Add more emails" stub. */
  readonly pack: { readonly size: number; readonly priceUsd: number | null };
  /** The usage meter turns to a warning at this percent of the allowance. */
  readonly warnAtPercent: number;
  /** A new ministry may send at most `dailyCap` emails a day for its first `days` days. */
  readonly newChurch: { readonly dailyCap: number; readonly days: number };
  /** A send to MORE recipients than this needs a verified sending domain. */
  readonly largeSendThreshold: number;
  /** Sending pauses when either rate passes its threshold, once `minSent` emails are in the month. */
  readonly autoPause: { readonly bounceRate: number; readonly complaintRate: number; readonly minSent: number };
}

export const DEFAULT_EMAIL_LIMITS: EmailLimits = Object.freeze({
  monthlySends: Object.freeze({ free: 0, plus: 5000, pro: 5000, max: 10000 }),
  pack: Object.freeze({ size: 10000, priceUsd: null }),
  warnAtPercent: 80,
  newChurch: Object.freeze({ dailyCap: 500, days: 14 }),
  largeSendThreshold: 1000,
  autoPause: Object.freeze({ bounceRate: 0.05, complaintRate: 0.003, minSent: 100 }),
});

const PLANS: readonly TenantPlan[] = ['free', 'plus', 'pro', 'max'];

const isInt = (v: unknown, min: number, max = Number.MAX_SAFE_INTEGER): v is number =>
  typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max;
const isRate = (v: unknown): v is number => typeof v === 'number' && v >= 0 && v <= 1;

type Raw = Record<string, unknown>;
const obj = (v: unknown): Raw => (v && typeof v === 'object' ? (v as Raw) : {});

/** The effective limits: each field the document holds validly, else its default. */
export function resolveLimits(raw: unknown): EmailLimits {
  const r = obj(raw);
  const d = DEFAULT_EMAIL_LIMITS;
  const monthly = obj(r.monthlySends);
  const pack = obj(r.pack);
  const nc = obj(r.newChurch);
  const ap = obj(r.autoPause);
  return {
    monthlySends: Object.fromEntries(PLANS.map((p) => [p, isInt(monthly[p], 0) ? monthly[p] : d.monthlySends[p]])) as Record<TenantPlan, number>,
    pack: {
      size: isInt(pack.size, 1) ? pack.size : d.pack.size,
      priceUsd: typeof pack.priceUsd === 'number' && pack.priceUsd >= 0 ? pack.priceUsd : null,
    },
    warnAtPercent: isInt(r.warnAtPercent, 1, 100) ? r.warnAtPercent : d.warnAtPercent,
    newChurch: {
      dailyCap: isInt(nc.dailyCap, 0) ? nc.dailyCap : d.newChurch.dailyCap,
      days: isInt(nc.days, 0, 365) ? nc.days : d.newChurch.days,
    },
    largeSendThreshold: isInt(r.largeSendThreshold, 0) ? r.largeSendThreshold : d.largeSendThreshold,
    autoPause: {
      bounceRate: isRate(ap.bounceRate) ? ap.bounceRate : d.autoPause.bounceRate,
      complaintRate: isRate(ap.complaintRate) ? ap.complaintRate : d.autoPause.complaintRate,
      minSent: isInt(ap.minSent, 1) ? ap.minSent : d.autoPause.minSent,
    },
  };
}

/** Strict, for a save: an invalid value is refused with a reason, never silently defaulted. */
export function validateLimits(raw: unknown): { ok: true; limits: EmailLimits } | { ok: false; message: string } {
  const r = obj(raw);
  const monthly = obj(r.monthlySends);
  for (const p of PLANS) if (!isInt(monthly[p], 0)) return { ok: false, message: `Monthly emails for ${p} must be a whole number, 0 or more.` };
  const pack = obj(r.pack);
  if (!isInt(pack.size, 1)) return { ok: false, message: 'Pack size must be a whole number, 1 or more.' };
  if (pack.priceUsd !== null && !(typeof pack.priceUsd === 'number' && pack.priceUsd >= 0)) return { ok: false, message: 'Pack price must be a number, 0 or more, or empty.' };
  if (!isInt(r.warnAtPercent, 1, 100)) return { ok: false, message: 'The warning level must be a whole number from 1 to 100.' };
  const nc = obj(r.newChurch);
  if (!isInt(nc.dailyCap, 0)) return { ok: false, message: 'The new-ministry daily cap must be a whole number, 0 or more.' };
  if (!isInt(nc.days, 0, 365)) return { ok: false, message: 'New-ministry days must be a whole number from 0 to 365.' };
  if (!isInt(r.largeSendThreshold, 0)) return { ok: false, message: 'The large-send size must be a whole number, 0 or more.' };
  const ap = obj(r.autoPause);
  if (!isRate(ap.bounceRate)) return { ok: false, message: 'The bounce rate must be between 0 and 1 (0.05 is 5%).' };
  if (!isRate(ap.complaintRate)) return { ok: false, message: 'The complaint rate must be between 0 and 1 (0.003 is 0.3%).' };
  if (!isInt(ap.minSent, 1)) return { ok: false, message: 'The minimum sent before pausing must be a whole number, 1 or more.' };
  return { ok: true, limits: resolveLimits(raw) };
}
