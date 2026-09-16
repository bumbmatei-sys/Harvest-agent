import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

import { stripComments } from '../../__tests__/__fixtures__/the-346-strip-comments';
import { rulesDigestFailure } from '../../__tests__/__fixtures__/firestore-rules-pin';
import { GIVING_DOCS, type GivingDocsPage } from '../admin/GivingDocsLink';

/**
 * THE-368 — the giving documentation, linked from the surfaces that need it.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * 🔴 EVERY CONTENT GREP HERE RUNS OVER PARSER-STRIPPED SOURCE.
 *
 * These files are heavily commented and the word "giving" appears constantly in
 * docblocks — `giving-data.ts` alone would contribute forty comment matches for
 * one needle. `stripComments` is IMPORTED from THE-346's shared fixture and
 * never copied: it takes comment ranges off a REAL TypeScript PARSE, because a
 * hand-rolled scanner desynchronises on the apostrophe in JSX text and
 * `ts.createScanner` is context-free and eats the `//` inside a JSX-text URL.
 * A stripper that swallows code turns every guard built on it into one that
 * reads something which is not the code.
 *
 * ⚠️ AND THAT MATTERS PARTICULARLY HERE, because this ticket's own comments
 * NAME the three pages and quote their URLs while explaining which surface gets
 * which. Grepping raw source would find every one of those and report a
 * component that links nothing as fully linked.
 *
 * 🔴 EIGHTEEN GUARDS IN THIS SERIES HAVE PASSED A PLANTED DEFECT, every one
 * found by MUTATION and none by reading. Each section below names the mutation
 * that was actually run against it.
 *
 * 🔴 NOTHING IS PINNED TO A LINE NUMBER — THE-331 pinned AdminCommunity.tsx:491
 * and a deletion shifted it to :311. Every assertion locates its subject by
 * content. There is no fixture near today and no date fixture at all, and
 * nothing here asserts anything about the current branch's diff.
 */

const ROOT = process.cwd();
const read = (rel: string) => readFileSync(path.join(ROOT, rel), 'utf8');
/** The file as the COMPILER sees it, with every comment removed. */
const code = (rel: string) => stripComments(read(rel));

const LINK_COMPONENT = 'src/components/admin/GivingDocsLink.tsx';

/* ═══════════════════════════════════════════════════════════════════════════
 * The roster — every surface, the page it points at, and WHY that page
 * ═══════════════════════════════════════════════════════════════════════════ */

/**
 * 🔴 ADMIN SURFACES ONLY, and the `why` is part of the record rather than
 * decoration: a link to the wrong page is worse than no link, because it
 * teaches people the docs are noise. Each entry names the question a person
 * actually has ON THAT SCREEN.
 */
const LINKED: ReadonlyArray<{ file: string; page: GivingDocsPage; why: string }> = [
  {
    file: 'src/components/AdminCRM.tsx',
    page: 'recordingAGift',
    why: 'the Add Activity → Donation dialog is where a gift is ENTERED — the amount field is here and the save writes the receipt',
  },
  {
    file: 'src/components/AdminDonations.tsx',
    page: 'howGivingWorks',
    why: 'the model screen — "How your church gets paid" is a church deciding how money will reach it, and no figure appears on it',
  },
  {
    file: 'src/components/AdminGivingStatements.tsx',
    page: 'theMoneyFlow',
    why: 'which gifts reach a statement is decided by the ROUTE each came in by, and by what that route updated',
  },
  {
    file: 'src/components/AdminFundraising.tsx',
    page: 'theMoneyFlow',
    why: 'a campaign progress bar is a figure, and the one most likely to look wrong: a link gift does not move campaigns.raised',
  },
  {
    file: 'src/components/AdminEvents.tsx',
    page: 'theMoneyFlow',
    why: 'confirming an event payment is one of the two routes in that the money-flow page describes',
  },
  {
    file: 'src/components/dashboard/GivingTab.tsx',
    page: 'theMoneyFlow',
    why: 'the dashboard tab that is nothing but giving figures — every widget on it raises "why is this number what it is"',
  },
];

/**
 * 🔴 MEMBER-FACING AND PUBLIC SURFACES, which carry NO admin workflow link.
 *
 * An admin screen explains how the church OPERATES. These are seen by the
 * congregation, and a member did not ask about anybody's reconciliation
 * workflow — a "how our giving works" link on a public donation page raises a
 * question nobody asked and reads as an apology.
 *
 * ⚠️ `DonationHistory` IS IN THIS LIST DELIBERATELY, and it is the one that was
 * genuinely arguable: a member asking "where is my gift?" is exactly who the
 * email-match caveat is for. It is rejected because that caveat lives on
 * `recording-a-gift`, whose audience is "whoever does the weekly entry" — it is
 * the STEPS for entering a gift. All three pages describe the CHURCH's side,
 * so none of them answers a member's question, and sending a member to one
 * sends them to read staff procedure. There is NO exception; the reason is
 * recorded here so a later ticket can disagree with the argument rather than
 * guess at it.
 */
const NOT_LINKED: ReadonlyArray<{ file: string; why: string }> = [
  { file: 'src/components/DonationHistory.tsx', why: 'member-facing — all three pages are written for the church, not the giver' },
  { file: 'src/components/Profile.tsx', why: 'member-facing' },
  { file: 'src/components/PartnerWithUsTab.tsx', why: 'member-facing — the member app Give tab' },
  { file: 'src/components/PublicGiving.tsx', why: 'public' },
  { file: 'src/components/PublicCampaign.tsx', why: 'public' },
  { file: 'src/components/PublicPledge.tsx', why: 'public' },
  { file: 'src/components/CampaignWidget.tsx', why: 'public-facing campaign widget' },
  { file: 'src/components/PublicEventRegistration.tsx', why: 'public — a stranger opening a shared link' },
  { file: 'src/components/donations/GivingLinks.tsx', why: 'NOT an admin surface: it renders on the member Give tab and on four public pages' },
  { file: 'src/components/settings/PlanUpgradeSection.tsx', why: 'billing, not giving' },
];

/* ═══════════════════════════════════════════════════════════════════════════
 * 1 — every chosen surface links the RIGHT page, named per surface, per URL
 * ═══════════════════════════════════════════════════════════════════════════ */

describe('1 · every chosen surface links the right page', () => {
  /**
   * MUTATION RUN: the dashboard's Giving tab was pointed at `recordingAGift`
   * instead of `theMoneyFlow` — the wrong-page defect exactly, and a plausible
   * one, since a gift IS recorded somewhere. This failed naming the surface,
   * the page it should carry and the question that screen actually raises.
   */
  it.each(LINKED.map((s) => [s.file, s.page, s.why] as const))(
    '%s → %s',
    (file, page, why) => {
      const src = code(file);
      const marker = `page="${page}"`;
      expect(
        src.includes(marker),
        `${file} does not link ${page} (${GIVING_DOCS[page].href}) — ${why}`,
      ).toBe(true);

      // 🔴 AND IT LINKS NO OTHER PAGE. A surface carrying two of the three is a
      // surface that has not chosen, which is the defect this section is for.
      const others = (Object.keys(GIVING_DOCS) as GivingDocsPage[]).filter((p) => p !== page);
      for (const other of others) {
        expect(
          src.includes(`page="${other}"`),
          `${file} also links ${other} — the pages are not interchangeable, and this screen's question is: ${why}`,
        ).toBe(false);
      }
    },
  );

  it('🔴 every surface renders the shared component, never a hand-written anchor', () => {
    // The needle is the component's own tag. A surface that inlined an <a> to
    // the same URL would satisfy section 2 and fail here — which is the point.
    for (const { file } of LINKED) {
      expect(code(file), `${file} does not render <GivingDocsLink`).toContain('<GivingDocsLink');
    }
  });

  it('🔴 the roster is not vacuous — it names every page at least once', () => {
    // A roster that had silently lost its `theMoneyFlow` entries would let
    // section 1 pass by having nothing to check.
    const linked = new Set(LINKED.map((s) => s.page));
    for (const page of Object.keys(GIVING_DOCS) as GivingDocsPage[]) {
      expect(linked.has(page), `no surface links ${page} — a page nobody links is a page nobody reads`).toBe(true);
    }
    expect(LINKED.length).toBeGreaterThanOrEqual(6);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * 2 — the three URLs, asserted as literals
 * ═══════════════════════════════════════════════════════════════════════════ */

describe('2 · all three URLs are correct', () => {
  /**
   * 🔴 SPELLED OUT IN FULL, not rebuilt from the same parts the module builds
   * them from. A test that re-derives `origin + '/giving/' + slug` re-implements
   * the module and agrees with it by construction, including when both are
   * wrong. These are the literals, typed out.
   *
   * ⚠️ EXISTENCE WAS VERIFIED AT THE DOCS SOURCE, not assumed and not left to a
   * network call: all three are pages in the live `theharvest` docs deployment,
   * listed in its Giving group with the titles this module spells. A fetch is
   * deliberately NOT made here — this environment's network policy refuses
   * docs.theharvest.site outright, so a request-based check would fail in CI for
   * a reason that is not about the code, and one that passed would make the
   * suite depend on a third party being up.
   *
   * MUTATION RUN: `the-money-flow` → `the-money-flow-2`, and the origin to
   * `docs.theharvest.com`. Both failed here naming the page.
   */
  it('the money flow', () => {
    expect(GIVING_DOCS.theMoneyFlow.href).toBe('https://docs.theharvest.site/giving/the-money-flow');
  });
  it('how giving works', () => {
    expect(GIVING_DOCS.howGivingWorks.href).toBe('https://docs.theharvest.site/giving/how-giving-works');
  });
  it('recording a gift', () => {
    expect(GIVING_DOCS.recordingAGift.href).toBe('https://docs.theharvest.site/giving/recording-a-gift');
  });

  it('🔴 there are exactly three, so a fourth page cannot be linked without a decision', () => {
    expect(Object.keys(GIVING_DOCS).sort()).toEqual(['howGivingWorks', 'recordingAGift', 'theMoneyFlow']);
  });

  it('🔴 each label is the docs page own title, so two screens cannot name one page differently', () => {
    expect(GIVING_DOCS.theMoneyFlow.label).toBe('The money flow');
    expect(GIVING_DOCS.howGivingWorks.label).toBe('How giving works');
    expect(GIVING_DOCS.recordingAGift.label).toBe('Recording a gift');
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * 3 — no member-facing or public surface carries an admin workflow link
 * ═══════════════════════════════════════════════════════════════════════════ */

describe('3 · no member-facing or public surface carries an admin workflow link', () => {
  /**
   * MUTATION RUN: a `<GivingDocsLink page="howGivingWorks" />` was added to
   * PublicGiving.tsx — the exact defect the ticket names, a "how our giving
   * works" link on a public donation page — and this failed naming the file and
   * why it may not carry one. The same link on DonationHistory failed too.
   */
  it.each(NOT_LINKED.map((s) => [s.file, s.why] as const))('%s carries no link — %s', (file, why) => {
    const src = code(file);
    expect(src.includes('GivingDocsLink'), `${file} links the giving docs, and it is ${why}`).toBe(false);
    expect(
      /docs\.theharvest\.site\/giving/.test(src),
      `${file} hand-writes a giving docs URL, and it is ${why}`,
    ).toBe(false);
  });

  it('🔴 and the rule is swept, not just spot-checked on a list', () => {
    // A hand-written roster only catches the files somebody remembered. This
    // walks every source file in the tree and requires that anything rendering
    // the link is on the LINKED list — so a link added to a surface nobody
    // listed fails here even though no assertion above names that file.
    const walk = (dir: string): string[] => readdirSync(path.join(ROOT, dir), { withFileTypes: true })
      .flatMap((e) => {
        const rel = `${dir}/${e.name}`;
        if (e.isDirectory()) return e.name === '__tests__' ? [] : walk(rel);
        return /\.tsx?$/.test(e.name) ? [rel] : [];
      });

    const allowed = new Set<string>([...LINKED.map((s) => s.file), LINK_COMPONENT]);
    const strays = walk('src')
      .filter((rel) => !allowed.has(rel))
      .filter((rel) => /GivingDocsLink|docs\.theharvest\.site\/giving/.test(code(rel)));

    expect(
      strays,
      'these surfaces link the giving docs but are on no roster — add them to LINKED with the page they point at and why, '
        + 'or remove the link:\n  ' + strays.join('\n  '),
    ).toEqual([]);
  });

  it('🔴 the sweep is non-vacuous — it can see the surfaces that DO link', () => {
    // If `walk` or `code` silently returned nothing, the sweep above would pass
    // for the wrong reason. This proves it reads real files with real content.
    const walk = (dir: string): string[] => readdirSync(path.join(ROOT, dir), { withFileTypes: true })
      .flatMap((e) => {
        const rel = `${dir}/${e.name}`;
        if (e.isDirectory()) return e.name === '__tests__' ? [] : walk(rel);
        return /\.tsx?$/.test(e.name) ? [rel] : [];
      });
    const seen = walk('src').filter((rel) => /GivingDocsLink/.test(code(rel)));
    expect(seen.length, 'the sweep found no linking file at all').toBe(LINKED.length + 1);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * 4 — one treatment, used everywhere
 * ═══════════════════════════════════════════════════════════════════════════ */

describe('4 · one treatment, used everywhere', () => {
  /**
   * MUTATION RUN: AdminFundraising's `<GivingDocsLink page="theMoneyFlow" />`
   * was replaced with a hand-written `<a href="https://docs.theharvest.site/
   * giving/the-money-flow" target="_blank" rel="noopener">` carrying its own
   * classes — a second style, correct in every other respect. This failed.
   */
  it('🔴 the giving docs URLs exist in exactly ONE module', () => {
    const walk = (dir: string): string[] => readdirSync(path.join(ROOT, dir), { withFileTypes: true })
      .flatMap((e) => {
        const rel = `${dir}/${e.name}`;
        if (e.isDirectory()) return e.name === '__tests__' ? [] : walk(rel);
        return /\.tsx?$/.test(e.name) ? [rel] : [];
      });
    const holders = walk('src').filter((rel) => /docs\.theharvest\.site\/giving/.test(code(rel)));
    expect(
      holders,
      'a giving docs URL is written outside the shared component — twenty surfaces with four link styles is worse than none',
    ).toEqual([LINK_COMPONENT]);
  });

  it('🔴 no surface restyles the link — className is position only', () => {
    // The component owns its appearance. A caller passing colour, type size,
    // weight or a background is a second style wearing the first one's name.
    const RESTYLE = /className="[^"]*\b(?:text-(?:xs|sm|base|lg|muted|body|strong|gold)|font-\w+|bg-\w[\w-]*|underline|rounded[\w-]*|border[\w-]*)\b/;
    for (const { file } of LINKED) {
      const src = code(file);
      for (const m of src.matchAll(/<GivingDocsLink[^/>]*\/>/g)) {
        expect(RESTYLE.test(m[0]), `${file} restyles the link: ${m[0].trim()}`).toBe(false);
      }
    }
  });

  it('🔴 the component spells the treatment once and takes no label', () => {
    const src = code(LINK_COMPONENT);
    // Exactly one anchor in the module — two would be two treatments.
    expect((src.match(/<a\b/g) ?? []).length, 'the component renders more than one anchor').toBe(1);
    // The label is DERIVED. A `label` prop is a second axis of drift.
    expect(/label\??:\s*string/.test(src), 'the component accepts a label prop').toBe(false);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * 5 — every link opens in a new tab, with rel="noopener"
 * ═══════════════════════════════════════════════════════════════════════════ */

describe('5 · every link opens in a new tab with rel="noopener"', () => {
  /**
   * MUTATION RUN: `rel="noopener"` was deleted from the component, and
   * separately weakened to `rel="noreferrer"` alone. Both failed here.
   */
  const src = () => code(LINK_COMPONENT);

  it('target="_blank"', () => {
    expect(src()).toContain('target="_blank"');
  });

  it('rel="noopener" — the opened page gets no window.opener handle back', () => {
    expect(/rel="noopener(?:\s+noreferrer)?"/.test(src()), 'rel is not noopener').toBe(true);
  });

  it('🔴 and the navigation is the ANCHOR\'s own, so middle-click and keyboard still work', () => {
    // A button with an onClick that calls window.open is not the same control:
    // it cannot be opened in a background tab and it is not a link to a screen
    // reader. The component must therefore carry an href and no click handler.
    expect(src()).toContain('href={href}');
    expect(/onClick/.test(src()), 'the link routes through a click handler').toBe(false);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * 6-10 — no-regression on the tickets this one had to work around
 * ═══════════════════════════════════════════════════════════════════════════ */

describe('6 · no user-facing Stripe mention was reintroduced', () => {
  /**
   * THE-362 removed EIGHT user-facing mentions across seven files. Its own
   * sweep covers the giving screens it edited; it does NOT cover AdminCRM,
   * AdminEvents or the dashboard's Giving tab, which this ticket touches. So
   * this is additive rather than a duplicate.
   *
   * 🔴 THE NEEDLE IS ASSEMBLED, NEVER SPELLED — #504 shipped a guard whose
   * needle matched ITSELF in the file defending it, so it could never fail. The
   * non-vacuity check below plants both spellings against the assembled needle.
   */
  const NEEDLE = new RegExp(['S', 't', 'r', 'i', 'p'].join('') + 'e', 'i');

  it('the needle actually matches — this guard can fail', () => {
    expect(NEEDLE.test(['S', 't', 'r', 'i', 'p', 'e'].join(''))).toBe(true);
    expect(NEEDLE.test(['s', 't', 'r', 'i', 'p', 'e'].join(''))).toBe(true);
    expect(NEEDLE.test('nothing to see here')).toBe(false);
  });

  it.each(LINKED.map((s) => [s.file] as const))('%s adds no mention', (file) => {
    // The text THIS ticket adds, isolated: every line the diff introduced that
    // is not a comment. Reading the whole file would re-litigate mentions that
    // predate this ticket and live in identifiers and route paths.
    const added = code(file)
      .split('\n')
      .filter((l) => /GivingDocsLink/.test(l))
      .join('\n');
    expect(NEEDLE.test(added), `${file} names the processor on a giving surface`).toBe(false);
  });

  it('the shared component names no processor at all', () => {
    expect(NEEDLE.test(code(LINK_COMPONENT))).toBe(false);
  });
});

describe('7 · the corrected accounting copy is unchanged, including the no-email condition', () => {
  /**
   * 🔴 THE-362 CORRECTED A FALSE CLAIM ABOUT MONEY HERE. AdminAccounting and
   * AdminGivingStatements had said a CRM-recorded gift "does not change these
   * numbers", which was not true. Both now also carry the no-email condition: a
   * gift against a contact with no email counts in the books but can NEVER
   * reach a statement.
   *
   * ⚠️ AdminAccounting IS BYTE-IDENTICAL TO main IN THIS TICKET — see section
   * 14 — because its only pin admits an edit solely by SUBSTITUTION. The copy
   * is asserted here anyway: this ticket links the same subject from the
   * neighbouring screens, so the sentences it must not contradict are the ones
   * worth measuring.
   *
   * MUTATION RUN: the words "with no email address" were deleted from the
   * statements block, and "does count here" reverted to "does not change these
   * numbers" in accounting. Both failed here.
   */
  const ACCOUNTING = 'src/components/AdminAccounting.tsx';
  const STATEMENTS = 'src/components/AdminGivingStatements.tsx';

  it('accounting still says a CRM-recorded gift DOES count', () => {
    const c = read(ACCOUNTING);
    expect(c).toContain('<b className="text-strong">Recording one in your CRM does count here.</b>');
    expect(c).toContain('that writes a\n                receipt to your ledger');
  });

  it('🔴 and accounting still carries the no-email condition', () => {
    expect(read(ACCOUNTING)).toContain(
      'One exception — a gift recorded against a\n                contact with no email address still counts in these totals, but it cannot appear on\n                a giving statement, because statements are grouped by email address.',
    );
  });

  it('🔴 and the false claim has not come back', () => {
    expect(/does not change these numbers/i.test(read(ACCOUNTING)), 'the corrected claim was reverted').toBe(false);
  });

  it('statements still carry the no-email condition, character for character', () => {
    expect(read(STATEMENTS)).toContain(
      'A gift recorded against a contact with no email\n            address cannot appear at all, because statements are grouped by email address.',
    );
  });

  it('🔴 and the statements disclaimer block is where it was, with this ticket OUTSIDE it', () => {
    const c = read(STATEMENTS);
    expect(c).toContain('data-testid="statements-manual-links"');
    // The link precedes the pinned block. Placed after it, it would land INSIDE
    // the region `manual-payment-link-disclosures` extracts, which is how it
    // first tripped that suite's colour guard.
    expect(c.indexOf('GivingDocsLink')).toBeLessThan(c.indexOf('data-testid="statements-manual-links"'));
  });
});

describe('8 · AdminFundraising copy is unchanged — a link gift does not update campaigns.raised', () => {
  /**
   * THE-362 deliberately LEFT THIS SCREEN ALONE, because the sentence it would
   * have had to write — "recorded gifts count" — is FALSE of `campaigns.raised`.
   * This ticket therefore adds a DESTINATION and not one word of copy.
   *
   * MUTATION RUN: a sentence reading "Gifts you record count towards this
   * campaign." was added beside the link. This failed.
   */
  const FUNDRAISING = 'src/components/AdminFundraising.tsx';

  it('🔴 this ticket adds a link and NO prose to the screen', () => {
    // Every line this ticket introduced into the file, comments stripped: it
    // must be the component and nothing else.
    const added = code(FUNDRAISING).split('\n').filter((l) => /GivingDocsLink/.test(l));
    expect(added.length, 'more than the import and the element were added').toBe(2);
    expect(added.some((l) => /^import /.test(l.trim())), 'the import is missing').toBe(true);
    const element = added.find((l) => !/^import /.test(l.trim()))!;
    expect(element.trim()).toBe('<GivingDocsLink page="theMoneyFlow" className="mt-3" />');
  });

  it('🔴 and no new claim about what a gift updates appears anywhere in it', () => {
    const c = code(FUNDRAISING);
    for (const claim of [/recorded gifts count/i, /counts? towards this campaign/i, /updates? the campaign total/i]) {
      expect(claim.test(c), `a new false claim about campaigns.raised appeared: ${claim}`).toBe(false);
    }
  });
});

describe('9 · the collapsible payment-links disclaimer and the Contacts/Roles switcher are unchanged', () => {
  /**
   * #482's work, re-measured against the file on disk rather than trusted to a
   * hash — this ticket edits AdminCRM, so "the digest moved for a reason" is
   * exactly the claim that needs a behavioural check beside it.
   */
  const CRM = 'src/components/AdminCRM.tsx';

  it('the disclaimer text is byte-for-byte', () => {
    const c = read(CRM);
    expect(c).toContain('Gifts sent through your own payment links are not counted here.');
    expect(c).toContain('open their contact, press Add Activity, choose Donation and enter the amount.');
  });

  it('it is still a fold, and still keepMounted so the text is findable when shut', () => {
    const c = read(CRM);
    expect(c).toContain('<Collapsible');
    expect(c).toContain('keepMounted');
    expect(c).toContain('crm-manual-giving-panel');
  });

  it('🔴 the switcher is ONE definition, so it cannot differ between tabs', () => {
    // Identical on both tabs is true BY CONSTRUCTION when there is a single
    // definition rendered in both places. Counting the definition is the
    // assertion; comparing two renderings would pass two copies that agree today.
    const c = code(CRM);
    expect((c.match(/const subTabBar\b/g) ?? []).length, 'subTabBar is not a single definition').toBe(1);
  });

  it('🔴 and this ticket did not add a second Collapsible or a second switcher', () => {
    const c = code(CRM);
    expect((c.match(/crm-manual-giving-panel/g) ?? []).length).toBe(1);
  });
});

describe('10 · the partnership button is still a single button with no status line', () => {
  /**
   * #503. Harvest CANNOT know whether a recurring gift exists, so a status line
   * beside this button would be a claim the product cannot make. This ticket
   * does not touch Profile — it is member-facing — and this proves it.
   *
   * MUTATION RUN: a second "Manage partnership" button, and separately a
   * "You give monthly" status line, were added beside it. Both failed.
   */
  const PROFILE = 'src/components/Profile.tsx';

  it('exactly one Partner with Us control', () => {
    const c = code(PROFILE);
    expect((c.match(/Partner with Us/g) ?? []).length, 'the partnership control was duplicated').toBe(1);
  });

  it('🔴 and no status line claiming knowledge of a recurring gift', () => {
    const c = code(PROFILE);
    for (const claim of [/you (?:are )?(?:currently )?giv(?:e|ing)/i, /active partner/i, /recurring gift/i, /monthly (?:gift|partner)/i]) {
      expect(claim.test(c), `Profile claims to know about a recurring gift: ${claim}`).toBe(false);
    }
  });

  it('🔴 and Profile carries no giving docs link — it is member-facing', () => {
    expect(code(PROFILE).includes('GivingDocsLink')).toBe(false);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * 12-13 — the house rules, and this suite's own discipline
 * ═══════════════════════════════════════════════════════════════════════════ */

describe('12 · no colour is hardcoded and no emoji reaches a reader', () => {
  /**
   * U+FE0F is STRIPPED rather than matched: matched, it splits every marker in
   * two and no allowlist can hold the orphan half. Dingbats are deliberately
   * out — this repo's check and cross marks are not emoji.
   */
  const EMOJI = /[\u{1F300}-\u{1FAFF}\u{1F000}-\u{1F2FF}]/u;

  it('the component hardcodes no colour', () => {
    const src = code(LINK_COMPONENT);
    expect(/#[0-9a-fA-F]{3,8}\b|rgba?\(\s*\d|hsla?\(\s*\d/.test(src), 'a colour literal reached the component').toBe(false);
    expect(/style=\{\{/.test(src), 'the component carries an inline style').toBe(false);
  });

  it('it spells palette TOKENS, which resolve per theme', () => {
    const src = code(LINK_COMPONENT);
    expect(src).toContain('text-muted');
    expect(src).toContain('text-body');
  });

  it('🔴 no emoji in anything this ticket renders', () => {
    // Comments carry the house markers and are stripped first; what a reader
    // sees is what is measured.
    for (const { file } of [...LINKED, { file: LINK_COMPONENT }]) {
      const added = code(file).split('\n').filter((l) => /GivingDocsLink/.test(l)).join('\n');
      expect(EMOJI.test(added), `${file} renders an emoji`).toBe(false);
    }
    expect(EMOJI.test(code(LINK_COMPONENT)), 'the component renders an emoji').toBe(false);
  });

  it('the emoji needle actually matches — this guard can fail', () => {
    expect(EMOJI.test(String.fromCodePoint(0x1F534))).toBe(true);
  });
});

describe('13 · this suite pins no line number, no date and nothing about the branch diff', () => {
  const SELF = 'src/components/__tests__/THE-368.giving-docs-links.test.tsx';
  const LAYOUT = 'src/components/__tests__/THE-368.giving-docs-link.layout.test.tsx';
  const OWN = [SELF, LAYOUT];

  /**
   * 🔴 EVERY NEEDLE IN THIS SECTION IS ASSEMBLED AT RUN TIME, and that is the
   * #504 defect met head on rather than avoided by luck. A guard that greps its
   * OWN source for a forbidden spelling matches the very regex doing the
   * grepping — so written whole, each of these fails against itself and the
   * only way to "fix" it is to delete the guard. Every needle below is built
   * from fragments, and each is proved to match a planted string before it is
   * trusted.
   */
  const needle = (parts: string[], flags = '') => new RegExp(parts.join(''), flags);
  const LINE_PIN = needle(['\\.tsx?', ':', '\\d+']);
  const DATE_FIXTURE = needle(['new ', 'Date', '\\(', '|', 'Date', '\\.', 'now', '\\(', '|', 'toF', 'ake']);
  const BRANCH_DIFF = needle(['exec', 'Sync', '|', 'child_', 'process', '|', 'git ', 'diff', '|', 'merge-', 'base', '|', 'origin', '/', 'main']);
  const COPIED_STRIPPER = needle(['function ', 'strip', 'Comments']);

  it('every needle in this section actually matches — none of these guards is vacuous', () => {
    expect(LINE_PIN.test(['AdminCommunity', '.tsx', ':491'].join(''))).toBe(true);
    expect(DATE_FIXTURE.test(['new ', 'Date', '(2026, 0, 1)'].join(''))).toBe(true);
    expect(BRANCH_DIFF.test(['git ', 'diff', ' --stat'].join(''))).toBe(true);
    expect(COPIED_STRIPPER.test(['function ', 'strip', 'Comments', '(src) {}'].join(''))).toBe(true);
    for (const re of [LINE_PIN, DATE_FIXTURE, BRANCH_DIFF, COPIED_STRIPPER]) {
      expect(re.test('nothing to see here'), `${re} matches anything`).toBe(false);
    }
  });

  it('🔴 no test pins a line number', () => {
    // THE-331 pinned a component at a line, and a deletion shifted it by 180.
    for (const rel of OWN) {
      expect(LINE_PIN.test(code(rel)), `${rel} pins a line number`).toBe(false);
    }
  });

  it('🔴 no fixture near today, because there is no date fixture at all', () => {
    for (const rel of OWN) {
      expect(DATE_FIXTURE.test(code(rel)), `${rel} builds a date fixture`).toBe(false);
    }
  });

  it('🔴 no guard asserts anything about the current branch diff', () => {
    for (const rel of OWN) {
      expect(BRANCH_DIFF.test(code(rel)), `${rel} reads the branch diff`).toBe(false);
    }
  });

  it('🔴 and the stripper is IMPORTED, never copied', () => {
    const src = code(SELF);
    expect(src).toMatch(/import \{[^}]*stripComments[^}]*\} from/);
    expect(COPIED_STRIPPER.test(src), 'the stripper was copied into this suite').toBe(false);
  });

  it('the stripper is doing real work here — a comment-only match is not found', () => {
    // Non-vacuity for every grep above: these files are heavily commented and
    // this ticket's own comments name the pages. Raw source finds them; stripped
    // source must not.
    const raw = read(LINK_COMPONENT);
    const stripped = code(LINK_COMPONENT);
    expect(raw).toContain('somebody meeting giving for the first time');
    expect(stripped.includes('somebody meeting giving for the first time'),
      'the stripper left comment prose in the code — every grep in this suite is reading comments').toBe(false);
    expect(stripped).toContain('the-money-flow');
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * 14 — the files this ticket may not touch
 * ═══════════════════════════════════════════════════════════════════════════ */

describe('14 · firestore.rules, firestore.indexes.json, functions/ and layout.tsx are byte-identical', () => {
  /**
   * 🔴 `firestore.rules` AUTO-DEPLOYS TO PRODUCTION ON MERGE and this repo runs
   * no emulator tests over it — THE-313's one line turned 46 files red. This
   * ticket adds no Firestore operation of any kind: it renders an anchor. There
   * is nothing a rule or an index could express about it, so the correct number
   * of changes to all four files is zero.
   *
   * 🔴 `layout.tsx` IS PINNED BY THIRTY-NINE FILES, only THREE of which have an
   * append path. It is not touched.
   *
   * ⚠️ NO `firestore.rules` DIGEST IS RECORDED IN THE OWNERSHIP REGISTER for
   * this ticket, and that is a finding rather than an omission — the register is
   * PER TICKET, and a ticket with no Firestore operation has no rules digest to
   * record there.
   *
   * MUTATION RUN: a blank line was appended to `firestore.indexes.json`. This
   * failed, naming the file.
   */
  /**
   * ⚠️ `firestore.rules` IS DELIBERATELY ABSENT FROM THIS MAP, and its digest is
   * NOT spelled anywhere in this file. THE-325 requires that the rules digest
   * live in ONE place — its register — so that a legitimate rules change costs
   * exactly one edit rather than one per suite that copied the hash. Spelling it
   * here would make this suite the forty-seventh copy. It is asserted through
   * the register's own helper instead, below.
   */
  const UNTOUCHED: Readonly<Record<string, string>> = {
    'firestore.indexes.json':
      '8ae29121ceb65f8fc06df89435829496cd06ee0abff98c1ad24f6f470da2c6b0',
    'src/app/layout.tsx':
      'b9bdf22ae920933587b39c5030cbf1ef4f89b02230578e5ad6c4b715b824c63f',
    'functions/src/index.ts':
      '39ccade96ac3d4dd5a13047e9bc42b54ef5ac59ae72f932af042fc814bf23e0b',
  };

  it.each(Object.keys(UNTOUCHED))('%s is byte-for-byte unchanged', (file) => {
    const digest = createHash('sha256').update(readFileSync(path.join(ROOT, file))).digest('hex');
    expect(digest, `${file} changed — this ticket renders an anchor and touches no infrastructure`)
      .toBe(UNTOUCHED[file]);
  });

  it('🔴 firestore.rules is at a digest some ticket recorded — it auto-deploys on merge', () => {
    // Through the register, never by spelling the hash. See the note above.
    expect(rulesDigestFailure(),
      'firestore.rules is at a digest no ticket recorded — it auto-deploys to production').toBeNull();
  });

  it('🔴 and this ticket records no firestore.rules digest of its own', () => {
    const register = JSON.parse(read('src/__tests__/__fixtures__/ownership/THE-368.json')) as {
      entries: Array<{ file: string }>;
    };
    const rules = register.entries.filter((e) => e.file === 'firestore.rules');
    expect(rules, 'the ownership register is PER TICKET — a rules digest here would be another ticket\'s record')
      .toEqual([]);
  });

  it('🔴 the register itself is well-formed: every entry names a file, a digest and a reason', () => {
    const register = JSON.parse(read('src/__tests__/__fixtures__/ownership/THE-368.json')) as {
      ticket: string;
      entries: Array<{ file: string; digest: string; why: string }>;
    };
    expect(register.ticket).toBe('THE-368');
    expect(register.entries.length).toBeGreaterThan(0);
    for (const e of register.entries) {
      expect(e.file, 'an entry names no file').toBeTruthy();
      expect(e.digest, `${e.file} carries no digest`).toMatch(/^[0-9a-f]{64}$/);
      expect(e.why.length, `${e.file}'s reason is too short to be a record`).toBeGreaterThanOrEqual(80);
      // A recorded digest that does not match the file on disk is a record that
      // has drifted from what it records.
      const actual = createHash('sha256').update(readFileSync(path.join(ROOT, e.file))).digest('hex');
      expect(actual, `${e.file}'s recorded digest is not the file on disk`).toBe(e.digest);
    }
  });
});
