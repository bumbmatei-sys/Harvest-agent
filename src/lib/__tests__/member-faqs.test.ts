import { describe, it, expect } from 'vitest';
import { existsSync } from 'node:fs';
import path from 'node:path';

import { MEMBER_FAQS, type MemberFAQ } from '../member-faqs';
import { PLAN_DISPLAY_NAMES, PLAN_PRICING } from '../../utils/plan-features';

/**
 * THE MEMBER FAQ IS A PRODUCT CLAIM, NOT DECORATION.
 *
 * The FAQ this replaced described a different product: a curriculum Harvest
 * does not ship, a "Church Partner Portal" that does not exist, an AI
 * "locally trained" on curated theology, conversations used "to improve the
 * accuracy" of its answers — the same claim that had to be removed from the
 * privacy policy — and "100% free for the user", which contradicts the
 * pricing Harvest submitted to its payment processor for compliance review.
 *
 * Four features have shipped that were described before they existed. These
 * tests are the mechanical half of not doing it again: they cannot tell
 * whether an answer is TRUE, but they can refuse the specific false claims
 * that were there, and refuse the whole category of pricing talk that a
 * member — who never pays Harvest anything — must not be shown.
 *
 * The judgement half is the `sources` list on each entry, checked below.
 */

const ROOT = path.resolve(__dirname, '../../..');

/** Every string a reader can actually see, per entry. */
function visibleText(faq: MemberFAQ): string {
  return [faq.question, ...faq.answer].join('\n');
}

interface BannedPhrase {
  /** Named in the failure message — a regression must say WHAT it reintroduced. */
  name: string;
  pattern: RegExp;
  /** Why it is banned, so a future reader can tell a rule from a preference. */
  because: string;
}

/**
 * The six false claims from the old FAQ, plus the pricing vocabulary that has
 * no business on a member's screen. Patterns are case-insensitive: the point
 * is to catch the claim coming back, not one spelling of it.
 */
const BANNED: readonly BannedPhrase[] = [
  {
    name: '"free"',
    pattern: /\bfree\b/i,
    because:
      'The old FAQ said the app is "100% free for the user". Harvest is a paid product and the claim contradicts the pricing filed with the payment processor. A member pays nothing because their MINISTRY pays — which is not the same statement and must not be compressed into one.',
  },
  {
    name: '"Billion Soul"',
    pattern: /billion\s+soul/i,
    because: 'Named a funding model — donor partners underwriting free access — that does not exist.',
  },
  {
    name: '"Partner Portal"',
    pattern: /partner\s+portal/i,
    because: 'A church-enrolment portal that was never built. Ministries are onboarded by an admin, not through a public portal.',
  },
  {
    name: '"locally trained"',
    pattern: /locally\s+trained/i,
    because:
      'The assistant is retrieval over the tenant\'s own uploads — Gemini embeddings, MiMo completions. Nothing is trained or fine-tuned locally or otherwise.',
  },
  {
    name: '"improve the accuracy"',
    pattern: /improve\s+the\s+accuracy/i,
    because:
      'Member conversations are NOT used to improve the assistant. This exact claim was removed from the privacy policy for being untrue; it must not survive in the FAQ.',
  },
];

/**
 * Pricing vocabulary. Derived from `plan-features.ts` where possible so a
 * repricing cannot leave this list stale.
 *
 * ⚠️ `PLAN_DISPLAY_NAMES.max` is 'Ministry', which is ALSO the ordinary
 * user-facing word for a church (AGENTS.md: "Ministries" NOT "churches"), and
 * the FAQ uses it in that sense throughout. Banning it would ban the correct
 * copy. The other two display names are unambiguous and are banned; a leak of
 * the top tier's name specifically is accepted as the cost of the collision.
 */
const AMBIGUOUS_PLAN_NAME = PLAN_DISPLAY_NAMES.max; // 'Ministry' — see above.

const PRICING_BANNED: readonly BannedPhrase[] = [
  {
    name: 'a currency amount',
    pattern: /[$£€]\s?\d/,
    because: 'A member has no subscription. Any price on this screen reads as a charge to them.',
  },
  {
    name: 'a per-month price',
    pattern: new RegExp(`\\b(${Object.values(PLAN_PRICING).flatMap((p) => Object.values(p)).join('|')})\\s*(?:usd|dollars|/\\s*mo|per\\s+month|a\\s+month)`, 'i'),
    because: 'Same reason, without the currency symbol.',
  },
  ...Object.values(PLAN_DISPLAY_NAMES)
    .filter((name) => name !== AMBIGUOUS_PLAN_NAME)
    .map((name) => ({
      name: `the plan name "${name}"`,
      pattern: new RegExp(`\\b${name.replace(/\s+/g, '\\s+')}\\b`, 'i'),
      because: 'Plan names belong to the buyer\'s screens, not the member\'s.',
    })),
  {
    name: 'a plan id',
    pattern: /\b(plus|pro|max)\b/i,
    because: 'Internal tier ids leaking into member copy.',
  },
  {
    name: 'billing vocabulary',
    pattern: /\b(subscription|subscribe|trial|refunds?|invoice|billing|upgrade|checkout\s+price|per\s+seat)\b/i,
    because:
      'Pricing, plans, trials, billing and refunds are answered on theharvest.site. A member has no subscription, so answering here would invent a relationship they do not have.',
  },
];

/** Every banned phrase found in `text`, named. Empty array = clean. */
function scan(text: string, rules: readonly BannedPhrase[] = [...BANNED, ...PRICING_BANNED]): string[] {
  return rules.filter((r) => r.pattern.test(text)).map((r) => r.name);
}

describe('member FAQ — the false claims must not come back', () => {
  for (const rule of BANNED) {
    it(`no entry contains ${rule.name} — ${rule.because}`, () => {
      const offenders = MEMBER_FAQS.filter((faq) => rule.pattern.test(visibleText(faq))).map(
        (faq) => faq.question,
      );
      expect(offenders, `${rule.name} reappeared in: ${offenders.join(' | ')}`).toEqual([]);
    });
  }
});

describe('member FAQ — nothing about price, plans or billing', () => {
  for (const rule of PRICING_BANNED) {
    it(`no entry mentions ${rule.name} — ${rule.because}`, () => {
      const offenders = MEMBER_FAQS.filter((faq) => rule.pattern.test(visibleText(faq))).map(
        (faq) => faq.question,
      );
      expect(offenders, `${rule.name} appeared in: ${offenders.join(' | ')}`).toEqual([]);
    });
  }

  it('bans every plan display name except the one that collides with the word for a church', () => {
    // Pins the exemption so that if PLAN_DISPLAY_NAMES is renamed, whoever
    // renames it is told this carve-out exists rather than discovering that
    // the FAQ silently stopped being checked for a plan name.
    expect(AMBIGUOUS_PLAN_NAME).toBe('Ministry');
    const banned = Object.values(PLAN_DISPLAY_NAMES).filter((n) => n !== AMBIGUOUS_PLAN_NAME);
    expect(banned.sort()).toEqual(['Individual', 'Small Team']);
  });
});

/**
 * 🔴 THE MUTATION TEST.
 *
 * The guard above only earns its keep if it actually fires. This feeds it the
 * real answers that were removed and asserts each is caught BY NAME — so a
 * future edit that weakens a pattern (say, to `/100% free/`) fails here
 * instead of quietly letting the next "free" claim through.
 */
describe('member FAQ — the guard catches the copy it was built for', () => {
  const REMOVED = {
    '100% free': 'The core curriculum, Harvest AI, and the Church Map are 100% free for the user. This is made possible by the generosity of partners who believe in the Billion Soul Harvest.',
    'locally trained AI': 'Harvest AI is locally trained using healthy, trusted theological resources.',
    'conversations improve the AI': 'Your interactions with Harvest AI are used solely to help you grow and to improve the accuracy of the theological guidance provided.',
    'partner portal': 'You can enroll through our Church Partner Portal. Once verified, your location will be visible to new converts in your immediate area.',
  } as const;

  it('flags the "100% free" answer by name', () => {
    const hits = scan(REMOVED['100% free']);
    expect(hits).toContain('"free"');
    expect(hits).toContain('"Billion Soul"');
  });

  it('flags the "locally trained" answer by name', () => {
    expect(scan(REMOVED['locally trained AI'])).toContain('"locally trained"');
  });

  it('flags the "improve the accuracy" answer by name', () => {
    expect(scan(REMOVED['conversations improve the AI'])).toContain('"improve the accuracy"');
  });

  it('flags the Partner Portal answer by name', () => {
    expect(scan(REMOVED['partner portal'])).toContain('"Partner Portal"');
  });

  it('flags a price and a plan name', () => {
    expect(scan('The Small Team plan is $99/mo.')).toEqual(
      expect.arrayContaining(['a currency amount', 'the plan name "Small Team"']),
    );
  });

  it('passes clean member copy', () => {
    // Every shipped answer, as one body of text: the guard must be quiet.
    expect(scan(MEMBER_FAQS.map(visibleText).join('\n'))).toEqual([]);
  });
});

/**
 * The judgement half. A test cannot check that an answer is true, but it can
 * refuse an answer that names no place to check it — which is how the four
 * invented features got in.
 */
describe('member FAQ — every answer names where it was verified', () => {
  it('covers the seven member questions', () => {
    expect(MEMBER_FAQS).toHaveLength(7);
  });

  it('gives every entry a question and at least one paragraph', () => {
    for (const faq of MEMBER_FAQS) {
      expect(faq.question.trim().length, `empty question: ${faq.question}`).toBeGreaterThan(0);
      expect(faq.answer.length, `no answer: ${faq.question}`).toBeGreaterThan(0);
      for (const p of faq.answer) {
        expect(p.trim().length, `empty paragraph in: ${faq.question}`).toBeGreaterThan(0);
      }
    }
  });

  it('names at least one source file per entry, and every one of them exists', () => {
    for (const faq of MEMBER_FAQS) {
      expect(faq.sources.length, `no sources for: ${faq.question}`).toBeGreaterThan(0);
      for (const src of faq.sources) {
        expect(
          existsSync(path.join(ROOT, src)),
          `${faq.question} cites a file that does not exist: ${src}`,
        ).toBe(true);
      }
    }
  });
});
