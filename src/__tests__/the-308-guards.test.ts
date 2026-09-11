/**
 * THE-308 — the fence around the events month view.
 *
 * What this ticket must NOT have done, asserted by reading the source and the
 * repository. The behaviour lives in
 * `src/components/events/__tests__/THE-308.month-view.test.tsx` and the measured
 * claims in `src/components/__tests__/THE-308.month-view.layout.test.tsx`.
 *
 * ⚠️ NOTHING HERE ASKS WHAT THE CURRENT BRANCH CHANGED, and nothing shells out
 * — same reason THE-317 gives: a guard that asserts its own diff is true only
 * while its ticket is unmerged, and turns the NEXT PR red for a reason that has
 * nothing to do with it.
 *
 * ═════════════════════════════════════════════════════════════════════════════
 * 🔴 THE ONE THING THIS TICKET DID NOT DO: run the registry CLI.
 *
 * The block it was written around — `calendar-application-01` from shadcnspace
 * — IS NOT REACHABLE. It answers 403 with
 * `{"error":"License required","message":"Please provide your email and license
 * key."}`, served by the origin itself (`x-matched-path: /r/[...item]`), not by
 * a proxy. It is a paywall, not the network verdict the ticket predicted, and
 * no license exists. `kanban-application-01` and `calendar-01` on the same host
 * return 200, so the registry is up and the gate is per item.
 *
 * ✅ So the month view is COMPOSED from primitives already installed and
 * already reviewed, which is what every other ticket in this series does. That
 * removes the risk the ticket devoted its largest section to outright: the CLI
 * never ran, so it cannot have overwritten any of the 18 primitives the block
 * depended on. Section 3 proves that by digest anyway — an absent risk that is
 * asserted is worth more than one that is merely argued.
 * ═════════════════════════════════════════════════════════════════════════════
 */
import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

const REPO_ROOT = path.resolve(__dirname, '../..');
const read = (rel: string): string => readFileSync(path.join(REPO_ROOT, rel), 'utf8');
const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

/** Source with block and line comments stripped — the code, not the prose. */
const codeOf = (rel: string): string =>
  read(rel).replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

/** The three files this ticket adds. */
const ADDED = [
  'src/components/events/month-view.ts',
  'src/components/events/EventMonthView.tsx',
  'src/hooks/queries/useMonthEvents.ts',
] as const;

/** The one screen it edits. */
const EDITED = 'src/components/AdminEvents.tsx';

/* ═══ 3 · 🔴 all 18 pre-existing primitives are byte-identical ══════════════ */

describe('3 · the 18 primitives the block depended on are untouched', () => {
  /**
   * 🔴 LITERALS, not the fixture. `primitive-digests.json` is re-recorded by
   * any ticket that legitimately edits a primitive, so a test that compared
   * against it would agree with whatever the fixture currently says — including
   * a fixture this PR had regenerated. These are the bytes on `main` at
   * 7a7b399, written down here, and they are what "unchanged" means.
   */
  const PINNED: Record<string, string> = {
    'card.tsx': 'd8113cbf964f8d1aadf2649d2944d8bbc6e3cfd49d36746f76868cbc4dde3cfe',
    'button.tsx': 'd14549ab3ba7a9d5d1f424c2599233bffa0b317121abf3b6efa2fb902d5e2781',
    'button-group.tsx': 'fe97631e1a07bc0add09503c5032002e37f4c71ef5dd3c7475b856a29848583d',
    'input.tsx': 'f7d6ecff9a4d631feeaf401c02bb87e26ddb38131c55d15a43b9290747390847',
    'badge.tsx': '968b0403af74a785c9408ca69a677235e49d0c80b2c27fb9858ad421a8778c7d',
    'tabs.tsx': '096e3d4b2a99b1eff95d16959f97daaa1747fdb7de6226d6c54b9693e22b3410',
    'dropdown-menu.tsx': '1c1ae4ec02de9778286f84e0d15a1b74cc610c13c5b6a13c1ada2e6770eeb4e1',
    'popover.tsx': '67aa5f28d07c6b149d9d30d173af78d6640f9bca18138bfb16b98e66973974b9',
    'dialog.tsx': 'bfd230cea544d2de7650182341e082de92141174da80f6193843e8d71b622e41',
    'select.tsx': 'ca3bd1b370ea67b84632d435c22d8270752fa6013c06c365162af265e4a0e87e',
    'switch.tsx': 'cabbf7804a4d6768ef62f5c2256fbf39e214372318bb1b3b22d407f808c56249',
    'calendar.tsx': '0ea3d4bd2cf7b8edef5bd5a724518d94d609b15f2f4f42e489c63f532706e55c',
    'textarea.tsx': '58b58d84fc54ba5f4ca46937870c619349fd9eccc4d494250ac7bc73a94e05e9',
    'label.tsx': '7f19b8476658d25ff197c84030e58cd7395059d876a54630e025951e474ebdae',
    'empty.tsx': 'e65ee3ba54a21ed61e3c50041bb12a6a3fcb215c56611cda6795c23a7bd89f61',
    'skeleton.tsx': '8110bba70d0cb9fe968c0b7bd092ad12258caef40b028b4a87f402bdab907faf',
    'scroll-area.tsx': '42de3962daca60255bf1d3cd90bd3c038db73a3ed61ecaac6cffc6a153181e4a',
    'tooltip.tsx': '2cea2294d4947b88d815860f64e0b5e0eb47a59bde47cfd194aac2230c923865',
  };

  it('🔴 every one of the 18 is byte-identical', () => {
    const actual = Object.fromEntries(
      Object.keys(PINNED).map((f) => [f, sha256(read(`src/components/ui/${f}`))]),
    );
    expect(actual).toEqual(PINNED);
  });

  it('and there are exactly 18 of them — the block\'s whole registry dependency set', () => {
    expect(Object.keys(PINNED)).toHaveLength(18);
  });

  it('and the literals agree with the recorded fixture, which this PR did not regenerate', () => {
    // Two independent records of the same bytes. If a future ticket re-records
    // the fixture for a real reason, this line is where the two part company
    // and the reader is told which one moved.
    const fixture: Record<string, string> = JSON.parse(
      read('src/components/ui/__tests__/__fixtures__/primitive-digests.json'),
    );
    for (const [file, digest] of Object.entries(PINNED)) {
      const key = Object.keys(fixture).find((k) => k.endsWith(file.replace('.tsx', '')) || k.endsWith(file));
      expect(key, `${file} is not in the recorded fixture`).toBeTruthy();
      expect(fixture[key!], `${file} disagrees with the fixture`).toBe(digest);
    }
  });

  it('🔴 and NO file under src/components/ui was added, removed or renamed', () => {
    // An overwrite is not the only way the CLI damages a reviewed tree: it also
    // ADDS. 43 primitives + the __tests__ directory is what `main` carries.
    const entries = readdirSync(path.join(REPO_ROOT, 'src/components/ui')).sort();
    expect(entries.filter((e) => e.endsWith('.tsx'))).toHaveLength(43);
    expect(entries).toContain('__tests__');
  });
});

/* ═══ 4 · no new token ═════════════════════════════════════════════════════ */

describe('4 · this ticket defines no token', () => {
  it('🔴 the token ledger is unchanged — no added file writes to globals.css', () => {
    // The bridge has held with zero additions through #410, #416, #417, #419
    // and #466. The ledger fixture IS the record, and this ticket did not
    // re-record it: `globals-tokens.txt` still ends where THE-267 left it.
    const ledger = read('src/components/ui/__tests__/__fixtures__/globals-tokens.txt');
    const globals = read('src/app/globals.css');
    for (const token of ledger.trim().split('\n').filter(Boolean)) {
      expect(globals, `${token} left globals.css`).toContain(token);
    }
    // Every custom property globals.css defines is already in the ledger.
    const defined = new Set(
      [...globals.matchAll(/^\s*(--[a-z][\w-]*)\s*:/gm)].map((m) => m[1]),
    );
    const recorded = new Set(ledger.trim().split('\n').filter(Boolean));
    expect([...defined].filter((t) => !recorded.has(t)), 'a token is defined but unrecorded')
      .toEqual([]);
  });

  /**
   * 🔴 THE ONE CUSTOM PROPERTY THIS TICKET WRITES, AND WHY IT IS NOT A TOKEN.
   *
   * `EventMonthView` sets `[--cell-size:44px] sm:[--cell-size:38px]`.
   * `--cell-size` is not a new name: it is `calendar`'s OWN variable, declared
   * by the primitive at `[--cell-size:--spacing(7)]` and read by its day
   * buttons and its month nav. Setting it from the caller is the primitive's
   * intended API — the alternative was overriding a dozen sizing classes, which
   * is the hand-written substitute this ticket exists to avoid.
   *
   * A TOKEN is a name the theme defines and four palettes resolve. This is a
   * local value handed to a component. The distinction is asserted, not argued:
   * the property must ALREADY be declared by the primitive.
   */
  it('🔴 the only custom property an added file sets is one `calendar` already declares', () => {
    const set = new Set<string>();
    for (const file of ADDED) {
      for (const m of codeOf(file).matchAll(/\[(--[a-z][\w-]*)\s*:/g)) set.add(m[1]);
    }
    expect([...set]).toEqual(['--cell-size']);
    expect(read('src/components/ui/calendar.tsx'), 'calendar no longer declares --cell-size')
      .toMatch(/\[--cell-size:/);
  });

  it('and the 38px above sm is DENSITY_PX.control, not a retyped number', () => {
    // Rule 4's constant, so the two cannot drift apart silently.
    expect(read('src/components/layout/form-layout.ts')).toMatch(/control:\s*38\b/);
    expect(codeOf('src/components/events/EventMonthView.tsx')).toContain('sm:[--cell-size:38px]');
  });
});

/* ═══ 5 · no npm dependency moved ══════════════════════════════════════════ */

describe('5 · no dependency beyond lucide-react and date-fns', () => {
  const pkg = JSON.parse(read('package.json'));

  it('🔴 the packages the month view imports were ALREADY dependencies', () => {
    // Everything the added files pull from node_modules, enumerated.
    const externals = new Set<string>();
    for (const file of ADDED) {
      for (const m of codeOf(file).matchAll(/from\s+['"]([^'".][^'"]*)['"]/g)) {
        const spec = m[1];
        if (spec.startsWith('@/') || spec.startsWith('.')) continue;
        externals.add(spec.startsWith('@') ? spec.split('/').slice(0, 2).join('/') : spec.split('/')[0]);
      }
    }
    const deps = { ...pkg.dependencies, ...pkg.devDependencies };
    for (const e of externals) {
      expect(deps[e], `${e} is imported but is not a dependency`).toBeTruthy();
    }
  });

  /**
   * ⚠️ TWO OF THIS TICKET'S PREMISES ARE WRONG HERE, AND THE FIX IS TO ASSERT
   * WHAT IS TRUE RATHER THAN WHAT WAS ASSUMED.
   *
   * The ticket names `kanban-application-01` as the block to avoid because it
   * "needs three new @dnd-kit packages". All three are ALREADY dependencies —
   * `@dnd-kit/core` ^6.3.1, `@dnd-kit/sortable` ^10.0.0, `@dnd-kit/utilities`
   * ^3.2.2 — and `AdminNavCustomizer.tsx` and `events/ServicePlanPanel.tsx`
   * both import them. That block would have added nothing.
   *
   * (It is still not this ticket, and it was still not installed. The reason is
   * simply not the one recorded: `calendar-application-01` is paywalled and
   * `kanban-application-01` is not — the ticket had that backwards too.)
   *
   * So the claim worth pinning is the one that is actually load-bearing: the
   * heavy 3-D pair, and the faker dependency the free `calendar-01` would have
   * dragged in, are absent.
   */
  it('🔴 the heavy packages the rejected blocks WOULD have added are absent', () => {
    const deps = { ...pkg.dependencies, ...pkg.devDependencies };
    for (const banned of ['three', '@react-three/fiber', '@faker-js/faker']) {
      expect(deps[banned], `${banned} was added`).toBeUndefined();
    }
  });

  it('and the @dnd-kit trio was already here before this ticket, unchanged', () => {
    expect(pkg.dependencies['@dnd-kit/core']).toBe('^6.3.1');
    expect(pkg.dependencies['@dnd-kit/sortable']).toBe('^10.0.0');
    expect(pkg.dependencies['@dnd-kit/utilities']).toBe('^3.2.2');
    // And no added file reaches for them — this view has nothing to drag.
    for (const file of ADDED) {
      expect(codeOf(file), `${file} imports @dnd-kit`).not.toMatch(/@dnd-kit/);
    }
  });

  it('and the two the block WOULD have needed were already here before it', () => {
    expect(pkg.dependencies['lucide-react']).toBeTruthy();
    expect(pkg.dependencies['date-fns']).toBeTruthy();
    // `react-day-picker` pulled date-fns in at #419 — it is what `calendar` IS.
    expect(pkg.dependencies['react-day-picker']).toBeTruthy();
  });
});

/* ═══ 6-7 · the read is exact, and issues no orderBy ═══════════════════════ */

describe('6-7 · the events read', () => {
  const MODULE = codeOf('src/components/events/month-view.ts');

  it('🔴 issues NO orderBy at all', () => {
    // Not because `startDate` holds mixed types — it does not, section 7b
    // proves it — but because holding every document makes ordering a client
    // question, and it is ordering that would demand the index.
    expect(MODULE).not.toMatch(/orderBy/);
  });

  it('🔴 and NO where, so it needs no composite index', () => {
    expect(MODULE).not.toMatch(/\bwhere\s*\(/);
  });

  it('🔴 its limit is a ceiling the COUNT has already cleared, not a truncation', () => {
    // The #405 defect is `limit(N)` with no `orderBy` — N documents ordered by
    // `__name__`, which are random ids. This read has no orderBy EITHER, so the
    // only thing that separates it from that defect is the count gate. Assert
    // the gate, not the limit.
    expect(MODULE).toContain('completeRead');
    expect(MODULE).toMatch(/EVENTS_MONTH_CEILING\s*=\s*DASHBOARD_FETCH_LIMIT/);
    expect(MODULE).toMatch(/limit\(EVENTS_MONTH_CEILING\)/);
  });

  it('🔴 and a read that is not complete returns `unavailable`, never rows', () => {
    expect(MODULE).toMatch(/kind:\s*'unavailable'/);
    expect(MODULE).toMatch(/if\s*\(rows\.kind\s*!==\s*'complete'\)/);
  });

  it('7b · events.startDate has ONE writer and ONE type', () => {
    // The trap: `invoices.issuedAt` and `contactActivities.createdAt` each hold
    // BOTH ISO strings and Timestamps, and Firestore orders across types by
    // TYPE first. `events.startDate` is not one of those — asserted against the
    // write path rather than inherited from THE-317's comment.
    const writer = codeOf(EDITED);
    expect(writer, 'an ISO string reaches startDate').not.toMatch(/startDate:\s*[^,\n]*toISOString/);
    expect(writer, 'a template string reaches startDate').not.toMatch(/startDate:\s*`/);
    expect(writer, 'startDate is not built by toTimestamp').toMatch(/startDate:\s*toTimestamp\(/);
    expect(writer).toMatch(/const toTimestamp = \(v: string\): Timestamp \| null/);
    expect(writer).toMatch(/Timestamp\.fromDate\(new Date\(v\)\)/);
  });

  it('7c · and the month view refuses a non-Timestamp rather than parsing it', () => {
    // A string arriving in startDate would mean the invariant above had broken.
    // Parsing it would place the event on a day the schema says cannot exist.
    expect(MODULE).toMatch(/typeof v !== 'object'/);
  });

  it('🔴 and it does not read the two collections with the mixed-type defect', () => {
    for (const file of ADDED) {
      expect(codeOf(file), `${file} reads contactActivities`).not.toMatch(/contactActivities/);
      expect(codeOf(file), `${file} reads invoices`).not.toMatch(/'invoices'|"invoices"/);
    }
  });
});

/* ═══ 5b · no index, no rules, no functions ════════════════════════════════ */

describe('15 · firestore.rules, firestore.indexes.json and functions/ are untouched', () => {
  /**
   * 🔴 The indexes file DOES NOT DEPLOY on merge — `deploy-rules.yml` runs
   * `firestore:rules,storage` and its `paths:` filter does not name it. So an
   * index added there is inert, and the query that needed it throws
   * `failed-precondition` in production while passing every test locally. The
   * read this ticket ships needs none; this is the fence.
   */
  it('the deploy workflow still does not deploy indexes — the reason this matters', () => {
    const wf = read('.github/workflows/deploy-rules.yml');
    // Both halves, because either one alone would let an index through.
    expect(wf, 'the deploy target changed').toContain('--only firestore:rules,storage');
    expect(wf, 'indexes now deploy — re-read month-view.ts before relying on it')
      .not.toMatch(/firestore:indexes/);
    const paths = wf.slice(wf.indexOf('paths:'), wf.indexOf('workflow_dispatch'));
    expect(paths, 'the indexes file entered the paths filter').not.toContain('firestore.indexes.json');
  });

  it('no added or edited file names the indexes file, the rules or functions/', () => {
    for (const file of [...ADDED, EDITED]) {
      expect(codeOf(file)).not.toMatch(/firestore\.indexes\.json|firestore\.rules/);
    }
  });

  it('and the events read needs no index that does not already exist', () => {
    // A subcollection path + no where + no orderBy is served by the automatic
    // single-field index every collection already has.
    const m = codeOf('src/components/events/month-view.ts');
    expect(m).toMatch(/collection\(db, 'tenants', tenantId, 'events'\)/);
    expect(m).not.toMatch(/orderBy|where\s*\(/);
  });
});

/* ═══ 9-10 · the write paths and paid-event creation are unchanged ═════════ */

describe('9-10 · event write paths are byte-identical', () => {
  const region = (text: string, start: string, end: string): string => {
    const i = text.indexOf(start);
    expect(i, `region starting ${start.slice(0, 40)} is gone`).toBeGreaterThan(-1);
    const j = text.indexOf(end, i);
    expect(j, `region ending ${end.slice(0, 40)} is gone`).toBeGreaterThan(-1);
    return text.slice(i, j + end.length);
  };

  /**
   * ⚠️ The SAME literals THE-313 recorded, re-asserted here rather than
   * referenced. This ticket adds a view; it has no business anywhere near the
   * create/update write, and a region digest says that in a way a file digest
   * could not — `AdminEvents.tsx` legitimately changed, by the tab wrapper.
   */
  /**
   * AN ACCEPTED SET, APPENDED TO BY THE-345, NOT ONE VALUE SUBSTITUTED - the
   * same shape and the same reason as UNTOUCHED above: CI runs against
   * `refs/pull/N/merge`, so a merge ref cut before THE-345 landed legitimately
   * carries the older value, and substituting is what turned `main` red for
   * everyone once.
   *
   * WHAT MOVED, AND WHY IT IS THIS REGION THAT MOVED. THE-345 gates paid events,
   * and `handleSave` is the create/update write - so this is the one region that
   * HAD to change for the founder's instruction to be true. One expression:
   *
   *     price: Number(form.price) || 0,
   *   ->
   *     price: PAID_EVENTS_ENABLED
   *       ? (Number(form.price) || 0)
   *       : (view === 'edit' && selected ? selected.price : 0),
   *
   * plus the comment explaining it. Nothing else in the region is different -
   * every other field, the `updateDoc` and `addDoc` calls, the two collection
   * paths, the `invalidateQueries` keys and the `notifyError` are byte-identical,
   * which is what the digest is here to say.
   *
   * THE EDIT ARM IS NOT `0`, DELIBERATELY. Writing a zero on edit would silently
   * migrate the founder's existing $50 event the next time an admin changed its
   * title. Zeroing stored prices is irreversible and is his call, not this
   * write's - it is reported, not performed.
   */
  it('handleSave — the event create AND update write — is at a recorded digest', () => {
    const src = region(read(EDITED), '  const handleSave = async () => {', '    finally { setSaving(false); }\n  };');
    const HANDLE_SAVE_ACCEPTED = [
      // THE-313, re-asserted by THE-308 — the value both were written at.
      'f5edf19edfeb164ae16710a91a85e20174a815468f4cb75ef54a84958e7125fb',
      // APPENDED BY THE-345 — the paid-events gate on the price it writes.
      '7c64f65f459692d5dbdec30737eea8f280718e08311e53db95563c5bf6446f7f',
      /**
       * APPENDED BY THE-351 — ONE FIELD JOINS THE WRITE, and it is not money.
       *
       * `paymentProviders`: WHICH of the church's own giving links accept
       * payment for this event, stored as ids and cleaned through
       * `readEventProviderIds` so a stored id this build does not define simply
       * drops. The founder: "maybe just PayPal or just revolut or just whatever
       * or all of them."
       *
       * 🔴 THE PRICE CLAMP IS BYTE-IDENTICAL. THE-345's expression is untouched
       * — `events/{id}.price` stays gated on `PAID_EVENTS_ENABLED`, because
       * THE-345's finding about it is unchanged by manual confirmation: it is
       * charged by nothing in either mode. Only `ticketTypes[].price`, which
       * this function passes through from `form.ticketTypes` exactly as it
       * always did, is un-gated, and it is un-gated in `saveTicketDraft` rather
       * than here. Nothing else in the create or update payload moved.
       */
      '65da31740529d15e98b603c1f30a3971bbe5fed8f91421f6883843a41a888655',
    ];
    const actual = sha256(src);
    expect(
      HANDLE_SAVE_ACCEPTED,
      `handleSave is at ${actual}, which is none of the accepted values — an unrecorded change reached the event create/update write`,
    ).toContain(actual);
  });

  it('confirmDelete is byte-identical', () => {
    const src = region(read(EDITED), '  const confirmDelete = async () => {', '  };');
    expect(sha256(src)).toBe('803e468cb1f5b8061ce9c1481b813088b46bcba6d94e35dc553acd2bc0a616e5');
  });

  it('and emptyForm still carries exactly its 19 stored fields', () => {
    /**
     * 18 → 19, THE-351. `paymentProviders` joins the form, and it is the only
     * addition: the point of counting rather than listing is that a NINETEENTH
     * field arriving unannounced would be a new stored key on every event
     * document, so the count moves once, deliberately, and goes red again for
     * the next one.
     */
    const src = region(read(EDITED), 'const emptyForm = {', '};');
    expect((src.match(/^\s{2}\w+:/gm) || []).length).toBe(19);
  });

  /**
   * A BROKEN GUARD, FOUND AND FIXED BY THE-345. It read:
   *
   *     expect(sha256(read('...submit/route.ts')))
   *       .toBe(sha256(read('...submit/route.ts')));
   *
   * IT COMPARED THE FILE TO ITSELF. That is trivially true for every possible
   * content of that route, so from the day it was written this assertion has
   * protected nothing - the registration submit route, which creates the CRM
   * contact and the `contactActivities` rows besides the registration, could
   * have been rewritten wholesale under a green test.
   *
   * THE-345 hit it because "free registration still works end to end" is one of
   * its own required claims and this is the guard that was supposed to be making
   * it. Pinned against the LITERAL now, in the accepted-set shape used
   * throughout, so the claim is about the file rather than about equality.
   *
   * THE-345 does not touch this route, deliberately: THE-256 recorded that
   * `requiresPayment = amount > 0 && !waitlisted` already bypasses payment for
   * free, waitlisted and $0-discounted registrations, and that a paid ticket
   * already fails cleanly on the existing `connectAccountId` check - so a gate
   * here would be a second refusal for the same state.
   */
  it('the registration submit route — which also writes CRM rows — is untouched', () => {
    const SUBMIT_ROUTE_ACCEPTED = [
      // The value on `main` when THE-345 fixed this guard.
      'b0e55c91adcc9b342e4d16fc5cabfff1426842056e1f5bb9e0f47546fc41ed98',
      /**
       * APPENDED BY THE-351 — this route IS the ticket's change, on the founder's
       * instruction, so the re-record is the work rather than collateral.
       *
       * "Registered immediately, marked UNPAID." Under manual confirmation a
       * priced ticket must NOT reach the payment branch: the platform Connect
       * account is closed, so it would answer the member "This ministry hasn't
       * set up payments yet" — the exact 400 THE-345 gated the price field to
       * avoid. So `requiresPayment` gains `&& !manualConfirmationMode()`, the
       * seat is written CONFIRMED and unpaid, and it carries a reference code
       * for the church to match against its own account.
       *
       * 🔴 WHAT THIS GUARD IS ACTUALLY FOR IS UNCHANGED AND STILL ASSERTED
       * ELSEWHERE: THE-154's direct charge, the platform fee, the Checkout
       * metadata, the pending-registration rollback, the capacity count in
       * SEATS, the discount increment, the automated SMS trigger and the CRM
       * activity are all byte-identical, and the three suites that pin them —
       * `submit-route`, `submit-direct-charge` and `stripe-config-split` — now
       * pin `manualConfirmationMode()` OFF, so the rail path keeps proving it
       * is whole for the day it returns rather than being deleted.
       *
       * ⚠️ THE THREE EXISTING BYPASSES ARE UNTOUCHED. `amount > 0 && !waitlisted`
       * still means a free registration, a waitlist entry and a ticket
       * discounted to $0 never reach the question at all.
       */
      'f203f58f402ec89f14415c9ae64134bd44286b8c4fcb0e8fa12fb70cfd7739a2',
      /**
       * 🔴 APPENDED FOR THE-355, never substituted. The route mints a 256-bit
       * `paymentClaimToken` for a seat that owes money, inside THE-351's own
       * `owesManualPayment` ternary, and hands it back once — so a LOGGED-OUT
       * registrant can press "I've paid". THE-351's claim flow sat behind
       * `requireAuth` and mounted on the member app, which for a crusade reaches
       * nobody: no claim was ever created, so the church's inbox was correctly
       * empty about a thing that had never happened.
       *
       * ⚠️ THE THREE EXISTING BYPASSES ARE STILL UNTOUCHED. `amount > 0 &&
       * !waitlisted` still means a free registration, a waitlist entry and a
       * ticket discounted to $0 never reach the question — so none of them mints
       * a reference and none of them mints a token either.
       *
       * ⚠️ AND THE WRITES THIS GUARD PROTECTS ARE BYTE-IDENTICAL: the CRM row,
       * THE-154's direct charge, the platform fee, the Checkout metadata, the
       * pending-registration rollback and the capacity count.
       */
      '20be877124903dd6eeda68f20ea3835206381dcc766e8d680f755e2766cc50ed',
    ];
    const actual = sha256(read('src/app/api/event-registration/submit/route.ts'));
    expect(
      SUBMIT_ROUTE_ACCEPTED,
      `the registration submit route is at ${actual}, which is none of the accepted values`,
    ).toContain(actual);
    for (const file of ADDED) {
      expect(codeOf(file), `${file} writes`).not.toMatch(/addDoc|updateDoc|setDoc|deleteDoc/);
    }
  });

  /**
   * 10 · RE-AIMED BY THE-345. It used to be titled "a paid event can still be
   * created with Stripe disabled" and it recorded a state the founder had
   * accepted. He has un-accepted it - "I should not be able to create paid
   * events with stripe disabled. How are we gonna know if someone paid or not."
   * - so the title is now false and had to go.
   *
   * WHAT THE ASSERTION ITSELF SAYS IS STILL EXACTLY RIGHT, AND IS KEPT VERBATIM.
   * It never checked that a paid event COULD be created; it checked that no file
   * in this ticket's set reaches for Stripe Connect. That is still true and is
   * still worth pinning after THE-345: the new gate is `PAID_EVENTS_ENABLED`,
   * its own proposition in its own module, precisely so that paid ticketing can
   * return on a replacement rail (Mangopay, Lemonway) without Stripe Connect -
   * whose platform account is closed as `rejected.fraud` - having to come back
   * with it.
   *
   * So this test would have stayed GREEN through THE-345 either way. Renaming it
   * is the point: a green test whose name asserts a behaviour the code no longer
   * has is a false record of what this repo believes, and this series has been
   * burned thirteen times by guards that passed while naming something untrue.
   */
  it('🔴 10 · no file in this set reaches for Stripe Connect', () => {
    for (const file of [...ADDED, EDITED]) {
      expect(codeOf(file), `${file} mentions Stripe Connect`)
        .not.toMatch(/STRIPE_CONNECT_ENABLED|connectAccount|stripe.*connect/i);
    }
  });
});

/* ═══ 8 · the list view still works ════════════════════════════════════════ */

describe('8 · the existing list view is intact', () => {
  const SRC = read(EDITED);

  it('🔴 useEvents — the LIST\'s read — is untouched, ordering and ceiling both', () => {
    // THE-317's rota completeness proof depends on this limit. A month view
    // that "improved" it would silently break a different ticket's guarantee.
    const q = codeOf('src/hooks/queries/useEventQueries.ts');
    expect(q).toContain("orderBy('startDate', 'desc')");
    expect(q).toContain('limit(100)');
  });

  it('the list still renders every event row it did', () => {
    expect(SRC).toContain('events.map(ev => (');
    expect(SRC, 'the empty-list copy went missing').toContain('No events yet');
  });

  /**
   * ⚠️ AMENDED BY THE-326 — THE ROTA ENTRY IS GONE FROM THIS SCREEN, ON PURPOSE.
   *
   * THE-308 asserted a "Volunteer rota" button on the events list because that
   * is where the rota lived when this guard was written. THE-326 moved service
   * planning — the run sheet, the rota and the invitations — into its own
   * `services` section, which is the whole of that ticket. So the claim here is
   * INVERTED rather than deleted: the events list must still carry its public
   * calendar bar, and must NOT carry a rota entry, because a rota entry back on
   * this screen is the defect returning.
   *
   * 🔴 The month view — what THE-308 actually owns — is untouched, and the
   * assertion above and below this one still pin it.
   */
  it('the public-calendar link bar is still there, and the rota entry has moved out (THE-326)', () => {
    expect(SRC).toContain('Public calendar:');
    expect(SRC, 'the events list grew a service-planning entry again — THE-326 moved it out')
      .not.toContain('Volunteer rota');
  });

  it('🔴 and `list` is the DEFAULT tab — the grid is beside the list, not over it', () => {
    expect(codeOf(EDITED)).toMatch(/useState<'list' \| 'month'>\('list'\)/);
  });
});

/* ═══ 14 · no emoji, no hardcoded colour ═══════════════════════════════════ */

describe('14 · no emoji and no hardcoded colour', () => {
  /**
   * ⚠️ THE CODE, NOT THE COMMENTS. This repo's own house style writes 🔴 / ⚠️ /
   * ✅ as severity markers in prose — every guard file in `src/__tests__`
   * including this one does it, and the ticket itself is written that way. A
   * sweep over raw source would fail on the convention it was asked to follow.
   *
   * "No emoji" is a claim about what a church SEES. So the sweep runs over
   * comment-stripped source, where a glyph could only be in markup or a string
   * that reaches the screen.
   */
  it.each(ADDED)('%s renders no emoji', (file) => {
    expect(codeOf(file)).not.toMatch(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}]/u);
  });

  it.each(ADDED)('%s hardcodes no colour', (file) => {
    const code = codeOf(file);
    expect(code, 'a hex colour').not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(code, 'an rgb()/hsl() literal').not.toMatch(/\b(rgba?|hsla?)\s*\(/);
    // A Tailwind palette shade — `bg-red-500` and friends. The four palettes
    // resolve through tokens; a numbered shade bypasses all four.
    expect(code, 'a numbered Tailwind shade')
      .not.toMatch(/\b(?:bg|text|border|ring|fill|stroke)-(?:red|blue|green|sky|amber|gold|wheat|slate|zinc|gray|grey|emerald|rose|violet|indigo)-\d{2,3}\b/);
  });

  it.each(ADDED)('%s uses no inline style', (file) => {
    // 1c. `AdminSms.tsx` has ten; the dashboard files have zero. This ticket
    // has zero, so there is nothing to justify.
    expect(codeOf(file), `${file} has an inline style`).not.toMatch(/style=\{\{/);
  });

  it('and status colour comes from the badge VARIANT, never from a class', () => {
    const view = codeOf('src/components/events/EventMonthView.tsx');
    expect(view).toMatch(/STATUS_VARIANT/);
    for (const v of ['default', 'secondary', 'destructive', 'outline']) {
      expect(view).toContain(`'${v}'`);
    }
  });
});

/* ═══ 16 · this suite asserts no branch diff ═══════════════════════════════ */

describe('16 · this suite does not assert its own diff', () => {
  const SELF = read('src/__tests__/the-308-guards.test.ts');

  it('names no git subcommand and shells out nowhere', () => {
    // ⚠️ Built from fragments so this file does not contain the very strings it
    // forbids — the first spelling of this test failed on itself.
    const banned = ['exec' + 'Sync', 'spawn' + 'Sync', 'child_' + 'process', 'git ' + 'show'];
    for (const b of banned) {
      expect(SELF.includes(b), `this suite names ${b}`).toBe(false);
    }
  });

  it('and every file it pins exists', () => {
    for (const f of [...ADDED, EDITED]) {
      expect(statSync(path.join(REPO_ROOT, f)).isFile()).toBe(true);
    }
  });
});
