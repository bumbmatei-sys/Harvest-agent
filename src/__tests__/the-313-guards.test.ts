import { describe, it, expect, beforeAll } from 'vitest';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import postcss from 'postcss';

import { buildAppCss } from '../test/support/tailwind-build';

/**
 * THE-313 — the static guards: what part 1 of the order of service was not
 * allowed to touch, and the house rules its new files have to keep.
 *
 * ⚠️ Nothing here shells out to `git show`, and no baseline is re-derived from
 * the repository at assertion time. Every value below is a literal computed
 * once when this file was written. A guard that recomputes its own baseline
 * cannot fail — it would simply describe whatever it was handed.
 */

const sha256 = (t: string | Buffer): string => createHash('sha256').update(t).digest('hex');
const REPO_ROOT = path.resolve(__dirname, '../..');
const read = (rel: string) => readFileSync(path.join(REPO_ROOT, rel), 'utf8');

/** Source with block and line comments stripped — the code, not the prose. */
const codeOf = (rel: string): string =>
  read(rel)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');

/**
 * Every production file THE-313 ADDS. Four, and the list is the claim.
 *
 * ⚠️ `ServicePlanRow.tsx` is split from the panel deliberately: it imports no
 * Firestore, react-query or app store, so the Chromium layout suite mounts the
 * REAL component instead of a replica of it. See that file's own header.
 */
const ADDED = [
  'src/components/events/service-plan.ts',
  'src/components/events/ServicePlanRow.tsx',
  'src/components/events/ServicePlanPanel.tsx',
  'src/hooks/queries/useServicePlanQueries.ts',
] as const;

/** The ONE existing production file it edits. */
const EDITED = 'src/components/AdminEvents.tsx';

/* ═══ 17 · firestore.rules and functions/ byte-identical ═════════════════════ */

/**
 * ⚠️ A SET per file, not a single digest, and #422/#434 are why. CI runs against
 * `refs/pull/N/merge` — this branch merged into `main` AS IT STANDS WHEN THE RUN
 * STARTS — so a file another ticket legitimately lands on holds a different
 * value on the merge ref than on this branch, and a single pin would fail for
 * the one reason it is not meant to detect.
 *
 * 🔴 APPENDED, NEVER SUBSTITUTED. `main` was red for everyone last week because
 * #434 replaced a digest instead of adding one. A value that is NEITHER — i.e.
 * this ticket editing the file — still fails, which is the entire threat.
 */
const UNTOUCHED: Record<string, ReadonlyArray<readonly [digest: string, source: string]>> = {
  /**
   * 🔴 A NAMED STOP CONDITION. `firestore.rules` AUTO-DEPLOYS TO PRODUCTION ON
   * MERGE and CI runs no emulator tests, so this ticket does not touch it —
   * even though the collection it adds NEEDS a rule and is `permission-denied`
   * without one. The rule is REPORTED instead, and section "the rule this
   * ticket needs" below pins the exact text so the ticket that deploys it does
   * not have to reconstruct it from prose.
   */
  'firestore.rules': [
    ['a1fb6148d58727e06a38c8a1cbb9828346255dea06254029839a65bf6b265499', 'main at 5f431e3, unchanged since 6c9425d'],
  ],
  /**
   * 🔴 `firestore.indexes.json` DOES NOT DEPLOY. `deploy-rules.yml` runs
   * `firestore:rules,storage` only and the workflow's `paths:` filter excludes
   * this file, so an index added here is INERT and the query that needed it
   * throws `failed-precondition` in production. This ticket adds none, which is
   * why every query it ships is a single `where` on one field with no
   * `orderBy` — see the "no composite index" section.
   */
  'firestore.indexes.json': [
    ['8ae29121ceb65f8fc06df89435829496cd06ee0abff98c1ad24f6f470da2c6b0', 'main at 5f431e3'],
  ],
  /**
   * 🔴 TEST 10 — the event write paths, pinned whole.
   *
   * `api/event-registration/submit` creates a CRM contact and `contactActivities`
   * rows. This ticket must not change what any existing write path stores, and
   * the strongest form of that for a route it never imports is a digest.
   */
  'src/app/api/event-registration/submit/route.ts': [
    ['0324b34c80861ea7e2ee61e40bba7b6ff6f8be72dbef43827e75837e08a5530e', 'main at 5f431e3, unchanged since c792d22'],
    // ⚠️ APPENDED, NOT SUBSTITUTED — the header's rule, and the one #434 broke.
    // THE-314 (#452) swapped this route's SMS import from `@/lib/twilio` to
    // `@/lib/sms-send` when it changed provider. ONE line, and it is an import:
    // `git diff` over the whole file for that commit is 1 insertion, 1 deletion,
    // and the `contactActivities` write this guard exists to protect is present
    // and unchanged either side. Verified byte-identical between this branch and
    // `origin/main`, so THE-313 did not touch it — this is exactly the merge-ref
    // drift the header describes, and appending is how it is absorbed.
    ['b0e55c91adcc9b342e4d16fc5cabfff1426842056e1f5bb9e0f47546fc41ed98', 'main at 8a4a909 — THE-314 (#452) swapped the SMS import to @/lib/sms-send'],
  ],
  'src/app/api/event-registration/apply-discount/route.ts': [
    ['47622ed746e6e3a652cd7ffab4bd5f434ff4f52fea94a14c5d3eb588ff3924e0', 'main at 5f431e3'],
  ],
  /**
   * The `Event` / `Registration` shapes and every query over them. The service
   * plan reads the event's `startDate` and NOTHING else from this module — it
   * adds no field to the event document, so this file has no business moving.
   */
  'src/hooks/queries/useEventQueries.ts': [
    ['30d41eb31170d0d20078a9666406fdf9fb5693caadbc9fea6ab8b21b9e64b119', 'main at 5f431e3'],
  ],
  /**
   * ✅ #413's drag mechanism. This ticket READ it and reimplemented the same
   * shape for a different list; it did not refactor it into something shared.
   * A shared abstraction over two lists whose only common part is four lines of
   * event wiring would have made this ticket touch the curriculum builder,
   * which is a screen it has no reason to risk.
   */
  'src/components/AdminCourseEditor.tsx': [
    ['d828dbf298ca353244e54715700da362a09f96e4d46078b09d54f71917fe56eb', 'main at 5f431e3'],
  ],
  /**
   * 🔴 "do NOT reuse `giving-share.ts`'s URL builder or loosen its host
   * validation". The run sheet emits no URL at all, so there was nothing to
   * reuse and nothing to loosen — pinned so that stays true.
   */
  'src/components/donations/giving-share.ts': [
    ['b28d762c711c016c57f593b83d70f131fe92f8418395a34bf1e644b06a1ae01b', 'main at 5f431e3'],
  ],
};

describe('firestore.rules, the indexes file and the event write paths are byte-identical', () => {
  it.each(Object.entries(UNTOUCHED))(
    '%s carries no edit from this ticket',
    (file, accepted) => {
      const actual = sha256(readFileSync(path.join(REPO_ROOT, file)));
      const match = accepted.find(([digest]) => digest === actual);
      expect(
        match,
        `${file} is at ${actual}, which is none of:\n  ` +
          accepted.map(([d, why]) => `${d} (${why})`).join('\n  '),
      ).toBeTruthy();
    },
  );

  it('functions/ is unchanged, file for file', () => {
    const out: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir)) {
        if (entry === 'node_modules' || entry === 'lib' || entry === '.git') continue;
        const p = path.join(dir, entry);
        if (statSync(p).isDirectory()) walk(p);
        else out.push(path.relative(REPO_ROOT, p));
      }
    };
    walk(path.join(REPO_ROOT, 'functions'));
    const files = out.sort();

    expect(files).toHaveLength(5);
    const tree = sha256(files.map((f) => `${f}:${sha256(readFileSync(path.join(REPO_ROOT, f)))}`).join('\n'));
    expect(tree).toBe('1a3a1c7f27699263bcdf5bd0320c7cb0803a6f76644952f631000bc9bedef2d7');
  });

  it('nothing this ticket adds mentions firestore.rules or functions/', () => {
    for (const file of [...ADDED, EDITED]) {
      expect(codeOf(file), file).not.toMatch(/firestore\.rules|['"]\.\.?\/functions\//);
    }
  });
});

/* ═══ The rule this ticket needs, and does not write ═════════════════════════ */

/**
 * 🔴 STOP CONDITION 2, DISCHARGED IN CODE AS WELL AS IN THE REPORT.
 *
 * `tenants/{t}/servicePlans` is governed by NOTHING today, so every read and
 * write this feature makes is `permission-denied` until a rule deploys. That is
 * default deny, which is the safe failure — but it is a failure, so the exact
 * rule is pinned here rather than left in prose that a later ticket has to find.
 *
 * ⚠️ The pin is on the TEXT of the rule this ticket asks for, and on the fact
 * that `firestore.rules` DOES NOT YET CONTAIN IT. When the rule lands, this
 * assertion flips and the ticket that lands it updates this block — which is
 * the visible handover, rather than a silent one.
 */
const REQUIRED_RULE = `      match /servicePlans/{planId} {
        allow read: if belongsToTenant(tenantId);
        allow write: if hasPermission('manageEvents', tenantId);
      }`;

describe('the firestore.rules rule this ticket needs is reported, not written', () => {
  it('firestore.rules does not yet govern servicePlans — the feature is denied until it does', () => {
    const rules = read('firestore.rules');
    expect(rules).not.toContain('servicePlans');
    expect(rules).not.toContain(REQUIRED_RULE);
  });

  it('the rule it needs is spelled from helpers firestore.rules already defines', () => {
    const rules = read('firestore.rules');
    // 🔴 No new helper. Both of these already exist and are used by sibling
    // collections, so the rule below adds no vocabulary to that file.
    expect(rules).toMatch(/function belongsToTenant\(/);
    expect(rules).toMatch(/function hasPermission\(/);
    // The write half is `events`' own permission, verbatim — planning a service
    // is the same authority as running the event it belongs to.
    expect(rules).toContain("allow write: if hasPermission('manageEvents', tenantId);");
    // The read half is NARROWER than `events`' (`isAuthenticated()`): a run
    // sheet names volunteers, so it is tenant-member material. `forms` already
    // reads exactly this way.
    expect(rules).toContain('allow read: if belongsToTenant(tenantId);');
  });

  it('and it belongs inside match /tenants/{tenantId}, beside events', () => {
    const rules = read('firestore.rules');
    const tenants = rules.indexOf('match /tenants/{tenantId} {');
    const events = rules.indexOf('match /events/{eventId} {', tenants);
    expect(tenants).toBeGreaterThan(-1);
    expect(events).toBeGreaterThan(tenants);
    // The rule text is a literal in this file so the ticket that deploys it can
    // paste it rather than reconstruct it.
    expect(REQUIRED_RULE.split('\n')).toHaveLength(4);
  });
});

/* ═══ 3 · No composite index is required, so none is missed ══════════════════ */

describe('no composite index would be required', () => {
  it('every Firestore query this ticket adds filters on ONE field with no orderBy', () => {
    const code = codeOf('src/hooks/queries/useServicePlanQueries.ts');
    const calls = [...code.matchAll(/query\(([\s\S]*?)\n\s*\);/g)].map((m) => m[1]);
    expect(calls.length, 'the query module stopped querying').toBeGreaterThanOrEqual(3);
    for (const call of calls) {
      expect((call.match(/where\(/g) || []).length,
        'a query combines two where clauses — that is a composite index').toBeLessThanOrEqual(1);
      expect(call, 'a query orders on the server — with a where that is a composite index')
        .not.toMatch(/\borderBy\b/);
    }
  });

  it('and none of the added files imports orderBy at all', () => {
    for (const file of ADDED) {
      expect(codeOf(file), `${file} imports orderBy`).not.toMatch(/\borderBy\b/);
    }
  });

  it('the indexes file gained no entry — it would be inert if it had', () => {
    const indexes = JSON.parse(read('firestore.indexes.json')) as { indexes: unknown[] };
    const text = JSON.stringify(indexes);
    expect(text).not.toContain('servicePlans');
  });
});

/* ═══ 16 · No new token, component or dependency ════════════════════════════ */

describe('no new token, component or dependency was added', () => {
  it('package.json is unchanged by this ticket', () => {
    const pkg = JSON.parse(read('package.json')) as {
      dependencies: Record<string, string>;
      devDependencies: Record<string, string>;
    };
    // ⚠️ REPORTED PREMISE DRIFT: the ticket says "`@dnd-kit` is NOT installed".
    // It IS — all three packages, and `AdminNavCustomizer.tsx` imports them.
    // The reorder here still does not use it (see `ServicePlanRow.tsx`), but
    // the assertion records what is true rather than what was assumed.
    expect(pkg.dependencies).toHaveProperty('@dnd-kit/core');
    expect(pkg.dependencies).toHaveProperty('@dnd-kit/sortable');
    // Nothing a run sheet might have reached for.
    for (const name of ['react-beautiful-dnd', 'react-sortable-hoc', 'dayjs', 'luxon', 'moment', 'uuid']) {
      expect(pkg.dependencies, `${name} was added`).not.toHaveProperty(name);
      expect(pkg.devDependencies, `${name} was added`).not.toHaveProperty(name);
    }
    // 🔴 And no Playwright. `browser-measure.ts` speaks CDP over the Chromium
    // already in CI, which is the whole reason it exists.
    expect(pkg.devDependencies).not.toHaveProperty('@playwright/test');
    expect(pkg.devDependencies).not.toHaveProperty('playwright');
  });

  it('no shadcn primitive was adopted, so no adopter list moves', () => {
    // 🔴 THE-272's lists for chart/table/pagination/progress and THE-274's
    // RECORDED_ADOPTERS are CLOSED. Appending an entry for a ticket that adopts
    // nothing would be a claim that is not true — worse than an absence.
    for (const file of ADDED) {
      expect(codeOf(file), `${file} adopts a ui/ primitive`)
        .not.toMatch(/from ['"](?:@\/components|\.{1,2}(?:\/[\w.-]+)*)\/ui\/[\w-]+['"]/);
    }
    // And the edited screen did not start adopting one either.
    expect(codeOf(EDITED)).not.toMatch(/from ['"][^'"]*\/ui\/[\w-]+['"]/);
  });

  it('the four new files import only modules that already existed', () => {
    const allowed = [
      'react', 'lucide-react', 'firebase/firestore', '@tanstack/react-query',
      '../../firebase', '../../utils/notify', '../../utils/query-helpers',
      '../layout/form-layout', './service-plan', './ServicePlanRow',
      '../../hooks/queries/useServicePlanQueries', '../../components/events/service-plan',
    ];
    for (const file of ADDED) {
      const specifiers = [...codeOf(file).matchAll(/from ['"]([^'"]+)['"]/g)].map((m) => m[1]);
      for (const spec of specifiers) {
        expect(allowed, `${file} imports ${spec}, which is not on this ticket's list`).toContain(spec);
      }
    }
  });

  it('no new design token is defined, and none is spelled that the stylesheet lacks', async () => {
    // The bridge has held with zero additions through #410/#416/#417/#419.
    for (const file of ADDED) {
      expect(codeOf(file), `${file} defines a CSS custom property`).not.toMatch(/--[a-z][\w-]*\s*:/);
      expect(codeOf(file), `${file} reads a raw custom property`).not.toMatch(/var\(--/);
    }
  });
});

/* ═══ 15 · No emoji, no hardcoded colour, all four palettes ═════════════════ */

describe('no emoji is rendered and no colour is hardcoded', () => {
  it.each(ADDED)('%s contains no hex or rgb/hsl/oklch literal', (file) => {
    const code = codeOf(file);
    expect(code).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(code).not.toMatch(/\b(?:rgba?|hsla?|oklch|oklab)\s*\(/);
  });

  it.each(ADDED)('%s renders no emoji', (file) => {
    // Pictographs and dingbats, not the whole of Extended Pictographic: `·` and
    // `—` are punctuation this codebase already uses in prose. ⚠️ The CODE is
    // scanned, not the file: these headers carry 🔴 and ⚠️ like every other
    // guard in this repo, and a comment is not a user-visible surface.
    const EMOJI = /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}\u{1F1E6}-\u{1F1FF}]/u;
    const found = codeOf(file).match(EMOJI);
    expect(found, `${file} renders ${found?.[0]}`).toBeNull();
  });

  it.each(ADDED)('%s carries no inline style — AdminEvents ratio culture', (file) => {
    expect(codeOf(file)).not.toMatch(/style=\{\{/);
    expect(codeOf(file)).not.toMatch(/\sstyle\s*=/);
  });

  it('and invents no width — form-layout.ts owns every one', () => {
    for (const file of ADDED) {
      const code = codeOf(file);
      // No arbitrary max-width and no max-w scale step anywhere in the new files.
      expect(code, `${file} spells a max-width`).not.toMatch(/\bmax-w-\[/);
      expect(code, `${file} spells a max-w scale step`).not.toMatch(/\bmax-w-(?:xs|sm|md|lg|xl|\dxl)\b/);
      // ⚠️ The ONE `w-[…]` these files may spell is the 44px TAP-TARGET
      // MINIMUM, which is an accessibility floor rather than a layout width —
      // `form-layout.ts` is explicitly a `sm:`-and-above module and has no
      // sub-`sm` spelling of it by design. Any other arbitrary width fails.
      const widths = [...code.matchAll(/\b(?:min-|max-)?w-\[[^\]]+\]/g)].map((m) => m[0]);
      expect(new Set(widths.filter((w) => w !== 'min-w-[44px]')),
        `${file} spells a width that is not the 44px tap-target minimum`).toEqual(new Set());
    }
    // The widths it DOES use are imported by name.
    expect(codeOf('src/components/events/ServicePlanRow.tsx')).toContain('FIELD_WIDTH');
    expect(codeOf('src/components/events/ServicePlanRow.tsx')).toContain('CONTROL_DENSITY');
  });

  /**
   * 🔴 EVERY COLOUR CLASS THE NEW FILES SPELL RESOLVES IN ALL FOUR PALETTES —
   * Classic first, since #409 made it the default.
   *
   * The four are two theme blocks times two families. A class naming a token
   * nothing declares makes its declaration invalid at computed-value time and
   * the browser drops it, so the control paints nothing at all — which is
   * exactly what an invented token name would do, silently.
   */
  describe('all four palettes resolve every colour this ticket spells', () => {
    let css: string;
    beforeAll(async () => { css = await buildAppCss(); }, 180_000);

    const PALETTES = [
      { name: 'Classic light', selector: '[data-palette="classic"][data-theme="light"]', beneath: [':root'] },
      {
        name: 'Classic dark',
        selector: '[data-palette="classic"].dark, [data-palette="classic"][data-theme="dark"]',
        beneath: [':root', '.dark, [data-theme="dark"]'],
      },
      { name: 'Harvest light', selector: ':root', beneath: [] as string[] },
      { name: 'Harvest dark', selector: '.dark, [data-theme="dark"]', beneath: [':root'] },
    ] as const;

    const declaredBy = (sheet: string, selector: string): Record<string, string> => {
      const out: Record<string, string> = {};
      postcss.parse(sheet).walkRules((rule) => {
        if (rule.selectors.map((s) => s.trim()).sort().join(', ') !== selector) return;
        rule.walkDecls((d) => { if (d.prop.startsWith('--')) out[d.prop] = d.value.trim(); });
      });
      return out;
    };

    const resolve = (value: string, vars: Record<string, string>, depth = 0): string | null => {
      if (depth > 24) return null;
      const m = /var\(\s*(--[A-Za-z0-9_-]+)\s*(?:,([^)]*))?\)/.exec(value);
      if (!m) return value;
      const [whole, name, fallback] = m;
      const declared = vars[name];
      if (declared === undefined) {
        if (fallback === undefined) return null;
        return resolve(value.replace(whole, fallback.trim()), vars, depth + 1);
      }
      return resolve(value.replace(whole, declared), vars, depth + 1);
    };

    /** Every colour-bearing class the new files spell, harvested from source. */
    const colourClasses = (): string[] => {
      const found = new Set<string>();
      const RE = /\b(?:bg|text|border|ring|fill|stroke|from|via|to|shadow|divide|placeholder|accent|caret|outline)-[a-z0-9][\w./-]*\b/g;
      for (const file of ADDED) {
        for (const m of codeOf(file).matchAll(RE)) found.add(m[0]);
      }
      return [...found].sort();
    };

    it('harvested a non-trivial set of classes to check', () => {
      const classes = colourClasses();
      expect(classes.length, `only found ${classes.join(', ')}`).toBeGreaterThan(8);
    });

    it('every class the files spell is emitted by the real compiled stylesheet', () => {
      // A class Tailwind does not emit paints nothing. ⚠️ Checked against the
      // WHOLE app stylesheet, which is built from the real content globs, so a
      // class only these files use is in it precisely because they use it.
      const missing = colourClasses().filter((c) => {
        const escaped = c.replace(/[.[\]/]/g, (ch) => `\\${ch}`);
        return !new RegExp(`\\.${escaped}(?![\\w-])`).test(css);
      });
      expect(missing, 'these classes are spelled but compile to nothing').toEqual([]);
    });

    it.each(PALETTES.map((p) => [p.name, p] as const))(
      '%s declares no dangling token that these classes could land on',
      (_name, palette) => {
        const declared = declaredBy(css, palette.selector);
        expect(Object.keys(declared).length, `${palette.name} declares no tokens — the block is gone`)
          .toBeGreaterThan(0);
        const scope = Object.assign(
          {}, ...palette.beneath.map((s) => declaredBy(css, s)), declared,
        ) as Record<string, string>;
        const dangling = Object.entries(declared)
          .filter(([, v]) => resolve(v, scope) === null)
          .map(([t, v]) => `${t}: ${v}`);
        expect(dangling, `${palette.name} declares a token that resolves to nothing`).toEqual([]);
      },
    );

    it('Classic is still the default family, which is the palette this ships into first', () => {
      expect(read('src/lib/theme.ts')).toContain("export const DEFAULT_PALETTE_FAMILY: PaletteFamily = 'classic'");
    });
  });
});

/* ═══ 9-11 · The events screen still works, and its ratio holds ══════════════ */

describe('the existing events list, its write paths and paid-event creation are unchanged', () => {
  /**
   * ⚠️ NOT a digest of `AdminEvents.tsx` — this ticket legitimately edits it,
   * by two lines. So the claim is made about the REGIONS that matter, pinned
   * individually, which is a stronger statement than "the file did not change"
   * could be for a file that had to.
   */
  const region = (text: string, start: string, end: string): string => {
    const i = text.indexOf(start);
    expect(i, `region starting ${start.slice(0, 40)} is gone`).toBeGreaterThan(-1);
    const j = text.indexOf(end, i);
    expect(j, `region ending ${end.slice(0, 40)} is gone`).toBeGreaterThan(-1);
    return text.slice(i, j + end.length);
  };

  const EVENTS = () => read(EDITED);

  it('handleSave — the event create AND update write — is byte-identical', () => {
    const src = region(EVENTS(), '  const handleSave = async () => {', '    finally { setSaving(false); }\n  };');
    expect(sha256(src)).toBe('f5edf19edfeb164ae16710a91a85e20174a815468f4cb75ef54a84958e7125fb');
  });

  it('confirmDelete is byte-identical', () => {
    const src = region(EVENTS(), '  const confirmDelete = async () => {', '  };');
    expect(sha256(src)).toBe('803e468cb1f5b8061ce9c1481b813088b46bcba6d94e35dc553acd2bc0a616e5');
  });

  it('and the form the write is built from gained and lost no field', () => {
    const src = region(EVENTS(), 'const emptyForm = {', '};');
    expect(sha256(src)).toBe(sha256(src)); // shape, below, is the real claim
    for (const field of [
      'title', 'description', 'coverImage', 'location', 'isOnline', 'onlineLink',
      'startDate', 'endDate', 'capacity', 'registrationDeadline', 'price', 'currency',
      'status', 'registrationEnabled', 'ticketTypes', 'waitlistEnabled', 'discountCodes',
      'showOnPublicCalendar',
    ]) {
      expect(src, `emptyForm lost ${field}`).toContain(`${field}:`);
    }
    // 18 fields and no nineteenth — a new one would be a new stored field.
    expect((src.match(/^\s{2}\w+:/gm) || []).length).toBe(18);
  });

  /**
   * 🔴 TEST 11 — a paid event can still be created with Stripe disabled.
   *
   * The founder hit this and ACCEPTED it. The behaviour is a NEGATIVE: nothing
   * in the create path consults a Stripe flag, so `price > 0` and Connect off
   * still saves. This asserts the absence, in the region that would have to
   * gain the check for the behaviour to change.
   */
  it('paid-event creation consults no Stripe flag, so it still works with Stripe disabled', () => {
    const save = region(EVENTS(), '  const handleSave = async () => {', '    finally { setSaving(false); }\n  };');
    expect(save.toLowerCase()).not.toContain('stripe');
    expect(save).not.toContain('connect');
    // The price goes straight into the document, unguarded.
    expect(save).toContain('price: Number(form.price) || 0,');
    // And the whole screen still names no Stripe gate.
    expect(codeOf(EDITED).toLowerCase()).not.toContain('stripe_connect_enabled');
  });

  it('the events list still reads the same collection, the same way', () => {
    const code = codeOf(EDITED);
    expect(code).toContain("collection(db, 'tenants', tenantId, 'events')");
    expect(code).toContain('useEvents(tenantId, isAuthReady)');
    expect(code).toContain("collection(db, 'tenants', tenantId, 'registrations')");
  });

  /**
   * ⚠️ "AdminEvents.tsx is 955 lines with 205 className and only 7 inline
   * styles — keep that ratio." The panel is its own component, so THE-313's
   * two counts were UNCHANGED: its edit adds an import and one JSX element with
   * no className and no style of its own.
   *
   * 🔴 AMENDED BY THE-317, AND ONLY ON THE HALF THAT MOVED. That ticket mounts
   * the volunteer rota in this screen and adds exactly TWO classNames: the
   * rota screen's own `FORM_CONTAINER` wrapper, and the button in the events
   * list that opens it. 205 → 207, named here rather than relaxed to a range —
   * a THIRD would still fail.
   *
   * ⚠️ THE INLINE-STYLE COUNT IS UNTOUCHED AT 7, and that is the half this
   * guard is really about. The rota's own files hold ZERO inline styles
   * (`the-317-guards.test.ts` asserts it across all four), so the ratio moved
   * in the right direction.
   */
  it('keeps its className-to-inline-style ratio exactly', () => {
    const src = EVENTS();
    expect((src.match(/className/g) || []).length, 'className count moved').toBe(207);
    expect((src.match(/style=\{\{/g) || []).length, 'an inline style was added').toBe(7);
  });

  it('and the edit is the import plus the one element, nothing else', () => {
    const code = codeOf(EDITED);
    expect(code).toContain("import ServicePlanPanel from './events/ServicePlanPanel';");
    expect((code.match(/<ServicePlanPanel/g) || []).length).toBe(1);
    // It is handed the event's id and start, and reads nothing back.
    expect(code).toContain('eventId={selected.id}');
    expect(code).toContain('startsAt={selected.startDate ? selected.startDate.toDate() : null}');
    // 🔴 It does not import the plan's data layer — the panel owns that.
    expect(code).not.toContain('useServicePlanQueries');
    expect(code).not.toContain('servicePlans');
  });
});

/* ═══ The parallel tickets' files ═══════════════════════════════════════════ */

describe('the files THE-308, THE-309, THE-311 and THE-312 own are not reached', () => {
  /**
   * ⚠️ Asserted as "not imported and not named", not as a digest. Those tickets
   * are IN FLIGHT and land on the same merge ref, so pinning their digests
   * would fail on somebody else's landed work — the exact false positive the
   * accepted-digest sets above exist to avoid.
   *
   * 🔴 THE-308 owns `AdminEvents.tsx` TOO (the events month view) and must not
   * run beside this ticket. Nothing here can enforce that; what it CAN assert is
   * that this ticket's own footprint in that file is the two lines above.
   */
  const FOREIGN = [
    'components/dashboard',
    'course.constants',
    'components/course/',
    'settings/',
  ] as const;

  it.each(ADDED)('%s reaches into none of them', (file) => {
    const code = codeOf(file);
    for (const name of FOREIGN) {
      expect(code, `${file} reaches into ${name}`).not.toContain(name);
    }
  });
});

/* ═══ 18 · The suite this ticket adds is the suite it claims ════════════════ */

describe('the tests this ticket adds', () => {
  const SUITES = [
    'src/components/events/__tests__/THE-313.service-plan.test.tsx',
    'src/components/__tests__/THE-313.service-plan.layout.test.tsx',
    'src/__tests__/the-313-guards.test.ts',
  ] as const;

  it.each(SUITES)('%s exists and is not empty', (file) => {
    expect(read(file).length).toBeGreaterThan(2000);
  });

  it('the layout suite measures in Chromium and adds no browser dependency', () => {
    const src = read('src/components/__tests__/THE-313.service-plan.layout.test.tsx');
    expect(src).toContain('// @vitest-environment node');
    expect(src).toContain('MeasuringBrowser');
    expect(src).not.toContain('playwright');
    // ⚠️ Two MeasuringBrowser instances in one process collide on a PID-derived
    // debugger port and silently compare a page with itself. This file opens ONE.
    expect((src.match(/new MeasuringBrowser\(\)/g) || []).length).toBe(1);
    // And measures the whole non-monotonic ladder.
    expect(src).toContain('[380, 768, 1024, 1280, 1440]');
  });

  /**
   * ⚠️ A guard that re-derives its own baseline from the repository cannot
   * fail — it would describe whatever it was handed. Every pinned value in this
   * file is a literal, and `MemberScreens.desktop-layout.test.tsx` is the file
   * that DOES shell out to `git show`, which is why the ticket's step 0 calls
   * for `git fetch --unshallow`. None of these three does.
   *
   * 🔴 The check is for the CHILD-PROCESS IMPORT and the calls, not for the
   * bare words: this very file names `git show` in the prose above, and a
   * substring match on that would fail on its own explanation.
   */
  it.each(SUITES)('%s shells out to nothing at assertion time', (file) => {
    const code = read(file).replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
    expect(code, `${file} imports child_process`).not.toMatch(/from ['"]node:child_process['"]/);
    expect(code, `${file} calls execSync`).not.toMatch(/\bexecSync\s*\(/);
    expect(code, `${file} calls spawnSync`).not.toMatch(/\bspawnSync\s*\(/);
  });
});
