"use client";
import React, { useState, useEffect, useCallback } from 'react';
import { authFetch } from '../../utils/auth-fetch';
import { SMS_FEATURE_ENABLED } from '../../lib/sms-feature';
import { CONTROL_DENSITY, FIELD_WIDTH, ACTION_BUTTON } from '../layout/form-layout';
// THE-318 — the installed primitive for an action-styled link. Used rather than
// a hand-rolled anchor so the KYC destination carries the same focus ring and
// palette treatment as every other action on this screen.
import { Button } from '@/components/ui/button';
// ── THE-320 — the rest of the installed primitives this panel composes from.
//
// ✅ `ui/card` IS SAFE HERE, and that was checked rather than assumed. Both
// shells below are `rounded-2xl`; `cn()` is twMerge, and twMerge resolves
// `rounded-2xl` against the primitive's own `rounded-xl` (both are Tailwind
// scale steps) so exactly ONE corner reaches the DOM. The sibling SMS screen has
// shells spelled `rounded-brand-lg`/`-xl`, which twMerge does NOT know and
// therefore keeps alongside `rounded-xl` — `ui/card` is rejected there and the
// rejection is recorded on each shell.
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription } from '@/components/ui/alert';
// ── THE-330 — the primitives the country/type/number pickers compose from ────
//
// ✅ `ui/badge` — every capability and price marker. A capability is a small
//    labelled state on a row, which is exactly what a badge is for, and it is
//    reached for rather than a hand-rolled span so the four palettes resolve it.
// ✅ `ui/table` — the per-type matrix. Eight provider fields across N types IS
//    a table, and the primitive brings its own `overflow-x-auto` container, so
//    at 380px the matrix scrolls inside the card instead of widening the page.
// ✅ `ui/item` — one row per available number. These rows are genuinely rows
//    (no `dt`/`dd` association to lose, which is why `ui/item` was rejected for
//    the summary's description list above and is right here).
// ✅ `ui/skeleton` — the catalogue is a network read on mount and the picker
//    cannot be drawn until it lands. THE-320 rejected `skeleton` for the panel's
//    top-level "Loading…" because adopting it would have DELETED that word;
//    nothing is deleted here, this is a new surface with no copy to lose.
// ✅ `ui/empty` — a search that found no numbers. "Nothing found" is its whole
//    purpose, and it keeps that state from reading as a failure.
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Item, ItemContent, ItemTitle, ItemDescription } from '@/components/ui/item';
import { Skeleton } from '@/components/ui/skeleton';
import { Empty, EmptyHeader, EmptyTitle, EmptyDescription } from '@/components/ui/empty';
/**
 * ⚠️ THE SHAPES AND THE PREDICATES COME FROM THE PURE MODULE, NOT THE TRANSPORT.
 * `sms-countries.ts` holds no credential, makes no request and imports nothing
 * from `zernio.ts`, so this client screen never pulls the provider transport
 * into its bundle — and THE-314's "exactly ONE module talks to the provider"
 * guard keeps the list it had.
 */
import type {
  ZernioCountry,
  ZernioCountryType,
  ZernioAreaOption,
  ZernioAvailableNumber,
} from '../../lib/sms-countries';
import {
  countryCanSms,
  typeIsInstantlyBuyable,
  purchasableSmsTypes,
  countryLabel,
  numberTypeLabel,
  tierNote,
  formatMonthlyCents,
} from '../../lib/sms-countries';

/**
 * THE-314 — the ministry's phone number: search, buy, see, release.
 *
 * 🔴 IT REPLACED A BRING-YOUR-OWN CREDENTIAL FORM. This panel used to collect a
 * church's own Twilio account SID, auth token and from-number. Harvest now
 * RESELLS on one vendor account: the church never holds a credential, never
 * contracts with the vendor, and buys its number from inside Harvest.
 *
 * 🔴 IT NEVER APPLIES ENTITLEMENT. Nothing here writes a plan, a feature flag
 * or an add-on count — #434 removed a client-side `plan` write and THE-259's
 * sweep catches a new one. It ASKS `/api/sms/numbers` and then RE-READS what
 * that route recorded; it never renders the outcome it requested. A number that
 * failed to provision, or that provisioned into a pending carrier registration,
 * must look like what it is on the next read rather than like a success this
 * component assumed.
 */

/** Whose account, whose bill — stated where the money is spent, not discovered
 * on an invoice. Kept as a constant rather than inline JSX so the apostrophes
 * stay readable (and unescaped). */
export const RESOLD_NUMBER_NOTE =
  "Harvest buys and holds this number for you and bills you for it, so there is no separate carrier account to set up. Messages are charged against your plan's monthly allowance. SMS can only be sent to US numbers.";

/** 🔴 Said BEFORE the button that does it, because the vendor documents no
 * port-out: a released number cannot be recovered and cannot be moved to an
 * account the church controls. A church that published this number on its
 * noticeboard would lose it. */
export const RELEASE_WARNING =
  'Releasing gives the number up for good. It cannot be recovered, and it cannot be moved to another provider — anyone texting it afterwards reaches nobody.';

/**
 * 🔴 THE-327 — SAID BEFORE THE BUY BUTTON, NOT AFTER THE CHARGE.
 *
 * US carriers only deliver messages from a REGISTERED sender (10DLC). Harvest
 * attaches its own registration to every number it buys — that reuse is the
 * whole economics of the reseller model — but whether the carriers have
 * accepted it for a given number is the provider's answer, not Harvest's
 * claim, and the route records `pending_registration` whenever the reuse call
 * does not come back ok.
 *
 * ⚠️ THIS IS A WARNING, NOT A FLOW. The provider exposes
 * `sms_start_sms_registration` / `sms_reuse_sms_registration_for_number` /
 * `sms_share_sms_registration`, and Harvest's client wraps only the REUSE one.
 * Whether one registration may cover many unrelated churches or each needs its
 * own share link is still outstanding with the provider, so this ticket
 * SURFACES the status and deliberately builds no registration flow on a guess.
 */
export const REGISTRATION_WARNING =
  'US carriers only deliver texts from a registered sender. Harvest applies its own carrier registration to your number when you buy it, but the number cannot send until the carriers accept it, and its status will read "Waiting on carrier registration" until they do. Do not print or announce a number before its status reads active.';

/** 🔴 Shown ON the number once it exists, whenever the status is anything but
 * `active`. A church that has paid for a number and believes it works is the
 * exact failure THE-327 exists to prevent: an unregistered number looks fine
 * and the carriers drop the messages silently. */
export const CANNOT_DELIVER_YET =
  'This number is not able to deliver messages yet. Carrier registration is still outstanding, so anything sent from it may be dropped without a failure being reported.';

/**
 * 🔴 THE-330 — THE FAILED-FETCH MESSAGE, AND WHY IT IS NOT AN EMPTY PICKER.
 *
 * The Silent-Failure Rule, on the screen where it costs the most: "a default
 * value that hides an error is a bug… each converts a loud failure into a quiet
 * lie." An empty country picker states "no countries are available", which is
 * a claim about the provider's inventory that Harvest has no basis for — the
 * truth is that Harvest could not ASK. A church reading the empty list would
 * conclude its own country is not offered and give up on a product it can buy.
 */
export const COUNTRY_FETCH_FAILED =
  'The list of countries could not be loaded from the provider, so none can be shown. This is a problem reaching the provider, not a sign that no countries are available. Please try again.';

/** 🔴 Said on the country itself, before any type or price is offered. This is
 * the founder's exact failure — he chose DE and was told only after pressing a
 * button — so the sentence names the country and states the consequence in the
 * same breath the country is chosen. */
export function cannotTextNote(code: string): string {
  return `${countryLabel(code)} sells phone numbers, but none of its number types can send or receive SMS. A number here would be billed monthly and could not text, so it cannot be bought for SMS.`;
}

/** 🔴 THE-330 — KYC DISCLOSED BEFORE THE BUTTON, not after the order.
 * THE-318 made the provider's 202 surface its `kycUrl`; this says the documents
 * will be needed while the church can still choose another country. */
export function kycWarning(code: string): string {
  return `Buying a number in ${countryLabel(code)} requires identity documents before the number is issued. The provider will ask for them after you buy, and the number is not ordered — and nothing is charged — until they are accepted.`;
}

/**
 * 🔴 THE-330 — STATED PLAINLY, BECAUSE THE PURCHASE CANNOT HONOUR A CHOICE.
 *
 * The provider's purchase is payment-first and takes `country`, `numberType`
 * and `areaCode` — NOT a phone number. It provisions and assigns one itself.
 * So the list below is a PREVIEW of the pool a purchase will draw from, and
 * saying otherwise — a "choose this number" button that then delivers a
 * different number — would be exactly the false claim this ticket exists to
 * remove. The numbers are shown because the founder asked to see them and
 * because each carries its own capabilities; they are not selectable.
 */
export const NUMBERS_ARE_A_PREVIEW =
  'These are real numbers in stock right now, shown so you can see what this country, type and area actually yield. You cannot reserve a specific one: the provider assigns a number from this pool when you buy, so the number you receive will match these but will not be one you pick.';

export interface NumberRecord {
  phoneNumber: string;
  status: string;
  monthlyCostUsd: number | null;
  country: string;
  purchasedAt?: string;
}

/**
 * 🔴 THE-327 — "does this ministry have a number" asked in ONE place.
 *
 * The panel decides whether to render the summary or the get-a-number form,
 * and the SMS section decides whether broadcasting is available at all. Those
 * two answers must never differ, and they would the moment each spelled its
 * own test: `/api/sms/numbers` answers `null` for a released number today
 * (`getTenantSmsNumber` refuses a record with no `phoneNumber`), but the
 * DELETE route also writes `status: 'released'` onto the document, so a record
 * that survives both shapes is exactly the one to be explicit about. A screen
 * offering a Send button for a number that has been given up is money leaking.
 */
export const hasUsableNumber = (n: Pick<NumberRecord, 'phoneNumber' | 'status'> | null | undefined): boolean =>
  !!n?.phoneNumber && n.status !== 'released';

/** Human copy for each status the provider can report. `pending_registration`
 * is the one that matters: the number EXISTS and is being billed, but US
 * carriers will not deliver from it until the brand registration is approved.
 * Saying "active" there would be a false claim on a screen about money. */
function statusLabel(status: string): string {
  if (status === 'active') return 'Active — able to send and receive';
  if (status === 'pending_registration') return 'Waiting on carrier registration — it cannot send yet';
  if (status === 'kyc_required') return 'Waiting on an identity check before it activates';
  if (status === 'released') return 'Released';
  return status;
}

/** Every control is ≥44px below `sm`; Rule 4's density tokens take over from
 * `sm:` up, where 38/40px is the settled desktop band. */
const CONTROL = `w-full min-h-[44px] px-4 border border-line rounded-xl text-sm focus:outline-hidden focus:ring-2 focus:ring-gold ${CONTROL_DENSITY.control}`;
const BUTTON = `min-h-[44px] px-6 rounded-xl text-sm font-semibold ${CONTROL_DENSITY.action} ${ACTION_BUTTON}`;

/**
 * 🔴 THE-330 — THE PICKER RECIPE, SPELLED ONCE AND EXPORTED FOR MEASUREMENT.
 *
 * All three pickers (country, type, area code) carry this exact string, and
 * THE-330's layout suite renders THIS constant through a real `<select>` in
 * Chromium at all five widths. The panel's controls only exist after its
 * `/api/sms/numbers` effect resolves and server rendering never runs an effect,
 * so a measuring suite that could not mount the panel would otherwise hand-copy
 * the class string — and a hand-copied recipe drifts silently from the one that
 * ships. Exporting it means the thing measured IS the thing rendered.
 *
 * ⚠️ `min-h-[44px]` IS UNPREFIXED, MATCHING THE PANEL'S OTHER CONTROLS. THE-320
 * measured and recorded the consequence on this panel's existing recipes: a
 * `min-h` cannot be shrunk by `CONTROL_DENSITY.control`'s `sm:h-[38px]`, so
 * these controls stay 44px on a desktop too rather than taking Rule 4's band.
 * That is a KNOWN, MEASURED property of this panel's recipe and not a new one:
 * giving only the two new selects `sm:min-h-0` would release them to 38px beside
 * 44px inputs and buttons in the SAME form, which is a ragged row bought for a
 * token's sake. THE-330's layout suite asserts the measurement at all five
 * widths rather than assuming either answer.
 */
export const SMS_PICKER_CLASSES = `w-full px-4 border border-line rounded-xl text-sm bg-surface-raised focus:outline-hidden focus:ring-2 focus:ring-gold min-h-[44px] ${CONTROL_DENSITY.control}`;

/**
 * The two recipes above, exported so they can be MEASURED rather than retyped.
 *
 * ⚠️ THE-320's layout suite renders these exact strings through the same
 * primitives this panel uses. The panel's own controls only exist after its
 * `/api/sms/numbers` effect has run, which server rendering never does — so a
 * measuring suite that cannot mount the panel would otherwise have to hand-copy
 * the class strings, and a hand-copied recipe drifts silently from the one that
 * ships. Exporting them means the thing measured IS the thing rendered.
 */
export const SMS_PANEL_CONTROL_CLASSES = { control: CONTROL, action: BUTTON } as const;

/** How the panel spells each control, for the same reason. */
export const SMS_PANEL_CONTROL_EXTRA = {
  input: 'h-auto border-line bg-transparent focus-visible:ring-2 focus-visible:ring-gold focus-visible:border-input',
  primaryAction: 'h-auto bg-gold hover:bg-gold text-white hover:opacity-90 disabled:opacity-50',
  secondaryAction: 'h-auto border border-line bg-transparent text-body hover:bg-surface-tint hover:text-body',
} as const;

/**
 * 🔴 THE-327 — the panel is now MOUNTED BY THE SMS SECTION, not by Settings.
 *
 * `embedded` says which mount this is, and it decides exactly one thing: the
 * bottom clearance below. `onState` lets the SMS section decide its own shape
 * from what this panel already read — a church with no number is shown setup
 * instead of a broadcast form it cannot use — WITHOUT a second request for the
 * same document.
 */
export interface SmsNumberPanelProps {
  /** True when the SMS section renders it; that page root already carries the
   * 120px nav clearance, so the panel must not add a second one. */
  embedded?: boolean;
  /**
   * Reports every settled read of `/api/sms/numbers`. `loaded:false` is the
   * "still asking" state and is deliberately distinct from "no number": the
   * two must not render the same thing.
   *
   * ⚠️ PASS A STABLE REFERENCE. It is a dependency of the panel's `reload`
   * callback, which its effect depends on, so a function created inline on
   * every render re-runs the read forever. `AdminSms` wraps its handler in
   * `useCallback` for exactly this reason.
   */
  onState?: (state: { loaded: boolean; number: NumberRecord | null }) => void;
}

export const SmsNumberPanel: React.FC<SmsNumberPanelProps> = ({ embedded = false, onState }) => {
  const [number, setNumber] = useState<NumberRecord | null>(null);
  const [loaded, setLoaded] = useState(false);
  /**
   * 🔴 THE-330 — THE CATALOGUE, AND ITS THREE DISTINCT STATES.
   *
   * `null` + no error is "still asking"; an error is "we could not ask"; a list
   * is the answer. They render as a skeleton, a failure alert and the picker
   * respectively, and NEVER as one another — collapsing the failure into the
   * empty case is the quiet lie {@link COUNTRY_FETCH_FAILED} exists to prevent.
   */
  const [catalogue, setCatalogue] = useState<ZernioCountry[] | null>(null);
  const [catalogueError, setCatalogueError] = useState<string | null>(null);
  /** When the catalogue was read from the provider, reported by the route.
   * Shown so a church knows how current the prices and stock beside the Buy
   * button are. */
  const [fetchedAt, setFetchedAt] = useState<string | null>(null);
  /** ⚠️ EMPTY UNTIL THE CATALOGUE LANDS. Seeding a country before the list is
   * known would put a code on screen that the provider may not offer. */
  const [country, setCountry] = useState('');
  const [numberType, setNumberType] = useState('');
  const [areaCode, setAreaCode] = useState('');
  const [areaOptions, setAreaOptions] = useState<ZernioAreaOption[] | null>(null);
  const [numbers, setNumbers] = useState<ZernioAvailableNumber[] | null>(null);
  const [busy, setBusy] = useState('');
  const [confirmRelease, setConfirmRelease] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  /** 🔴 THE-318 — the identity-check address a regulated country answers with.
   * Held separately from `msg` because it is an ACTION, not a sentence: an
   * admin told "an identity check is needed" with no way to reach it cannot
   * finish, and the number is never ordered until they do. */
  const [kycUrl, setKycUrl] = useState<string | null>(null);

  /** The single re-read. Every mutation below ends by calling this rather than
   * setting state from its own response, so what the screen shows is always
   * what the server recorded. */
  const reload = useCallback(async () => {
    let next: NumberRecord | null = null;
    try {
      const r = await authFetch('/api/sms/numbers');
      const d = await r.json().catch(() => ({}));
      const answered = (r.ok ? d.number ?? null : null) as NumberRecord | null;
      // Normalised through the ONE predicate, so the panel and the SMS section
      // can never disagree about whether a number exists.
      next = hasUsableNumber(answered) ? answered : null;
    } catch {
      next = null;
    } finally {
      setNumber(next);
      setLoaded(true);
      // 🔴 Reported from the SAME settled value the panel renders, so the SMS
      // section's shape and this panel's contents can never disagree about
      // whether a number exists.
      onState?.({ loaded: true, number: next });
    }
  }, [onState]);

  useEffect(() => { void reload(); }, [reload]);

  /**
   * 🔴 THE-330 — THE COUNTRY LIST IS FETCHED. This is the ticket.
   *
   * Nothing in this file holds a country, a price, a tier or a capability. The
   * picker is drawn from what comes back here, so a country the provider adds
   * appears without a deploy and one it withdraws stops being offered.
   *
   * ⚠️ A FAILURE SETS `catalogueError` AND LEAVES `catalogue` NULL. It never
   * settles to `[]`: an empty picker is a statement about the provider's
   * inventory, and this component is in no position to make one.
   */
  const loadCountries = useCallback(async () => {
    setCatalogueError(null);
    setCatalogue(null);
    try {
      const r = await authFetch('/api/sms/numbers?countries=1');
      const d = await r.json().catch(() => ({}));
      if (!r.ok || !Array.isArray(d.countries)) {
        setCatalogueError(typeof d.error === 'string' && d.error ? d.error : COUNTRY_FETCH_FAILED);
        return;
      }
      setCatalogue(d.countries as ZernioCountry[]);
      setFetchedAt(typeof d.fetchedAt === 'string' ? d.fetchedAt : null);
    } catch {
      setCatalogueError(COUNTRY_FETCH_FAILED);
    }
  }, []);

  useEffect(() => { void loadCountries(); }, [loadCountries]);

  /** The country the picker is showing, resolved out of the FETCHED list. */
  const selected: ZernioCountry | null =
    (catalogue && catalogue.find((c) => c.code === country)) || null;

  /**
   * The opening selection, taken from the catalogue rather than assumed.
   *
   * ⚠️ NOT A HARDCODED LIST. `'US'` is a preference for ONE code — Harvest can
   * only SEND to US numbers today (see RESOLD_NUMBER_NOTE) — and it is honoured
   * only if the provider actually offers it; otherwise the first country that
   * can text wins, and failing that the first country offered. Every candidate
   * comes out of the fetched catalogue.
   */
  useEffect(() => {
    if (!catalogue || catalogue.length === 0 || country) return;
    const preferred =
      catalogue.find((c) => c.code === 'US' && countryCanSms(c)) ||
      catalogue.find((c) => countryCanSms(c)) ||
      catalogue[0];
    setCountry(preferred.code);
  }, [catalogue, country]);

  /**
   * 🔴 THE TYPE IS RESOLVED FROM THE COUNTRY'S OWN `types[]`, per type.
   *
   * `purchasableSmsTypes` filters on the PER-TYPE `smsAvailable` — never the
   * country-level flag, which mirrors only the default type. In GB that
   * difference is the whole defect: the country flag would admit `local`, and a
   * GB `local` number is billed monthly and cannot text.
   */
  useEffect(() => {
    if (!selected) return;
    const buyable = purchasableSmsTypes(selected);
    const stillValid = buyable.some((t) => t.numberType === numberType);
    if (!stillValid) setNumberType(buyable.length > 0 ? buyable[0].numberType : '');
  }, [selected, numberType]);

  /** Changing country or type invalidates the area list and the preview: both
   * describe a (country, type) pool and would otherwise be read against the
   * wrong one. */
  useEffect(() => {
    setAreaCode('');
    setAreaOptions(null);
    setNumbers(null);
  }, [country, numberType]);

  /**
   * 🔴 THE-330 — THE AREA CODES THAT HAVE STOCK, so the area is CHOSEN.
   *
   * The founder typed `615` against Germany. `areaCode` is a hard constraint:
   * an area with no inventory fails the purchase with 409
   * `AREA_CODE_UNAVAILABLE` and the provider does NOT substitute another area,
   * so a typed area code is a guess that costs the church an error.
   */
  const loadAreas = useCallback(async (forCountry: string, forType: string) => {
    if (!forCountry) return;
    setAreaOptions(null);
    try {
      const q = new URLSearchParams({ areas: '1', country: forCountry });
      if (forType) q.set('type', forType);
      const r = await authFetch(`/api/sms/numbers?${q.toString()}`);
      const d = await r.json().catch(() => ({}));
      // An area lookup that fails leaves the list null, which renders as "Any
      // area" only — it never invents an area code, because a wrong one is a
      // failed purchase.
      setAreaOptions(r.ok && Array.isArray(d.areaOptions) ? (d.areaOptions as ZernioAreaOption[]) : []);
    } catch {
      setAreaOptions([]);
    }
  }, []);

  useEffect(() => {
    if (selected && numberType) void loadAreas(selected.code, numberType);
  }, [selected, numberType, loadAreas]);

  /**
   * 🔴 THE-330 — REAL NUMBERS, EACH WITH ITS OWN CAPABILITIES.
   *
   * "Check availability" used to answer a yes/no count. It now lists the actual
   * numbers, and each row badges its OWN `features`: two numbers of the same
   * country and type can differ, so a per-country or even per-type claim about
   * capability is not the whole truth about the row.
   *
   * ⚠️ IT IS A PREVIEW, NOT A CART — see {@link NUMBERS_ARE_A_PREVIEW}. The
   * purchase takes country, type and area code and assigns the digits itself.
   */
  const search = async () => {
    setBusy('search');
    setMsg(null);
    setNumbers(null);
    try {
      const q = new URLSearchParams({ available: '1', country });
      if (numberType) q.set('type', numberType);
      if (areaCode) q.set('prefix', areaCode);
      const r = await authFetch(`/api/sms/numbers?${q.toString()}`);
      const d = await r.json().catch(() => ({}));
      if (r.ok) setNumbers(Array.isArray(d.numbers) ? (d.numbers as ZernioAvailableNumber[]) : []);
      else setMsg({ ok: false, text: d.error || 'Could not check availability.' });
    } finally {
      setBusy('');
    }
  };

  const buy = async () => {
    setBusy('buy');
    setMsg(null);
    setKycUrl(null);
    try {
      const r = await authFetch('/api/sms/numbers', {
        method: 'POST',
        // 🔴 THE-330 — the CHOSEN type travels with the purchase. The route
        // re-checks it against the provider's SMS pool before spending
        // anything, so a type this screen would not offer cannot be bought by
        // asking the API directly. THE-318's own resolution still decides what
        // is finally sent.
        body: JSON.stringify({
          country,
          numberType: numberType || undefined,
          areaCode: areaCode || undefined,
        }),
      });
      const d = await r.json().catch(() => ({}));
      // 🔴 THE-318 — a 202 is NOT a purchase. The provider answers
      // `kyc_required` before ordering anything, so saying "ordered" there
      // would be a false claim on a screen about money: nothing exists and
      // nothing is being billed until the check is done.
      if (d.kycUrl) setKycUrl(typeof d.kycUrl === 'string' ? d.kycUrl : null);
      setMsg(
        d.kycUrl
          ? {
              ok: false,
              text:
                d.error ||
                'This country needs an identity check before the number can be ordered. Nothing has been charged yet.',
            }
          : r.ok
            ? { ok: true, text: 'Number bought.' }
            : { ok: false, text: d.error || 'Could not buy a number.' },
      );
    } finally {
      setBusy('');
      // 🔴 Re-read whether it succeeded or not. A failed purchase can still have
      // provisioned a number at the provider, and the screen must show what is
      // actually being billed rather than what this component hoped.
      await reload();
    }
  };

  const release = async () => {
    setBusy('release');
    setMsg(null);
    try {
      const r = await authFetch('/api/sms/numbers', { method: 'DELETE' });
      const d = await r.json().catch(() => ({}));
      setMsg(r.ok ? { ok: true, text: 'Number released.' } : { ok: false, text: d.error || 'Could not release the number.' });
    } finally {
      setBusy('');
      setConfirmRelease(false);
      await reload();
    }
  };

  const body = (
    <div className={CONTROL_DENSITY.sectionGap + ' space-y-6'}>
      <p className="text-body">
        Send SMS broadcasts and automated messages to your congregation from a number of your own.
      </p>
      <p className="text-sm text-muted">{RESOLD_NUMBER_NOTE}</p>

      {!loaded ? (
        /* ⚠️ `ui/skeleton` REJECTED — it is the primitive for a loading state and
           it cannot be used here, because adopting it DELETES the word
           "Loading…". This ticket may not change a word of copy, and a shimmer
           is not the same statement to a screen reader as a sentence. */
        <p className="text-sm text-muted">Loading…</p>
      ) : number ? (
        /* ✅ `ui/card` — `rounded-2xl` resolves against the primitive's
           `rounded-xl`, so the 16px corner this shell already had is the only
           one emitted. */
        <Card className="gap-0 py-0 overflow-visible ring-0 bg-surface-raised rounded-2xl border border-line-subtle p-6 space-y-4 text-body">
          <div>
            {/* ⚠️ `CardTitle` REJECTED on this heading. It renders a `<div>` with
                no `render` escape, so adopting it would demote an `<h3>` inside
                the settings accordion to a non-heading — an accessibility
                regression traded for a class name. */}
            <h3 className="text-sm font-semibold text-muted uppercase tracking-wide">Your number</h3>
            <p className="text-body font-mono text-lg mt-1">{number.phoneNumber}</p>
          </div>
          {/* ⚠️ `ui/item` REJECTED for these three rows. They are a description
              list: each `<dt>` NAMES its `<dd>`, and that association is what a
              screen reader reads out on a billing surface. `Item` renders a div
              tree with no `dt`/`dd`, so composing here would trade a real
              semantic for a visual one. `ui/item` IS adopted for the broadcast
              rows on the sibling screen, where the rows are genuinely just rows. */}
          <dl className={CONTROL_DENSITY.fieldGap + ' space-y-2 text-sm'}>
            <div className="flex flex-wrap gap-x-2">
              <dt className="text-muted">Status</dt>
              <dd className="text-body">{statusLabel(number.status)}</dd>
            </div>
            <div className="flex flex-wrap gap-x-2">
              <dt className="text-muted">Monthly cost</dt>
              {/* An em dash rather than a guessed figure: a wrong price on a
                  billing screen is a false claim, and the provider does not
                  always report one. */}
              <dd className="text-body">
                {number.monthlyCostUsd === null ? '—' : `$${number.monthlyCostUsd.toFixed(2)} / month`}
              </dd>
            </div>
            <div className="flex flex-wrap gap-x-2">
              <dt className="text-muted">Country</dt>
              <dd className="text-body">{number.country}</dd>
            </div>
          </dl>

          {/* 🔴 THE-327 — the status is not merely LABELLED, it is ACTED ON. A
              number that is not active cannot deliver, and saying so in a
              `ui/alert` (which carries `role="alert"`) is the difference
              between an admin who waits and an admin who prints the number on
              a noticeboard and wonders why nobody replies. */}
          {number.status !== 'active' && (
            <Alert className="p-3 gap-0 rounded-xl text-sm bg-amber-50 text-amber-700 border border-amber-100">
              <AlertDescription className="text-inherit">{CANNOT_DELIVER_YET}</AlertDescription>
            </Alert>
          )}

          {confirmRelease ? (
            <div className="space-y-3">
              {/* `ui/alert` — this is the warning banner before an irreversible,
                  unrecoverable action, and it now carries `role="alert"` so it
                  is announced rather than merely printed. The copy, its tokens
                  and its 3-unit rhythm are unchanged. */}
              <Alert className="p-0 gap-0 rounded-none border-0 bg-transparent text-body">
                <AlertDescription className="text-sm text-body">{RELEASE_WARNING}</AlertDescription>
              </Alert>
              <div className="flex flex-wrap gap-2">
                <Button
                  onClick={release}
                  disabled={busy === 'release'}
                  className={`h-auto ${BUTTON} bg-gold hover:bg-gold text-white hover:opacity-90 disabled:opacity-50`}
                >
                  {busy === 'release' ? 'Releasing…' : 'Yes, release it'}
                </Button>
                <Button
                  variant="outline"
                  onClick={() => setConfirmRelease(false)}
                  className={`h-auto ${BUTTON} border border-line bg-transparent text-body hover:bg-surface-tint hover:text-body`}
                >
                  Keep it
                </Button>
              </div>
            </div>
          ) : (
            <Button
              variant="outline"
              onClick={() => setConfirmRelease(true)}
              className={`h-auto ${BUTTON} border border-line bg-transparent text-body hover:bg-surface-tint hover:text-body`}
            >
              Release this number
            </Button>
          )}
        </Card>
      ) : (
        /* ✅ `ui/card` — `rounded-2xl`, resolves cleanly. */
        <Card className="gap-0 py-0 overflow-visible ring-0 bg-surface-raised rounded-2xl border border-line-subtle p-6 space-y-4 text-body">
          {/* `CardTitle` rejected for the reason given on the sibling heading. */}
          <h3 className="text-sm font-semibold text-muted uppercase tracking-wide">Get a number</h3>

          {/* ── 🔴 THE CATALOGUE'S THREE STATES, NEVER COLLAPSED ─────────────
              A failure, a pending read and an answer are three different things
              and render as three different things. The one forbidden shape is a
              failure that looks like an empty list. */}
          {catalogueError ? (
            <div className="space-y-3">
              {/* `ui/alert` — it carries `role="alert"`, so a church that cannot
                  see the picker is TOLD why rather than left reading a blank. */}
              <Alert className="p-3 gap-0 rounded-xl text-sm bg-amber-50 text-amber-700 border border-amber-100">
                <AlertDescription className="text-inherit">{catalogueError}</AlertDescription>
              </Alert>
              <Button
                variant="outline"
                onClick={() => void loadCountries()}
                className={`h-auto ${BUTTON} border border-line bg-transparent text-body hover:bg-surface-tint hover:text-body`}
              >
                Try again
              </Button>
            </div>
          ) : !catalogue ? (
            /* ✅ `ui/skeleton` — the picker cannot be drawn until the provider
               answers, and a shimmer in the shape of the control is the honest
               placeholder. Nothing is DELETED to adopt it (the rejection THE-320
               recorded against the panel's top-level "Loading…" does not apply:
               this surface never had copy here). */
            <div className="space-y-3" aria-busy="true">
              <span className="sr-only">Loading the list of countries from the provider…</span>
              <Skeleton className={`h-11 ${FIELD_WIDTH.long}`} />
              <Skeleton className={`h-11 ${FIELD_WIDTH.medium}`} />
              <Skeleton className="h-24 w-full" />
            </div>
          ) : (
            <>
              {/* ── 🔴 1 · THE COUNTRY PICKER ─────────────────────────────────
                  ⚠️ `ui/select` REJECTED, for the two reasons already recorded
                  on the sibling SMS screen's Recipients control — and this
                  ticket adds TWO selects, so both were re-checked rather than
                  inherited:
                    · IT IS NOT A `<select>`. base-ui renders a button plus a
                      popup listbox, and the width guard in
                      admin-data-screens.desktop-layout.test.tsx finds a field by
                      `label → parent → input,select,textarea`. A listbox button
                      is none of the three, so composing here would BLIND an
                      existing measured guard rather than satisfy it.
                    · IT PINS ITS OWN HEIGHT at `data-[size=default]:h-8` — an
                      attribute selector that OUTRANKS Rule 4, exactly as THE-317
                      measured, sticking at 32px. That is under the 44px touch
                      floor, and `min-h-11` does not win against it.
                  The native control keeps both properties for free, and the
                  measured heights are asserted at all five widths. */}
              <div className={FIELD_WIDTH.long}>
                <Label htmlFor="sms-country" className={`block leading-5 text-sm font-medium text-body ${CONTROL_DENSITY.labelGap} mb-1.5`}>
                  Country
                </Label>
                <select
                  id="sms-country"
                  value={country}
                  onChange={(e) => setCountry(e.target.value)}
                  className={SMS_PICKER_CLASSES}
                >
                  {catalogue.map((c) => (
                    /* 🔴 "Germany (DE)", NEVER a bare `DE`. The founder's whole
                       complaint was that two letters are not something a person
                       can be expected to know.
                       ⚠️ EVERY country is listed, including the ones that cannot
                       text — and each says so on its own line. Hiding them would
                       leave a church wondering why its own country is absent;
                       showing them unmarked is what broke today. They are
                       selectable so the REASON can be read, and no Buy button is
                       rendered for them. */
                    <option key={c.code} value={c.code}>
                      {countryLabel(c.code)}
                      {countryCanSms(c) ? '' : ' — cannot send SMS'}
                      {c.inStock ? '' : ' — out of stock'}
                    </option>
                  ))}
                </select>
                {fetchedAt && (
                  <p className="text-[11px] text-faint mt-1">
                    Prices, stock and requirements read from the provider at {new Date(fetchedAt).toLocaleString()}.
                  </p>
                )}
              </div>

              {selected && (
                <>
                  {/* ── 🔴 1c · EVERY FIELD THE PROVIDER RETURNS PER COUNTRY ──
                      Rendered, not stored and ignored. A `<dl>` rather than
                      `ui/item` for the reason recorded on the summary above:
                      each `<dt>` NAMES its `<dd>`, and that association is what
                      a screen reader reads out on a surface about money. */}
                  <dl className="space-y-2 text-sm" data-country-facts>
                    <div data-country-field="name+code" className="flex flex-wrap gap-x-2">
                      <dt className="text-muted">Country</dt>
                      <dd className="text-body">{countryLabel(selected.code)}</dd>
                    </div>
                    <div data-country-field="smsAvailable" className="flex flex-wrap items-center gap-x-2">
                      <dt className="text-muted">Can send SMS</dt>
                      <dd>
                        {/* ✅ `ui/badge` — a small labelled state on a row. */}
                        <Badge variant={countryCanSms(selected) ? 'secondary' : 'outline'}>
                          {countryCanSms(selected) ? 'Yes' : 'No'}
                        </Badge>
                      </dd>
                    </div>
                    <div data-country-field="inStock" className="flex flex-wrap items-center gap-x-2">
                      <dt className="text-muted">In stock</dt>
                      <dd>
                        <Badge variant={selected.inStock ? 'secondary' : 'outline'}>
                          {selected.inStock ? 'Yes' : 'No'}
                        </Badge>
                      </dd>
                    </div>
                    <div data-country-field="monthlyCents" className="flex flex-wrap gap-x-2">
                      {/* 🔴 THE RECURRING PRICE, BEFORE THE BUY BUTTON. The
                          provider's figure, formatted here and deliberately NOT
                          through `formatPlanPrice` — that formatter is for
                          Harvest's own plan tiers, and running a carrier rate
                          card through it would present a pass-through cost as a
                          Harvest price. */}
                      <dt className="text-muted">Monthly cost</dt>
                      <dd className="text-body">{formatMonthlyCents(selected.monthlyCents)}</dd>
                    </div>
                    <div data-country-field="needsKyc" className="flex flex-wrap items-center gap-x-2">
                      <dt className="text-muted">Identity documents</dt>
                      <dd>
                        <Badge variant={selected.needsKyc ? 'outline' : 'secondary'}>
                          {selected.needsKyc ? 'Required' : 'Not required'}
                        </Badge>
                      </dd>
                    </div>
                    {tierNote(selected.tier) && (
                      <div data-country-field="tier" className="flex flex-wrap gap-x-2">
                        {/* 🔵 `tier` TRANSLATED, NOT PRINTED. The provider's
                            regulatory tier is a 1–4 bucketing whose only stated
                            consequence is whether identity documents are
                            required; a bare "3" beside a price reads as a
                            service level, which it is not. See `tierNote`. */}
                        <dt className="text-muted">Regulation</dt>
                        <dd className="text-body">{tierNote(selected.tier)}</dd>
                      </div>
                    )}
                  </dl>

                  {/* ── 🔴 2 · A COUNTRY THAT CANNOT TEXT IS MARKED AND UNBUYABLE
                      This is the founder's exact failure, stated where he chose
                      the country instead of after he pressed a button. Note what
                      is NOT rendered below this branch: no type picker, no area
                      picker, no price, and NO BUY BUTTON. */}
                  {!countryCanSms(selected) ? (
                    <Alert className="p-3 gap-0 rounded-xl text-sm bg-amber-50 text-amber-700 border border-amber-100">
                      <AlertDescription className="text-inherit">{cannotTextNote(selected.code)}</AlertDescription>
                    </Alert>
                  ) : (
                    <>
                      {/* ── 🔴 1d · EVERY FIELD THE PROVIDER RETURNS PER TYPE ──
                          ⚠️ THIS IS WHERE TODAY'S FAILURE LIVES. A country row is
                          not enough: in GB only `mobile` texts, in the US only
                          `local`. Every one of the country's types is listed with
                          all eight of its fields, so the church sees why the ones
                          it cannot pick are not offered.
                          ✅ `ui/table` — eight fields across N types IS a table,
                          and the primitive brings its own `overflow-x-auto`
                          container, so at 380px this scrolls inside the card and
                          the page body does not move. */}
                      <div>
                        <p className="text-sm font-medium text-body mb-1.5">Number types in {countryLabel(selected.code)}</p>
                        <Table data-type-matrix>
                          <TableHeader>
                            <TableRow>
                              <TableHead>Type</TableHead>
                              <TableHead>SMS</TableHead>
                              <TableHead>Calls</TableHead>
                              <TableHead>WhatsApp</TableHead>
                              <TableHead>Monthly</TableHead>
                              <TableHead>Identity docs</TableHead>
                              <TableHead>Fulfilment</TableHead>
                              <TableHead>Stock</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {selected.types.map((t: ZernioCountryType) => (
                              <TableRow key={t.numberType} data-number-type={t.numberType}>
                                <TableCell className="whitespace-nowrap text-body">
                                  {numberTypeLabel(t.numberType)}{' '}
                                  <span className="text-faint font-mono text-[11px]">{t.numberType}</span>
                                </TableCell>
                                {/* 🔴 THE PER-TYPE FLAG, rendered per type. Reading
                                    `selected.smsAvailable` in this cell instead is
                                    the mutation that would put GB `local` back on
                                    sale. */}
                                <TableCell><Badge variant={t.smsAvailable ? 'secondary' : 'outline'}>{t.smsAvailable ? 'Yes' : 'No'}</Badge></TableCell>
                                <TableCell><Badge variant={t.callsAvailable ? 'secondary' : 'outline'}>{t.callsAvailable ? 'Yes' : 'No'}</Badge></TableCell>
                                <TableCell><Badge variant={t.whatsappAvailable ? 'secondary' : 'outline'}>{t.whatsappAvailable ? 'Yes' : 'No'}</Badge></TableCell>
                                {/* Per TYPE, not per country: GB toll_free is $3
                                    and HU toll_free is $23. */}
                                <TableCell className="whitespace-nowrap text-body">{formatMonthlyCents(t.monthlyCents)}</TableCell>
                                {/* Also per type: IL mobile needs none, IL local does. */}
                                <TableCell><Badge variant={t.needsKyc ? 'outline' : 'secondary'}>{t.needsKyc ? 'Required' : 'Not required'}</Badge></TableCell>
                                {/* `request` is NOT instantly buyable — sourced by
                                    a carrier request, with no date implied. */}
                                <TableCell className="whitespace-nowrap"><Badge variant="outline">{t.fulfilment === 'instant' ? 'Buy now' : t.fulfilment === 'request' ? 'By request only' : '—'}</Badge></TableCell>
                                <TableCell><Badge variant={t.inStock ? 'secondary' : 'outline'}>{t.inStock ? 'In stock' : 'Out of stock'}</Badge></TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      </div>

                      {/* ── 🔴 2 · THE TYPE PICKER ────────────────────────────
                          The form had none, yet the provider's error told the
                          user to change it. Only THIS country's types are
                          offered, and one that cannot text — or has no stock, or
                          is by-request-only — is marked and DISABLED, because
                          SMS is the goal here.
                          ⚠️ `ui/select` rejected for the two reasons recorded on
                          the country picker above; this is the second of the two
                          selects the ticket names, and both are measured. */}
                      <div className={FIELD_WIDTH.long}>
                        <Label htmlFor="sms-type" className={`block leading-5 text-sm font-medium text-body ${CONTROL_DENSITY.labelGap} mb-1.5`}>
                          Number type
                        </Label>
                        <select
                          id="sms-type"
                          value={numberType}
                          onChange={(e) => setNumberType(e.target.value)}
                          className={SMS_PICKER_CLASSES}
                        >
                          {selected.types.map((t: ZernioCountryType) => (
                            <option key={t.numberType} value={t.numberType} disabled={!typeIsInstantlyBuyable(t)}>
                              {numberTypeLabel(t.numberType)} · {formatMonthlyCents(t.monthlyCents)}
                              {t.smsAvailable ? '' : ' — cannot send SMS'}
                              {t.smsAvailable && !t.inStock ? ' — out of stock' : ''}
                              {t.smsAvailable && t.inStock && t.fulfilment === 'request' ? ' — by request only' : ''}
                            </option>
                          ))}
                        </select>
                      </div>

                      {/* ── 🔴 THE PRICE AND THE KYC WARNING, BEFORE THE BUTTON ─
                          Both read off the CHOSEN TYPE, because both differ per
                          type within one country. */}
                      {(() => {
                        const chosen = selected.types.find((t) => t.numberType === numberType) || null;
                        if (!chosen) return null;
                        return (
                          <div className="space-y-3">
                            <p className="text-sm text-body">
                              {/* 🔴 THE RECURRING CHARGE, IN WORDS, ABOVE THE BUY
                                  BUTTON. A church currently sees no figure at all
                                  before agreeing to it. */}
                              A {numberTypeLabel(chosen.numberType).toLowerCase()} number in {countryLabel(selected.code)} costs{' '}
                              <strong>{formatMonthlyCents(chosen.monthlyCents)}</strong>, billed to you every month for as long as
                              you keep it.
                            </p>
                            {chosen.needsKyc && (
                              /* 🔴 KYC BEFORE PURCHASE, not after. THE-318 made
                                 the provider's 202 surface its `kycUrl`; this
                                 says the documents will be needed while the
                                 church can still choose another country. */
                              <Alert className="p-3 gap-0 rounded-xl text-sm bg-amber-50 text-amber-700 border border-amber-100">
                                <AlertDescription className="text-inherit">{kycWarning(selected.code)}</AlertDescription>
                              </Alert>
                            )}
                          </div>
                        );
                      })()}

                      {/* ── 🔴 1f · THE AREA CODE IS CHOSEN, NOT TYPED ────────
                          `AREA_CODE_UNAVAILABLE` is a hard 409: the purchase
                          FAILS rather than picking another area. The founder's
                          screenshot shows `615` typed against Germany. */}
                      <div className={FIELD_WIDTH.long}>
                        <Label htmlFor="sms-area" className={`block leading-5 text-sm font-medium text-body ${CONTROL_DENSITY.labelGap} mb-1.5`}>
                          Area code <span className="text-faint font-normal">(optional)</span>
                        </Label>
                        <select
                          id="sms-area"
                          value={areaCode}
                          onChange={(e) => setAreaCode(e.target.value)}
                          className={SMS_PICKER_CLASSES}
                        >
                          {/* Always offered, and always first: the provider
                              assigns from anywhere in the country when no area is
                              constrained, which is the option least likely to
                              fail. */}
                          <option value="">Any area</option>
                          {(areaOptions || []).map((a) => (
                            <option key={a.ndc} value={a.ndc}>
                              {a.name ? `${a.name} (${a.ndc})` : a.ndc} — {a.count} available
                            </option>
                          ))}
                        </select>
                        {areaOptions !== null && areaOptions.length === 0 && (
                          <p className="text-[11px] text-faint mt-1">
                            The provider lists no area codes with stock for this country and type, so the number will be
                            assigned from any area.
                          </p>
                        )}
                      </div>

                      {/* 🔴 THE-327 — BEFORE the money, not after. UNCHANGED and
                          still directly above the Buy button: an unregistered
                          number appears to work while carriers drop every
                          message, and registration status is readable per-number
                          only AFTER purchase. */}
                      <Alert className="p-3 gap-0 rounded-xl text-sm bg-amber-50 text-amber-700 border border-amber-100">
                        <AlertDescription className="text-inherit">{REGISTRATION_WARNING}</AlertDescription>
                      </Alert>

                      <div className="flex flex-wrap gap-2">
                        <Button
                          variant="outline"
                          onClick={search}
                          disabled={busy === 'search'}
                          className={`h-auto ${BUTTON} border border-line bg-transparent text-body hover:bg-surface-tint hover:text-body disabled:opacity-50`}
                        >
                          {busy === 'search' ? 'Checking…' : 'Check availability'}
                        </Button>
                        {/* 🔴 THE-318's purchase path is untouched by this work:
                            the same `buy` handler, still POSTing to the same
                            route, which still sends `wantsSms: true`, still sets
                            `connectWhatsapp: false` explicitly, still records the
                            RETURNED profileId and still passes `allowMultiple`. */}
                        <Button
                          onClick={buy}
                          disabled={busy === 'buy' || !numberType}
                          className={`h-auto ${BUTTON} bg-gold hover:bg-gold text-white hover:opacity-90 disabled:opacity-50`}
                        >
                          {busy === 'buy' ? 'Buying…' : 'Buy a number'}
                        </Button>
                      </div>

                      {/* ── 🔴 3 · REAL NUMBERS, EACH WITH ITS OWN CAPABILITIES ─ */}
                      {numbers !== null && (
                        <div className="space-y-2">
                          {numbers.length === 0 ? (
                            /* ✅ `ui/empty` — "nothing found" is its purpose, and
                               it keeps this from reading as a failure: there
                               genuinely are no numbers, which is an answer. */
                            <Empty className="border border-line rounded-xl p-6">
                              <EmptyHeader>
                                <EmptyTitle>No numbers in stock</EmptyTitle>
                                <EmptyDescription>
                                  The provider has no {numberTypeLabel(numberType).toLowerCase()} numbers in{' '}
                                  {countryLabel(selected.code)}
                                  {areaCode ? ` for area ${areaCode}` : ''} right now. Try another area, or another type.
                                </EmptyDescription>
                              </EmptyHeader>
                            </Empty>
                          ) : (
                            <>
                              {/* 🔴 STATED PLAINLY: a chosen number CANNOT be
                                  purchased. The provider's purchase takes country,
                                  type and area code — not a number. */}
                              <p className="text-sm text-muted">{NUMBERS_ARE_A_PREVIEW}</p>
                              {/* ⚠️ At 380px this list scrolls INSIDE its card and
                                  never moves the page body: the rows are capped in
                                  height and scroll on the block axis, and each row
                                  wraps rather than widening. */}
                              <div className="max-h-80 overflow-y-auto space-y-2" data-number-list>
                                {numbers.map((n) => (
                                  /* ✅ `ui/item` — these rows are genuinely rows,
                                     with no `dt`/`dd` association to lose. */
                                  <Item key={n.phoneNumber} className="border border-line rounded-xl p-3" data-available-number>
                                    <ItemContent>
                                      <ItemTitle className="font-mono">{n.phoneNumber}</ItemTitle>
                                      <ItemDescription>
                                        {/* 🔴 1e · EACH NUMBER'S OWN `features`.
                                            Two numbers of the same country and
                                            type can differ, so the row states its
                                            own capabilities rather than inheriting
                                            a claim from the type above it. */}
                                        <span className="flex flex-wrap gap-1 mt-1">
                                          {n.features.length === 0 ? (
                                            <Badge variant="outline">No capabilities reported</Badge>
                                          ) : (
                                            n.features.map((f) => (
                                              <Badge key={f} variant="secondary" data-number-feature={f}>
                                                {f}
                                              </Badge>
                                            ))
                                          )}
                                        </span>
                                      </ItemDescription>
                                    </ItemContent>
                                  </Item>
                                ))}
                              </div>
                            </>
                          )}
                        </div>
                      )}
                    </>
                  )}
                </>
              )}
            </>
          )}
        </Card>
      )}

      {msg && (
        /* `ui/alert` — the outcome banner. Both tones keep the exact tokens they
           had; what the primitive adds is `role="alert"`, so a purchase result
           an admin cannot see is still announced. */
        <Alert className={`p-3 gap-0 rounded-xl text-sm ${msg.ok ? 'bg-green-50 text-green-700 border border-green-100' : 'bg-amber-50 text-amber-700 border border-amber-100'}`}>
          <AlertDescription className="text-inherit">{msg.text}</AlertDescription>
          {kycUrl && (
            // ≥44px below `sm`; the primitive's own 32px height is the settled
            // desktop band from `sm:` up, so the minimum is released there.
            <Button
              variant="link"
              className="mt-2 min-h-[44px] sm:min-h-0"
              render={<a href={kycUrl} target="_blank" rel="noopener noreferrer" />}
            >
              Complete the identity check
            </Button>
          )}
        </Alert>
      )}
    </div>
  );

  // 🔴 THE-327 — the clearance is now a MOUNT question, and both answers are
  // spelled here rather than one being assumed. Embedded in the SMS section,
  // that page root already carries `pb-[120px]` and a second 120 would be dead
  // space under the last card. Standalone, the admin shell still carries the
  // inert `pb-safe` class (#437 fixed only the member shell), so a panel that
  // relied on it would sit under the fixed bottom nav on a phone.
  return embedded ? body : <div style={{ paddingBottom: 120 }}>{body}</div>;
};

/**
 * 🔴 THE-327 — WHAT REMAINS IN SETTINGS: A SIGNPOST, NOT THE LIFECYCLE.
 *
 * The founder's complaint was exact — "put all the features of sms in the sms
 * section. not here" — and it described a real split: buying a number lived
 * three levels deep in Settings → Connected Services → SMS, while sending
 * lived on a different screen entirely. The whole number lifecycle (summary,
 * get-a-number, release, identity check) now mounts in the SMS section, from
 * `SmsNumberPanel` above.
 *
 * ⚠️ THE ROW IS KEPT, AND KEPT DELIBERATELY. `AdminSettings.regroup.test.tsx`
 * pins the accordion's structure and its row → component mapping, and an
 * admin who has learned to look under Connected Services for SMS is better
 * served by one line telling them where it went than by a row that vanished.
 * What is NOT kept is an accordion row that opens onto nothing: this renders a
 * sentence and a link, so the row still says something when it is expanded.
 *
 * A plain `<a>` rather than react-router's `Link`: this panel is mounted by a
 * settings accordion and by several suites that render it bare, and a
 * component that throws outside a Router would make the row's reachability
 * depend on its test harness. `ui/button`'s `render` escape gives it the
 * primitive's focus ring and palette treatment either way.
 *
 * The master-switch wrapper stays for the reason THE-245 gave: turning SMS
 * back off is one value, not a second edit here.
 */
export const SMS_MOVED_NOTE =
  'Your number, broadcasts and automated messages are all managed in the SMS section.';

const SmsSettingsPointer: React.FC = () => (
  <div className={CONTROL_DENSITY.sectionGap + ' space-y-3'}>
    <p className="text-sm text-muted">{SMS_MOVED_NOTE}</p>
    {/* ≥44px below `sm`; from `sm:` up the primitive's own height is the
        settled desktop band, so the floor is released there exactly as it is
        on the identity-check action above. */}
    <Button
      variant="outline"
      className={`h-auto ${BUTTON} border border-line bg-transparent text-body hover:bg-surface-tint hover:text-body`}
      render={<a href="/admin/sms" />}
    >
      Go to the SMS section
    </Button>
  </div>
);

export const SmsSection: React.FC = () => (SMS_FEATURE_ENABLED ? <SmsSettingsPointer /> : null);

export default SmsSection;
