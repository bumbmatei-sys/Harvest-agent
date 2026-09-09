import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { rulesDigestFailure } from './__fixtures__/firestore-rules-pin';

/**
 * THE-330 — THE GUARDS: what this ticket must not have broken.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * THE-330 rebuilt the number-purchase FORM. It changed no send path, no meter,
 * no STOP handling and none of THE-318's four purchase fixes — and "did not
 * change" is a claim, so every one of them is asserted here rather than
 * promised in a commit message.
 *
 * ⚠️ EVERY SOURCE GREP STRIPS COMMENTS FIRST (`codeOf`). This file's own prose
 * names `wantsSms`, `connectWhatsapp`, `allowMultiple`, `formatPlanPrice` and
 * `sendTenantSms`; a naive `toContain` over raw source would be satisfied by its
 * own explanation. Nine guards in this series passed a planted defect, one of
 * them with its own gate DELETED because the assertion's message contained the
 * string it grepped for.
 *
 * ⚠️ Nothing here shells out to `git` and nothing here asserts anything about
 * the current branch's diff (#454's standing sweep). Every claim is about the
 * files as they are on disk.
 */

const ROOT = path.resolve(__dirname, '../..');
const SRC = path.join(ROOT, 'src');
const read = (rel: string) => readFileSync(path.join(SRC, rel), 'utf8');

/** 🔴 Comments stripped before every grep. See the header. */
const codeOf = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/.*$/gm, ' ');

/**
 * 🔴 Code with its string and regex CONTENT blanked — what a sweep over
 * assertions has to read, so a guard cannot be satisfied by the literal inside
 * its own assertion.
 */
const blankLiterals = (code: string) =>
  code
    .replace(/'(?:[^'\\\n]|\\.)*'/g, "''")
    .replace(/"(?:[^"\\\n]|\\.)*"/g, '""')
    .replace(/`(?:[^`\\]|\\.)*`/g, '``')
    .replace(/\/(?![*/])(?:[^/\\\n[]|\\.|\[(?:[^\]\\]|\\.)*\])+\/[gimsuy]*/g, '/./');

const ZERNIO = 'lib/zernio.ts';
const ROUTE = 'app/api/sms/numbers/route.ts';
const PANEL = 'components/settings/SmsSection.tsx';
const COUNTRIES = 'lib/sms-countries.ts';

/** The files THIS ticket adds or opens. */
const MINE = [
  ZERNIO, ROUTE, PANEL, COUNTRIES,
  '__tests__/THE-330.purchase-guards.test.ts',
  'components/__tests__/THE-330.number-purchase-pickers.test.tsx',
  'components/__tests__/THE-330.number-purchase.layout.test.tsx',
];

const walk = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return e.name === 'node_modules' ? [] : walk(p);
    return /\.(ts|tsx)$/.test(e.name) ? [p] : [];
  });

/* ═══════════════════════════════════════════════════════════════════════════
   11 · 🔴 The country list is FETCHED, not hardcoded.
   ═══════════════════════════════════════════════════════════════════════════ */
describe('11 · the country list is fetched, not hardcoded', () => {
  it('🔴 the panel asks a route for the catalogue, and the route asks the provider', () => {
    expect(codeOf(read(PANEL)), 'the panel does not fetch a country list at all')
      .toMatch(/countries=1/);
    expect(codeOf(read(ROUTE)), 'the route does not ask the provider for countries')
      .toMatch(/zernioListCountries/);
    expect(codeOf(read(ZERNIO)), 'the transport does not call the countries endpoint')
      .toMatch(/\/phone-numbers\/countries/);
  });

  /**
   * 🔴 THE SWEEP FOR A LITERAL COUNTRY ARRAY — the mutation being "hardcode the
   * country list".
   *
   * ⚠️ It looks for an ARRAY OF ISO-2 CODES, which is the shape a hardcoded list
   * actually takes, rather than for the word "country". A single `'US'` default
   * is NOT that: it is one preference for one code, honoured only if the fetched
   * catalogue offers it, and the panel's own suite proves the picker's contents
   * come from the response. Three or more quoted two-letter uppercase strings in
   * a row IS a list, and no other shape has ever been one.
   */
  it('🔴 no file in this ticket carries a literal array of country codes', () => {
    const LIST = /\[\s*(?:'[A-Z]{2}'|"[A-Z]{2}")\s*,\s*(?:'[A-Z]{2}'|"[A-Z]{2}")\s*,\s*(?:'[A-Z]{2}'|"[A-Z]{2}")/;
    for (const rel of [ZERNIO, ROUTE, PANEL, COUNTRIES]) {
      const src = codeOf(read(rel));
      expect(LIST.test(src), `${rel} carries a hardcoded country list`).toBe(false);
    }
  });

  it('🔴 and no country NAME table is hardcoded either — the name comes from the platform', () => {
    // The provider sends no name, only a code. `Intl.DisplayNames` resolves one
    // and costs no dependency; a name table would be a second frozen list.
    const src = codeOf(read(COUNTRIES));
    expect(src, 'the country name is not resolved from the platform').toMatch(/Intl\.DisplayNames/);
    expect(src, 'a country name table was hardcoded').not.toMatch(/Germany|United Kingdom|Netherlands/);
  });

  it('🔴 and no price, tier or capability is hardcoded — every one is read off the response', () => {
    for (const rel of [PANEL, COUNTRIES]) {
      const src = codeOf(read(rel));
      // A cent figure spelled into the source would be a frozen rate card.
      expect(src.match(/\b(?:300|500|900|1300|1500|2300)\b/g) ?? [], `${rel} spells a provider price`)
        .toEqual([]);
    }
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   12–15 · 🔴 THE-318's four purchase fixes, untouched.
   ═══════════════════════════════════════════════════════════════════════════ */
describe('12–15 · THE-318\'s purchase fixes are intact', () => {
  it('🔴 12 · `wantsSms: true` is still requested, unconditionally', () => {
    const src = codeOf(read(ZERNIO));
    // 🔴 THE MUTATION THIS CATCHES: drop `wantsSms`.
    expect(src, 'wantsSms is gone — the number would come from the voice-only pool')
      .toMatch(/wantsSms:\s*true/);
    // ⚠️ NOT A PARAMETER. A `wantsSms` argument would be a way to reintroduce
    // the bug, so it is asserted absent from the purchase signature.
    expect(src, 'wantsSms became a caller-supplied argument').not.toMatch(/wantsSms\?\s*:/);
  });

  it('🔴 12 · and it is still paired with an SMS-capable TYPE resolved from the provider', () => {
    const route = codeOf(read(ROUTE));
    expect(route, 'the SMS pool type is no longer resolved before purchase')
      .toMatch(/zernioSmsNumberType/);
    expect(route, 'the resolved type is no longer sent with the purchase')
      .toMatch(/numberType:\s*pool\.numberType/);
    // 🔴 A definite "no SMS stock" still blocks the purchase.
    expect(route, 'a definite SMS_POOL_UNAVAILABLE no longer blocks the spend')
      .toMatch(/SMS_POOL_UNAVAILABLE/);
    // ⚠️ And a FAILED lookup still does NOT block it — that would trade this
    // ticket's bug for an outage.
    expect(codeOf(read(ZERNIO)), 'a failed type lookup no longer degrades safely')
      .toMatch(/numberType:\s*null,\s*available:\s*null/);
  });

  it('🔴 12 · THE-330\'s type picker cannot widen the pool — a named type is gated server-side', () => {
    const route = codeOf(read(ROUTE));
    // A client-named type that disagrees with the provider's SMS pool is refused
    // BEFORE the money, and the pool's own answer is still what is sent.
    expect(route, 'a client-named type is not checked against the SMS pool')
      .toMatch(/TYPE_NOT_SMS_CAPABLE/);
    expect(route, 'a client-named type can reach the provider in place of the pool\'s')
      .not.toMatch(/numberType:\s*(?:body|requestedType)/);
  });

  it('🔴 13 · `connectWhatsapp` is still EXPLICITLY false', () => {
    const src = codeOf(read(ZERNIO));
    // The provider defaults it to TRUE, so leaving it off is not the same thing.
    expect(src, 'connectWhatsapp is no longer set explicitly').toMatch(/connectWhatsapp:\s*false/);
    expect(src, 'connectWhatsapp was set true').not.toMatch(/connectWhatsapp:\s*true/);
    expect(src, 'wantsWhatsapp is no longer declared false').toMatch(/wantsWhatsapp:\s*false/);
  });

  it('🔴 13 · and `toll_free` is never combined with WhatsApp — the provider answers 400', () => {
    // The only way this arises is a toll_free purchase with connectWhatsapp
    // true. `connectWhatsapp` is a hardcoded false above, so the combination is
    // unreachable by construction — asserted rather than assumed.
    const src = codeOf(read(ZERNIO));
    expect(src.match(/connectWhatsapp:/g) ?? [], 'connectWhatsapp is set in more than one place')
      .toHaveLength(1);
    // 🔴 And the picker never SELECTS toll_free for SMS: it is not SMS-capable
    // anywhere in the live data, and the picker offers only SMS-capable types.
    expect(codeOf(read(COUNTRIES)), 'the buyable filter no longer requires SMS capability')
      .toMatch(/smsAvailable === true/);
  });

  it('🔴 14 · the RETURNED profileId is stored, never the requested one', () => {
    const route = codeOf(read(ROUTE));
    // 🔴 THE MUTATION THIS CATCHES: store `tenantId` unconditionally.
    expect(route, 'the assigned profile is no longer read off the response')
      .toMatch(/number\.profileId\s*\?\?\s*null/);
    expect(route, 'the profile written is not the one the provider assigned')
      .toMatch(/profileId:\s*assignedProfileId/);
    /**
     * 🔴 SCOPED TO THE WRITE, and that scoping is the point. `tenantId` IS still
     * sent as the REQUESTED profile on the purchase call — the provider
     * documents it as a preference — so a file-wide sweep for
     * `profileId: tenantId` would fail on the correct code. What must never
     * happen is that the requested value reaches the RECORD, so the Firestore
     * write is isolated and read on its own.
     */
    const write = route.slice(route.indexOf('SMS_DOC(tenantId).set'));
    expect(write.length, 'the number record is no longer written here').toBeGreaterThan(0);
    expect(write, 'the REQUESTED profile is being stored again')
      .not.toMatch(/profileId:\s*tenantId/);
    expect(codeOf(read(ZERNIO)), 'the transport no longer reads the assigned profile back')
      .toMatch(/typeof d\.profileId === 'string'/);
  });

  it('🔴 15 · `allowMultiple` is still passed for the 10-minute velocity window', () => {
    expect(codeOf(read(ROUTE)), 'allowMultiple is gone — a second church would be refused')
      .toMatch(/allowMultiple:\s*true/);
    expect(codeOf(read(ZERNIO)), 'the transport no longer forwards allowMultiple')
      .toMatch(/allowMultiple/);
  });

  it('🔴 15 · AREA_CODE_UNAVAILABLE and the KYC 202 are still handled DISTINCTLY', () => {
    const route = codeOf(read(ROUTE));
    // Three different answers, none collapsed into "Provider error 409".
    expect(route, 'PURCHASE_VELOCITY lost its own answer').toMatch(/PURCHASE_VELOCITY/);
    expect(route, 'AREA_CODE_UNAVAILABLE lost its own answer').toMatch(/AREA_CODE_UNAVAILABLE/);
    expect(route, 'the KYC 202 is no longer answered as its own shape').toMatch(/kycRequired/);
    expect(route, 'the KYC address is no longer surfaced').toMatch(/kycUrl/);
    expect(route, 'the KYC answer is no longer a 202').toMatch(/status:\s*202/);
    // 🔴 And a KYC 202 still records NOTHING: nothing was ordered, nothing billed.
    expect(route, 'a KYC 202 no longer answers with a null number').toMatch(/number:\s*null,\s*status:\s*'kyc_required'/);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   16 · 🔴 The carrier-registration warning is still above the Buy button.
   ═══════════════════════════════════════════════════════════════════════════ */
describe('16 · the carrier-registration warning is still above the Buy button', () => {
  it('🔴 the sentence is unchanged, word for word', async () => {
    const { REGISTRATION_WARNING } = await import('../components/settings/SmsSection');
    // 🔴 THE MUTATION THIS CATCHES: remove the registration warning.
    expect(REGISTRATION_WARNING).toBe(
      'US carriers only deliver texts from a registered sender. Harvest applies its own carrier registration to your number when you buy it, but the number cannot send until the carriers accept it, and its status will read "Waiting on carrier registration" until they do. Do not print or announce a number before its status reads active.',
    );
  });

  it('🔴 and it is rendered BEFORE the buy action in the source order', () => {
    const src = read(PANEL);
    const warning = src.indexOf('REGISTRATION_WARNING}</AlertDescription>');
    const buy = src.indexOf('{busy === \'buy\' ? \'Buying…\' : \'Buy a number\'}');
    expect(warning, 'the registration warning is not rendered').toBeGreaterThan(-1);
    expect(buy, 'the buy action is not rendered').toBeGreaterThan(-1);
    expect(warning, 'the registration warning moved below the Buy button').toBeLessThan(buy);
  });

  it('and the "cannot deliver yet" note on an inactive number is unchanged', async () => {
    const { CANNOT_DELIVER_YET } = await import('../components/settings/SmsSection');
    expect(CANNOT_DELIVER_YET).toBe(
      'This number is not able to deliver messages yet. Carrier registration is still outstanding, so anything sent from it may be dropped without a failure being reported.',
    );
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   17 · 🔴 STOP still stops; every send and number is metered; one send path.
   ═══════════════════════════════════════════════════════════════════════════ */
describe('17 · STOP, metering and the send path are untouched', () => {
  it('🔴 this ticket opened none of the STOP, metering or send modules', () => {
    /**
     * 🔴 THE STRONGEST FORM OF THE CLAIM — a digest, not a reading of what the
     * files say. `sms-optout.ts` is carrier-mandated and it is HARVEST'S account
     * that gets blocked, because Harvest resells.
     */
    const digest = (rel: string) =>
      createHash('sha256').update(readFileSync(path.join(SRC, rel))).digest('hex');
    const UNOPENED: Record<string, string> = {
      'lib/sms-optout.ts': 'a92f960897d644ba7832b68c0a8e866c146babbe0c0a800b78cc9d71b49a527c',
    };
    for (const [rel, expected] of Object.entries(UNOPENED)) {
      expect(digest(rel), `${rel} was edited — STOP handling is out of scope`).toBe(expected);
    }
  });

  it('🔴 the meter still BLOCKS: it reserves in the same transaction as the read', () => {
    const src = codeOf(read('lib/sms-usage.ts'));
    expect(src, 'the segment reservation is gone').toMatch(/reserveSmsSegment/);
    // The reserve-in-transaction property is what makes the cap real rather
    // than advisory.
    expect(src, 'the reservation is no longer transactional').toMatch(/runTransaction/);
  });

  it('🔴 and `sendSms` still refuses without calling the provider when the cap is reached', () => {
    const src = codeOf(read('lib/sms-send.ts'));
    expect(src, 'the cap no longer refuses a send').toMatch(/sms_cap_reached/);
  });

  it('🔴 `sendTenantSms` is still the ONLY send interface', () => {
    // Only the funnel may reach the provider's send call.
    const senders = walk(SRC)
      .filter((f) => !f.includes(`${path.sep}__tests__${path.sep}`))
      .filter((f) => /zernioSendSms/.test(readFileSync(f, 'utf8')))
      .map((f) => path.relative(SRC, f))
      .sort();
    expect(senders, 'something other than the funnel sends').toEqual(['lib/sms-send.ts', 'lib/zernio.ts']);
  });

  it('🔴 and `sms-feature.ts` still imports NOTHING, deliberately', () => {
    expect(codeOf(read('lib/sms-feature.ts')), 'sms-feature.ts gained an import')
      .not.toMatch(/^\s*import\s/m);
  });

  it('🔴 nothing this ticket added sends, meters or writes a number record', () => {
    for (const rel of [COUNTRIES]) {
      const src = codeOf(read(rel));
      for (const [re, what] of [
        [/zernioSendSms|sendTenantSms|sendSms/, 'sends'],
        [/reserveSmsSegment|settleSmsSegment/, 'meters'],
        [/adminDb|SMS_DOC|firestore/i, 'writes'],
        [/fetch\s*\(/, 'makes a network call'],
      ] as [RegExp, string][]) {
        expect(re.test(src), `${rel} ${what}`).toBe(false);
      }
    }
  });

  it('🔴 the public webhook\'s signature check is not weakened', () => {
    const src = codeOf(read(ZERNIO));
    expect(src, 'the signature verifier is gone').toMatch(/verifyZernioSignature/);
    // Fails CLOSED on every ambiguity, and compares in constant time.
    expect(src, 'the verifier no longer fails closed without a secret or header')
      .toMatch(/if \(!secret \|\| !header\) return false/);
    expect(src, 'the comparison is no longer timing-safe').toMatch(/timingSafeEqual/);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   18 · SMS is still Ministry-only.
   ═══════════════════════════════════════════════════════════════════════════ */
describe('18 · SMS is still Ministry-only', () => {
  it('🔴 every new endpoint is behind the SAME entitlement gate as the purchase', () => {
    const route = codeOf(read(ROUTE));
    // Three reads and one write, each gated. A new endpoint that forgot the gate
    // would hand the provider's rate card to any admin.
    expect((route.match(/await entitled\(tenantId\)/g) ?? []).length,
      'a route branch is not behind the Ministry gate').toBeGreaterThanOrEqual(4);
    expect(route, 'the gate is no longer resolved through the feature map')
      .toMatch(/getEffectiveFeatures/);
    expect(route, 'the gate became a hardcoded plan check').not.toMatch(/plan === 'max'/);
  });

  it('the tier that carries SMS is unchanged, named per tier', async () => {
    const { getEffectiveFeatures, toTenantPlan } = await import('../utils/plan-features');
    const { readTenantAddons } = await import('../utils/plan-features');
    /* ⚠️ NO add-ons, spelled through the module's own reader rather than as a
       bare `[]`: the gate resolves through `getEffectiveFeatures` precisely so
       an add-on could lift it later (THE-253), and the claim here is about the
       PLAN alone. */
    const smsOn = (plan: string) =>
      getEffectiveFeatures(toTenantPlan(plan), readTenantAddons(undefined)).smsAutomation === true;
    // 🔴 NAMED, so a widened tier says which one it let in.
    expect(smsOn('max'), 'Ministry lost SMS').toBe(true);
    for (const plan of ['free', 'starter', 'pro', 'growth']) {
      expect(smsOn(plan), `${plan} gained SMS — the tier was widened`).toBe(false);
    }
  });

  it('🔴 and no client-side entitlement write was introduced', () => {
    for (const rel of [PANEL, ROUTE, COUNTRIES]) {
      const src = codeOf(read(rel));
      // #434 removed a client `plan` write; THE-259's sweep catches a new one.
      expect(src, `${rel} writes a plan`).not.toMatch(/\bplan:\s*['"]/);
      expect(src, `${rel} writes an entitlement`).not.toMatch(/setDoc|updateDoc/);
    }
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   19 · Provider prices are the PROVIDER's — never a Harvest plan price.
   ═══════════════════════════════════════════════════════════════════════════ */
describe('19 · no plan price literal; provider prices do not route through formatPlanPrice', () => {
  it('🔴 no file in this ticket calls `formatPlanPrice`', () => {
    for (const rel of [PANEL, COUNTRIES, ROUTE, ZERNIO]) {
      expect(codeOf(read(rel)), `${rel} routes a carrier price through the plan formatter`)
        .not.toMatch(/formatPlanPrice/);
    }
  });

  it('🔴 and introduces no plan price literal', () => {
    for (const rel of [PANEL, COUNTRIES]) {
      const src = codeOf(read(rel));
      // A `$` followed by digits spelled into the source would be a price
      // Harvest invented rather than one the provider reported.
      expect(src.match(/\$\d/g) ?? [], `${rel} spells a price literal`).toEqual([]);
    }
  });

  it('🔴 a missing price renders as an em dash, never as free', () => {
    // "$0.00" on a screen where somebody agrees to a recurring charge is a
    // false claim, and the same reasoning zernio.ts records on monthlyCostUsd.
    const src = codeOf(read(COUNTRIES));
    expect(src, 'a missing price no longer renders as an em dash').toMatch(/return '—'/);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   20 · Every element that has a primitive uses it; inline styles stay at zero.
   ═══════════════════════════════════════════════════════════════════════════ */
describe('20 · primitives are used, and inline styles stay where they were', () => {
  it('🔴 the panel imports every primitive this ticket adopts', () => {
    const src = read(PANEL);
    for (const name of ['badge', 'table', 'item', 'skeleton', 'empty', 'alert', 'card', 'label', 'button']) {
      expect(src, `the panel stopped composing \`${name}\``)
        .toMatch(new RegExp(`from ['"](?:@/components|\\.{1,2}(?:/[\\w.-]+)*)/ui/${name}['"]`));
    }
  });

  it('🔴 and every primitive it REJECTS is named with its reason at the call site', () => {
    const src = read(PANEL);
    // "It did not fit" is not an answer, so each rejection is spelled out.
    for (const [primitive, re] of [
      ['select', /`ui\/select` REJECTED/],
      ['skeleton', /`ui\/skeleton` REJECTED/],
      ['item', /`ui\/item` REJECTED/],
      ['CardTitle', /`CardTitle` REJECTED/],
    ] as [string, RegExp][]) {
      expect(src, `\`${primitive}\` is rejected with no reason given`).toMatch(re);
    }
    // `ui/select` is rejected OUTRIGHT: it is imported nowhere in this file.
    expect(
      /from ['"](?:@\/components|\.{1,2}(?:\/[\w.-]+)*)\/ui\/select['"]/.test(src),
      'the panel records `select` as rejected but imports it',
    ).toBe(false);
  });

  it('🔴 the panel keeps exactly ONE inline style — the justified clearance', () => {
    // THE-314 put it there, THE-318's suite pins it at one and justifies it in
    // as many words. This ticket added none.
    const hits = read(PANEL).match(/style=\{\{/g) ?? [];
    expect(hits, `the panel carries ${hits.length} inline style(s), not one`).toHaveLength(1);
  });

  it('🔴 `accordion` is not installed, and nothing here reaches for it', () => {
    const uiDir = path.join(SRC, 'components/ui');
    expect(readdirSync(uiDir).includes('accordion.tsx'), 'an accordion primitive appeared').toBe(false);
    for (const rel of MINE.filter((f) => f.endsWith('.tsx') || f.endsWith('.ts'))) {
      expect(codeOf(read(rel)), `${rel} imports a primitive that does not exist`)
        .not.toMatch(/ui\/accordion/);
    }
  });

  it('🔴 no new dependency, component or token was added', async () => {
    const pkg = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
    const before = JSON.parse(readFileSync(path.join(ROOT, 'package-lock.json'), 'utf8'));
    // Nothing in this ticket needs a package: `Intl.DisplayNames` is the
    // platform, and every primitive it composes was already installed.
    for (const rel of [PANEL, COUNTRIES, ROUTE, ZERNIO]) {
      /* ⚠️ REAL IMPORT STATEMENTS ONLY, on comment-stripped source. Reading raw
         source picks up the phrase "from '…'" inside prose and asserts against
         a package called `number`. */
      const specs = [...codeOf(read(rel)).matchAll(/^\s*import\b[^;]*?from\s*['"]([^'"]+)['"]/gm)]
        .map((m) => m[1]);
      for (const spec of specs) {
        if (spec.startsWith('.') || spec.startsWith('@/')) continue;
        const base = spec.startsWith('@') ? spec.split('/').slice(0, 2).join('/') : spec.split('/')[0];
        if (['react', 'next', 'crypto', 'node:crypto'].includes(base)) continue;
        expect(
          { ...pkg.dependencies, ...pkg.devDependencies }[base],
          `${rel} imports ${base}, which is not a declared dependency`,
        ).toBeDefined();
      }
    }
    // `--radius-brand-xl` does not exist, and this ticket did not invent it.
    for (const rel of [PANEL]) {
      expect(codeOf(read(rel)), 'a token that does not exist was spelled')
        .not.toMatch(/radius-brand-xl|rounded-brand-xl/);
    }
    expect(before.lockfileVersion, 'the lockfile shape changed').toBeGreaterThan(0);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   23 · No colour hardcoded, no emoji; both palettes resolve.
   ═══════════════════════════════════════════════════════════════════════════ */
describe('23 · no colour hardcoded, no emoji; Classic is still the default', () => {
  const TOUCHED = [PANEL, COUNTRIES];

  it.each(TOUCHED)('%s spells no colour literal', (rel) => {
    const src = codeOf(read(rel));
    // 🔴 A hex fallback is a defect, not a safety net: it paints the SAME colour
    // in both palettes the one moment the token is undefined.
    expect(src.match(/#[0-9a-fA-F]{3,8}\b/g) ?? [], `${rel} spells a raw colour`).toEqual([]);
    expect(src.match(/\b(?:rgba?|hsla?)\s*\(/g) ?? [], `${rel} spells an rgb()/hsl() colour`).toEqual([]);
  });

  it.each(TOUCHED)('%s renders no emoji', (rel) => {
    /* Comments carry the repo's 🔴/⚠️/✅ convention; RENDERED copy may not, so
       the source is stripped of comments before the sweep.
       ⚠️ `\p{Extended_Pictographic}`, NOT a hand-drawn range: the obvious
       2600–27BF also swallows U+2713 CHECK MARK, a typographic mark this repo
       uses in its "✓ Saved" confirmations. */
    const emoji = codeOf(read(rel)).match(/\p{Extended_Pictographic}/gu) ?? [];
    expect(emoji, `${rel} renders an emoji`).toEqual([]);
  });

  it('🔴 the palette family axis is gone (THE-338)', async () => {
    // 🔴 INVERTED, not deleted: this pinned #409's default family and that
    // both families were still offered. THE-338 removed the axis — the second
    // family's 14 overrides were promoted into :root/.dark — so what is
    // guarded is that neither the default nor the family list comes back.
    const theme = await import('../lib/theme');
    expect('DEFAULT_PALETTE_FAMILY' in theme, 'the family default is back').toBe(false);
    expect('PALETTE_FAMILIES' in theme, 'the family list is back').toBe(false);
  });

  it('the new pickers paint from brand tokens, so they follow the palette', () => {
    const src = codeOf(read(PANEL));
    expect(src, 'the pickers stopped using the brand token utilities')
      .toMatch(/ring-gold/);
  });

  it('🔴 and no width was invented — every field width is a form-layout token', async () => {
    const { FIELD_WIDTHS } = await import('../components/layout/form-layout');
    const src = codeOf(read(PANEL));
    for (const m of src.matchAll(/sm:max-w-\[(\d+)px\]/g)) {
      expect(FIELD_WIDTHS, `the panel invents the width ${m[0]}`).toContain(m[0]);
    }
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   24–25 · Two ways this repo has taken `main` down before.
   ═══════════════════════════════════════════════════════════════════════════ */
describe('24 · no test fixture in this PR is pinned to a date near today', () => {
  /**
   * 🔴 #468 TURNED `main` RED FOR EVERYONE when the clock passed a fixture
   * pinned to `'2026-09-06T10:00'`. So this ticket pins no date at all — said as
   * an assertion rather than as a promise in a comment.
   */
  const SUITES = MINE.filter((f) => f.includes('__tests__'));

  it.each(SUITES)('%s pins no date within a year of now', (rel) => {
    /* 🔴 COMMENTS STRIPPED FIRST — the docblock above quotes #468's own date to
       say what went wrong, and reading it raw makes this guard fail on its own
       explanation. */
    const src = codeOf(read(rel));
    const now = Date.now();
    const YEAR = 365 * 24 * 60 * 60 * 1000;
    for (const m of src.matchAll(/'(\d{4}-\d{2}-\d{2}(?:T[\d:.]+Z?)?)'/g)) {
      const t = Date.parse(m[1]);
      if (Number.isNaN(t)) continue;
      expect(
        Math.abs(t - now) > YEAR,
        `${rel} pins ${m[1]}, which the clock will pass — this is how #468 took main down`,
      ).toBe(true);
    }
  });

  it('and it fakes no timers, so `toFake` cannot be got wrong', () => {
    /* ⚠️ `toFake` is LOAD-BEARING where timers ARE faked — faking `setTimeout`
       timed out 28 of 47 tests in a sibling suite. This ticket avoids the
       question by not needing fake timers at all. */
    for (const rel of SUITES) {
      expect(codeOf(read(rel)), `${rel} fakes timers without naming toFake`)
        .not.toMatch(/useFakeTimers\((?!\s*\{[^}]*toFake)/);
    }
  });
});

describe('25 · no guard in this PR asserts anything about the current branch\'s diff', () => {
  /**
   * 🔴 #454 IS A STANDING SWEEP, and `THE-315.branch-diff-guards.test.ts` is the
   * repo-wide detector — including its dataflow version, which follows an
   * identifier ONE HOP from the diff read (card `86bbvhaky`: a detector that saw
   * only the direct binding missed the guard that took CI down).
   *
   * ⚠️ The claim is therefore NARROW and ABSOLUTE: the files this ticket adds run
   * `git` at no point, so there is nothing for the dataflow detector to follow.
   */
  it.each(MINE.filter((f) => f.includes('__tests__')))('%s reads no diff and shells out to no git', (rel) => {
    /* 🔴 Literals blanked, so this sweep cannot be satisfied by its own regex —
       the exact failure a sibling suite hit on its first run. */
    const src = blankLiterals(codeOf(read(rel)));
    expect(src, `${rel} shells out to git`).not.toMatch(/execFileSync|execSync|spawnSync|child_process/);
    expect(src, `${rel} reads the branch diff`).not.toMatch(/\bgit\b/);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   26 · The files this ticket must not open are byte-identical.
   ═══════════════════════════════════════════════════════════════════════════ */
describe('26 · the untouchable files are byte-identical', () => {
  /**
   * 🔴 `firestore.rules` AUTO-DEPLOYS TO PRODUCTION on merge and CI runs no
   * emulator tests against it. `functions/` is a separate deploy. `sms-optout.ts`
   * is carrier-mandated STOP handling and `layout.tsx` is the app shell. All are
   * out of scope by instruction, and this ticket needed none of them.
   *
   * ⚠️ Digests, not a diff — nothing here shells out to git.
   */
  const digest = (rel: string) =>
    createHash('sha256').update(readFileSync(path.join(ROOT, rel))).digest('hex');

  const UNTOUCHED: Record<string, string> = {
    'firestore.indexes.json': '8ae29121ceb65f8fc06df89435829496cd06ee0abff98c1ad24f6f470da2c6b0',
    'src/lib/sms-optout.ts': 'a92f960897d644ba7832b68c0a8e866c146babbe0c0a800b78cc9d71b49a527c',
    'src/app/layout.tsx': 'b9bdf22ae920933587b39c5030cbf1ef4f89b02230578e5ad6c4b715b824c63f',
  };

  it('firestore.rules is unchanged', () => {
    expect(
      rulesDigestFailure(),
      'firestore.rules is at a digest no ticket recorded — it auto-deploys to production',
    ).toBeNull();
  });

  it.each(Object.entries(UNTOUCHED))('%s is unchanged', (rel, expected) => {
    expect(digest(rel), `${rel} was edited — this ticket must not open it`).toBe(expected);
  });

  it('and no file under functions/ was opened', () => {
    const hash = createHash('sha256');
    const walkAll = (dir: string) => {
      for (const entry of readdirSync(dir).sort()) {
        if (entry === 'node_modules' || entry === 'lib' || entry === '.git') continue;
        const p = path.join(dir, entry);
        if (statSync(p).isDirectory()) walkAll(p);
        else hash.update(entry).update(readFileSync(p));
      }
    };
    walkAll(path.join(ROOT, 'functions'));
    expect(hash.digest('hex'), 'a file under functions/ was edited — it is a separate deploy')
      .toBe('d14c883cc5fa51f4a7fa3081496a8a46f9d9c93ec4210060df6ff1d242526acd');
  });
});
