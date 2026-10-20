# Newsletter (Phase 3): Plunk-backed broadcasts with Eden-style UI

Branch `feat/newsletter-plunk`. Specs: `2026-09-25-newsletter-optin-crm-spec`, redesign plan Phase 3.

## Rules of the build
- `NEWSLETTER_FEATURE_ENABLED` stays `false` (THE-335 pins it). The new workspace mounts in the
  existing `newsletter` tab branch, so flipping that one switch is still the whole launch.
- Sending goes through `src/lib/email/provider.ts` (interface). `plunk.ts` is the only live
  implementation (server-only, `PLUNK_API_KEY`). `ses.ts` is a stub. UI imports no provider.
- Default mode is the Harvest-managed shared Plunk account. A church verifies its own domain and
  sends from `mail.<domain>`. Bring-your-own Plunk/Mailchimp key is a disabled "coming soon" row.
- Plan gate: `hasFeature(plan, 'newsletterAutomation')` (the existing matrix cell); super admin bypass.
- Every send: signed one-click unsubscribe link, `List-Unsubscribe` + `List-Unsubscribe-Post`
  headers, suppression list, opt-out record, per-tenant monthly volume cap, and a visible error on a
  partial send. Suppressed or unsubscribed contacts are never sent to.
- Send and schedule are preview-then-confirm: the server issues a single-use token bound to the
  tenant, user, broadcast and a hash of subject/body/audience/time (same shape as blog #531).
- Missing `PLUNK_API_KEY` answers a clean 503 JSON; the UI shows a friendly message. Tests mock the adapter.

## Server (`src/lib/email/`, `src/app/api/email/`)
provider, plunk, ses (stub), unsubscribe (HMAC token), audience (filters + suppression partition),
volume-cap, confirm (token + ledger), service (draft/preview/confirm/due), store (Firestore, Admin SDK).
Routes: `POST /api/email/actions`, `GET|POST /api/email/unsubscribe` (public, one-click RFC 8058),
`GET /api/email/cron` (due scheduled sends, `CRON_SECRET`).

## One CRM (founder decision, supersedes the first draft of this plan)
There is no separate newsletter contact list. Subscribers are a filtered view over the existing
`contacts` documents, which gain email-consent fields: `emailStatus` (`subscribed`, `unsubscribed`,
`bounced`, `complained`; absent means never opted in and is never emailed), `emailOptInAt`,
`emailOptInSource`, `emailUnsubscribedAt`, `emailUnsubscribedFrom`.
- CSV import creates new CRM people or merges onto the person with that email (opt-in recorded, tags added).
  Someone suppressed is never re-subscribed by an import.
- The public unsubscribe link and the one-click POST set `emailStatus: unsubscribed` on every CRM person
  with that address. An address suppressed on any duplicate stays suppressed.
- Audience filters read CRM tags and people kinds (Members, Donors).
- Known gap: deleting a CRM person deletes their suppression with them. Reported, not solved here.

## Firestore
- Broadcasts, sender settings and the monthly usage counter are the only new data, under
  `tenants/{id}/emailBroadcasts|emailConfig|emailUsage`, plus top-level `email_scheduled` and
  `email_confirm_tokens`. All server-only (Admin SDK); no client rule exists, so they are denied by default.
- **One rules change**, called out for the founder go: the top-level `contacts` match block (the CRM collection the app uses; the legacy nested
  `tenants/{id}/contacts` block is untouched) refuses a client
  create or update that sets or changes any `email*` consent key. Without it a CRM admin's browser could
  re-subscribe someone who unsubscribed or bounced. Reads and every other write are unchanged. Covered by
  `tests/rules/email-consent.rules.test.ts` (CI runs the emulator; not run locally).
- No composite indexes (single-field `where` + in-memory sort, house convention).

## Branding (founder decision)
Harvest branding always: navy and gold through the app's theme tokens (`bg-primary`, `bg-gold`,
`bg-navy-*`, `bg-surface-*`, `text-strong|muted|faint`, `border-line`). No Eden hex anywhere in the UI; a
guard test sweeps `components/email` for hex and raw Tailwind scales. Eden supplies layout and flows only.
The one exception is the HTML of the email itself, which cannot read CSS variables, so `render.ts` spells
the Harvest brand scale out and nowhere else.

## UI (`src/components/email/`, shadcn primitives, theme tokens)
Overview, Broadcasts list (All/Drafts/Scheduled/Sent + empty state), Editor Write step (subject,
preheader, A/B variant, toolbar, body, side panel, inbox check), Design dialog, Preview dialog
(computer/phone/dark), Templates dialog, Send step (audience filters, Now/Pick a time with calendar and
time slots, From/Subject), Subscribers table + Import contacts (CSV), Email settings (sender, domain
verification), Start-newsletter dialog. Skipped: Eden's AI side panel, sequences, automations.

## Proof
Unit tests (adapter, unsubscribe/suppression, cap, confirm token, plan gate), component tests for the
key dialogs, tsc, lint. Screenshot harness (uncommitted) at 1440 light and dark in `/workspace/qa-news/`.
