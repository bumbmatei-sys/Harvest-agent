import { createHash } from 'node:crypto';

/**
 * The one recorded, narrow exemption to the PlanUpgradeSection / plan-features
 * byte-identity pins (PR #540, settings popup, round 3).
 *
 * It is NOT a skip. Every guard that used to hold PlanUpgradeSection.tsx
 * byte-identical still compares the file's digest; it now accepts exactly two
 * values, the one it always pinned and the one recorded here. Any other edit,
 * anywhere in the file, produces a third digest and fails.
 *
 * The `hunks` are the proof that the new digest differs from the old one by
 * these lines and nothing else: `reverseHunks(current)` must hash back to
 * `originalDigest` (checked in pr-540.plan-copy-exemption.test.ts).
 *
 * Append-only: never replace `originalDigest`, add a new entry beside it.
 */
export const R3_APPROVAL = 'Matei approved 2026-10-21: display-copy + compact prop only';

export interface Hunk { readonly before: string; readonly after: string }

export interface RecordedExemption {
  readonly file: string;
  readonly approval: string;
  readonly originalDigest: string;
  readonly exemptDigest: string;
  readonly hunks: ReadonlyArray<Hunk>;
}

export const PLAN_UPGRADE_SECTION: RecordedExemption = {
  file: 'src/components/settings/PlanUpgradeSection.tsx',
  approval: R3_APPROVAL,
  originalDigest: '667a71285e506773f0d137654584f9c7ded1eedcb8de8998908b9b1aa2a9c935',
  exemptDigest: '32984f29807bbfbfa6d79faf9f95712deed2e71c2ebc2c119dc5b3b3f3d61c08',
  hunks: [
    {
      before: "import { Check } from 'lucide-react';\n",
      after: "import { Check } from 'lucide-react';\nimport { Button } from '@/components/ui/button';\n",
    },
    {
      before: '  hideUpgrade?: boolean;\n',
      after: '  hideUpgrade?: boolean;\n  /** Settings popup only: one plan card per row and a theme-token Manage button. */\n  compact?: boolean;\n',
    },
    {
      before: "{ key: 'maxChurches', count: ['church', 'churches'] },",
      after: "{ key: 'maxChurches', count: ['campus', 'campuses'] },",
    },
    {
      before: 'email, hideUpgrade, processor }) => {',
      after: 'email, hideUpgrade, processor, compact }) => {',
    },
    {
      before: "        style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}\n",
      after:
        '        style={compact\n' +
        "          ? { display: 'grid', gridTemplateColumns: 'minmax(0, 1fr)', overflow: 'visible' }\n" +
        "          : { scrollbarWidth: 'none', msOverflowStyle: 'none' }}\n",
    },
    {
      before: '          <button\n            data-testid="billing-manage-action"',
      after:
        '          {compact ? (\n' +
        '            <Button\n' +
        '              data-testid="billing-manage-action"\n' +
        '              variant="outline"\n' +
        '              onClick={handleManageSubscription}\n' +
        '              disabled={portalLoading}\n' +
        '            >\n' +
        "              {portalLoading ? 'Opening portal...' : 'Manage Subscription'}\n" +
        '            </Button>\n' +
        '          ) : (\n' +
        '          <button\n' +
        '            data-testid="billing-manage-action"',
    },
    {
      before: "              'Manage Subscription'\n            )}\n          </button>\n",
      after: "              'Manage Subscription'\n            )}\n          </button>\n          )}\n",
    },
  ],
};

export const PLAN_FEATURES: RecordedExemption = {
  file: 'src/utils/plan-features.ts',
  approval: R3_APPROVAL,
  originalDigest: 'ea729463e52a02a69ada40f1796b919c5872077e379fbe03ca6c269a811fd38e',
  exemptDigest: 'b5396ad175399ba2a736bb9a23df4c2399802337c18684737c44dab7009e4c3f',
  hunks: [
    {
      before: "  max:  'For established churches going deeper.',",
      after:
        '  // TODO: harvest-presentation-site (src/components/Pricing.tsx) still says "churches"; change it to "campuses" there too.\n' +
        "  max:  'For established campuses going deeper.',",
    },
  ],
};

/** The digests a guard may accept for the file: what it always pinned, and the recorded edit. */
export const acceptedDigests = (e: RecordedExemption): readonly string[] => [e.originalDigest, e.exemptDigest];

export const sha256Text = (text: string): string => createHash('sha256').update(text).digest('hex');

/**
 * Undo the recorded hunks. Returns null when a hunk's `after` text is not present
 * exactly once, which means the file no longer contains the recorded edit.
 */
export function reverseHunks(text: string, hunks: ReadonlyArray<Hunk>): string | null {
  let out = text;
  for (const { before, after } of hunks) {
    const parts = out.split(after);
    if (parts.length !== 2) return null;
    out = parts[0] + before + parts[1];
  }
  return out;
}
