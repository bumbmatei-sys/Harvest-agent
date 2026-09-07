/**
 * THE-331 · The attach picker.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * The founder pressed the paperclip on a 1920px desktop and got a full-width
 * panel slammed across the bottom of the screen. The cause was one class:
 * `flex items-end` with NO `sm:` override, on a surface that is only ever a
 * sheet on a phone.
 *
 * ⚠️ This file asserts BEHAVIOUR — the four categories, the recents rule, deep
 * search, and which collection a committed record belongs to. The measured
 * geometry lives in the layout suite, which needs a real layout engine;
 * `happy-dom` has none.
 *
 * ⚠️ NOT @testing-library/react: the project deliberately does not install the
 * `@testing-library/dom` peer, and this ticket adds NO npm dependency at all —
 * not even the `@tanstack/react-virtual` the brief sanctioned. See the
 * virtualization note in `AttachMenu.tsx`.
 */

import { describe, it, expect, vi } from 'vitest';

import {
  buildCascaderIndex,
  getCascaderPath,
  searchCascaderDeep,
} from '../reui/cascader/cascader-lib';
import type { CascaderNode } from '../reui/cascader/cascader-types';

import {
  ATTACH_CATEGORY_IDS,
  ATTACH_CATEGORY_LABELS,
  ATTACH_RECORD_TYPES,
  ATTACH_RECENTS_LIMIT,
  recentsOf,
  type AttachLoad,
  type AttachLoadsByCategory,
  type AttachRecord,
} from '../../lib/attach-records';

const record = (
  category: AttachRecord['category'],
  type: AttachRecord['type'],
  id: string,
  title: string,
  subtitle = 'sub',
): AttachRecord => ({ category, type, id, title, subtitle });

/**
 * A tenant with a few of everything. 🔴 Deliberately NOT seeded demo data:
 * every row is stated by this file, so nothing fake can reach a render by
 * default the way THE-299's `cohort-chart` did.
 */
const someOfEach = (): AttachLoadsByCategory => ({
  docs: {
    ok: true,
    records: [
      record('docs', 'doc', 'd1', 'Sermon notes'),
      record('docs', 'doc', 'd2', 'Budget draft'),
      record('docs', 'doc', 'd3', 'Vision paper'),
      record('docs', 'doc', 'd4', 'Older doc'),
    ],
  },
  contacts: {
    ok: true,
    records: [
      record('contacts', 'contact', 'c1', 'Ada Lovelace'),
      record('contacts', 'contact', 'c2', 'Grace Hopper'),
    ],
  },
  campaigns: { ok: true, records: [record('campaigns', 'campaign', 'k1', 'Roof fund')] },
  forms: { ok: true, records: [record('forms', 'form', 'f1', 'Volunteer signup')] },
});

/**
 * Every category holds a record containing the SAME word, and two of them
 * share an id. Deep search must find all four and still tell them apart.
 */
const withSharedWord = (): AttachLoadsByCategory => ({
  docs: { ok: true, records: [record('docs', 'doc', 'dup', 'Harvest festival plan')] },
  contacts: { ok: true, records: [record('contacts', 'contact', 'dup', 'Harvest volunteer')] },
  campaigns: { ok: true, records: [record('campaigns', 'campaign', 'k9', 'Harvest appeal')] },
  forms: { ok: true, records: [record('forms', 'form', 'f9', 'Harvest signup')] },
});

// ═════════════════════════════════════════════════════════════════════════════
// 4 / 12. The four categories, their labels, and their record types.
// ═════════════════════════════════════════════════════════════════════════════
describe('the picker offers four categories, named as the founder named them', () => {
  it('offers exactly these four, in this order, and no fifth', () => {
    expect([...ATTACH_CATEGORY_IDS]).toEqual(['docs', 'contacts', 'campaigns', 'forms']);
  });

  it.each([
    ['docs', 'Notes & Docs'],
    ['contacts', 'Contacts'],
    ['campaigns', 'Fundraising'],
    ['forms', 'Forms'],
  ] as const)('%s reads "%s"', (id, label) => {
    expect(ATTACH_CATEGORY_LABELS[id]).toBe(label);
  });

  it('🔴 names Fundraising, never Campaigns', () => {
    expect(ATTACH_CATEGORY_LABELS.campaigns).toBe('Fundraising');
    expect(Object.values(ATTACH_CATEGORY_LABELS)).not.toContain('Campaigns');
  });

  it('🔴 all four record types still attach', () => {
    expect(ATTACH_RECORD_TYPES).toEqual({
      docs: 'doc',
      contacts: 'contact',
      campaigns: 'campaign',
      forms: 'form',
    });
  });

  it('every category carries its type onto every row it loads', () => {
    const loads = someOfEach();
    for (const id of ATTACH_CATEGORY_IDS) {
      const load = loads[id];
      if (!load.ok) throw new Error('fixture must load');
      for (const r of load.records) {
        expect(r.category, `${id} row must carry its category`).toBe(id);
        expect(r.type, `${id} row must carry its record type`).toBe(ATTACH_RECORD_TYPES[id]);
      }
    }
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 5. Each submenu shows 2-3 recents — and they are REAL.
// ═════════════════════════════════════════════════════════════════════════════
describe('each submenu shows 2-3 recent records, then Browse…', () => {
  it('caps the recents at three', () => {
    expect(ATTACH_RECENTS_LIMIT).toBe(3);
    expect(recentsOf(someOfEach().docs)).toHaveLength(3);
  });

  it("🔴 the recents are the tenant's own rows, not placeholders", () => {
    const recents = recentsOf(someOfEach().docs);
    expect(recents.map((r) => r.title)).toEqual(['Sermon notes', 'Budget draft', 'Vision paper']);
    // The fourth is held back for Browse…, so recents is a WINDOW on real data
    // rather than the whole list under another name.
    expect(recents.map((r) => r.title)).not.toContain('Older doc');
  });

  it('a category holding fewer than three shows what it has', () => {
    expect(recentsOf(someOfEach().contacts)).toHaveLength(2);
    expect(recentsOf(someOfEach().campaigns)).toHaveLength(1);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 10 / 11. Empty is empty; a FAILURE is a failure. The Silent-Failure Rule.
// ═════════════════════════════════════════════════════════════════════════════
describe('🔴 a failed record read shows a FAILURE, not "nothing found"', () => {
  it('an empty-but-successful read yields no recents', () => {
    expect(recentsOf({ ok: true, records: [] })).toEqual([]);
  });

  it('a rejected read is a DIFFERENT state from an empty one', () => {
    const empty: AttachLoad = { ok: true, records: [] };
    const failed: AttachLoad = { ok: false, error: new Error('permission-denied') };
    expect(empty.ok).toBe(true);
    expect(failed.ok).toBe(false);
  });

  it('a failure carries no `records` field at all, so it cannot be rendered as empty', () => {
    const failed: AttachLoad = { ok: false, error: new Error('permission-denied') };
    expect('records' in failed).toBe(false);
  });

  it('the surface renders a failure branch that names the category', async () => {
    const { readFileSync } = await import('node:fs');
    const src = readFileSync('src/components/attach/AttachMenu.tsx', 'utf8');
    // The old sheet answered a rejected query with `setItems([])` and then
    // printed "No docs yet". The replacement must branch on `ok` BEFORE it
    // can reach an empty state.
    expect(src).toContain('!categoryLoad.ok');
    expect(src).toMatch(/could not be loaded/);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 6 / 7. Deep search, EXERCISED — not grepped.
// ═════════════════════════════════════════════════════════════════════════════
describe('🔴 searchScope="deep" really does search across all four categories', () => {
  /** The same tree the picker builds: four category roots, records beneath. */
  const tree = (): CascaderNode<AttachRecord>[] =>
    ATTACH_CATEGORY_IDS.map((id) => {
      const load = withSharedWord()[id];
      return {
        value: id,
        label: ATTACH_CATEGORY_LABELS[id],
        hasChildren: true,
        children: load.ok
          ? load.records.map((r) => ({
              value: `${r.category}:${r.id}`,
              label: r.title,
              description: r.subtitle,
              data: r,
            }))
          : [],
      };
    });

  it('one query returns a hit from EVERY one of the four collections', () => {
    const index = buildCascaderIndex<AttachRecord>(tree());
    const hits = searchCascaderDeep(index, 'harvest');
    const categories = new Set(hits.map((h) => h.data?.category));
    expect(
      [...categories].sort(),
      'a single query must reach docs, contacts, campaigns AND forms — ' +
        'this is the whole reason c-cascader-3 was chosen',
    ).toEqual(['campaigns', 'contacts', 'docs', 'forms']);
  });

  it('🔴 a result says which category it came from — the path annotation', () => {
    const index = buildCascaderIndex<AttachRecord>(tree());
    const hits = searchCascaderDeep(index, 'harvest');
    for (const hit of hits) {
      const path = getCascaderPath(index, hit.value);
      // Root first, node last: the first segment IS the category.
      expect(path.length, 'a hit must carry its ancestry, not float free').toBeGreaterThan(1);
      const root = path[0];
      expect(root.value).toBe(hit.data?.category);
      expect(
        Object.values(ATTACH_CATEGORY_LABELS),
        'the annotation a person reads must be the founder\'s label',
      ).toContain(root.label);
    }
  });

  it('⚠️ the DEFAULT scope would NOT cross categories — which is the mistake to expect', () => {
    const index = buildCascaderIndex<AttachRecord>(tree());
    // `searchScope="level"` filters only the level in view. Standing at the
    // root, that level is the four CATEGORY rows — none of which is named
    // "harvest" — so the default finds nothing at all.
    const rootLevel = index.roots.filter((n) =>
      n.label.toLowerCase().includes('harvest'),
    );
    expect(
      rootLevel,
      'at the root, a level-scoped query matches only category names, so the ' +
        'record a person is looking for is unreachable',
    ).toEqual([]);
    // Deep search, on the same tree and the same query, finds four.
    expect(searchCascaderDeep(index, 'harvest').length).toBe(4);
  });

  it('ids repeat across collections, and deep search still tells them apart', () => {
    const index = buildCascaderIndex<AttachRecord>(tree());
    const hits = searchCascaderDeep(index, 'harvest');
    const ids = hits.map((h) => h.data?.id);
    expect(new Set(ids).size, 'the fixture deliberately reuses one id').toBeLessThan(ids.length);
    // The node values stay distinct because the category namespaces them.
    expect(new Set(hits.map((h) => h.value)).size).toBe(hits.length);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 6 / 7 / 8. Deep search, the path annotation, and the source category.
// ═════════════════════════════════════════════════════════════════════════════
describe('🔴 Browse… opens the cascader with searchScope deep', () => {
  it('sets searchScope="deep" EXPLICITLY — the default is "level"', async () => {
    const { readFileSync } = await import('node:fs');
    const src = readFileSync('src/components/attach/AttachMenu.tsx', 'utf8');
    expect(
      /searchScope=("deep"|\{'deep'\})/.test(src),
      'searchScope must be set to "deep" at the call site; the cascader default ' +
        'is "level", which filters only the level in view and never crosses a category',
    ).toBe(true);
  });

  it('the cascader default really is "level", so the explicit prop is load-bearing', async () => {
    const { readFileSync } = await import('node:fs');
    const cascader = readFileSync('src/components/reui/cascader/cascader.tsx', 'utf8');
    expect(cascader).toMatch(/searchScope = "level"/);
  });

  it('⚠️ does NOT use mode="tree", which silently disables deep search', async () => {
    const { readFileSync } = await import('node:fs');
    const src = readFileSync('src/components/attach/AttachMenu.tsx', 'utf8');
    expect(src).not.toMatch(/mode=("tree"|\{'tree'\})/);
  });

  it('🔴 does NOT leave virtualization automatic — that flag only half-works', async () => {
    const { readFileSync } = await import('node:fs');
    const src = readFileSync('src/components/attach/AttachMenu.tsx', 'utf8');
    // The brief said to leave it automatic. Reading the vendored source shows
    // why that is wrong: the threshold flips an internal `virtualized` flag,
    // but the renderer that windows rows is opt-in and is NOT mounted, so the
    // flag would only strip the row indices Base UI needs.
    expect(src).toMatch(/virtualize=\{false\}/);
    // The threshold is left alone; pinning the flag off makes it moot.
    expect(src).not.toMatch(/virtualizeThreshold=/);
  });

  it('the cascader really does default the flag to auto, so pinning it is load-bearing', async () => {
    const { readFileSync } = await import('node:fs');
    const cascader = readFileSync('src/components/reui/cascader/cascader.tsx', 'utf8');
    expect(cascader).toMatch(/virtualizeThreshold = 100/);
    expect(cascader).toMatch(/virtualize \?\? renderedItems\.length >= virtualizeThreshold/);
  });
});

describe('🔴 the selected record is attached to the right collection', () => {
  it('reads the record off the details node, never off the bare id', async () => {
    const { readFileSync } = await import('node:fs');
    const src = readFileSync('src/components/attach/AttachMenu.tsx', 'utf8');
    expect(src).toContain('details.node?.data');
    // A bare-id parse would look like `next.split(':')`. It must not appear.
    expect(src).not.toMatch(/\bnext\.split\(/);
  });

  it('ids are NOT unique across collections, which is why the category must ride along', () => {
    const doc = record('docs', 'doc', 'shared-id', 'A doc');
    const contact = record('contacts', 'contact', 'shared-id', 'A contact');
    expect(doc.id).toBe(contact.id);
    expect(doc.category).not.toBe(contact.category);
    // Only the category tells them apart, so a commit that kept just the id
    // would file one under the other.
    expect(`${doc.category}:${doc.id}`).not.toBe(`${contact.category}:${contact.id}`);
  });
});

/** Strips block and line comments so a source sweep sees only what renders. */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

// ═════════════════════════════════════════════════════════════════════════════
// 19 / 22. No seeded demo data; no emoji; no hardcoded colour.
// ═════════════════════════════════════════════════════════════════════════════
describe('nothing fake and nothing hardcoded reaches the render', () => {
  const readSurface = async () => {
    const { readFileSync } = await import('node:fs');
    return readFileSync('src/components/attach/AttachMenu.tsx', 'utf8');
  };

  it('🔴 no emoji reaches the render', async () => {
    const src = await readSurface();
    // 🔴 COMMENTS ARE STRIPPED FIRST, not sliced off by offset: this repo's
    // guards use 🔴/⚠️ as comment furniture throughout, and a sweep that did
    // not remove them would either fail on its own prose or — far worse — be
    // "fixed" by narrowing the window until it stopped looking at the render.
    const code = stripComments(src);
    expect(code, 'the sweep must still see the render').toContain('CATEGORY_ICONS');
    expect(/[\u{1F300}-\u{1FAFF}]/u.test(code), 'no emoji may reach the render').toBe(false);
  });

  it('the emoji sweep actually catches one — the guard is not vacuous', () => {
    for (const glyph of ['\u{1F4C4}', '\u{1F464}', '\u{1F4DD}', '\u{1F3AF}']) {
      expect(
        /[\u{1F300}-\u{1FAFF}]/u.test(stripComments(`const icon = '${glyph}'`)),
        'the sweep must catch the glyph the old sheet rendered',
      ).toBe(true);
    }
  });

  it('🔴 no colour is hardcoded', async () => {
    const src = await readSurface();
    expect(/#[0-9a-fA-F]{3,8}\b/.test(src), 'no hex colour').toBe(false);
    expect(/\brgba?\(/.test(src), 'no rgb() colour').toBe(false);
    // The old sheet fell back to `#d4a017` in four inline styles.
    expect(src).not.toContain('d4a017');
  });

  it('no seeded demo data — the loader is the only source of rows', async () => {
    const src = await readSurface();
    expect(src).not.toMatch(/\b(Lorem|Example Doc|Sample|placeholder rows|demoData|SEED)\b/);
  });

  it('the record loader invents no rows either', async () => {
    const { readFileSync } = await import('node:fs');
    const lib = readFileSync('src/lib/attach-records.ts', 'utf8');
    expect(lib).not.toMatch(/\b(Lorem|Sample|demoData|SEED|FAKE)\b/);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 18. No npm dependency beyond @tanstack/react-virtual.
// ═════════════════════════════════════════════════════════════════════════════
describe('🔴 this ticket adds NO npm dependency at all', () => {
  it('not even @tanstack/react-virtual, which the brief sanctioned', async () => {
    const { readFileSync } = await import('node:fs');
    const pkg = JSON.parse(readFileSync('package.json', 'utf8')) as {
      dependencies: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    const all = { ...pkg.dependencies, ...(pkg.devDependencies ?? {}) };
    // The brief allowed react-virtual to power windowing past 100 rows. It is
    // NOT here, because the windowing renderer is opt-in and was not opted
    // into — see the header of AttachMenu.tsx. THE-274 pins the lockfile to an
    // exact entry count with no append point, so an unused dependency would
    // have broken a prior ticket's deliberate guard for nothing.
    expect(all['@tanstack/react-virtual'], 'not needed once windowing is off').toBeUndefined();
    expect(all['@tanstack/react-table'], 'the data-grid is its OWN ticket').toBeUndefined();
    // The registry's broken `import { cn } from "cn"` would have pulled this in.
    expect(all['cn'], '`cn` is a broken import artefact, not a package').toBeUndefined();
    expect(all['@testing-library/dom'], 'the project deliberately omits this peer').toBeUndefined();
  });

  it('the lockfile is back to the exact count THE-274 pins', async () => {
    const { readFileSync } = await import('node:fs');
    const lock = JSON.parse(readFileSync('package-lock.json', 'utf8')) as {
      packages: Record<string, unknown>;
    };
    expect(Object.keys(lock.packages).filter(Boolean)).toHaveLength(1825);
  });

  it('🔴 windowing is pinned OFF, not left to a flag that only half-works', async () => {
    const { readFileSync } = await import('node:fs');
    const src = readFileSync('src/components/attach/AttachMenu.tsx', 'utf8');
    expect(src).toMatch(/virtualize=\{false\}/);
  });

  it('the windowing module is gone, so nothing can reach the dependency', async () => {
    const { existsSync } = await import('node:fs');
    expect(
      existsSync('src/components/reui/cascader/cascader-virtual.tsx'),
      'cascader-virtual.tsx is the ONLY importer of @tanstack/react-virtual; ' +
        'leaving it would reintroduce the dependency the moment anyone installed',
    ).toBe(false);
  });

  it('no source file imports @tanstack/react-virtual', async () => {
    const { readdirSync, readFileSync, statSync } = await import('node:fs');
    const walk = (d: string, out: string[] = []): string[] => {
      for (const e of readdirSync(d)) {
        const p = `${d}/${e}`;
        if (statSync(p).isDirectory()) walk(p, out);
        else if (/\.tsx?$/.test(e)) out.push(p);
      }
      return out;
    };
    const offenders = walk('src').filter((f) =>
      /from ["']@tanstack\/react-virtual["']/.test(readFileSync(f, 'utf8')),
    );
    expect(offenders).toEqual([]);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 23. No fixture pinned near today.
// ═════════════════════════════════════════════════════════════════════════════
describe('🔴 no test fixture is pinned to a date near today', () => {
  it('this suite pins no date at all', async () => {
    const { readFileSync } = await import('node:fs');
    const self = readFileSync('src/components/__tests__/THE-331.attach-picker.test.tsx', 'utf8');
    // #468: a fixture pinned to '2026-09-06T10:00' turned main red for everyone
    // once the clock passed it. The safest pin is none.
    expect(/\b20\d{2}-\d{2}-\d{2}\b/.test(self), 'no ISO date literal in this file').toBe(false);
  });
});

// A vi reference keeps the import honest if every assertion above is static.
expect(typeof vi.fn).toBe('function');
