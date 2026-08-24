/**
 * THE-225 — the one rule every grouped sidebar in this app obeys:
 * A GROUP WITH NO VISIBLE ITEMS DOES NOT RENDER ITS HEADING.
 *
 * 🔴 WHY THIS IS A MODULE AND NOT THREE `if`s. The founder's screenshot showed
 * a free member's desktop sidebar with a "SUPPORT US" heading and nothing
 * underneath it: both of that group's items (Give, and the AI chat) are
 * plan-gated off free, so the group resolved to `[]` and MainApp rendered the
 * heading anyway. Fixing that by special-casing "hide SUPPORT US on free" would
 * leave the next plan-gated feature to orphan the next heading — the same
 * defect with a different label. The rule is about EMPTINESS, not about any
 * tier, any group or any feature, so it is written once, here.
 *
 * The admin sidebar (AdminDashboard) already carried this rule as an inline
 * `if (items.length === 0) return null` and was correct; it now reads the rule
 * from here instead, so there is exactly one implementation and the two
 * sidebars cannot drift apart.
 *
 * ⚠️ AN EMPTINESS RULE, NEVER A GATE. Nothing here decides what a tenant may
 * reach — the caller has already resolved its items through the plan gates by
 * the time it gets here, and this only declines to draw a heading over nothing.
 * A group that still holds one item renders exactly as it always has.
 */

/** The minimum shape this rule needs: a label, and the items under it. */
export interface NavGroup<TItem> {
  label: string;
  items: TItem[];
}

/**
 * The groups worth drawing — those with at least one visible item, in the order
 * given.
 *
 * Generic over the item type on purpose: the member sidebar's items carry
 * `isActive`/`onClick` and the admin sidebar's do not, and inventing a shared
 * item type to unify them would couple two screens that have no other reason to
 * agree. The rule only ever counts.
 */
export function visibleNavGroups<TItem, TGroup extends NavGroup<TItem>>(
  groups: readonly TGroup[],
): TGroup[] {
  return groups.filter((group) => group.items.length > 0);
}
