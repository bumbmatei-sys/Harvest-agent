import { TenantAddons, TenantPlan, PricedPlan } from '../types/tenant.types';

export interface PlanFeatures {
  /** Show blog tab in user app + blog management in admin */
  blog: boolean;
  /**
   * The church NEWS FEED — `NewsTab` / `AllNews` and the public post permalink,
   * all reading `/community_posts`.
   *
   * 🔴 THREE DIFFERENT PRODUCTS SHARE THE WORD "COMMUNITY" HERE, and this cell
   * is only the first of them. Getting the distinction wrong is what THE-164 on
   * the marketing site and PR 332 in this repo each had to correct, in opposite
   * directions:
   *
   *   news feed        → NewsTab / AllNews → `/community_posts`. Announcements,
   *                      polls, photos, events and comments, posted by admins
   *                      and read by members. THIS cell.
   *   Community Groups → UserMessages → tenants/{t}/{channels,directMessages,…}.
   *                      Private channels + DMs. `communityGroups`, Ministry
   *                      only. NOT this cell.
   *   blog             → BlogTab → `/blog_posts`. Long-form articles. `blog`,
   *                      Individual and above. NOT this cell.
   *
   * PR 332 established that the feed is a DIFFERENT thing from Community Groups
   * and left it ungated on every tier, which was right at the time: every tier
   * then in the matrix had it. THE-205 adds the first tier that does not.
   *
   * 🔴 GATES A SURFACE, NEVER THE DATA. `/community_posts` documents, their
   * comments, likes, polls and RSVPs are untouched by this cell, and so are
   * firestore.rules — a tenant that upgrades off free gets its feed back with
   * its history intact. The gate is: the News tab is absent from `topTabs`,
   * `NewsTab`/`AllNews` never mount (so no `/community_posts` listener opens),
   * and the public post permalink refuses server-side. See MainApp.tsx and
   * app/post/[postId]/page.tsx.
   */
  newsFeed: boolean;
  /** Show AI chat in user app */
  aiChat: boolean;
  /** Show AI Knowledge Base in admin */
  aiKnowledge: boolean;
  /** Show church map in user app (pro and above) */
  map: boolean;
  // `churchDirectory` ("global multi-church discovery directory, Ministry only")
  // was removed: it was read nowhere in the app — no gate, route, query or
  // component consulted it (see docs/plan-features-flag-audit.md). It was not
  // redundant with `maxChurches` (that caps a tenant's OWN campuses; this named
  // a cross-tenant browsing capability), it just named a capability that was
  // never built. `ChurchMap` (the member-facing map) is gated by `map` instead,
  // and is not a discovery-across-tenants surface. Same precedent as
  // `customBackground`/`publicCalendar` above: don't re-add it as a plan flag
  // unless a church-directory feature ships with it.
  /** Max number of churches (0 = hidden, -1 = unlimited) */
  maxChurches: number;
  /**
   * Max number of contacts (-1 = unlimited).
   *
   * VALUES ONLY — nothing enforces this yet. No contact cap exists anywhere in
   * the app today; this cell is the published number so the plan matrix, the
   * public /api/plans catalog and the in-app comparison all read from one
   * place instead of a marketing page.
   *
   * It lives here rather than in PLAN_LIMITS (src/lib/planLimits.ts) because
   * PLAN_LIMITS holds METERED flows and stocks — token and segment budgets fed
   * by a per-tenant monthly usage doc. Contacts are a static entity count, the
   * same shape as maxCourses / maxAdmins / maxChurches, so it belongs with
   * them.
   *
   * When enforcement lands it mirrors the `maxCourses` shape below: gated
   * client-side only (bypassable by a direct Firestore write, since
   * firestore.rules does not enforce it — rules-level enforcement is a separate
   * hardening task), blocking new creation only; a tenant already over the
   * limit (e.g. after a downgrade) keeps their existing contacts.
   */
  maxContacts: number;
  /**
   * Max number of courses (-1 = unlimited).
   *
   * Enforced client-side only, mirroring `maxChurches`: AdminCourses gates the
   * "New course" button (fail closed on an unknown/loading plan — falls back
   * to 'plus'). This is bypassable by anyone crafting a Firestore write
   * directly, since firestore.rules does not enforce it — rules-level
   * enforcement is a separate hardening task, not done here. Blocks new
   * creation only; a tenant already over the limit (e.g. after a downgrade)
   * keeps their existing courses.
   */
  maxCourses: number;
  /** Max number of admin accounts (-1 = unlimited) */
  maxAdmins: number;
  /** Allow custom domain (Community / max+) */
  customDomain: boolean;
  /** Allow custom branding — logo, colors, ministry name (Community / max+) */
  customBranding: boolean;
  // `customBackground` ("custom auth-page background image") was removed: no
  // background uploader was ever built anywhere in the app, so the flag sold a
  // capability that does not exist. It was true on exactly the tiers where
  // customBranding is true (at the time, Community/max and the since-deleted
  // Ministry/ultra tier), so dropping it from the Branding-tab gate (see
  // hasBrandingAccess below) changed no tier's access. Don't re-add it as a
  // plan flag unless an uploader ships with it.
  //
  // `publicCalendar` was removed for the same reason, and on the same
  // precedent: no public event-calendar page exists anywhere in the app. It was
  // `true` on every tier, so nothing ever gated on it and removing it changed
  // no tier's access — it only stopped the matrix (and the public /api/plans
  // catalog) advertising a capability that was never built. Don't re-add it
  // unless a calendar ships with it.
  /** Newsletter (manual + Mailchimp) — Small Team / pro+ */
  newsletterAutomation: boolean;
  /** AI-generated newsletter from Instagram (Community / max+) */
  automatedNewsletter: boolean;
  /**
   * SMS: manual broadcasts + automated event-registration/check-in/pledge
   * triggers (see AdminSms TRIGGERS; scheduled broadcasts and other triggers
   * are not promised).
   *
   * 🔴 `true` ON MINISTRY (`max`) ONLY — THE-314. Founder's call.
   *
   * ⚠️ THIS REPLACES THE "TRUE ON EVERY TIER, BYO-ONLY" REASONING THAT USED TO
   * STAND HERE, and it replaces it because its PREMISE IS GONE, not because the
   * argument was wrong. That reasoning said: a plan cell gating a capability the
   * plan does not supply gates nothing — which was true while a church brought
   * its OWN Twilio credentials and Twilio billed the church directly. Harvest
   * supplied nothing, so Harvest had nothing to ration.
   *
   * THE-314 ended bring-your-own. Harvest now RESELLS: one vendor account,
   * Harvest pays for every number and every segment, and bills the church. The
   * plan DOES supply the capability now, every send spends Harvest's money, and
   * the cell is read for the first time by a real SERVER-SIDE gate — inside the
   * single send funnel in `lib/sms-send.ts` — rather than by nav alone.
   *
   * 🔴 TWO PAID TIERS LOSE A CAPABILITY THEY WERE PROMISED. Individual (`plus`)
   * and Small Team (`pro`) both carried `true` and now carry `false`. That is a
   * downgrade, not a tidy-up, and it is recorded as one so nobody later reads
   * these cells as having always been Ministry-only.
   *
   * ⚠️ DO NOT GATE ON THIS CELL DIRECTLY. Read it through
   * `getEffectiveFeatures`, which lifts capabilities with `||` and never
   * assignment (THE-253) — so the day SMS is sold as an add-on to a lower tier,
   * one line there changes and every gate already honours it.
   *
   * The segment budgets in PLAN_LIMITS move with this: `max` carries a real
   * monthly allotment again, because there is Harvest money to ration again.
   * See src/lib/planLimits.ts.
   */
  smsAutomation: boolean;
  // `aiAssistant` (a COUNT, 0/0/0/1 across the tiers) was REMOVED with the
  // Telegram assistant it belonged to (THE-253). It was never the RAG chat —
  // that is `aiChat` above — and nothing ever metered against it.
  //
  // 🔴 DO NOT CONFUSE IT WITH `TenantAddons.aiAssistant`, WHICH IS STILL LIVE
  // AND IS A DIFFERENT FIELD. That one is the quantity the Dodo webhook writes
  // from the live $20 add-on, it is read by `getEffectiveFeatures` to lift
  // `aiChat`/`aiKnowledge`, and deleting it would destroy the entitlement.
  // Only the PLAN CELL is gone: a tier no longer publishes an assistant count.
  /** Fundraising campaigns feature */
  fundraising: boolean;
  /** Event registration integration */
  eventRegistration: boolean;
  /** Docs / TipTap notes integration (Small Team / pro+) */
  docs: boolean;
  /** CRM for donors and members (Small Team / pro+) */
  crm: boolean;
  /**
   * The Signups screen — members who created an account: city search, the
   * 1/3/7/30-day windows, and the two CSV exports (THE-277).
   *
   * 🔴 A NEW CELL, AND IT IS READ — THE-335. `AdminDashboard` gates both the
   * `signups` nav entry and the `signups` render branch on it, so this is not
   * the `churchDirectory` / `customBackground` / `publicCalendar` defect of a
   * flag nothing reads. It exists because the founder split what free gets:
   * "The free plan should have signup feature not CRM since we separated them."
   *
   * ⚠️ WHY A CELL WAS UNAVOIDABLE. Both gates used to read `crm`, which is what
   * THE-277 carried over when it moved Analytics out of the CRM screen. So while
   * they shared a cell, "free gets Signups but not CRM" was not expressible: any
   * `crm: false` on free took Signups AND the analytics that lives on it away in
   * the same edit. Separating the two gates is the change; this cell is what
   * separates them.
   *
   * 🔴 STILL NO `analytics` CELL, AND THERE MUST NOT BE ONE. Analytics is a
   * PERMISSION (`analytics` in AdminRoles) on the Signups screen. "Free gets
   * analytics" is now expressed by `signups: true` and nothing else, exactly as
   * it was expressed by `crm: true` before — the sentence moved with the screen
   * it describes, and no flag was invented.
   *
   * VISIBILITY ONLY, exactly as `crm` is: no rule, route or query keys off this
   * cell. Firestore scopes the `users` documents Signups reads on tenant
   * membership, never on plan.
   */
  signups: boolean;
  /** Accounting tools integration */
  accountingTools: boolean;
  /** Tax receipt generation */
  taxReceipt: boolean;
  /** Community groups — private channels + DMs (Community / max+) */
  communityGroups: boolean;
  /** Custom forms → CRM pipeline (Community / max+) */
  customForms: boolean;
  /** Check-in system with QR attendance (Small Team / pro+) */
  checkInSystem: boolean;
  /** Livestream + live giving (Small Team / pro+) */
  livestream: boolean;
  /** Sermon notes shared to livestream (viewer read-only panel) */
  sermonNotes: boolean;
  /** AI-generated SEO blog articles on schedule from Knowledge Base */
  automatedBlog: boolean;
  /** Annual giving statements (year-end tax summaries) — Ministry / max+ */
  givingStatements: boolean;
  /** Pledge campaigns — Ministry (max) and above */
  pledgeCampaigns: boolean;
  /**
   * Text-to-Give via inbound SMS keyword (`AdminSms.tsx`'s Text-to-Give panel,
   * served by `app/api/sms/incoming/route.ts`).
   *
   * 🔴 `true` ON MINISTRY (`max`) ONLY — THE-314, and it MOVES WITH
   * `smsAutomation` above for the reason THE-245 already wrote down: Text-to-
   * Give is inbound SMS end to end. The keyword arrives on the public webhook
   * and the reply goes back out through the same send funnel, so there is no
   * configuration in which one works and the other does not. A tier holding one
   * and not the other would be a matrix that cannot be true.
   *
   * The old reasoning here — true everywhere, decided per-tenant by the church's
   * own Twilio credentials — went with bring-your-own. See `smsAutomation`.
   */
  textToGive: boolean;
  /** Installable Progressive Web App (mobile app) — all plans */
  pwaApp: boolean;
  // `donationRetention` ("percentage of a donation the ministry keeps") was
  // removed with the move to a flat 0% platform fee on every tier. It was a
  // hand-maintained complement of PLATFORM_FEE_MAP (`100 - fee * 100`), and
  // that duplication is what once let the app advertise "keeps 100%" while
  // actually charging 2.5%. With PLATFORM_FEE_MAP now { plus: 0, pro: 0,
  // max: 0 } the field is a constant 100 on every tier — it carries no
  // information and can only drift again. Read PLATFORM_FEE_MAP
  // (src/lib/stripe-connect.ts) directly; it is the rate actually charged.
}

// ─── Feature matrix ───────────────────────────────────────────────────────────
//
// IMPORTANT: this matrix must match the pricing table on theharvest.site.
// If you change any cell, update the marketing site copy too — or switch the
// marketing site to consume /api/plans so they can never drift again.
// The contract test in __tests__/plan-features.test.ts will fail CI if this
// matrix changes without an explicit update to that test.

/**
 * The sentinel `PlanFeatures`' numeric cells use for "unlimited".
 *
 * 🔴 DECLARED ABOVE `PLAN_FEATURES` BECAUSE THE MATRIX NOW NAMES IT — THE-370.
 * It used to sit beside `getEffectiveFeatures` further down, which was fine
 * while no tier carried it; `maxChurches` is `UNLIMITED_CAP` on all three paid
 * tiers now, and a `const` cannot be read above its own declaration. The
 * alternative was a bare `-1` in three cells, which is the unexplained literal
 * this constant exists to abolish.
 *
 * `getEffectiveFeatures` still has to RECOGNISE it: adding capacity to a cell
 * that already means unlimited would turn -1 into a small positive number and
 * silently LOWER the cap. That is `raiseCap`'s first line, and it is now a LIVE
 * case rather than a guard against a future matrix change.
 *
 * `contact-capacity.ts` and `admin-seats.ts` each export the same value under
 * the name `UNLIMITED` for their own call sites.
 */
export const UNLIMITED_CAP = -1;

const PLAN_FEATURES: Record<TenantPlan, PlanFeatures> = {
  // ─── Forever Free — no price, no billing term, no Dodo subscription ────────
  //
  // For an EVANGELIST doing personal discipleship: one person leads another to
  // faith, needs somewhere to disciple them and a way to remember who they are.
  // That is the whole unit of value, and it is why this block is almost
  // entirely `false`.
  //
  // 🔴 FREE IS ABSENT FROM `PLAN_PRICING` BY DESIGN. It is not a $0 row — it has
  // no price and no `BillingTerm`, so `PLAN_PRICING` is keyed on `PricedPlan`
  // and `planPriceUsd('free', …)` does not compile. Three zeros would have made
  // free look like a term-billable product to every discount, headline and
  // catalogue calculation that walks that table.
  //
  // ⚠️ `maxContacts: 500` IS NO LONGER GENEROUS AGAINST INDIVIDUAL — THE-370.
  // This comment used to read "deliberately GENEROUS AGAINST INDIVIDUAL'S 150",
  // and that comparison is now FALSE: Individual is 500 too, so free and the
  // cheapest paid tier hold the same number of contacts and there is no gap left
  // to describe. The founder raised every cap ("lets not put cap on users that
  // badly") and free was the one tier already high enough to leave alone.
  //
  // 🔴 WHAT THAT CHANGES, AND WHAT IT DOES NOT. Free is still CAPPED rather than
  // unlimited, and the original reason survives the repricing: an unlimited free
  // tier would mean an evangelist with 800 disciples gets a WORSE product by
  // paying for one. What free no longer does is out-hold the tier above it.
  // Individual is now bought for CAPABILITY — the feed, the blog, a second
  // course, a second admin — and not for capacity, which is the honest shape for
  // a ladder whose first paid rung costs $20.
  //
  // ⚠️ THERE IS NO `analytics` CELL IN THIS MATRIX, on free or on any tier.
  // Analytics is not a plan flag today — it is a PERMISSION (`analytics` in
  // AdminRoles) on a sub-tab of the CRM screen. "Free gets analytics"
  // is therefore expressed by `crm: true` and nothing else; inventing an
  // `analytics` cell here would add a flag that nothing reads, which is the
  // exact defect that removed `churchDirectory`, `customBackground` and
  // `publicCalendar` from this interface.
  free: {
    blog: false,
    // 🔴 FALSE — THE ONLY TIER WITHOUT THE FEED (THE-205, founder-corrected).
    // "Literally the only thing is discipleship, the discipleship page for the
    // user and for admin." The feed was ungated on every tier until this cell
    // existed, so free is the tier that forced it into being — the same shape
    // as `fundraising` directly below, which free was also the first to carry
    // false.
    //
    // ⚠️ THIS MOVES THE MEMBER'S HOME. The news feed WAS Home: `topTabs[0]` was
    // an unconditional `{ id: 'news' }` and the desktop sidebar's "Home" entry
    // is an alias of it. A free member now lands on their discipleship course
    // instead — the founder's intent, and the one thing free is for. See the
    // `homeTabId` derivation in MainApp.tsx; no free-only Home component exists
    // and none is needed, because CourseExperience is already the courses tab.
    //
    // The admin composer goes with it: it lives INSIDE NewsTab (there is no
    // separate admin news screen — MainApp is NewsTab's only caller), so a tier
    // with no feed has no composer, which is correct. A free tenant is one
    // admin and no members reading a feed.
    newsFeed: false,
    aiChat: false,
    aiKnowledge: false,
    map: false,
    // 0 = hidden. A free tenant is one evangelist, not a multi-campus ministry.
    // Keeps `getMinPlanForFeatureCell('maxChurches')` at Individual, since
    // `hasFeature` reads 0 as false.
    maxChurches: 0,
    // The hard cap, and the number the pricing card must state. Existing members
    // are NEVER removed when a tenant crosses a cap — enforcement of that is
    // THE-201, not this PR. Nothing enforces this cell today.
    maxContacts: 500,
    // One discipleship course, adopted from the shared library. The whole
    // product for the member side.
    maxCourses: 1,
    // 🔴 ONE. Argued rather than copied: one evangelist is one admin, and this
    // tier costs nothing and requires no card, so every additional seat is an
    // abuse surface (a free tenant is otherwise a free shared workspace for an
    // arbitrary number of people). 2 would match Individual and make the
    // cheapest PAID tier's headline seat count worthless. The Admin Seats add-on
    // raises it through `getEffectiveFeatures` if a free tenant ever holds one —
    // see the note there.
    maxAdmins: 1,
    customDomain: false,
    customBranding: false,
    newsletterAutomation: false,
    automatedNewsletter: false,
    // FALSE — as it already was before THE-314, and for a reason that has now
    // become the general rule rather than this tier's exception: a working send
    // surface spends Harvest's money on Harvest's vendor account, and free pays
    // nothing and holds no card.
    //
    // ⚠️ Free used to be the ONE tier departing from "true on every tier,
    // BYO-only". That reasoning is gone (see `smsAutomation` in the interface
    // above), so free now AGREES with plus and pro instead of standing apart
    // from them. The cell's value does not move; only what it means alongside
    // its neighbours does.
    smsAutomation: false,
    // 🔴 NO DONATE PAGE. `fundraising` was `true` on every tier before this
    // block, so free is the first tier to carry it false — the founder's
    // explicit call: "they get a public subdomain… but not a donate page."
    // It is a MONEY surface, so the route itself must refuse for a free tenant;
    // that server-side gate is THE-202, and this cell alone does not build it.
    fundraising: false,
    eventRegistration: false,
    docs: false,
    // 🔴 FALSE — THE-335, the founder's split: "The free plan should have signup
    // feature not CRM since we separated them."
    //
    // ⚠️ WHAT FREE ACTUALLY NEEDED IS UNCHANGED AND NOW SITS ON `signups`
    // BELOW. The line this cell used to carry — "the evangelist must be able to
    // see WHO enrolled, with contact records, and export them" — is a
    // description of the SIGNUPS screen, and has been since THE-277 moved it out
    // of CRM. `signups-export.ts` proves it: `CONTACT_CSV_HEADERS` is Name,
    // Phone Number, Email, Registration Date, Country, City, Accepted Jesus, so
    // the export carries the CONTACT RECORDS and not merely enrolment rows.
    // Nothing free needed left with this cell.
    //
    // 🔴 ANALYTICS DID NOT LEAVE EITHER, and that is why this could not be a
    // lone `true` → `false`. Analytics is a permission on the Signups screen, so
    // it followed the screen to `signups: true` — see the note on that cell.
    // Flipping this alone, while the two gates still shared a cell, would have
    // taken Signups and analytics away with the CRM.
    //
    // ⚠️ IT REMAINS VISIBILITY ONLY: no rule, route or query keys off this cell.
    // Firestore scopes `contacts` on the `manageCRM` permission and
    // `isTenantAdmin`, never on plan — so this changes what free SEES, not what
    // a free tenant's records are protected by.
    crm: false,
    // 🔴 TRUE — the second of the two things free actually does, moved here from
    // `crm` above by THE-335. Who enrolled, their contact records, and the two
    // CSV exports; and the analytics that has lived on this screen since
    // THE-277.
    signups: true,
    accountingTools: false,
    taxReceipt: false,
    communityGroups: false,
    customForms: false,
    checkInSystem: false,
    livestream: false,
    sermonNotes: false,
    automatedBlog: false,
    givingStatements: false,
    pledgeCampaigns: false,
    // False for the same reason as `smsAutomation` directly above — see there.
    textToGive: false,
    // 🔴 TRUE — FOUNDER-CONFIRMED (THE-205). This cell shipped false with THE-200
    // and was flagged there as the one least forced by the brief; the founder has
    // now called it the other way, so it is flipped deliberately rather than left
    // dissenting in a comment. The reasoning: the installable PWA is the SAME
    // static shell every tier already downloads, so serving it to a free tenant
    // costs Harvest nothing, and an icon on a member's home screen is the single
    // strongest retention surface the free tier has.
    //
    // NOT a fourth capability — a DELIVERY SURFACE for the two free already has
    // (one adopted course, CRM). Installing the app cannot reach a donate page,
    // a blog or a livestream that `fundraising`/`blog`/`livestream` still hold
    // false directly above; the shell renders whatever the tier's other cells
    // allow and nothing more.
    //
    // ⚠️ THIS MOVES A MINIMUM-PLAN LABEL. `getMinPlanForFeatureCell('pwaApp')`
    // walks PLAN_ORDER and now answers 'free' instead of 'plus' — correctly, and
    // with no edit needed here, because that derivation is the point of not
    // hand-maintaining a literal map. `pwaApp` has no `FeatureKey`, so
    // FEATURE_MIN_PLAN (the seven gate keys) is untouched. Sales copy that still
    // lists the PWA as something you get BY UPGRADING is now advertising a free
    // feature as paid — see the PR for the file:line list.
    pwaApp: true,
  },
  // Individual — $49/mo
  plus: {
    blog: true,
    // Unchanged by THE-205 — the feed is on every tier that pays.
    newsFeed: true,
    // Was "available on Small Team (pro) and above" — no longer true of any
    // tier. See the note on `pro` below: the chat is an add-on, not a plan cell.
    aiChat: false,
    aiKnowledge: false,
    map: false,
    // 🔴 UNLIMITED — THE-370. Was 1, with additional campuses sold as an add-on.
    // The founder retired that add-on ("remove the campus addon. let them add as
    // many as they want"), so campuses are a property of paying at all rather
    // than a thing to buy. Identical on all three paid tiers, by design.
    maxChurches: UNLIMITED_CAP,
    // 🔴 500 — THE-370. Was 150. See the note on free's cap: this tier no longer
    // holds fewer contacts than the tier that costs nothing.
    maxContacts: 500,
    maxCourses: 2,
    maxAdmins: 2,
    customDomain: false,
    customBranding: false,
    newsletterAutomation: false,
    automatedNewsletter: false,
    // 🔴 FALSE — THE-314. Individual LOSES SMS. It carried `true` under
    // bring-your-own, where the cell gated nothing because the church supplied
    // its own Twilio account and paid Twilio directly. Harvest now resells and
    // pays for every segment, and the founder's call is Ministry only.
    // See the block comment above `smsAutomation` in PlanFeatures.
    smsAutomation: false,
    fundraising: true,
    eventRegistration: false,
    docs: false,
    // CRM is on EVERY tier, Individual included. A $49 church has members to
    // keep track of, and shipping the cheapest plan without a roster left it no
    // way to see who they are.
    //
    // VISIBILITY ONLY, exactly as the note on `pro` below describes: no rule,
    // route or query keys off this cell. Firestore scopes `contacts` and
    // `contactActivities` on the `manageCRM` permission and `isTenantAdmin`, not
    // on plan; both /api/crm routes gate the same way and import nothing from
    // this module. So this widens what the tier ADVERTISES and which nav entry
    // renders — it does not widen who may read a contact.
    //
    // `maxContacts` (150 here) is what scopes it, and is enforced separately.
    crm: true,
    // 🔴 TRUE — unchanged by THE-335, which only split what FREE gets. Every
    // paid tier that had the CRM also had Signups (both gates read `crm`),
    // so carrying this cell across at the same value is what makes the split
    // a change to free alone rather than a re-derivation of the ladder.
    signups: true,
    accountingTools: false,
    taxReceipt: false,
    communityGroups: false,
    customForms: false,
    checkInSystem: false,
    livestream: false,
    sermonNotes: false,
    automatedBlog: false,
    givingStatements: false,
    pledgeCampaigns: false,
    // 🔴 FALSE — THE-314, moving with `smsAutomation` directly above. Inbound
    // and outbound SMS are one capability; see the interface comment.
    textToGive: false,
    pwaApp: true,
  },
  // Small Team — $99/mo
  pro: {
    blog: true,
    // Unchanged by THE-205 — the feed is on every tier that pays.
    newsFeed: true,
    // 🔴 FALSE ON EVERY TIER (THE-253). NO PLAN INCLUDES THE AI RAG CHAT —
    // founder: "NO PLAN HAS ANY AI RAG CHAT. Of course there should be no AI
    // RAG chat in any plan if we sell it as an add-on." The ONLY path to
    // `aiChat: true` is holding the AI Assistant add-on, which
    // `getEffectiveFeatures` lifts with `||`. Setting this cell true on any
    // tier re-sells as included the one thing that is sold separately, and is
    // exactly what this ticket removed.
    //
    // ⚠️ `aiKnowledge` MOVES WITH IT, always. The chat answers ONLY from the
    // knowledge base, so a tier with the base and no chat has a screen feeding
    // nothing, and a tier with the chat and no base has a chat that can only
    // answer "I don't have that". One purchase, one coherent capability — the
    // lift in `getEffectiveFeatures` raises both together for the same reason.
    aiChat: false,
    aiKnowledge: false,
    map: true,
    // 🔴 UNLIMITED — THE-370, same as Individual above.
    maxChurches: UNLIMITED_CAP,
    // 🔴 2,000 — THE-370. Was 500.
    maxContacts: 2_000,
    maxCourses: 5,
    maxAdmins: 5,
    customDomain: false,
    customBranding: false,
    newsletterAutomation: true,
    automatedNewsletter: false,
    // 🔴 FALSE — THE-314. Small Team LOSES SMS, for the same reason and by the
    // same decision as Individual above. See `smsAutomation` in PlanFeatures.
    smsAutomation: false,
    fundraising: true,
    eventRegistration: false,
    // Moved down from the top tier in an earlier repricing: Small Team carries
    // Notes/Docs, Check-In, Livestream and Sermon Notes. CRM moved further still
    // and is now on every tier, Individual included — see the note on `plus`
    // above; `pro` is no longer its floor. Visibility only — no rule, route or
    // query keys off these cells (CRM's Firestore rules scope on the `manageCRM`
    // permission, not on plan).
    docs: true,
    crm: true,
    // 🔴 TRUE — unchanged by THE-335, which only split what FREE gets. Every
    // paid tier that had the CRM also had Signups (both gates read `crm`),
    // so carrying this cell across at the same value is what makes the split
    // a change to free alone rather than a re-derivation of the ladder.
    signups: true,
    accountingTools: false,
    taxReceipt: false,
    communityGroups: false,
    customForms: false,
    checkInSystem: true,
    livestream: true,
    sermonNotes: true,
    automatedBlog: false,
    givingStatements: false,
    pledgeCampaigns: false,
    // 🔴 FALSE — THE-314, moving with `smsAutomation` above.
    textToGive: false,
    pwaApp: true,
  },
  // Ministry — $199/mo. The top tier.
  //
  // Absorbed the deleted `ultra` tier: accountingTools folded in here.
  // (Ultra's `aiAssistant: 1` folded in too, and went with the Telegram
  // assistant in THE-253 — see the note on its old declaration site.)
  //
  // 🔴 `maxChurches` NOW CARRIES ultra's -1 AFTER ALL — THE-370, and not by
  // inheritance. This comment used to read "deliberately did NOT inherit ultra's
  // -1 — every tier is capped at 1 campus and additional campuses become a paid
  // add-on"; both halves are false now. The campus add-on is retired and all
  // three PAID tiers are `UNLIMITED_CAP`, so this is not Ministry reclaiming a
  // top-tier privilege — it is the cap ceasing to be a product on every tier
  // that pays. Free stays at 0, which is the only campus distinction left.
  //
  // Ultra's third folded-in cell, `churchDirectory`, was later removed
  // entirely — see the comment on its old declaration site above `maxChurches`
  // in the PlanFeatures interface.
  max: {
    blog: true,
    // Unchanged by THE-205 — the feed is on every tier that pays.
    newsFeed: true,
    // 🔴 FALSE ON EVERY TIER (THE-253). NO PLAN INCLUDES THE AI RAG CHAT —
    // founder: "NO PLAN HAS ANY AI RAG CHAT. Of course there should be no AI
    // RAG chat in any plan if we sell it as an add-on." The ONLY path to
    // `aiChat: true` is holding the AI Assistant add-on, which
    // `getEffectiveFeatures` lifts with `||`. Setting this cell true on any
    // tier re-sells as included the one thing that is sold separately, and is
    // exactly what this ticket removed.
    //
    // ⚠️ `aiKnowledge` MOVES WITH IT, always. The chat answers ONLY from the
    // knowledge base, so a tier with the base and no chat has a screen feeding
    // nothing, and a tier with the chat and no base has a chat that can only
    // answer "I don't have that". One purchase, one coherent capability — the
    // lift in `getEffectiveFeatures` raises both together for the same reason.
    aiChat: false,
    aiKnowledge: false,
    map: true,
    // 🔴 UNLIMITED — THE-370, same as the two tiers below.
    maxChurches: UNLIMITED_CAP,
    // 🔴 4,000 — THE-370. Was 2,000.
    maxContacts: 4_000,
    maxCourses: 15,
    maxAdmins: 15,
    customDomain: true,
    customBranding: true,
    newsletterAutomation: true,
    automatedNewsletter: true,
    // 🔴 THE ONLY TIER WITH SMS — THE-314. Unchanged in value, changed in
    // meaning: this cell now decides who can send, and Harvest pays for what
    // goes out. See `smsAutomation` in PlanFeatures.
    smsAutomation: true,
    fundraising: true,
    eventRegistration: true,
    docs: true,
    crm: true,
    // 🔴 TRUE — unchanged by THE-335, which only split what FREE gets. Every
    // paid tier that had the CRM also had Signups (both gates read `crm`),
    // so carrying this cell across at the same value is what makes the split
    // a change to free alone rather than a re-derivation of the ladder.
    signups: true,
    accountingTools: true,
    taxReceipt: true,
    communityGroups: true,
    customForms: true,
    checkInSystem: true,
    livestream: true,
    sermonNotes: true,
    automatedBlog: true,
    givingStatements: true,
    pledgeCampaigns: true,
    textToGive: true,
    pwaApp: true,
  },
};

// ─── Pricing (source of truth) ────────────────────────────────────────────────

/**
 * The billing terms a church can buy a plan on. Order is cheapest-commitment
 * first, and it is the order every term picker renders in.
 *
 * ⚠️ CROSS-REPO VOCABULARY. Dodo's catalogue says `annual` where this app says
 * `yearly`; the reconciliation lives in src/lib/dodo/catalogue.ts and nowhere
 * else. Quarterly needs no reconciliation — Dodo bills it as
 * `payment_frequency_count: 3, interval: Month`, and "quarterly" is this app's
 * word for that.
 */
export const BILLING_TERMS = ['monthly', 'quarterly', 'yearly'] as const;

export type BillingTerm = (typeof BILLING_TERMS)[number];

/**
 * Months of service ONE charge on a term buys.
 *
 * This is what makes a saving computable at all: a term's real discount is its
 * price against `monthly × TERM_MONTHS[term]`, which is what the same service
 * would have cost bought a month at a time.
 */
export const TERM_MONTHS: Readonly<Record<BillingTerm, number>> = Object.freeze({
  monthly: 1,
  quarterly: 3,
  yearly: 12,
});

/**
 * Base plan pricing in USD — the STORED TABLE. Nine numbers, one per
 * (tier, term), and every plan price in this app is one of these nine.
 *
 * ─── Why this is a table and no longer a multiplier ──────────────────────────
 *
 * This used to be `ANNUAL_BILLED_MONTHS = 9` — "pay 9 months, get 12", which is
 * exactly 25% — with `yearlyUsd` derived from it. That abstraction is GONE and
 * must not come back, because the discounts it has to express no longer divide
 * into whole months: 20% off a year is ×9.6 months and 10% off a quarter is
 * ×2.7 months. There is no integer to name. (The stored years are rounder still
 * — $190 is ×9.5 months, not ×9.6 — which is the next paragraph's point.)
 *
 * The founder chose ROUNDED PRICES OVER EXACT PERCENTAGES, deliberately:
 * $405.45 on a pricing page reads like a spreadsheet error. So the prices are
 * the primitive and the percentages fall out of them, rather than the other way
 * round. The savings these nine numbers actually produce are:
 *
 *              Quarterly   Yearly
 *   Individual    10.0%     20.8%
 *   Small Team    10.0%     20.8%
 *   Ministry      10.0%     21.7%
 *
 * ⚠️ THE QUARTERLY COLUMN IS FLAT; THE YEARLY COLUMN IS NOT, and THE-343 is
 * what separated them again. The quarters are still exactly nine tenths of
 * three months ($54/$60, $108/$120, $162/$180), so every tier saves 10.0% on a
 * quarter to the cent. The years no longer share a ratio: Individual and Small
 * Team are 190/240ths of twelve and Ministry is 564/720ths, which is 21.7%
 * against their 20.8%.
 *
 * ⚠️ THE-248 HAD MADE BOTH COLUMNS FLAT, and that was a property of those
 * prices rather than a rule. Nothing here may assume either shape: the tiers
 * were 18.3 / 17.5 / 17.1 apart two reprices ago, flat after THE-248, and
 * spread again on the yearly column now that Ministry alone was repriced.
 *
 * 🔴 DO NOT COMPUTE A BADGE FROM THIS TABLE. See `ADVERTISED_DISCOUNT_PCT` —
 * the yearly column is why that is still true even now the columns are flat.
 *
 * ⚠️ CROSS-REPO: the marketing site (harvest-presentation-site) carries its own
 * copy of these nine numbers in src/components/Pricing.tsx, and a module-scope
 * contract there compares the TABLE — tier by tier, term by term — against the
 * numbers this file publishes. The two repos cannot share code, so changing a
 * price here means changing it there IN THE SAME BREATH or the site's build
 * fails and names the disagreement.
 */
export const PLAN_PRICING: Readonly<Record<PricedPlan, Readonly<Record<BillingTerm, number>>>> =
  Object.freeze({
    plus: Object.freeze({ monthly: 20, quarterly: 54,  yearly: 190 }),
    pro:  Object.freeze({ monthly: 40, quarterly: 108, yearly: 380 }),
    max:  Object.freeze({ monthly: 60, quarterly: 162, yearly: 564 }),
  });

/**
 * What Dodo charges for `plan` on `term`, in whole USD. The one read.
 *
 * 🔴 TAKES A `PricedPlan`, NOT A `TenantPlan`. `planPriceUsd('free', 'monthly')`
 * is a compile error, which is the entire point of the split: free has no price,
 * and the alternative — a `TenantPlan` parameter returning `undefined` — renders
 * as `$NaN/mo` on a card and fails nowhere. A caller holding a `TenantPlan` must
 * narrow with `isPricedPlan` first and decide what a free tenant sees.
 */
export function planPriceUsd(plan: PricedPlan, term: BillingTerm): number {
  return PLAN_PRICING[plan][term];
}

/**
 * Is this tier one that has a price, a term and a Dodo product?
 *
 * The one narrowing from `TenantPlan` to `PricedPlan`, and it asks the PRICING
 * TABLE rather than comparing against `'free'`. A literal comparison would need
 * editing the next time a tier stops being sold; this cannot fall out of step
 * with the table it guards.
 */
export function isPricedPlan(plan: TenantPlan): plan is PricedPlan {
  return Object.prototype.hasOwnProperty.call(PLAN_PRICING, plan);
}

/**
 * Is `raw` a tier this build KNOWS and that has NO price? (THE-212)
 *
 * Forever Free, today, and derived rather than named — a second tier that stops
 * being sold lands here the moment it leaves `PLAN_PRICING`.
 *
 * 🔴 THE `PLAN_ORDER` HALF IS LOAD-BEARING, and it is why this is not simply
 * `!isPricedPlan(raw)`. `plan` reaches this predicate as an untyped Firestore
 * string, and a RETIRED tier name — 'ultra', which this app carried and
 * deleted, and which live tenant documents still hold — is equally absent from
 * `PLAN_PRICING`. Treating "not priced" as "free" would tell a legacy tenant it
 * has no subscription, when in fact it has one nobody can name. So the tier
 * must be one this build recognises AND unpriced; anything unrecognised is a
 * legacy record and keeps whatever path it has today, untouched.
 *
 * The complement of `isPricedPlan` over the tiers this build knows, and the one
 * question "does this tenant have a subscription to manage?" is answered from.
 */
export function isUnpricedTier(raw: unknown): boolean {
  return (
    typeof raw === 'string' &&
    (PLAN_ORDER as readonly string[]).includes(raw) &&
    !isPricedPlan(raw as TenantPlan)
  );
}

/**
 * What a term works out to per month, exactly, unrounded. The arithmetic only —
 * nothing renders this. It is the reference the displayed figure is checked
 * against.
 */
export function planTermMonthlyExact(plan: PricedPlan, term: BillingTerm): number {
  return planPriceUsd(plan, term) / TERM_MONTHS[term];
}

/**
 * The per-month figure a card HEADLINES, as a number, CEILED AT THE CENT.
 *
 * ─── 🔴 WHY CEILING, AND WHY AT THE CENT (THE-196) ───────────────────────────
 *
 * This was `Math.round(price / months)` while it was a secondary line, and that
 * was defensible there: the charged total sat beside it in the same sentence,
 * so a dollar of rounding either way could not be mistaken for a bill.
 *
 * THE-196 makes it the headline — the biggest number on the card, the one a
 * church reads as "what this costs me". Rounding to nearest then becomes a
 * claim, and on two of the six discounted cells it is a claim that is too low:
 *
 *     Individual yearly    $329/12 = $27.4167  →  round = $27  → implies $324
 *     Small Team quarterly $199/3  = $66.3333  →  round = $66  → implies $198
 *
 * A church reading "$27/mo" reasonably expects $324 a year and is charged $329.
 * That is the whole of this ticket, and it is a pricing misrepresentation
 * rather than a rounding preference. (The brief named the Individual yearly
 * cell; Small Team quarterly understates too, by $1.)
 *
 * ⚠️ THOSE TWO CELLS ARE HISTORY — THE RULE IS NOT, AND THE-343 IS WHY THAT
 * DISTINCTION EARNS ITS KEEP. Under today's prices the three quarters divide
 * exactly ($54/3, $108/3, $162/3 are $18, $36, $54), two years round UP
 * ($190/12 → $16, $380/12 → $32) and Ministry's year divides exactly
 * ($564/12 = $47). So NO cell understates under `Math.round` any more — the one
 * that did, Ministry's $760/12 = $63.3333 → $63 → $756, was repriced away.
 *
 * 🔴 THAT IS NOT A REASON TO RELAX THE RULE, IT IS THE REASON IT IS A RULE.
 * A list of offending cells would now be empty and would read as permission to
 * go back to rounding; the next reprice puts a cell back without touching a
 * line of this file. The guard below therefore states the invariant, and the
 * mutations that prove it has teeth supply their own hazardous table rather
 * than borrowing one from prices that happen not to offend today.
 *
 * So the headline must never imply less than the charged total. Two roundings
 * satisfy that, and the choice between them is not aesthetic:
 *
 *   CEIL TO THE DOLLAR — $16, $32, $64 yearly. Clean, never understates, but
 *     $64 x 12 = $768 against a charged $760. The headline and the line
 *     directly beneath it would then disagree by $8, and a church that
 *     multiplies the one to check the other finds they do not reconcile. The
 *     fix for a card whose two numbers contradict each other cannot be a card
 *     whose two numbers contradict each other by a different amount.
 *
 *   CEIL TO THE CENT — $15.84, $31.67, $63.34 yearly. Never understates (the
 *     ceiling guarantees it) and reconciles: x12 lands within eight cents of
 *     the charged total, which is the rounding itself and nothing else.
 *
 * The cent it is. `$27.42` is two characters uglier than `$28` and it is the
 * only figure on the card that is actually true.
 *
 * ⚠️ An exact division keeps its whole-dollar form — $108/3 is $36.00 and
 * prints as `$36`, not `$36.00`. See `formatPlanMonthlyHeadline`. All three
 * quarters divide exactly under THE-248, so this branch is now the common case
 * rather than the rare one.
 *
 * The `toFixed(6)` before the ceiling is not decoration. `Math.ceil` on a
 * binary-float product turns an exact $33.00 into $33.01 the moment the
 * division lands a hair above the integer, which is precisely the direction
 * this function must not drift.
 */
export function ceilToCent(exact: number): number {
  const cents = Number((exact * 100).toFixed(6));
  return Math.ceil(cents) / 100;
}

export function planTermMonthlyDisplayed(plan: PricedPlan, term: BillingTerm): number {
  return ceilToCent(planTermMonthlyExact(plan, term));
}

/**
 * The headline string — `$27.42`, `$33`, `$159`. Carries no period suffix; the
 * card writes `/mo` beside it, the same split `formatPlanPrice` gets.
 */
export function formatPlanMonthlyHeadline(plan: PricedPlan, term: BillingTerm): string {
  const v = planTermMonthlyDisplayed(plan, term);
  return `$${v.toLocaleString('en-US', {
    minimumFractionDigits: Number.isInteger(v) ? 0 : 2,
    maximumFractionDigits: 2,
  })}`;
}

/**
 * 🔴 THE HONESTY GUARD. Runs at module scope, below.
 *
 * For every tier and every term, the headline figure multiplied back out by the
 * months in the term must not come to LESS than what Dodo actually charges.
 * Equal is fine, a few cents over is the ceiling doing its job, under is a
 * price the product advertises and does not honour.
 *
 * This is deliberately stated as the invariant rather than as the six expected
 * strings: a table of expected figures goes stale with the prices, and the
 * thing that must stay true is not "the Individual yearly headline is $27.42",
 * it is "no headline promises less than the bill".
 *
 * ⚠️ IT TAKES THE ROUNDING RULE AS AN ARGUMENT, and that is the whole point.
 * Checked against `ceilToCent` alone it could never fail — a ceiling cannot
 * round down, so the assertion would be true by construction and would guard
 * nothing. What can actually regress is the RULE: someone restores
 * `Math.round` here, or "tidies" the cents away to whole dollars. Passing the
 * rule in means the contract is a statement about the rule, and swapping in
 * the old `Math.round` makes it throw and names the tier it lied about. The
 * module-scope call below binds it to the rule the cards actually render.
 */
export function monthlyHeadlineContract(
  round: (exact: number) => number = ceilToCent,
  pricing: Readonly<Record<PricedPlan, Readonly<Record<BillingTerm, number>>>> = PLAN_PRICING,
): void {
  // Keys off the pricing table rather than PLAN_ORDER: this runs at module
  // scope and PLAN_ORDER is declared several hundred lines further down, so
  // naming it here is a temporal-dead-zone crash on import rather than a guard.
  for (const plan of Object.keys(pricing) as PricedPlan[]) {
    for (const term of BILLING_TERMS) {
      const charged = pricing[plan][term];
      const months = TERM_MONTHS[term];
      const displayed = round(charged / months);
      const implied = displayed * months;
      if (implied < charged - 1e-9) {
        throw new Error(
          `Plan pricing: the ${plan} ${term} headline of $${displayed}/mo implies ` +
            `$${implied.toFixed(2)} over ${months} months, but Dodo charges $${charged}. ` +
            `A headline may never promise less than the bill.`,
        );
      }
    }
  }
}

monthlyHeadlineContract();

/**
 * What `plan` on `term` actually saves against paying monthly, as an exact
 * percentage. Used by the honesty guard below, NOT by any badge.
 */
export function actualSavingPct(plan: PricedPlan, term: BillingTerm): number {
  const atMonthlyRate = planPriceUsd(plan, 'monthly') * TERM_MONTHS[term];
  if (atMonthlyRate === 0) return 0;
  // 🔴 SUBTRACT IN DOLLARS, MULTIPLY BEFORE DIVIDING. See the block comment
  // above: `(1 - price / atMonthlyRate) * 100` is the same arithmetic on paper
  // and computes an exact 10% as 9.999999999999998, which fails the guard below
  // and degrades an honest flat claim to "up to". This form keeps the numerator
  // a whole number — (60 - 54) * 100 / 60 is 600 / 60 — so an exact percentage
  // lands exact.
  return ((atMonthlyRate - planPriceUsd(plan, term)) * 100) / atMonthlyRate;
}

/** The two terms that carry a discount — every term except the monthly base. */
export const DISCOUNTED_TERMS = BILLING_TERMS.filter((t) => t !== 'monthly');

export type DiscountedTerm = Exclude<BillingTerm, 'monthly'>;

/**
 * The percentages the product ADVERTISES. Stored, deliberately.
 *
 * 🔴 NOT COMPUTED FROM `PLAN_PRICING`, and this is the whole point.
 *
 * The original reason was SPREAD: rounded prices produced a different real
 * saving on every tier — 15.4 / 16.0 / 16.4 on quarterly — so a computed badge
 * would have read "16%" beside the Ministry card and "15%" beside the
 * Individual one, on a toggle that sits above all three at once.
 *
 * ⚠️ THE-248 REMOVED THE SPREAD AND NOT THE REASON. All three tiers now save
 * 10.0% on a quarter and 20.8% on a year, so "one number cannot be derived from
 * three" no longer bites — but the YEARLY column still does, from the other
 * side. The founder advertises a ROUND 20%; the prices deliver 20.8%. A
 * computed badge would print "Save 20.8%" (or round to "21%") beside a page
 * that says 20 everywhere else, and a percentage nobody chose is not more
 * honest for being arithmetically derived — it is just a number the copy, the
 * Terms and the FAQ would then all have to chase.
 *
 * 🔴 SO THE SPLIT HOLDS: the NUMBER is a founder's decision and is stored; the
 * WORDING around it is derived (`discountClaimShape`), so the claim can never
 * outlive the prices. Do not "simplify" this to a computation because today's
 * quarterly happens to agree with one.
 */
export const ADVERTISED_DISCOUNT_PCT: Readonly<Record<DiscountedTerm, number>> = Object.freeze({
  quarterly: 10,
  yearly: 20,
});

/**
 * How a term's advertised percentage may be WORDED — derived, never typed.
 *
 * ⚠️ THE HONESTY RULE: no copy may claim a saving larger than the smallest
 * actual one. A flat "save 30%" is a claim about every tier, so it is only true
 * when the WORST tier saves at least 30%.
 *
 *   quarterly  advertises 10, worst tier saves 10.0  → 'flat'  → "Save 10%"
 *   yearly     advertises 20, worst tier saves 20.8  → 'flat'  → "Save 20%"
 *
 * The WORST tier is what both lines turn on, so Ministry's better yearly saving
 * does not move either of them: 20.8 is still the smallest yearly figure.
 *
 * 🔴 QUARTERLY IS NOW THE CASE THIS DERIVATION TURNS ON, and it turns on
 * EQUALITY rather than clearance. Every tier's quarter is exactly 10.0% off, so
 * the claim does not clear the worst saving — it MEETS it, to the cent. `<=` is
 * therefore load-bearing in a way it never was before: with `<`, a claim the
 * prices honour exactly would print "up to 10%", hedging against nothing.
 *
 * ⚠️ AND EQUALITY IS WHERE BINARY FLOATING POINT BITES. `actualSavingPct` had
 * to change for this comparison to see a true 10 rather than 9.999999999999998
 * — see the block comment there. The operator is right; the arithmetic feeding
 * it was not. Do not "fix" a future knife edge by loosening this to `<`.
 *
 * Yearly clears with room: 20 advertised against 20.83 delivered on Individual
 * and Small Team, and 21.67 on Ministry since THE-343 repriced it alone. The
 * claim is bounded by the WORST tier, so it is 20.83 that keeps this 'flat' —
 * Ministry saving more cannot make a 20% claim any less true.
 *
 * ⚠️ NOTHING IN THIS FUNCTION CHANGED to make that happen, and that is the
 * point of deriving it: the wording followed the prices without an edit. Do not
 * hardcode either answer — if a future reprice puts a tier back under the
 * advertised figure, "up to" must come back by itself. Nothing here decides the
 * NUMBER; it decides only whether the number can be stated bare, and it decides
 * that from the prices so the copy cannot outlive them.
 */
export type DiscountClaimShape = 'flat' | 'upTo';

/** Every priced tier, read off the table itself. `PLAN_ORDER` is declared far
 *  below this block and referencing it here would be a temporal-dead-zone
 *  error at module load; the table's own keys are the same three tiers.
 *
 *  🔴 THE SEAM THE FREE TIER IS BUILT ON. This is `PLAN_ORDER` minus `free`,
 *  arrived at from the other direction — and it existed, for its own unrelated
 *  ordering reason, before there was a free tier to exclude. Every discount and
 *  headline calculation walks THIS, so adding a tier with no price to
 *  `PLAN_ORDER` cannot make an unpriced tier appear in a saving percentage. */
const PRICED_PLANS = Object.keys(PLAN_PRICING) as PricedPlan[];

export function discountClaimShape(term: DiscountedTerm): DiscountClaimShape {
  const worst = Math.min(...PRICED_PLANS.map((plan) => actualSavingPct(plan, term)));
  return ADVERTISED_DISCOUNT_PCT[term] <= worst ? 'flat' : 'upTo';
}

/** The advertised saving for a term, in words. The one phrasing, app-wide. */
export function discountClaim(term: DiscountedTerm): string {
  const pct = ADVERTISED_DISCOUNT_PCT[term];
  return discountClaimShape(term) === 'flat' ? `Save ${pct}%` : `Save up to ${pct}%`;
}

/**
 * 🔴 MODULE-SCOPE HONESTY GUARD. An advertised percentage that exceeds what the
 * BEST tier saves is false under any wording — "up to 40%" when nothing reaches
 * 40% is not a hedge, it is a lie — so it fails the build rather than shipping.
 *
 * Deliberately checked here, at the table, and not in a test: the marketing
 * site runs the identical check at module scope during its prerender, and a
 * claim this app cannot make is a claim that site must not print either.
 */
for (const term of DISCOUNTED_TERMS) {
  const best = Math.max(...PRICED_PLANS.map((plan) => actualSavingPct(plan, term)));
  if (ADVERTISED_DISCOUNT_PCT[term] > best) {
    throw new Error(
      `plan-features: ${term} advertises ${ADVERTISED_DISCOUNT_PCT[term]}% off, but the best ` +
      `tier only saves ${best.toFixed(1)}%. No wording makes that true — lower the advertised ` +
      `percentage or reprice PLAN_PRICING.`,
    );
  }
}

// `PLAN_DONATION_RETENTION` was removed alongside the `donationRetention`
// matrix cell it mirrored. It existed to publish `100 - PLATFORM_FEE_MAP[plan]
// * 100` without importing the fee map into the client bundle. Every tier
// now charges a 0% platform fee, so the whole map was the constant 100 —
// nothing to publish, and one more copy of the fee to drift out of sync (which
// it previously did, advertising "keeps 100%" against a real 2.5% charge).
// PLATFORM_FEE_MAP (src/lib/stripe-connect.ts) is the single source for the fee.
// Surfaces that used to render retention now render the FEE — "Donation fee —
// 0%" — which is the number a customer actually cares about.

// `AI_ASSISTANT_ADDON_PRICING` ($200/mo) and `AI_TELEGRAM_ASSISTANT_ENABLED`
// (false) were REMOVED with the Telegram assistant (THE-253). The switch had
// been false since THE-224 and every surface behind it was dead; the price was
// worse than dead — $200 against a LIVE $20 product, a figure that could only
// ever mis-sell if anything read it again. Nothing did.
//
// ⚠️ THE LIVE $20 PRICE IS NOT HERE AND MUST NOT BE COPIED HERE. Add-on prices
// are settled in Dodo and quoted by the marketing site from
// `DODO_ADD_ON_CATALOG`; this repo maps add-on IDS to MEANINGS
// (`lib/dodo/catalogue.ts`) and never carries a figure. A second copy of $20 in
// this file is exactly the drift that made $200 outlive its product.

/**
 * Master switch for the affiliate programme across the whole app.
 * Set to `false` to hide every user-facing surface (admin nav entry and the
 * /admin/affiliate section, the standalone affiliate dashboard on
 * affiliate.theharvest.app, the affiliate auth copy, the "Affiliate Program"
 * permission row). Backend routes (/api/affiliate/*), the payout and
 * commission-window libs, the Stripe webhook's commission paths, the
 * `affiliate_commissions` collection and its rules are intentionally left
 * intact so the feature can be re-enabled by flipping this one boolean back to
 * `true`.
 *
 * Hidden because subscription billing is moving from Stripe to Dodo Payments (a
 * merchant of record), which changes the payout rail end to end — affiliate
 * transfers run through Stripe Connect today and that relationship does not
 * survive the move unchanged. A public programme promising 30% of subscription
 * revenue for 12 months, on a payout rail mid-migration, is how you end up owing
 * commission you cannot pay. Migrate billing first, then decide whether to bring
 * it back.
 *
 * NOT a kill switch for referral capture: `?ref=` attribution (ReferralTracker →
 * localStorage['affiliateReferrerId'] → `referrerId` in checkout metadata) runs
 * regardless of this flag, so a link shared before the programme was hidden
 * still attributes if that person signs up afterwards.
 */
export const AFFILIATE_PROGRAM_ENABLED = false;

/**
 * Master switch for Dodo Payments subscription billing.
 *
 * 🔴 TRUE. THE DODO CUTOVER IS ON. Signup goes through Dodo Checkout and the
 * Dodo webhook's `subscription.active` handler is what creates a tenant. This is
 * the highest-risk switch in the project — a broken signup is a broken business,
 * because there is no other way for a church to become a customer.
 *
 * Before this ships anywhere real, #291's acceptance checklist still applies: a
 * sandbox signup run end to end against Dodo, with the resulting SUBSCRIPTION
 * confirmed to carry the checkout metadata provisioning reads (`userId`,
 * `ministryName`, `newTenant`).
 *
 * Rolling back is the same one-line, reviewable change in reverse — set it to
 * `false` and both signup call sites POST to `/api/stripe/checkout` instead.
 *
 * 🔴 THAT NO LONGER MEANS "WORKS" (THE-353). It was true when written: at the
 * time, every tenant derived to `'stripe'` and Stripe was live, so "returns to
 * Stripe" and "returns to a working processor" were the same claim. They no
 * longer are — the Stripe platform account behind that route was closed by
 * Stripe as `rejected.fraud` and Stripe has stopped responding to appeals
 * (`STRIPE_PLATFORM_ACCOUNT_OPERATIONAL` in `@/lib/billing-processor`, which
 * this flag mirrors in shape). Flipping this flag off today would send EVERY
 * new-ministry signup — the one path with no existing tenant to route by, so
 * nothing in `billing-processor.ts` gates it — straight at that closed
 * account, with no other edit. Do not roll back believing "no other edit"
 * still means "safe": bring the new Stripe account (ClickUp 86bbnjmv5) live,
 * or fix signup on Dodo, before this flag ever goes false in production.
 *
 * ─── What it does, exactly ───────────────────────────────────────────────────
 *
 *  ON   `SIGNUP_CHECKOUT_ENDPOINT` resolves to `/api/dodo/checkout`, so both
 *       signup call sites (ChurchOnboarding's first attempt and OnboardingGate's
 *       restart) post there. `/api/dodo/checkout` serves the request. The Dodo
 *       webhook's `subscription.active` handler builds the tenant.
 *  OFF  Both call sites resolve to `/api/stripe/checkout` and the Stripe webhook
 *       is again the only thing that creates a tenant — the pre-#290 behaviour,
 *       whole. `/api/dodo/checkout` additionally refuses with 503, so a stale
 *       browser tab holding the previous bundle cannot keep the Dodo path open.
 *
 * ⚠️ THE DODO WEBHOOK DELIBERATELY DOES NOT READ THIS FLAG. It gates whether new
 * Dodo checkouts are CREATED, never whether an already-paid subscription is
 * honoured. A customer who was mid-checkout when the flag was turned off must
 * still get their church; refusing there would take their money and give them
 * nothing.
 *
 * ⚠️ TENANTS PROVISIONED WHILE THIS WAS ON KEEP WORKING WHEN IT GOES OFF. They
 * carry `dodo*` identifiers on `tenant_private` and no Stripe subscription;
 * nothing in the sign-in, roster, rules or admin-area path reads a Stripe id.
 * What degrades is billing MANAGEMENT for those tenants — see the pull request
 * body for the itemised list.
 *
 * Mirrors AFFILIATE_PROGRAM_ENABLED above in shape only: that one hides a
 * feature, this one routes money. Donations are
 * unaffected in either direction — giving stays on Stripe Connect at a 0%
 * platform fee (src/lib/stripe-connect.ts) and is not part of this migration.
 */
export const DODO_BILLING_ENABLED = true;

// ─── Accessors ────────────────────────────────────────────────────────────────

/**
 * Get feature flags for a given plan.
 * Defaults to 'plus' if plan is unknown.
 */
export function getPlanFeatures(plan: TenantPlan): PlanFeatures {
  return PLAN_FEATURES[plan] || PLAN_FEATURES.plus;
}

// ─── Add-ons layered on a plan (REP-5a) ──────────────────────────────────────

/** Owning nothing. The answer for every tenant that predates add-ons. */
export const NO_ADDONS: TenantAddons = Object.freeze({
  aiAssistant: 0,
  adminSeats: 0,
  unlimitedContacts: false,
});

/**
 * A plan's features with the tenant's add-ons layered on top.
 *
 * 🔴 `unlimitedContacts` IS A SEPARATE BOOLEAN AND STAYS ONE. It is not folded
 * into `maxContacts`, and that is a decision, not an omission:
 *
 *   • `Infinity` is not storable in Firestore, so it could never round-trip.
 *   • `-1` is storable and is already this matrix's unlimited sentinel — but it
 *     is a NUMBER, and the app compares these cells with `>=` and `<` in
 *     several places. One consumer that has not learned the sentinel evaluates
 *     `accountCount >= -1` as true forever and reports the church as AT ITS
 *     LIMIT — unlimited contacts becoming zero capacity, silently, for the most
 *     expensive add-on Harvest sells.
 *
 * So `maxContacts` here is always a real, finite, honest number — the tier's
 * published allowance, and since THE-370 nothing else, because the pack that
 * used to be added to it is retired — and the unlimited fact travels beside it. A cap check asks "unlimited, or under the number?" (see
 * `isAtContactLimit`). A consumer that has NOT been taught about the boolean
 * still reads a finite number that is at worst too small, never zero, and never
 * smaller than what the church actually paid for.
 */
export interface EffectiveFeatures extends PlanFeatures {
  /**
   * The Unlimited Contacts add-on. When true, `maxContacts` is a floor to be
   * ignored, not a limit to enforce.
   */
  unlimitedContacts: boolean;
}

/**
 * Coerce an untrusted `tenants/{id}.addons` value to a `TenantAddons`.
 *
 * Same shape and same reasoning as `toTenantPlan`: this field comes off a
 * Firestore document, it may be absent (every tenant created before REP-5a), and
 * it must fail closed to "owns nothing" rather than throw on a screen render.
 *
 * Counts are floored at 0 and rounded down. A negative quantity — a corrupt doc,
 * a hand edit — must never REDUCE a cap; that is the one direction an add-on may
 * never move a limit.
 */
export function readTenantAddons(raw: unknown): TenantAddons {
  if (!raw || typeof raw !== 'object') return NO_ADDONS;
  const value = raw as Partial<Record<keyof TenantAddons, unknown>>;
  const count = (n: unknown): number =>
    typeof n === 'number' && Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
  return {
    aiAssistant: count(value.aiAssistant),
    adminSeats: count(value.adminSeats),
    unlimitedContacts: value.unlimitedContacts === true,
  };
}

/**
 * Add capacity to a cap without ever lowering it.
 *
 * An already-unlimited cell is returned untouched — see `UNLIMITED_CAP`. A
 * negative addition is clamped to zero, so the invariant "no add-on lowers any
 * cap" holds structurally rather than by every caller remembering it.
 */
function raiseCap(base: number, extra: number): number {
  if (base === UNLIMITED_CAP) return base;
  return base + Math.max(0, extra);
}

/**
 * A plan's features with `addons` layered on — the function cap checks should
 * ask once a tenant's add-on set is in hand.
 *
 * 🔴 SEPARATE FROM `getPlanFeatures` ON PURPOSE, and `getPlanFeatures` is
 * unchanged. That function has roughly forty callers reading a tier's PUBLISHED
 * allowance — the pricing matrix, /api/plans, the comparison table, every
 * per-component gate. Teaching it about add-ons would move all forty at once,
 * and the ones that are meant to show the published number (a plan-comparison
 * row cannot show one church's purchased capacity) would become wrong with no
 * way to tell which. Two functions, two questions: "what does this TIER
 * include" and "what does this TENANT have".
 *
 * PURE. No fetch, no clock, no module state — `addons` is passed in by whoever
 * already holds the tenant doc. It returns a NEW frozen object and never
 * touches `PLAN_FEATURES`; `plan-features.test.ts` pins that every tier reads
 * identically before and after this is called.
 *
 * Three cells move, and only these three:
 *   `maxAdmins`    + one per admin seat
 *   `aiChat`       ← true when the AI Assistant add-on is held (THE-253)
 *   `aiKnowledge`  ← true when the AI Assistant add-on is held (THE-253)
 *
 * 🔴 `maxChurches` AND `maxContacts` NO LONGER MOVE HERE — THE-370. This list
 * used to carry two more lines, and the `maxChurches` one described the campus
 * add-on as "+ one per campus — the ONLY path past 1, which is the design".
 * THAT DESIGN IS RETIRED. Campuses are `UNLIMITED_CAP` on every paid tier, so
 * there is no cap left for an add-on to raise and no add-on left to raise it;
 * `maxContacts` lost its line with the Contacts +500 pack for the same reason.
 * Both cells now read straight through from the tier, which is what makes the
 * published number and the tenant's number the same number again.
 *
 * 🔴 THE LAST TWO BREAK THE OLD RULE ON PURPOSE — "an add-on buys capacity,
 * never a feature flag" was true, and it was exactly the defect. The AI
 * Assistant add-on is a LIVE Dodo product a church can buy today, and the one
 * cell it used to move (`aiAssistant`, a count belonging to the retired
 * Telegram assistant) was read by nothing. Buying it granted NOTHING — see
 * THE-224, which withdrew the marketing card rather than ship a card that
 * charged $20/mo for no change in behaviour. This is the build THE-224
 * declined to do, and that dead count is now gone entirely.
 *
 * 🔴 THE CHAT IS NOW THE ONLY THING THIS ADD-ON BUYS, on EVERY tier. No plan
 * carries `aiChat` any more, so these two lines are the sole path to `true`
 * anywhere in the app — which is why they are `||` and why the plan cells are
 * false. Setting either plan cell true would re-include what is sold.
 *
 * ⚠️ BOTH CELLS, NOT JUST `aiChat`, and that is not scope creep. The chat
 * answers ONLY from the knowledge base; `aiKnowledge` is what lets an admin put
 * anything in it. The add-on is sold on Individual, where `aiKnowledge` is
 * false — so lifting `aiChat` alone sells a chat that can only ever answer
 * "I don't have that". One purchase, one coherent capability.
 *
 * ⚠️ NEITHER PLAN CELL MOVES. `PLAN_FEATURES` is untouched: `aiKnowledge` stays
 * false/false/true/true as a tier capability, and `getPlanFeatures` still
 * answers the TIER question. A tenant that owns nothing reads exactly what its
 * tier publishes — `NO_ADDONS` in, base matrix out — which is what keeps the
 * plan-comparison surfaces honest.
 *
 * 🔴 A LIFT NEVER LOWERS. `||`, not assignment: a tier that already includes
 * the capability keeps it whether or not the add-on is held, so dropping the
 * add-on can never take away something the PLAN grants.
 */
export function getEffectiveFeatures(
  plan: TenantPlan,
  addons?: TenantAddons | null,
): EffectiveFeatures {
  const base = getPlanFeatures(plan);
  const owned = readTenantAddons(addons);
  return Object.freeze({
    ...base,
    maxAdmins: raiseCap(base.maxAdmins, owned.adminSeats),
    // 🔴 The RAG capability the AI Assistant add-on actually buys — see above.
    // `owned.aiAssistant` is the COUNT the Dodo webhook wrote from the live
    // product; owning one or ten is the same capability, so this is a
    // threshold, never a cap. `raiseCap` is the wrong tool for a boolean.
    aiChat: base.aiChat || owned.aiAssistant > 0,
    aiKnowledge: base.aiKnowledge || owned.aiAssistant > 0,
    unlimitedContacts: owned.unlimitedContacts,
  });
}

/**
 * Coerce an untrusted plan value — a Firestore field, an API body, or a plan
 * that is still loading — to a TenantPlan, failing closed to 'plus'.
 *
 * This is the same fallback getPlanFeatures() has always applied at runtime via
 * `|| PLAN_FEATURES.plus`; callers just had no way to say so in the type system
 * and were passing a bare `string`. PLAN_FEATURES is the source of truth for
 * which ids are real, so adding a tier cannot leave this behind.
 */
export function toTenantPlan(plan: string | null | undefined): TenantPlan {
  return plan && Object.prototype.hasOwnProperty.call(PLAN_FEATURES, plan)
    ? (plan as TenantPlan)
    : 'plus';
}

/**
 * Human-readable display names for each plan tier.
 * Internal IDs (plus/pro/max) stay the same.
 *
 * `max` displays as 'Ministry', not the old 'Community'. That is not a rename
 * of the product: 'Ministry' was the deleted `ultra` tier's name, and `max`
 * inherited it when the two folded together. The top tier is still called what
 * it was always called.
 */
export const PLAN_DISPLAY_NAMES: Record<TenantPlan, string> = {
  // 'Free' rather than a product-ish name ('Starter', 'Evangelist'). The
  // differentiator on the pricing page is the AUDIENCE (the blurb carries it)
  // and the price; a church comparing cards should read the one word that says
  // it costs nothing. Capitalised because every other entry here is a proper
  // noun rendered mid-sentence in upgrade copy — `FEATURE_MIN_PLAN` puts this
  // string directly into "Available on Free and above".
  free: 'Free',
  plus: 'Individual',
  pro: 'Small Team',
  max: 'Ministry',
};

/**
 * The one-line blurb under a tier's name — who the plan is FOR, not what it
 * contains.
 *
 * These are the only strings on a plan card that are typed rather than derived.
 * Everything else a card prints comes out of `PLAN_FEATURES` above, because a
 * hand-written list of what a tier includes is how this product once advertised
 * "keeps 100%" against a real 2.5% fee. A blurb has nothing in the matrix to
 * derive from — "for solo evangelists" is an audience, not a capability — so it
 * is written down, once, HERE rather than in a component, so the in-app card and
 * anything else that ever wants it read the same sentence.
 *
 * ⚠️ CROSS-REPO, same shape as `ANNUAL_BILLED_MONTHS` above: the marketing site
 * (harvest-presentation-site) carries its OWN copy of these three sentences in
 * src/components/Pricing.tsx. The two repos cannot share code, so a reworded
 * tagline here does NOT reach theharvest.site and the two will drift. That
 * drift is cosmetic — a tagline is a description of an audience, not a claim
 * about what the plan does, so a stale one cannot mis-sell the way a stale
 * price or a stale feature list can — but it is real, and changing one of these
 * means changing it there too if the two are meant to read alike.
 */
export const PLAN_BLURBS: Record<TenantPlan, string> = {
  // Names the audience and the ONE thing the tier does, in that order. It has
  // to sit beside "For solo evangelists and missionaries." (Individual) without
  // reading as the same product, which is why it says PERSONAL discipleship
  // and one course rather than repeating "evangelists" alone.
  free: 'For evangelists discipling one person at a time.',
  plus: 'For solo evangelists and missionaries.',
  pro:  'For small ministries growing as a team.',
  max:  'For established churches going deeper.',
};

/** Get the display name for a given plan. Defaults to 'Individual' if unknown. */
export function getPlanDisplayName(plan: TenantPlan): string {
  return PLAN_DISPLAY_NAMES[plan] || PLAN_DISPLAY_NAMES.plus;
}

/**
 * Check if a specific feature is enabled for a plan.
 *
 * The number branch below covers the CAP cells (`maxContacts`, `maxAdmins`,
 * `maxChurches`, `maxCourses`), reading 0 as false; every other PlanFeatures
 * member is a boolean. It also used to cover `aiAssistant`, which was removed
 * with the Telegram assistant (THE-253) — the branch stays because the caps
 * still need it.
 */
export function hasFeature(plan: TenantPlan, feature: keyof PlanFeatures): boolean {
  const features = getPlanFeatures(plan);
  const value = features[feature];
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  return false;
}

// ─── Feature gates & minimum plan (derived) ───────────────────────────────────

/**
 * Plan tiers cheapest → most expensive. Upgrade order; do not reorder.
 *
 * 🔴 `free` IS FIRST, and the position is load-bearing rather than tidy.
 * `getMinPlanForFeatureCell` walks this array and returns the FIRST tier whose
 * cell is truthy, so the array's order IS the definition of "cheapest tier that
 * has this feature" — the string shown to a paying church in every upgrade
 * prompt. Free costs nothing, so it is the cheapest, so it goes first. Putting
 * it anywhere else would make an upgrade screen name Individual for `crm` when
 * a free tenant already has it.
 *
 * ⚠️ EVERY TIER, not every SELLABLE tier. `PRICED_PLANS` (above, derived from
 * `PLAN_PRICING`) is the one to walk for anything about money. Contrast the two
 * before adding a consumer.
 */
export const PLAN_ORDER: readonly TenantPlan[] = ['free', 'plus', 'pro', 'max'] as const;

/**
 * The one tier that is not sold, named once.
 *
 * 🔴 THE ADMIN NAV READS THIS, and it is the only tier whose nav is not derived
 * from its own feature cells. THE-202 built the free tier's "see every feature,
 * read-only" mode from the founder's words — "the admin of this free plan can
 * see all the features and can navigate through them but he cannot use any of
 * them" — and THE-220 is the correction to its scope: only free shows the whole
 * list. A priced tier shows what it bought.
 *
 * ⚠️ NAMED, not spelled, precisely because it is a bypass. A gate that opens for
 * one tier is worth being able to grep for, and `resolvedPlan === 'free'` in a
 * component is not — it reads as an ordinary comparison rather than as the
 * deliberate exception it is. `isPricedPlan()` is NOT the inverse to reach for
 * here: it also answers false for a retired or unrecognised tier name, so a
 * legacy tenant would silently inherit the free tier's see-everything nav.
 */
export const FREE_PLAN: TenantPlan = 'free';

/**
 * The tiers a church can BUY, cheapest → most expensive — `PLAN_ORDER` minus
 * the free one.
 *
 * 🔴 THIS IS WHAT A PLAN-CARD GRID ITERATES, not `PLAN_ORDER`. Every surface
 * that sells (the settings plan cards, the admin upgrade page, the marketing
 * pricing table) is offering a purchase, and a card for a tier with no price
 * and no Dodo product is a checkout button that cannot work. Adding `free` to
 * `PLAN_ORDER` therefore changes NO rendered plan grid — those grids moved to
 * this list in the same commit, and their output is byte-identical to before.
 *
 * ⚠️ `PLAN_ORDER` remains the right list for anything about ENTITLEMENT — which
 * tier is cheapest for a feature, whether a plan change is a downgrade — because
 * free is a real tier a tenant can genuinely be on.
 *
 * Derived by filtering, so a tier cannot appear here without a pricing row.
 */
export const PRICED_PLAN_ORDER: readonly PricedPlan[] = PLAN_ORDER.filter(isPricedPlan);

/**
 * The most expensive tier — the last entry in `PLAN_ORDER`.
 *
 * DERIVED, not hardcoded. This is the "no plan unlocks it, name the top tier"
 * fallback for upgrade copy; it used to be a literal `'ultra'`, which is
 * exactly the kind of reference that breaks silently the next time a tier is
 * added or removed. Reading the last index means a tier change can only ever
 * move it, never leave it pointing at a plan that no longer exists.
 */
export const TOP_PLAN: TenantPlan = PLAN_ORDER[PLAN_ORDER.length - 1];

/**
 * Gate keys used by `usePlanGate` and the upgrade screens. These are the
 * snake_case names threaded through UI call sites (e.g.
 * `<PlanUpgradeScreen featureKey="community_chat" />`); `FEATURE_MAP` translates
 * them to the camelCase `PlanFeatures` cells they actually gate on.
 */
export type FeatureKey =
  | 'fundraising'
  | 'event_registration'
  | 'docs'
  | 'crm'
  | 'accounting'
  | 'community_chat'
  | 'tax_receipts';

export const FEATURE_MAP: Record<FeatureKey, keyof PlanFeatures> = {
  fundraising: 'fundraising',
  event_registration: 'eventRegistration',
  docs: 'docs',
  crm: 'crm',
  accounting: 'accountingTools',
  community_chat: 'communityGroups',
  tax_receipts: 'taxReceipt',
};

/**
 * Cheapest plan that unlocks `feature`, or `null` if no plan does.
 *
 * DERIVED from `PLAN_FEATURES` — walk `PLAN_ORDER` and return the first tier
 * whose cell is truthy. This replaced two hand-maintained literal maps
 * (`FEATURE_MIN_PLAN` in usePlanGate.ts and `FEATURE_MIN_PLAN_NAME` in
 * PlanUpgradeScreen.tsx) that had silently drifted from the matrix: both listed
 * `crm` and `tax_receipts` as Ministry when Community (max) has had them for
 * some time, so upgrade screens told an Individual or Small Team admin to buy
 * the top plan when the tier below already unlocked the feature. Deriving makes
 * that class of drift structurally impossible — do not reintroduce a literal
 * map. (The repricing moved `crm` and `docs` down again, to Small Team; the
 * labels followed with no edit here, which is the point.)
 *
 * Truthiness matches `hasFeature`: numeric cells count as unlocked when non-zero.
 */
export function getFeatureMinPlan(feature: FeatureKey): TenantPlan | null {
  const key = FEATURE_MAP[feature];
  if (!key) return null;
  return getMinPlanForFeatureCell(key);
}

/**
 * Cheapest plan whose matrix cell `key` is truthy, or `null` if none is.
 *
 * Same derivation as `getFeatureMinPlan`, but keyed on the raw `PlanFeatures`
 * cell rather than a `FeatureKey` gate name. Not every cell has a `FeatureKey`
 * — those exist only for features fronted by `usePlanGate`/`PlanUpgradeScreen`
 * — so this is the way to derive a minimum-plan label for the rest (e.g.
 * `customDomain`, which is gated by a boolean prop, not a gate key). Use it
 * instead of writing a plan name into UI copy by hand: hardcoded names are
 * exactly what drifted in #242.
 */
export function getMinPlanForFeatureCell(key: keyof PlanFeatures): TenantPlan | null {
  return PLAN_ORDER.find((plan) => hasFeature(plan, key)) ?? null;
}

/**
 * Display name of the cheapest plan that unlocks `feature` (e.g. 'Ministry').
 * Falls back to the TOP tier's name if nothing unlocks it, so upgrade copy can
 * never render an empty plan name.
 *
 * The fallback goes through `TOP_PLAN` (derived from the last `PLAN_ORDER`
 * entry) rather than naming a tier literally. It used to read
 * `PLAN_DISPLAY_NAMES.ultra`, which stopped compiling the moment that tier was
 * deleted — the point of deriving it is that the next tier change cannot break
 * this the same way, or worse, break it silently.
 */
export function getFeatureMinPlanName(feature: FeatureKey): string {
  const plan = getFeatureMinPlan(feature);
  return PLAN_DISPLAY_NAMES[plan ?? TOP_PLAN];
}

/**
 * Every gate key → the display name of its minimum plan, derived once at module
 * load. The single source both `usePlanGate` and `PlanUpgradeScreen` read, so
 * the two surfaces can never disagree. Frozen: it is derived state, not config.
 */
export const FEATURE_MIN_PLAN: Readonly<Record<FeatureKey, string>> = Object.freeze(
  Object.fromEntries(
    (Object.keys(FEATURE_MAP) as FeatureKey[]).map((k) => [k, getFeatureMinPlanName(k)])
  ) as Record<FeatureKey, string>
);

/**
 * The CRM feature's display name FOR ONE TIER — the single definition of that
 * label in this repo.
 *
 * 🔴 "DONORS" IS A CLAIM ABOUT `fundraising`, NOT ABOUT `crm`. A tier with no
 * donate page cannot receive a gift, so no donor record can ever exist in its
 * CRM — naming donors there advertises half a roster the tier is structurally
 * unable to fill. Every tier that pays has `fundraising: true`, so all three
 * priced tiers read "CRM (Donors & Members)" exactly as they always have; free
 * is the only tier this answers differently, and it is the only tier whose
 * `fundraising` cell is false.
 *
 * Derived rather than written per card for the reason PlanUpgradeScreen's
 * minimum-plan labels are derived: a hand-written label is a second copy of the
 * matrix that drifts from it silently. Taking `PlanFeatures` rather than a
 * `TenantPlan` means a caller that has already resolved the tier's features
 * — every card renderer does — reads the matrix once, and an add-on-adjusted
 * `EffectiveFeatures` answers for what the tenant actually holds.
 *
 * ⚠️ The marketing site carries its own copy of these two strings (see
 * `crmLabel` in harvest-presentation-site components/Pricing.tsx). That is the
 * same deliberate two-sided seam as the cross-repo price contract: two
 * independently-written copies, kept honest by a test on each side rather than
 * by an import neither repo can make. Change them together.
 */
export function crmLabel(features: Pick<PlanFeatures, 'fundraising'>): string {
  return features.fundraising ? 'CRM (Donors & Members)' : 'CRM (Members)';
}

/**
 * Branding-family entitlement — does this plan's feature set unlock the admin
 * Branding tab/page? Extracted from AdminDashboard so the OR chain has exactly
 * one definition and can be asserted per tier in plan-features.test.ts.
 *
 * `customBackground` used to be a third term here. It was true on precisely the
 * tiers where `customBranding` is true — at the time Community/max and the
 * since-deleted Ministry/ultra — so removing it left every tier's Branding
 * access unchanged:
 *   Individual (plus) hidden · Small Team (pro) hidden · Ministry (max) shown.
 * Folding ultra into max did not change that either: max already had both
 * `customBranding` and `customDomain`.
 */
export function hasBrandingAccess(features: PlanFeatures): boolean {
  return features.customBranding || features.customDomain;
}

/**
 * The suffix each term's CHARGED figure carries — "$329/yr", not "$329/mo".
 *
 * 🔴 The suffix names the billing cycle, so the amount beside it is the amount
 * that leaves the church's account on that cycle. A quarterly plan is charged
 * $99 every three months and says so; the per-month arithmetic is a separate,
 * clearly-labelled line (`planTermMonthlyEquivalent`), never this one.
 */
export const TERM_PRICE_SUFFIX: Readonly<Record<BillingTerm, string>> = Object.freeze({
  monthly: 'mo',
  quarterly: 'qtr',
  yearly: 'yr',
});

/**
 * How a term is described in running prose — "billed quarterly".
 *
 * A total map rather than a ternary, deliberately. The confirmation banner on
 * signup asked `billing === 'yearly' ? 'billed annually' : 'billed monthly'`,
 * which was correct while there were two terms and silently WRONG the moment
 * there were three: a church that chose quarterly was shown "billed monthly" on
 * the last screen before it paid. A record over the union cannot fall into an
 * else-branch that way — a new term is a type error here, not a wrong sentence.
 */
export const TERM_BILLED_PHRASE: Readonly<Record<BillingTerm, string>> = Object.freeze({
  monthly: 'billed monthly',
  quarterly: 'billed quarterly',
  yearly: 'billed annually',
});

/**
 * Format a plan's CHARGED price for a term, e.g. "$39/mo", "$99/qtr", "$329/yr".
 *
 * 🔴 Returns **'Free'** for the free tier, not `$0/mo`. It has no price and no
 * billing term, so a `/mo` suffix on it would be a claim about a billing cycle
 * that does not exist — and `$0/qtr` on a quarterly toggle reads as a product
 * you are billed nothing for quarterly, which is a different (and wrong) thing.
 * The `!pricing` 'Custom' branch is kept for the Enterprise/unknown case it
 * always covered; free is checked BY NAME through `isPricedPlan` so a missing
 * pricing row can never silently render as free.
 */
export function formatPlanPrice(plan: TenantPlan, term: BillingTerm): string {
  if (!isPricedPlan(plan)) return 'Free';
  const pricing = PLAN_PRICING[plan];
  if (!pricing) return 'Custom';
  return `$${planPriceUsd(plan, term).toLocaleString()}/${TERM_PRICE_SUFFIX[term]}`;
}
