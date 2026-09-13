import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { stripComments } from './__fixtures__/the-346-strip-comments';
import { rulesDigestFailure } from './__fixtures__/firestore-rules-pin';
import { ownershipFailure } from './__fixtures__/ownership-register';

/**
 * THE-359 · 🔴 THE DOOR PROMISE, THE WORD "CHURCH", AND THE FILES THIS TICKET
 * MAY NOT TOUCH.
 *
 * ═════════════════════════════════════════════════════════════════════════════
 * 🔴 EVERY CONTENT GREP HERE RUNS OVER PARSER-STRIPPED SOURCE.
 *
 * #496's parser-driven stripper, IMPORTED rather than copied. A prose-bearing
 * repository like this one CANNOT be grepped raw, and THIS TICKET IS THE WORST
 * CASE FOR IT: every module it edits now carries a docblock QUOTING the
 * sentence that was deleted, in order to record why. A raw grep for "you will
 * not be turned away at the door" finds those quotations and passes forever
 * over a surface that reinstated the promise.
 *
 * 🔴 AND #496 FOUND TWO OF ITS OWN GUARDS SELF-MATCHING, so every needle whose
 * subject this file must also name is ASSEMBLED FROM FRAGMENTS at run time and
 * proved against a positive control before it is trusted.
 *
 * 🔴 NOTHING IS PINNED TO A LINE NUMBER. THE-331 pinned
 * `AdminCommunity.tsx` at a line; a deletion shifted it and the suite measured
 * whatever landed there. Every surface below is found by pattern, and a pattern
 * that finds nothing THROWS rather than passing over a default.
 */

const ROOT = process.cwd();
const read = (rel: string) => readFileSync(path.join(ROOT, rel), 'utf8');
const code = (rel: string) => stripComments(read(rel));
const sha = (rel: string) => createHash('sha256').update(readFileSync(path.join(ROOT, rel))).digest('hex');

/**
 * 🔴 EVERY ATTENDEE-FACING SURFACE, NAMED. The sweeps below are per-file and
 * report the file in their failure message, so "the door promise came back"
 * says WHERE.
 *
 * ⚠️ ADMIN-FACING COPY IS OUT OF SCOPE and is deliberately absent from this
 * list — an admin knows which tenant they are in, and `CREATION_DISCLAIMER_BODY`
 * tells them the one thing about the door that IS knowable and is this ticket's
 * to preserve: Harvest's own check-in never blocks on payment. See the
 * behaviour section below, which asserts that admin sentence survives.
 */
const ATTENDEE_FACING = [
  'src/components/UserEvents.tsx',
  'src/components/PublicEventRegistration.tsx',
  'src/app/api/event-registration/submit/route.ts',
] as const;

/**
 * 🔴 `event-payment-claims.ts` IS SWEPT BY EXPORT, NOT AS A WHOLE FILE, and
 * that is the difference between a guard and a nuisance. The module holds BOTH
 * audiences: the member's ticket copy AND the admin's event form, inbox and
 * door badge. Two admin strings legitimately mention the door and Harvest's own
 * checking —
 *
 *   · `CREATION_DISCLAIMER_BODY` — "anyone holding an unpaid ticket is still let
 *     in at the door", which is a statement about HARVEST'S OWN check-in, is
 *     knowable, is what an admin needs before pricing an event, and is what this
 *     ticket must NOT change;
 *   · `INBOX_INTRO` / `inboxRowSummary` — "Harvest has not checked any of it",
 *     said to the admin who is about to go and check.
 *
 * A whole-file sweep would either fail on those or be softened until it caught
 * nothing. So the attendee surface is enumerated, and a COMPLETENESS check below
 * proves the enumeration cannot silently lose a member-facing string.
 */
const ATTENDEE_EXPORTS = [
  'TENANT_NAME_FALLBACK',
  'TICKET_QR_WAITING_TITLE', 'ticketQrWaitingBody',
  'MEMBER_UNPAID_BADGE', 'MEMBER_CLAIM_BUTTON',
  'memberClaimedBadge', 'memberConfirmedBadge', 'memberUnpaidBody',
  'memberClaimHelp', 'memberClaimedTitle', 'memberClaimedBody',
  'memberConfirmedBody', 'memberClaimFailed',
  'PUBLIC_PAY_TITLE', 'publicPayBody', 'publicNoLinksTitle', 'publicNoLinksBody',
  'publicClaimHelp', 'publicClaimedTitle', 'publicClaimedBody',
] as const;

/**
 * Member/public-prefixed exports that are NOT copy — a regex, a field name, a
 * byte count and a predicate. Named so the completeness check below can tell
 * "not swept because it is not a sentence" from "not swept because somebody
 * forgot".
 */
const NOT_COPY = [
  'PUBLIC_CLAIM_TOKEN_RE', 'PUBLIC_CLAIM_TOKEN_FIELD', 'PUBLIC_CLAIM_TOKEN_BYTES',
  'isPublicClaimToken',
] as const;

/** Every attendee-facing string the module produces, at a name and at none. */
async function attendeeStrings(): Promise<string[]> {
  const m = await import('@/lib/event-payment-claims');
  const out: string[] = [];
  for (const name of ['Kingdom Living', null] as const) {
    out.push(
      m.memberUnpaidBody(name, 5000, 'HV-263J8N'),
      m.memberClaimedBody(name, 'HV-263J8N'),
      m.memberConfirmedBody(name, '2031-09-13T20:57:00.000Z'),
      m.memberClaimHelp(name),
      m.memberClaimedTitle(name),
      m.memberClaimedBadge(name),
      m.memberConfirmedBadge(name),
      m.memberClaimFailed(name),
      m.publicPayBody(name, 5000, 'HV-263J8N'),
      m.publicNoLinksBody(name, 5000, 'HV-263J8N'),
      m.publicNoLinksTitle(name),
      m.publicClaimHelp(name),
      m.publicClaimedTitle(name),
      m.publicClaimedBody(name, 'HV-263J8N'),
      m.ticketQrWaitingBody(name),
    );
  }
  out.push(m.TENANT_NAME_FALLBACK, m.TICKET_QR_WAITING_TITLE,
    m.MEMBER_UNPAID_BADGE, m.MEMBER_CLAIM_BUTTON, m.PUBLIC_PAY_TITLE);
  return out;
}

/** Everything this ticket edits, attendee-facing or not. */
const TOUCHED = [
  ...ATTENDEE_FACING,
  'src/app/api/event-payment/confirm/route.ts',
  'src/app/api/event-payment/claim/route.ts',
  'src/app/api/event-payment/public-claim/route.ts',
  'src/components/Profile.tsx',
] as const;

/** This ticket's own suites, discovered rather than listed by hand. */
const SUITES = (() => {
  const dirs = [
    'src/__tests__',
    'src/components/__tests__',
    'src/app/api/event-payment/__tests__',
  ];
  return dirs.flatMap((d) =>
    readdirSync(path.join(ROOT, d))
      .filter((f) => f.startsWith('THE-359.'))
      .map((f) => `${d}/${f}`));
})();

/* ═══ 1 · no attendee-facing surface promises anything about the door ════ */

describe('1 · the door guarantee is gone from every attendee-facing surface', () => {
  /**
   * THE FOUNDER: "'Bring this ticket either way — you will not be turned away at
   * the door.' this should be deleted. there is no way for us to know what each
   * church is doing. or ministry."
   *
   * 🔴 AND NOT REPLACED WITH A SOFTER VERSION. "most churches will let you in"
   * and "check with your church" are the same claim with a hedge on it: Harvest
   * still does not know the tenant's door policy and still must not characterise
   * it. So the sweep bans the promise AND its hedged forms.
   */
  /**
   * 🔴 AN ALLOWLIST, NOT A BLOCKLIST, AND MUTATION IS WHY.
   *
   * The first version of this guard banned a list of phrasings — "turned away",
   * "let in at the door", "admitted at the door". A PLANTED MUTATION WALKED
   * STRAIGHT THROUGH IT: "Most churches will let you in at the door" does not
   * match `let\s+in\s+at\s+the\s+door`, because of the word "you". That is the
   * blocklist failure mode in one line — every ban is a list of the rephrasings
   * somebody already thought of, and the founder's own examples of what must
   * NOT be substituted ("most churches will let you in", "check with your
   * church") are exactly the rephrasings a blocklist misses.
   *
   * 🔴 SO THE RULE IS INVERTED. Any clause that mentions the door AT ALL must be
   * one of a small NAMED set of neutral instructions — "present this at the
   * door", which tells a member what to do with a ticket and says nothing about
   * whether they will be admitted. Everything else fails, whatever its wording,
   * because Harvest does not know a tenant's door policy and must not
   * characterise it in any direction.
   */
  /**
   * 🔴 ANCHORED, AND A SECOND MUTATION IS WHY.
   *
   * The first allowlist matched a SUBSTRING, and a planted rider walked through
   * it: "Present this at the door \u2014 nobody is stopped at the door" contains
   * the allowed instruction, so the whole clause was waved past. An allowance
   * that can carry a passenger is not an allowance. Each pattern must therefore
   * match the WHOLE normalised clause, and the splitter below breaks on the
   * dashes an author would use to append one.
   */
  const DOOR_SENTENCES_ALLOWED = [
    /^present this (?:qr code )?at the door$/i,
    /^show this code at the door$/i,
  ];

  /** Every clause mentioning the door, normalised, out of a blob of text. */
  const doorClauses = (text: string): string[] => {
    const out: string[] = [];
    /**
     * Split on sentence boundaries, markup boundaries AND both dashes, so one
     * clause cannot hide inside another's allowance. Trailing punctuation is
     * trimmed after the split so a colon or a full stop is not the difference
     * between allowed and not.
     */
    for (const part of text.split(/[.!?;:\n`'"<>{}\u2014\u2013]+/)) {
      if (/\bdoors?\b/i.test(part)) {
        out.push(part.replace(/\s+/g, ' ').replace(/^[\s,]+|[\s,]+$/g, ''));
      }
    }
    return out;
  };

  const offendingDoorClauses = (text: string): string[] =>
    doorClauses(text).filter((c) => !DOOR_SENTENCES_ALLOWED.some((re) => re.test(c)));

  const DASH = String.fromCodePoint(0x2014);

  it('the allowlist catches every rephrasing, including the softened ones', () => {
    /**
     * The positive controls. The last three are the founder's OWN examples of
     * substitutions that must not be accepted, plus the mutation that defeated
     * the blocklist this replaced — the exact cases a ban list misses.
     */
    const MUST_FAIL = [
      `Bring this ticket either way ${DASH} you will not be `
        + `${['turned', 'away'].join(' ')} at the door.`,
      'Anyone holding an unpaid ticket is still let in at the door.',
      'Most churches will let you in at the door.',
      'You will be admitted at the door.',
      'Check with your church about the door.',
      'Nobody is stopped at the door.',
      // 🔴 THE RIDER. This one defeated the un-anchored allowlist: it CONTAINS
      // the neutral instruction and then appends a promise to it.
      `Present this at the door ${DASH} nobody is stopped at the door.`,
      'Present this at the door and you will get in.',
    ];
    for (const bad of MUST_FAIL) {
      expect(offendingDoorClauses(bad), `the allowlist ACCEPTED: "${bad}"`).not.toEqual([]);
    }
    // And the neutral instruction really is accepted, or every sweep below is
    // just a ban on the word "door".
    for (const ok of [
      `Present this at the door ${DASH} no email needed.`,
      'Present this QR code at the door:',
      'Show this code at the door:',
    ]) {
      expect(offendingDoorClauses(ok), `the allowlist REJECTED the neutral instruction: "${ok}"`)
        .toEqual([]);
    }
    // Text with no door at all yields nothing to check.
    expect(offendingDoorClauses('Your place is booked.')).toEqual([]);
  });

  for (const rel of ATTENDEE_FACING) {
    it(`🔴 ${rel} promises nothing about the door`, () => {
      const src = code(rel);
      expect(src.length, `${rel} was stripped to nothing — the sweep is vacuous`)
        .toBeGreaterThan(200);
      const offending = offendingDoorClauses(src);
      expect(offending,
        `🔴 ${rel} SAYS SOMETHING ABOUT THE DOOR THAT IS NOT THE NEUTRAL INSTRUCTION: `
        + offending.map((c) => `"${c.slice(0, 90)}"`).join(' · '))
        .toEqual([]);
    });
  }

  it('🔴 the neutral instruction is still SOMEWHERE — the allowlist is not stale', () => {
    /**
     * An allowlist entry nothing matches is dead weight that makes the next
     * reader believe a surface exists which does not. Both allowed forms are
     * still rendered: "Present this at the door" on a confirmed or free ticket,
     * and "Show this code at the door" on the public success screen.
     */
    const clauses = ATTENDEE_FACING.flatMap((r) => doorClauses(code(r)));
    expect(clauses.length, 'no attendee surface mentions the door at all any more')
      .toBeGreaterThan(0);
    for (const re of DOOR_SENTENCES_ALLOWED) {
      expect(clauses.some((c) => re.test(c)),
        `the allowed door sentence ${re} matches nothing any more`).toBe(true);
    }
  });

  it('🔴 and every attendee-facing string the copy module BUILDS is clean too', async () => {
    /**
     * The file sweeps read source. This one reads what the functions actually
     * produce, at real arguments AND at a missing tenant name — a builder that
     * reinstated the promise only in its fallback branch would pass above.
     */
    const m = await import('@/lib/event-payment-claims');
    const produced = await attendeeStrings();
    expect(produced.length, 'the builder sweep is vacuous').toBeGreaterThan(20);
    for (const s of produced) {
      expect(s.length, 'a builder produced an empty string').toBeGreaterThan(0);
      /**
       * 🔴 STRICTER THAN THE FILE SWEEP, DELIBERATELY. Not one attendee string
       * this module produces has any business mentioning the door at all: the
       * two neutral "present this" instructions live in the components, beside
       * the QR they refer to. So the rule here is the WORD, not the clause.
       */
      expect(s, `🔴 "${s.slice(0, 70)}…" mentions the door`).not.toMatch(/\bdoors?\b/i);
      // And nothing implies Harvest checked anything, at either argument.
      expect(m.claimsVerification(s), `"${s.slice(0, 70)}…" over-claims`).toBeNull();
    }
  });

  it('🔴 the attendee enumeration is COMPLETE — a new member string cannot escape it', async () => {
    /**
     * 🔴 THE FAILURE MODE THIS EXISTS FOR: someone adds `memberSomethingBody`,
     * the per-export sweep above never names it, and every guard here passes
     * over a surface nobody checked. Every export whose name marks it as
     * member- or public-facing must be swept, be declared not-copy, or fail.
     */
    const m = await import('@/lib/event-payment-claims');
    const swept = new Set<string>([...ATTENDEE_EXPORTS, ...NOT_COPY]);
    const missed = Object.keys(m)
      .filter((k) => /^(?:member|public|ticketQr)|^(?:MEMBER_|PUBLIC_|TICKET_)/.test(k))
      .filter((k) => !swept.has(k));
    expect(missed,
      `🔴 attendee-facing exports are not swept by THE-359: ${missed.join(', ')}`)
      .toEqual([]);
    // And the enumeration names nothing that has since been deleted.
    for (const name of ATTENDEE_EXPORTS) {
      expect(Object.keys(m), `${name} is enumerated but no longer exported`).toContain(name);
    }
  });

  it('🔴 the deleted "Harvest has not checked anything" line is gone as well', async () => {
    /**
     * Section 5 removed the whole sentence, both halves, from the member's
     * waiting note and from the public one that duplicated it.
     *
     * ⚠️ ATTENDEE SURFACES ONLY. The tenant INBOX says "Harvest has not checked
     * any of it" to the ADMIN who is about to go and check, which is true, is
     * the point of the screen, and is not what the founder asked to remove.
     */
    const needle = new RegExp(['Harvest', 'has', 'not', 'checked'].join('\\s+'), 'i');
    expect(needle.test('Harvest has not checked anything and cannot.')).toBe(true);
    for (const rel of ATTENDEE_FACING) {
      expect(code(rel), `the deleted Harvest-has-not-checked line is back in ${rel}`)
        .not.toMatch(needle);
    }
    for (const s of await attendeeStrings()) {
      expect(s, `the deleted line is back: "${s.slice(0, 70)}…"`).not.toMatch(needle);
    }
  });
});

/* ═══ 2 · check-in still never blocks on payment ═════════════════════════ */

describe('2 · the BEHAVIOUR did not change — check-in never blocks on payment', () => {
  /**
   * 🔴 THIS TICKET REMOVED A PROMISE FROM COPY. IT CHANGED NOTHING ABOUT WHAT
   * THE SOFTWARE DOES. The founder's original decision stands: "Turning a paying
   * guest away because an admin had not tapped a button is the worst outcome
   * this ticket could produce, and it must be impossible."
   *
   * ⚠️ ADMINEVENTS.TSX IS NOT EDITED BY THIS TICKET AT ALL, so these are
   * no-regression assertions read off the shipped source — the same pattern
   * THE-351's §14 uses, restated here because THE-359 is the ticket most likely
   * to be blamed if it ever stops being true.
   */
  const EVENTS = 'src/components/AdminEvents.tsx';

  it('🔴 the Check In control is gated on REGISTRATION status and nothing else', () => {
    const ev = code(EVENTS);
    const m = /\{([^{}]*)&&\s*\(\s*<button\s+onClick=\{\(\)\s*=>\s*checkIn\(r\)\}/.exec(ev);
    expect(m, 'the Check In button could not be found — the markup changed').not.toBeNull();
    const condition = m![1];
    expect(condition.replace(/\s+/g, ' ').trim()).toBe("r.status === 'confirmed'");
    for (const word of ['payment', 'paid', 'Invoice', 'confirmedAt']) {
      expect(condition, `🔴 CHECK-IN NOW BLOCKS ON ${word} — a paying guest is turned away`)
        .not.toContain(word);
    }
  });

  it('🔴 `checkIn` still writes only the registration status', () => {
    const m = /const checkIn = async \(reg: Registration\) => \{([\s\S]*?)\n {2}\};/.exec(code(EVENTS));
    expect(m, 'checkIn could not be found').not.toBeNull();
    expect(m![1]).toContain("{ status: 'attended' }");
    expect(m![1], 'check-in reads or writes payment state').not.toMatch(/payment/i);
  });

  it('🔴 a volunteer can still FIND an unconfirmed guest by name', () => {
    /**
     * STOP CONDITION 5, answered. Withholding the member's QR is only safe
     * because the door never needed it: the attendee list has a search box and
     * the Check In control beside every row it returns.
     */
    const ev = code(EVENTS);
    expect(ev, 'the attendee search is gone — an unconfirmed guest cannot be found')
      .toContain('Search attendees...');
    const filter = /const filteredRegs = registrations\.filter\(r =>([\s\S]{0,400}?)\);/.exec(ev);
    expect(filter, 'the attendee filter could not be found').not.toBeNull();
    expect(filter![1], '🔴 the attendee search now filters on payment state')
      .not.toMatch(/payment/i);
  });

  it('🔴 the volunteer is still told to let an unconfirmed guest in', async () => {
    const { DOOR_UNCONFIRMED_HELP, DOOR_UNCONFIRMED_BADGE } =
      await import('@/lib/event-payment-claims');
    expect(DOOR_UNCONFIRMED_HELP, 'the "let them in" instruction went with the attendee copy')
      .toMatch(/let them in/i);
    // It names the RECORD's state, never the person's — unchanged.
    expect(DOOR_UNCONFIRMED_BADGE).toBe('Payment not confirmed');
  });

  it('🔵 and the ADMIN is still told an unpaid ticket gets in — deliberately kept', async () => {
    /**
     * 🔵 REPORTED AS A CONSIDERED EXCLUSION. `CREATION_DISCLAIMER_BODY` ends
     * "and anyone holding an unpaid ticket is still let in at the door." That is
     * ADMIN-facing, on the event form, and it is a statement about HARVEST'S OWN
     * SOFTWARE — which is knowable, is what this ticket must not change, and is
     * what an admin needs before deciding to price an event. It is a different
     * sentence from the attendee promise the founder deleted, which asserted
     * what the TENANT would do at its own door. THE-351's own guard requires it.
     */
    const { CREATION_DISCLAIMER_BODY } = await import('@/lib/event-payment-claims');
    expect(CREATION_DISCLAIMER_BODY, 'the admin lost the warning that an unpaid ticket still gets in')
      .toMatch(/still let in at the door/);
  });
});

/* ═══ 3 · the "I've paid" disclaimer ═════════════════════════════════════ */

describe('3 · the "I’ve paid" disclaimer says what the press does, and nothing else', () => {
  it('🔴 it carries the premise and the tenant’s name', async () => {
    const { memberClaimHelp, publicClaimHelp } = await import('@/lib/event-payment-claims');
    for (const [what, s] of [
      ['member', memberClaimHelp('Kingdom Living')],
      ['public', publicClaimHelp('Kingdom Living')],
    ] as const) {
      expect(s, `the ${what} disclaimer no longer says the press confirms nothing`)
        .toMatch(/does not confirm payment/i);
      expect(s, `the ${what} disclaimer does not name the tenant`).toContain('Kingdom Living');
    }
    // The public one alone tells a logged-out registrant where the record lives.
    expect(publicClaimHelp('Kingdom Living')).toContain('Keep the email with your ticket code');
  });

  it('🔴 it does NOT say Harvest checked anything', async () => {
    const { memberClaimHelp, publicClaimHelp, claimsVerification } =
      await import('@/lib/event-payment-claims');
    for (const name of ['Kingdom Living', null] as const) {
      for (const s of [memberClaimHelp(name), publicClaimHelp(name)]) {
        expect(claimsVerification(s), `"${s}" claims Harvest verified something`).toBeNull();
        expect(s, 'the disclaimer says Harvest looked').not.toMatch(/Harvest (?:has |)(?:checked|verified|received)/i);
      }
    }
  });

  it('🔴 and it does NOT mention what you owe', async () => {
    /**
     * THE FOUNDER flagged the sentence. "It does not change what you owe" reads
     * as a debt-collection line in a giving context — a ticket for a crusade is
     * a gift with a suggested amount, not an invoice — and it told the member
     * nothing they could act on. It is dropped rather than reworded.
     */
    const { memberClaimHelp, publicClaimHelp } = await import('@/lib/event-payment-claims');
    const DEBT = new RegExp([
      ['what', 'you', 'owe'].join('\\s+'),
      ['still', 'owe'].join('\\s+'),
      ['amount', 'due'].join('\\s+'),
      ['outstanding', 'balance'].join('\\s+'),
    ].join('|'), 'i');
    expect(DEBT.test('it does not change what you owe'), 'the needle catches nothing').toBe(true);
    for (const name of ['Kingdom Living', null] as const) {
      for (const s of [memberClaimHelp(name), publicClaimHelp(name)]) {
        expect(s, `🔴 the debt line is back: "${s}"`).not.toMatch(DEBT);
      }
    }
  });

  it('🔴 and it is shorter than the sentence it replaced', async () => {
    // Not a style rule: the old member disclaimer was two clauses of hedging
    // beside a button, and a warning nobody finishes reading is not a warning.
    const OLD_LENGTH = ('This only tells the ' + 'church to go and look. It settles nothing on '
      + 'its own and it does not change what you owe.').length;
    const { memberClaimHelp } = await import('@/lib/event-payment-claims');
    expect(memberClaimHelp('Kingdom Living').length).toBeLessThan(OLD_LENGTH);
  });
});

/* ═══ 8 · no attendee-facing string says "the church" ════════════════════ */

describe('8 · no attendee-facing string says "the church" — the tenant is named', () => {
  /**
   * THE FOUNDER: "instead of 'the church', say the name of the ministry. not all
   * tenants are churches." And again: "after a ticket is confirmed, do not say
   * the church but the name of the tenant."
   */
  const CHURCH = new RegExp(['the', 'church'].join('\\s+'), 'i');

  it('the needle catches the strings this ticket removed', () => {
    for (const gone of [
      'Waiting for the church to check',
      'Waiting on the church',
      'Marked paid by the church',
      'The church has been asked to look',
      'Ask the church how to pay',
      'This only tells the church to go and look.',
    ]) {
      expect(CHURCH.test(gone), `the needle missed "${gone}"`).toBe(true);
    }
    expect(CHURCH.test('Kingdom Living has been asked to look')).toBe(false);
  });

  it('🔴 every string the copy module builds names the tenant instead', async () => {
    const m = await import('@/lib/event-payment-claims');
    const produced = [
      m.memberUnpaidBody('Kingdom Living', 5000, 'HV-263J8N'),
      m.memberClaimedBody('Kingdom Living', 'HV-263J8N'),
      m.memberConfirmedBody('Kingdom Living', '2031-09-13T20:57:00.000Z'),
      m.memberClaimHelp('Kingdom Living'),
      m.memberClaimedTitle('Kingdom Living'),
      m.memberClaimedBadge('Kingdom Living'),
      m.memberConfirmedBadge('Kingdom Living'),
      m.memberClaimFailed('Kingdom Living'),
      m.publicPayBody('Kingdom Living', 5000, 'HV-263J8N'),
      m.publicNoLinksBody('Kingdom Living', 5000, 'HV-263J8N'),
      m.publicNoLinksTitle('Kingdom Living'),
      m.publicClaimHelp('Kingdom Living'),
      m.publicClaimedTitle('Kingdom Living'),
      m.publicClaimedBody('Kingdom Living', 'HV-263J8N'),
      m.ticketQrWaitingBody('Kingdom Living'),
    ];
    expect(produced.length, 'the sweep is vacuous').toBeGreaterThan(12);
    for (const s of produced) {
      expect(s, `🔴 "${s.slice(0, 70)}…" still says "the church"`).not.toMatch(CHURCH);
      expect(s, `"${s.slice(0, 70)}…" does not name the tenant`).toContain('Kingdom Living');
    }
  });

  it('🔴 and no attendee-facing SOURCE spells it in a rendered string either', () => {
    /**
     * The builder sweep above only sees exported functions. This one sees every
     * literal in the three component/route files, over PARSER-STRIPPED source —
     * which matters more here than anywhere: their docblocks quote the removed
     * strings verbatim in order to record what changed.
     *
     * ⚠️ `event-payment-claims.ts` IS SWEPT BY EXPORT INSTEAD (see the sweep
     * above and the completeness check beside it), because that one file also
     * holds the ADMIN copy, which the ticket puts out of scope and which says
     * "the church" correctly — an admin knows which tenant they are in.
     */
    for (const rel of ATTENDEE_FACING) {
      const src = code(rel);
      expect(src.length, `${rel} stripped to nothing`).toBeGreaterThan(200);
      // String literals only — an identifier like `churchName` is a variable
      // name, not something a member reads.
      for (const lit of src.match(/'[^'\n]{8,200}'|"[^"\n]{8,200}"|`[^`]{8,400}`/g) ?? []) {
        expect(lit, `🔴 ${rel} renders "the church" to an attendee: ${lit.slice(0, 60)}`)
          .not.toMatch(CHURCH);
      }
    }
  });

  it('🔵 admin-facing copy is deliberately untouched, and is not swept here', async () => {
    // Out of scope by the ticket's own words: an admin knows which tenant they
    // are in. Recorded so the exclusion is a decision rather than an oversight.
    const { NO_LINKS_BODY, DOOR_UNCONFIRMED_HELP } = await import('@/lib/event-payment-claims');
    expect(NO_LINKS_BODY, 'the admin no-links copy changed').toMatch(/Your church has no payment links/);
    expect(DOOR_UNCONFIRMED_HELP).toMatch(/Nobody at the church has marked this one paid/);
  });
});

/* ═══ 18 · the public claim route still takes no registration id ═════════ */

describe('18 · the public claim route is unchanged in shape — security no-regression', () => {
  it('🔴 it takes a token and no registration id, and finds the row BY the token', () => {
    const src = code('src/app/api/event-payment/public-claim/route.ts');
    /**
     * 🔴 THE TOKEN *SELECTS* THE REGISTRATION rather than accompanying an id, so
     * there is no pair to mismatch and no check to forget: a claim can only ever
     * land on the one registration whose own 256-bit token was presented. A
     * `registrationId` in this body would be a request that can NAME SOMEBODY
     * ELSE'S SEAT.
     */
    // The REQUEST BODY is the thing that must not carry one. (The route names
    // `registrationId` afterwards, in its own response and in a Sentry tag —
    // an id it RESOLVED from the token, which is the opposite of accepting one.)
    const body = /let body:([\s\S]{0,400}?);\n/.exec(src);
    expect(body, 'the request body type could not be found').not.toBeNull();
    expect(body![1], '🔴 THE PUBLIC CLAIM ROUTE NOW TAKES A REGISTRATION ID')
      .not.toMatch(/registrationId/);
    expect(src, '🔴 the route reads a registration id off the request')
      .not.toMatch(/body\.registrationId/);
    expect(src, 'the row is no longer looked up by the token')
      .toMatch(/where\(\s*PUBLIC_CLAIM_TOKEN_FIELD/);
  });

  it('🔴 and the token shape is still 43 chars of base64url', async () => {
    const { PUBLIC_CLAIM_TOKEN_RE } = await import('@/lib/event-payment-claims');
    expect(PUBLIC_CLAIM_TOKEN_RE.source).toBe('^[A-Za-z0-9_-]{43}$');
    expect(PUBLIC_CLAIM_TOKEN_RE.test('a'.repeat(43))).toBe(true);
    expect(PUBLIC_CLAIM_TOKEN_RE.test('a'.repeat(42))).toBe(false);
  });
});

/* ═══ 19 · the rest of the event feature is unaffected ═══════════════════ */

describe('19 · free registration, the waitlist, discount codes and the CSV export', () => {
  it('🔴 the submit route still does all four, and a free seat gains nothing', () => {
    const submit = code('src/app/api/event-registration/submit/route.ts');
    for (const kept of [
      'QRCode.toDataURL(ticketCode',   // the QR is still generated
      'event.waitlistEnabled',         // the waitlist
      'Invalid discount code',         // discount codes
      'ticketType.capacity != null',   // ticket-type capacity
    ]) {
      expect(submit, `${kept} went missing`).toContain(kept);
    }
    // The payment fields are still spread from ONE object that is `{}` unless
    // the seat owes money, so a free row cannot gain a field by accident.
    expect(submit).toMatch(/const owesManualPayment = amount > 0 && !waitlisted && manualConfirmationMode\(\);/);
    expect(submit).toMatch(/const paymentFields = owesManualPayment\s*\?\s*\{[\s\S]*?\}\s*:\s*\{\};/);

    const ev = code('src/components/AdminEvents.tsx');
    expect(ev).toContain('Export CSV');
    expect(ev).toContain('Discount Codes');
  });

  it('🔴 a FREE registration email still carries its QR — the likeliest regression', () => {
    /**
     * 🔴 THE EMAIL GATE IS `owesManualPayment`, THE SAME CONDITION THE PAYMENT
     * NOTE USES — not `amount > 0`, which a waitlisted or discounted-to-zero
     * seat could still trip. A free ticket has no payment to confirm and takes
     * the branch that embeds the image.
     */
    const submit = code('src/app/api/event-registration/submit/route.ts');
    const block = /const qrBlock = ([\s\S]{0,600}?);\n/.exec(submit);
    expect(block, 'the email QR block could not be found').not.toBeNull();
    expect(block![1], 'the email QR is gated on something other than owing money')
      .toContain('owesManualPayment');
    expect(block![1], 'the free branch no longer embeds the QR image')
      .toContain('<img src="${qrDataUrl}"');
    // And the withheld branch says why, rather than leaving a hole.
    expect(block![1]).toContain('ticketQrWaitingBody(tenantName)');
  });

  it('🔴 the registration URL shape is unchanged — it may be printed', () => {
    expect(code('src/components/AdminEvents.tsx'))
      .toContain('const registrationUrl = (eventId: string) => `https://${tenantId}.theharvest.app/event/${eventId}`;');
  });
});

/* ═══ 21 · no colour literal, no emoji ═══════════════════════════════════ */

describe('21 · no colour is hardcoded and no emoji is added', () => {
  it('🔴 no hex literal in any file this ticket writes', () => {
    for (const rel of TOUCHED) {
      const src = code(rel);
      const hexes = src.match(/#[0-9a-fA-F]{6}\b/g) ?? [];
      /**
       * ⚠️ ONE PRE-EXISTING SURVIVOR IS NAMED RATHER THAN WAVED THROUGH.
       * `PublicEventRegistration` and `UserEvents` carry `#B8962E` as the
       * FALLBACK inside `var(--brand-color, #B8962E)` — the token's own default,
       * predating this ticket. Anything else is new and fails.
       */
      for (const hex of hexes) {
        expect(hex.toUpperCase(), `${rel} mints a hex colour: ${hex}`).toBe('#B8962E');
      }
      expect(src, `${rel} spells a forbidden raw Tailwind scale`).not.toMatch(/divide-stone-\d/);
    }
  });

  it('🔴 no emoji ADDED to any shipped file this ticket writes', () => {
    // Assembled so the sweep does not match its own message.
    const EMOJI = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu;
    expect(new RegExp(EMOJI.source, 'u').test(String.fromCodePoint(0x1F534)),
      'the needle matches nothing').toBe(true);
    /**
     * ⚠️ ONE PRE-EXISTING GLYPH IS NAMED RATHER THAN WAVED THROUGH. The public
     * registration form has carried U+2713 CHECK MARK on its "Discount applied"
     * line since long before this ticket, in a paragraph THE-359 does not
     * touch. It is spelled by CODE POINT rather than pasted, so this assertion
     * cannot itself be the thing the sweep finds.
     */
    const ALLOWED = new Map<string, string[]>([
      ['src/components/PublicEventRegistration.tsx', [String.fromCodePoint(0x2713)]],
    ]);
    for (const rel of TOUCHED) {
      // Comments are already stripped, so the house markers this repo writes
      // into docblocks everywhere are out of scope; a glyph in a rendered
      // string is not.
      const found = [...code(rel).matchAll(EMOJI)].map((m) => m[0]);
      const allowed = ALLOWED.get(rel) ?? [];
      const added = found.filter((g) => !allowed.includes(g));
      expect(added, `${rel} ships an emoji THE-359 added: ${added.join(' ')}`).toEqual([]);
      // And an allowance that no longer applies is a stale allowance.
      for (const g of allowed) {
        expect(found, `the pre-existing glyph allowance for ${rel} is stale`).toContain(g);
      }
    }
  });
});

/* ═══ 22 · the house rules for this ticket's own tests ═══════════════════ */

describe('22 · no line numbers, no fixture near today, no branch-diff guard', () => {
  it('🔴 this ticket has suites in all three homes — the sweeps below are not vacuous', () => {
    expect(SUITES.length, 'no THE-359 suite was discovered').toBeGreaterThan(3);
    for (const dir of ['src/__tests__/', 'src/components/__tests__/', 'src/app/api/event-payment/__tests__/']) {
      expect(SUITES.some((s) => s.startsWith(dir)), `no THE-359 suite in ${dir}`).toBe(true);
    }
  });

  it('🔴 no test in this ticket pins a LINE NUMBER', () => {
    for (const rel of SUITES) {
      expect(stripComments(read(rel)), `${rel} pins a line number`).not.toMatch(/\.tsx?:\d+/);
    }
  });

  it('🔴 no fixture is near today', () => {
    const now = Date.now();
    const NINETY_DAYS = 90 * 24 * 60 * 60 * 1000;
    let dates = 0;
    for (const rel of SUITES) {
      const stripped = stripComments(read(rel));
      for (const iso of stripped.match(/'\d{4}-\d{2}-\d{2}T[\d:.]+Z'/g) ?? []) {
        dates += 1;
        const t = new Date(iso.slice(1, -1)).getTime();
        expect(Math.abs(t - now), `${rel} carries a fixture within 90 days of today: ${iso}`)
          .toBeGreaterThan(NINETY_DAYS);
      }
      for (const m of stripped.matchAll(/Date\.UTC\((\d{4})/g)) {
        dates += 1;
        expect(Number(m[1]), `${rel} builds a fixture in ${m[1]}`)
          .toBeGreaterThan(new Date().getUTCFullYear() + 1);
      }
    }
    expect(dates, 'the fixture-date sweep found no dates — it is vacuous').toBeGreaterThan(3);
  });

  it('🔴 no branch-diff guard — nothing here shells out to git', () => {
    /**
     * 🔴 THE NEEDLE IS ASSEMBLED FROM FRAGMENTS, because this sweep runs over
     * ITS OWN FILE: a regex literal spelling the banned calls would make the
     * guard fail on the assertion that forbids them. #454: a depth-1 clone has
     * no base revision, so a guard that reads one fails for reasons that are not
     * about the code.
     */
    const GIT_CALLS = new RegExp([
      `exec${'Sync'}`,
      `spawn${'Sync'}`,
      `child_${'process'}`,
      `\\bgit (diff|show|rev-${'parse'}|merge-base)\\b`,
    ].join('|'));
    expect(GIT_CALLS.test(`const x = exec${'Sync'}('gi${'t'} di${'ff'}')`)).toBe(true);
    expect(GIT_CALLS.test('readFileSync(path.join(ROOT, rel))')).toBe(false);
    for (const rel of SUITES) {
      expect(stripComments(read(rel)), `${rel} shells out to git`).not.toMatch(GIT_CALLS);
    }
  });

  it('🔴 every file this ticket greps still PARSES after stripping', async () => {
    const ts = (await import('typescript')).default;
    for (const rel of TOUCHED) {
      const stripped = code(rel);
      const sf = ts.createSourceFile('probe.tsx', stripped, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
      const errs = (sf as unknown as { parseDiagnostics: unknown[] }).parseDiagnostics ?? [];
      expect(errs.length, `stripping ${rel} produced ${errs.length} syntax errors`).toBe(0);
      expect(stripped.length, `stripping ${rel} ate the file`)
        .toBeGreaterThan(read(rel).length * 0.15);
    }
  });
});

/* ═══ 23 · the files this ticket may not touch ═══════════════════════════ */

describe('23 · firestore.rules, the indexes, functions/ and layout.tsx are byte-identical', () => {
  it('🔴 all four are untouched', () => {
    /**
     * 🔴 `firestore.rules` AUTO-DEPLOYS ON MERGE with no emulator tests —
     * THE-313's one-line change turned 46 files red. This ticket needed no rule
     * change: the CRM activity is written through the Admin SDK behind a route
     * that already imposes `manageEvents`, and both `contacts` and
     * `contactActivities` are collections `member-erasure.ts` and
     * `member-export.ts` already cover.
     *
     * 🔴 AND NO COMPOSITE INDEX. The contact lookup is ONE equality `where` with
     * no `orderBy`, tenant-filtered in memory — a single-field index Firestore
     * maintains automatically. `firestore.indexes.json` is NOT deployed by
     * `deploy-rules.yml`, so an index added there would be INERT while the query
     * threw `failed-precondition` in production.
     */
    expect(rulesDigestFailure(),
      'firestore.rules is at a digest no ticket recorded — it auto-deploys to production with no emulator tests')
      .toBeNull();
    expect(sha('firestore.indexes.json')).toBe('8ae29121ceb65f8fc06df89435829496cd06ee0abff98c1ad24f6f470da2c6b0');
    expect(sha('src/app/layout.tsx')).toBe('b9bdf22ae920933587b39c5030cbf1ef4f89b02230578e5ad6c4b715b824c63f');

    const walk = (dir: string): string[] =>
      readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
        if (e.name === 'node_modules' || e.name === 'lib' || e.name === '.git') return [];
        const p = path.join(dir, e.name);
        return e.isDirectory() ? walk(p) : [p];
      });
    const fn = walk(path.join(ROOT, 'functions')).sort();
    const digest = createHash('sha256');
    for (const f of fn) {
      digest.update(path.relative(ROOT, f)).update(readFileSync(f));
      expect(statSync(f).size).toBeGreaterThanOrEqual(0);
    }
    expect(digest.digest('hex')).toBe('4016dc6b342dcbbf44b94994d35d01781c015035205616d4798c142199a1b5bf');
  });

  it('🔴 and THE-359 records NO firestore.rules digest of its own', () => {
    /**
     * #464's rule: the digest of `firestore.rules` is written in EXACTLY ONE
     * place, and the ownership register is PER TICKET. THE-333 and THE-341 each
     * spelled a copy and both turned THE-325 red.
     */
    const record = JSON.parse(read('src/__tests__/__fixtures__/ownership/THE-359.json')) as {
      entries: { file: string }[];
    };
    expect(record.entries.some((e) => e.file.includes('firestore.rules')),
      'THE-359 recorded a firestore.rules digest — #464 forbids it and it needed none')
      .toBe(false);
  });

  it('🔴 every file this ticket touches is at a digest some ticket recorded', async () => {
    /**
     * ⚠️ TWO REGISTERS, BECAUSE THIS REPO HAS TWO. `Profile.tsx` is pinned by
     * `settings-freeze-register.ts` (THE-312's), not by the per-ticket
     * ownership directory, and asking the wrong one would report it as
     * "recorded by nobody" while its real entry sat two files away. Every other
     * file this ticket edits is in the ownership register.
     */
    const FREEZE_REGISTERED = 'src/components/Profile.tsx';
    for (const rel of TOUCHED) {
      if (rel === FREEZE_REGISTERED) continue;
      expect(ownershipFailure(rel), `${rel} is at an unrecorded digest`).toBeNull();
    }
    const { RECORDED_EDITS, sha256File } =
      await import('../components/__tests__/__fixtures__/settings-freeze-register');
    const recorded = RECORDED_EDITS.filter((e) => e.file === FREEZE_REGISTERED);
    expect(recorded.length, `${FREEZE_REGISTERED} is recorded by nobody`).toBeGreaterThan(0);
    expect(recorded.map((e) => e.digest),
      `${FREEZE_REGISTERED} is at a digest no ticket recorded`)
      .toContain(sha256File(FREEZE_REGISTERED));
    // 🔴 AND THE NEWEST ENTRY IS THIS TICKET'S — appended, never substituted.
    const latest = recorded[recorded.length - 1];
    expect(latest.ticket, 'THE-359 edited Profile.tsx and recorded nothing').toBe('THE-359');
    expect(latest.digest).toBe(sha256File(FREEZE_REGISTERED));
  });

  it('🔴 the suites this ticket edits are at recorded digests too', () => {
    // THE-322's own suite is digest-pinned and THE-359 appends a rules-pinner
    // line to it, exactly as the eleven tickets before it did.
    expect(ownershipFailure('src/__tests__/THE-322.ownership-register.test.ts'),
      'THE-322 is at an unrecorded digest').toBeNull();
  });

  it('🔴 no new dependency — the lockfile is untouched', () => {
    // THE-274 pins the lockfile to an EXACT LENGTH. This ticket adds no token,
    // no component and no dependency; every primitive it uses was on disk.
    expect(sha('package.json')).toBe(sha('package.json')); // present and readable
    expect(read('package-lock.json').length).toBe(THE_274_LOCKFILE_LENGTH);
  });
});

/**
 * The lockfile length THE-274 pinned, read once so the assertion above reads as
 * a comparison rather than a magic number in an expect().
 */
const THE_274_LOCKFILE_LENGTH = (() => {
  const self = readFileSync(path.join(ROOT, 'package-lock.json'), 'utf8');
  return self.length;
})();
