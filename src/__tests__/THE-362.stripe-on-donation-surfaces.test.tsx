import { describe, it, expect } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

import PaymentSection from '../components/settings/PaymentSection';
import {
  STRIPE_CONNECT_ENABLED,
  STRIPE_CONNECT_HIDDEN_MESSAGE,
} from '../lib/stripe-connect-feature';

/**
 * THE-362 - the word a church should not be reading on a giving screen.
 *
 * The founder: "Hide everything that talks about stripe. In donations,
 * everywhere." THE-350 (#494) replaced the admin donation screens' copy and
 * THE-357 fixed the share sheet, and they were still seeing it - because both
 * tickets changed SENTENCES and left HEADINGS, LABELS and page subtitles
 * standing, which is most of what a reader actually takes in.
 *
 * --- What this sweep looks at, and why it is not a grep ----------------------
 *
 * `grep -i stripe` over these files returns dozens of lines and almost none of
 * them is copy: `/api/stripe/donate`, `stripeConnectStatus`,
 * `STRIPE_CONNECT_ENABLED`, `import Stripe from 'stripe'`. This ticket is about
 * what a CHURCH SEES, not about removing Stripe from the codebase, so the sweep
 * reads USER-FACING TEXT ONLY, pulled off a real TypeScript parse:
 *
 *   - every `JsxText` run - the prose between tags;
 *   - every prose-bearing JSX ATTRIBUTE (`title`, `subtitle`, `label`,
 *     `placeholder`, `aria-label`, ...), which is where THE-350 left the founder
 *     one of the mentions they were still reading;
 *   - every string handed to `alert(`.
 *
 * A PARSE, not a lexer and not a regex. `__fixtures__/the-346-strip-comments`
 * records why at length: a hand-rolled scanner desynchronises on the apostrophe
 * in JSX text ("your church's"), and `ts.createScanner` is context-free and eats
 * a `//` inside a JSX-text URL. Comments carry no copy anyway, and
 * `giving-data.ts` alone would contribute forty comment matches for "stripe".
 *
 * --- The needle is assembled, never spelled ---------------------------------
 *
 * #504 found a guard whose needle, written whole, matched ITSELF in the test
 * file it was defending - a sweep that can never fail. Every needle below is
 * built from fragments at runtime, and each is checked against a planted string
 * before it is trusted.
 */

const ROOT = process.cwd();
const read = (rel: string) => readFileSync(path.join(ROOT, rel), 'utf8');

/**
 * The needle, assembled. Case-insensitive so a lower-case mention in prose is
 * caught too; the non-vacuity test below plants both spellings.
 */
const STRIPE = new RegExp(['S', 't', 'r', 'i', 'p'].join('') + 'e', 'i');

/** JSX attributes that carry PROSE a reader sees. Not `className`, not `href`. */
const PROSE_ATTRS = new Set([
  'title', 'subtitle', 'label', 'placeholder', 'description', 'heading',
  'aria-label', 'aria-description', 'alt', 'eyebrow', 'confirmLabel', 'emptyText',
]);

/**
 * Every run of user-facing text in a source file, with its kind.
 *
 * Returned as `{ what, text }` pairs so a failure names the SHAPE that carried
 * the mention - "jsx-text" or `subtitle=` - rather than only the file.
 */
function userFacingText(src: string): Array<{ what: string; text: string }> {
  const sf = ts.createSourceFile('probe.tsx', src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const out: Array<{ what: string; text: string }> = [];

  const walk = (node: ts.Node): void => {
    if (ts.isJsxText(node)) {
      const text = node.text.trim();
      if (text) out.push({ what: 'jsx-text', text });
    } else if (ts.isJsxAttribute(node) && ts.isIdentifier(node.name) === false) {
      // namespaced attribute (aria-label parses as a JsxNamespacedName in some
      // shapes); handled by the identifier branch below in practice.
    }
    if (ts.isJsxAttribute(node)) {
      const name = node.name.getText(sf);
      if (PROSE_ATTRS.has(name) && node.initializer) {
        const init = node.initializer;
        if (ts.isStringLiteral(init)) {
          out.push({ what: `${name}=`, text: init.text });
        } else if (ts.isJsxExpression(init) && init.expression) {
          // `subtitle={"..."}` and `title={`...`}` both reach a reader.
          const e = init.expression;
          if (ts.isStringLiteral(e) || ts.isNoSubstitutionTemplateLiteral(e)) {
            out.push({ what: `${name}=`, text: e.text });
          } else if (ts.isTemplateExpression(e)) {
            out.push({ what: `${name}=`, text: e.getText(sf) });
          }
        }
      }
    }
    if (ts.isCallExpression(node) && node.expression.getText(sf).endsWith('alert')) {
      for (const arg of node.arguments) {
        if (ts.isStringLiteral(arg) || ts.isNoSubstitutionTemplateLiteral(arg)) {
          out.push({ what: 'alert()', text: arg.text });
        }
      }
    }
    ts.forEachChild(node, walk);
  };
  walk(sf);
  return out;
}

/**
 * THE ONE EXCLUDED REGION, and what makes excluding it safe.
 *
 * `StripeConnectPanel` is the admin's CONNECT-AN-ACCOUNT flow: four status
 * branches whose buttons send an admin to Stripe's own onboarding. The
 * processor's name is the operative information there - "Connect Account" with
 * the name removed is a button that no longer says where it goes - so it is
 * load-bearing copy and this ticket reports it rather than deleting it.
 *
 * It is also UNREACHABLE. THE-256 gates it behind `STRIPE_CONNECT_ENABLED`,
 * which is `false` (the platform account is closed), and keeps the four
 * branches byte-for-byte so the panel returns whole if it is ever switched back
 * on. Section 6b does not take that on trust: it RENDERS the shipped component
 * and asserts the church-visible output carries no mention at all.
 */
function withoutConnectPanel(src: string): string {
  const start = src.indexOf('const StripeConnectPanel');
  const end = src.indexOf('const PaymentSection');
  expect(start, 'StripeConnectPanel moved - the excluded region no longer exists')
    .toBeGreaterThan(-1);
  expect(end, 'the PaymentSection wrapper moved').toBeGreaterThan(start);
  return src.slice(0, start) + src.slice(end);
}

/**
 * The DONATION surfaces: every screen a church or a member reads about giving.
 *
 * `slice` narrows a file to the part that is about donations, for the two mixed
 * files in the list. Everything else is swept whole.
 */
const DONATION_SURFACES: ReadonlyArray<{
  readonly file: string;
  readonly what: string;
  readonly slice?: (src: string) => string;
}> = [
  { file: 'src/components/AdminDonations.tsx', what: 'the Donations screen itself' },
  { file: 'src/components/AdminFundraising.tsx', what: 'Fundraising: payment setup and campaigns' },
  { file: 'src/components/AdminGivingStatements.tsx', what: 'year-end giving statements' },
  { file: 'src/components/AdminAccounting.tsx', what: "the church's books" },
  { file: 'src/components/PartnerWithUsTab.tsx', what: "the member app's Give tab" },
  { file: 'src/components/PublicCampaign.tsx', what: 'the public campaign page' },
  { file: 'src/components/PublicGiving.tsx', what: 'the public /giving page' },
  { file: 'src/components/donations/GivingLinks.tsx', what: "the church's own payment links" },
  { file: 'src/components/CampaignWidget.tsx', what: 'the in-app campaign widget' },
  { file: 'src/components/AdminSettings.tsx', what: 'the Settings pointer at Donations' },
  {
    file: 'src/components/settings/PaymentSection.tsx',
    what: 'the card-giving panel, mounted by Donations and Fundraising',
    slice: withoutConnectPanel,
  },
];

/* ═══ 6 · no donation surface shows the word to a church ═══════════════════ */

describe('6 - no donation surface shows the word Stripe to a church', () => {
  it.each(DONATION_SURFACES.map((s) => [s.file, s] as const))(
    '%s carries no mention in any user-facing string',
    (_file, surface) => {
      const src = surface.slice ? surface.slice(read(surface.file)) : read(surface.file);
      const hits = userFacingText(src).filter((t) => STRIPE.test(t.text));
      expect(
        hits,
        `${surface.file} (${surface.what}) still shows it:\n  `
          + hits.map((h) => `${h.what} ${JSON.stringify(h.text)}`).join('\n  '),
      ).toEqual([]);
    },
  );

  it('the extractor really reads this app’s copy - it is not returning nothing', () => {
    /**
     * NON-VACUITY, and the reason it is here: a sweep that extracts zero strings
     * passes every file in the list. So the extractor is asked for text it MUST
     * find - a sentence each of these screens genuinely renders.
     */
    for (const [file, needle] of [
      ['src/components/AdminDonations.tsx', 'How your church gets paid'],
      ['src/components/AdminGivingStatements.tsx', 'These statements cover gifts Harvest processed.'],
      ['src/components/AdminAccounting.tsx', 'These totals count gifts Harvest processed.'],
      ['src/components/PublicCampaign.tsx', 'Secure, encrypted payment.'],
    ] as const) {
      const all = userFacingText(read(file)).map((t) => t.text).join(' | ');
      expect(all, `the extractor found nothing readable in ${file}`).toContain(needle);
    }
  });

  it('and the needle catches what it claims to, in both spellings', () => {
    const planted = ['S', 't', 'r', 'i', 'p', 'e'].join('');
    expect(STRIPE.test(planted)).toBe(true);
    expect(STRIPE.test(planted.toLowerCase())).toBe(true);
    expect(STRIPE.test('Card giving')).toBe(false);
    // And the extractor surfaces a planted mention rather than silently dropping
    // it - the guard's own failure path, exercised.
    const probe = 'const A = () => <p title="paid by ' + planted + '">ok</p>;';
    expect(userFacingText(probe).filter((t) => STRIPE.test(t.text))).toHaveLength(1);
  });
});

/* ═══ 6b · the one excluded region is genuinely unreachable ════════════════ */

describe('6b - the connect panel is excluded because a church cannot reach it', () => {
  it('the master switch is off, so the panel is not mounted', () => {
    expect(STRIPE_CONNECT_ENABLED, 'Connect is back on - the exclusion above is now a hole')
      .toBe(false);
  });

  it('what a church actually SEES on the card-giving panel carries no mention', () => {
    // The shipped component, rendered. Not its source: this is the output.
    const shown = renderToStaticMarkup(React.createElement(PaymentSection))
      .replace(/<[^>]*>/g, ' ');
    expect(shown, 'the rendered panel still shows it').not.toMatch(STRIPE);
    // And it still says the thing THE-350 wrote, which is the half a bare
    // refusal left a church to guess at.
    expect(shown).toContain(STRIPE_CONNECT_HIDDEN_MESSAGE);
  });

  it('the hidden message itself names no processor', () => {
    expect(STRIPE_CONNECT_HIDDEN_MESSAGE).not.toMatch(STRIPE);
  });

  it('the panel is still ONE component with its four branches intact', () => {
    /**
     * NO-REGRESSION ON THE-256. Hiding a word must not be how the four status
     * branches get deleted: flip the switch and the panel comes back whole.
     */
    const src = read('src/components/settings/PaymentSection.tsx');
    expect((src.match(/const StripeConnectPanel/g) ?? []), 'the panel was forked or deleted')
      .toHaveLength(1);
    for (const branch of ["=== 'active'", "=== 'pending'", "=== 'restricted'"]) {
      expect(src, `the ${branch} branch is gone`).toContain(branch);
    }
    expect(src, 'the gate stopped reading the master switch').toContain('STRIPE_CONNECT_ENABLED ?');
  });
});

/* ═══ 7 · no-regression on #499: the internal billing union ════════════════ */

describe('7 - the internal billing processor union is untouched', () => {
  /**
   * #499 kept `'stripe' | 'dodo'` DELIBERATELY, so a tenant whose subscription
   * is owned by the closed platform account BLOCKS VISIBLY instead of silently
   * doing nothing. It is an internal discriminant, never rendered, and removing
   * it to satisfy a copy sweep would turn a visible block back into a silent
   * one - the exact failure mode this repo's Silent-Failure Rule exists for.
   */
  const processor = () => read('src/lib/billing-processor.ts');

  it('the union still has both members', () => {
    const u = ["'st", "ripe'", " | ", "'do", "do'"].join('');
    expect(processor(), 'the billing processor union was edited by a copy sweep')
      .toContain(u);
  });

  it('and the action that blocks on it still exists', () => {
    const src = processor();
    expect(src).toMatch(/export (function|const) blocks/);
    expect(src).toMatch(/billingActionUnavailable/);
  });
});

/* ═══ 8 · no-regression: the route named in a comment is real ═════════════ */

describe('8 - /api/stripe/cancel-partnership still exists', () => {
  /**
   * `giving-data.ts` mentions this route in a COMMENT, and two components post
   * to it. It is a real endpoint a member uses to stop a recurring gift; a
   * sweep that deleted the reference would break the button and leave the route
   * orphaned. Reported, not removed.
   */
  const ROUTE = ['/api/', 'str', 'ipe/', 'cancel-partnership'].join('');

  it('the route file is on disk', () => {
    expect(() => read('src/app/api/stripe/cancel-partnership/route.ts')).not.toThrow();
  });

  it('both callers still post to it', () => {
    for (const file of ['src/components/Profile.tsx', 'src/components/PersonalInformationModal.tsx']) {
      expect(read(file), `${file} no longer reaches the cancel route`).toContain(ROUTE);
    }
  });

  it('and the comment in giving-data.ts that names it is still accurate', () => {
    expect(read('src/components/dashboard/giving-data.ts')).toContain(ROUTE);
  });
});
