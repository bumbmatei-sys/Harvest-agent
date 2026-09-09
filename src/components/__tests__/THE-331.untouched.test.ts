/**
 * THE-331 - What this ticket did NOT move.
 * ===========================================================================
 *
 * 🔴 THE CENTRAL CLAIM OF THIS PR. The reui cascader's own install wanted to
 * OVERWRITE three installed primitives - `button`, `spinner` and `scroll-area`
 * - and the `--dry-run` said so in as many words: "3 files will be
 * overwritten." The brief predicted the opposite, that the absence of
 * `--overwrite` would make the CLI skip them. It does not.
 *
 * ⚠️ The overwrite was not cosmetic. All three would have arrived carrying
 * `import { cn } from "cn"` - a package that does not exist - and `spinner`
 * would additionally have swapped its `lucide-react` Loader2Icon for an
 * `IconPlaceholder` imported from `@/app/(create)/components/icon-placeholder`,
 * a path this repo does not have. So the install was run in a THROWAWAY
 * project and only `components/reui/cascader/**` was copied across.
 *
 * 🔴 DIGESTS AS LITERALS, and no `git show` at assertion time. A guard that
 * shelled out would pass in a shallow CI clone that cannot see the revision it
 * means to compare against, which is the failure THE-268 and the MemberScreens
 * suite both had to be taught about.
 */

import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const sha256 = (b: Buffer | string) => createHash('sha256').update(b).digest('hex');
const digestOf = (rel: string) => sha256(readFileSync(path.join(ROOT, rel)));

/** Every installed shadcn primitive, as it stood on `origin/main`. */
const PRIMITIVES: Readonly<Record<string, string>> = {
  'alert.tsx': '126a26b401ab2cd3f3855551d012b5dca7a96b7d6984a921add3ce2d441af4b6',
  'avatar.tsx': '357b2f9aac0192c071cb2ed65cb6e4c8ec01fa02fc15cf50d889b85731b75666',
  'badge.tsx': '968b0403af74a785c9408ca69a677235e49d0c80b2c27fb9858ad421a8778c7d',
  'breadcrumb.tsx': '26f83fc8ed302d710851a71b705f5f8f28c805561c1fb6945370617267c5a4a9',
  'button-group.tsx': 'fe97631e1a07bc0add09503c5032002e37f4c71ef5dd3c7475b856a29848583d',
  'button.tsx': 'd14549ab3ba7a9d5d1f424c2599233bffa0b317121abf3b6efa2fb902d5e2781',
  'calendar.tsx': '0ea3d4bd2cf7b8edef5bd5a724518d94d609b15f2f4f42e489c63f532706e55c',
  'card.tsx': 'd8113cbf964f8d1aadf2649d2944d8bbc6e3cfd49d36746f76868cbc4dde3cfe',
  'chart.tsx': '0060b7708d85a5fffc914dcd1ee4753b5acfe83db7ba634b4cea280bd9f19c8f',
  'checkbox.tsx': '7221fec06ed8f697d03157cec8e668f84fcc6706391f487a90773b7fe4fc762d',
  'collapsible.tsx': 'ead4349ff7b01d696ef89294a81d18ee1d3f732321398896462c834ab9b9e065',
  'command.tsx': 'b80b0f0356add12993366cd4571ceae1416f50035ac189876373d0e5050308c5',
  'context-menu.tsx': '8658b48f25544047357bc809e6f6485d2309e72cf310c521e92430003b0d56a8',
  'dialog.tsx': 'bfd230cea544d2de7650182341e082de92141174da80f6193843e8d71b622e41',
  'dropdown-menu.tsx': '1c1ae4ec02de9778286f84e0d15a1b74cc610c13c5b6a13c1ada2e6770eeb4e1',
  'empty.tsx': 'e65ee3ba54a21ed61e3c50041bb12a6a3fcb215c56611cda6795c23a7bd89f61',
  'field.tsx': '3c2272fd6ca7d1b478a48d9a9b796862541cfe0882b76899dfe1bcad25bd18be',
  'hover-card.tsx': '7e7880883ba91290133e61f8bf1df72547795b8d9f2c13d4a17a51c17540d712',
  'input-group.tsx': '17e76f6e6093754756dd10182f833abf35f1020dc4a8a7ead8c0f9703576870b',
  'input.tsx': 'f7d6ecff9a4d631feeaf401c02bb87e26ddb38131c55d15a43b9290747390847',
  'item.tsx': '3f5ec6eac0a7c2daea3f4403408974ff4bae1e949d328701bcf3a74a4554b6e0',
  'label.tsx': '7f19b8476658d25ff197c84030e58cd7395059d876a54630e025951e474ebdae',
  'pagination.tsx': '0aba86a91ba0a8d99e92846f10b395d0ddc1a8901a4f54418e8802c12fad57c1',
  'popover.tsx': '67aa5f28d07c6b149d9d30d173af78d6640f9bca18138bfb16b98e66973974b9',
  'progress.tsx': '45e33890b5a82744fc27d0928f927c5942c1166e5e27de8f776b29112967d317',
  'radio-group.tsx': '3fcee2611d534df43e2ca0d4db49024c656fc1183dd5ab4eb92f4c5d10bde2f7',
  'resizable.tsx': '379baf7a1de109a1ea14419c99b76fbec1cb4f10d6ee13605b0b2940d615afeb',
  'scroll-area.tsx': '42de3962daca60255bf1d3cd90bd3c038db73a3ed61ecaac6cffc6a153181e4a',
  'select.tsx': 'ca3bd1b370ea67b84632d435c22d8270752fa6013c06c365162af265e4a0e87e',
  'separator.tsx': '75085bd84ff6965e4a356c53a4689799cabf65caa93c0bba064d5a0c6fa78f13',
  'sheet.tsx': '68d13d9826a9b5b28e3d78a0ba632b347ca91b67a3333a38acb6310ade8846d4',
  'sidebar.tsx': '29e33400cfdd00cb499da3615ed2258d75192d2b2a5a5117a84d2db4242ed0bf',
  'skeleton.tsx': '8110bba70d0cb9fe968c0b7bd092ad12258caef40b028b4a87f402bdab907faf',
  'slider.tsx': 'd5f419f7f96a6aaf8c28251ceb58b48518379d8b61a9d7cb3f2dc9e254569290',
  'sonner.tsx': '2ebc0c9ba968858cead2fbf2523dfd9da217715339967025e8c8df94f2131ab9',
  'spinner.tsx': '900f722c961fa6e1c28104809d56831c9056dc69599e49d364cc13a6f33966a3',
  'switch.tsx': 'cabbf7804a4d6768ef62f5c2256fbf39e214372318bb1b3b22d407f808c56249',
  'table.tsx': 'a13f55a7c1406197608f223006cf16f211a257b213362caaef0d2abf3a389c8f',
  'tabs.tsx': '096e3d4b2a99b1eff95d16959f97daaa1747fdb7de6226d6c54b9693e22b3410',
  'textarea.tsx': '58b58d84fc54ba5f4ca46937870c619349fd9eccc4d494250ac7bc73a94e05e9',
  'toggle-group.tsx': 'f7776d68b06148d9742fe4f21df45f931b2a259592192d4bda16a7039f508d15',
  'toggle.tsx': '290d2cd01c768d1e3c894bfebcf9c3d1532191ae7ec1e48da1e405dab0a95c4c',
  'tooltip.tsx': '2cea2294d4947b88d815860f64e0b5e0eb47a59bde47cfd194aac2230c923865',
};

/** The vendored cascader, as this ticket leaves it. */
const CASCADER: Readonly<Record<string, string>> = {
  'cascader-async.tsx': 'a1220f9177c4d2ad466cf43f17918dfebcb72a6801f85db5b0262785052572dd',
  'cascader-columns.tsx': '5c88ded5c613cd02fd5d1ff2e82f2b56d0154451d8efca6335e1204bb740da44',
  'cascader-context.tsx': '7b86d342a5ca6dde5c09a1bca26767466f64ff8c2bb8082a0217bbaad5d589f1',
  'cascader-footer.tsx': '6edb48b85b08e84e05106539c8c8e5600cc0733a0f3af6a550c787fb777f7b32',
  'cascader-i18n.tsx': 'dd2042e19f07f1573c2c085c2a9b466c77ec1bb7f30f41bfcc2194af288d3013',
  'cascader-item.tsx': '320d1bd92ff8182a503f81e4bb11047be44fbd30c81b106f15301545c97a612b',
  'cascader-lib.tsx': 'c6a3c214d7ef118584313853239de34fcd4181eb055ee5fada3ea3fcd3ff7748',
  'cascader-nav.tsx': 'b315cdad644dc590504e6b9052e51ade1859d13b6dbf3c70cce4b30e3aca6d45',
  'cascader-types.tsx': '4b8a4756d052e85404840a0eb632cc7b4e3f0ed067b70d10727a4f39cf5e4836',
  'cascader.tsx': 'eaca7179f9ed16914f455136728d56d07aef7964c75fbe0d026bb8dfda427f06',
};

/** Files this ticket is forbidden to touch at all. */
const UNTOUCHABLE: Readonly<Record<string, string>> = {
  'firestore.indexes.json': '8ae29121ceb65f8fc06df89435829496cd06ee0abff98c1ad24f6f470da2c6b0',
  'src/app/layout.tsx': 'b9bdf22ae920933587b39c5030cbf1ef4f89b02230578e5ad6c4b715b824c63f',
};

// ===========================================================================
// 17. 🔴 Every pre-existing primitive is byte-identical.
// ===========================================================================
describe('🔴 all pre-existing primitives are byte-identical', () => {
  it('there are exactly 43 of them, so none was added or removed', () => {
    const onDisk = readdirSync(path.join(ROOT, 'src/components/ui'))
      .filter((f) => f.endsWith('.tsx'))
      .sort();
    expect(onDisk).toEqual(Object.keys(PRIMITIVES).sort());
  });

  it.each(Object.entries(PRIMITIVES))('%s is unchanged', (file, digest) => {
    expect(
      digestOf('src/components/ui/' + file),
      'src/components/ui/' + file + ' MOVED. The cascader install wanted to ' +
        'overwrite button, spinner and scroll-area with a broken `cn` import; ' +
        'if this fails, that overwrite reached the repo.',
    ).toBe(digest);
  });

  it('🔴 the three the CLI wanted to overwrite are named explicitly', () => {
    for (const f of ['button.tsx', 'spinner.tsx', 'scroll-area.tsx']) {
      expect(digestOf('src/components/ui/' + f), f + ' was overwritten').toBe(PRIMITIVES[f]);
    }
  });

  it('no primitive imports the broken `cn` package the registry ships', () => {
    const offenders = Object.keys(PRIMITIVES).filter((f) =>
      /from ["']cn["']/.test(readFileSync(path.join(ROOT, 'src/components/ui', f), 'utf8')),
    );
    expect(offenders, '`cn` is not a package; the import resolves to nothing').toEqual([]);
  });
});

// ===========================================================================
// The vendored cascader, and where it landed.
// ===========================================================================
describe('the cascader landed outside src/components/ui', () => {
  it.each(Object.entries(CASCADER))('%s is recorded', (file, digest) => {
    expect(digestOf('src/components/reui/cascader/' + file)).toBe(digest);
  });

  it('🔴 no cascader module shadows a primitive', () => {
    const uiNames = new Set(Object.keys(PRIMITIVES));
    for (const f of Object.keys(CASCADER)) {
      expect(uiNames.has(f), f + ' shares a name with a primitive').toBe(false);
    }
  });

  it('the windowing module is absent, so no npm dependency is reachable', () => {
    expect(
      existsSync(path.join(ROOT, 'src/components/reui/cascader/cascader-virtual.tsx')),
    ).toBe(false);
  });

  it('no registry demo block shipped', () => {
    // Registry `examples/` are reference code. Shipping them unused is the same
    // smell as seeded demo data, and they dragged react-day-picker in with them.
    expect(existsSync(path.join(ROOT, 'src/components/examples'))).toBe(false);
  });
});

// ===========================================================================
// 25. firestore.rules, firestore.indexes.json, functions/ and layout.tsx.
// ===========================================================================
describe('the files this ticket may not touch are byte-identical', () => {
  it.each(Object.entries(UNTOUCHABLE))('%s is untouched', (rel, digest) => {
    expect(digestOf(rel), rel + ' is out of scope for THE-331').toBe(digest);
  });

  it('🔴 firestore.rules is untouched, checked against THE-325 REGISTER', () => {
    // ⚠️ THE DIGEST IS NOT WRITTEN HERE. THE-325 migrated the rules digest out
    // of 49 suites into one register precisely so that a rules change costs
    // ONE edit; a literal in this file would put it back to two and its own
    // guard fails on exactly that. The register is read instead.
    const register = JSON.parse(
      readFileSync(
        path.join(ROOT, 'src/__tests__/__fixtures__/ownership/THE-325.json'),
        'utf8',
      ),
    ) as { entries: ReadonlyArray<{ file: string; digest: string }> };
    const accepted = register.entries
      .filter((e) => e.file === 'firestore.rules')
      .map((e) => e.digest);
    expect(accepted.length, 'the register must record firestore.rules').toBeGreaterThan(0);
    expect(
      accepted,
      'firestore.rules moved, and THE-331 may not touch it',
    ).toContain(digestOf('firestore.rules'));
  });

  it('functions/ is untouched as a whole tree', () => {
    const dir = path.join(ROOT, 'functions');
    const walk = (d: string, out: string[] = []): string[] => {
      for (const e of readdirSync(d).sort()) {
        const p = path.join(d, e);
        if (statSync(p).isDirectory()) {
          if (e !== 'node_modules' && e !== 'lib') walk(p, out);
        } else out.push(p);
      }
      return out;
    };
    // ⚠️ POSIX separators, ALWAYS. `path.relative` yields backslashes on
    // Windows, and a manifest built from those digests to something different
    // on every Windows machine while passing on Linux - which is exactly the
    // shape of ~18 of this repo's standing Windows-only failures.
    const manifest = walk(dir)
      .map((f) => path.relative(ROOT, f).split(path.sep).join('/'))
      .sort()
      .map((rel) => sha256(readFileSync(path.join(ROOT, rel))) + ' ' + rel)
      .join('\n');
    expect(sha256(manifest + '\n')).toBe('2140ed2820c61b7a3504e55ff88e8aa8381d08a389ffcec5bdb12147af0fee0b');
  });
});

// ===========================================================================
// 18 / 24. No new token; no guard that reads this branch's diff.
// ===========================================================================
describe('no new token, and no guard reads the branch diff', () => {
  it('this ticket defines no new CSS custom property', () => {
    const css = readFileSync(path.join(ROOT, 'src/app/globals.css'), 'utf8');
    for (const invented of ['--radius-brand-xl', '--attach-', '--cascader-brand']) {
      expect(css.includes(invented), invented + ' was invented to silence a guard').toBe(false);
    }
  });

  it('🔴 no THE-331 guard shells out to git or reads the branch diff', () => {
    // ⚠️ Asserted on IMPORTS, not on a substring sweep of the file body.
    // A body sweep would match this very assertion's own pattern literal and
    // fail on itself - and the obvious "fix" is to narrow the window until the
    // guard stops looking, which is how nine guards in this series passed a
    // planted defect. A test cannot shell out without importing the module.
    const shellImport = /from ['"](node:)?child_process['"]|require\(['"](node:)?child_process['"]\)/;
    for (const f of [
      'src/components/__tests__/THE-331.attach-picker.test.tsx',
      'src/components/__tests__/THE-331.attach-surface.layout.test.tsx',
      'src/components/__tests__/THE-331.untouched.test.ts',
    ]) {
      const src = readFileSync(path.join(ROOT, f), 'utf8');
      expect(
        shellImport.test(src),
        f + ' imports child_process. #454 is a standing sweep: a guard that ' +
          'diffs the current branch passes on the branch that wrote it and ' +
          'means nothing afterwards.',
      ).toBe(false);
    }
  });

  it('the shell-import sweep is not vacuous - it catches a real one', () => {
    const shellImport = /from ['"](node:)?child_process['"]|require\(['"](node:)?child_process['"]\)/;
    // ⚠️ ASSEMBLED FROM FRAGMENTS ON PURPOSE. Written as one literal, this
    // probe would itself be a `child_process` import line inside this file and
    // the sweep above would flag its own vacuity check - the exact self-match
    // that made the first version of that assertion fail on itself.
    const probe = 'import { execSync } from ' + "'node:" + "child_process'";
    expect(shellImport.test(probe), 'the sweep must catch a real shell import').toBe(true);
    expect(shellImport.test("import { readFileSync } from 'node:fs'")).toBe(false);
  });
});
