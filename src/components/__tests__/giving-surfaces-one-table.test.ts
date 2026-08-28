import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { GIVING_PROVIDERS, GIVING_PROVIDER_IDS } from '../donations/giving-providers';

/**
 * THE-254 — 🔴 THE GIVE PAGE AND THE CAMPAIGNS READ THE SAME TABLE.
 *
 * The founder asked for Revolut and Wise "in the fundraising", and THE-251 had
 * already put the church's own links on campaigns as well as on the Give page.
 * Two surfaces showing giving options is two chances to disagree: a church that
 * adds Revolut sees it on one page and not the other, or sees it in a different
 * position, and a member who learned "Revolut is the fifth one" on the campaign
 * page taps the fifth one on the Give page and sends money somewhere else.
 *
 * ⚠️ SOURCE-LEVEL, DELIBERATELY, and for the same reason
 * manual-giving-disclosures.test.ts is. The property is a relationship BETWEEN
 * surfaces — that neither owns a provider list — and it is not observable by
 * mounting either one of them: a second hard-coded list renders perfectly and
 * agrees with the table right up until the table changes. What each surface
 * actually draws is asserted against real output in the suites that own it
 * (MainApp.giving-rails, CampaignWidget.giving-links, PublicCampaign.giving-links),
 * and all three of those now range over `GIVING_PROVIDERS`.
 */

const SRC = path.resolve(__dirname, '..', '..');
const read = (file: string) => readFileSync(path.join(SRC, file), 'utf8');

/** Every surface that puts a church's own payment links in front of a member. */
const SURFACES = {
  'the Give page (member app)': 'components/MainApp.tsx',
  'the Give tab itself': 'components/PartnerWithUsTab.tsx',
  'a campaign in the news feed': 'components/CampaignWidget.tsx',
  'a public campaign page': 'components/PublicCampaign.tsx',
  'the public campaign route': 'app/campaign/[campaignId]/page.tsx',
} as const;

type Surface = keyof typeof SURFACES;
const NAMES = Object.keys(SURFACES) as Surface[];

describe('every giving surface derives from the one provider table', () => {
  it('🔴 no surface carries a provider list of its own', () => {
    // The failure this catches is a second list drifting from the first. Any
    // surface naming a provider id in its own source is building a roster
    // rather than reading one.
    for (const name of NAMES) {
      const src = read(SURFACES[name])
        .replace(/\/\*[\s\S]*?\*\//g, ' ')
        .replace(/^[ \t]*\/\/[^\n]*$/gm, ' ');
      for (const id of GIVING_PROVIDER_IDS) {
        expect(src, `${name} names the provider "${id}" itself instead of reading the table`)
          .not.toMatch(new RegExp(`['"\`]${id}['"\`]`));
      }
    }
  });

  it('every surface resolves its links through readGivingLinks', () => {
    // 🔴 Not merely "imports the table". `readGivingLinks` is what re-validates
    // a stored URL against its provider's allow-list on READ, and it is what
    // imposes table order. A surface that read `config.givingLinks` directly
    // would render an unchecked href in the table's order by accident.
    //
    // ⚠️ Only the three that RESOLVE. `PartnerWithUsTab` and `PublicCampaign`
    // are handed an already-validated `PublishedGivingLink[]` by MainApp and by
    // the campaign route respectively — which is the point: the validation
    // happens once per surface, at the boundary, and never in a renderer.
    const resolvers: Surface[] = [
      'the Give page (member app)',
      'a campaign in the news feed',
      'the public campaign route',
    ];
    for (const name of resolvers) {
      expect(read(SURFACES[name]), `${name} does not resolve links through readGivingLinks`)
        .toMatch(/readGivingLinks/);
    }
    // And the two renderers take them as resolved input rather than re-deriving
    // them from a raw config — a second resolver is a second chance to skip the
    // allow-list.
    for (const name of ['the Give tab itself', 'a public campaign page'] as Surface[]) {
      expect(read(SURFACES[name]), `${name} re-derives links instead of being handed them`)
        .not.toMatch(/readGivingLinks\s*\(/);
      expect(read(SURFACES[name]), `${name} does not take resolved links`)
        .toMatch(/PublishedGivingLink/);
    }
  });

  it('every surface draws them with the one shared component', () => {
    // GivingLinks owns the row, the monogram, the rel tokens and the member's
    // half of the disclosure. A second renderer is a second set of all four.
    const renderers: Surface[] = [
      'the Give tab itself',
      'a campaign in the news feed',
      'a public campaign page',
    ];
    for (const name of renderers) {
      expect(read(SURFACES[name]), `${name} does not render through GivingLinks`)
        .toMatch(/<GivingLinks/);
    }
  });

  it('🔴 the shared component special-cases no provider', () => {
    // The moment one row needs an `if`, the table has stopped being the
    // extension point and the next provider is a component change again.
    const src = read('components/donations/GivingLinks.tsx')
      .replace(/\/\*[\s\S]*?\*\//g, ' ')
      .replace(/^[ \t]*\/\/[^\n]*$/gm, ' ');
    for (const id of GIVING_PROVIDER_IDS) {
      expect(src, `GivingLinks branches on "${id}"`).not.toMatch(new RegExp(`['"\`]${id}['"\`]`));
    }
  });

  it('so all six providers reach both the Give page and campaigns', () => {
    // The claim the two facts above add up to, stated once so a reader does not
    // have to derive it: one table, one resolver, one renderer, both surfaces.
    expect(GIVING_PROVIDER_IDS).toEqual(['paypal', 'cashapp', 'venmo', 'zelle', 'revolut', 'wise']);
    expect(GIVING_PROVIDERS).toHaveLength(6);
  });
});
