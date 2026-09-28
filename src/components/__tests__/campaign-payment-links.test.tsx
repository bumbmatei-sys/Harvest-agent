import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { useState } from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import PublicCampaign from '../PublicCampaign';
import PaymentLinkPicker from '../donations/PaymentLinkPicker';
import CampaignGivingOptions from '../donations/CampaignGivingOptions';
import { readGivingLinks, type PublishedGivingLink } from '../donations/giving-providers';

/**
 * What a donor sees on the public campaign page once a campaign has named
 * which of the ministry's links Donate should use. Links are built by the
 * real `readGivingLinks`, so a fixture cannot be more permissive than the
 * allow-list.
 */
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const CAMPAIGN = {
  id: 'camp1',
  title: 'Roof Fund',
  description: 'Help us fix the roof',
  coverImage: null,
  goal: 50000,
  raised: 18000,
  endDate: null,
};

const BRANDING = {
  givingLinks: {
    paypal: { url: 'https://paypal.me/testchurch', handle: 'testchurch' },
    revolut: { url: 'https://revolut.me/testchurch', handle: 'testchurch' },
    wise: { url: 'https://wise.com/pay/business/testchurch', handle: 'testchurch' },
    zelle: { email: 'test@example.test', handle: 'testchurch' },
  },
};

const ALL = readGivingLinks(BRANDING);

function link(id: string): PublishedGivingLink {
  const found = ALL.find((l) => l.provider.id === id);
  if (!found) throw new Error(`fixture has no ${id}`);
  return found;
}

let container: HTMLDivElement;
let root: Root;

async function mount(props: {
  links: readonly PublishedGivingLink[];
  showDonationForm?: boolean;
  directLink?: PublishedGivingLink | null;
  narrowed?: boolean;
}) {
  await act(async () => {
    root = createRoot(container);
    root.render(
      <PublicCampaign
        tenantId="t1"
        tenantName="Test Ministry"
        logo={null}
        primaryColor="var(--brand-color)"
        campaign={CAMPAIGN}
        links={props.links}
        showDonationForm={props.showDonationForm ?? false}
        directLink={props.directLink ?? null}
        narrowed={props.narrowed ?? false}
      />,
    );
  });
}

const providers = () =>
  [...container.querySelectorAll('[data-provider]')].map((el) => el.getAttribute('data-provider'));

const heading = () => container.querySelector('[data-testid="giving-links"] h3')?.textContent;

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
});

afterEach(async () => {
  await act(async () => { root?.unmount(); });
  container.remove();
});

describe('the public campaign page', () => {
  it('shows every link and no direct button when nothing was chosen', async () => {
    await mount({ links: ALL, narrowed: false });
    expect(container.querySelector('[data-testid="campaign-direct-donate"]')).toBeNull();
    expect(providers()).toEqual(['paypal', 'zelle', 'revolut', 'wise']);
    expect(heading()).toBe('Ways to give');
    expect(container.textContent).not.toContain('Select an amount');
  });

  it('opens the one chosen link directly', async () => {
    const revolut = link('revolut');
    await mount({ links: [revolut], directLink: revolut, narrowed: true });
    const donate = container.querySelector('[data-testid="campaign-direct-donate"]') as HTMLAnchorElement;
    expect(donate).not.toBeNull();
    expect(donate.tagName).toBe('A');
    expect(donate.getAttribute('href')).toBe('https://revolut.me/testchurch');
    expect(donate.getAttribute('target')).toBe('_blank');
    expect(donate.getAttribute('rel')).toContain('noopener');
    expect(donate.getAttribute('rel')).toContain('noreferrer');
    expect(donate.textContent).toContain('Donate with Revolut');
    expect(heading()).toBe('Payment details');
    expect(providers()).toEqual(['revolut']);
  });

  it('shows a chosen Zelle row and does not invent a redirect', async () => {
    await mount({ links: [link('zelle')], directLink: null, narrowed: true });
    expect(container.querySelector('[data-testid="campaign-direct-donate"]')).toBeNull();
    expect(container.textContent).toContain('test@example.test');
    expect(providers()).toEqual(['zelle']);
    const row = container.querySelector('[data-provider="zelle"]');
    expect(row?.tagName).not.toBe('A');
  });

  it('shows only the chosen providers when several are ticked', async () => {
    await mount({ links: [link('revolut'), link('wise')], narrowed: true });
    expect(container.querySelector('[data-testid="campaign-direct-donate"]')).toBeNull();
    expect(providers()).toEqual(['revolut', 'wise']);
    expect(heading()).toBe('Choose how to give');
    expect(container.textContent).not.toContain('PayPal');
  });

  it('draws no card form while card giving is off', async () => {
    await mount({ links: ALL, showDonationForm: false });
    expect(container.textContent).not.toContain('Select an amount');
    expect(container.textContent).not.toContain('Your email *');
    expect(container.textContent).not.toContain('Secure, encrypted payment.');
    const cardDonate = [...container.querySelectorAll('button')]
      .find((b) => /^Donate/.test((b.textContent || '').trim()));
    expect(cardDonate).toBeUndefined();
  });

  it('keeps the card form when the route says a card can be taken, even with a direct link', async () => {
    const revolut = link('revolut');
    await mount({ links: [revolut], directLink: revolut, narrowed: true, showDonationForm: true });
    expect(container.textContent).toContain('Select an amount');
    expect(container.textContent).toContain('Secure, encrypted payment.');
    expect(container.querySelector('[data-testid="campaign-direct-donate"]')).not.toBeNull();
    expect(heading()).toBe('Payment details');
  });
});

describe('PaymentLinkPicker', () => {
  it('renders one option per link under the caller attribute, and toggling adds then removes the id', async () => {
    const seen: string[][] = [];
    function Harness() {
      const [selected, setSelected] = useState<string[]>([]);
      return (
        <PaymentLinkPicker
          links={[link('paypal'), link('revolut')]}
          selected={selected}
          onChange={(next) => { seen.push(next); setSelected(next); }}
          title="Which links"
          help="Tick any"
          wrapperAttribute="data-event-provider-picker"
        />
      );
    }
    await act(async () => {
      root = createRoot(container);
      root.render(<Harness />);
    });
    const picker = container.querySelector('[data-event-provider-picker]');
    expect(picker).not.toBeNull();
    const options = [...picker!.querySelectorAll('[data-provider-option]')]
      .map((el) => el.getAttribute('data-provider-option'));
    expect(options).toEqual(['paypal', 'revolut']);
    for (const opt of picker!.querySelectorAll('[data-provider-option]')) {
      expect(opt.className).toMatch(/min-h-11/);
    }

    const box = container.querySelector('[data-provider-option="revolut"] [data-slot="checkbox"]') as HTMLElement;
    await act(async () => { box.dispatchEvent(new Event('click', { bubbles: true })); });
    expect(seen.at(-1)).toEqual(['revolut']);

    await act(async () => { box.dispatchEvent(new Event('click', { bubbles: true })); });
    expect(seen.at(-1)).toEqual([]);
  });
});

describe('CampaignGivingOptions', () => {
  async function show(props: {
    links: readonly PublishedGivingLink[];
    directLink?: PublishedGivingLink | null;
    narrowed?: boolean;
    showCardForm?: boolean;
  }) {
    await act(async () => {
      root = createRoot(container);
      root.render(
        <CampaignGivingOptions
          links={props.links}
          directLink={props.directLink ?? null}
          narrowed={props.narrowed ?? false}
          showCardForm={props.showCardForm ?? false}
          brandColor="var(--brand-color)"
        />,
      );
    });
  }

  const headingOf = () => container.querySelector('[data-testid="giving-links"] h3')?.textContent;
  const direct = () => container.querySelector('[data-testid="campaign-direct-donate"]') as HTMLAnchorElement | null;

  it('one link with a URL is a direct button plus its details', async () => {
    const revolut = link('revolut');
    await show({ links: [revolut], directLink: revolut, narrowed: true });
    expect(direct()?.getAttribute('href')).toBe('https://revolut.me/testchurch');
    expect(direct()?.getAttribute('target')).toBe('_blank');
    expect(direct()?.getAttribute('rel')).toContain('noopener');
    expect(direct()?.getAttribute('rel')).toContain('noreferrer');
    expect(direct()?.getAttribute('rel')).toContain('nofollow');
    expect(direct()?.textContent).toContain('Donate with Revolut');
    expect(headingOf()).toBe('Payment details');
  });

  it('a single Zelle link is details only', async () => {
    await show({ links: [link('zelle')], directLink: null, narrowed: true });
    expect(direct()).toBeNull();
    expect(container.textContent).toContain('test@example.test');
    expect(headingOf()).toBe('Choose how to give');
  });

  it('several chosen links are only those, under Choose how to give', async () => {
    await show({ links: [link('revolut'), link('wise')], narrowed: true });
    expect(direct()).toBeNull();
    expect(providers()).toEqual(['revolut', 'wise']);
    expect(headingOf()).toBe('Choose how to give');
  });

  it('no choice shows every link under Ways to give', async () => {
    await show({ links: ALL });
    expect(direct()).toBeNull();
    expect(headingOf()).toBe('Ways to give');
  });

  it('a card form above the links makes them Other ways to give', async () => {
    await show({ links: ALL, showCardForm: true });
    expect(headingOf()).toBe('Other ways to give');
  });
});
