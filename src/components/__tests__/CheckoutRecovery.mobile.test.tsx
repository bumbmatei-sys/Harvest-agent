// @vitest-environment node
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { expect, it } from 'vitest';
import { buildAppCss } from '../../test/support/tailwind-build';
import { MeasuringBrowser } from '../../test/support/browser-measure';
import CheckoutRecovery from '../CheckoutRecovery';

it('declined recovery fits a phone and every action meets the touch floor', async () => {
  const css = await buildAppCss();
  const markup = renderToStaticMarkup(<CheckoutRecovery timedOut={false} busy={false} error="" onRetry={() => {}} onTryAgain={() => {}} />);
  const path = '/tmp/harvest-declined-mobile.html';
  writeFileSync(path, `<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"><style>${css}\n*,*::before,*::after{transition:none!important;animation:none!important}</style></head><body>${markup}</body></html>`);
  const browser = new MeasuringBrowser();
  try {
    await browser.open(pathToFileURL(path).href);
    const result = await browser.evaluateAt<{ width: number; scroll: number; heights: number[] }>(390,
      `({width:innerWidth,scroll:document.documentElement.scrollWidth,heights:[...document.querySelectorAll('button,a')].map(e=>e.getBoundingClientRect().height)})`, 844);
    expect(result.scroll).toBeLessThanOrEqual(result.width);
    expect(result.heights).toHaveLength(3);
    for (const height of result.heights) expect(height).toBeGreaterThanOrEqual(44);
  } finally { await browser.close(); }
}, 60_000);
