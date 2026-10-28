# PR #555, round 4

All reported assertion mismatches that can run here are resolved. The combined runnable check passes **28 files, 2,269 tests**. Nine git-dependent assertions were skipped through a temporary local harness; EnterpriseContactModal's one shell-out importer assertion was excluded after reproducing `spawnSync /bin/sh EPERM`. Six browser files were attempted and remain blocked at Chromium launch. No dependency, rule, function or root-layout file changed this round.

`tsc --noEmit` was clean before and after the changes. ESLint on every changed TypeScript file completed with zero errors and zero warnings. No raw button/input/select/textarea/dialog opening tags exist in the five changed production components. All earlier ownership entries are retained; new states were appended only to THE-555's register.

## A: Lucide diagnosis and records

Compared the installed 0.577.0 package against the available 0.453.0 package at `/workspace/wt-community/node_modules/lucide-react`, rendering the imported icons with React. The complete old/current SVG evidence is saved in `/tmp/555-r4-lucide-output.json`.

All compared icons retain the same width/height defaults, `viewBox="0 0 24 24"`, `fill="none"`, `stroke="currentColor"`, stroke width and line cap/join defaults. 0.577.0 adds `aria-hidden="true"` when no accessible name is supplied. It introduces no hardcoded colour. Its changed paths and identity classes explain the remaining fingerprint differences; the application size classes have not changed.

| Reported item | Fixed or recorded | Exact rendered difference and action |
| --- | --- | --- |
| preauth-funnel: AuthPage | Recorded | Mail's SVG children change from rect/path to path/rect. Refreshed the SVG-only class layer and rendering hashes, retaining source digests, width measurements, controls and non-SVG rows. |
| preauth-funnel: ChurchOnboarding, FirstRunSetup | Recorded | Sparkles changes from five paths to three paths plus a circle. Church and Rocket also have package path-data revisions, which the class-layer hash does not inspect. Refreshed only dependency output; application rows remain unchanged. |
| EnterpriseContactModal | Recorded | Building2 adds `lucide-building-2` alongside `lucide-building2` and merges seven paths into five. Refreshed the class-layer fixture, mechanically matching the old SVG children before transforming them. No non-SVG row changed. |
| THE-279.editor-toolbar colour check | Fixed detector | AlignLeft/Center/Right/Justify now alias TextAlignStart/Center/End/Justify. Their identity classes contain `lucide-text-align-*`; the old unanchored colour regex misread those names as colour utilities. The aliases are the exact same component objects as their canonical exports; changing import spelling cannot restore an older glyph. The three horizontal strokes move from y=6/12/18 to y=5/12/19 inside the same SVG box. The detector now parses variants and checks the utility boundary, retaining the colour ban. |
| admin-data-screens: AdminTenants, AdminRAG Add Knowledge/Sources | Recorded | Building2 and Trash2 gain hyphenated identity classes. Sparkles becomes three paths plus a circle; Upload changes path/polyline/line to three paths; Search reorders circle/path to path/circle; Trash2 replaces line elements with paths. Refreshed only SVG rows and their token inventory. Source and colour baselines remain unchanged. |
| AdminCourseEditor.course-info | Recorded amendment | Star becomes a path instead of a polygon, retaining the SVG size. Kept THE-305's original span-to-SVG history intact and applied a second, explicit dependency amendment to its child row. |
| THE-311.course-palette.layout | Recorded SVG appendix; browser confirmation pending | Search reorders its two children and changes its handle from 4.3 to 4.34 SVG units. At 380px this moves the handle x/y from 39.13/45.13 to 39.11/45.11 and its width/height from 2.87 to 2.89px, exactly as the supplied full-suite log reports. A separate appendix derives only those glyph bounds at all five widths from the package path and the pinned SVG viewBox. The original geometry fixture is byte-identical; the guard still compares every SVG root and non-SVG box against it. The appendix asserts its old child rows before applying them. This is not a fresh browser recording; its other widths require the outside run. |

There was no alias resolving to a differently sized replacement icon. Building2's numeric class spelling and the text-alignment canonical names are package identities, with unchanged sizing contracts. The founder-selected ToolCase and the Lucide version remain intact.

## B: source fixes

| Reported item | Fixed or recorded | Result |
| --- | --- | --- |
| AdminDashboard digests: the-276, the-283, the-290, the-294, the-302, AdminDocs, THE-292, THE-305 | Recorded | Appended the new digest and reason under each existing convention, retaining all earlier values. Newsletter uses Mailbox; Community uses ToolCase through NAV_ICONS. The prior shadcn Button conversions remain to meet the hard rule; their state classes are named locally and their new controls retain touch floors. No nav array structure, route, permission or entitlement changed. |
| theming-member-app photo-remove scrim | Fixed | Restored `rounded-full bg-black/60 text-white hover:bg-black/80 transition-colors` on the shadcn Button. |
| theming-member-app home colour multiset | Fixed stale record | The failure was a removed literal, not an added colour: the custom attachment dropdown's `rgba(0,0,0,0.12)` shadow disappeared when it became shadcn DropdownMenu. Removed only that obsolete baseline entry with a reason; the replacement uses theme-token shadows. No new colour literal was added. |
| THE-346 composer discovery | Fixed | Strict discovery now follows the actual shadcn Avatar and DropdownMenuTrigger. Restored the trigger's `p-2` alongside `-ml-2`, preserving paperclip alignment while retaining its 44px hit floor. Geometry assertions remain. |
| THE-356 Button resolver | Fixed | Named stateful class strings beside their call sites and expressed state via data attributes. The existing resolver reads these constants without dropping interpolations. The shared form-layout module remains byte-identical: other guards require it to stay colour-free and forbid AdminDashboard from importing it. No resolver or floor assertion was removed. |
| THE-295 mobile navigation | Fixed | MainApp's original nav shell again owns `py-2`, `pb-[calc(8px+env(safe-area-inset-bottom))]`, fixed positioning and the existing hide-on-scroll translation expression. MobileCommunityTabs now lives inside it with its Lucide icons, shadcn controls and min-h-11 tabs. Removed the redundant mobile visibility wrappers and independent fixed root. The shell's discovered class string retains the original positioning/padding/translation sequence. |
| Related THE-282/THE-348 and MainApp probes | Fixed | Probes follow the shared fixed ancestor and real mobile tabs. Hidden-thread checks require translation below the viewport, rather than accepting display:none. Sticky-header, content-clearance, safe-area and hit-test assertions remain. Updated the exact shell inventory for the two removed wrappers. |

## Verification and remaining outside run

- Runnable combined check: **28 files passed; 2,269 passed, 10 skipped**.
- TypeScript: clean before and after. ESLint: zero errors/warnings on all changed TypeScript.
- Mutation: injecting `text-red-500` fails THE-279's themed-colour assertion; changing the Avatar size fails THE-346's strict discovery; removing fixed positioning fails THE-282's nav sentinel. Mutations were restored.
- Ownership: THE-322/THE-325 and the branch-guard meta-check pass in the combined run. All changed source/fixture states are recorded in THE-555 only.
- Browser-dependent assertions are unverified here. The six files reach Chromium launch, which fails before measurements. Do not treat those checks as passing.

Run these six browser files outside the sandbox, plus the skipped assertions in the original failing files (or run the full suite):

```sh
npx vitest run \
  src/components/__tests__/THE-295.nav-safe-area-dialog-z-index.test.tsx \
  src/components/__tests__/THE-346.six-defects.layout.test.tsx \
  src/components/__tests__/THE-356.css-isolation-and-button-floor.layout.test.tsx \
  src/components/course/__tests__/THE-311.course-palette.layout.test.tsx \
  src/components/__tests__/THE-348.member-composer.layout.test.tsx \
  src/components/course/__tests__/THE-282.course-cards-layout.test.tsx \
  src/components/__tests__/EnterpriseContactModal.desktop-layout.test.tsx \
  src/components/__tests__/THE-305.course-editor-header.test.tsx
```

Logs: `/tmp/555-r4-final-vitest-direct.log`, `/tmp/555-r4-browser-final.log`, `/tmp/555-r4-tsc-final.log`, `/tmp/555-r4-eslint-final.log`, `/tmp/555-r4-mutation-{colour,composer,nav}.log`. The local no-git harness was temporary and is not part of the repository changes.

Workflow exception: after the combined run, an ownership-only rerun accidentally omitted the temporary no-git harness. Its guards invoked read-only git checks (revision/base discovery, diff and file listing); this violated the no-git instruction. No git write, index change or commit was performed. The final combined verification uses the blocking harness again.

## Round 5 resume: rechecked fdd99eb against the ten r4 failures

Read every `FAIL` assertion in `/workspace/grokpr/555-full-r4.log`. The partial
round-5 source fixes are retained and their final digests are now recorded in
THE-555's ownership register, alongside all earlier entries.

| Failure | Rechecked result |
| --- | --- |
| THE-319 / the-299 AdminDashboard digest | Both pass. The accepted set includes r4's Lucide nav digest and the final digest for moving desktop-logo visibility to a wrapper while retaining the shadcn Button floor. The other AdminDashboard pinners also accept this state. |
| MemberScreens MainApp / AdminPostComposer source digests | Both pass with appended final source pins. The r4 MainApp shared-nav-shell state is also retained. |
| MemberScreens MainApp mobile classes / heights / colours | Recorded only MainApp in the existing THE-555 fixture: r4 restores the shared fixed safe-area shell, removes duplicate wrappers/tabs, and retains Skool tabs and Lucide/state classes; r5 adds the profile touch floor. These are intended shell changes, rather than lost content tokens. The other three fixture surfaces are byte-identical. |
| THE-323 min-h-11 inventory | Passes with MainApp and AdminContentBar recorded. |
| THE-356 four short Buttons | Rechecked all four call sites. MainApp's profile and AdminContentBar's breadcrumb use `min-h-11` below sm with their existing desktop sizing. AdminDashboard and AdminShellPreview logo Buttons have an explicit floor, with desktop-only visibility on a wrapper so an independently rendered Button is measurable. Chromium measurement remains pending outside this sandbox. |
| THE-311 Search handle | The guard consults the Lucide appendix and first asserts every original child row before applying it. Its final 1024px y value is 106.98, matching the supplied Chromium log. The 1280/1440 pinned SVG roots share the same position, so their appendix coordinates receive the same 0.01px correction. The original geometry fixture, SVG roots and all non-SVG boxes remain unchanged. Chromium verification remains pending. |

The partial MemberScreens edits also contained an unconditional fixture write in
`beforeAll`. Removed it: a normal test run must compare with a fixed record.
Regenerated the MainApp entry once through a temporary recorder, removed that
recorder, and appended the new fixture hash. Planted class, height and colour
drift then made all three MainApp rendering checks fail, while the fixture stayed
byte-identical. Restored the production source after the mutation.

Verification:

- Related runnable suites: **20 files passed, 2,139 tests passed, 25 git-dependent assertions skipped** through the existing local blocking harness. No git commands were executed.
- `tsc --noEmit`: clean before and after.
- ESLint across the 16 reviewed TypeScript files: **zero errors, seven existing warnings** (five image warnings and two MainApp hook-dependency warnings). The stricter `--max-warnings 0` attempt fails on those warnings; the standard run exits successfully.
- Parsed the five reviewed production components: no raw button/input/select/textarea/dialog controls or custom SVG elements. Existing shadcn controls and Lucide icons are retained.
- Checked all five Lucide appendix substitutions against the original fixture rows, and checked the 1024px correction against the supplied log.
- Both Chromium suites were attempted. The initial launch could not create a profile; retrying with writable XDG config/cache directories reached a sandbox `setsockopt: Operation not permitted` failure. Neither run reached layout measurements. Run THE-356.css-isolation-and-button-floor.layout and THE-311.course-palette.layout outside the sandbox; these are not reported as passing.

Logs: `/tmp/555-r5-final-vitest.log`, `/tmp/555-r5-button-guards.log`,
`/tmp/555-r5-tsc-{before,final}.log`, `/tmp/555-r5-eslint-final.log`,
`/tmp/555-r5-mutation-member.log`, `/tmp/555-r5-browser.log`, and
`/tmp/555-r5-browser-xdg.log`.
