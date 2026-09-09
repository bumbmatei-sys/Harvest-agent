import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

import { GMAIL_FEATURE_ENABLED, GMAIL_HIDDEN_MESSAGE, GMAIL_PAUSED_NOTICE } from '../lib/gmail-feature';
import { SMS_FEATURE_ENABLED } from '../lib/sms-feature';
import { NEWSLETTER_FEATURE_ENABLED } from '../lib/newsletter-feature';
import { QUICKBOOKS_FEATURE_ENABLED } from '../lib/quickbooks-feature';
import { STRIPE_CONNECT_ENABLED } from '../lib/stripe-connect-feature';
import { CUSTOM_DOMAIN_ENABLED } from '../lib/custom-domain-feature';
import { AFFILIATE_PROGRAM_ENABLED } from '../utils/plan-features';
import { MEMBER_DATA_MAP } from '../lib/member-erasure';
import { assertSendOnlyGmailScopes, GmailScopeError } from '../lib/gmail-scopes';
import { INTEGRATION_PROVIDERS } from '../components/settings/integration-providers';

/**
 * ═════════════════════════════════════════════════════════════════════════════
 * THE-339 — hide the Gmail connection until there is an inbox
 * ═════════════════════════════════════════════════════════════════════════════
 *
 * The founder: "hide gmail connection feature to email users until harvest
 * scheduler that will have an inbox."
 *
 * 🔴 WHAT THIS FILE IS FOR, and what it deliberately is not. The per-surface
 * behaviour lives in the suites that own each surface — `THE-339.gmail-routes`
 * for the four gated handlers, `THE-339.gmail-surfaces` for the screen,
 * `THE-339.rota-reaches-volunteer` for the blocking question,
 * `AdminSettings.integrations-gating` for the provider list. THIS file asserts
 * the things that belong to no single surface: the switch itself, that NOTHING
 * was deleted, that the scope guard and the two GDPR paths are untouched, and
 * that no other switch moved while this one did.
 *
 * ⚠️ EVERY SOURCE GREP BELOW READS CODE, NOT PROSE. These files DISCUSS Gmail at
 * length — `rota-invite.ts` mentions it thirteen times and every one is a
 * comment — and a raw grep would pass on the documentation while the behaviour
 * underneath it was inverted. Eleven guards in this series passed a planted
 * defect, one of them because an IMPORT LINE carried the word it grepped for.
 *
 * ⚠️ Nothing here shells out to git, reads a diff, or pins a line number
 * (#454, THE-331).
 */

const ROOT = path.resolve(__dirname, '../..');
const SRC = path.join(ROOT, 'src');
const read = (rel: string) => readFileSync(path.join(ROOT, rel), 'utf8');

/**
 * Source with block comments and line comments removed.
 *
 * WHY THIS IS NOT THE `code()` THE-286 AND THE-296 CARRY. Theirs runs a
 * JSX-comment pass first, and that pass is wrong in a way that hides code
 * rather than comments. It anchors on a brace followed by whitespace and a
 * block-comment opener — which an interface body whose first member carries a
 * doc comment matches — and its non-greedy tail then runs to the first
 * comment-close-then-brace anywhere below, taking every line between with it.
 * Run against `IntegrationsSection.tsx` it removes about 150 lines including
 * the provider gate itself, and every assertion over the result then passes
 * vacuously. That is how this file first "proved" a gate that was not there.
 *
 * The generic block-comment pass below already removes a JSX comment body; it
 * leaves a bare pair of braces behind, which matters to a parser and not to a
 * grep.
 */
const code = (rel: string) =>
  read(rel)
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/^[ \t]*\/\/.*$/gm, ' ');

/* ── 1 ─────────────────────────────────────────────────────────────────────
   The switch itself — the whole ticket in one value.                         */
describe('1 — the Gmail feature flag is false', () => {
  it('🔴 GMAIL_FEATURE_ENABLED is false', () => {
    expect(GMAIL_FEATURE_ENABLED, 'the Gmail switch is not off').toBe(false);
  });

  it('is ONE declared value, declared once, in the module that owns it', () => {
    const src = read('src/lib/gmail-feature.ts');
    const declarations = src.match(/export const GMAIL_FEATURE_ENABLED\s*=/g) ?? [];
    expect(declarations, 'the switch is declared more than once, or not at all').toHaveLength(1);
    expect(src, 'the switch is not a literal — it is computed from something').toMatch(
      /export const GMAIL_FEATURE_ENABLED = (?:true|false);/,
    );
  });

  it('and every reader imports it rather than keeping a copy', () => {
    for (const rel of sourceFiles()) {
      const body = read(rel);
      if (!body.includes('GMAIL_FEATURE_ENABLED')) continue;
      if (rel === 'src/lib/gmail-feature.ts') continue;
      expect(body, `${rel} does not import GMAIL_FEATURE_ENABLED`)
        .toMatch(/import \{[^}]*GMAIL_FEATURE_ENABLED[^}]*\} from ['"][^'"]*gmail-feature['"]/);
      expect(body, `${rel} declares its own GMAIL_FEATURE_ENABLED`)
        .not.toMatch(/(const|let|var)\s+GMAIL_FEATURE_ENABLED\s*=/);
    }
  });

  it('the refusal and the on-screen notice both say something', () => {
    // A switch whose message is empty converts a loud refusal into a quiet one.
    expect(GMAIL_HIDDEN_MESSAGE.trim().length, 'the route message is empty').toBeGreaterThan(10);
    expect(GMAIL_PAUSED_NOTICE.trim().length, 'the on-screen notice is empty').toBeGreaterThan(20);
    // 503, not 404: the route EXISTS and is coming back.
    expect(GMAIL_HIDDEN_MESSAGE, 'the message reads as a permanent removal')
      .toMatch(/temporarily|unavailable/i);
  });
});

/* ── 2 ─────────────────────────────────────────────────────────────────────
   The flag module imports nothing.                                           */
describe('2 — the flag module imports NOTHING', () => {
  it('🔴 same discipline as sms-feature.ts, and for the same reason', () => {
    const src = read('src/lib/gmail-feature.ts');
    expect(code('src/lib/gmail-feature.ts'), 'the Gmail switch grew an import')
      .not.toMatch(/^\s*import\s/m);
    expect(src, 'the Gmail switch grew a require').not.toMatch(/require\(/);
    // Held against the file it is modelled on, so the two cannot drift apart
    // without somebody noticing here.
    expect(code('src/lib/sms-feature.ts'), 'sms-feature.ts grew an import').not.toMatch(/^\s*import\s/m);
    expect(code('src/lib/newsletter-feature.ts'), 'newsletter-feature.ts grew an import')
      .not.toMatch(/^\s*import\s/m);
  });
});

/* ── 3 ─────────────────────────────────────────────────────────────────────
   Every surface, named one by one.                                           */
describe('3 — every Gmail surface reads the switch, named per surface', () => {
  /**
   * 🔴 NAMED BY THE SURFACE, not by a path, so a failure reads as "the CRM send
   * is not gated" rather than as a filename. Each entry says what a reader would
   * lose if the gate were missing.
   */
  const GATED_SURFACES = [
    ['the Gmail connect route — where an OAuth grant is started',
      'src/app/api/composio/gmail/connect/route.ts'],
    ['the Gmail OAuth callback — where a grant is completed',
      'src/app/api/composio/gmail/callback/route.ts'],
    ['the Gmail sending-address route',
      'src/app/api/composio/gmail/address/route.ts'],
    ['/api/crm/send-email — the send itself',
      'src/app/api/crm/send-email/route.ts'],
    ['the Integrations connect/disconnect UI',
      'src/components/settings/IntegrationsSection.tsx'],
    ['the CRM contact email affordance',
      'src/components/AdminCRM.tsx'],
  ] as const;

  it.each(GATED_SURFACES)('%s reads the switch', (_surface, rel) => {
    expect(code(rel), `${rel} does not read GMAIL_FEATURE_ENABLED in code`)
      .toMatch(/GMAIL_FEATURE_ENABLED/);
  });

  it.each(GATED_SURFACES.filter(([, r]) => r.includes('/api/')))(
    '%s refuses FIRST, before it authenticates or reads',
    (_surface, rel) => {
      // The switch is the first statement in the handler, so a hidden feature
      // spends no Firestore read and no OAuth round trip on a caller. Located by
      // pattern from the handler signature, never by line number.
      const src = code(rel);
      const handler = /export async function (?:GET|POST)\([^)]*\) \{\s*(?:try \{\s*)?([\s\S]{0,400})/.exec(src);
      expect(handler, `${rel} has no recognisable handler`).not.toBeNull();
      expect(handler![1], `${rel} does not refuse first`).toMatch(/if \(!GMAIL_FEATURE_ENABLED\)/);
    },
  );

  it('🔴 the CRM gate is the switch AND the plan predicate, not the switch instead of it', () => {
    // If the switch REPLACED the plan gate, flipping it back would restore an
    // approximation of THE-193/THE-225 rather than the thing itself.
    const crm = code('src/components/AdminCRM.tsx');
    const gate = crm.slice(crm.indexOf('const canConnectGmail'));
    expect(gate.slice(0, 400), 'the CRM stopped reading the switch').toContain('GMAIL_FEATURE_ENABLED &&');
    expect(gate.slice(0, 400), 'the CRM stopped asking the plan predicate').toContain('isProviderAvailable(');
  });

  it('🔴 and the provider entry itself is untouched, so the flip back is a restoration', () => {
    const gmail = INTEGRATION_PROVIDERS.find((p) => p.id === 'gmail');
    expect(gmail, 'the gmail provider entry was deleted rather than hidden').toBeTruthy();
    expect(gmail!.concern).toBe('crm');
    expect(gmail!.feature).toBe('crm');
    expect(gmail!.outboundSend).toBe(true);
    expect(code('src/components/settings/integration-providers.ts'),
      'the provider module started reading a feature switch').not.toMatch(/GMAIL_FEATURE_ENABLED/);
  });
});

/* ── 4 ─────────────────────────────────────────────────────────────────────
   Nothing was deleted.                                                       */
describe('4 — NO file was deleted', () => {
  /**
   * 🔴 EVERY FILE THAT MENTIONS GMAIL, ENUMERATED. The switch's whole promise is
   * that setting it true brings every surface back exactly as it was, and that
   * promise is only worth something if nothing was removed to hide it.
   *
   * ⚠️ The brief said 21 files; there are 23. `transactional-email.ts` arrived
   * with THE-340 and mentions Gmail in the note explaining why rota mail left
   * it, and `gmail-feature.ts` is this ticket's own switch. The list is verified
   * rather than taken.
   */
  const GMAIL_FILES = [
    'src/components/settings/IntegrationsSection.tsx',
    'src/lib/gmail-scopes.ts',
    'src/components/AdminCRM.tsx',
    'src/app/api/composio/gmail/connect/route.ts',
    'src/app/api/crm/send-email/route.ts',
    'src/lib/rota-invite.ts',
    'src/app/api/composio/gmail/callback/route.ts',
    'src/lib/gmail-sender.ts',
    'src/app/api/composio/gmail/address/route.ts',
    'src/components/settings/integration-providers.ts',
    'src/app/api/composio/gmail/disconnect/route.ts',
    'src/app/api/composio/gmail/status/route.ts',
    'src/components/settings/autosave.ts',
    'src/components/AdminSettings.tsx',
    'src/lib/member-export.ts',
    'src/lib/member-erasure.ts',
    'src/lib/member-erasure-copy.ts',
    'src/lib/composio-client.ts',
    'src/lib/newsletter-feature.ts',
    'src/app/api/tenants/provision-free/route.ts',
    'src/lib/transactional-email.ts',
    'src/lib/gmail-feature.ts',
    'functions/src/index.ts',
  ] as const;

  it.each(GMAIL_FILES)('%s still exists', (rel) => {
    expect(existsSync(path.join(ROOT, rel)), `${rel} was DELETED — the switch exists so nothing is`)
      .toBe(true);
    expect(statSync(path.join(ROOT, rel)).size, `${rel} was emptied rather than deleted`)
      .toBeGreaterThan(0);
  });

  it('🔴 and the list is the real population, not a stale copy of it', () => {
    // The defence against the list itself rotting: every file on disk that
    // mentions Gmail must be one this case enumerated. A file added tomorrow
    // fails here rather than going unguarded, and a name that is no longer a
    // Gmail file fails the case above.
    const found = sourceFiles()
      .concat(functionsFiles())
      .filter((rel) => !rel.includes('__tests__') && /gmail/i.test(read(rel)));
    expect(found.sort(), 'the enumerated set no longer matches what is on disk')
      .toEqual([...GMAIL_FILES].sort());
  });

  it('the four gated routes were gated, not removed', () => {
    for (const rel of [
      'src/app/api/composio/gmail/connect/route.ts',
      'src/app/api/composio/gmail/callback/route.ts',
      'src/app/api/composio/gmail/address/route.ts',
      'src/app/api/crm/send-email/route.ts',
    ]) {
      // The handler is still exported, so the route still EXISTS as a route.
      expect(code(rel), `${rel} no longer exports a handler`)
        .toMatch(/export async function (?:GET|POST)\(/);
    }
  });
});

/* ── 5 ─────────────────────────────────────────────────────────────────────
   The scope guard.                                                           */
describe('5 — assertSendOnlyGmailScopes still fails closed', () => {
  const SEND = 'https://www.googleapis.com/auth/gmail.send';

  it('🔴 refuses every scope set that could read a mailbox', () => {
    // RUN, not grepped. A guard asserted by its own source text would pass with
    // the function deleted.
    for (const scopes of [
      ['https://www.googleapis.com/auth/gmail.readonly'],
      ['https://mail.google.com/'],
      ['https://www.googleapis.com/auth/gmail.modify'],
      [SEND, 'https://www.googleapis.com/auth/gmail.readonly'],
    ]) {
      expect(() => assertSendOnlyGmailScopes({ toolkitSlug: 'gmail', isComposioManaged: true, scopes }),
        `a mailbox-reading scope was accepted: ${scopes.join(' ')}`).toThrow(GmailScopeError);
    }
  });

  it('🔴 and refuses an unreadable config rather than assuming it is safe', () => {
    for (const scopes of [null, [] as string[]]) {
      expect(() => assertSendOnlyGmailScopes({ toolkitSlug: 'gmail', isComposioManaged: true, scopes }),
        'the guard opened on a config that declares no scopes').toThrow(GmailScopeError);
    }
  });

  it('still accepts a genuinely send-only config, so it is a guard and not a wall', () => {
    expect(() => assertSendOnlyGmailScopes({
      toolkitSlug: 'gmail', isComposioManaged: true, scopes: [SEND],
    })).not.toThrow();
  });

  it('🔴 the switch does not read, call or weaken it', () => {
    // Hiding the feature must not be a route by which the scope decision is
    // loosened. When Gmail comes back WITH an inbox, widening that scope is a
    // deliberate separate call, never a side effect of un-hiding.
    expect(code('src/lib/gmail-feature.ts'), 'the switch reaches into the scope guard')
      .not.toMatch(/assertSendOnlyGmailScopes|gmail-scopes/);
    expect(code('src/lib/gmail-scopes.ts'), 'the scope guard started reading a feature switch')
      .not.toMatch(/GMAIL_FEATURE_ENABLED/);
  });
});

/* ── 6 ─────────────────────────────────────────────────────────────────────
   The GDPR paths.                                                            */
describe('6 — member-erasure and member-export still handle Gmail data', () => {
  it("🔴 erasure still sweeps the member's Gmail connection, by name", () => {
    // The provider list is hardcoded in both files and already carries
    // `quickbooks` while THAT switch is off — the precedent #481 set. A member's
    // erasure right does not depend on whether a feature is advertised.
    expect(code('src/lib/member-erasure.ts'), 'erasure stopped naming gmail')
      .toMatch(/for \(const provider of \[[^\]]*'gmail'[^\]]*\]\)/);
    const entry = MEMBER_DATA_MAP.find((e) => e.collection === 'tenants/{t}/integrations');
    expect(entry, 'the integrations row left the erasure map').toBeTruthy();
    expect(entry!.disposition, 'the integrations row stopped being a delete').toBe('delete');
    expect(entry!.reason, 'the erasure map stopped naming Gmail').toMatch(/gmail/i);
    expect(entry!.sweep, 'the integrations row lost its sweep').toBeTypeOf('function');
  });

  it("🔴 export still returns the FACT of the Gmail connection, by name", () => {
    expect(code('src/lib/member-export.ts'), 'export stopped naming gmail')
      .toMatch(/for \(const provider of \[[^\]]*'gmail'[^\]]*\]\)/);
  });

  it('🔴 and NEITHER reads the switch, nor may start to', () => {
    for (const rel of ['src/lib/member-erasure.ts', 'src/lib/member-export.ts', 'src/lib/member-erasure-copy.ts']) {
      expect(code(rel), `${rel} gated a GDPR path on a marketing switch`)
        .not.toMatch(/GMAIL_FEATURE_ENABLED|gmail-feature/);
    }
  });
});

/* ── 7 ─────────────────────────────────────────────────────────────────────
   No other switch moved.                                                     */
describe('7 — no other feature switch moved', () => {
  const OTHERS = [
    ['SMS_FEATURE_ENABLED', SMS_FEATURE_ENABLED, false],
    ['NEWSLETTER_FEATURE_ENABLED', NEWSLETTER_FEATURE_ENABLED, false],
    ['QUICKBOOKS_FEATURE_ENABLED', QUICKBOOKS_FEATURE_ENABLED, false],
    ['STRIPE_CONNECT_ENABLED', STRIPE_CONNECT_ENABLED, false],
    ['CUSTOM_DOMAIN_ENABLED', CUSTOM_DOMAIN_ENABLED, false],
    ['AFFILIATE_PROGRAM_ENABLED', AFFILIATE_PROGRAM_ENABLED, false],
  ] as const;

  it.each(OTHERS)('%s is still %s', (_name, actual, expected) => {
    expect(actual).toBe(expected);
  });

  it("🔴 and the newsletter switch does not gate Gmail — its Gmail mention is prose", () => {
    // The brief asked whether `newsletter-feature.ts`'s Gmail reference is moot.
    // It is: the file mentions Gmail only to say it does NOT hide it, and the
    // section applies the newsletter switch by `concern` while the Gmail switch
    // is applied by `id`. Two switches, two clauses, neither standing in for
    // the other — which is what makes either one flippable on its own.
    expect(code('src/lib/newsletter-feature.ts'), 'the newsletter switch grew Gmail logic')
      .not.toMatch(/gmail/i);
    const section = code('src/components/settings/IntegrationsSection.tsx');
    expect(section, "the newsletter clause stopped keying on concern")
      .toMatch(/!NEWSLETTER_FEATURE_ENABLED && provider\.concern === 'newsletter'/);
    expect(section, 'the Gmail clause stopped keying on the provider id')
      .toMatch(/!GMAIL_FEATURE_ENABLED && provider\.id === 'gmail'/);
  });
});

/* ── 8 ─────────────────────────────────────────────────────────────────────
   A free tenant still provisions.                                            */
describe('8 — a free tenant still provisions cleanly', () => {
  it('the provisioning route neither reads the switch nor touches a Gmail integration', () => {
    const rel = 'src/app/api/tenants/provision-free/route.ts';
    expect(code(rel), 'free provisioning started reading the Gmail switch')
      .not.toMatch(/GMAIL_FEATURE_ENABLED|gmail-feature/);
    // Its only Gmail mention is prose about dot/plus addressing on signup — an
    // abuse note about email ADDRESSES, unrelated to the integration.
    expect(code(rel), 'free provisioning grew a Gmail integration dependency')
      .not.toMatch(/composio\/gmail|_gmail/);
  });
});

/* ── 9 ─────────────────────────────────────────────────────────────────────
   The switch does not reach functions/, and the do-not-touch set is pinned
   by guards this ticket did not write.                                       */
describe('9 — the do-not-touch set is untouched', () => {
  it('🔴 the switch does not reach functions/', () => {
    // A STOP condition of the brief. It does not: `functions/src/index.ts`
    // mentions Gmail only as the platform owner's own email ADDRESS literal.
    for (const rel of functionsFiles()) {
      expect(code(rel), `${rel} started reading the Gmail switch`)
        .not.toMatch(/GMAIL_FEATURE_ENABLED|gmail-feature/);
    }
  });

  it('and no reader of the switch lives outside src/', () => {
    const readers = sourceFiles().concat(functionsFiles())
      .filter((rel) => read(rel).includes('GMAIL_FEATURE_ENABLED'));
    expect(readers.length, 'nothing reads the switch — it would be gating nothing')
      .toBeGreaterThan(0);
    for (const rel of readers) {
      expect(rel.startsWith('src/'), `${rel} reads the switch from outside src/`).toBe(true);
      for (const forbidden of ['firestore.rules', 'firestore.indexes.json', 'functions/', 'src/app/layout.tsx']) {
        expect(rel.includes(forbidden), `${rel} is on the do-not-touch list`).toBe(false);
      }
    }
  });

  it('🔴 the four paths keep the pins that already freeze them, rather than a copy here', () => {
    /**
     * ⚠️ DELIBERATELY NOT A 55TH COPY OF THE DIGESTS. THE-325 consolidated the
     * accepted `firestore.rules` values out of 49 suites into one register
     * precisely because copies drift; adding another here would undo that and,
     * for the rules file, would make this suite a pinner that THE-322's exact
     * population count has to be told about. What this asserts instead is that
     * the guards which DO freeze these four paths still exist and still name
     * them — so a PR that quietly deletes the pin fails here.
     */
    const registerDir = path.join(SRC, '__tests__/__fixtures__/ownership');
    expect(existsSync(registerDir), 'the ownership register that pins layout.tsx is gone').toBe(true);
    const register = readdirSync(registerDir).map((n) => readFileSync(path.join(registerDir, n), 'utf8')).join('\n');
    expect(register, 'no ticket pins src/app/layout.tsx any more').toContain('src/app/layout.tsx');

    const untouched = read('src/components/__tests__/__fixtures__/the-286-untouched.json');
    expect(untouched, "the functions/ tree left THE-286's untouched map").toContain('functions/src/index.ts');

    /**
     * ⚠️ `firestore.rules` IS DELIBERATELY NOT NAMED BY ITS SHARED PIN MODULE
     * HERE, and the omission is load-bearing rather than an oversight. THE-322
     * classifies a suite as a rules PINNER by grepping for that module's name,
     * counts the population exactly, and requires every member to carry the
     * digest assertion — so merely mentioning it would enlist this file, force
     * an edit to another ticket's exact count, and add a 55th copy of a value
     * THE-325 consolidated for exactly that reason. THE-322 already asserts, on
     * every run, that the file on disk is at a digest some ticket recorded; what
     * is asserted here is only that THAT guard still exists and still covers it.
     */
    const registerGuard = read('src/__tests__/THE-322.ownership-register.test.ts');
    expect(registerGuard, 'the repo-wide guard stopped covering firestore.rules')
      .toContain('firestore.rules');
    expect(registerGuard, 'the repo-wide guard stopped covering firestore.indexes.json')
      .toContain('firestore.indexes.json');
  });
});

/* ── 10 ────────────────────────────────────────────────────────────────────
   Composition, colour, and the shapes this repo has been bitten by.          */
describe('10 — composition, colour, and the shapes this repo has been bitten by', () => {
  const NEW_MARKUP = 'src/components/settings/IntegrationsSection.tsx';

  it('the replacement state is the installed primitive, not a hand-rolled banner', () => {
    const src = code(NEW_MARKUP);
    expect(src, 'the paused notice does not use the alert primitive')
      .toMatch(/import \{[^}]*Alert[^}]*\} from ['"]@\/components\/ui\/alert['"]/);
    expect(src, 'the paused notice hand-rolls its own role="alert"')
      .not.toMatch(/<div[^>]*role="alert"/);
  });

  it('🔴 the one hand-written control is NAMED, and is the section\'s own existing spelling', () => {
    /**
     * The substitute, stated rather than hidden: the Disconnect button in the
     * paused state is a bare `<button>`, not `ui/button`. It is spelled with the
     * SAME classes as the Disconnect the Gmail card already carried, which is
     * asserted here so the two cannot drift — and adopting `ui/button` for one
     * control would compose a single button out of a section whose other five
     * are hand-written, which is a visual pass this ticket has no business
     * making. `AdminCRM.tsx` is the same answer at larger scale: 2,234 lines
     * with zero `ui/` imports, and composing it is its own ticket.
     */
    const src = read(NEW_MARKUP);
    const spelling = 'border border-danger text-danger-strong rounded-brand text-sm font-medium hover:bg-danger-tint';
    expect(src.split(spelling).length - 1,
      'the paused Disconnect no longer matches the card Disconnect it was copied from')
      .toBeGreaterThanOrEqual(2);
    expect(src, 'the section started importing the button primitive for one control')
      .not.toMatch(/from ['"]@\/components\/ui\/button['"]/);
  });

  it('no colour is hardcoded and no emoji is rendered in the new markup', () => {
    const src = code(NEW_MARKUP);
    const paused = src.slice(src.indexOf('showGmailPaused &&'));
    expect(paused, 'the paused state paints a literal colour').not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(paused, 'the paused state paints an rgb literal').not.toMatch(/rgba?\(/);
    // The notice's own copy, which is what a church reads.
    expect(GMAIL_PAUSED_NOTICE, 'the notice carries an emoji')
      .not.toMatch(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}]/u);
    expect(GMAIL_HIDDEN_MESSAGE, 'the refusal carries an emoji')
      .not.toMatch(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}]/u);
  });

  it('both themes resolve the tokens the new markup paints from', () => {
    // 🔴 TWO, not four. THE-338 removed the Harvest palette FAMILY and promoted
    // its overrides into the two blocks below; a suite still asserting four
    // would be describing a build that no longer ships.
    const globals = read('src/app/globals.css');
    for (const block of [/(^|\n)\s*:root\s*\{/, /\[data-theme="dark"\]\s*\{/]) {
      expect(globals, `no block matching ${block}`).toMatch(block);
    }
    expect(globals, 'a palette family selector is back').not.toContain('data-palette');
    // The alert primitive paints from `bg-card` / `text-muted-foreground`, and
    // those are ALIASES rather than values — the indirection is named here so a
    // change to either half fails rather than being absorbed.
    expect(globals, '--card stopped aliasing the themed surface').toMatch(/--card:\s*var\(--surface-raised\)/);
    for (const token of ['--surface-raised', '--text-body', '--text-muted']) {
      expect(globals.split(`${token}:`).length - 1, `${token} is not redefined per theme`)
        .toBeGreaterThanOrEqual(2);
    }
  });

  it('🔴 no test this ticket added pins a line number', () => {
    // THE-331 pinned `AdminCommunity.tsx:491`; a deletion shifted it to `:311`
    // and the suite would have measured whatever landed there.
    // ⚠️ Over CODE, not prose. The comment above NAMES the defect by its old
    // coordinates, and a raw read would fail on the explanation while passing
    // on a real pin — the same inversion that let an import line satisfy a guard
    // elsewhere in this series.
    /**
     * ⚠️ EVERY PATTERN NEEDS A DIGIT OR AN OPERATOR AFTER IT, so none of them can
     * match its own spelling in this file — a bare `lineNumber` in the list did,
     * and a detector that has to be exempted from itself is one edit away from
     * being exempted from everything.
     */
    const PINS_A_LINE: ReadonlyArray<readonly [what: string, pattern: RegExp]> = [
      ['a file:line coordinate', /\.tsx?:\d+/],
      ['a lineNumber read', /\blineNumber\s*[:=.]/],
      ['a line: field', /\bline:\s*\d+/],
    ];
    for (const rel of THIS_TICKETS_SUITES) {
      const body = code(rel);
      for (const [what, pattern] of PINS_A_LINE) {
        expect(body, `${rel} pins ${what}`).not.toMatch(pattern);
      }
    }
  });

  it('🔴 no test this ticket added pins a fixture to a date near today', () => {
    // #468. Every date literal in this ticket's suites is years out, and the one
    // suite that uses dates freezes the clock with `toFake: ['Date']`.
    const soon = new Date();
    soon.setFullYear(soon.getFullYear() + 2);
    for (const rel of THIS_TICKETS_SUITES) {
      for (const literal of read(rel).match(/'\d{4}-\d{2}-\d{2}[^']*'/g) ?? []) {
        const when = new Date(literal.slice(1, -1));
        if (Number.isNaN(when.getTime())) continue;
        expect(when.getTime(), `${rel} pins ${literal}, which is not safely far out`)
          .toBeGreaterThan(soon.getTime());
      }
    }
    expect(read('src/__tests__/THE-339.rota-reaches-volunteer.test.ts'),
      'the dated suite stopped freezing the clock').toContain("toFake: ['Date']");
  });

  it('🔴 no guard this ticket added asserts anything about the current branch\'s diff', () => {
    // #454 is a standing sweep for this shape; asserted here too because it is
    // the shape that has taken `main` red for every unrelated PR three times.
    /**
     * ⚠️ CALL AND IMPORT SHAPES, over CODE. A list of bare words would match its
     * own spelling in this very array and fail on itself — and a detector that
     * has to be exempted from itself is one edit away from being exempted from
     * everything. Each pattern below needs a parenthesis or a quoted module
     * specifier, neither of which this file's own text carries.
     */
    const REACHES_FOR_GIT: ReadonlyArray<readonly [what: string, pattern: RegExp]> = [
      ['a child_process import', /from ['"](?:node:)?child_process['"]/],
      ['a child_process require', /require\(['"](?:node:)?child_process['"]\)/],
      ['an execFileSync call', /execFileSync\s*\(/],
      ['an execSync call', /execSync\s*\(/],
      ['a spawned git', /['"]git['"]\s*,\s*\[/],
    ];
    for (const rel of THIS_TICKETS_SUITES) {
      const body = code(rel);
      for (const [what, pattern] of REACHES_FOR_GIT) {
        expect(body, `${rel} contains ${what} — a guard about the branch's own diff`)
          .not.toMatch(pattern);
      }
    }
  });
});

/** This ticket's own suites, discovered by name rather than listed twice. */
const THIS_TICKETS_SUITES = [
  'src/__tests__/THE-339.gmail-hidden.test.ts',
  'src/__tests__/THE-339.gmail-routes.test.ts',
  'src/__tests__/THE-339.rota-reaches-volunteer.test.ts',
  'src/components/__tests__/THE-339.gmail-surfaces.test.tsx',
];

/** Every non-test source file under `src/`, repo-relative. */
function sourceFiles(): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) { if (e.name !== 'node_modules') walk(p); }
      else if (/\.tsx?$/.test(e.name)) out.push(path.relative(ROOT, p).split(path.sep).join('/'));
    }
  };
  walk(SRC);
  return out.filter((p) => !p.includes('__tests__'));
}

/** Every hand-written file under `functions/src`, repo-relative. */
function functionsFiles(): string[] {
  const dir = path.join(ROOT, 'functions/src');
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isFile() && /\.tsx?$/.test(e.name))
    .map((e) => `functions/src/${e.name}`);
}
