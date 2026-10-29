// @vitest-environment node
import { afterAll, expect, it } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { DiscoverCard } from '@/components/community/DiscoveryViews';
import { FollowUpSetting } from './FollowUpSetting';
import { QrCodeDialog } from './QrCodeDialog';
import { buildAppCss } from '@/test/support/tailwind-build';
import { MeasuringBrowser } from '@/test/support/browser-measure';
import { setUpOrFail } from '@/test/support/suite-setup';
const browser = new MeasuringBrowser();
const directory = mkdtempSync(path.join(tmpdir(), 'form-follow-up-mobile-'));
setUpOrFail(async () => {
  const markup = renderToStaticMarkup(<main className="mx-auto w-full max-w-md space-y-5 p-6">
    {(['community', 'product'] as const).map(type => <DiscoverCard key={type} kind={type} listing={{ tenantId: 'a', slug: 'grace', name: 'A welcoming community with a very long title', logoUrl: '', shortDescription: 'Learn together and meet new people.', memberCount: 1248, ratingAvg: 4.8, ratingCount: 24 }} action={{ href: 'https://grace.theharvest.app', label: type === 'community' ? 'Join' : 'View' }} />)}
    <FollowUpSetting value={null} onChange={() => {}} />
    <QrCodeDialog name="Sign-up page" url="https://theharvest.app/s/hello" />
  </main>);
  const file = path.join(directory, 'mobile.html');
  writeFileSync(file, `<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"><style>${await buildAppCss()} * { transition: none !important; animation: none !important; }</style></head><body>${markup}</body></html>`);
  await browser.open(`file://${file}`);
}, 60_000);
afterAll(async () => { await browser.close(); rmSync(directory, { recursive: true, force: true }); });
it('fits both Discover cards and the QR action at 390px with 44px targets', async () => {
  const result = await browser.evaluateAt<{ width: number; scrollWidth: number; targets: { width: number; height: number }[] }>(390, `(() => ({ width: innerWidth, scrollWidth: document.documentElement.scrollWidth, targets: [...document.querySelectorAll('a, button')].map(element => { const rect = element.getBoundingClientRect(); return { width: rect.width, height: rect.height }; }) }))()`);
  expect(result.width).toBe(390);
  expect(result.scrollWidth).toBeLessThanOrEqual(390);
  expect(result.targets).toHaveLength(4);
  for (const target of result.targets) { expect(target.width).toBeGreaterThanOrEqual(44); expect(target.height).toBeGreaterThanOrEqual(44); }
});
