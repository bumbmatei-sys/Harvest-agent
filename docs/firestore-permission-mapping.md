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
