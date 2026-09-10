import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { stripComments } from './__fixtures__/the-346-strip-comments';
import { rulesDigestFailure } from './__fixtures__/firestore-rules-pin';
import { ownershipFailure } from './__fixtures__/ownership-register';

/**
 * THE-351 · 🔴 THE WORDS, THE GATES AND THE FILES THIS TICKET MAY NOT TOUCH.
 *
 * ═════════════════════════════════════════════════════════════════════════════
 * 🔴 EVERY CONTENT GREP HERE RUNS OVER COMMENT-STRIPPED SOURCE.
 *
 * #490's parser-driven stripper, reused. Thirteen guards in this series passed a
 * planted defect and the recorded causes include "one read a docblock 700 lines
 * away" and "one passed with its own gate DELETED because the assertion's
 * message contained the string it grepped for". A prose-bearing repository like
 * this one CANNOT be grepped raw: this very file talks about "payment received"
 * in order to forbid it.
 *
 * 🔴 AND NOTHING IS PINNED TO A LINE NUMBER. Every surface is found by pattern,
 * and a pattern that finds nothing THROWS rather than measuring a default.
 */

const ROOT = process.cwd();
const read = (rel: string) => readFileSync(path.join(ROOT, rel), 'utf8');
const code = (rel: string) => stripComments(read(rel));
const sha = (rel: string) => createHash('sha256').update(readFileSync(path.join(ROOT, rel))).digest('hex');

/** Every file THE-351 adds or edits that carries user-facing behaviour. */
const OWNED = [
  'src/lib/event-payment-claims.ts',
  'src/lib/event-payment-notify.ts',
  'src/app/api/event-payment/claim/route.ts',
  'src/app/api/event-payment/inbox/route.ts',
  'src/app/api/event-payment/confirm/route.ts',
  'src/components/inbox/TenantInbox.tsx',
  'src/components/inbox/payment-claims-client.ts',
] as const;

const TOUCHED = [
  ...OWNED,
  'src/lib/paid-events-feature.ts',
  'src/components/AdminEvents.tsx',
  'src/components/UserEvents.tsx',
  'src/components/AdminDashboard.tsx',
  'src/components/PublicEventRegistration.tsx',
  'src/app/api/event-registration/submit/route.ts',
  'src/app/api/my-registrations/route.ts',
  'src/hooks/queries/useEventQueries.ts',
] as const;

/* ═══ 13 · no UI text implies Harvest verified anything ═══════════════════ */

describe('13 · no UI text implies Harvest verified anything', () => {
  it('🔴 every exported string in the copy module is clean', async () => {
    const mod = await import('@/lib/event-payment-claims');
    const { claimsVerification } = mod;

    const checked: string[] = [];
    for (const [name, value] of Object.entries(mod)) {
      if (typeof value === 'string') {
        // ⚠️ The forbidden list ITSELF is a string array in this module and is
        // skipped by name — a list of banned phrases necessarily contains them.
        if (name === 'FORBIDDEN_CLAIM_PHRASES') continue;
        checked.push(name);
        const bad = claimsVerification(value);
        expect(bad, `${name} claims "${bad}" — Harvest verified nothing`).toBeNull();
      }
    }
    // 🔴 VACUITY GUARD. Two of the thirteen guards in this series were vacuous
    // because an empty slice made them trivially true. If this module ever stops
    // exporting its copy as strings, this case must go red rather than pass on
    // an empty loop.
    expect(checked.length, 'the copy sweep checked NOTHING').toBeGreaterThan(15);
  });

  it('🔴 and every string built by its functions is clean too', async () => {
    const m = await import('@/lib/event-payment-claims');
    const built = [
      m.memberUnpaidBody('Grace Chapel', 5000, 'HV-4KTM9P'),
      m.memberClaimedBody('Grace Chapel', 'HV-4KTM9P'),
      m.memberConfirmedBody('Grace Chapel', '2031-09-07T09:00:00.000Z'),
      m.claimEmailSubject('Autumn Retreat'),
      m.claimEmailBody({
        memberName: 'Dana Okafor', eventTitle: 'Autumn Retreat', amountCents: 5000,
        reference: 'HV-4KTM9P', providerLabel: 'Revolut', inboxUrl: 'https://grace.theharvest.app/admin',
      }),
      m.claimPushBody('Dana Okafor', 'Autumn Retreat', 5000),
      m.inboxRowSummary({
        kind: 'event_payment_claim', id: 'r1', memberName: 'Dana Okafor',
        memberEmail: 'dana@example.com', eventTitle: 'Autumn Retreat', amountCents: 5000,
        reference: 'HV-4KTM9P', providerId: 'revolut', providerLabel: 'Revolut',
        claimedAt: '2031-09-05T10:00:00.000Z',
      }),
    ];
    expect(built.length, 'the built-string sweep checked NOTHING').toBeGreaterThan(6);
    for (const s of built) {
      const bad = m.claimsVerification(s);
      expect(bad, `a built string claims "${bad}": ${s}`).toBeNull();
    }
  });

  it('🔴 and no JSX STRING LITERAL in the feature’s own components does either', async () => {
    const { claimsVerification } = await import('@/lib/event-payment-claims');
    // ⚠️ COMMENT-STRIPPED. These files argue about the forbidden phrases at
    // length in prose; a raw grep would flag the argument and not the copy.
    const surfaces = [
      'src/components/inbox/TenantInbox.tsx',
      'src/components/UserEvents.tsx',
    ];
    let literals = 0;
    for (const rel of surfaces) {
      const stripped = code(rel);
      // Every quoted string and every run of JSX text.
      const found = [
        ...(stripped.match(/'[^'\n]{4,}'|"[^"\n]{4,}"/g) ?? []),
        ...(stripped.match(/>[^<>{}\n]{8,}</g) ?? []),
      ];
      literals += found.length;
      for (const lit of found) {
        const bad = claimsVerification(lit);
        expect(bad, `${rel} says "${bad}" — Harvest verified nothing`).toBeNull();
      }
    }
    expect(literals, 'the JSX sweep found no literals at all — it is vacuous')
      .toBeGreaterThan(20);
  });

  it('🔴 and the public event page says it ONLY where a rail really did confirm', () => {
    /**
     * ─── THE ONE PLACE "Payment received" IS TRUE, AND IT IS NOT THIS TICKET'S ─
     *
     * `PublicEventRegistration` carries "Payment received — you're registered!"
     * on the branch a payer lands on RETURNING FROM STRIPE CHECKOUT
     * (`postPayment === 'success'`). There, a rail really did take the money and
     * really did tell Harvest so, and the sentence is the truth. It is also
     * UNREACHABLE under manual confirmation — the submit route never enters the
     * payment branch, so nobody is ever sent to Checkout — and deleting a true
     * sentence from a dormant rail path would be this ticket vandalising
     * somebody else's feature on its way past.
     *
     * 🔴 SO THE CLAIM IS POSITIONAL RATHER THAN ABSENT: the forbidden phrases
     * may appear in that branch and NOWHERE ELSE in the file. A "Payment
     * received" that appeared in THE-351's own note below — or anywhere after
     * it — fails here.
     */
    const stripped = code('src/components/PublicEventRegistration.tsx');
    const railBranch = stripped.indexOf("if (postPayment === 'success')");
    const railBranchEnd = stripped.indexOf("if (postPayment === 'cancel')");
    expect(railBranch, 'the Stripe-return branch could not be found').toBeGreaterThan(-1);
    expect(railBranchEnd).toBeGreaterThan(railBranch);

    const outside = stripped.slice(0, railBranch) + stripped.slice(railBranchEnd);
    const phrases = ['payment received', 'payment complete', 'verified', 'confirmed by harvest'];
    for (const phrase of phrases) {
      expect(outside.toLowerCase(), `the public page says "${phrase}" outside the Stripe-return branch`)
        .not.toContain(phrase);
    }
    // And THE-351's own note is one of the things "outside" covers.
    expect(outside, 'THE-351’s payment note is not on this page at all')
      .toContain('data-public-payment-note');
  });

  it('🔴 the forbidden list is not empty and each entry is a real claim', async () => {
    const { FORBIDDEN_CLAIM_PHRASES, claimsVerification } = await import('@/lib/event-payment-claims');
    expect(FORBIDDEN_CLAIM_PHRASES.length).toBeGreaterThanOrEqual(8);
    // Each one is actually caught — a list nothing matches guards nothing.
    for (const phrase of FORBIDDEN_CLAIM_PHRASES) {
      expect(claimsVerification(`Your ${phrase} today`), `${phrase} is not caught`).toBe(phrase);
    }
    // ⚠️ AND `confirm` ALONE IS NOT BANNED. It is the correct verb for what the
    // CHURCH does and the founder's own word for the button; banning it would
    // leave the feature unable to name its central act.
    expect(claimsVerification('Confirm this payment once you have found it')).toBeNull();
    expect(claimsVerification('the church confirms')).toBeNull();
  });
});

/* ═══ 1 / 2 · provider selection ══════════════════════════════════════════ */

describe('1 · an admin chooses WHICH providers accept payment for an event', () => {
  it('the selection is a SUBSET of the church’s own configured links', async () => {
    const { resolveEventPaymentLinks, readEventProviderIds } = await import('@/lib/event-payment-claims');
    const { GIVING_PROVIDERS } = await import('@/components/donations/giving-providers');
    const linkFor = (id: string) => ({
      provider: GIVING_PROVIDERS.find((p) => p.id === id)!,
      url: `https://example.test/${id}`, handle: null, email: null,
    });
    const church = [linkFor('paypal'), linkFor('revolut'), linkFor('wise')];

    // "just PayPal" — the founder's own example.
    expect(resolveEventPaymentLinks(church, ['paypal']).map((l) => l.provider.id)).toEqual(['paypal']);
    // "just revolut"
    expect(resolveEventPaymentLinks(church, ['revolut']).map((l) => l.provider.id)).toEqual(['revolut']);
    // "or all of them"
    expect(resolveEventPaymentLinks(church, ['paypal', 'revolut', 'wise']).map((l) => l.provider.id))
      .toEqual(['paypal', 'revolut', 'wise']);

    // 🔴 IT CAN ONLY EVER NARROW. A provider the church does NOT publish cannot
    // be conjured onto a ticket by an event document.
    expect(resolveEventPaymentLinks(church, ['cashapp']).map((l) => l.provider.id))
      .toEqual(['paypal', 'revolut', 'wise']);
    // And an unknown id is dropped rather than rendered as an empty tile.
    expect(readEventProviderIds(['paypal', 'bitcoin', 42, null])).toEqual(['paypal']);
    // Order is the TABLE's, never the stored array's — a giving surface that
    // moves between visits is one a member cannot learn.
    expect(readEventProviderIds(['wise', 'paypal'])).toEqual(['paypal', 'wise']);
  });

  it('🔴 an empty selection means every link the church publishes, never none', async () => {
    const { resolveEventPaymentLinks } = await import('@/lib/event-payment-claims');
    const { GIVING_PROVIDERS } = await import('@/components/donations/giving-providers');
    const church = [{ provider: GIVING_PROVIDERS[0], url: 'https://paypal.me/x', handle: null, email: null }];
    // An event created before this field existed must not render a paid ticket
    // with NOWHERE TO PAY — the one state this feature may never produce.
    expect(resolveEventPaymentLinks(church, undefined)).toHaveLength(1);
    expect(resolveEventPaymentLinks(church, [])).toHaveLength(1);
  });

  it('2 · a church with NO links is told plainly rather than silently blocked', async () => {
    const { NO_LINKS_TITLE, NO_LINKS_BODY } = await import('@/lib/event-payment-claims');
    const { GIVING_PROVIDER_NAMES_OR } = await import('@/components/donations/giving-providers');
    expect(NO_LINKS_TITLE.length).toBeGreaterThan(20);
    // It names WHERE to fix it and the providers by the table, not by hand.
    expect(NO_LINKS_BODY).toContain(GIVING_PROVIDER_NAMES_OR);
    expect(NO_LINKS_BODY).toMatch(/Donations/);
    // And it says registration is unaffected — THE-345's lesson: a notice that
    // says only "you cannot charge" reads as "events are broken".
    expect(NO_LINKS_BODY).toMatch(/registration/i);
    // The screen renders it, and the price input is ABSENT in that state.
    const ev = code('src/components/AdminEvents.tsx');
    expect(ev).toMatch(/data-paid-events-gate="no-links"/);
    expect(ev, 'the price input is not gated on the church having a link')
      .toMatch(/canPriceTickets\s*=\s*ticketPricingAvailable\(\)\s*&&\s*\(PAID_EVENTS_ENABLED\s*\|\|\s*churchLinks\.length\s*>\s*0\)/);
  });
});

/* ═══ 3 · the creation disclaimer ═════════════════════════════════════════ */

describe('3 · the creation disclaimer is present and unsoftened', () => {
  it('🔴 says all three things, in the words the founder can check', async () => {
    const { CREATION_DISCLAIMER_TITLE, CREATION_DISCLAIMER_BODY } = await import('@/lib/event-payment-claims');

    // Quoted here so a reviewer reads the shipped sentence and not a paraphrase.
    expect(CREATION_DISCLAIMER_TITLE).toBe('You will confirm every payment by hand');
    expect(CREATION_DISCLAIMER_BODY).toBe(
      'Harvest cannot take card payments and cannot check whether anyone has paid. '
      + 'People register straight away and are marked unpaid. They pay your church '
      + 'directly through the links you tick below, and then you open that account '
      + 'yourself, find the payment by its reference, and confirm it here. '
      + 'Until you do, the ticket reads unpaid — and anyone holding an unpaid '
      + 'ticket is still let in at the door.',
    );

    // 🔴 UNSOFTENED, asserted as properties rather than as one string, so a
    // reword that keeps the meaning passes and one that hedges does not.
    expect(CREATION_DISCLAIMER_BODY, 'the disclaimer never says Harvest cannot check')
      .toMatch(/cannot check whether anyone has paid/);
    expect(CREATION_DISCLAIMER_BODY, 'it never says the ADMIN does the confirming')
      .toMatch(/you open that account yourself/);
    expect(CREATION_DISCLAIMER_BODY, 'it never warns that an unconfirmed guest still gets in')
      .toMatch(/still let in at the door/);
    expect(CREATION_DISCLAIMER_BODY, 'it has been softened with a hedge')
      .not.toMatch(/\b(usually|generally|in most cases|should normally)\b/i);
  });

  it('🔴 and it is rendered as an ALERT above the pricing, not as a footnote', () => {
    const ev = code('src/components/AdminEvents.tsx');
    // Found by pattern; a pattern that finds nothing fails.
    expect(ev, 'the disclaimer is not rendered at all').toMatch(/data-manual-payment-disclaimer/);
    expect(ev).toMatch(/<AlertTitle>\{CREATION_DISCLAIMER_TITLE\}<\/AlertTitle>/);
    expect(ev).toMatch(/<AlertDescription>\{CREATION_DISCLAIMER_BODY\}<\/AlertDescription>/);
    // 🔴 It stands BEFORE the provider picker and the ticket-type price, which
    // is what makes "before publishing" true rather than aspirational.
    const discl = ev.indexOf('data-manual-payment-disclaimer');
    const picker = ev.indexOf('data-event-provider-picker');
    expect(picker, 'the provider picker is gone').toBeGreaterThan(-1);
    expect(discl, 'the disclaimer sits BELOW the provider picker').toBeLessThan(picker);
    // And it is not hidden behind a hover.
    expect(ev, 'the disclaimer was demoted into a tooltip')
      .not.toMatch(/Tooltip[\s\S]{0,200}CREATION_DISCLAIMER/);
  });
});

/* ═══ 12b · the CSV column ════════════════════════════════════════════════ */

describe('15 · the CSV Amount column means something true for an unconfirmed row', () => {
  it('🔴 a claim is NOT a confirmation, and neither exports as a figure', async () => {
    const { csvAmountCell, NOT_CONFIRMED_LABEL } = await import('@/lib/paid-events-feature');
    expect(csvAmountCell(5000, 'unconfirmed')).toBe(NOT_CONFIRMED_LABEL);
    expect(csvAmountCell(5000, 'unconfirmed'), 'the export named a figure nobody vouched for')
      .not.toMatch(/\d/);
    // A CONFIRMED row exports the money, formatted from CENTS.
    expect(csvAmountCell(5000, 'confirmed')).toBe('$50.00');
    // A genuinely free registration is unchanged in every configuration.
    expect(csvAmountCell(0, 'unconfirmed')).toBe('$0');
    expect(csvAmountCell(0)).toBe('$0');
  });

  it('and the REAL export is wired to the row’s state, not to a constant', () => {
    const ev = code('src/components/AdminEvents.tsx');
    expect(ev, 'the CSV does not consult the row’s payment state at all')
      .toMatch(/csvAmountCell\(r\.amount,\s*paymentStateOf\(r\)\s*===\s*'confirmed'\s*\?\s*'confirmed'\s*:\s*'unconfirmed'\)/);
  });
});

/* ═══ 14 · check-in NEVER blocks on payment ═══════════════════════════════ */

describe('14 · an unconfirmed registration still gets the guest in at check-in', () => {
  it('🔴 the Check In control is gated on REGISTRATION status and nothing else', () => {
    const ev = code('src/components/AdminEvents.tsx');
    /**
     * 🔴 THE FOUNDER'S DECISION: LET THEM IN, FLAGGED. "Turning a paying guest
     * away because an admin had not tapped a button is the worst outcome this
     * ticket could produce, and it must be impossible."
     *
     * Located by PATTERN — the `checkIn(` call and the condition that guards
     * it — never by line number.
     */
    const m = /\{([^{}]*)&&\s*\(\s*<button\s+onClick=\{\(\)\s*=>\s*checkIn\(r\)\}/.exec(ev);
    expect(m, 'the Check In button could not be found — the markup changed').not.toBeNull();
    const condition = m![1];
    expect(condition.replace(/\s+/g, ' ').trim()).toBe("r.status === 'confirmed'");
    for (const word of ['payment', 'paid', 'Invoice', 'confirmedAt']) {
      expect(condition, `🔴 CHECK-IN NOW BLOCKS ON ${word} — a paying guest is turned away`)
        .not.toContain(word);
    }
  });

  it('🔴 and `checkIn` itself writes only the registration status', () => {
    const ev = code('src/components/AdminEvents.tsx');
    const m = /const checkIn = async \(reg: Registration\) => \{([\s\S]*?)\n  \};/.exec(ev);
    expect(m, 'checkIn could not be found').not.toBeNull();
    expect(m![1]).toContain("{ status: 'attended' }");
    expect(m![1], 'check-in reads or writes payment state').not.toMatch(/payment/i);
  });

  it('14b · the volunteer sees the flag, and it names the RECORD rather than the person', async () => {
    const { DOOR_UNCONFIRMED_BADGE, DOOR_UNCONFIRMED_HELP } = await import('@/lib/event-payment-claims');
    expect(DOOR_UNCONFIRMED_BADGE).toBe('Payment not confirmed');
    expect(DOOR_UNCONFIRMED_HELP).toBe(
      'Let them in. Nobody at the church has marked this one paid yet — sort it out '
      + 'afterwards, not at the door.',
    );
    // 🔴 Enough to act on: the instruction is the first two words.
    expect(DOOR_UNCONFIRMED_HELP.startsWith('Let them in.')).toBe(true);
    // 🔴 And not enough to embarrass: it never says the PERSON has not paid.
    for (const accusation of ["hasn't paid", 'has not paid', 'unpaid guest', 'did not pay', 'no payment received']) {
      expect(`${DOOR_UNCONFIRMED_BADGE} ${DOOR_UNCONFIRMED_HELP}`.toLowerCase())
        .not.toContain(accusation.toLowerCase());
    }
    // It is rendered BESIDE the Check In control, never in place of it.
    const ev = code('src/components/AdminEvents.tsx');
    expect(ev).toMatch(/data-door-payment="unconfirmed"/);
    expect(ev.indexOf('data-door-payment="unconfirmed"'))
      .toBeLessThan(ev.indexOf('onClick={() => checkIn(r)}'));
  });
});

/* ═══ 16 / 17 / 18 · no regression ════════════════════════════════════════ */

describe('16-18 · free registration, the URL shape and the engine are unaffected', () => {
  it('🔴 16 · a free registration acquires none of this vocabulary', () => {
    const submit = code('src/app/api/event-registration/submit/route.ts');
    // The payment fields are spread from ONE object that is `{}` unless the
    // seat owes money, so a free row cannot gain a field by accident.
    expect(submit).toMatch(/const owesManualPayment = amount > 0 && !waitlisted && manualConfirmationMode\(\);/);
    expect(submit).toMatch(/const paymentFields = owesManualPayment\s*\?\s*\{[\s\S]*?\}\s*:\s*\{\};/);
    // And THE-256's three bypasses are byte-identical in meaning: free,
    // waitlisted and discounted-to-zero never reach the question.
    expect(submit).toMatch(/const requiresPayment = amount > 0 && !waitlisted && !manualConfirmationMode\(\);/);
  });

  it('🔴 17 · the registration URL shape is unchanged — it may be printed', () => {
    const ev = code('src/components/AdminEvents.tsx');
    expect(ev).toContain('const registrationUrl = (eventId: string) => `https://${tenantId}.theharvest.app/event/${eventId}`;');
  });

  it('18 · the QR flow, waitlist, discount codes and capacity are all still there', () => {
    const submit = code('src/app/api/event-registration/submit/route.ts');
    for (const kept of [
      'QRCode.toDataURL(ticketCode',            // the QR
      "event.waitlistEnabled",                  // the waitlist
      'Invalid discount code',                  // discount codes
      'ticketType.capacity != null',            // capacity
    ]) {
      expect(submit, `${kept} went missing`).toContain(kept);
    }
    const ev = code('src/components/AdminEvents.tsx');
    expect(ev).toContain('Export CSV');
    expect(ev).toContain('Discount Codes');
  });
});

/* ═══ 21 · GDPR ═══════════════════════════════════════════════════════════ */

describe('21 · erasure and export handle an inbox item and a confirmed registration', () => {
  it('🔴 an inbox item IS a registration, so both GDPR paths already cover it', () => {
    /**
     * 🔴 THE REASON THE INBOX IS NOT A NEW COLLECTION. A claim and its
     * confirmation are FIELDS on `tenants/{t}/registrations/{id}` — the document
     * `member-erasure.ts` already DELETES by uid and by email, and
     * `member-export.ts` already exports WHOLE. A separate collection would have
     * been the tenth thing to remember in each and the first one forgotten.
     */
    const erasure = code('src/lib/member-erasure.ts');
    expect(erasure).toMatch(/collection\('registrations'\)/);
    expect(erasure).toMatch(/deleteByQuery\(\s*coll\.where\('userId', '==', assertConcreteScope\(ctx\.uid, 'uid'\)\),\s*\)/);
    expect(erasure).toMatch(/coll\.where\('email', '==', assertConcreteScope\(ctx\.email, 'email'\)\)/);

    const exporter = code('src/lib/member-export.ts');
    expect(exporter).toMatch(/collection\('registrations'\)/);
    // `whole` — every field on the document, so the new payment fields are
    // exported with no edit and cannot be forgotten.
    expect(exporter).toMatch(/pageQuery\(coll\.where\('userId', '==', assertConcreteScope\(ctx\.uid, 'uid'\)\), budget, whole\)/);

    // 🔴 AND THIS TICKET ADDS NO COLLECTION EITHER PATH WOULD HAVE TO LEARN.
    for (const rel of OWNED) {
      const src = code(rel);
      const collections = [...src.matchAll(/\.collection\(\s*['"]([a-zA-Z_]+)['"]\s*\)/g)].map((m) => m[1]);
      for (const c of collections) {
        expect(['tenants', 'registrations', 'events', 'users', 'invoices'],
          `${rel} reaches a collection no GDPR path knows about: ${c}`).toContain(c);
      }
    }
  });

  it('🔴 a confirmed registration’s INVOICE is church-owned, and THE-350 says so', () => {
    // The erasure anonymises `invoices` rather than deleting them — a tax record
    // is the church's, not the member's — and THE-350 records `recordedBy` as
    // the ADMIN's uid, in the class of field the erasure already declares out of
    // scope. This ticket writes nothing new onto that document.
    const md = code('src/lib/manual-donation.ts');
    expect(md).toMatch(/recordedBy:/);
    const confirm = code('src/app/api/event-payment/confirm/route.ts');
    expect(confirm, 'the confirm route writes its own invoice fields')
      .not.toMatch(/recipientEmail:/);
  });
});

/* ═══ 23 / 24 / 25 · the house rules ══════════════════════════════════════ */

describe('23-25 · the house rules', () => {
  it('🔴 no emoji in any file this ticket owns or edits', () => {
    /**
     * The pictograph ranges, over COMMENT-STRIPPED source — so the house
     * markers this repo writes into docblocks everywhere are out of scope and
     * a glyph in a rendered string is not.
     *
     * ⚠️ A CLOSED RECORD PER EDITED FILE, NOT "none", and the shape is
     * THE-346's for the same reason: two of the files this ticket touches
     * already shipped a glyph before it, so a blanket ban would fail on
     * somebody else's work while proving nothing about this ticket's. Every
     * file THE-351 ADDS is recorded at ZERO, which is the stronger claim and
     * the one it can actually make.
     */
    const EMOJI = /[\u{1F300}-\u{1FAFF}\u{2190}-\u{21FF}\u{2600}-\u{27BF}\u{FE0F}]/gu;
    const PRE_EXISTING: Record<string, readonly string[]> = {
      // The discount-applied confirmation's tick, on the public registration
      // page. It predates this ticket and is not its to remove.
      'src/components/PublicEventRegistration.tsx': ['✓'],
    };
    let checked = 0;
    for (const rel of TOUCHED) {
      checked += 1;
      const found = code(rel).match(EMOJI) ?? [];
      expect(found, `${rel} ships an emoji`).toEqual(PRE_EXISTING[rel] ?? []);
    }
    expect(checked, 'the emoji sweep checked nothing').toBe(TOUCHED.length);
  });

  it('🔴 no colour literal and no raw Tailwind scale in the files this ticket ADDS', () => {
    const LITERAL = /#[0-9a-fA-F]{3,8}\b|\brgba?\(|\bhsla?\(/g;
    // ⚠️ The RAW Tailwind palette scale — `text-red-500`, `bg-blue-100`. The
    // repo's own semantic families (`field`, `wheat`, `surface`, `gold`,
    // `line`, `strong`, `muted`, `faint`, `body`, `brand`, `danger`) are the
    // palette and are what these files spend.
    const RAW_SCALE = /\b(?:bg|text|border|ring|from|to|via)-(?:red|blue|green|yellow|purple|pink|indigo|gray|grey|slate|zinc|neutral|stone|amber|orange|lime|emerald|teal|cyan|sky|violet|fuchsia|rose)-\d{2,3}\b/g;
    for (const rel of OWNED) {
      const stripped = code(rel);
      expect(stripped.match(LITERAL) ?? [], `${rel} mints a colour literal`).toEqual([]);
      expect(stripped.match(RAW_SCALE) ?? [], `${rel} spends a raw Tailwind scale`).toEqual([]);
    }
  });

  it('🔴 and no file this ticket ADDS mints a raw pixel height', () => {
    /**
     * Rule 4's band is `form-layout.ts`'s to own, and THE-345's own sweep says
     * so for the files it touched. THE-351's new files are held to the stronger
     * claim — ZERO — because they are new: every control carries `min-h-11`
     * (44px off the spacing scale) below `sm` and spends
     * `CONTROL_DENSITY.action` above it, so a `sm:h-[39px]` written by hand
     * fails here rather than quietly inventing a density beside the module's.
     */
    for (const rel of OWNED) {
      const found = [...code(rel).matchAll(/(?:min-)?h-\[(\d+)px\]/g)].map((m) => m[0]);
      expect(found, `${rel} mints a raw pixel height`).toEqual([]);
    }
    // And the two that DO spend the shared token really do spend it — an
    // absence alone would also be satisfied by a control with no height rule.
    for (const rel of ['src/components/inbox/TenantInbox.tsx', 'src/components/UserEvents.tsx']) {
      expect(code(rel), `${rel} stopped spending the shared control density`)
        .toMatch(/CONTROL_DENSITY\.action/);
    }
  });

  it('🔴 24 · no test in this ticket pins a LINE NUMBER', () => {
    const suites = [
      'src/__tests__/THE-351.manual-payment.guards.test.ts',
      'src/app/api/event-payment/__tests__/confirm-route.test.ts',
      'src/app/api/event-payment/__tests__/claim-and-inbox-routes.test.ts',
      'src/components/__tests__/THE-351.manual-payment.ui.test.tsx',
      'src/components/__tests__/THE-351.member-and-inbox.test.tsx',
      'src/components/__tests__/THE-351.inbox.layout.test.tsx',
    ];
    expect(suites.length, 'the line-number sweep is vacuous').toBeGreaterThan(4);
    for (const rel of suites) {
      const stripped = stripComments(read(rel));
      // `AdminEvents.tsx:491` — the shape THE-331's first draft used and that a
      // deletion silently re-aimed at whatever landed there.
      expect(stripped, `${rel} pins a line number`)
        .not.toMatch(/\.tsx?:\d+/);
    }
  });

  it('🔴 24b · no fixture is near today, and time is faked where it is read', () => {
    const suites = [
      'src/app/api/event-payment/__tests__/confirm-route.test.ts',
      'src/app/api/event-payment/__tests__/claim-and-inbox-routes.test.ts',
      'src/components/__tests__/THE-351.manual-payment.ui.test.tsx',
      'src/components/__tests__/THE-351.member-and-inbox.test.tsx',
    ];
    const now = Date.now();
    const NINETY_DAYS = 90 * 24 * 60 * 60 * 1000;
    let dates = 0;
    for (const rel of suites) {
      const stripped = stripComments(read(rel));
      for (const iso of stripped.match(/'\d{4}-\d{2}-\d{2}T[\d:.]+Z'/g) ?? []) {
        dates += 1;
        const t = new Date(iso.slice(1, -1)).getTime();
        expect(Math.abs(t - now), `${rel} carries a fixture within 90 days of today: ${iso}`)
          .toBeGreaterThan(NINETY_DAYS);
      }
    }
    expect(dates, 'the fixture-date sweep found no dates — it is vacuous').toBeGreaterThan(4);
  });

  it('🔴 24c · no branch-diff guard — nothing here shells out to git', () => {
    const suites = readdirSync(path.join(ROOT, 'src/__tests__'))
      .filter((f) => f.startsWith('THE-351.'))
      .map((f) => `src/__tests__/${f}`)
      .concat(
        readdirSync(path.join(ROOT, 'src/components/__tests__'))
          .filter((f) => f.startsWith('THE-351.'))
          .map((f) => `src/components/__tests__/${f}`),
        readdirSync(path.join(ROOT, 'src/app/api/event-payment/__tests__'))
          .map((f) => `src/app/api/event-payment/__tests__/${f}`),
      );
    expect(suites.length, 'no THE-351 suite was found — this guard is vacuous')
      .toBeGreaterThan(3);
    /**
     * 🔴 THE NEEDLE IS ASSEMBLED FROM FRAGMENTS, AND THAT IS NOT CLEVERNESS.
     *
     * This sweep runs over ITS OWN FILE, so a regex literal spelling the banned
     * calls would make the guard fail on the assertion that forbids them —
     * which is card 86bbxkawp's failure mode from the other side: "one passed
     * with its own gate DELETED because the assertion's message contained the
     * string it grepped for". Joining the halves means this file never spells
     * any of them, so the sweep measures the SUITES and not the sentence about
     * the suites.
     *
     * #454: a depth-1 clone has no base revision, so a guard that reads one
     * fails for reasons that are not about the code.
     */
    const GIT_CALLS = new RegExp([
      `exec${'Sync'}`,
      `spawn${'Sync'}`,
      `child_${'process'}`,
      `\\bgit (diff|show|rev-${'parse'}|merge-base)\\b`,
    ].join('|'));
    // The needle really does catch what it claims to — a pattern that matches
    // nothing would pass every file in the list.
    expect(GIT_CALLS.test(`const x = exec${'Sync'}('gi${'t'} di${'ff'}')`)).toBe(true);
    expect(GIT_CALLS.test('readFileSync(path.join(ROOT, rel))')).toBe(false);

    for (const rel of suites) {
      const stripped = stripComments(read(rel));
      expect(stripped, `${rel} shells out to git`).not.toMatch(GIT_CALLS);
    }
  });

  it('🔴 25 · firestore.rules, the indexes, functions/ and layout.tsx are byte-identical', () => {
    /**
     * 🔴 THE STOP CONDITIONS, ASSERTED. `firestore.rules` AUTO-DEPLOYS on merge
     * with no emulator tests; `firestore.indexes.json` is NOT deployed at all,
     * so an index added there would be INERT while the query threw
     * `failed-precondition` in production. This ticket needed neither, and the
     * reason is structural: the inbox derives from a collection whose rule
     * already exists, and its query filters and orders on the SAME field.
     */
    /**
     * 🔴 ASKED THROUGH THE SHARED REGISTER, NOT SPELLED HERE.
     *
     * THE-325's rule: the digest of `firestore.rules` is written in EXACTLY ONE
     * place, so a real rules change costs one edit rather than one per suite
     * that pinned it. THE-333 and THE-341 each spelling a copy is what turned
     * THE-325 red, twice. THE-351 records NO rules digest of its own — it
     * needed no rules change, and the reason is structural rather than lucky
     * (see the note below).
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

  it('🔴 and THE-351 recorded NO firestore.rules digest of its own', () => {
    /**
     * 🔴 THE TICKET'S STOP CONDITION 2, ANSWERED STRUCTURALLY.
     *
     * A per-tenant inbox is the shape that usually needs a rule: a new
     * collection, scoped to one church, readable by its admins. This one needed
     * none, because it is NOT A NEW COLLECTION — a claim and its confirmation
     * are FIELDS on `tenants/{t}/registrations/{id}`, whose read rule already
     * says `isAuthenticated() && (isTenantAdmin(tenantId) || …)` with the tenant
     * taken from the PATH.
     *
     * ⚠️ AND THE WRITE SIDE NEEDED NONE EITHER, for THE-350's reason one layer
     * along: the registration UPDATE rule requires `manageEvents`, which a
     * MEMBER pressing "I've paid" does not hold — so rather than loosen a rule
     * on a document carrying a money amount, in a file that AUTO-DEPLOYS with
     * no emulator tests, the write goes through the Admin SDK behind a route
     * that imposes an ownership check of its own, and that check is STRICTER
     * than the rule would have been (the caller must match the registration by
     * verified uid or verified token email).
     *
     * So the rule is ASSERTED AS IT STANDS, above and in the claim/inbox suite,
     * and this ticket's ownership record names no rules digest at all.
     */
    const record = readFileSync(
      path.join(ROOT, 'src/__tests__/__fixtures__/ownership/THE-351.json'), 'utf8',
    );
    expect(JSON.parse(record).entries.some((e: { file: string }) => e.file.includes('firestore.rules')),
      'THE-351 recorded a firestore.rules digest — #464 forbids it and it needed none')
      .toBe(false);
  });

  it('🔴 every file this ticket touches is at a digest THE-351 recorded', () => {
    // The shared per-ticket ownership register (#464), which is how "APPEND,
    // never substitute" is enforced across tickets that land in either order.
    for (const rel of TOUCHED) {
      const failure = ownershipFailure(rel);
      if (failure !== null) {
        // Only files some ticket already pins are in the register; one that is
        // not pinned at all answers `null` and is not this guard's business.
        expect(failure, `${rel} is at an unrecorded digest`).toBeNull();
      }
    }
  });

  it('🔴 no new npm dependency — THE-274 pins the lockfile to an EXACT length', () => {
    const pkg = JSON.parse(read('package.json'));
    const names = [...Object.keys(pkg.dependencies ?? {}), ...Object.keys(pkg.devDependencies ?? {})];
    // Every import this ticket's own files make resolves to a package already
    // here, or to a relative path.
    for (const rel of OWNED) {
      for (const m of code(rel).matchAll(/from\s+['"]([^'".][^'"]*)['"]/g)) {
        const spec = m[1];
        if (spec.startsWith('@/') || spec.startsWith('.')) continue;
        const pkgName = spec.startsWith('@') ? spec.split('/').slice(0, 2).join('/') : spec.split('/')[0];
        if (pkgName.startsWith('node:')) continue;
        expect(names, `${rel} imports ${pkgName}, which is not a dependency`).toContain(pkgName);
      }
    }
  });
});

/* ═══ THE-345's gate ══════════════════════════════════════════════════════ */

describe('THE-345’s gate became "manual confirmation", and was not deleted', () => {
  it('🔴 the rail switch is untouched and still false', async () => {
    const { PAID_EVENTS_ENABLED, MANUAL_EVENT_PAYMENTS_ENABLED, manualConfirmationMode, ticketPricingAvailable } =
      await import('@/lib/paid-events-feature');
    // Harvest still cannot PROCESS a payment. Nothing about that changed.
    expect(PAID_EVENTS_ENABLED).toBe(false);
    // A church may now be paid for a ticket, outside Harvest, by hand.
    expect(MANUAL_EVENT_PAYMENTS_ENABLED).toBe(true);
    expect(manualConfirmationMode()).toBe(true);
    expect(ticketPricingAvailable()).toBe(true);
  });

  it('🔴 and neither proposition implies the other', async () => {
    // Two values, two lines — THE-345's own argument for not reusing
    // STRIPE_CONNECT_ENABLED, applied to the switch it created.
    const src = code('src/lib/paid-events-feature.ts');
    expect(src).toMatch(/export const PAID_EVENTS_ENABLED = false;/);
    expect(src).toMatch(/export const MANUAL_EVENT_PAYMENTS_ENABLED = true;/);
    expect(src).toMatch(/return !PAID_EVENTS_ENABLED && MANUAL_EVENT_PAYMENTS_ENABLED;/);
    // Nothing THE-345 built was deleted.
    for (const kept of [
      'PAID_EVENTS_HIDDEN_TITLE', 'PAID_EVENTS_HIDDEN_MESSAGE', 'NOT_COLLECTED_LABEL',
      'eventPriceLabel', 'csvAmountCell',
    ]) {
      expect(src, `THE-345's ${kept} was deleted`).toContain(kept);
    }
  });

  it('🔴 the EVENT-level price stays gated — it is charged by nothing in either mode', async () => {
    const { eventPriceLabel } = await import('@/lib/paid-events-feature');
    // THE-345's finding is unchanged by manual confirmation: `events/{id}.price`
    // is quoted on four screens and collected on none, so quoting it would still
    // be a lie. Only `ticketTypes[].price` — the price that actually charges —
    // is un-gated.
    expect(eventPriceLabel(50)).toBeNull();
    expect(eventPriceLabel(0)).toBeNull();
    const ev = code('src/components/AdminEvents.tsx');
    expect(ev, 'the event-level price input came back')
      .toMatch(/\{PAID_EVENTS_ENABLED && \(\s*<div>\s*<label[^>]*>Ticket Price \(\$\)<\/label>/);
    // While the TICKET TYPE price is now available. ⚠️ `[\s\S]` rather than
    // `[^>]` because the attribute list contains an arrow function.
    expect(ev, 'the ticket-type price input is still gated on the closed rail')
      .toMatch(/\{canPriceTickets && \(\s*<input type="number"[\s\S]{0,400}?placeholder="Price \(\$\)/);
  });

  it('🔴 and a priced ticket never reaches a rail that is closed', () => {
    const submit = code('src/app/api/event-registration/submit/route.ts');
    // Under manual confirmation the Stripe branch is not entered at all, so no
    // member bounces off "This ministry hasn't set up payments yet".
    expect(submit).toMatch(/const requiresPayment = amount > 0 && !waitlisted && !manualConfirmationMode\(\);/);
    // And the seat is CONFIRMED immediately, so check-in works from the start.
    expect(submit).toMatch(/status: waitlisted \? 'waitlisted' : 'confirmed',/);
  });
});
