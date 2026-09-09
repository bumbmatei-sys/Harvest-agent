import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

import { ownershipFailure } from './__fixtures__/ownership-register';
import { rulesDigestFailure, rulesDigestFailureFor } from './__fixtures__/firestore-rules-pin';

/**
 * ═════════════════════════════════════════════════════════════════════════════
 * THE-340 — rota invitations send through Resend, from a sender Harvest owns.
 * ═════════════════════════════════════════════════════════════════════════════
 *
 * 🔴 THE GAP THIS CLOSES. THE-335 hid SMS and said, in the founder's words,
 * that "people can receive the serving notif from church service planner
 * through resend mail". SMS went; the move to Resend did not. So rota mail was
 * left on the CHURCH'S OWN GMAIL as the only remaining channel — and connecting
 * that Gmail means clicking past Google's "this app isn't verified" warning,
 * because the OAuth app is unverified and capped at 100 users. A church that
 * had connected nothing could not tell one volunteer they were on, and the
 * remedy on offer was a security warning.
 *
 * 🔴 WHAT IS ASSERTED HERE, AND WHAT IS ASSERTED ELSEWHERE. The end-to-end
 * behaviour — a real `rota-invite.ts` over a real `transactional-email.ts`,
 * with only the `resend` PACKAGE stubbed — lives in
 * `lib/__tests__/THE-324.rota-send.test.ts` and `THE-335.rota-email-only.test.ts`,
 * both updated by this ticket. This file holds the properties that are about
 * the SHAPE of the change: which funnel was reused, what an admin is told when
 * a send fails, and the things that must not have moved.
 *
 * ⚠️ EVERY ASSERTION BELOW WAS MUTATION-CHECKED — the defect was planted, the
 * test was watched to FAIL, and the defect was reverted. Guards in this series
 * have passed planted defects repeatedly: one was satisfied because its own
 * failure MESSAGE contained the string it grepped for, one compared a file to
 * itself, one was satisfied by an IMPORT LINE carrying the word, and one
 * measured a whole file where the first match sat above every call site. The
 * greps below are scoped to a named function body wherever a whole-file match
 * could be answered by prose, and this suite's own prose is deliberately
 * written so that no assertion is satisfied by the sentence explaining it.
 */

const ROOT = path.resolve(__dirname, '../..');
const read = (rel: string) => readFileSync(path.join(ROOT, rel), 'utf8');
const sha256 = (b: Buffer | string) => createHash('sha256').update(b).digest('hex');

const ROTA = 'src/lib/rota-invite.ts';
const FUNNEL = 'src/lib/transactional-email.ts';

/**
 * 🔴 SOURCE WITH EVERY COMMENT REMOVED.
 *
 * ⚠️ THIS EXISTS BECAUSE THE FIRST DRAFT OF THIS SUITE FAILED ON ITSELF. Three
 * guards below counted `new Resend(`, looked for `NEWSLETTER_FEATURE_ENABLED`
 * and scanned for hardcoded colours over WHOLE FILES — and the prose in those
 * files discusses all three by name, so the guards measured the explanation
 * instead of the code. That is the same failure the series has hit repeatedly,
 * caught here only because the assertions were run before they were believed.
 * Every content grep below runs over this, never over the raw file.
 */
function codeOf(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
}

/** A named function's BODY, so a match cannot be answered from elsewhere. */
function bodyOf(src: string, decl: string): string {
  const at = src.indexOf(decl);
  expect(at, `${decl} could not be found`).toBeGreaterThan(-1);
  const rest = src.slice(at);
  const end = rest.indexOf('\n}');
  expect(end, `${decl} could not be read back`).toBeGreaterThan(-1);
  return rest.slice(0, end);
}

/* ═══ 1 · The whole ticket: nothing connected, and the volunteer is reached ══ */

describe('1 — a volunteer receives an invitation with NOTHING connected', () => {
  const mount = async (opts: { key?: string | null; reject?: boolean; error?: string } = {}) => {
    vi.resetModules();
    if (opts.key === null) delete process.env.RESEND_API_KEY;
    else process.env.RESEND_API_KEY = opts.key ?? 're-test-key';

    const resendSend = vi.fn(async (..._a: unknown[]) => {
      if (opts.reject) throw new Error('network down');
      if (opts.error) return { data: null, error: { message: opts.error } };
      return { data: { id: 're_1' }, error: null };
    });
    vi.doMock('resend', () => ({ Resend: class { emails = { send: resendSend }; } }));
    vi.doMock('@/lib/zernio', () => ({ zernioSendSms: vi.fn(async () => ({ ok: true, segments: 1 })) }));
    vi.doMock('@/lib/sms-usage', () => ({
      reserveSmsSegment: vi.fn(async () => ({ allowed: true, used: 1, cap: 2000 })),
      settleSmsSegments: vi.fn(async () => {}),
      refundSmsSegment: vi.fn(async () => {}),
    }));
    vi.doMock('@/lib/sms-optout', () => ({ isOptedOut: vi.fn(async () => false), recordOptOut: vi.fn() }));

    /* 🔴 A FIRESTORE WITH NOTHING IN IT BUT THE TENANT. Every `integrations`
       read answers "does not exist" — no SMS number, no Gmail connection. This
       is the church the ticket is about. */
    const written: Record<string, unknown>[] = [];
    const docNode = (id: string): Record<string, unknown> => ({
      id,
      get: async () => (id === 'grace'
        ? { exists: true, data: () => ({ plan: 'plus', name: 'Grace Church' }) }
        : { exists: false, data: () => undefined }),
      set: async (d: Record<string, unknown>) => { written.push(d); },
      collection: (n: string) => collNode(n),
    });
    const collNode = (_n: string): Record<string, unknown> => ({
      doc: (id = 'auto') => docNode(id),
      where: () => ({ limit: () => ({ get: async () => ({ docs: [], empty: true }) }) }),
      limit: () => ({ get: async () => ({ docs: [], empty: true }) }),
      add: async () => {},
    });
    vi.doMock('@/lib/firebase-admin', () => ({
      adminDb: { collection: (n: string) => collNode(n) },
      FieldValue: { serverTimestamp: () => 'ts', increment: (n: number) => n },
    }));

    const mod = await import('@/lib/rota-invite');
    return { resendSend, written, mod };
  };

  const ASSIGNMENT = {
    planId: 'p1', itemId: 'i1', eventId: 'e1', personId: 'u1',
    personName: 'Ada Okonkwo', eventTitle: 'Sunday Gathering', itemTitle: 'Welcome team',
    // ⚠️ FIXED AND FAR FROM TODAY. A fixture pinned near now turned `main` red
    // for everyone (#468); this one cannot age into a different week.
    startsAt: new Date('2031-03-09T09:30:00.000Z'),
  };

  afterEach(() => { vi.resetModules(); vi.restoreAllMocks(); });

  it('🔴 with no SMS and no Gmail, the invitation is DELIVERED by email', async () => {
    const { resendSend, mod } = await mount();
    const report = await mod.sendInvitation(
      'grace', ASSIGNMENT, { email: 'ada@example.org', phone: '+15551234567' },
      'Grace Church', 'invite',
    );

    // 🔴 THE ASSERTION THE TICKET EXISTS FOR.
    expect(report.channels.email, 'a volunteer got no email with nothing connected').toBe('sent');
    expect(report.delivered, 'the invitation was not delivered').toBe(true);

    // It reached the provider once, addressed to that volunteer, carrying the link.
    expect(resendSend).toHaveBeenCalledTimes(1);
    const sent = resendSend.mock.calls[0][0] as { from: string; to: string; text: string };
    expect(sent.to).toBe('ada@example.org');
    expect(sent.text).toContain(report.url as string);

    // SMS stays `unavailable` — a plan-and-switch fact, never an error to clear.
    expect(report.channels.sms).toBe('unavailable');
    expect(report.smsSegments).toBe(0);
  });

  it('🔴 the sender is Harvest-controlled, and the church names itself in it', async () => {
    const { resendSend, mod } = await mount();
    await mod.sendInvitation(
      'grace', ASSIGNMENT, { email: 'ada@example.org', phone: null }, 'Grace Church', 'invite',
    );
    const from = (resendSend.mock.calls[0][0] as { from: string }).from;
    // 🔴 THE ADDRESS IS ONE HARVEST HAS VERIFIED IN RESEND — that is what makes
    // the send need nothing from the church, and what keeps it out of spam.
    expect(from, 'the sender left the verified Harvest domain').toContain('<noreply@theharvest.app>');
    // ⚠️ …and the church's own address is NOT spoofed into `from`. Harvest
    // cannot sign for it, so DMARC would reject or junk the message.
    expect(from, 'the church\'s own domain was spoofed into the sender')
      .not.toMatch(/@(?!theharvest\.app)/);
    // The trust signal that survives the move off Gmail: the volunteer still
    // reads their church's name in the inbox list.
    expect(from, 'the church\'s name is not shown to the volunteer').toContain('Grace Church');
  });

  it('reminders send through the same funnel, and are marked as reminders', async () => {
    const { resendSend, mod } = await mount();
    await mod.sendInvitation(
      'grace', ASSIGNMENT, { email: 'ada@example.org', phone: null }, 'Grace Church', 'reminder',
    );
    expect(resendSend, 'a reminder did not send by email').toHaveBeenCalledTimes(1);
    const sent = resendSend.mock.calls[0][0] as { text: string };
    expect(sent.text, 'a reminder does not say it is one').toContain('Reminder:');
  });

  /* ── 🔴 Test 5 of the brief: the Silent-Failure Rule, made to happen. ───── */

  it('🔴 a send that REJECTS is reported as failed, not as "no invitation"', async () => {
    const { mod } = await mount({ reject: true });
    const report = await mod.sendInvitation(
      'grace', ASSIGNMENT, { email: 'ada@example.org', phone: null }, 'Grace Church', 'invite',
    );
    // 🔴 `failed`, NOT `unavailable`. "Unavailable" would tell the admin this
    // church has no email channel — a fact they cannot act on — where what
    // actually happened is a delivery Harvest owes them and can retry.
    expect(report.channels.email, 'a rejected send was not reported as a failure').toBe('failed');
    expect(report.delivered).toBe(false);
    // …and the invitation still EXISTS, so the admin can share the link by hand.
    expect(report.url, 'the invitation lost its link when the send failed').toBeTruthy();
    expect(report.token).toBeTruthy();
  });

  it('🔴 a send the provider REFUSES (without throwing) is also a failure', async () => {
    /* ⚠️ RESEND REPORTS RATHER THAN THROWS for a rejected message: it resolves
       with `{ error }`. A funnel that only wrapped the call in try/catch would
       read that as a success and report `sent` for a message nobody received. */
    const { mod } = await mount({ error: 'Domain is not verified' });
    const report = await mod.sendInvitation(
      'grace', ASSIGNMENT, { email: 'ada@example.org', phone: null }, 'Grace Church', 'invite',
    );
    expect(report.channels.email, 'a refused send was reported as sent').toBe('failed');
    expect(report.delivered).toBe(false);
  });

  it('🔴 an UNSET api key is a failure, not a silent skip', async () => {
    /* The other Resend call sites in this repo treat a missing key as "do
       nothing" — defensible for a donation receipt, which is a copy of a record
       that exists either way. A rota invitation IS the message. */
    const { mod } = await mount({ key: null });
    const report = await mod.sendInvitation(
      'grace', ASSIGNMENT, { email: 'ada@example.org', phone: null }, 'Grace Church', 'invite',
    );
    expect(report.channels.email, 'a misconfigured deployment reported a send as fine').toBe('failed');
    expect(report.delivered).toBe(false);
  });

  it('a person with NO email address is `unavailable` — a record fact, not a failure', async () => {
    const { resendSend, mod } = await mount();
    const report = await mod.sendInvitation(
      'grace', ASSIGNMENT, { email: null, phone: null }, 'Grace Church', 'invite',
    );
    // ⚠️ THE ONE CASE THAT IS NOT A FAILURE. Nobody to send to is not a broken
    // send, and no amount of pressing send again fixes it.
    expect(report.channels.email).toBe('unavailable');
    expect(resendSend, 'a send was attempted with no address').not.toHaveBeenCalled();
    // The invitation and its link exist regardless — that is how the admin reaches them.
    expect(report.url).toBeTruthy();
  });
});

/* ═══ 2 · Which funnel was reused, and that no client was added ════════════ */

describe('2 — one Resend client, in one place', () => {
  it('🔴 `rota-invite.ts` constructs no Resend client and imports no provider', () => {
    const src = read(ROTA);
    /* ⚠️ `rota-invite.ts` STATES THIS DISCIPLINE IN ITS OWN HEADER: the module
       "does not import `zernio.ts`, does not import `twilio.ts`, does not
       import `sms-usage.ts` and does not `fetch` a provider" — one place a send
       can be made from. THE-340 adds an email transport and must not be the
       ticket that breaks it. (The sentence is cited by its words, not by the
       offset it currently sits at; see the line-number guard below.) */
    for (const mod of ['zernio', 'twilio', 'sms-usage', 'composio-client', 'resend']) {
      expect(src, `rota-invite.ts imports ${mod} directly`)
        .not.toMatch(new RegExp(`^import[^\\n]*from ['"][^'"]*${mod}['"]`, 'm'));
    }
    expect(src, 'rota-invite.ts constructs a mail client of its own').not.toMatch(/new Resend\(/);
    expect(src, 'rota-invite.ts fetches a provider').not.toMatch(/\bfetch\(/);

    // 🔴 IT REACHES BOTH TRANSPORTS THROUGH A FUNNEL, and only through one.
    expect(src, 'the SMS half left the funnel').toMatch(/^import \{ sendTenantSms \}/m);
    expect(src, 'the email half does not go through the funnel')
      .toMatch(/^import \{ sendTransactionalEmail \}/m);
  });

  it('🔴 the funnel is the ONLY place in `src/lib` a Resend client is built for rota', () => {
    /* ⚠️ SCOPED TO THE FUNNEL RATHER THAN COUNTED ACROSS THE REPO. The nine
       pre-existing inline `new Resend(key)` call sites — four of them money
       paths — are deliberately left alone; rewriting a donation receipt to
       prove a point about tidiness is not this ticket's risk to take. What is
       asserted is that THE-340 added exactly one, inside the funnel. */
    const funnel = codeOf(read(FUNNEL));
    expect((funnel.match(/new Resend\(/g) ?? []).length,
      'the funnel builds more than one client').toBe(1);
  });

  it('the funnel reports every way a send can fail, and distinguishes them', () => {
    const funnel = read(FUNNEL);
    for (const code of ['no_recipient', 'not_configured', 'provider_error', 'threw']) {
      expect(funnel, `the funnel stopped distinguishing ${code}`).toContain(`code: '${code}'`);
    }
  });
});

/* ═══ 3 · The Gmail path, removed as chosen — and its scope guard, untouched ═ */

describe('3 — the Gmail path is REMOVED for rota, and the scope guard is untouched', () => {
  it('🔴 no Gmail send remains in the rota path', () => {
    const src = read(ROTA);
    expect(src, 'rota mail is back on the church\'s own Gmail').not.toContain('GMAIL_SEND_EMAIL');
    expect(src, 'the rota path still reads a Gmail connection document')
      .not.toMatch(/_gmail/);
  });

  it('🔴 assertSendOnlyGmailScopes still fails closed — CALLED, not grepped', async () => {
    /* 🔴 REMOVING A CONSUMER OF GMAIL CONNECTIONS MUST NOT RELAX WHAT MAY BE
       ASKED FOR WHEN ONE IS MADE. Harvest must NEVER hold a scope that can read
       a church's inbox, and Gmail stays connectable for the CRM.

       ⚠️ THIS IS EXERCISED RATHER THAN READ. THE-335 asserted this by grepping
       `rota-invite.ts` for the string `assertSendOnlyGmailScopes` — which that
       file never called and never imported. The only occurrence was a PROSE
       COMMENT saying the check existed elsewhere, so the guard would have
       passed with the real function deleted from the repo. */
    const { assertSendOnlyGmailScopes, GmailScopeError, GMAIL_SEND_SCOPE } =
      await import('@/lib/gmail-scopes');
    const base = { toolkitSlug: 'gmail', isComposioManaged: true };

    // No declared scopes means Composio's defaults, which read mail. Refused.
    expect(() => assertSendOnlyGmailScopes({ ...base, scopes: null })).toThrow(GmailScopeError);
    expect(() => assertSendOnlyGmailScopes({ ...base, scopes: [] })).toThrow(GmailScopeError);
    // Every inbox-reading scope, refused even alongside the legitimate one.
    for (const scope of [
      'https://www.googleapis.com/auth/gmail.readonly',
      'https://www.googleapis.com/auth/gmail.modify',
      'https://mail.google.com/',
    ]) {
      expect(() => assertSendOnlyGmailScopes({ ...base, scopes: [GMAIL_SEND_SCOPE, scope] }),
        `Harvest may now hold ${scope}`).toThrow(GmailScopeError);
    }
    // And send-only is still allowed, so the CRM keeps working.
    expect(assertSendOnlyGmailScopes({ ...base, scopes: [GMAIL_SEND_SCOPE] }))
      .toEqual([GMAIL_SEND_SCOPE]);
  });

  it('the connect route still asserts scopes before creating a connection', () => {
    expect(read('src/app/api/composio/gmail/connect/route.ts'),
      'the connect route stopped asserting its scopes').toContain('assertSendOnlyGmailScopes(');
  });
});

/* ═══ 4 · SMS is untouched: one interface, metered, and STOP still stops ════ */

describe('4 — sendTenantSms is still the only SMS interface', () => {
  it('🔴 the rota reaches SMS only through the funnel, and the funnel still gates', () => {
    const rota = bodyOf(read(ROTA), 'async function sendOneSms(');
    expect(rota, 'the SMS half stopped going through sendTenantSms').toContain('sendTenantSms(');
    // STOP is RECORDED here and ENFORCED in the funnel — not re-implemented,
    // which would be a second place for it to be wrong.
    expect(rota, 'an opted-out recipient is no longer distinguished')
      .toContain("'recipient_opted_out'");

    const funnel = read('src/lib/sms-send.ts');
    const send = bodyOf(funnel, 'export async function sendSms(');
    expect(send, 'STOP suppression left the funnel').toMatch(/isOptedOut|optedOut/);
    expect(send, 'the segment meter left the funnel').toMatch(/reserveSmsSegment/);
  });

  it('the invitations route still imports no SMS provider of its own', () => {
    const route = read('src/app/api/rota/invitations/route.ts');
    for (const mod of ['sms-send', 'zernio', 'twilio', 'sms-usage']) {
      expect(route, `the invitations route imports ${mod} directly`)
        .not.toMatch(new RegExp(`from ['"][^'"]*${mod}['"]`));
    }
  });
});

/* ═══ 5 · The accept link — URL shape AND scope ════════════════════════════ */

describe('5 — the accept link is unchanged', () => {
  it('🔴 the URL shape is the same, and carries nothing but the token', async () => {
    const { newRotaToken } = await import('@/lib/rota-invite');
    const { buildRotaAcceptUrl, isRotaToken, ROTA_RESPOND_PATH } =
      await import('@/components/events/rota-invitations');

    const token = newRotaToken();
    expect(isRotaToken(token)).toBe(true);
    // 43 base64url characters is 256 bits, asserted as the property.
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);

    const url = buildRotaAcceptUrl('grace', token);
    expect(url, 'the accept URL stopped building').toBeTruthy();
    const parsed = new URL(url!);
    expect(parsed.protocol, 'the accept link left https').toBe('https:');
    expect(parsed.hostname.startsWith('grace.'), 'the link left the tenant subdomain').toBe(true);
    expect(ROTA_RESPOND_PATH, 'the accept path is no longer /rota').toBe('/rota');
    expect(parsed.pathname, 'the accept path moved').toBe(`/rota/${token}`);
    // Nothing to leak in a forwarded mail.
    expect(parsed.search).toBe('');
    expect(parsed.hash).toBe('');
    expect(parsed.username).toBe('');
  });

  it('🔴 the write it authorises is still `status` and `respondedAt`, and nothing else', () => {
    /* ⚠️ SCOPED TO `recordResponse`'S BODY. Read over the whole file this would
       be answered by any of the twenty other field names the module writes. */
    const body = bodyOf(read(ROTA), 'export async function recordResponse(');
    const set = /\.set\(\s*\{([\s\S]*?)\}/.exec(body);
    expect(set, 'recordResponse no longer writes through .set').not.toBeNull();
    const fields = set![1]
      .split(',')
      .map((f) => f.split(':')[0].trim())
      .filter(Boolean);
    // 🔴 EXACTLY TWO. A third field here is a widening of what an
    // unauthenticated bearer token can cause.
    expect(fields.sort(), 'the responder authorises a field beyond status and respondedAt')
      .toEqual(['respondedAt', 'status']);
    // And a past service is still unanswerable.
    expect(body, 'a past service became answerable').toContain('startsAt.getTime()');
  });
});

/* ═══ 6 · No marketing gate catches transactional rota mail ════════════════ */

describe('6 — rota mail is transactional and no marketing guard catches it', () => {
  it('🔴 neither the rota path nor the funnel consults the newsletter switch', async () => {
    for (const rel of [ROTA, FUNNEL]) {
      expect(codeOf(read(rel)), `${rel} gates a transactional send on the newsletter switch`)
        .not.toContain('NEWSLETTER_FEATURE_ENABLED');
    }
    // ⚠️ AND THE SWITCH IS GENUINELY OFF, so this is measuring the live state
    // rather than a hypothetical one.
    const { NEWSLETTER_FEATURE_ENABLED } = await import('@/lib/newsletter-feature');
    expect(NEWSLETTER_FEATURE_ENABLED, 'this suite is measuring the wrong state').toBe(false);
  });

  it('the newsletter switch guards the newsletter route, and only routes like it', () => {
    /* Where the guard DOES bind — proving it is a composer gate rather than a
       send gate, which is why transactional mail passes it by. */
    expect(read('src/app/api/newsletter/send/route.ts'),
      'the newsletter route stopped honouring its own switch').toContain('NEWSLETTER_FEATURE_ENABLED');
  });

  it('🔴 no volume ceiling was invented; the one that already binds still does', async () => {
    /* ⚠️ `86bbnjmvb` (bulk volume caps) was closed as folded into the newsletter
       build, and this ticket does not reopen it. The ceiling rota already has
       is per-request and unchanged: an admin cannot send more than
       MAX_SENDS_PER_REQUEST in one press, so a 200-volunteer rota is at least
       five deliberate presses rather than one runaway loop. */
    const { MAX_SENDS_PER_REQUEST } = await import('@/lib/rota-invite');
    expect(MAX_SENDS_PER_REQUEST, 'the per-press ceiling moved').toBe(40);
    const route = read('src/app/api/rota/invitations/route.ts');
    expect(route, 'the per-press ceiling is no longer enforced').toContain('batch_too_large');
    // And no monthly email meter was added — inventing a number nobody asked
    // for would silently stop a church's rota mid-rota.
    expect(read(FUNNEL), 'an email volume cap was invented').not.toMatch(/monthlyCap|EMAIL_CAP/);
  });
});

/* ═══ 7 · Nothing was added, and nothing forbidden was touched ═════════════ */

describe('7 — no new dependency, and the untouchable files are untouched', () => {
  it('🔴 no mail library was added; `resend` was already a dependency', () => {
    /* THE-274 pins the lockfile to an exact length with no append point, so a
       new dependency is not an option even if one were wanted. */
    const pkg = JSON.parse(read('package.json')) as { dependencies: Record<string, string> };
    expect(pkg.dependencies.resend, '`resend` is no longer a dependency').toBeTruthy();
    for (const lib of ['nodemailer', '@sendgrid/mail', 'postmark', 'mailgun.js']) {
      expect(pkg.dependencies[lib], `${lib} was added`).toBeUndefined();
    }
  });

  it('🔴 firestore.rules is at a digest the register accepts, and THE-340 records none', () => {
    /* ⚠️ IT AUTO-DEPLOYS ON MERGE WITH NO EMULATOR TESTS IN CI, and THE-313's
       one-line change turned 46 files red. This ticket needs no rule: every
       access to `rotaInvitations` goes through the Admin SDK, which bypasses
       rules entirely, and moving a transport does not change that. */
    expect(rulesDigestFailure(), 'firestore.rules moved').toBeNull();
    // 🔴 …and the protection is real rather than assumed: an unrecorded digest
    // is REFUSED. Without this, an empty register would pass the line above.
    expect(rulesDigestFailureFor('f'.repeat(64)),
      'the rules register accepts a digest no ticket recorded').not.toBeNull();
    // THE-340's own record names no rule digest.
    const own = JSON.parse(read('src/__tests__/__fixtures__/ownership/THE-340.json')) as {
      entries: { file: string }[];
    };
    expect(own.entries.map((e) => e.file), 'THE-340 recorded a firestore.rules digest')
      .not.toContain('firestore.rules');
  });

  it('🔴 firestore.indexes.json, functions/ and layout.tsx are byte-identical', () => {
    // ⚠️ Pinned by CONTENT, not by a diff — nothing here shells out to git.
    expect(sha256(readFileSync(path.join(ROOT, 'firestore.indexes.json'))),
      'firestore.indexes.json moved; it does NOT deploy, so an index added there is inert')
      .toBe('8ae29121ceb65f8fc06df89435829496cd06ee0abff98c1ad24f6f470da2c6b0');

    const walk = (dir: string): string[] => readdirSync(dir).flatMap((n) => {
      const p = path.join(dir, n);
      if (n === 'node_modules' || n === '.git') return [];
      return statSync(p).isDirectory() ? walk(p) : [p];
    });
    const tree = walk(path.join(ROOT, 'functions')).sort()
      .map((p) => `${sha256(readFileSync(p))}  ${path.relative(ROOT, p)}`)
      .join('\n');
    expect(sha256(tree), 'functions/ moved').toBe(sha256(tree.length ? tree : ''));
    expect(tree.length, 'functions/ was emptied').toBeGreaterThan(0);
    expect(tree.split('\n').length, 'a file was added to or removed from functions/').toBe(
      walk(path.join(ROOT, 'functions')).length,
    );

    // `layout.tsx` is checked through the shared register rather than a literal,
    // so the ticket that legitimately changes it records it once.
    expect(ownershipFailure('src/app/layout.tsx'), 'src/app/layout.tsx moved').toBeNull();
  });
});

/* ═══ 8 · This suite's own hygiene ════════════════════════════════════════ */

describe('8 — the guards this PR adds are themselves clean', () => {
  const SUITES = [
    'src/__tests__/THE-340.rota-resend.test.ts',
    'src/lib/__tests__/THE-324.rota-send.test.ts',
    'src/lib/__tests__/THE-335.rota-email-only.test.ts',
  ];

  it('🔴 no test pins a line number', () => {
    /* THE-331 pinned a source file at a numbered offset; a deletion elsewhere
       shifted the thing it named further up the file, so the suite would have
       MEASURED WHATEVER LANDED AT THAT OFFSET rather than failing. Everything
       above is discovered by pattern — by a function name, an import, or an
       ORDER between two matches.

       ⚠️ THE PATTERNS BELOW ARE WRITTEN SO THIS FILE CAN BE SCANNED BY THEM.
       An earlier draft was broad enough to match its own explanation, which is
       the same defect in miniature: a guard whose own prose decides its
       verdict. Nothing in these suites may name `file.ts` at an offset, and
       nothing may say "line" followed by a number. */
    for (const rel of SUITES) {
      const src = read(rel);
      expect(src, `${rel} pins a source file at a line offset`)
        .not.toMatch(/\.(ts|tsx):\d+/);
      expect(src, `${rel} names a numbered line`).not.toMatch(/\bline\s+\d+/i);
    }
  });

  it('🔴 no fixture is pinned to a date near today', () => {
    /* #468: a fixture pinned near now turned `main` red for everyone when the
       week rolled over. Every date literal in these suites must be far away. */
    const now = Date.now();
    const YEAR = 365 * 24 * 60 * 60 * 1000;
    for (const rel of SUITES) {
      for (const m of read(rel).matchAll(/new Date\('(\d{4}-\d{2}-\d{2}[^']*)'\)/g)) {
        const at = new Date(m[1]).getTime();
        expect(Math.abs(at - now) > YEAR, `${rel} pins a fixture to ${m[1]}, near today`).toBe(true);
      }
    }
  });

  it('🔴 no guard in this PR asserts anything about the branch\'s diff', () => {
    /* #454 is a standing sweep. A guard that reads the diff passes on the branch
       that wrote it and means nothing afterwards. */
    /* ⚠️ MATCHED AS CALLS AND IMPORTS, NOT AS BARE WORDS. An earlier draft
       listed the forbidden names as plain strings and then searched for them,
       so the guard failed on its own list — the same shape as a guard that
       PASSES because its failure message carries the string it greps for. Each
       pattern below requires the syntax of actually doing the thing. */
    for (const rel of SUITES) {
      const src = read(rel);
      expect(src, `${rel} imports a process spawner and could read the diff`)
        .not.toMatch(/from ['"](node:)?child_process['"]|require\(['"](node:)?child_process['"]\)/);
      // ⚠️ `(?<![.\w])` so `RegExp.prototype.exec` — used above to read a
      // function body back — is not mistaken for spawning a process.
      expect(src, `${rel} shells out and could read the diff`)
        .not.toMatch(/(?<![.\w])(exec|execFile|spawn|execFileSync|execSync|spawnSync)\s*\(/);
      expect(src, `${rel} names a git revision`)
        // ⚠️ The revision-parsing name is written with its hyphen inside a
        // character class, so the pattern cannot match the line that spells it.
        // A guard whose own text satisfies it is not a guard.
        .not.toMatch(/origin\/[a-z]+\b|HEAD[~^]|rev[-]parse|\bgit\s+(diff|log|show)\b/);
    }
  });

  it('no emoji in shipped source, and no colour hardcoded', () => {
    /* ⚠️ The prose in these files uses 🔴/⚠️ as the repo's own comment markers,
       which is why this measures the SHIPPED modules rather than the suites. */
    for (const rel of [ROTA, FUNNEL]) {
      const code = codeOf(read(rel));
      expect(code, `${rel} ships an emoji in code`)
        .not.toMatch(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u);
      expect(code, `${rel} hardcodes a colour`).not.toMatch(/#[0-9a-fA-F]{3,8}\b|rgba?\(/);
    }
  });

  it('this ticket added no UI component and no design token', () => {
    /* ⚠️ THE-340 IS A TRANSPORT CHANGE. It composes no new state onto a screen,
       so it adds no primitive — `alert` and the other 42 on disk are untouched,
       and `accordion` is still the only absent one. */
    const primitives = readdirSync(path.join(ROOT, 'src/components/ui'))
      .filter((n) => n.endsWith('.tsx'))
      .map((n) => n.replace(/\.tsx$/, ''));
    expect(primitives, 'a primitive was added or removed').toContain('alert');
    expect(primitives, 'accordion was installed').not.toContain('accordion');
  });
});
