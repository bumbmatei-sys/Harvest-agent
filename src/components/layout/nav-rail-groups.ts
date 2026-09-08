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
  // Events, check-in, SMS, livestream — the outbound/live cluster. `Radio` is
  // what AdminLivestream already uses, for the same reason.
  BROADCASTING: Radio,
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
 * `CONTENT` / `MINISTRY` / `BROADCASTING` / `GROW` and the READABLE word lives
 * here, keyed by it.
 *
 * ── Why these words ─────────────────────────────────────────────────────────
 * The labels are now VISIBLE TEXT under the icon rather than `sr-only`, which
 * is the founder's ask ("there's no title under to know what category is it")
 * and which ClickUp's rail does throughout — Home, Spaces, Chat, Planner, AI,
 * Teams, Docs. ⚠️ Every one of ClickUp's is ONE SHORT WORD, and that is not
 * incidental: an 88px rail minus its `px-4` padding leaves 56px of measure, and
 * `BROADCASTING` needs about 80px even at 10px type. The choice was therefore
 * to shorten the words or to widen the rail, and the founder — who had ALSO
 * asked for the nav to be less wide — chose to shorten them.
 *
 * `People` for MINISTRY (contacts, signups, churches, community, giving) and
 * `Live` for BROADCASTING (events, check-in, SMS, livestream) are the founder's
 * own picks, not a guess: he was shown the three candidate sets and named this
 * one. No word here is longer than seven characters, so every label sits on ONE
 * line at the rail's existing width and no entry is taller than its siblings.
 */
export const DESKTOP_GROUP_LABELS: Record<string, string> = {
  CONTENT: 'Content',
  MINISTRY: 'People',
  BROADCASTING: 'Live',
  GROW: 'Grow',
};
