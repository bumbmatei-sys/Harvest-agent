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

/**
 * A later approved edit, recorded on top of the one before it. `hunks` undo it, so
 * `reverseHunks(file, successor.hunks)` must hash back to the digest it followed.
 */
export interface Successor {
  readonly approval: string;
  readonly digest: string;
  readonly hunks: ReadonlyArray<Hunk>;
}

export interface RecordedExemption {
  readonly file: string;
  readonly approval: string;
  readonly originalDigest: string;
  readonly exemptDigest: string;
  readonly hunks: ReadonlyArray<Hunk>;
  /** Appended, in order, after `exemptDigest`. Never edit an earlier entry. */
  readonly successors?: ReadonlyArray<Successor>;
}

/**
 * PR #540 round 4. Matei approved the scheduler on the Ministry plan: an
 * entitlement cell (`socialScheduler` true on `max`) and the plan card line it derives.
 * No price, checkout or plan id moved.
 */
export const R4_APPROVAL = 'Matei approved 2026-10-21: "Include the scheduler in the Ministry plan"';

export const PLAN_UPGRADE_SECTION: RecordedExemption = {
  file: 'src/components/settings/PlanUpgradeSection.tsx',
  approval: R3_APPROVAL,
  originalDigest: '667a71285e506773f0d137654584f9c7ded1eedcb8de8998908b9b1aa2a9c935',
  exemptDigest: 'eb4cc06ac22f5984341089499c86010cf23df6d2462b390ff337a5c450288377',
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
        '              className="min-h-[44px] sm:min-h-0"\n' +
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
  successors: [
    {
      approval: R4_APPROVAL,
      digest: '2301202d994407ae7a00e0b41e92e9245bae3590db29fe7ca292c7adb78e115c',
      hunks: [
        {
          before: "  { key: 'communityGroups', label: 'Community Groups' },\n];\n",
          after:
            "  { key: 'communityGroups', label: 'Community Groups' },\n" +
            "  { key: 'socialScheduler', label: 'Social Scheduler' },\n];\n",
        },
      ],
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
  successors: [
    {
      approval: R4_APPROVAL,
      digest: '8ca381290333e0d02908a6289e15e3b6f6efe4e68a866a40f835f038891ad7d6',
      hunks: [
        {
          before:
            '   * 🔴 FALSE ON EVERY TIER. No plan includes it. The only path to `true` is\n' +
            '   * holding the social scheduler add-on, which `getEffectiveFeatures` lifts\n',
          after:
            '   * 🔴 TRUE ON MINISTRY ONLY (Matei approved 2026-10-21: "Include the\n' +
            '   * scheduler in the Ministry plan"). Every other tier reaches `true` only by\n' +
            '   * holding the social scheduler add-on, which `getEffectiveFeatures` lifts\n',
        },
        {
          before:
            '    // 🔴 FALSE ON EVERY TIER. Social scheduling is an add-on. See PlanFeatures.\n' +
            '    socialScheduler: false,\n',
          after:
            '    // Included in Ministry (Matei approved 2026-10-21). Other tiers hold it via the add-on.\n' +
            '    socialScheduler: true,\n',
        },
      ],
    },
  ],
};

/** The digests a guard may accept for the file: what it always pinned, and each recorded edit in order. */
export const acceptedDigests = (e: RecordedExemption): readonly string[] =>
  [e.originalDigest, e.exemptDigest, ...(e.successors ?? []).map((x) => x.digest)];

/** The digest the file is expected to be at now: the last recorded edit. */
export const currentDigest = (e: RecordedExemption): string => acceptedDigests(e)[acceptedDigests(e).length - 1];

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

/**
 * Walk the recorded chain backwards: undo the latest successor, check the result is the digest that
 * successor followed, repeat, then undo the round-3 hunks and return the bytes. Null when any link
 * does not hold, which means the file holds an edit nobody recorded.
 */
export function undoRecordedChain(text: string, e: RecordedExemption): string | null {
  let out = text;
  const successors = e.successors ?? [];
  for (let i = successors.length - 1; i >= 0; i--) {
    if (sha256Text(out) !== successors[i].digest) return null;
    const undone = reverseHunks(out, successors[i].hunks);
    if (undone === null) return null;
    out = undone;
  }
  if (sha256Text(out) !== e.exemptDigest) return null;
  return reverseHunks(out, e.hunks);
}
