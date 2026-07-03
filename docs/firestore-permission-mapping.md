# Firestore rules: the 23-permission → collection mapping

This documents how `firestore.rules` enforces the per-admin permission flags
(`users/{uid}.permissions`, the 23-key catalog in `PERMISSION_CATEGORIES`,
`src/components/AnalyticsAndRoles.tsx`) on **writes** to admin-feature
collections. Built from the real writers in the code, not from the nav labels.

## Who always passes

`hasPermission(perm, tenantId)` grants a write when the caller is **any** of:

| Actor | How the rules recognize them | Why |
|---|---|---|
| Super admin | `superAdmin` claim / hardcoded platform emails | platform operator |
| Tenant owner | `tenants/{t}.ownerId == uid` | the buyer; their users doc often has **no permissions map at all** (webhook writes only role/tenantId/plan) |
| adminEmails-roster admin | auth email in `tenants/{t}.adminEmails` | legacy full-access shape; may have `role: 'user'` and no permissions map |
| Full-access admin | `permissions.fullAccess == true` sentinel | what the Roles editor's "Full Access" toggle writes |
| Specific-permission holder | `permissions.<perm> == true` **and** `isTenantAdmin(tenantId)` | the limited-admin case this change enforces |

Non-admins never pass: `isTenantAdmin` remains the base of the last branch.
Legacy `seeFormsInbox: true` counts as `manageForms` (`hasFormsPermission`),
mirroring the client's `normalizePermissions()`.

## The mapping

| Permission | Collections (writes gated) | Notes |
|---|---|---|
| `writeArticles` | `blog_posts`; `tenants/{t}/blogAutomation` | blog editor + automation settings |
| `createPosts` | `community_posts` cross-author moderation (edit/delete/pin) | member carve-outs unchanged: own posts, `likes`/`pollOptions`/`eventDetails` field updates, comments |
| `createCourses` | `courses`; `authors`; `categories` | authors/categories are a **global** library with no tenantId on docs — gated on the writer's own-tenant permission; the old rule referenced a tenantId field that never existed, so these writes were accidentally super-admin-only (now fixed + gated) |
| `uploadRag` | `rag_sources`; `rag_chunks` | create still pins the doc's tenantId to the writer's tenant |
| `manageNewsletter` | `tenants/{t}/newsletters` | all live traffic is via `/api/newsletter/*` (Admin SDK); rule guards direct SDK writes |
| `manageDocs` | `docs`; `docFolders`; plus a `sermonNote`-only update on `tenants/{t}/livestream/*` | the carve-out keeps Notes → "Share to Livestream" working for docs-only admins |
| `modifyChurches` | `churches` (+ `announcements` subcollection) | reads stay open (member map/details) |
| `manageCRM` | `contacts`, `contactActivities` (top-level; the `tenants/{t}/…` twins are dead but gated the same) | CRM upserts create docs, so create/update share the gate |
| `manageCommunity` | `tenants/{t}/channels` (admin writes), `channelMessages` (admin branch + moderation), `dmMessages` (moderation), `directMessages` (delete) | member carve-outs unchanged: channel members post + bump `lastMessage`/`lastMessageAt`; DM create/reply/read-receipt |
| `manageForms` | `tenants/{t}/forms` (+ `submissions` subcollection) | legacy `seeFormsInbox` honored |
| `manageFundraising` | `campaigns` (top-level); `tenants/{t}/pledges` | public pledges go through `/api/pledge/submit` |
| `manageAccounting` | `tenants/{t}/invoices` | client performs no writes today (webhook/QuickBooks routes do) |
| `manageGivingStatements` | `tenants/{t}/givingStatements` | generation happens server-side |
| `manageEvents` | `tenants/{t}/events`; `registrations` **update/delete only** | member RSVP self-create branch untouched (flagship member flow) |
| `manageCheckin` | `tenants/{t}/checkinSessions` (+ `attendees`) | the QR sub-tab writes nothing, so `manageQR` deliberately does **not** grant session writes |
| `manageQR` | — no write surface | pure client-side generator |
| `manageLivestream` | `tenants/{t}/livestream`, `livestreamSessions` (+ `prayers`) | viewer counts/prayers written server-side |
| `manageSms` | `tenants/{t}/smsBroadcasts` (+ `logs`), `smsLogs` | sends via `/api/sms/*`; Twilio config lives in `tenants/{t}/integrations` (no rules block → client default-deny, correct since it holds the auth token) |
| `analytics` | — no write surface | read-only feature; the Analytics tab's user-delete button was already denied by rules (delete is super-admin-only, pre-existing) |
| `manageAdmins` | `users/{uid}`: changing a member's `role`/`permissions` now requires it | any tenant admin may still edit non-privileged member fields; owner's role/permissions remain immutable; role clamp (`user`/`admin`) unchanged |
| `manageBranding` | `tenants/{t}` doc update (shared gate with `manageSettings`) | Branding + Domain sections write tenant-doc config fields |
| `manageAffiliate` | — no write surface | affiliate data is server-authority (`/api/affiliate/*`) |
| `manageSettings` | `tenants/{t}` doc update (shared gate with `manageBranding`); `tenants/{t}/settings` (dormant) | Onboarding/GivingStatements/Integrations sections write tenant-doc fields; billing/owner/roster fields remain blocked for everyone but the super admin |

## Additional hardening in the same change

- `users` self-edit: `permissions`, `tenantId`, `plan` joined `role` in the
  deny-list; tenant admins can no longer rewrite a member's `tenantId`/`plan`.
  The three client flows that bundled a best-effort `tenantId` re-stamp were
  fixed (fcmTokens-only writes; dead null→tenant migration removed).
- `donations`: dead collection whose `update/delete` was open to **any**
  admin of **any** tenant (unscoped `isAdmin()`); now super-admin-only.
- Dead rules blocks removed (default deny): `tenants/{t}/members`,
  `tenants/{t}/campaigns` — zero readers/writers anywhere in the code.
- `prayer_requests` deliberately **kept** at author-or-`isTenantAdmin` delete:
  the delete UI lives in the member-facing PrayerWall and is role-gated; no
  permission key exists for it.

## Adversarial-review findings (4 confirmed; 2 fixed here, 2 flagged)

A four-lens adversarial review (lockouts / holes / semantics / read-regressions,
each finding independently verified against the code and the emulator suite)
ran over this change. It found **no active lockout** of any legitimate live
write flow and confirmed the write-side conversion is sound. Four issues
surfaced — all **pre-existing**, none introduced by this change:

**Fixed in this change (safe, no lockout):**
- **`rag_sources` / `rag_chunks` cross-tenant read leak (HIGH).** The read was
  the unscoped `isAdmin()`, which carries a **global** admin claim — so any
  tenant's admin could read another tenant's private knowledge-base text via a
  direct SDK query (`where('tenantId','==','OTHER')`). Same class as the
  `donations` leak. Now `isTenantAdmin(resource.data.tenantId)`: same-tenant
  admins, the owner, roster admins, and super admins keep read; cross-tenant
  admins are blocked. Members were already denied by the old `isAdmin()`, so no
  new lockout (verified — `AIChat` in the member app reads these client-side but
  already couldn't under `isAdmin()`; the retrieval path is unchanged for it).
- **Top-level `submissions` update/delete (LOW).** The last admin-feature write
  still on coarse `isTenantAdmin`. Now `hasFormsPermission` (honors legacy
  `seeFormsInbox`), matching the live `forms/{f}/submissions` pipeline. Members
  may still file one; the reader component is orphaned so live impact was nil.

**Flagged for Matei — not changed here (per review decision):**
- **`users` create never validates `tenantId` (HIGH, pre-existing).** Part 1
  locked `tenantId` on *update*, but the *create* rule (`firestore.rules`, the
  `allow create` on `/users`) constrains only `role`. A self-registering user
  can set `tenantId` to **any** church and then `belongsToTenant()` passes,
  letting them read that tenant's `prayer_requests` / `community_posts` /
  `forms` / `directMessages` and post into them; `setCustomClaims`
  (`src/lib/set-custom-claims.ts:23,28-30`) even copies the self-written
  `tenantId` into a real token claim with no membership check. Rules alone
  can't distinguish a legitimate subdomain signup (`AuthPage.tsx` derives
  `tenantId` from the hostname) from a spoofed value, so the durable fix is
  **server-side**: have `setCustomClaims` / a signup route verify tenant
  membership instead of trusting the client-written doc. Not touched here to
  avoid breaking the signup funnel — needs a product call on whether open
  cross-tenant self-registration is intended.
- **Dead `onChangePlan` self-writes `users.plan` (LOW, latent).**
  `AdminDashboard.tsx:696` defines an `onChangePlan` prop that does
  `updateDoc(users/{uid}, { plan })` with no try/catch — now correctly rejected
  by Part 1's self-edit lock. It is **dead** (the prop is never invoked; plan is
  server-authority via the Stripe webhook), so there is no live lockout. Left
  in place; a future re-wiring should route plan changes through a server route,
  and the dead prop is a candidate for removal.

## Known residuals (out of scope here, flagged for follow-up)

1. **API routes don't check the 23 permissions.** Server routes authorize by
   role/claims/ownership only (`src/lib/api-auth.ts`); a limited admin blocked
   from direct Firestore writes can still call `requireAdmin` routes (e.g.
   newsletter/SMS sends, giving-statement generation, blog automation). Rules
   are the only per-permission layer today; per-permission checks in
   `requireAdmin` would close this.
2. **Collections written by the client but absent from the rules** (default
   deny, i.e. those client writes already fail silently today):
   `tenants/{t}/canvases` (CanvasEditor), `tenants/{t}/integrations` iframe
   URLs (AdminIframeIntegration — note the same collection holds the
   server-only Twilio token doc, so any future allow must be per-doc-id), and
   top-level `domains` (DomainSection). Left untouched.
3. **Member self-delete of the users doc** is denied by rules (super-admin
   only) while the account-deletion UI attempts it — orphaned PII doc after
   Auth deletion (pre-existing; needs a server route).
4. Top-level `submissions` is a dead legacy inbox (orphaned `AdminInbox`);
   left as-is to avoid breaking any straggler clients, candidate for removal.
5. `email_log` read is unscoped `isAdmin()` (cross-tenant read of log
   metadata); reads were out of scope for this change.
