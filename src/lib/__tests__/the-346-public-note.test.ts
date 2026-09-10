import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * THE-346 · "Share on web" — the one item in this ticket that can leak a
 * church's data, asserted rather than described.
 *
 * ═════════════════════════════════════════════════════════════════════════════
 * WHAT THIS FILE PROVES, AND WHY IT CAN
 *
 * The founder asked for a menu row that "creates a public link, visible until
 * pressed again to stop sharing". A link that still resolves after the toggle
 * is off is worse than no feature at all, so the assertion that matters is not
 * "the flag flipped" but "FETCHING THE LINK AFTER REVOKE RETURNS NOTHING".
 * That is what `resolvePublicNote` is: the entire read path a signed-out
 * stranger travels, and the only one — `/docs/{docId}` grants no public read
 * and is not touched. So calling it before and after a revoke IS the fetch.
 *
 * THE STORE BELOW IS A REAL STORE, NOT A STUB THAT ANSWERS YES. Every write
 * these functions make lands in it and every read comes back out of it, so a
 * revoke that forgot to delete anything would leave the record in place and the
 * "after" fetch would succeed — which is the mutation this file exists to
 * catch, and which is exercised explicitly at the bottom.
 */

// ── In-memory Firestore, keyed by full document path ────────────────────────
// Deliberately faithful about the two things this feature turns on: a `get()`
// on a missing path reports `exists: false` with `data()` undefined, and a
// `delete()` really removes the key rather than blanking it.

const store = new Map<string, Record<string, unknown>>();

/** The `FieldValue.delete()` sentinel, applied by `update` like Firestore's. */
const DELETE_SENTINEL = { __delete: true };
const SERVER_TIMESTAMP = { __serverTimestamp: true };

function makeDocRef(path: string): Record<string, unknown> {
  return {
    path,
    collection: (sub: string) => makeColRef(`${path}/${sub}`),
    async get() {
      const data = store.get(path);
      return { exists: data !== undefined, data: () => data };
    },
    async update(patch: Record<string, unknown>) {
      const prev = store.get(path);
      if (prev === undefined) throw new Error(`update on missing document ${path}`);
      const next = { ...prev };
      for (const [k, v] of Object.entries(patch)) {
        if (v === DELETE_SENTINEL) delete next[k];
        else next[k] = v;
      }
      store.set(path, next);
    },
    async delete() {
      store.delete(path);
    },
  };
}

function makeColRef(path: string): Record<string, unknown> {
  return { doc: (id: string) => makeDocRef(`${path}/${id}`) };
}

/**
 * A batch that APPLIES IN ORDER ON COMMIT and not before, like Firestore's.
 * Applying eagerly would hide an ordering bug in `publishPublicNote`, where the
 * old token's record is deleted in the same batch that writes the new one.
 */
function makeBatch() {
  const ops: Array<() => void> = [];
  return {
    set(ref: { path: string }, data: Record<string, unknown>) {
      ops.push(() => store.set(ref.path, { ...data }));
    },
    update(ref: { path: string }, patch: Record<string, unknown>) {
      ops.push(() => {
        const prev = store.get(ref.path);
        if (prev === undefined) throw new Error(`update on missing document ${ref.path}`);
        const next = { ...prev };
        for (const [k, v] of Object.entries(patch)) {
          if (v === DELETE_SENTINEL) delete next[k];
          else next[k] = v;
        }
        store.set(ref.path, next);
      });
    },
    delete(ref: { path: string }) {
      ops.push(() => store.delete(ref.path));
    },
    async commit() {
      for (const op of ops) op();
    },
  };
}

vi.mock('@/lib/firebase-admin', () => ({
  adminDb: {
    collection: (name: string) => makeColRef(name),
    batch: () => makeBatch(),
  },
}));

vi.mock('firebase-admin/firestore', () => ({
  FieldValue: {
    delete: () => DELETE_SENTINEL,
    serverTimestamp: () => SERVER_TIMESTAMP,
  },
}));

const {
  PUBLIC_NOTE_TOKEN_RE,
  isPublicNoteToken,
  newPublicNoteToken,
  publishPublicNote,
  revokePublicNote,
  resolvePublicNote,
} = await import('@/lib/public-note');

const TENANT = 'shadcn';
const DOC_ID = 'note-abc';

/** Seed one note, as `/docs/{docId}` really stores it. */
function seedNote(extra: Record<string, unknown> = {}) {
  store.set(`docs/${DOC_ID}`, {
    title: 'Elders meeting — safeguarding',
    content: '<p>Internal, and not for the web.</p>',
    tenantId: TENANT,
    createdBy: 'uid-1',
    ...extra,
  });
}

beforeEach(() => {
  store.clear();
});

// ═══════════════════════════════════════════════════════════════════════════
// 1. The token — the whole of the access control, so it is the whole of the
//    secret.
// ═══════════════════════════════════════════════════════════════════════════

describe('the public link is not guessable', () => {
  it('is 43 characters of base64url — 256 bits, the shape THE-324 chose', () => {
    const token = newPublicNoteToken();
    expect(token).toMatch(PUBLIC_NOTE_TOKEN_RE);
    expect(token).toHaveLength(43);
    // 43 base64url characters carry 258 bits of alphabet and encode 32 bytes.
    expect(Buffer.from(token, 'base64url')).toHaveLength(32);
  });

  it('a document id is NOT accepted as one, which is the trap this closes', () => {
    // The obvious link is `/n/{docId}`, and a Firestore auto-id is 20 characters
    // with a timestamp prefix — ids minted near each other sort near each other,
    // so sharing one note would put every note created in the same minute inside
    // a searchable neighbourhood.
    expect(isPublicNoteToken('kR91mVzQ7dLpAe30Xy7Z')).toBe(false);
    expect(isPublicNoteToken(DOC_ID)).toBe(false);
    expect(isPublicNoteToken('')).toBe(false);
    expect(isPublicNoteToken(null)).toBe(false);
    // A token of the right length but the wrong alphabet is still refused, so a
    // path segment cannot smuggle a `/` or a `..` through the reader.
    expect(isPublicNoteToken('a'.repeat(42) + '/')).toBe(false);
    expect(isPublicNoteToken('a'.repeat(44))).toBe(false);
  });

  it('two tokens for the same note are unrelated, so a revoked link stays dead', () => {
    const tokens = new Set(Array.from({ length: 64 }, () => newPublicNoteToken()));
    expect(tokens.size, 'the generator repeated itself').toBe(64);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 2. THE ONE THAT LEAKS A CHURCH'S NOTE — fetched after revoke.
// ═══════════════════════════════════════════════════════════════════════════

describe('Share on web creates a link, and pressing again REVOKES it', () => {
  it('resolves before the revoke and returns NOTHING after it', async () => {
    seedNote();

    const token = await publishPublicNote(TENANT, DOC_ID, 'uid-1');

    // Before: the signed-out reader's own read path answers with the note.
    const before = await resolvePublicNote(token);
    expect(before, 'a freshly shared note did not resolve').not.toBeNull();
    expect(before!.title).toBe('Elders meeting — safeguarding');
    expect(before!.contentHtml).toContain('Internal, and not for the web.');
    expect(before!.tenantId).toBe(TENANT);

    await revokePublicNote(DOC_ID);

    // After: THE SAME FETCH, THE SAME TOKEN, and nothing comes back.
    const after = await resolvePublicNote(token);
    expect(after, 'the link still resolved after it was revoked').toBeNull();
  });

  it('revoking DELETES the record rather than flagging it', async () => {
    seedNote();
    const token = await publishPublicNote(TENANT, DOC_ID, 'uid-1');
    expect(store.has(`publicNotes/${token}`)).toBe(true);

    await revokePublicNote(DOC_ID);

    // No `active: false`, no `revokedAt`, no expiry for some later reader to
    // forget to check. The record IS the permission, so it is gone.
    expect(store.has(`publicNotes/${token}`), 'a revoked share record survived').toBe(false);
    expect(store.get(`docs/${DOC_ID}`), 'the note kept its publicShare mirror')
      .not.toHaveProperty('publicShare');
  });

  it('sharing again mints a NEW token and the old link stays dead forever', async () => {
    seedNote();
    const first = await publishPublicNote(TENANT, DOC_ID, 'uid-1');
    await revokePublicNote(DOC_ID);
    const second = await publishPublicNote(TENANT, DOC_ID, 'uid-1');

    expect(second).not.toBe(first);
    expect(await resolvePublicNote(second), 're-sharing did not produce a live link').not.toBeNull();
    expect(
      await resolvePublicNote(first),
      'a link that was revoked came back to life when the note was re-shared',
    ).toBeNull();
  });

  it('re-sharing without revoking first still leaves only ONE live token', async () => {
    // Two live tokens for one note would mean "stop sharing" had to find them
    // all, and the one it missed would be the leak.
    seedNote();
    const first = await publishPublicNote(TENANT, DOC_ID, 'uid-1');
    const second = await publishPublicNote(TENANT, DOC_ID, 'uid-1');

    expect(await resolvePublicNote(first), 'the superseded token still resolved').toBeNull();
    expect(await resolvePublicNote(second)).not.toBeNull();

    await revokePublicNote(DOC_ID);
    expect(await resolvePublicNote(second)).toBeNull();
  });

  it('revoking a note that was never shared is a success, not an error', async () => {
    seedNote();
    await expect(revokePublicNote(DOC_ID)).resolves.toBeUndefined();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 3. Nothing is cached, and nothing is copied — the other way a revoke leaks.
// ═══════════════════════════════════════════════════════════════════════════

describe('the reader answers from the note itself, every time', () => {
  it('stores no copy of the title or the body in the share record', async () => {
    seedNote();
    const token = await publishPublicNote(TENANT, DOC_ID, 'uid-1');

    const record = store.get(`publicNotes/${token}`)!;
    expect(Object.keys(record).sort()).toEqual(['createdAt', 'createdBy', 'docId', 'tenantId']);
    expect(JSON.stringify(record)).not.toContain('safeguarding');
    expect(JSON.stringify(record)).not.toContain('Internal');
  });

  it('an edit to the note reaches the public page without re-sharing', async () => {
    seedNote();
    const token = await publishPublicNote(TENANT, DOC_ID, 'uid-1');
    store.set(`docs/${DOC_ID}`, { ...store.get(`docs/${DOC_ID}`)!, title: 'Renamed' });
    expect((await resolvePublicNote(token))!.title).toBe('Renamed');
  });

  it('a note deleted after sharing stops resolving', async () => {
    seedNote();
    const token = await publishPublicNote(TENANT, DOC_ID, 'uid-1');
    store.delete(`docs/${DOC_ID}`);
    expect(await resolvePublicNote(token)).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 4. Forgery — the doc's own `publicShare` field IS client-writable.
// ═══════════════════════════════════════════════════════════════════════════

describe('a planted publicShare field grants nothing', () => {
  it('a token with no server record does not resolve', async () => {
    // `/docs/{docId}`'s update rule lets the author write any field, so a member
    // could plant this from the console. The reader resolves the RECORD first,
    // and only the server route can create one.
    const planted = newPublicNoteToken();
    seedNote({ publicShare: { token: planted } });
    expect(await resolvePublicNote(planted)).toBeNull();
  });

  it('a record whose note no longer points back at it does not resolve', async () => {
    // The fail-closed check: a stale record — one whose deletion half-failed, or
    // whose note was re-shared under a new token — must not keep serving.
    seedNote();
    const token = await publishPublicNote(TENANT, DOC_ID, 'uid-1');
    store.set(`docs/${DOC_ID}`, {
      ...store.get(`docs/${DOC_ID}`)!,
      publicShare: { token: newPublicNoteToken() },
    });
    expect(await resolvePublicNote(token)).toBeNull();
  });

  it('every way of failing is the same answer, so the reader is no oracle', async () => {
    seedNote();
    for (const bad of ['', 'not-a-token', DOC_ID, null, undefined, 42, newPublicNoteToken()]) {
      expect(await resolvePublicNote(bad), `${String(bad)} was distinguishable`).toBeNull();
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 5. MUTATION VERIFICATION — the guard is shown to fail on the defect.
// ═══════════════════════════════════════════════════════════════════════════

describe('leaving a shared link resolving after revoke FAILS this suite', () => {
  it('a revoke that only flags the record is caught', async () => {
    // The exact defect the ticket names: "a link that still resolves after the
    // toggle is off". Simulated against the real reader by performing the
    // WEAKER revoke — flag it instead of deleting it — and showing the fetch
    // still succeeds, which is what test 2 above would then report as a
    // failure.
    seedNote();
    const token = await publishPublicNote(TENANT, DOC_ID, 'uid-1');

    const flaggedRevoke = async () => {
      const rec = store.get(`publicNotes/${token}`)!;
      store.set(`publicNotes/${token}`, { ...rec, active: false });
    };
    await flaggedRevoke();

    expect(
      await resolvePublicNote(token),
      'the weaker revoke was expected to leak — if this is null the mutation is not being exercised',
    ).not.toBeNull();

    // And the shipped revoke closes it.
    await revokePublicNote(DOC_ID);
    expect(await resolvePublicNote(token)).toBeNull();
  });
});
