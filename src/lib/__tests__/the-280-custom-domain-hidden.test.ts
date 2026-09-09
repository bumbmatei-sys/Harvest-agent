import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextResponse } from 'next/server';
import { readFileSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { rulesDigestFailure } from '../../__tests__/__fixtures__/firestore-rules-pin';

/**
 * THE-280 — custom domains are hidden, and nothing was deleted to hide them.
 *
 * ─── Why this exists ─────────────────────────────────────────────────────────
 *
 * The feature has NEVER been tested, because the Vercel subscription that would
 * activate it was never bought. `/api/domains/provision` calls the Vercel
 * project-domains API with `VERCEL_API_TOKEN` + `VERCEL_PROJECT_ID`; with those
 * unset the route answers 501 and `DomainSection` silently falls back to writing
 * `config.customDomain` and a `domains/{domain}` row directly. That fallback
 * attaches NOTHING at the edge, so the DNS the church is then told to add points
 * at a domain no Vercel project serves: verification never completes and the
 * address never resolves. The platform was offering churches something that
 * cannot work.
 *
 * ─── The boundary this file exists to hold ───────────────────────────────────
 *
 * 🔴 CUSTOM DOMAINS AND SUBDOMAINS ARE DIFFERENT MECHANISMS, and every tenant is
 * served on `*.theharvest.app`. Breaking that would take the whole platform
 * down, so section 4 pins the subdomain path byte-for-byte.
 *
 * 🔴 AND RESOLUTION IS NOT THE SAME THING AS PROVISIONING. A church that ALREADY
 * set a domain keeps working precisely because the READ path — `server-tenant`'s
 * custom-domain fallback and `api/resolve-domain` — is not gated. Only the WRITE
 * path and the OFFER are. Section 5 pins that too.
 *
 * ⚠️ NO `git show` ANYWHERE. Digests are recorded as literals, so this suite
 * works identically on a shallow clone, a local checkout and a rebased branch —
 * the rule `posthog-untouched.test.ts` already sets, and the rule
 * `MemberScreens.desktop-layout.test.ts` breaks (it diffs against a revision a
 * depth-1 clone does not hold, and fails on checkout rather than on code).
 */

const ROOT = path.resolve(__dirname, '../../..');
const SRC = path.join(ROOT, 'src');
const read = (rel: string) => readFileSync(path.join(SRC, rel), 'utf8');
const exists = (rel: string) => { try { read(rel); return true; } catch { return false; } };
const digest = (rel: string) =>
  createHash('sha256').update(readFileSync(path.join(ROOT, rel))).digest('hex');

/** Comments carry example call syntax; strip them before counting real code. */
const stripComments = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

const HIDDEN_MESSAGE = 'Custom domains are temporarily unavailable.';

/* ═════════════════════════════════════════════════════════════════════════
   1 — the switch itself.
   ═════════════════════════════════════════════════════════════════════════ */
describe('1 — the switch is one value, in one place', () => {
  it('is a single exported boolean, currently false', async () => {
    const mod = await import('../custom-domain-feature');
    expect(mod.CUSTOM_DOMAIN_ENABLED).toBe(false);
    const src = read('lib/custom-domain-feature.ts');
    expect(src).toMatch(/^export const CUSTOM_DOMAIN_ENABLED = false;$/m);
    expect(src.match(/CUSTOM_DOMAIN_ENABLED\s*=/g)).toHaveLength(1);
  });

  it('the hidden message is a named const, and says only that it is temporary', async () => {
    const { CUSTOM_DOMAIN_HIDDEN_MESSAGE } = await import('../custom-domain-feature');
    expect(CUSTOM_DOMAIN_HIDDEN_MESSAGE).toBe(HIDDEN_MESSAGE);
    // No explanation of WHY — a church reading this does not need to be told
    // about an unbought subscription, and "coming soon" is the site's job.
    expect(CUSTOM_DOMAIN_HIDDEN_MESSAGE).not.toMatch(/vercel|subscription|untested|soon|billing/i);
  });

  it('imports nothing, so it stays cheap on the server and free in the bundle', () => {
    // The same purity rule `lib/sms-feature.ts` and `lib/stripe-connect-feature.ts`
    // keep, for the same two reasons: this module is read by a route handler AND
    // shipped to the browser inside `DomainSection`, and `utils/plan-features.ts`
    // — where the three older master switches live — drags the whole pricing
    // matrix in behind it.
    expect(read('lib/custom-domain-feature.ts'), 'custom-domain-feature.ts grew an import')
      .not.toMatch(/^\s*import\s/m);
  });

  it('every gated surface reads THAT constant, not a copy of it', () => {
    // A second boolean spelled the same way is how "one switch" quietly becomes
    // two. Every file below must IMPORT it.
    for (const rel of [
      'app/api/domains/provision/route.ts',
      'components/settings/DomainSection.tsx',
    ]) {
      const src = read(rel);
      expect(src, `${rel} does not read the custom-domain master switch`)
        .toMatch(/import \{[^}]*CUSTOM_DOMAIN_ENABLED[^}]*\} from ['"][^'"]*custom-domain-feature['"]/);
      expect(src, `${rel} declares its own CUSTOM_DOMAIN_ENABLED`)
        .not.toMatch(/(const|let|var)\s+CUSTOM_DOMAIN_ENABLED\s*=/);
    }
  });

  it('and both of them take the message from there too', () => {
    // A route and a component that word the refusal differently is the defect a
    // named const exists to prevent. Nothing may spell the sentence itself.
    for (const rel of [
      'app/api/domains/provision/route.ts',
      'components/settings/DomainSection.tsx',
    ]) {
      const code = stripComments(read(rel));
      expect(code, `${rel} spells the hidden message instead of importing it`)
        .not.toContain(HIDDEN_MESSAGE);
      expect(code, `${rel} does not use CUSTOM_DOMAIN_HIDDEN_MESSAGE`)
        .toContain('CUSTOM_DOMAIN_HIDDEN_MESSAGE');
    }
  });

  it('🔴 exactly four surfaces are gated — the write path, the offer, and the two claims', () => {
    // Stated as a sweep rather than a list, so a third gate appearing anywhere
    // in the tree fails here and has to be justified. In particular NO
    // subdomain file and NO resolution file may read this switch.
    const walk = (dir: string): string[] => {
      const out: string[] = [];
      for (const e of readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) { if (e.name !== 'node_modules') out.push(...walk(p)); }
        else if (/\.tsx?$/.test(e.name)) out.push(p);
      }
      return out;
    };
    const readers = walk(SRC)
      .filter((f) => !/__tests__/.test(f))
      .filter((f) => /CUSTOM_DOMAIN_ENABLED|custom-domain-feature/.test(readFileSync(f, 'utf8')))
      .map((f) => path.relative(SRC, f).split(path.sep).join('/'))
      .sort();
    expect(readers).toEqual([
      // The published plan catalogue — theharvest.site builds its pricing copy
      // from this, so a value left here is a claim the marketing site keeps
      // making on the app's authority.
      'app/api/plans/route.ts',
      // The write path.
      'app/api/domains/provision/route.ts',
      // The in-app upgrade cards — a line there is a promise on every upgrade
      // screen.
      'components/settings/PlanUpgradeSection.tsx',
      // The offer.
      'components/settings/DomainSection.tsx',
      'lib/custom-domain-feature.ts',
    ].sort());
  });
});

/* ═════════════════════════════════════════════════════════════════════════
   The gated route, off and on, against the SAME request.
   ═════════════════════════════════════════════════════════════════════════ */

/** Anything downstream of the gate throws, so "it refused first" is checkable. */
const explode = (what: string) => () => { throw new Error(`${what} was reached`); };

const post = (body = '{}') =>
  new Request('https://grace.theharvest.app/api/domains/provision', { method: 'POST', body }) as never;
const get = (url: string) => new Request(url, { method: 'GET' }) as never;

/** Everything a gated route could reach, armed to blow up if it is reached. */
function armRefusalMocks() {
  vi.doMock('@/lib/firebase-admin', () => ({
    adminDb: { collection: explode('Firestore'), batch: explode('Firestore') },
  }));
  vi.doMock('@/lib/api-auth', () => ({
    requireAdmin: explode('requireAdmin'),
    requireAuth: explode('requireAuth'),
    requireOwner: explode('requireOwner'),
    verifyAuth: explode('verifyAuth'),
  }));
  vi.doMock('@/lib/money-path-sentry', () => ({ captureHandledError: explode('Sentry') }));
  // 🔴 The Vercel API itself, armed. A gate that let the fetch through would
  // attach a domain to the shared project before refusing.
  vi.stubGlobal('fetch', explode('the Vercel API'));
}

/** Inert stand-ins, so the ON direction reaches the route's own first answer. */
function armPassthroughMocks(requireAdmin?: unknown) {
  vi.doMock('@/lib/custom-domain-feature', () => ({
    CUSTOM_DOMAIN_ENABLED: true,
    CUSTOM_DOMAIN_HIDDEN_MESSAGE: HIDDEN_MESSAGE,
  }));
  vi.doMock('@/lib/firebase-admin', () => ({
    adminDb: { collection: vi.fn(() => ({ doc: vi.fn(() => ({ get: vi.fn(async () => ({ exists: false })) })) })) },
  }));
  vi.doMock('@/lib/api-auth', () => ({
    requireAdmin: requireAdmin ?? vi.fn(async () => ({ tenantId: 'grace', isSuperAdmin: false })),
    requireAuth: vi.fn(),
    requireOwner: vi.fn(),
    verifyAuth: vi.fn(async () => null),
  }));
  vi.doMock('@/lib/money-path-sentry', () => ({ captureHandledError: vi.fn() }));
}

/* ─────────────────────────────────────────────────────────────────────────
   2 — OFF. 🔴 Server-side.
   ───────────────────────────────────────────────────────────────────────── */
describe('2 — api/domains/provision answers 503 with the hidden message', () => {
  beforeEach(() => { vi.resetModules(); });
  afterEach(() => {
    vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.resetModules();
    vi.doUnmock('@/lib/custom-domain-feature');
  });

  /**
   * ⚠️ THE REAL `lib/custom-domain-feature` IS USED HERE, unmocked. This section
   * takes the switch exactly as it ships and asks the only question that
   * matters: what does an admin pressing "Save Domain" actually get?
   */
  const expectHidden = async (res: Response) => {
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: HIDDEN_MESSAGE });
  };

  it('🔴 POST → 503 — the write path, with a realistic, fully-formed domain', async () => {
    armRefusalMocks();
    const { POST } = await import('@/app/api/domains/provision/route');
    await expectHidden(await POST(post(JSON.stringify({ domain: 'give.gracechapel.org' }))));
  });

  it('🔴 GET → 503 — "Check Status", which also WRITES', async () => {
    // Gated for its own sake, not for symmetry: this handler mirrors
    // customDomainVerified / customDomainStatus onto the tenant document.
    armRefusalMocks();
    const { GET } = await import('@/app/api/domains/provision/route');
    await expectHidden(await GET(get(
      'https://grace.theharvest.app/api/domains/provision?domain=give.gracechapel.org')));
  });

  it('🔴 refuses BEFORE authenticating, before Firestore and before Vercel', async () => {
    // Asserted by construction — every mock in `armRefusalMocks` throws, the
    // global fetch included — but stated as its own claim because it is the
    // reason no data moves and no domain is attached at the edge.
    armRefusalMocks();
    const { POST, GET } = await import('@/app/api/domains/provision/route');
    for (const res of [
      await POST(post(JSON.stringify({ domain: 'a.church.org' }))),
      await GET(get('https://grace.theharvest.app/api/domains/provision?domain=a.church.org')),
    ]) expect(res.status).toBe(503);
  });

  it('the gate is the FIRST statement in both handlers', () => {
    for (const fn of ['POST', 'GET']) {
      const body = stripComments(read('app/api/domains/provision/route.ts'))
        .split(new RegExp(`export async function ${fn}\\([^)]*\\)\\s*\\{`))[1];
      const firstStatement = body.split('\n').map((l) => l.trim()).filter(Boolean)[0];
      expect(firstStatement, `${fn} does something before it refuses`)
        .toBe('if (!CUSTOM_DOMAIN_ENABLED) {');
    }
  });

  it('a malformed body is refused the same way — the gate is before parsing', async () => {
    // The 400 "Invalid request body" branch is downstream of the gate, so even
    // a broken request gets the hidden message rather than a validation error
    // that would tell a caller the feature is live.
    armRefusalMocks();
    const { POST } = await import('@/app/api/domains/provision/route');
    const res = await POST(post('not json at all'));
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: HIDDEN_MESSAGE });
  });
});

/* ─────────────────────────────────────────────────────────────────────────
   3 — ON. 🔴 The gate is ADDITIVE.
   ───────────────────────────────────────────────────────────────────────── */
describe('3 — the route answers exactly as before when the switch is on', () => {
  beforeEach(() => { vi.resetModules(); });
  afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.resetModules(); });

  /**
   * 🔴 THE SAME REQUESTS AS SECTION 2. Each assertion below is the answer the
   * route gave to that request before this ticket existed, so a gate that had
   * changed anything downstream of itself would show up here. The DETAIL of the
   * route's behaviour — the plan gate, the ownership guard, normalizeDomain — is
   * pinned by its own suite, which passes unedited but for a
   * `CUSTOM_DOMAIN_ENABLED: true` mock.
   */

  it('POST → its own auth refusal, not 503', async () => {
    armPassthroughMocks(vi.fn(async () => NextResponse.json({ error: 'Unauthorized' }, { status: 401 })));
    const { POST } = await import('@/app/api/domains/provision/route');
    const res = await POST(post(JSON.stringify({ domain: 'give.gracechapel.org' })));
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: 'Unauthorized' });
  });

  it('GET → its own auth refusal, not 503', async () => {
    armPassthroughMocks(vi.fn(async () => NextResponse.json({ error: 'Unauthorized' }, { status: 401 })));
    const { GET } = await import('@/app/api/domains/provision/route');
    const res = await GET(get('https://grace.theharvest.app/api/domains/provision?domain=a.church.org'));
    expect(res.status).toBe(401);
  });

  it('🔴 POST → reaches the tenant lookup its plan gate performs, not 503', async () => {
    // Past the gate and answered by the route's OWN rules: an authenticated
    // admin whose tenant document does not exist gets the 404 that
    // `requireCustomDomainPlan` returns. Reaching that answer at all proves the
    // handler ran, opened Firestore and made its own decision.
    armPassthroughMocks();
    const { POST } = await import('@/app/api/domains/provision/route');
    const res = await POST(post(JSON.stringify({ domain: 'give.gracechapel.org' })));
    expect(res.status).not.toBe(503);
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'Tenant not found' });
  });

  it('🔴 and the whole of the route below the gate is byte-for-byte as it was', () => {
    // The route is a PURE INSERTION: an import line and one guard block per
    // handler, nothing removed, nothing edited. Stated here as the invariant a
    // reader can check by eye — every branch named below is still in the file.
    // Comments stripped first: this file explains its own history at length and
    // quotes `customDomain` while doing it.
    const src = stripComments(read('app/api/domains/provision/route.ts'));
    expect(src).toContain("hasFeature(plan, 'customDomain')");          // the plan gate
    expect(src).toContain('Custom domains require the Community plan or higher.');
    expect(src).toContain('This domain is already connected to another account.'); // ownership
    expect(src).toContain('This domain is already in use elsewhere and cannot be connected.');
    expect(src).toContain('domain_already_in_use');
    expect(src).toContain('Failed to add domain to Vercel');
    expect(src).toContain('Set VERCEL_API_TOKEN and VERCEL_PROJECT_ID.');  // the 501
    expect(src).toContain('v10/projects/');                                // POST attach
    expect(src).toContain('v9/projects/');                                 // GET status
    expect(src).toContain('user.isSuperAdmin');                            // the bypass
    expect(src).toContain("step: 'domain-provision'");                     // the Sentry hop
  });

  it('its own suite still runs, and pins the ON behaviour', () => {
    // The claim "nothing was deleted to hide it" expressed as a test: the suite
    // that pinned this route before this ticket is still here, still running,
    // with the switch mocked ON.
    expect(exists('app/api/domains/provision/__tests__/route.test.ts'),
      'the provisioning suite was deleted').toBe(true);
    expect(read('app/api/domains/provision/__tests__/route.test.ts'),
      'the provisioning suite no longer pins the switched-on behaviour')
      .toContain('CUSTOM_DOMAIN_ENABLED: true');
  });
});

/* ═════════════════════════════════════════════════════════════════════════
   4 — 🔴 the SUBDOMAIN path is untouched.
   ═════════════════════════════════════════════════════════════════════════ */
describe('4 — subdomain resolution is untouched', () => {
  /**
   * 🔴 THE TICKET'S LOUDEST STOP CONDITION. Every tenant is served on
   * `*.theharvest.app`; a custom domain is a different mechanism bolted beside
   * it. Gating a subdomain file would take the whole platform down, so the two
   * files that own that path are pinned byte-for-byte.
   *
   * ⚠️ ONE CORRECTION TO THE TICKET, pinned here rather than only in the pull
   * request: it lists `app/api/resolve-domain/route.ts` as part of "the
   * SUBDOMAIN path, not custom domains". IT IS THE OPPOSITE — its own docblock
   * says "Resolve a custom domain to a tenantId", and it looks up the `domains`
   * collection, which only ever holds custom domains. It is the custom-domain
   * READ path, and it is left byte-identical for the reason in section 5: a
   * church that already set a domain must keep resolving. Right answer, wrong
   * reason, so both are recorded.
   */
  it('the two subdomain modules are byte-for-byte unchanged', () => {
    expect(digest('src/lib/tenant-subdomain.ts'))
      .toBe('0966c4b3e6d7624e3b6ef475e01ce64e3ff227c4180331b1bbca95b26ed0800a');
    expect(digest('src/utils/non-tenant-subdomains.ts'))
      .toBe('d9b07f46dfaa41896ad732866b2b9e09cabfa6f4f02ddb6e4d30a5066d2295d9');
  });

  it('🔴 neither mentions the switch, and neither ever mentioned a custom domain', () => {
    for (const rel of ['lib/tenant-subdomain.ts', 'utils/non-tenant-subdomains.ts']) {
      expect(read(rel), `${rel} was gated`)
        .not.toMatch(/CUSTOM_DOMAIN_ENABLED|custom-domain-feature/);
      expect(read(rel), `${rel} reads a custom domain — the boundary is not where this claims`)
        .not.toMatch(/customDomain/);
    }
  });

  it('and they still do their job — a tenant slug still resolves', async () => {
    // With the switch at its shipped value, unmocked. If hiding custom domains
    // had reached this path, the platform's own address space would answer
    // differently here.
    const { isNonTenantSubdomain, isAffiliateHost, isHarvestHost, NON_TENANT_SUBDOMAINS } =
      await import('../../utils/non-tenant-subdomains');
    expect([...NON_TENANT_SUBDOMAINS].sort()).toEqual(['admin', 'affiliate', 'app', 'www']);
    expect(isNonTenantSubdomain('grace')).toBe(false);       // a real tenant
    expect(isNonTenantSubdomain('www')).toBe(true);
    expect(isAffiliateHost('affiliate.theharvest.app')).toBe(true);
    expect(isHarvestHost('grace.theharvest.app')).toBe(true);
    expect(isHarvestHost('theharvest.app')).toBe(true);
    // 🔴 A custom domain is deliberately NOT a Harvest host, and still is not.
    expect(isHarvestHost('gracechapel.org')).toBe(false);
  });

  it('🔴 the subdomain half of the domain panel is still rendered, ungated', () => {
    // The one file this ticket edits on the client still shows every church the
    // address it actually uses. The switch is read BELOW this, not around it.
    const src = read('components/settings/DomainSection.tsx');
    expect(src, 'the subdomain field was hidden along with the custom domain')
      .toContain('.theharvest.app');
    expect(src).toContain('Subdomain');
    expect(src).toContain('To change your subdomain, please contact support.');
    // And the subdomain read is in the parent, which is never unmounted.
    expect(src).toMatch(/const \[subdomain, setSubdomain\] = useState\(''\)/);
  });
});

/* ═════════════════════════════════════════════════════════════════════════
   5 — 🔴 resolution is untouched, so an already-provisioned domain still works.
   ═════════════════════════════════════════════════════════════════════════ */
describe('5 — an already-provisioned domain keeps resolving', () => {
  /**
   * 🔴 STOP CONDITION 6, answered. "Would gating provision break an
   * already-provisioned domain?" — NO, and this section is why.
   *
   * A live custom domain is served by three things, and this ticket touches
   * none of them: the domain attached to the Vercel project (edge, outside this
   * repo), the `domains/{domain}` lookup row and `config.customDomain` on the
   * tenant document (data, untouched — section 6), and the RESOLVERS below that
   * turn a host into a tenant. What the gate removes is the ability to CREATE or
   * RE-CHECK one. A verified domain stays verified in Firestore and keeps
   * resolving; what a church loses is the button, not its address.
   */
  it('both resolvers are byte-for-byte unchanged', () => {
    expect(digest('src/lib/server-tenant.ts'))
      .toBe('445344fb4038aa394495b0f4af67c321926ddd51b8523d9a7b7f12486a434b49');
    expect(digest('src/app/api/resolve-domain/route.ts'))
      .toBe('3e570a0e2a2c87887b1078f74cda7141e3857c2c535654af5ff88c725bc749f2');
  });

  it('🔴 neither is gated — a gate here would black out a live church site', () => {
    for (const rel of ['lib/server-tenant.ts', 'app/api/resolve-domain/route.ts']) {
      expect(read(rel), `${rel} was gated — an already-provisioned domain would stop resolving`)
        .not.toMatch(/CUSTOM_DOMAIN_ENABLED|custom-domain-feature/);
    }
  });

  it('and both still read the stored domain, which is what makes them the read path', () => {
    // Not vacuous: these two are the only places that turn a stored
    // `config.customDomain` / `domains/{domain}` row back into a tenant.
    expect(read('lib/server-tenant.ts')).toContain("where('config.customDomain', '==', hostname)");
    expect(read('app/api/resolve-domain/route.ts')).toContain('documents/domains/');
    // 🔴 And server-tenant holds BOTH paths in one function, which is exactly
    // why it could not be gated: the subdomain branch above the custom-domain
    // fallback serves every tenant on the platform.
    expect(read('lib/server-tenant.ts')).toContain("hostname.endsWith('.theharvest.app')");
    expect(read('lib/server-tenant.ts')).toContain('isNonTenantSubdomain(subdomain)');
  });

  it('🔴 server-tenant still resolves a custom domain to its tenant, with the switch off', async () => {
    // The read path exercised, not merely read: a church whose stored
    // `config.customDomain` is `gracechapel.org` still resolves to its tenant
    // while the switch is at its shipped value.
    vi.resetModules();
    const where = vi.fn(() => ({ limit: () => ({ get: async () => ({
      empty: false, docs: [{ id: 'grace', data: () => ({ name: 'Grace Chapel' }) }],
    }) }) }));
    vi.doMock('@/lib/firebase-admin', () => ({ adminDb: { collection: () => ({ where }) } }));
    const { getTenantFromHost } = await import('../server-tenant');
    expect(await getTenantFromHost('gracechapel.org')).toEqual({ id: 'grace', name: 'Grace Chapel' });
    expect(where).toHaveBeenCalledWith('config.customDomain', '==', 'gracechapel.org');
    vi.resetModules();
  });
});

/* ═════════════════════════════════════════════════════════════════════════
   6 — 🔴 no stored customDomain value is read or written.
   ═════════════════════════════════════════════════════════════════════════ */
describe('6 — no stored customDomain value is read or written', () => {
  beforeEach(() => { vi.resetModules(); });
  afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.resetModules(); });

  /**
   * Two halves, and both are needed.
   *
   *   · At RUNTIME, the gated route opens no collection at all — section 2's
   *     mocks throw on `adminDb.collection`, so every 503 there is already proof
   *     that nothing was read or written to produce it. The CLIENT half is
   *     proved in `the-280-custom-domain-hidden-surfaces.test.tsx`, which
   *     mounts the real panel and watches the tenant document never open.
   *   · In the SOURCE, the operations each edited file performs are counted and
   *     pinned. The numbers below were taken from the files as they shipped
   *     BEFORE this ticket and are identical after it — an added, removed or
   *     re-pointed query moves one of them.
   */
  const FIRESTORE_OPS: Readonly<Record<string, Readonly<Record<string, number>>>> = {
    // ⚠️ FIVE `adminDb.collection(` / `.doc(` AND THREE `.get(` / `.set(`,
    // verified identical on the revision before this ticket: the plan gate's
    // tenant read, the ownership read on `domains`, the two POST writes, and the
    // GET status mirror. The gate adds none of them — it returns before any.
    'app/api/domains/provision/route.ts': {
      'adminDb.collection(': 5, '.doc(': 5, '.get(': 3, '.set(': 3,
    },
    // ⚠️ FOUR `getDoc(` AND TWO `doc(db, 'tenants'` — unchanged by the split.
    // The parent reads the users document for the subdomain; the panel reads the
    // tenant document for the stored domain; `handleSave`'s Firestore fallback
    // re-reads both, exactly as it always did. Splitting the component moved
    // which function holds each call, never how many there are.
    'components/settings/DomainSection.tsx': {
      '.doc(': 0, 'getDoc(': 4, 'updateDoc(': 1, 'setDoc(': 1, 'deleteDoc(': 1,
    },
    // 🔴 The switch itself reads and writes nothing, which is why flipping it
    // can never need a migration.
    'lib/custom-domain-feature.ts': {},
  };

  /** Every operation any of these files could perform, so a NEW one is caught. */
  const VOCABULARY = [
    'adminDb.collection(', 'adminDb.batch(', 'batch.commit(', 'batch.set(', 'batch.update(',
    '.doc(', '.get(', '.set(', '.update(', '.add(', '.where(', '.limit(',
    'getDoc(', 'getDocs(', 'setDoc(', 'updateDoc(', 'addDoc(', 'deleteDoc(',
    'writeBatch(', 'recursiveDelete(',
  ];

  it.each(Object.keys(FIRESTORE_OPS))('%s performs exactly the operations it always did', (rel) => {
    const code = stripComments(read(rel));
    const found: Record<string, number> = {};
    for (const op of VOCABULARY) {
      const n = code.split(op).length - 1;
      if (n) found[op] = n;
    }
    const want = Object.fromEntries(
      Object.entries(FIRESTORE_OPS[rel]).filter(([, n]) => n > 0));
    expect(found, `${rel} changed which Firestore operations it performs`).toEqual(want);
  });

  it('🔴 nothing this ticket touches deletes or migrates a stored domain', () => {
    // A church that gets custom domains back must find its domain where it left
    // it: `config.customDomain`, its status, and its `domains/{domain}` row.
    // ⚠️ `deleteDoc` IS in DomainSection and always was — it is how a church
    // REMOVES its own domain, inside `handleSave`, behind the gate. What must
    // not exist is a sweep that removes one on the switch's behalf.
    for (const rel of Object.keys(FIRESTORE_OPS)) {
      const code = stripComments(read(rel));
      expect(code, `${rel} grew a bulk delete`)
        .not.toMatch(/bulkWriter|recursiveDelete|FieldValue\.delete/);
    }
    // And the one delete that exists is still the user-initiated removal.
    const panel = stripComments(read('components/settings/DomainSection.tsx'));
    expect(panel).toContain("deleteDoc(doc(db, 'domains', oldDomain))");
    expect(panel).toContain('if (oldDomain && oldDomain !== normalizedDomain)');
  });

  it('🔴 the fields a domain is stored under are still written, unchanged', () => {
    // The gate goes IN FRONT of these writes; it never edits them. That is what
    // makes "flip it back and every surface returns whole" true rather than a
    // hope — the same domain and status come back, not a re-derived guess.
    const route = stripComments(read('app/api/domains/provision/route.ts'));
    expect(route).toContain('customDomain: domain');
    expect(route).toContain('customDomainVerified: verified');
    expect(route).toContain("customDomainStatus: verified ? 'verified' : 'pending'");
    expect(route).toContain("adminDb.collection('domains').doc(domain).set({ tenantId })");
    const panel = stripComments(read('components/settings/DomainSection.tsx'));
    expect(panel).toContain("'config.customDomain': normalizedDomain || null");
    expect(panel).toContain("'config.customDomainStatus': normalizedDomain ? 'pending' : null");
    expect(panel).toContain("'config.customDomainVerified': normalizedDomain ? false : null");
  });

  it('🔴 the plan matrix keeps its customDomain column, at the same tier', async () => {
    // The gate sits IN FRONT of the matrix; it never edits it. The tier that
    // owns the capability still owns it, so flipping the switch restores the
    // same entitlement rather than a re-derived guess at it.
    const { getPlanFeatures } = await import('../../utils/plan-features');
    expect(getPlanFeatures('free').customDomain).toBe(false);
    expect(getPlanFeatures('plus').customDomain).toBe(false);
    expect(getPlanFeatures('pro').customDomain).toBe(false);
    expect(getPlanFeatures('max').customDomain).toBe(true);
  });

  it('leaves firestore.rules and functions/ byte-identical', () => {
    // firestore.rules auto-deploys to production on merge to main. The same two
    // digests THE-256 pinned — unchanged by this ticket, as they must be.
    expect(rulesDigestFailure(),
      'firestore.rules is at a digest no ticket recorded — it auto-deploys to production').toBeNull();
    expect(digest('functions/src/index.ts'))
      .toBe('39ccade96ac3d4dd5a13047e9bc42b54ef5ac59ae72f932af042fc814bf23e0b');
  });
});

/* ═════════════════════════════════════════════════════════════════════════
   7 — 🔴 hide, not delete.
   ═════════════════════════════════════════════════════════════════════════ */
describe('7 — hide, not delete', () => {
  it('every route file, component and lib is still on disk', () => {
    for (const rel of [
      'app/api/domains/provision/route.ts',
      'app/api/resolve-domain/route.ts',
      'components/settings/DomainSection.tsx',
      'components/AdminBranding.tsx',
      'components/FirstRunSetup.tsx',
      'lib/server-tenant.ts',
      'lib/tenant-subdomain.ts',
      'utils/non-tenant-subdomains.ts',
      'lib/custom-domain-feature.ts',
    ]) {
      expect(exists(rel), `${rel} was deleted`).toBe(true);
    }
  });

  it('the plan-flag guard still names both custom-domain gates', () => {
    // `plan-flag-surface-guard.test.ts` maps every plan cell to the surface that
    // refuses it. Both named surfaces must still consult `customDomain` — the
    // feature switch is in FRONT of the entitlement, not instead of it.
    for (const rel of ['components/settings/DomainSection.tsx', 'app/api/domains/provision/route.ts']) {
      expect(read(rel), `${rel} stopped consulting the customDomain plan cell`)
        .toMatch(/['"`.]customDomain\b/);
    }
  });
});

/* ═════════════════════════════════════════════════════════════════════════
   8 — 🔴 the app stops CLAIMING it, in the two places the app makes claims.
   ═════════════════════════════════════════════════════════════════════════ */
describe('8 — the app makes no custom-domain claim while the switch is off', () => {
  beforeEach(() => { vi.resetModules(); });
  afterEach(() => { vi.restoreAllMocks(); vi.resetModules(); vi.doUnmock('@/lib/custom-domain-feature'); });

  /**
   * 🔴 HIDING THE PANEL IS NOT ENOUGH, and these two are why. A church never
   * reaches the domain panel unless it is already on the top tier — but BOTH
   * surfaces below are read by churches that are not, and both of them SELL the
   * feature rather than offer it:
   *
   *   · `PlanUpgradeSection` is in-app MARKETING. "Custom Domain" on an upgrade
   *     card is a promise about what paying more buys, shown to every tier.
   *   · `/api/plans` is the catalogue theharvest.site builds its pricing copy
   *     from. A value published here is a claim the marketing site keeps making
   *     ON THE APP'S AUTHORITY — which is precisely the "app hides it while the
   *     site sells it" split this ticket calls a false claim.
   *
   * Both are the treatment THE-245 gave SMS, applied to the same two files.
   */

  it('🔴 OFF — the upgrade cards do not list Custom Domain', async () => {
    const src = read('components/settings/PlanUpgradeSection.tsx');
    // The line is WITHHELD by the switch, not deleted from the roster.
    expect(src, 'the Custom Domain card line was deleted rather than withheld')
      .toContain("{ key: 'customDomain', label: 'Custom Domain' }");
    expect(stripComments(src), 'the card list does not consult the switch')
      .toMatch(/CUSTOM_DOMAIN_ENABLED \|\| f\.key !== 'customDomain'/);
  });

  it('🔴 OFF — and Custom BRANDING keeps its line, because it ships', () => {
    // The overreach this ticket exists to avoid: `customBranding` and
    // `customDomain` are separate cells and only the second is off.
    const code = stripComments(read('components/settings/PlanUpgradeSection.tsx'));
    expect(code).toContain("{ key: 'customBranding', label: 'Custom Branding' }");
    expect(code, 'custom branding was withheld along with the domain')
      .not.toMatch(/f\.key !== 'customBranding'/);
  });

  it('🔴 OFF — /api/plans publishes no customDomain key at all', async () => {
    // ABSENT, not false. `false` would say "this tier does not include a custom
    // domain", a different and untrue claim; absent says the catalogue makes no
    // claim either way.
    vi.doMock('@/lib/firebase-admin', () => ({ adminDb: { collection: vi.fn() } }));
    const { GET } = await import('@/app/api/plans/route');
    const body = await (await GET()).json();
    expect(Array.isArray(body.plans), 'the plans catalogue changed shape').toBe(true);
    for (const plan of body.plans) {
      expect(Object.keys(plan.features), `${plan.id} still publishes customDomain`)
        .not.toContain('customDomain');
      // ⚠️ AND NOTHING ELSE LEFT WITH IT. `customBranding` was never published by
      // this endpoint (only `customDomain` was), so the check that the gate did
      // not overreach is that every OTHER key it did publish is still here.
      // 🔵 `newsletterAutomation` LEFT THIS LIST AT THE-335, which gave the
      // newsletter its own master switch and made `/api/plans` withhold the key
      // for exactly the reason stated above `customDomain`: ABSENT, not false.
      // The check that THIS gate did not overreach is unchanged — every other
      // key the endpoint publishes is still here.
      for (const kept of ['blog', 'newsFeed', 'aiChat', 'map']) {
        expect(Object.keys(plan.features), `${plan.id} stopped publishing ${kept}`)
          .toContain(kept);
      }
    }
  });

  it('🔴 ON — both come back, with the real per-tier values', async () => {
    // The gate is ADDITIVE: nothing was rewritten, so flipping the switch
    // republishes exactly what the matrix says rather than a re-derived guess.
    vi.doMock('@/lib/custom-domain-feature', () => ({
      CUSTOM_DOMAIN_ENABLED: true,
      CUSTOM_DOMAIN_HIDDEN_MESSAGE: 'Custom domains are temporarily unavailable.',
    }));
    vi.doMock('@/lib/firebase-admin', () => ({ adminDb: { collection: vi.fn() } }));
    const { GET } = await import('@/app/api/plans/route');
    const body = await (await GET()).json();
    const { getPlanFeatures } = await import('../../utils/plan-features');
    for (const plan of body.plans) {
      expect(plan.features.customDomain, `${plan.id} republished the wrong value`)
        .toBe(getPlanFeatures(plan.id).customDomain);
    }
    // And at least one tier really does own it, or the check above is vacuous.
    expect(body.plans.some((p: { features: Record<string, unknown> }) => p.features.customDomain === true))
      .toBe(true);
  });

  it('🔴 the plan matrix itself is untouched in both directions', async () => {
    // The cell keeps its value on the tier that owns it — the gate sits in
    // FRONT of the matrix and never edits it.
    const { getPlanFeatures } = await import('../../utils/plan-features');
    expect(getPlanFeatures('free').customDomain).toBe(false);
    expect(getPlanFeatures('plus').customDomain).toBe(false);
    expect(getPlanFeatures('pro').customDomain).toBe(false);
    expect(getPlanFeatures('max').customDomain).toBe(true);
    // And custom branding, the live sibling, is untouched too.
    expect(getPlanFeatures('max').customBranding).toBe(true);
  });
});
