/**
 * THE-292 — asking a member for their COUNTRY after sign-in, and the two rules
 * that make the answer safe to count.
 *
 * ═══ Why this module exists at all ═══════════════════════════════════════════
 *
 * #429 shipped the countries table and found the column behind it structurally
 * incomplete. THE-289 audited why and stopped, because the fix was a founder
 * decision rather than a bug. The audit's findings, re-verified against HEAD:
 *
 *   🔴 A PLAN-PURCHASER IS ASKED FOR NOTHING. `resolvePostAuthFunnelRoute`
 *      (post-auth-route.ts:49-51) routes a `?signup=<plus|pro|max>` intent to
 *      '/church-onboarding'. All three provisioning paths lead to
 *      `ChurchOnboarding`, none to `Onboarding` — so the owner never sees the
 *      personal form and has no `country`, permanently.
 *   🔴 THE MAGNITUDE IS ONE MEMBER PER TENANT — the owner. `useGrowthData`
 *      queries `scopedQuery('users', tenantId)` with NO role filter
 *      (useGrowthData.ts:74), so the owner is a row in that table.
 *   ⚠️ COVERAGE IS A TENANT SETTING, NOT A FUNNEL PROPERTY. `Onboarding.tsx`
 *      pushes its location step only when `default_country` or `default_city`
 *      is present in `customQuestions` (Onboarding.tsx:282-283), so a tenant
 *      may remove the question entirely. No funnel fix makes the column
 *      complete, which is why the ask lives out here instead.
 *
 * ═══ 🔴 RULE ONE: THE FIELD IS ABSENT OR IT IS A REAL COUNTRY ════════════════
 *
 * The countries table asserts `withCountry + countryUnrecorded === total`
 * (growth-data.ts:121-125). A member either has a country or is counted as
 * unrecorded, and this module may introduce no third state:
 *
 *   NO `''`.        NO `'Unknown'`.       NO `'Not set'` sentinel.
 *
 * ⚠️ Note that `growth-data.place()` would COERCE an empty string back to
 * `null`, so an `''` write would not move the arithmetic — which is exactly why
 * the guard is here at the WRITE boundary and not left to the reader. The
 * damage `''` does is elsewhere and it is real: `AdminSignups` reads
 * `data.country || ""` and then GROUPS on it (AdminSignups.tsx:264, :208), so an
 * empty string becomes a real key and a member with no country is filed under a
 * country named "". That existing `|| "Unknown"` bucket is not a precedent to
 * copy.
 *
 * {@link isRecordableCountry} is therefore membership in `ALL_COUNTRIES` — the
 * list `<CountrySelect>` itself offers — and nothing else. A dismissal calls no
 * writer at all, so the field stays ABSENT rather than being set to a blank.
 *
 * ═══ 🔴 RULE TWO: NO BACKFILL ════════════════════════════════════════════════
 *
 * There is no reliable retroactive source for a member's country. Fixing
 * forward cannot help anyone who already signed up, and guessing would put
 * invented data in the one column this whole feature exists to make honest.
 * {@link saveMemberCountry} writes ONE field, for the signed-in member, from a
 * value that member picked. There is no bulk path here and none is wanted.
 *
 * ═══ The write path is the EXISTING one ══════════════════════════════════════
 *
 * `country` is a top-level field on a `users` document, written today by
 * `Onboarding.saveToFirestore` and `PersonalInformationModal.handleSave`. This
 * is the same collection, the same document, the same field and the same
 * operation — one more call site, not a second way of writing a member's
 * country.
 *
 * ⚠️ THE-336 moved onboarding's write behind `writeUserDoc`, which updates the
 * document when it exists and CREATES a complete one when it does not: a member
 * whose document had never been created was rejected with `not-found` on the
 * last step and could not finish signing up at all. The collection, the
 * document and the field are unchanged, and `country` is still written through
 * untouched on both of its branches, so nothing above changes. ⚠️ The two
 * writers are named rather than located: THE-331 pinned a subject by
 * file-and-line and a deletion moved it two hundred lines, leaving the
 * reference pointing at whatever landed there.
 *
 * Neither existing writer is refactored to route through here: `PersonalInformationModal`
 * carries the account-deletion flow whose copy is asserted deep-equal to a live
 * derivation, and `Onboarding`'s question set and validation are pinned
 * byte-identical by this ticket. A shared helper bought at the price of editing
 * either file is not worth it.
 */
import { doc, updateDoc } from 'firebase/firestore';
import { db } from '../firebase';
import { ALL_COUNTRIES } from '../components/CountrySelect';

/**
 * 🔴 The ONLY values this module will ever write to `country`.
 *
 * Membership in the very list `<CountrySelect>` renders, so a value that
 * reaches Firestore is a value a member could actually have picked. `''`,
 * `'Unknown'`, `'Not set'` and free text all fail here, at the boundary, before
 * anything is written.
 */
export function isRecordableCountry(value: unknown): value is string {
  return typeof value === 'string' && (ALL_COUNTRIES as readonly string[]).includes(value);
}

/**
 * Write one member's country, on the existing write path.
 *
 * 🔴 Refuses rather than coerces. A caller that passes a blank gets an error and
 * NO write — the alternative (writing something harmless-looking) is precisely
 * the third state the countries table cannot have.
 */
export async function saveMemberCountry(uid: string, country: string): Promise<void> {
  if (!uid) throw new Error('saveMemberCountry: no uid');
  if (!isRecordableCountry(country)) {
    throw new Error(`saveMemberCountry: ${JSON.stringify(country)} is not a country`);
  }
  await updateDoc(doc(db, 'users', uid), { country });
}

/* ══ Dismissal ═══════════════════════════════════════════════════════════════
 *
 * 🔵 THE POLICY, AND WHY IT IS NOT EITHER EXTREME.
 *
 * A prompt that returns every session is nagging, and a member who dismissed it
 * once has said something — just not "never". A prompt dismissed FOREVER on the
 * first tap fills almost nothing: the single most valuable respondent is the
 * owner, who meets this on a busy first day in a new workspace and taps past it
 * for reasons that have nothing to do with willingness.
 *
 * So a dismissal SNOOZES for 30 days, and the THIRD dismissal is final. Three
 * asks spread over two months is not nagging; it is also not one shot at a bad
 * moment. The count is what makes "never" a decision the member actually made
 * rather than one inferred from a single tap.
 *
 * 🔴 STORED IN localStorage, NOT ON THE USER DOCUMENT. Two reasons, and the
 * second is the load-bearing one:
 *
 *   1. It is device state about a piece of UI, the same kind of fact
 *      `pwa-install.ts`'s `INSTALL_HANDLED_KEY` keeps, and it is stored the same
 *      way for the same reason.
 *   2. 🔴 A dismissal that wrote to `users/{uid}` would be a WRITE TO AN
 *      EXISTING MEMBER DOCUMENT PERFORMED BY A DISMISSAL — a new field on the
 *      very document the countries table reads, created by the member declining
 *      to answer. The rule this ticket is built on is that no existing member
 *      document is written except by the member's own submission. Keeping the
 *      dismissal off the document keeps that rule absolute instead of
 *      approximately true, and it keeps `users` free of a field whose only
 *      reader is a modal.
 *
 * The cost is honest and small: a member who dismisses on their phone may be
 * asked once more on their laptop. That is the correct direction to fail — the
 * question is optional and the ask is cheap.
 */

/** Per-member, so two people sharing a device do not answer for each other. */
const DISMISS_KEY_PREFIX = 'harvest.country_prompt.';

/** Days a single dismissal buys. */
export const SNOOZE_DAYS = 30;

/** Dismissals before the prompt stops asking for good. */
export const MAX_DISMISSALS = 3;

const DAY_MS = 24 * 60 * 60 * 1000;

/** What the member has told us by dismissing, so far. */
export interface DismissalState {
  /** How many times this member has dismissed the prompt on this device. */
  readonly count: number;
  /** Epoch ms before which the prompt stays quiet. `Infinity` means never again. */
  readonly until: number;
}

const NEVER_DISMISSED: DismissalState = { count: 0, until: 0 };

const key = (uid: string) => `${DISMISS_KEY_PREFIX}${uid}`;

/**
 * ⚠️ Every branch fails OPEN — an unreadable or corrupt marker is treated as
 * "never dismissed". The prompt is optional and skippable, so failing this way
 * costs one dismissible card; failing the other way silently removes the
 * feature for everyone whose storage is unavailable, which is how a feature
 * ships and is never seen.
 */
export function readDismissal(uid: string): DismissalState {
  if (!uid) return NEVER_DISMISSED;
  try {
    const raw = localStorage.getItem(key(uid));
    if (!raw) return NEVER_DISMISSED;
    const parsed = JSON.parse(raw) as { count?: unknown; until?: unknown };
    const count = typeof parsed.count === 'number' && parsed.count >= 0 ? parsed.count : 0;
    // `Infinity` does not survive JSON, so "never again" travels as null.
    const until = parsed.until === null ? Infinity
      : typeof parsed.until === 'number' ? parsed.until
      : 0;
    return { count, until };
  } catch {
    return NEVER_DISMISSED;
  }
}

/** Record one dismissal and return the state it produced. Writes no document. */
export function recordDismissal(uid: string, now: number = Date.now()): DismissalState {
  const count = readDismissal(uid).count + 1;
  const until = count >= MAX_DISMISSALS ? Infinity : now + SNOOZE_DAYS * DAY_MS;
  try {
    localStorage.setItem(key(uid), JSON.stringify({ count, until: until === Infinity ? null : until }));
  } catch {
    /* Storage unavailable — the prompt reappears next session. See above. */
  }
  return { count, until };
}

/** Is the prompt currently snoozed for this member on this device? */
export function isSnoozed(uid: string, now: number = Date.now()): boolean {
  return readDismissal(uid).until > now;
}

/* ══ The decision ════════════════════════════════════════════════════════════ */

/** Everything the "should we ask?" question depends on. No I/O. */
export interface CountryPromptInput {
  /** `getTenantIdFromHost()` — 🔴 non-null ONLY on a tenant subdomain. */
  readonly tenantIdFromHost: string | null;
  /** The signed-in member's uid, or null when nobody is signed in. */
  readonly uid: string | null;
  /** The `country` field as it stands on the member's user document. */
  readonly country: unknown;
  /** Epoch ms, injected so the snooze is testable without faking the clock. */
  readonly now?: number;
}

/**
 * 🔴 WHO SEES THE PROMPT — and the placement rule that is the whole ticket.
 *
 * ── It must be POST-HOP, and `tenantIdFromHost` is what proves it ────────────
 *
 * `theharvest.app` → `<tenant>.theharvest.app` is an ORIGIN HOP, not a
 * navigation (App.tsx:419-429). Firebase persists auth in origin-scoped
 * storage, so the hop ENDS THE SESSION and forces a second sign-in (THE-138).
 * Anything shown in `ChurchOnboarding`, between checkout and the hop, or on the
 * payment-confirmation screen is PRE-HOP — a step the member is interrupted out
 * of by a sign-in wall on another origin and never finishes.
 *
 * `getTenantIdFromHost()` returns non-null on `<tenant>.theharvest.app` and
 * null on the apex. Requiring it is therefore not a proxy for "after the hop";
 * it is the same fact. This is the identical gate `PostOnboardingInstallStep`
 * uses to solve the identical problem, one ticket over.
 *
 * ── Who, specifically ────────────────────────────────────────────────────────
 *
 * A signed-in member, on the tenant's own subdomain, whose document has NO
 * country, who has not snoozed the ask. The structural gap is the OWNER — the
 * one member per tenant who was asked for nothing — but nothing here is
 * role-specific, and it should not be: a congregant of a tenant that removed
 * `default_country` from its questions has exactly the same empty field for
 * exactly the same reason.
 *
 * ⚠️ A congregant MID-ONBOARDING is deliberately not excluded here, because
 * they cannot reach this code: the prompt is mounted beside `<MainApp/>` and
 * beside `<AdminDashboard/>`, inside `<Routes>`, inside `<OnboardingGate>`.
 * '/onboarding' and '/church-onboarding' are different routes and do not mount
 * it, and the gate renders nothing until it resolves to 'ready'. Showing this to
 * someone who is three taps from being asked anyway would be noise; the mount
 * point makes that impossible rather than merely unlikely.
 */
export function shouldPromptForCountry(input: CountryPromptInput): boolean {
  if (input.tenantIdFromHost === null) return false;   // 🔴 pre-hop / apex
  if (!input.uid) return false;
  // Any non-blank string already on the document is an answer. `place()`'s rule,
  // so a legacy `''` (or a whitespace-only value) still counts as unrecorded and
  // the member is asked — the one case where re-asking is the right thing.
  if (typeof input.country === 'string' && input.country.trim().length > 0) return false;
  if (isSnoozed(input.uid, input.now ?? Date.now())) return false;
  return true;
}
