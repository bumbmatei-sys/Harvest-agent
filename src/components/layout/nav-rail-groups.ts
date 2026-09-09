import { FileText, Church, Radio, TrendingUp, type LucideIcon } from 'lucide-react';

/**
 * THE-332 — the icon each desktop nav group wears in the rail.
 *
 * The rail holds the four GROUP LABELS, not the ten most-used tabs. ClickUp's
 * own rail is destinations (Home, Spaces, Chat, Planner, AI…) rather than
 * categories, and that is the shape the founder's screenshots show — but in
 * Harvest the groups ARE the destinations. `MINISTRY` is where a church admin
 * goes to do ministry; `CONTENT` is where they go to publish. Ranking tabs by
 * "most used" instead would have meant inventing a ranking this product has no
 * usage data for, and would have pushed the other thirteen tabs behind an
 * overflow whose reachability is much harder to guarantee. With the groups in
 * the rail, every one of the 23 tabs sits in exactly one flyout, the permission
 * rules keep working unchanged (a group whose tabs are all denied resolves to
 * `[]` and is omitted whole, exactly as it is today), and nothing can go
 * missing without `visibleNavGroups` dropping it on purpose.
 *
 * Keyed by the label in `DESKTOP_NAV_GROUPS`. A group with no entry here would
 * render an iconless rail button, so THE-332's guard asserts that every label
 * in that array has one — the map is discovered from the array rather than
 * both being maintained by hand.
 */
export const DESKTOP_GROUP_ICONS: Record<string, LucideIcon> = {
  // Blog, courses, newsletter, AI knowledge, docs — things the tenant writes.
  CONTENT: FileText,
  // The people and the giving. Church is already this app's icon for a
  // congregation (AdminChurches uses it), so the rail borrows the vocabulary
  // the product already has rather than minting a second one.
  MINISTRY: Church,
  // Events, check-in, forms, SMS, livestream — the outward-facing cluster.
  // `Radio` is what AdminLivestream already uses, for the same reason.
  // 🔴 THE-341 renamed the key with the group. The rail reads this map by the
  // label in `DESKTOP_NAV_GROUPS`, so a key left at `BROADCASTING` would have
  // rendered an ICONLESS rail button — which is exactly what THE-332's guard
  // that every label has an icon exists to catch.
  REACH: Radio,
  // Affiliate, branding, library, tenants, inbox — the surfaces that grow the
  // platform rather than run a Sunday.
  GROW: TrendingUp,
};

/**
 * THE-334 — what the admin READS under each rail icon, and at the top of the
 * panel that entry opens.
 *
 * ── Why a second map instead of renaming the groups ─────────────────────────
 * 🔴 The keys of `DESKTOP_GROUP_ICONS` above are `DESKTOP_NAV_GROUPS`' own
 * labels, and SEVEN pre-existing entitlement guards scan the nav by those
 * names. Renaming `MINISTRY` to `People` in that array to make it fit the rail
 * would have been a permission-shaped edit made for a typographic reason, and
 * the kind that turns a guard green for the wrong cause. So the identity stays
 * `CONTENT` / `MINISTRY` / `REACH` / `GROW` and the READABLE word lives here,
 * keyed by it. ⚠️ THE-341 DID rename one of those identities, BROADCASTING to
 * REACH — but at the founder's explicit instruction and as the ticket's whole
 * point, with every guard that scans the nav by name updated in the same
 * change. That is the opposite of a typographic edit, and it is why the other
 * three identities are still untouched.
 *
 * ── Why these words ─────────────────────────────────────────────────────────
 * The labels are now VISIBLE TEXT under the icon rather than `sr-only`, which
 * is the founder's ask ("there's no title under to know what category is it")
 * and which ClickUp's rail does throughout — Home, Spaces, Chat, Planner, AI,
 * Teams, Docs. ⚠️ Every one of ClickUp's is ONE SHORT WORD, and that is not
 * incidental: an 88px rail minus its `px-4` padding leaves 56px of measure, and
 * `BROADCASTING` needed about 80px even at 10px type. The choice was therefore
 * to shorten the words or to widen the rail, and the founder — who had ALSO
 * asked for the nav to be less wide — chose to shorten them.
 *
 * `People` for MINISTRY (contacts, signups, churches, community, giving) and
 * `Live` for REACH (events, check-in, SMS, livestream) are the founder's
 * own picks, not a guess: he was shown the three candidate sets and named this
 * one. No word here is longer than seven characters, so every label sits on ONE
 * line at the rail's existing width and no entry is taller than its siblings.
 */
export const DESKTOP_GROUP_LABELS: Record<string, string> = {
  CONTENT: 'Content',
  // ⚠️ 'People' first, then back to 'Ministry' at the founder's call — "call
  // Ministry instead of people. you were right." It is the product's own word
  // for this group and it is what the ids array has always been labelled.
  MINISTRY: 'Ministry',
  // The group held Events, Check-In, SMS and Livestream under 'Live', which
  // named only the livestream. 'Reach' is the founder's pick from the
  // candidates: the group is how a church reaches people, in the room or out.
  // 🔴 THE-341 — the founder then renamed the GROUP ITSELF to REACH, so the key
  // and the readable word finally agree. THE-334's reasoning below for keeping
  // a second map still holds for CONTENT / MINISTRY / GROW, whose identities
  // are still not what the rail prints.
  REACH: 'Reach',
  GROW: 'Grow',
};

/**
 * THE-334 — how a group's rows are BLOCKED inside its panel.
 *
 * ClickUp's reference panel is sectioned — a first block, a separator, a headed
 * group, another separator — and the founder gave MINISTRY's blocks explicitly:
 * Campus · CRM · Signups, then Services · Community, then Fundraising ·
 * Donations · Accounting. Three things a church actually does, in three blocks,
 * instead of one undifferentiated list. (Forms was in the second block until
 * THE-341 moved it to REACH.)
 *
 * 🔴 PRESENTATION ONLY. This decides ORDER and where the separators fall; it
 * decides NOTHING about membership or permission. Membership stays
 * `DESKTOP_NAV_GROUPS.ids`, which is what `visibleNavGroups` filters and what
 * seven entitlement guards read — so a mistake here cannot hide a tab from
 * anyone. The renderer proves that: any permitted id NOT named below still
 * renders, in a trailing block of its own, so forgetting to list a new tab
 * costs it its place in the order and nothing else.
 *
 * A group with no entry here renders as one block, exactly as before.
 */
export const DESKTOP_GROUP_SECTIONS: Record<string, string[][]> = {
  // 🔴 THE-341 — `forms` was in the middle block and is not in MINISTRY any
  // more. It is REMOVED here rather than left behind: the renderer looks each
  // id up in the group's own permitted rows, so a stale id would resolve to
  // nothing and cost nothing at run time — but a presentation map that names an
  // id the group does not hold is a map that lies to the next reader. REACH
  // gets no entry, so it renders as one block, exactly as it did before.
  MINISTRY: [
    ['churches', 'crm', 'signups'],
    ['services', 'community'],
    ['fundraising', 'donations', 'accounting'],
  ],
};
