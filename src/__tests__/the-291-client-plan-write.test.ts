import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

import { PLAN_PRICING, getPlanFeatures, PLAN_ORDER } from '../utils/plan-features';
import { rulesDigestFailure } from './__fixtures__/firestore-rules-pin';

/**
 * THE-291 — the client-side write to `plan`, and the sweep that could not see it.
 *
 * ─── WHAT WAS ACTUALLY THERE ────────────────────────────────────────────────
 *
 * `AdminDashboard.tsx`, in the props it handed `<AdminSettings>`:
 *
 *     onChangePlan={async (plan) => {
 *       if (auth.currentUser) {
 *         const { updateDoc, doc } = await import('firebase/firestore');
 *         await updateDoc(doc(db, 'users', auth.currentUser.uid), { plan });
 *         window.location.reload();
 *       }
 *     }}
 *
 * A real `updateDoc` — a persisted Firestore write, not a `setState` that
 * merely reads like one — plus a sibling `onCancelPlan` writing
 * `{ planStatus: 'cancelled' }` to the same document.
 *
 * 🔴 THE RULE IT BREAKS. The webhook is the single writer of `plan` and the
 * add-on set. The UI asks, and re-reads once the change is confirmed; it never
 * applies what it asked for. `on_payment_failure: 'prevent_change'` means Dodo
 * decides AFTER the payment whether a plan change took effect, so a client that
 * writes what it requested is claiming an entitlement nobody confirmed.
 *
 * ─── AND THE PART THE GREP DID NOT SAY ──────────────────────────────────────
 *
 * Neither prop was ever called. `AdminSettings` took `onChangePlan` and
 * `onCancelPlan` as REQUIRED props, destructured them, and invoked neither —
 * the live plan change is `PlanUpgradeSection`'s (`runDodoPlanChange`, then
 * `armPlanRefresh()`), and Cancel Subscription goes through
 * `setShowCancelConfirm(true)` into the billing portal. `firestore.rules`
 * names `plan` on `users/{uid}` immutable for both self-edits and tenant
 * admins, so the write would have been rejected for everyone but a platform
 * super admin, and nothing in the codebase reads `users/{uid}.plan` or
 * `planStatus` at all.
 *
 * ⚠️ None of that makes it safe to leave. It was a live, correctly-shaped
 * entitlement write sitting in a required prop's implementation: one caller
 * deciding to invoke the callback, or one rules edit, and it lands. So both
 * props and both writes are gone rather than neutered.
 *
 * ⚠️ Nothing here shells out to `git show`. Every baseline is a literal pinned
 * when this test was written — a guard that re-derives its own baseline from
 * the repository at assertion time cannot fail, it only describes whatever it
 * was handed.
 */

const REPO = path.resolve(__dirname, '../..');
const SRC = path.join(REPO, 'src');
const sha256 = (t: string | Buffer): string => createHash('sha256').update(t).digest('hex');
const read = (rel: string) => readFileSync(path.join(REPO, rel), 'utf8');

/* ═══════════════════════════════════════════════════════════════════════════
 * The sweep
 * ═══════════════════════════════════════════════════════════════════════════ */

const CODE_EXT = new Set(['.ts', '.tsx', '.js', '.jsx']);

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === '.git') continue;
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (CODE_EXT.has(path.extname(entry))) {
      out.push(path.relative(REPO, full).split(path.sep).join('/'));
    }
  }
  return out;
}

/** Comments stripped, so an explanation of the rule cannot trip the rule. */
const stripComments = (source: string): string =>
  source.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^[ \t]*\/\/.*$/gm, ' ');

/** Every argument list passed to `fn`, paren-balanced rather than regex-guessed. */
function callArguments(source: string, fn: string): string[] {
  const found: string[] = [];
  const opener = new RegExp(`\\b${fn}\\s*\\(`, 'g');
  let match: RegExpExecArray | null;
  while ((match = opener.exec(source)) !== null) {
    let depth = 1;
    let i = match.index + match[0].length;
    while (i < source.length && depth > 0) {
      const c = source[i];
      if (c === '(') depth++;
      else if (c === ')') depth--;
      i++;
    }
    found.push(source.slice(match.index + match[0].length, i - 1));
  }
  return found;
}

const CLIENT_WRITES = ['setDoc', 'updateDoc', 'addDoc', 'writeBatch'] as const;

/**
 * 🔴 THE THREE SPELLINGS OF THE SAME WRITE, and the ticket exists because a
 * sweep that carried only two of them passed over a real violation.
 *
 * THE-259's browser-SDK detector had `KEYED` and `FIELD_PATH` but not
 * `SHORTHAND`, and `{ plan }` — the spelling anyone writing a variable called
 * `plan` reaches for — matched neither.
 */
const KEYED = /(^|[{,\s])(['"`]?)plan\2\s*:/;          //  { plan: 'pro' }
const SHORTHAND = /[{,]\s*plan\s*[,}]/;                 //  { plan }
const FIELD_PATH = /(^|[,(\s])(['"`])plan\2\s*,/;       //  updateDoc(ref, 'plan', 'pro')

const writesPlan = (args: string) =>
  KEYED.test(args) || SHORTHAND.test(args) || FIELD_PATH.test(args);

/**
 * 🔴 BOTH IMPORT STYLES, and that is the second gap this ticket closed. THE-259's
 * browser-SDK detector gated on a STATIC `from 'firebase/firestore'`; the write
 * it missed used `await import('firebase/firestore')`, which is how this
 * codebase ordinarily reaches Firestore from a click handler.
 */
const STATIC_SDK = /from\s+['"]firebase\/firestore['"]/;
const DYNAMIC_SDK = /import\s*\(\s*['"]firebase\/firestore['"]\s*\)/;

/**
 * Every client-SDK write of `plan` in this source. Empty = clean.
 *
 * 🔴 NOT SCOPED TO A COLLECTION. THE-259's entitlement detector required the
 * argument list to mention `'tenants'`, and the write that shipped targeted
 * `doc(db, 'users', uid)`. The rule is "the webhook is the single writer of
 * `plan`" — it does not say "on tenant documents". Any document.
 */
export function planWritesIn(source: string): string[] {
  const clean = stripComments(source);
  if (!STATIC_SDK.test(clean) && !DYNAMIC_SDK.test(clean)) return [];
  const offences: string[] = [];
  for (const fn of CLIENT_WRITES) {
    for (const args of callArguments(clean, fn)) {
      if (writesPlan(args)) offences.push(`${fn}(${args.trim().replace(/\s+/g, ' ').slice(0, 90)}…)`);
    }
  }
  return offences;
}

/** Every source file under `src/` that ships to a browser — tests excluded. */
const CLIENT_FILES = walk(SRC).filter((f) => !f.includes('__tests__') && !f.includes('/test/'));

/* ═══════════════════════════════════════════════════════════════════════════
 * 1 — the whole ticket
 * ═══════════════════════════════════════════════════════════════════════════ */

describe('1 · no client-side write to plan exists anywhere', () => {
  it('🔴 no file under src/ writes plan through the client SDK, in any collection', () => {
    const offenders = CLIENT_FILES.map((file) => ({
      file,
      offences: planWritesIn(read(file)),
    })).filter((r) => r.offences.length > 0);

    expect(
      offenders.map((o) => `${o.file}: ${o.offences.join(', ')}`),
      'the webhook is the single writer of `plan` — the UI asks and re-reads, it never applies what it asked for',
    ).toEqual([]);
  });

  it('the specific write this ticket removed is gone, by shape and not by line number', () => {
    const dash = read('src/components/AdminDashboard.tsx');
    expect(dash, 'the plan write is back in AdminDashboard').not.toMatch(/updateDoc\([^)]*\)\s*,\s*\{\s*plan\s*\}/);
    expect(dash, 'the dead onChangePlan prop is back').not.toContain('onChangePlan');
    expect(dash, 'the dead onCancelPlan prop is back').not.toContain('onCancelPlan');
    expect(dash, 'planStatus is written from the client again').not.toContain('planStatus');
  });

  it('AdminSettings no longer accepts a plan-mutating callback at all', () => {
    // The socket is gone, not just what was plugged into it. A required prop
    // nobody calls is exactly where the write lived for two tickets.
    const settings = read('src/components/AdminSettings.tsx');
    const declarations = stripComments(settings);
    expect(declarations, 'onChangePlan is a prop again').not.toContain('onChangePlan');
    expect(declarations, 'onCancelPlan is a prop again').not.toContain('onCancelPlan');
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * 2 — teeth
 * ═══════════════════════════════════════════════════════════════════════════ */

describe('2 · the sweep catches a planted violation', () => {
  it('every evasive spelling of the write is caught', () => {
    // The exact shape that shipped: dynamic import, shorthand, non-tenant doc.
    expect(planWritesIn(
      `const { updateDoc, doc } = await import('firebase/firestore');
       await updateDoc(doc(db, 'users', auth.currentUser.uid), { plan });`,
    ), 'the shape that shipped on main is not caught').toHaveLength(1);

    expect(planWritesIn(
      `import { doc, updateDoc } from 'firebase/firestore';
       await updateDoc(doc(db, 'tenants', id), { plan: 'pro', updatedAt: now });`,
    )).toHaveLength(1);

    expect(planWritesIn(
      `import { updateDoc } from 'firebase/firestore';
       await updateDoc(doc(db, 'tenants', id), 'plan', 'pro');`,
    )).toHaveLength(1);

    expect(planWritesIn(
      `import { setDoc } from 'firebase/firestore';
       await setDoc(doc(db, 'anythingElse', id), { plan: nextPlan }, { merge: true });`,
    ), 'a collection other than tenants/users slips through').toHaveLength(1);
  });

  it('and does not fire on things that are not the violation', () => {
    // A comment about the rule, the add-on set, and a field that merely starts
    // with the word — `planStatus` is not `plan`, and a sweep that cannot tell
    // them apart gets muted by the first false positive.
    expect(planWritesIn(
      `import { updateDoc } from 'firebase/firestore';
       // never write { plan: 'pro' } from the client
       await updateDoc(doc(db, 'tenants', id), { addons: owned });`,
    )).toEqual([]);

    expect(planWritesIn(
      `import { updateDoc } from 'firebase/firestore';
       await updateDoc(doc(db, 'tenants', id), { planLabel: shown, planned: true });`,
    )).toEqual([]);

    // A server route using the Admin SDK is the sanctioned writer, not a client.
    expect(planWritesIn(
      `import { getFirestore } from 'firebase-admin/firestore';
       await ref.update({ plan: confirmed });`,
    )).toEqual([]);
  });

  it('🔴 the sweep is repo-wide, so a violation planted in ANY file is seen', () => {
    // A sweep scoped to the file that happened to be broken is not a sweep.
    // Every shipping source file under src/ is in the corpus — so planting the
    // write somewhere else fails test 1 by name, rather than passing quietly.
    expect(CLIENT_FILES.length).toBeGreaterThan(400);
    for (const required of [
      'src/components/AdminDashboard.tsx',
      'src/components/AdminSettings.tsx',
      'src/components/settings/PlanUpgradeSection.tsx',
      'src/components/AdminUpgradePage.tsx',
      'src/contexts/TenantContext.tsx',
    ]) {
      expect(CLIENT_FILES, `${required} is outside the swept corpus`).toContain(required);
    }

    // And the corpus is derived, not listed: every .ts/.tsx under src/ that is
    // not a test is in it, so a NEW file cannot be born outside the sweep.
    const everyShippingFile = walk(SRC).filter(
      (f) => !f.includes('__tests__') && !f.includes('/test/'),
    );
    expect(CLIENT_FILES.slice().sort()).toEqual(everyShippingFile.slice().sort());
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * 3 — the surface re-reads instead
 * ═══════════════════════════════════════════════════════════════════════════ */

describe('3 · the plan surface asks and re-reads, it does not write', () => {
  it('the live plan change runs through the Dodo route and then arms the refresh window', () => {
    const plan = read('src/components/settings/PlanUpgradeSection.tsx');
    expect(plan, 'the plan change no longer runs through runDodoPlanChange').toContain('runDodoPlanChange');
    expect(plan, 'the THE-217 refresh window is no longer armed').toContain('armPlanRefresh()');
    expect(planWritesIn(plan), 'the plan surface writes plan itself').toEqual([]);
  });

  it('there is still exactly one refresh mechanism, not a second one minted here', () => {
    const ctx = read('src/contexts/TenantContext.tsx');
    expect(ctx).toContain('armPlanRefresh');
    expect(ctx).toContain('refreshTenantPlan');

    // Every caller of the re-read uses the context's, so removing the write did
    // not introduce a parallel path.
    //
    // ⚠️ A CALL, not a mention. Matching the bare name swept up this ticket's own
    // comment in AdminSettings and the reason string in `settings/autosave.ts`,
    // both of which name the function precisely because it is the right one.
    // The two real callers reach it off the context: `tenant?.armPlanRefresh()`.
    const armers = CLIENT_FILES.filter((f) =>
      /\.\s*armPlanRefresh\s*\(\s*\)/.test(stripComments(read(f))),
    );
    expect(armers.slice().sort(), 'a new plan-refresh mechanism appeared').toEqual([
      'src/components/AdminUpgradePage.tsx',
      'src/components/settings/PlanUpgradeSection.tsx',
    ]);
  });

  it('AdminDashboard reads the plan from context and passes it down, rather than setting it', () => {
    const dash = read('src/components/AdminDashboard.tsx');
    expect(dash, 'the dashboard stopped reading the plan from the tenant context').toMatch(
      /tenantPlan/,
    );
    expect(planWritesIn(dash), 'the dashboard writes plan again').toEqual([]);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * 4 — nothing is applied before it is confirmed
 * ═══════════════════════════════════════════════════════════════════════════ */

describe('4 · a failed or unconfirmed change never applies optimistically', () => {
  it('no surface reloads the page to make a self-written plan look applied', () => {
    // `window.location.reload()` straight after a write is the optimistic tell:
    // it exists to re-render against what the client just claimed.
    for (const file of CLIENT_FILES) {
      const src = stripComments(read(file));
      if (!/window\.location\.reload/.test(src)) continue;
      expect(
        planWritesIn(src),
        `${file} writes plan and then reloads to show its own write as fact`,
      ).toEqual([]);
    }
  });

  it('the entitlement the UI shows comes from the tenant document, not from the request', () => {
    // The requested plan is an argument to the Dodo call; what the UI shows is
    // whatever the re-read found. If these were ever the same expression, a
    // declined card would still look like an upgrade.
    const ctx = read('src/contexts/TenantContext.tsx');
    expect(ctx, 'the refresh no longer sources the plan from a snapshot read')
      .toMatch(/refreshTenantPlan/);
    expect(planWritesIn(ctx), 'the context writes the plan it was asked for').toEqual([]);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * 5-8 — no-regression pins
 * ═══════════════════════════════════════════════════════════════════════════ */

describe('5 · the money path is byte-identical', () => {
  /**
   * Pinned from `origin/main` at 902763a, where this branch started.
   *
   * ⚠️ A SET per file, not one digest, since THE-302. Two of these files
   * legitimately move — the webhook route and its dispatcher were where THE-302
   * fixed a silent write loss — and this guard's claim is "THE-291's client-write
   * removal did not touch the billing path", not "the billing path is frozen".
   *
   * 🔴 APPENDED, NEVER SUBSTITUTED, and each value names the change that
   * produced it. A value that is NEITHER still fails, which is the threat this
   * guard exists for. `main` was red for everyone last week because #434
   * substituted instead of appending; that is the mistake this shape prevents.
   */
  const UNTOUCHED: Readonly<Record<string, ReadonlyArray<readonly [digest: string, source: string]>>> = {
    'src/utils/plan-change.ts': [
      ['71b2aa42dd1e97b36107197cca459c666ed9027c01c0e85e7af9d2b2e27a6fe7', 'main at 902763a'],
    ],
    'src/lib/dodo/plan-change.ts': [
      ['7f583417d59d476ddc41c6530acbfe3cd9dcaaf9e8d15279842b9d3db984ce9f', 'main at 902763a'],
    ],
    'src/app/api/dodo/webhook/route.ts': [
      ['0a30ca691739b717a65aa9dfe0f4c168ad2ec6ae12510b1a574847fd8ede9270', 'main at 902763a'],
      ['3159d251fa9dfa7070a768ecaa3ad1b6f00f03b9b1eeb6f0b46f46d0319be596', 'THE-302 — a failed reservation is answered 5xx instead of 200'],
    ],
    'src/app/api/dodo/change-plan/route.ts': [
      ['5ec0e4ce1bd22586e148d78dfb87f690ff6000f4519d81c0c3db48c224d6e298', 'main at 902763a'],
    ],
    'src/lib/dodo/webhook-dispatch.ts': [
      ['6d5d6e18824efa41eb2b00273c60d8a4724eb15a9f9559fe83913950e07d0e5e', 'main at 902763a'],
      ['a54e6e033ba8c9aae59189b8e1ae85ef0cf80c8602caf3ffda4fb028928dafab', 'THE-302 — `unreserved` outcome and a bounded store timeout'],
    ],
    'src/components/settings/PlanUpgradeSection.tsx': [
      ['47311df03e1ca76cb51e5094360c2ef868e14f1d9bb6c70509a48fdff174a553', 'main at 902763a'],
      /* 🔴 APPENDED BY THE-335, nothing above removed. THE-291's claim is
         untouched and this file still contains NO client-side plan write: what
         moved is the in-app plan CARDS' feature list, which now withholds its
         'Newsletter' line behind NEWSLETTER_FEATURE_ENABLED exactly as it
         already withholds 'SMS Automation' and 'Custom Domain'. The
         `newsletterAutomation` CELL is untouched, so the tiers that own the
         newsletter still own it and get the line back with the switch. */
      ['667a71285e506773f0d137654584f9c7ded1eedcb8de8998908b9b1aa2a9c935', 'main + THE-335 — the Newsletter card line withheld behind its master switch'],
    ],
  };

  it.each(Object.entries(UNTOUCHED))('%s is untouched', (file, accepted) => {
    const actual = sha256(readFileSync(path.join(REPO, file)));
    const match = accepted.find(([digest]) => digest === actual);
    expect(
      match,
      `${file} is at ${actual}, which is none of:\n  ` +
        accepted.map(([d, why]) => `${d} (${why})`).join('\n  '),
    ).toBeTruthy();
  });

  it('and THE-291\'s own claim still holds — neither file grew a plan write', () => {
    // 🔴 The reason the set above is safe. THE-291 removed a client-side write
    // to `plan`; loosening its digest pin to a set would be worthless if it did
    // not keep asserting the thing the digest was standing in for. So the claim
    // is restated directly against the two files that moved.
    for (const file of ['src/app/api/dodo/webhook/route.ts', 'src/lib/dodo/webhook-dispatch.ts']) {
      const code = read(file);
      expect(code, `${file} started writing plan`).not.toMatch(/\bplan\s*:/);
      expect(code, `${file} started writing to Firestore directly`).not.toMatch(/adminDb\.collection\(['"]tenants['"]\)/);
    }
  });

  it('no new API route was added to replace the write', () => {
    const routes = walk(path.join(SRC, 'app/api'))
      .filter((f) => path.basename(f) === 'route.ts')
      .sort();
    // A count, not a manifest: the claim is "this ticket added none", and the
    // digests above already pin the plan routes themselves.
    // 🔴 A LITERAL, not a count re-derived from the repo. A baseline the guard
    // computes for itself at assertion time cannot fail; it only describes
    // whatever it was handed. Pinned from `origin/main` at 902763a.
    //
    // ⚠️ 114 SINCE THE-314, and the one it added is named rather than absorbed
    // into a moved number: `app/api/sms/numbers/route.ts`, which buys, shows and
    // releases a ministry's phone number. It is a MONEY path, so it is exactly
    // the kind of route this guard exists to notice — and it passes THE-291's
    // own claim, asserted directly below: it writes no `plan`, no feature flag
    // and no add-on count. Buying a number is not granting a capability; the
    // capability is the Ministry plan, and the Dodo webhook remains its only
    // writer.
    //
    // ⚠️ 116 SINCE THE-324, and both are NAMED rather than absorbed into a moved
    // number: `app/api/rota/invitations/route.ts` (an admin lists invitations
    // and sends them) and `app/api/rota/respond/route.ts` (a signed-out
    // volunteer accepts or declines with a token). Both exist precisely so
    // `firestore.rules` needs no change — the collection they own has no rule
    // and therefore no client access — and BOTH pass THE-291's own claim,
    // asserted below: neither writes `plan`, a feature flag or an add-on count.
    // The invitations route READS entitlement (SMS is Ministry-only) to decide
    // what the panel SAYS; the real gate is inside THE-314's send funnel. The
    // Dodo webhook remains the only writer of a capability.
    // 117 SINCE THE-346, and the one it adds is NAMED rather than absorbed into
    // a moved number: `app/api/docs/public-share/route.ts`, which mints and
    // revokes the public web link for one note. It exists for exactly the
    // reason THE-324's two above do - the collection it owns,
    // `publicNotes/{token}`, has NO rule and therefore no client access, so
    // `firestore.rules` needs no change and is byte-identical. And it passes
    // THE-291's own claim, asserted below: it writes no `plan`, no feature flag
    // and no add-on count. Publishing a note is not granting a capability; the
    // Dodo webhook remains the only writer of one.
    // 118 SINCE THE-350, and the one it adds is NAMED rather than absorbed into
    // a moved number: `app/api/donations/manual/route.ts`, which records a gift
    // no payment rail processed. It exists for exactly the reason THE-324's two
    // and THE-346's one above do — `firestore.rules` needs no change and is
    // byte-identical. The invoices collection is gated on `manageAccounting`
    // while the admin recording a gift in the CRM holds `manageCRM`, so rather
    // than loosening a rule that auto-deploys with no emulator tests, the write
    // goes through the Admin SDK behind a route that imposes
    // `requireTenantPermission(request, tenantId, 'manageCRM')` itself.
    //
    // 🔴 AND IT PASSES THE-291'S OWN CLAIM, asserted below: it writes no `plan`,
    // no feature flag and no add-on count. AN INVOICE IS NOT AN ENTITLEMENT —
    // recording that a church received money says nothing about what the church
    // may do, and the Dodo webhook remains the only writer of a capability.
    /**
     * ─── 118 → 121, APPENDED BY THE-351 ───────────────────────────────────────
     *
     * Three routes, and every one of them is named in the loop below so the
     * count cannot move for an unnamed reason. They exist because a church can
     * now be paid for an event ticket THROUGH ITS OWN PAYPAL and confirms each
     * payment by hand:
     *
     *   · `event-payment/claim`   the member says they have paid. 🔴 Writes no
     *                             money state whatsoever — a claim flag and a
     *                             timestamp, nothing else.
     *   · `event-payment/inbox`   reads the queue of unconfirmed claims.
     *   · `event-payment/confirm` an admin vouches. Calls THE-350's writer.
     *
     * 🔴 AND ALL THREE PASS THE-291'S OWN CLAIM, asserted below beside
     * THE-350's: none of them writes `plan`, a feature flag or an add-on count,
     * and none touches the tenant document at all. A CONFIRMED TICKET IS NOT AN
     * ENTITLEMENT — a church recording that a member paid for a seat says
     * nothing about what that church may do, and the Dodo webhook remains the
     * single writer of a capability.
     */
    /**
     * ─── 121 -> 122, THE-355 ─────────────────────────────────────────────────
     *
     * ONE route: `event-payment/public-claim`. THE-351's claim route sits behind
     * `requireAuth` and is reached from the LOGGED-IN member app; for a crusade,
     * where most attendees have no account and never will, that reaches nobody.
     * No public registrant could say they had paid, so no claim was ever
     * created, so the church's inbox was correctly empty about a thing that had
     * never happened — which is the founder's own bug report.
     *
     * 🔴 IT PASSES THE-291'S CLAIM FOR THE SAME REASON ALL THREE OF THE-351'S
     * DO, and more narrowly. It writes THREE fields on ONE registration — a
     * claim flag, a timestamp and the inbox queue key — and there is no branch
     * in it that writes `paymentStatus`, `paymentInvoiceId` or `amount`, let
     * alone `plan`, a feature flag or an add-on count. It does not touch the
     * tenant document except to READ the church's name for a notification. A
     * CLAIMED TICKET IS NOT AN ENTITLEMENT — and it is not even a payment — so
     * the Dodo webhook remains the single writer of a capability.
     *
     * ⚠️ IT IS UNAUTHENTICATED, WHICH IS THE POINT AND IS NOT A WIDENING. It
     * carries no session because a logged-out registrant has none; what it
     * carries instead is a stored 256-bit token minted for one registration,
     * and the route finds the document BY that token rather than accepting a
     * `registrationId` to check against it — so there is no expressible request
     * that names somebody else's seat.
     */
    /**
     * ─── 122 -> 123, THE-369 ─────────────────────────────────────────────────
     *
     * ONE route: `crm/contact-activities/[activityId]`. A church could not
     * remove a SINGLE row from a contact's timeline - a note typed on the wrong
     * contact, a call logged twice - and the DELETE that already existed on the
     * collection deletes ALL of a contact's activities for THE-362's cascade.
     *
     * 🔴 IT IS A SECOND ROUTE PRECISELY SO THE FIRST ONE DOES NOT MOVE. The
     * cascade's contract is that deleting a PERSON keeps their receipts; this
     * ticket's is that deliberately deleting ONE GIFT takes its receipt with it.
     * Two different acts, two different answers, and the collection route stays
     * byte-identical rather than growing a branch that decides between them from
     * a query string.
     *
     * 🔴 IT PASSES THE-291'S CLAIM, and the sweep below asserts it: it deletes
     * one `contactActivities` document and, when the row points at a gift the
     * CRM itself recorded, one `tenants/{t}/invoices` document. It never touches
     * the TENANT document, where `plan` and `addons` live and which only the
     * Dodo webhook may write. DELETING A RECEIPT IS NOT AN ENTITLEMENT CHANGE -
     * a church correcting its own books says nothing about what that church may
     * do - so the Dodo webhook remains the single writer of a capability.
     */
    // APPENDED FOR #517 — the public /api/waitlist product-updates capture, merged
    // with CI red, so this count never moved with it. It writes a
    // `product_updates` document and never the tenant document, so it applies
    // no entitlement; it is named in the list below like every other addition.
    /**
     * --- 124 -> 125, the founder CRM newsletter export (ClickUp 86bc7g0uz) ---
     *
     * ONE route: `admin/crm-export`. A super admin on the apex domain downloads
     * the platform CRM (every church's accounts plus platform contacts) as CSV,
     * filtered by newsletter consent, type and search. It is gated by
     * `requireSuperAdmin` and it ONLY READS: `users`, `contacts` and the
     * `tenants` documents for church names. It passes THE-291's claim, asserted
     * in the loop below: it writes nothing at all, so it cannot write the tenant
     * document, a `plan`, a feature flag or an add-on count.
     */
    expect(routes.length, 'an API route was added or removed').toBe(125);
    expect(
      routes.some((f) => f.endsWith(path.join('app/api/sms/numbers/route.ts'))),
      'the route THE-314 added is missing — the count moved for some other reason',
    ).toBe(true);
    for (const added of [
      'app/api/rota/invitations/route.ts',
      'app/api/rota/respond/route.ts',
      'app/api/docs/public-share/route.ts',
      'app/api/donations/manual/route.ts',
      // APPENDED BY THE-351 — see the note on the count above.
      'app/api/event-payment/claim/route.ts',
      'app/api/event-payment/inbox/route.ts',
      'app/api/event-payment/confirm/route.ts',
      // APPENDED BY THE-355 — see the note on the count above.
      'app/api/event-payment/public-claim/route.ts',
      // APPENDED BY THE-369 — see the note on the count above.
      'app/api/crm/contact-activities/[activityId]/route.ts',
      // APPENDED FOR #517 — see the note on the count above.
      'app/api/waitlist/route.ts',
      // APPENDED FOR the founder CRM export — see the note on the count above.
      'app/api/admin/crm-export/route.ts',
    ]) {
      expect(
        routes.some((f) => f.endsWith(path.join(added))),
        `${added} is missing — the count moved for some other reason`,
      ).toBe(true);
    }
    // And it applies no entitlement, which is the property #434 removed and
    // THE-259's sweep catches.
    //
    // ⚠️ ASSERTED ON THE WRITE, NOT ON THE WORD. The route READS `plan` — it
    // has to, because it refuses a purchase from a tier that does not carry
    // SMS — so a bare `/plan\s*:/` sweep would flag the ternary that reads it
    // and say nothing about entitlement at all. What must not exist is a WRITE
    // to the tenant document, which is where `plan` and `addons` live and which
    // only the Dodo webhook may touch.
    const numbers = read('src/app/api/sms/numbers/route.ts');
    expect(numbers, 'the number purchase route writes to the tenant document')
      .not.toMatch(/collection\(['"]tenants['"]\)\s*\.doc\([^)]*\)\s*\.(set|update|delete)\(/);
    // It reads the tenant doc, and only reads it.
    expect(numbers, 'the number purchase route stopped checking entitlement')
      .toMatch(/collection\(['"]tenants['"]\)\.doc\([^)]*\)\.get\(\)/);

    /**
     * 🔴 THE-350's route, held to the same claim and for the same reason: an
     * INVOICE IS NOT AN ENTITLEMENT. It writes one document, into
     * `tenants/{t}/invoices`, and never touches the tenant document itself —
     * which is where `plan` and `addons` live and which only the Dodo webhook
     * may write. #434 removed a client-side `plan` write and THE-259's sweep
     * catches its return; this is the same property, asserted on the write.
     */
    for (const rel of [
      'src/app/api/donations/manual/route.ts',
      'src/lib/manual-donation.ts',
      /**
       * 🔴 THE-351's three, held to exactly the same claim. The confirm route
       * writes ONE registration document and delegates the money to THE-350's
       * writer above; the claim route writes three non-money fields on the same
       * document; the inbox route only reads. None of them may reach the tenant
       * document, where `plan` and `addons` live.
       */
      'src/app/api/event-payment/claim/route.ts',
      'src/app/api/event-payment/inbox/route.ts',
      'src/app/api/event-payment/confirm/route.ts',
      /**
       * 🔴 THE-369's single-activity delete, held to the same claim. It is the
       * first route in this list that DELETES from `tenants/{t}/invoices`
       * rather than adding to it, which makes the claim sharper rather than
       * weaker: a receipt removed is still not a capability, and the route may
       * not reach the tenant document itself on the way to the subcollection.
       */
      'src/app/api/crm/contact-activities/[activityId]/route.ts',
      /**
       * The founder CRM export, held to the same claim. It is read-only: the
       * tenant document is only ever fetched (`getAll`) for a church name.
       */
      'src/app/api/admin/crm-export/route.ts',
    ]) {
      const src = read(rel);
      expect(src, `${rel} writes to the tenant document`)
        .not.toMatch(/collection\(['"]tenants['"]\)\s*\.doc\([^)]*\)\s*\.(set|update|delete)\(/);
      expect(src, `${rel} writes a plan, a feature flag or an add-on count`)
        .not.toMatch(/\b(plan|addons|features?)\s*:\s*['"{]/);
    }
    expect(numbers, 'the number purchase route writes an add-on count').not.toMatch(/addons\s*:/);
  });
});

describe('6 · no plan cap or price changed', () => {
  it('the nine plan prices are exactly what they were', () => {
    expect(PLAN_PRICING).toEqual({
      plus: { monthly: 20, quarterly: 54, yearly: 190 },
      pro: { monthly: 40, quarterly: 108, yearly: 380 },
      // ⚠️ THE-343 repriced Ministry ($80→$60, and THE-372 back to $80, with the quarter and year
      // following at the same 10% / >20% discounts). `plus` and `pro` are
      // enumerated so a reprice that overreached its brief still fails here.
      max: { monthly: 80, quarterly: 216, yearly: 752 },
    });
  });

  it('every plan cap is exactly what it was', () => {
    const caps = Object.fromEntries(
      PLAN_ORDER.map((p) => {
        const f = getPlanFeatures(p);
        return [p, { maxCourses: f.maxCourses, maxAdmins: f.maxAdmins, maxContacts: f.maxContacts }];
      }),
    );
    // ⚠️ THE CONTACT CAPS MOVED IN THE-370 — 150 → 500, 500 → 2,000,
    // 2,000 → 4,000, with free's 500 unchanged. Transcribed rather than relaxed
    // so this keeps guarding `maxCourses` and `maxAdmins`, which did not move.
    expect(caps).toEqual({
      free: { maxCourses: 1, maxAdmins: 1, maxContacts: 500 },
      plus: { maxCourses: 2, maxAdmins: 2, maxContacts: 500 },
      pro: { maxCourses: 5, maxAdmins: 5, maxContacts: 2_000 },
      max: { maxCourses: 15, maxAdmins: 15, maxContacts: 4_000 },
    });
  });

  it('plan-features.ts is byte-identical to its THE-314 pin', () => {
    // ⚠️ REPINNED ONCE, FOR THE-314, AND THE REASON IS RECORDED RATHER THAN THE
    // OLD DIGEST BEING SILENTLY SWAPPED. THE-291's claim is that no CLIENT-SIDE
    // PLAN WRITE exists, and that claim is unaffected: what moved in this file
    // is four feature cells — `smsAutomation` and `textToGive`, true → false on
    // plus and pro — because SMS became Ministry-only when Harvest started
    // reselling. The per-cell contract in plan-features.test.ts and the matrix
    // digest in the-248-discount-alignment.test.ts moved in the same commit.
    //
    // 🔴 NO PRICE MOVED, asserted directly above this and separately by the
    // cross-repo price contract, which throws at module scope during the
    // marketing site's prerender if the two repos disagree on any of the nine.
    //
    // 🔴 REPINNED AGAIN FOR THE-335, and the reason is recorded rather than the
    // old digest being silently swapped. THE-291's claim is again unaffected:
    // what moved is `crm`, true → false on FREE, and a NEW `signups` cell true
    // on every tier — the founder's split, "the free plan should have signup
    // feature not CRM since we separated them". It needed a second cell because
    // `AdminDashboard` gated BOTH the CRM screen and the Signups screen on
    // `crm`, so flipping it alone would have taken Signups — and the analytics
    // that lives on it — away in the same edit. NO PRICE AND NO CAP MOVED, both
    // asserted directly above, and the cross-repo price contract still throws at
    // module scope during the marketing site's prerender.
    //
    // 🔴 REPINNED AGAIN FOR THE-343, and again the reason is recorded rather
    // than the digest silently swapped. THE-343 is a REPRICE: `PLAN_PRICING.max`
    // goes 80/216/760 → 60/162/564, plus three comment blocks that named the old
    // figures. THE-291's claim is untouched by it — a price is not an
    // entitlement, and this file's subject is that NOTHING WRITES `plan` FROM
    // THE CLIENT. That claim is asserted by `planWritesIn` above and is
    // independent of what any tier costs.
    //
    // ⚠️ THIS IS THE FIRST REPIN HERE THAT MOVED A PRICE, so the sentence the
    // three previous notes carried — "NO PRICE MOVED" — is deliberately NOT
    // repeated. The caps did not move (asserted directly above), the feature
    // matrix did not move, and the cross-repo price contract still throws at
    // module scope during the marketing site's prerender — which is what makes
    // a one-sided reprice a failed build rather than a false advertisement.
    //
    // 🔴 REPINNED AGAIN FOR THE-353, and again the reason is recorded rather
    // than the digest silently swapped. THE-353's change to this file is a
    // COMMENT ONLY: the `DODO_BILLING_ENABLED` rollback docblock claimed
    // flipping the flag "returns to Stripe with no other edit", true when
    // written and false once the Stripe platform account was closed as
    // `rejected.fraud` — a future agent trusting that comment would route
    // every new-ministry signup at a dead account. No plan cap, no price, no
    // feature cell and no code path changed; THE-291's claim (no CLIENT-SIDE
    // plan write exists) is unaffected because nothing here executes.
    //
    // 🔴 REPINNED AGAIN FOR THE-370, and again the reason is recorded rather
    // than the digest silently swapped. THE-370 is a CAP CHANGE and an ADD-ON
    // RETIREMENT: `maxContacts` goes 150 → 500, 500 → 2,000 and 2,000 → 4,000;
    // `maxChurches` goes 1 → UNLIMITED_CAP on all three paid tiers (free stays
    // 0); `CONTACTS_PER_PACK` is deleted; `NO_ADDONS`, `readTenantAddons` and
    // `getEffectiveFeatures` lose the `contactPacks` and `campuses` fields with
    // the two Dodo products the founder detached; and `UNLIMITED_CAP` moves
    // above `PLAN_FEATURES` so the matrix can name the sentinel it now carries.
    //
    // THE-291's claim is untouched by all of it. This file's subject is that
    // NOTHING WRITES `plan` FROM THE CLIENT — asserted by `planWritesIn` above
    // and independent of what any tier includes or costs. The webhook is still
    // the single writer.
    //
    // 🔴 NO PRICE MOVED. The nine plan prices are asserted directly above, and
    // the cross-repo price contract still throws at module scope during the
    // marketing site's prerender if the two repos disagree on any of them.
    //
    // Previous pins:
    //   cd4fbdd58f6dbbcbd180aeab00a63f1c9be3189c9010ff7a844a0f8e817af403 (pre-THE-314)
    //   f43327552f7c774586dabc040ac8da0d31bf4f84023d70af3b2f428024f7f570 (pre-THE-335)
    //   db4bd86a93fa34691da21bbb9b1dcdea9d3d37f932784d50177ad3b736c11d75 (pre-THE-343)
    //   11f9c533ddaffcf89614219f2d9b37b201e218bc421d923a75fc9d38bf63ffcf (pre-THE-353)
    //   017c56ceda3c0032ac9f5c08468a225ae975a029e4f8cb8a6d73033a14ec4c82 (pre-THE-370)
    //
    // 🔴 FROM THE-372 ON THE PIN IS APPENDED, NEVER SUBSTITUTED: each entry
    // names the ticket that left the file in that state, and the file must
    // match the LAST. The THE-370 value above is the first entry, unchanged.
    //
    // THE-372 is a REPRICE and nothing else: `PLAN_PRICING.max` goes
    // 60/162/564 → 80/216/752 (the founder's $80, with THE-343's ratios kept),
    // matching the three live Dodo products, plus two comment blocks that
    // named the old figures. No cap, no feature cell, no code path. THE-291's
    // claim — nothing writes `plan` from the client — is independent of price.
    const PLAN_FEATURES_PINS: ReadonlyArray<readonly [ticket: string, digest: string]> = [
      ['THE-370', '9b1be3db2c7287216084f46fb1dc15c8caff3d680f0dbb9d53db2ea59d564a92'],
      ['THE-372', '36f2b6c26662c4a5d95e7de4b15b8482a190c54a134f08c104fc209806352d5c'],
    ];
    expect(sha256(readFileSync(path.join(REPO, 'src/utils/plan-features.ts')))).toBe(
      PLAN_FEATURES_PINS[PLAN_FEATURES_PINS.length - 1][1],
    );
  });
});

describe("7 · THE-286's settings autosave is undisturbed", () => {
  it('AdminSettings is still on the autosave exclusion list, with Cancel behind its confirm panel', () => {
    const autosave = read('src/components/settings/autosave.ts');
    expect(autosave, 'the autosave exclusion list lost AdminSettings').toContain(
      'src/components/AdminSettings.tsx',
    );
    const settings = read('src/components/AdminSettings.tsx');
    expect(settings, 'Cancel Subscription no longer goes through its confirm panel').toContain(
      'setShowCancelConfirm(true)',
    );
    expect(settings, 'AdminSettings picked up the autosave hook').not.toContain('useAutosaveField');
  });
});

describe('8 · firestore.rules and functions/ are byte-identical', () => {
  it('firestore.rules is untouched', () => {
    expect(rulesDigestFailure(),
      'firestore.rules is at a digest no ticket recorded — it auto-deploys to production').toBeNull();
  });

  it('functions/ is untouched', () => {
    // A manifest of path + content, so a DELETED or ADDED file fails too.
    const walkAll = (dir: string): string[] =>
      readdirSync(dir).flatMap((name) => {
        if (name === 'node_modules' || name === 'lib' || name === '.git') return [];
        const full = path.join(dir, name);
        return statSync(full).isDirectory() ? walkAll(full) : [full];
      });
    const root = path.join(REPO, 'functions');
    const manifest = walkAll(root)
      .sort()
      .map((f) => `${path.relative(REPO, f)}:${sha256(readFileSync(f))}`)
      .join('\n');
    expect(sha256(manifest), 'functions/ changed').toBe(
      // Pinned from `origin/main` at 902763a, where this branch started.
      '1a3a1c7f27699263bcdf5bd0320c7cb0803a6f76644952f631000bc9bedef2d7',
    );
  });
});

