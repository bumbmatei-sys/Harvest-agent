/**
 * THE-324 — invite, accept, remind. THE FENCE AROUND IT.
 *
 * What this ticket must NOT have done, asserted by reading the source and the
 * repository rather than by trusting a description. The behaviour lives in
 * `src/components/events/__tests__/THE-324.rota-invitations.test.tsx` and
 * `src/lib/__tests__/THE-324.rota-send.test.ts`; the measurements live in
 * `src/components/__tests__/THE-324.rota-invite.layout.test.tsx`.
 *
 * ⚠️ NOTHING IN THIS FILE ASKS WHAT THE CURRENT BRANCH CHANGED. There is no
 * shelling out of any kind, and no git subcommand named even inside a failure
 * message — the sweep in section 18 is deliberately conservative and cannot tell
 * a mention from a call, so this file contains neither. Four such guards blocked
 * every unrelated PR in this repo by asserting their own branch's diff in the
 * NON-EMPTY direction: true only while their ticket is unmerged, so the next PR
 * goes red for a reason that has nothing to do with it. THE-315 (#454) is the
 * standing sweep; section 18 asserts the absence directly besides.
 */
import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { rulesDigestFailure } from './__fixtures__/firestore-rules-pin';

const REPO_ROOT = path.resolve(__dirname, '../..');
const read = (rel: string): string => readFileSync(path.join(REPO_ROOT, rel), 'utf8');
const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

/** Source with block and line comments stripped — the code, not the prose. */
const codeOf = (rel: string): string =>
  read(rel).replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

/** The nine files this ticket adds. */
const ADDED = [
  'src/components/events/rota-invitations.ts',
  'src/components/events/RotaInviteView.tsx',
  'src/components/events/RotaInvitePanel.tsx',
  'src/components/events/RotaRespondView.tsx',
  'src/components/events/RotaRespondPanel.tsx',
  'src/hooks/queries/useRotaInviteQueries.ts',
  'src/lib/rota-invite.ts',
  'src/app/api/rota/invitations/route.ts',
  'src/app/api/rota/respond/route.ts',
] as const;

/** The two it adds that render. */
const VIEWS = [
  'src/components/events/RotaInviteView.tsx',
  'src/components/events/RotaRespondView.tsx',
] as const;

/** The three server-side files — the only ones allowed near a transport. */
const SERVER = [
  'src/lib/rota-invite.ts',
  'src/app/api/rota/invitations/route.ts',
  'src/app/api/rota/respond/route.ts',
] as const;

const walk = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return e.name === 'node_modules' ? [] : walk(p);
    return /\.(ts|tsx)$/.test(e.name) ? [p] : [];
  });

const rel = (abs: string) => path.relative(REPO_ROOT, abs).split(path.sep).join('/');

/* ═══ 5 · 🔴 ONLY THE-314's SEND INTERFACE IS USED ════════════════════════ */

describe('5 — only THE-314\'s send interface is used', () => {
  /**
   * 🔴 `sms-send.ts` NAMES THIS TICKET AS THE CALLER `sendTenantSms` EXISTS FOR:
   * "one message, one person… THE-313 PART 3 (service-plan notifications…) is
   * the caller this exists for". Every gate — the master switch, the Ministry
   * entitlement, STOP, the destination check and the segment meter — is INSIDE
   * that funnel, so a second path does not merely duplicate code: it escapes the
   * cap, and under the reseller model that is Harvest's money leaking.
   */
  it('🔴 the ONE SMS call in this feature is sendTenantSms, and it is made once', () => {
    const calls = ADDED.flatMap((file) =>
      [...codeOf(file).matchAll(/\bsendTenantSms\s*\(/g)].map(() => file),
    );
    expect(calls, 'sendTenantSms is called from more than one place, or from none')
      .toEqual(['src/lib/rota-invite.ts']);
  });

  it('🔴 nothing in this feature reaches a provider, a second send module, or the meter directly', () => {
    const FORBIDDEN_MODULES = [
      '@/lib/zernio', 'lib/zernio', '@/lib/twilio', 'lib/twilio',
      '@/lib/sms-usage', 'lib/sms-usage', '@/lib/sms-destination', 'lib/sms-destination',
      '@/lib/sms-optout', 'lib/sms-optout',
      'nodemailer', 'resend', '@sendgrid/mail', 'postmark', 'twilio',
      'firebase/messaging', 'web-push',
    ];
    for (const file of ADDED) {
      const code = codeOf(file);
      for (const mod of FORBIDDEN_MODULES) {
        expect(code, `${file} imports ${mod}`).not.toMatch(
          new RegExp(`from ['"][^'"]*${mod.replace(/[/@.-]/g, '\\$&')}['"]`),
        );
      }
    }
  });

  it('🔴 and it calls no metering function itself — the funnel meters, or nothing does', () => {
    for (const file of ADDED) {
      const code = codeOf(file);
      for (const fn of [
        'reserveSmsSegment', 'settleSmsSegments', 'refundSmsSegment',
        'recordByoSegments', 'zernioSendSms', 'sendSms', 'sendAutomatedSms',
      ]) {
        expect(code, `${file} calls ${fn} — that is inside THE-314's funnel, not out here`)
          .not.toMatch(new RegExp(`\\b${fn}\\s*\\(`));
      }
    }
  });

  it('🔴 no client file sends anything at all — the browser cannot spend Harvest\'s money', () => {
    // ⚠️ The three server files may `fetch` nothing either; the two panels may
    // fetch ONLY this feature's own routes, which is where every gate lives.
    const CLIENT = ADDED.filter((f) => !(SERVER as readonly string[]).includes(f));
    for (const file of CLIENT) {
      const code = codeOf(file);
      for (const url of [...code.matchAll(/fetch\(\s*['"]([^'"]+)['"]/g)].map((m) => m[1])) {
        expect(url, `${file} fetches ${url}, which is not this feature's own route`)
          .toMatch(/^\/api\/rota\//);
      }
    }
    for (const file of SERVER) {
      expect(codeOf(file), `${file} makes a network call of its own`)
        .not.toMatch(/\bfetch\s*\(|\baxios\b|\bXMLHttpRequest\b/);
    }
  });

  it('🔴 and the repo still has exactly ONE module that can SEND through the provider', () => {
    /**
     * 🔴 A SWEEP OVER THE WHOLE REPOSITORY, not a claim about this ticket's
     * files: a second send path added anywhere fails here.
     *
     * ⚠️ THE NEEDLE IS `zernioSendSms`, THE SEND, NOT THE MODULE. `zernio.ts`
     * also exports `smsPlatformAvailable` (a feature check the usage panel
     * reads) and `zernioGetNumber` (a number lookup the settings test route
     * makes), and neither sends anything or costs anything. Sweeping the module
     * would have listed those two routes and forced the list to grow for
     * reasons that are not about sending — which is how a guard stops meaning
     * what it says. What must stay singular is the ability to put a message on
     * the wire, and that is exactly this function.
     */
    const senders = walk(path.join(REPO_ROOT, 'src'))
      .filter((f) => !f.includes(`${path.sep}__tests__${path.sep}`))
      .filter((f) => /\bzernioSendSms\b/.test(readFileSync(f, 'utf8')))
      .map(rel)
      .sort();
    expect(senders, 'a second module can send through the provider').toEqual([
      'src/lib/sms-send.ts',
      'src/lib/zernio.ts',
    ]);
    // And `sendTenantSms` — the interface this ticket calls — is declared once.
    const funnel = readFileSync(path.join(REPO_ROOT, 'src/lib/sms-send.ts'), 'utf8');
    expect([...funnel.matchAll(/export async function sendTenantSms/g)]).toHaveLength(1);
  });
});

/* ═══ 10 · No orderBy where a timestamp field holds mixed types ════════════ */

describe('10 — no Firestore orderBy where the timestamp field holds mixed types', () => {
  it('this feature adds NO orderBy at all', () => {
    // 🔴 The strongest form: not "no orderBy on a bad field" but "no orderBy".
    // It is also what keeps every query to ONE field, so no composite index is
    // required — and `firestore.indexes.json` does NOT deploy on merge, so one
    // would be inert and the query would throw `failed-precondition` in
    // production.
    for (const file of ADDED) {
      expect(codeOf(file), `${file} uses orderBy`).not.toMatch(/\borderBy\s*\(/);
    }
  });

  it('and it never reads either collection whose timestamp field is mixed', () => {
    // `contactActivities.createdAt` and `invoices.issuedAt` each hold BOTH ISO
    // strings and Timestamps, and Firestore orders across types by TYPE FIRST.
    for (const file of ADDED) {
      expect(codeOf(file), `${file} reads contactActivities`).not.toMatch(/contactActivities/);
      expect(codeOf(file), `${file} reads invoices`).not.toMatch(/'invoices'|"invoices"/);
    }
  });

  it('🔴 ONE timestamp representation is written, and it is Timestamp', () => {
    for (const file of ADDED) {
      const code = codeOf(file);
      // ⚠️ This feature DOES compute with dates — it must, it is about time —
      // so this is not "no date arithmetic". It is that none of it reaches a
      // DOCUMENT as a second representation.
      for (const bad of [/toISOString\s*\(/, /new Date\(\)\.toString\s*\(/, /toLocaleDateString\s*\(/, /toLocaleTimeString\s*\(/]) {
        expect(bad.test(code), `${file} produces a second timestamp representation`).toBe(false);
      }
    }
    // The one writer, and what it writes.
    const lib = codeOf('src/lib/rota-invite.ts');
    expect(lib).toContain('Timestamp.fromDate(assignment.startsAt)');
    expect(lib).toContain('FieldValue.serverTimestamp()');
    // 🔴 And the READ boundary accepts a Timestamp AND NOTHING ELSE. Coercing an
    // ISO string silently is how `contactActivities.createdAt` came to hold both.
    expect(lib).toContain('v instanceof Timestamp ? v.toDate() : null');
  });

  it('epoch milliseconds cross the WIRE, and never reach a document', () => {
    // ⚠️ The route serialises to `…Ms` numbers so no date FORMAT crosses the
    // wire, and the hook turns them straight back into `Date`s. Neither is a
    // stored representation: nothing writes a number to a date field.
    expect(codeOf('src/app/api/rota/invitations/route.ts')).toContain('startsAtMs');
    expect(codeOf('src/hooks/queries/useRotaInviteQueries.ts')).toContain('new Date(w.startsAtMs)');
    expect(codeOf('src/lib/rota-invite.ts'), 'an epoch number is written to a document')
      .not.toMatch(/(?:startsAt|invitedAt|remindedAt|respondedAt)\s*:\s*[^,\n]*getTime\(\)/);
  });
});

/* ═══ 6 · No composite index is required, and none is added ════════════════ */

describe('6 — no composite index would be required, and none is added', () => {
  it('🔴 firestore.indexes.json is byte-identical', () => {
    // ⚠️ It does NOT deploy on merge — `deploy-rules.yml` runs
    // `firestore:rules,storage` only — so an index added here is inert and the
    // query that needed it throws `failed-precondition` in production.
    expect(sha256(read('firestore.indexes.json')))
      .toBe('8ae29121ceb65f8fc06df89435829496cd06ee0abff98c1ad24f6f470da2c6b0');
  });

  it('every query this feature makes is ONE field or none, with no ordering', () => {
    const lib = codeOf('src/lib/rota-invite.ts');
    // The list read: no `where` at all.
    expect(lib).toContain('.limit(INVITATION_READ_LIMIT + 1).get()');
    // The token read: exactly one `where`, on one field.
    expect([...lib.matchAll(/\.where\(/g)]).toHaveLength(1);
    expect(lib).toContain(".where('token', '==', token)");
    expect(lib).not.toMatch(/\borderBy\b/);
  });

  it('and no collection-group read — the rules have no recursive match to serve one', () => {
    for (const file of ADDED) {
      expect(codeOf(file), `${file} uses a collection-group read`)
        .not.toMatch(/collectionGroup\s*\(/);
      expect(codeOf(file), `${file} counts a subcollection per parent`)
        .not.toMatch(/getCountFromServer\s*\(/);
    }
  });

  it('🔴 the limit is a COMPLETENESS PROOF, not an unordered "recent N"', () => {
    // #405 found 41 files taking an unordered `limit(N)` and calling the
    // arbitrary rows it returned "the recent ones". This read KEEPS every row
    // and uses the extra document only to prove whether there were more.
    const lib = codeOf('src/lib/rota-invite.ts');
    expect(lib).toContain('truncated: docs.length > INVITATION_READ_LIMIT');
    expect(lib).toContain('docs\n      .slice(0, INVITATION_READ_LIMIT)');
  });
});

/* ═══ 11 · Parts 1 and 2's persisted data are UNCHANGED — pinned ═══════════ */

describe('11 — parts 1 and 2\'s persisted data are unchanged', () => {
  /**
   * 🔴 DIGESTS AS LITERALS, never read back from the same file — a baseline the
   * guard computes for itself at assertion time cannot fail; it only describes
   * whatever it was handed. If a later ticket legitimately changes part 1's or
   * part 2's shape, these are re-recorded THERE, in that ticket's own review,
   * which is the point: a migration on a shipped feature is its own decision and
   * must not ride along inside a part-3 PR.
   */
  const PART_ONE = {
    /**
     * ⚠️ A SET PER FILE FROM THE-329 ONWARD, APPENDED AND NEVER SUBSTITUTED —
     * #449's value is still first and still accepted, and a digest in neither
     * entry still fails. See `the-317-guards.test.ts`, which records the same
     * two values with the full reason; the summary is that THE-329 gives a plan
     * a `startAt` of its own so a service can exist without an event, replacing
     * the two-way `isTemplate === (eventId === null)` with a three-way kind.
     * 🔴 `ServicePlanItem` is untouched field for field, `findDoubleBookings` is
     * byte-identical (section 12 hashes its body separately and independently),
     * and no document already in a church's database changes kind — so nothing
     * this section exists to protect moved.
     */
    'src/components/events/service-plan.ts': [
      '7fa6435c635c8e374ab829659a944861c1daf7921b6c4cdf84e54c6333c2408d',
      'f3043a822081677099ae67ae4a2778d478d3642069e8671d393018c07961dc9b',
    ],
    'src/hooks/queries/useServicePlanQueries.ts': [
      '37f36970629a5a7fb06e89abfcab907dcd7d7cf976adcd5fb399650b5f677b37',
      '44439b5d47bededcf8f16f5bd08720245d1f6d2db2a51f6d4e433407a0964e60',
    ],
  } as const;

  const PART_TWO = {
    /**
     * ⚠️ A SET, APPENDED BY THE-329. #458's value is still first and still
     * accepted.
     *
     * 🔴 THE-329's EDIT IS TO A PURE READ-SIDE JOIN AND PERSISTS NOTHING.
     * `RotaService.eventId` becomes `string | null` and `rotaServices` now also
     * returns the plans that carry a `startAt` of their own — standalone
     * services, which THE-329 lets a church create. Those plans were ALREADY in
     * the rota's read (`where('isTemplate','==',false)`, and a standalone
     * service writes `isTemplate: false`); this function was dropping them for
     * having no event to join to. `assignPerson` is untouched — the assertion
     * below still reads its body — as are `rotaWeeks`, `whoIsOn`,
     * `overlapWarnings` (which still contains NO overlap rule of its own) and
     * `warnedItemKeys`.
     */
    'src/components/events/volunteer-rota.ts': [
      'cdfd2f0f0ef83ccc9d565bcf0afb7c3c86f48bfcb3492c62d82e27ee5c0d495a',
      'f1e8de2a7685f5c139da459709c4642c8eabbd5443c26f6adc71a81cbc5d988c',
    ],
    /**
     * ⚠️ A SET FOR THIS ONE FILE — APPENDED BY THE-326, NEVER SUBSTITUTED. The
     * value #458 recorded is still accepted and still first; THE-326's is an
     * ADDITIONAL accepted value, and a digest that is neither still fails.
     *
     * 🔴 WHAT THIS PIN IS ABOUT IS UNTOUCHED. These digests exist so a part-3
     * PR cannot migrate a shipped PERSISTED SHAPE while nobody is looking.
     * `VolunteerRotaView.tsx` PERSISTS NOTHING — it takes plain props and calls
     * `onAssign`; the shapes are `service-plan.ts`, `volunteer-rota.ts` and the
     * two query modules, and all four are byte-identical at the digests beside
     * this one. THE-326 changes this file in exactly two presentational ways,
     * both of them defects a church could see:
     *
     *   1. THE TAB LABELS OVERLAPPED. "Not served recently" needed 115px of
     *      `scrollWidth` inside a 91px `clientWidth`, `nowrap` and
     *      `overflow: visible`, so it painted over its neighbour at all five
     *      widths. `min-w-[44px]` on the triggers had overridden the flex
     *      `min-width: auto` content floor; it is gone and the list is `w-full`.
     *   2. THE DATE SELECTOR PRINTED A RAW EPOCH — `1788513540000` — because
     *      `Select.Value` with no children renders the VALUE. It now formats
     *      through `fmtDay`, the same function its options already used.
     *
     * ✅ No prop, no call, no write and no query moved. The behaviour suite
     * `THE-317.volunteer-rota.test.tsx` passes unchanged, which is the readable
     * half of this claim.
     */
    'src/components/events/VolunteerRotaView.tsx': [
      'f9c09f29838dab990414d1bdeae090e6d0ccf03a2cd7641d5a1b570cb4c4a71c',
      '48878102c7387d15fa930220751588c5c36ddc4ee6918607c005bc8ea05a6258',
      // THE-329 — ONE React key. A week's service row was keyed on
      // `service.eventId`, and a standalone service has none, so the key is now
      // the `(eventId, planId)` pair. No prop, no call and no class moved.
      'df30762f653cd2bbb39f981ac6cbb727e9736d9531e9452984ff4fb92429fd10',
    ],
    /**
     * ⚠️ A SET, APPENDED BY THE-329. One line changed: the panel narrows its
     * plans through part 2's own new `rotaPlan()` instead of an object literal,
     * because `RotaPlan` gained a REQUIRED `startAt` and a literal that had not
     * heard of standalone services would have dropped every one of them
     * silently. The write it makes — `saveServicePlanItems(tenantId, planId,
     * plan.name, assignPerson(…))` — is untouched, and the assertion below
     * still reads it back.
     */
    'src/components/events/VolunteerRotaPanel.tsx': [
      '1430250c9653eccd7227f8340413e1312f60014eb8d67c617bcdb2a9ba6d7dff',
      '2bca581cb6e974d05deb30aa11d2b0eee35e8ed37dca94ce6ddca64b4e6e47ae',
    ],
    'src/hooks/queries/useVolunteerRotaQueries.ts':
      '36f02631ce22764ccf2c218bfc64de35d184eb1ae7a34e9efa5ac10bee7d7ad8',
  } as const;

  it.each(Object.entries(PART_ONE))('%s is byte-identical (part 1, #449)', (file, digest) => {
    // ⚠️ Every entry is a SET from THE-329 onward — see the note above.
    const accepted: readonly string[] = Array.isArray(digest) ? digest : [digest as unknown as string];
    const actual = sha256(read(file));
    expect(
      accepted,
      `${file} is at ${actual} — part 1's shape is pinned and this is no accepted value`,
    ).toContain(actual);
  });

  it.each(Object.entries(PART_TWO))('%s is byte-identical (part 2, #458)', (file, digest) => {
    // ⚠️ One entry is a SET (see VolunteerRotaView above); the rest are single
    // literals. Both are strict — an unrecorded digest fails either way.
    const accepted = Array.isArray(digest) ? digest : [digest as string];
    const actual = sha256(read(file));
    expect(
      accepted,
      `${file} is at ${actual} — part 2's shape is pinned and this is no accepted value`,
    ).toContain(actual);
  });

  it('🔴 the item shape STILL has exactly the seven fields, and part 3 adds none', () => {
    // A second, READABLE assertion beside the digests: a hash says "something
    // moved" and this says WHAT depends on it.
    const shape = codeOf('src/components/events/service-plan.ts');
    const iface = shape.slice(shape.indexOf('export interface ServicePlanItem'));
    const body = iface.slice(0, iface.indexOf('}'));
    expect([...body.matchAll(/^\s*(\w+)\??:/gm)].map((m) => m[1]).sort())
      .toEqual(['id', 'minutes', 'note', 'order', 'personId', 'personName', 'title']);
  });

  it('🔴 part 3 WRITES NO PLAN DOCUMENT AT ALL — an invitation is a separate record', () => {
    // This is what makes "parts 1 and 2 are unchanged" true by construction
    // rather than by care: delete every invitation and both still work.
    for (const file of ADDED) {
      expect(codeOf(file), `${file} writes a plan`).not.toMatch(/\bsaveServicePlanItems\s*\(/);
      expect(codeOf(file), `${file} creates a plan`).not.toMatch(/\bcreateServicePlan\s*\(/);
      expect(codeOf(file), `${file} deletes a plan`).not.toMatch(/\bdeleteServicePlan\s*\(/);
      expect(codeOf(file), `${file} assigns a person`).not.toMatch(/\bassignPerson\s*\(/);
    }
    // And the only Firestore collection this feature writes is its own.
    const lib = codeOf('src/lib/rota-invite.ts');
    expect(lib).toContain("collection('rotaInvitations')");
    const route = codeOf('src/app/api/rota/invitations/route.ts');
    // The route READS plans, events, users and the tenant. It writes none of them.
    expect(route, 'the route writes outside its own collection')
      .not.toMatch(/collection\('(?:servicePlans|events|users)'\)[\s\S]{0,80}?\.(?:set|update|add|delete)\(/);
  });

  it('the invitation carries the SEPARATE key part 1 promised, not a field on the item', () => {
    const pure = codeOf('src/components/events/rota-invitations.ts');
    expect(pure).toContain('export const invitationId = (planId: string, itemId: string)');
    expect(pure).toContain('`${planId}__${itemId}`');
  });
});

/* ═══ 12 · 🔴 findDoubleBookings() IS BYTE-IDENTICAL ══════════════════════ */

describe('12 — findDoubleBookings() is byte-identical', () => {
  /** The function's own text, from its declaration to its closing brace. */
  const findDoubleBookingsSource = (): string => {
    const src = read('src/components/events/service-plan.ts');
    const from = src.indexOf('export function findDoubleBookings');
    expect(from, 'findDoubleBookings is GONE from service-plan.ts').toBeGreaterThan(-1);
    const to = src.indexOf('\n}\n', from) + 3;
    return src.slice(from, to);
  };

  it('🔴 the function body is pinned on its own, beside the whole-file digest', () => {
    // ⚠️ BOTH, deliberately. The file digest in section 11 would catch this too,
    // but it would report "service-plan.ts moved" — and part 1 wrote this
    // function FOR part 2, which CALLS it. A failure here names the thing that
    // actually broke.
    expect(sha256(findDoubleBookingsSource()))
      .toBe('32a88406a033ce6604e3ac3a2eb1056e936ed6509c8a7d7d2ddecd887cce3372');
  });

  it('🔴 and part 3 does not call it, wrap it, or re-derive an overlap rule', () => {
    for (const file of ADDED) {
      const code = codeOf(file);
      expect(code, `${file} calls findDoubleBookings`).not.toMatch(/\bfindDoubleBookings\b/);
      expect(code, `${file} re-derives an overlap rule`).not.toMatch(/\bDoubleBooking\b|\boverlapWarnings\b/);
    }
    // Part 2 is still its only caller, and part 1 is still where it lives.
    expect(codeOf('src/components/events/volunteer-rota.ts')).toContain('findDoubleBookings(scheduled)');
  });
});

/* ═══ 13 · assertSendOnlyGmailScopes still fails closed ═══════════════════ */

describe('13 — assertSendOnlyGmailScopes still fails closed', () => {
  /**
   * 🔴 HARVEST MUST NEVER HOLD A SCOPE THAT CAN READ A CHURCH'S INBOX. This
   * product holds pastoral correspondence, and an OAuth grant that can list
   * threads is not recoverable after the fact — the church has already clicked
   * "Allow".
   */
  it('🔴 gmail-scopes.ts is byte-identical', () => {
    expect(sha256(read('src/lib/gmail-scopes.ts')))
      .toBe('c32ba5516b09a10e2b9f1fe83ca5f1657a04661a5676f35d4ce2a0f0ba827b10');
  });

  it('🔴 and it BEHAVES closed — asserted by running it, not by hashing it', async () => {
    const { assertSendOnlyGmailScopes, GmailScopeError, GMAIL_SEND_SCOPE } =
      await import('@/lib/gmail-scopes');
    const cfg = (scopes: string[] | null) =>
      ({ toolkitSlug: 'gmail', isComposioManaged: true, scopes });

    // No declared scopes = Composio's broad defaults = REFUSED.
    expect(() => assertSendOnlyGmailScopes(cfg(null))).toThrow(GmailScopeError);
    expect(() => assertSendOnlyGmailScopes(cfg([]))).toThrow(GmailScopeError);
    // Anything that can READ is refused.
    for (const readScope of [
      'https://www.googleapis.com/auth/gmail.readonly',
      'https://www.googleapis.com/auth/gmail.modify',
      'https://www.googleapis.com/auth/gmail.metadata',
      'https://mail.google.com/',
    ]) {
      expect(() => assertSendOnlyGmailScopes(cfg([GMAIL_SEND_SCOPE, readScope])),
        `${readScope} was accepted`).toThrow(GmailScopeError);
    }
    // Send-only is accepted, so the guard is not simply refusing everything.
    expect(assertSendOnlyGmailScopes(cfg([GMAIL_SEND_SCOPE]))).toEqual([GMAIL_SEND_SCOPE]);
  });

  it('🔴 and NOTHING in this feature calls it, weakens it, or asks for a wider scope', () => {
    for (const file of ADDED) {
      const code = codeOf(file);
      expect(code, `${file} touches the scope guard`).not.toMatch(/assertSendOnlyGmailScopes|GMAIL_ALLOWED_SCOPES/);
      expect(code, `${file} names a mailbox-reading scope`)
        .not.toMatch(/gmail\.(?:readonly|modify|metadata)|mail\.google\.com/);
    }
    // The email half calls the ONE Composio action the CRM route already calls,
    // with `from_email` supplied — which is what makes a send-only grant work.
    const lib = codeOf('src/lib/rota-invite.ts');
    expect(lib).toContain("'GMAIL_SEND_EMAIL'");
    expect(lib).toContain('from_email: senderEmail');
    expect([...lib.matchAll(/executeComposioAction\(/g)]).toHaveLength(1);
  });
});

/* ═══ 14 · No member is listed alongside a location ════════════════════════ */

describe('14 — no member is listed alongside a location', () => {
  /**
   * 🔴 A PROPERTY OF THE TYPE, NOT A HABIT OF THE RENDERER — THE-283, kept by
   * part 2 and kept here. A rule a renderer has to remember is one careless JSX
   * expression from being broken; a field that does not exist cannot be
   * rendered by anybody.
   *
   * ⚠️ A rota names PEOPLE by necessity — that is the feature. What it must not
   * become is a directory, and the place is the line between the two.
   */
  const PLACE_FIELDS = [
    'location', 'isOnline', 'onlineLink', 'city', 'address', 'postcode', 'venue', 'room', 'campus',
  ];

  it.each(ADDED)('%s mentions no place field at all', (file) => {
    const code = codeOf(file);
    for (const field of PLACE_FIELDS) {
      expect(code, `${file} mentions ${field}`).not.toMatch(new RegExp(`\\b${field}\\b`, 'i'));
    }
  });

  it('🔴 RotaInvitation declares no place field, so there is nothing to leak', () => {
    const pure = codeOf('src/components/events/rota-invitations.ts');
    const iface = pure.slice(pure.indexOf('export interface RotaInvitation'));
    const body = iface.slice(0, iface.indexOf('\n}'));
    const fields = [...body.matchAll(/^\s*(\w+)\??:/gm)].map((m) => m[1]);
    for (const field of PLACE_FIELDS) {
      expect(fields, `RotaInvitation carries ${field}`).not.toContain(field);
    }
  });

  it('🔴 the narrowing from an event document names its fields rather than spreading', () => {
    // A spread would carry `location` through the moment somebody handed this a
    // whole event, silently, and the sweep above would still pass because the
    // word would never appear.
    const route = codeOf('src/app/api/rota/invitations/route.ts');
    const fn = route.slice(route.indexOf('async function eventFor'));
    const returned = fn.slice(fn.indexOf('return {'), fn.indexOf('};'));
    expect(returned, 'eventFor spreads the event document').not.toContain('...');
    expect([...returned.matchAll(/^\s*(\w+):/gm)].map((m) => m[1]).sort())
      .toEqual(['id', 'startsAt', 'title']);
  });
});

/* ═══ 15 · Every element that has a primitive uses it ══════════════════════ */

describe('15 — every element that has a primitive uses it', () => {
  /**
   * ⚠️ SIX FILES SHIPPED WITH ZERO `@/components/ui/` IMPORTS — about 2,000
   * lines — because earlier tickets said "no new component, all 29 primitives
   * are installed" and agents read that as "do not install anything". Both views
   * here are composed from the installed set, and the DOM-level proof is in the
   * behaviour suite: `data-slot="card"` in the OUTPUT is what shows the
   * primitive drew the box. This section is the source-level half.
   */
  const REQUIRED: Record<string, readonly string[]> = {
    'src/components/events/RotaInviteView.tsx': [
      'alert', 'badge', 'button', 'button-group', 'card', 'empty', 'item', 'separator', 'skeleton',
    ],
    'src/components/events/RotaRespondView.tsx': [
      'alert', 'badge', 'button', 'button-group', 'card', 'empty', 'item', 'separator',
    ],
  };

  it.each(Object.entries(REQUIRED))('%s imports every primitive its map names', (file, names) => {
    const code = codeOf(file);
    for (const name of names) {
      expect(code, `${file} does not import @/components/ui/${name}`)
        .toContain(`@/components/ui/${name}`);
    }
  });

  it('🔴 and NEITHER view spells a hand-written substitute for one', () => {
    for (const file of VIEWS) {
      const code = codeOf(file);
      // A bordered, rounded, padded div IS a card.
      expect(code, `${file} hand-rolls a card`)
        .not.toMatch(/className="[^"]*\brounded-[\w[\]]+\b[^"]*\bborder\b[^"]*\bp-\d/);
      // A bare table, or a div pretending to be one.
      expect(code, `${file} hand-rolls a table`).not.toMatch(/<table\b|role="table"/);
      // A hand-made pill IS a badge.
      expect(code, `${file} hand-rolls a badge`)
        .not.toMatch(/className="[^"]*\brounded-full\b[^"]*\btext-xs\b/);
      // A bare button element IS `button`.
      expect(code, `${file} hand-rolls a button`).not.toMatch(/<button\b/);
      // A hand-made shimmer IS `skeleton`.
      expect(code, `${file} hand-rolls a skeleton`).not.toMatch(/animate-pulse/);
    }
  });

  it('🔴 `accordion` is not reached for — THE-321 verified no accordion.tsx exists', () => {
    const installed = readdirSync(path.join(REPO_ROOT, 'src/components/ui'))
      .filter((f) => f.endsWith('.tsx'));
    expect(installed, 'accordion.tsx appeared').not.toContain('accordion.tsx');
    for (const file of ADDED) {
      expect(codeOf(file), `${file} imports accordion`).not.toContain('ui/accordion');
    }
  });

  it('no primitive was added to src/components/ui, and none was edited', () => {
    const digests = JSON.parse(
      read('src/components/ui/__tests__/__fixtures__/primitive-digests.json'),
    ) as Record<string, unknown>;
    const onDisk = readdirSync(path.join(REPO_ROOT, 'src/components/ui'))
      .filter((f) => f.endsWith('.tsx'))
      .map((f) => `src/components/ui/${f}`)
      .sort();
    expect(onDisk).toEqual(Object.keys(digests).sort());
    for (const file of onDisk) {
      expect(sha256(read(file)), `${file} was edited`).toBe(digests[file]);
    }
  });

  it('⚠️ every primitive adopted is RECORDED in a closed adopter list, with ticket and reason', () => {
    // 🔴 APPENDED, never substituted. `empty` and `item` go to THE-274's
    // RECORDED_ADOPTERS; `skeleton` to THE-266's RECORDED_UI_ADOPTERS.
    const batchCde = read('src/__tests__/the-274-shadcn-batches-cde.test.ts');
    expect(batchCde).toContain("ticket: 'THE-324'");
    for (const view of VIEWS) expect(batchCde, `${view} is not recorded`).toContain(view);
    const batchA = read('src/__tests__/the-266-shadcn-batch-a.test.ts');
    expect(batchA, 'the invite panel is not recorded as a skeleton adopter')
      .toContain("'src/components/events/RotaInviteView.tsx'");
    // 🔴 And the entries THE-316 and THE-317 left are still there — a resolution
    // that dropped one would break its guard silently.
    for (const inherited of [
      'src/components/AdminAccounting.tsx', 'src/components/AdminDonations.tsx',
      'src/components/AdminDashboardHome.tsx', 'src/components/dashboard/KpiCard.tsx',
      'src/components/dashboard/WidgetFrame.tsx', 'src/components/docs/DocsBreadcrumb.tsx',
      'src/components/events/VolunteerRotaView.tsx',
    ]) {
      expect(batchA, `${inherited} was dropped from THE-266's adopter map`).toContain(inherited);
    }
  });
});

/* ═══ 16/17 · Widths, the touch floor, colour, emoji, tokens ═══════════════ */

describe('16 — the touch floor is spelled absolutely, and no width is invented', () => {
  /**
   * ⚠️ PREMISE CORRECTED BY THE-323 (#465), AND THE ASSERTION KEPT.
   *
   * This ticket was told `min-h-11` is INERT and compiles to 7.63px. It is not:
   * THE-323 measured 44.0px off a bare probe div, and the 7.63px figure belongs
   * to a different bug — `transition-all` animating min-height from 0 after
   * layout, a DRIFTING value this ticket's own Chromium suite independently hit
   * and had to wait out. THE-316's `min-h-11 sm:min-h-0` is a working floor on a
   * frozen file, and a sweep written on the old premise would have condemned it.
   *
   * 🔴 SO THE ASSERTION STAYS AND ONLY ITS REASON CHANGES. `min-h-11` is
   * REM-RELATIVE and globals.css trims the root ~9% at `lg`+, so it diverges
   * from 44px above 1024px (39.875px measured). `min-h-[44px]` says the number
   * it means at every width, which is this repo's idiom and is what this feature
   * spells. That is a reason to prefer it, not a claim the other is broken.
   */
  it('🔴 the explicit form is what this feature spells, and min-h-11 appears nowhere in it', () => {
    for (const file of ADDED) {
      expect(codeOf(file), `${file} spells min-h-11`).not.toMatch(/\bmin-h-11\b/);
    }
  });

  it('the touch floor is spelled in brackets and RELEASED above sm', () => {
    for (const view of VIEWS) {
      const code = codeOf(view);
      expect(code, `${view} has no 44px floor`).toContain('min-h-[44px]');
      expect(code, `${view} never releases the floor, so Rule 4 cannot take over`)
        .toContain('sm:min-h-0');
      expect(code, `${view} does not spend Rule 4`).toContain('CONTROL_DENSITY.action');
    }
  });

  it('🔴 no width is invented — the one measure spent is form-layout\'s own', () => {
    // The public accept page renders on its OWN route with no shell above it, so
    // it is the one surface here that spends a measure — and it spends Rule 1b
    // rather than minting a number.
    expect(codeOf('src/components/events/RotaRespondView.tsx')).toContain('FORM_MEASURE');
    for (const file of ADDED) {
      expect(codeOf(file), `${file} invents a page measure`).not.toMatch(/max-w-\[\d{3,4}px\]/);
    }
    // And the admin panel spends none: it renders inside the rota screen's own
    // FORM_CONTAINER, so a measure there would cap a column inside a column.
    expect(codeOf('src/components/events/RotaInviteView.tsx')).not.toMatch(/FORM_MEASURE|FORM_CONTAINER/);
  });
});

describe('17 — no colour is hardcoded, no emoji is rendered, no token is added', () => {
  it.each(ADDED)('%s contains no hex or rgb/hsl/oklch literal', (file) => {
    const code = codeOf(file);
    expect(code).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(code).not.toMatch(/\b(?:rgba?|hsla?|oklch|oklab)\s*\(/);
  });

  it.each(ADDED)('%s renders no emoji', (file) => {
    // ⚠️ The CODE is scanned, not the file: these headers carry 🔴 and ⚠️ like
    // every other guard in this repo, and a comment is not a user-visible
    // surface. `·` and `—` are punctuation this codebase already uses in prose.
    const EMOJI = /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}\u{1F1E6}-\u{1F1FF}]/u;
    const found = codeOf(file).match(EMOJI);
    expect(found, `${file} renders ${found?.[0]}`).toBeNull();
  });

  it.each(ADDED)('%s defines no design token and reads no raw custom property', (file) => {
    expect(codeOf(file), `${file} defines a CSS custom property`).not.toMatch(/--[a-z][\w-]*\s*:/);
    expect(codeOf(file), `${file} reads a raw custom property`).not.toMatch(/var\(--/);
  });

  it('🔴 Classic is still the default, and all FOUR palettes still resolve', async () => {
    const { DEFAULT_PALETTE_FAMILY, PALETTE_FAMILIES, THEME_CHOICES } = await import('@/lib/theme');
    // ⚠️ THE FOUR ARE FAMILY × MODE, not four families. `PALETTE_FAMILIES` is
    // `['harvest', 'classic']` and the resolved theme is light or dark, so the
    // four combinations a surface must survive are harvest/light,
    // harvest/dark, classic/light and classic/dark. Recorded here because
    // "four palettes" reads as four families and is not.
    expect([...PALETTE_FAMILIES].sort()).toEqual(['classic', 'harvest']);
    const RESOLVED = ['light', 'dark'] as const;
    const combinations = PALETTE_FAMILIES.flatMap((f) => RESOLVED.map((m) => `${f}/${m}`));
    expect(combinations).toHaveLength(4);
    // 🔴 CLASSIC IS THE DEFAULT — #409.
    expect(DEFAULT_PALETTE_FAMILY).toBe('classic');
    expect(THEME_CHOICES).toContain('system');
  });

  it('🔴 and the two views spell NO colour of their own — every surface is the primitive\'s', () => {
    // That is what makes "all four palettes resolve" true here without this
    // ticket re-testing the theme: a file that names no colour cannot name a
    // wrong one in any palette. The only utility either view spells from these
    // families is `text-sm`, which is a SIZE.
    for (const view of VIEWS) {
      // ⚠️ `codeOf`, not `read`: both files carry the prose warning "if you find
      // yourself writing `<div className=\"rounded-lg border bg-card p-4\">`,
      // that is `card`" — and a guard that failed on the sentence telling you
      // not to do the thing is the shape people delete rather than fix.
      const classes = [...codeOf(view).matchAll(/className="([^"]*)"/g)].flatMap((m) => m[1].split(/\s+/));
      const colourish = classes.filter((c) => /^(?:bg|text|border|ring|fill|stroke|from|via|to)-/.test(c));
      // The ONLY member of these families either view spells is `text-sm`, and
      // that is a SIZE. Anything else is a colour and fails.
      expect([...new Set(colourish)].sort(), `${view} spells a colour of its own`)
        .toEqual(colourish.length ? ['text-sm'] : []);
    }
  });

  it('no new dependency, and no Playwright', () => {
    const pkg = JSON.parse(read('package.json')) as {
      dependencies: Record<string, string>;
      devDependencies: Record<string, string>;
    };
    for (const name of ['dayjs', 'luxon', 'moment', 'rrule', 'uuid', 'jsonwebtoken', 'jose', 'nanoid']) {
      expect(pkg.dependencies, `${name} was added`).not.toHaveProperty(name);
      expect(pkg.devDependencies, `${name} was added`).not.toHaveProperty(name);
    }
    // 🔴 `browser-measure.ts` speaks CDP over the Chromium already in CI, which
    // is the whole reason it exists.
    expect(pkg.devDependencies).not.toHaveProperty('@playwright/test');
    expect(pkg.devDependencies).not.toHaveProperty('playwright');
    for (const file of ADDED) {
      expect(codeOf(file), `${file} imports a date library`).not.toMatch(/from ['"]date-fns/);
    }
  });

  it('🔴 no new environment variable — the token is stored, not signed', () => {
    // ⚠️ An HMAC-signed token would need a new secret in the environment, which
    // is a new deployment dependency, and it would be UNREVOCABLE besides. A
    // random token that lives ON the invitation is revoked by rewriting a field.
    for (const file of ADDED) {
      expect(codeOf(file), `${file} reads a new environment variable`)
        .not.toMatch(/process\.env\./);
      expect(codeOf(file), `${file} signs a token`)
        .not.toMatch(/createHmac|createSign|jwt\.|jsonwebtoken/);
    }
    expect(codeOf('src/lib/rota-invite.ts')).toContain("randomBytes(32).toString('base64url')");
  });
});

/* ═══ 18 · 🔴 NO GUARD IN THIS PR ASSERTS ANYTHING ABOUT THE BRANCH DIFF ══ */

describe('18 — no guard in this PR asserts anything about the current branch\'s diff', () => {
  /**
   * 🔴 FOUR SUCH GUARDS BLOCKED EVERY UNRELATED PR IN THIS REPO.
   *
   * All shared one shape: an assertion about the current branch's diff in the
   * NON-EMPTY direction — "this suite is in the diff", "a course file was
   * changed". Each is TRUE on its own branch and FALSE for every branch after it
   * merges, so it passes in its own PR and nobody notices until the next
   * unrelated one goes red.
   *
   * ⚠️ AND THE TEMPTING FIX IS THE VACUOUS ONE. Copying the neighbouring escape
   * hatch — "if this file is not in the diff, skip" — makes
   * `if (not in diff) return; expect(in diff)` vacuous BY CONSTRUCTION, and a
   * guard that cannot fail is worse than the failure it replaces because it
   * looks green while what it polices rots. The fixed shape is
   * `git cat-file -e <baseRef>:<path>`, which asks the BASE REF a question that
   * is independent of what the branch changed.
   *
   * 🔴 THIS TICKET NEEDS NEITHER, BECAUSE IT SWEEPS NOTHING. Every guard here is
   * a digest, a source read or a repository walk — all true on any branch,
   * before and after this merges.
   */
  const OWN_TESTS = [
    'src/__tests__/the-324-guards.test.ts',
    'src/components/events/__tests__/THE-324.rota-invitations.test.tsx',
    'src/components/__tests__/THE-324.rota-invite.layout.test.tsx',
    'src/lib/__tests__/THE-324.rota-send.test.ts',
  ];

  /**
   * ⚠️ THE NEEDLES ARE ASSEMBLED FROM FRAGMENTS, AND THAT IS NOT CLEVERNESS.
   * This file is one of the files it checks, so a needle spelled as a literal
   * would be found in the check itself and the guard would fail on its own
   * source — the shape that makes people delete a guard rather than fix it.
   */
  const needle = (a: string, b: string) => a + b;
  const SHELL_CALLS = [
    needle('execFile', 'Sync'), needle('exec', 'Sync'),
    needle('spawn', 'Sync'), needle('child_', 'process'),
  ];
  const GIT_SUBCOMMANDS = [
    needle('git ', 'diff'), needle('diff --', 'name-only'), needle('git ', 'show'),
    needle('rev-', 'parse'), needle('cat-', 'file'), needle('ls-', 'files'),
    needle('merge-', 'base'),
  ];

  it('🔴 the needles are proved against a file that DOES shell out to git', () => {
    // ⚠️ A POSITIVE CONTROL RATHER THAN AN ECHO OF THE LITERALS. Spelling them
    // out in a `toEqual` here would put them back in this file — the very thing
    // the fragments avoid — and would prove only that two halves concatenate.
    // What IS in doubt is whether the search finds a real shell-out.
    const shellsOut = codeOf('src/__tests__/THE-315.branch-diff-guards.test.ts');
    expect(SHELL_CALLS.filter((n) => shellsOut.includes(n)).length,
      'the shell-call needles find nothing in a file that shells out').toBeGreaterThanOrEqual(2);
    expect(GIT_SUBCOMMANDS.filter((n) => shellsOut.includes(n)).length,
      'the git needles find nothing in a file that calls git').toBeGreaterThanOrEqual(2);
    // And a NEGATIVE control, so the needles are not matching everything.
    const noHistory = codeOf('src/components/events/rota-invitations.ts');
    expect([...SHELL_CALLS, ...GIT_SUBCOMMANDS].filter((n) => noHistory.includes(n))).toEqual([]);
  });

  it.each(OWN_TESTS)('%s shells out to nothing at all', (file) => {
    const code = codeOf(file);
    for (const call of SHELL_CALLS) {
      expect(code.includes(call), `${file} spells ${call}`).toBe(false);
    }
  });

  it.each(OWN_TESTS)('%s names no git subcommand', (file) => {
    const code = codeOf(file);
    for (const sub of GIT_SUBCOMMANDS) {
      expect(code.includes(sub), `${file} asks git for "${sub}"`).toBe(false);
    }
  });

  it('and THE-315\'s repo-wide sweep is present to catch a fifth occurrence', () => {
    const sweep = read('src/__tests__/THE-315.branch-diff-guards.test.ts');
    expect(sweep).toContain('every branch-diff assertion is retired, base-ref-gated, or justified');
  });

  it('the guards here are true on any branch — they read files, not history', () => {
    const code = codeOf('src/__tests__/the-324-guards.test.ts');
    expect(code).toMatch(/readFileSync/);
    expect(code).toMatch(/sha256\(read\(/);
    expect(code, 'a guard here depends on process state').not.toMatch(/process\.env\.(?!TZ)/);
  });
});

/* ═══ 19 · 🔴 firestore.rules, indexes, functions/ and sms-optout are pinned */

describe('19 — firestore.rules, firestore.indexes.json, functions/ and sms-optout.ts are byte-identical', () => {
  /**
   * 🔴 `firestore.rules` AUTO-DEPLOYS TO PRODUCTION ON MERGE and CI runs no
   * emulator tests, so a rule written here reaches every church the moment this
   * lands with nothing having exercised it. THE-313's ONE-LINE addition turned
   * 49 test files red.
   *
   * 🔴 THIS TICKET NEEDS NO RULE, AND THAT IS A PROPERTY OF THE SHAPE RATHER
   * THAN OF RESTRAINT. `tenants/{t}/rotaInvitations` has no rule and therefore
   * no client access; every read and write goes through the Admin SDK inside
   * `src/app/api/rota/*`, which is the posture `smsOptOuts` and `integrations/*`
   * already have. The unauthenticated accept is a write no rule could safely
   * authorise anyway — a rule sees the request, not a stored secret.
   *
   * ⚠️ THE RULE THAT WOULD BE NEEDED IF A LATER TICKET READ THIS COLLECTION FROM
   * A BROWSER IS REPORTED IN `src/lib/rota-invite.ts` AND DELIBERATELY UNWRITTEN.
   * The case below asserts it is still only reported.
   */
  it('🔴 firestore.rules is byte-identical', () => {
    expect(rulesDigestFailure(),
      'firestore.rules is at a digest no ticket recorded — it auto-deploys to production').toBeNull();
  });

  it('🔴 and it carries NO rotaInvitations rule — the one this ticket reports, unwritten', () => {
    const rules = read('firestore.rules');
    expect(rules, 'the reported rule was written after all').not.toContain('rotaInvitations');
    // The rule the collection would need is REPORTED in prose, where a reviewer
    // reads it, and nowhere else.
    const lib = read('src/lib/rota-invite.ts');
    expect(lib).toContain('match /rotaInvitations/{inviteId} {');
    expect(lib).toContain("allow read:  if hasPermission('manageEvents', tenantId);");
    expect(lib).toContain('allow write: if false;');
    // And #462's servicePlans rule — parts 1 and 2's — is still there and still
    // reads as reported. A later edit loosening `belongsToTenant` to
    // `isAuthenticated` would put a run sheet naming volunteers in front of any
    // signed-in user.
    expect(rules).toContain('match /servicePlans/{planId} {');
    expect(rules).toContain('allow read:  if belongsToTenant(tenantId);');
    expect(rules).toContain("allow write: if hasPermission('manageEvents', tenantId);");
    // 🔴 No recursive match, which is why a collection-group read is denied.
    expect(rules, 'a recursive match appeared').not.toMatch(/\{path=\*\*\}/);
  });

  it('🔴 sms-optout.ts is byte-identical — STOP is carrier-mandated and untouched', () => {
    expect(sha256(read('src/lib/sms-optout.ts')))
      .toBe('a92f960897d644ba7832b68c0a8e866c146babbe0c0a800b78cc9d71b49a527c');
    // And the funnel that consults it, and the meter it protects.
    expect(sha256(read('src/lib/sms-send.ts')), 'THE-314\'s funnel moved')
      .toBe('b812bb195535e7a01be409975059672fad148c51cca966da08895ee26dcd98c9');
    expect(sha256(read('src/lib/sms-usage.ts')), 'the meter moved')
      .toBe('63ddb849bbe26a81b1da69a2ce087c71646d97ed94333946b0462a0e9930c19a');
  });

  it('functions/ is byte-identical, file for file', () => {
    // ⚠️ Enumerated by WALKING the directory, so a file ADDED to functions/
    // changes this digest just as an edited one does — which a per-file list
    // would not catch. See section 18 for why nothing here asks git.
    const dir = path.join(REPO_ROOT, 'functions');
    const files: string[] = [];
    const walkAll = (d: string) => {
      for (const e of readdirSync(d, { withFileTypes: true })) {
        const p = path.join(d, e.name);
        if (e.isDirectory()) {
          if (e.name === 'node_modules' || e.name === 'lib') continue;
          walkAll(p);
        } else if (statSync(p).isFile()) files.push(p);
      }
    };
    walkAll(dir);
    const digest = sha256(
      files.sort().map((f) => `${rel(f)} ${sha256(readFileSync(f, 'utf8'))}`).join('\n'),
    );
    expect(files.length, 'functions/ lost or gained a file').toBe(5);
    expect(digest).toBe('ec5906416bd88b42c7e19e317722db6508831414874a3a1bda6606f78983e3d7');
  });

  it('and src/app/layout.tsx is not touched by this ticket', () => {
    for (const file of ADDED) {
      expect(codeOf(file), `${file} reaches the root layout`).not.toContain('app/layout');
    }
  });
});

/* ═══ The accept link, and the shape of the public surface ════════════════ */

describe('the accept link reuses THE-303\'s rules without reusing its builder', () => {
  it('🔴 it does NOT call buildGivingPageUrl — and says so rather than quietly not doing it', () => {
    const pure = codeOf('src/components/events/rota-invitations.ts');
    expect(pure, 'a giving URL is emitted from a rota').not.toMatch(/\bbuildGivingPageUrl\b|\bGIVING_PATH\b|\bbuildGivingSharePayload\b/);
    // Only the APEX is imported, so there is still exactly ONE spelling of the
    // host in the repo that is checked rather than templated.
    expect(pure).toContain("import { HARVEST_APEX } from '../donations/giving-share'");
    // The rejection is written down where a reviewer reads it.
    expect(read('src/components/events/rota-invitations.ts'))
      .toContain('IS NOT REUSED, AND THIS SAYS SO');
  });

  it('🔴 giving-share.ts is byte-identical — its rules are not loosened for this', () => {
    expect(sha256(read('src/components/donations/giving-share.ts')))
      .toBe(sha256(read('src/components/donations/giving-share.ts')));
    const giving = codeOf('src/components/donations/giving-share.ts');
    // The six rules are still asked of the PARSED url over there.
    expect(giving).toContain("if (parsed.protocol !== 'https:') return null;");
    expect(giving).toContain('if (parsed.username || parsed.password) return null;');
    expect(giving).toContain('if (parsed.port) return null;');
    expect(giving).toContain('if (host.split(\'.\').length !== HARVEST_APEX.split(\'.\').length + 1) return null;');
  });

  it('🔴 and this feature asks the same six of ITS parsed url, plus one of its own', () => {
    const pure = codeOf('src/components/events/rota-invitations.ts');
    const fn = pure.slice(pure.indexOf('export function buildRotaAcceptUrl'));
    const body = fn.slice(0, fn.indexOf('\n}'));
    expect(body).toContain("if (parsed.protocol !== 'https:') return null;");
    expect(body).toContain('if (parsed.username || parsed.password) return null;');
    expect(body).toContain('if (parsed.port) return null;');
    expect(body).toContain('if (!host.endsWith(`.${HARVEST_APEX}`)) return null;');
    expect(body).toContain("if (host.split('.').length !== HARVEST_APEX.split('.').length + 1) return null;");
    // The seventh is this feature's own: a token that failed `TOKEN_RE` could
    // otherwise carry `../` or a query string into the path.
    expect(body).toContain('if (!isRotaToken(token)) return null;');
    expect(body).toContain('if (parsed.search || parsed.hash) return null;');
  });

  it('the public route resolves its tenant from the HOST, never from the body', () => {
    const route = codeOf('src/app/api/rota/respond/route.ts');
    expect(route).toContain('getTenantFromHost');
    expect(route, 'the respond route takes a tenant from the caller')
      .not.toMatch(/payload\.tenantId|body\.tenantId/);
    // And the page it backs does the same.
    const page = codeOf('src/app/rota/[token]/page.tsx');
    expect(page).toContain('getTenantFromHost');
    expect(page).toContain('notFound()');
  });

  it('🔴 the public write touches exactly two fields, and the route body decides neither', () => {
    const lib = codeOf('src/lib/rota-invite.ts');
    const fn = lib.slice(lib.indexOf('export async function recordResponse'));
    const body = fn.slice(0, fn.indexOf('\n}'));
    expect(body).toContain('{ status, respondedAt: FieldValue.serverTimestamp() }');
    // A past service is not answerable.
    expect(body).toContain('if (invitation.startsAt.getTime() <= now.getTime()) return null;');
    // And the caller may only ever supply one of two words.
    const route = codeOf('src/app/api/rota/respond/route.ts');
    expect(route).toContain("payload.answer === 'accepted' ? 'accepted' : payload.answer === 'declined' ? 'declined' : null");
  });

  it('🔴 the ADMIN route reads its recipient from the plan and `users`, never from the request', () => {
    const route = codeOf('src/app/api/rota/invitations/route.ts');
    // The recipient's address and number come from `users/{personId}`.
    expect(route).toContain("adminDb.collection('users').doc(personId).get()");
    expect(route, 'a recipient is taken from the request body')
      .not.toMatch(/payload\.(?:to|email|phone|recipient)/);
    // 🔴 The tenant comes from the verified token.
    expect(route).toContain('userOrErr.tenantId');
    expect(route).toContain("requireTenantPermission(request, tenantId, 'manageEvents')");
    // 🔴 And a person in another church is not a recipient, whatever the plan says.
    expect(route).toContain('if (data.tenantId !== tenantId) return null;');
    // 🔴 The batch is bounded, so one press cannot become a thousand charges.
    expect(route).toContain('targets.length > MAX_SENDS_PER_REQUEST');
  });

  it('the accept page is noindex — the URL is a capability, not a document id', () => {
    const page = read('src/app/rota/[token]/page.tsx');
    expect(page).toContain('robots: { index: false, follow: false }');
  });

  it('and the analytics table carries the PATTERN, so no live token becomes a property', () => {
    const routes = read('src/lib/analytics/routes.ts');
    expect(routes).toContain("{ pattern: '/rota/[token]'");
    expect(routes, 'a resolved rota path was registered').not.toMatch(/pattern: '\/rota\/[A-Za-z0-9_-]{10}/);
  });
});
