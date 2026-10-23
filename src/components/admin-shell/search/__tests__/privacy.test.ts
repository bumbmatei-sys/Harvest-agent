import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { stripComments } from '../../../../__tests__/__fixtures__/the-346-strip-comments';

/**
 * What people search for, and the people and notes it finds, stay in this tab.
 * The palette's code may not log, report, persist or send any of it.
 *
 * The needles are assembled from fragments so this file never contains the
 * literal it greps for, and the scan runs over comment-stripped source.
 */
const dir = join(__dirname, '..');
const sources = readdirSync(dir)
  .filter((name) => /\.tsx?$/.test(name))
  .map((name) => ({ name, code: stripComments(readFileSync(join(dir, name), 'utf8')) }));

const FORBIDDEN: ReadonlyArray<readonly [string, RegExp]> = [
  ['console output', new RegExp(['console', '\\.'].join(''))],
  ['PostHog', new RegExp(['post', 'hog'].join(''), 'i')],
  ['product analytics helper', new RegExp(['track', 'Product', 'Event'].join(''))],
  ['analytics module', /@\/lib\/analytics/],
  ['Sentry', new RegExp(['sen', 'try'].join(''), 'i')],
  ['beacon', new RegExp(['send', 'Beacon'].join(''))],
  ['XMLHttpRequest', new RegExp(['XML', 'HttpRequest'].join(''))],
  ['a global network call', /(?<![.\w])(?:window\.)?fetch\(/],
  ['browser storage', new RegExp(['local', 'Storage|session', 'Storage|indexed', 'DB'].join(''))],
  ['a cookie', new RegExp(['document', '\\.cookie'].join(''))],
];

function violations(code: string): string[] {
  return FORBIDDEN.filter(([, pattern]) => pattern.test(code)).map(([label]) => label);
}

describe('palette search privacy', () => {
  it('scans the real files', () => {
    const names = sources.map((s) => s.name);
    for (const expected of ['AdminSearchPalette.tsx', 'sources.ts', 'content-index.ts', 'use-content-index.ts', 'firestore-read.ts', 'match.ts']) {
      expect(names).toContain(expected);
    }
    expect(sources.every((s) => s.code.length > 200)).toBe(true);
  });

  it('logs, reports, stores and sends nothing', () => {
    const found = sources.flatMap((s) => violations(s.code).map((v) => `${s.name}: ${v}`));
    expect(found).toEqual([]);
  });

  it('would catch each of those if it were there', () => {
    expect(violations('console.log(query)')).toEqual(['console output']);
    expect(violations("posthog.capture('search', { query })")).toEqual(['PostHog']);
    expect(violations("trackProductEvent('x')")).toEqual(['product analytics helper']);
    expect(violations('Sentry.captureMessage(query)')).toEqual(['Sentry']);
    expect(violations("navigator.sendBeacon('/x', query)")).toEqual(['beacon']);
    expect(violations("await fetch('/api/search?q=' + query)")).toEqual(['a global network call']);
    expect(violations("localStorage.setItem('recent', query)")).toEqual(['browser storage']);
    // A call through the injected reader is not a network call.
    expect(violations('await read(spec, tenantId)')).toEqual([]);
  });
});
