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

## Firestore
All new data is server-only under `tenants/{id}/email*` (Admin SDK). Rules default-deny unmatched
subcollections, so **no `firestore.rules` change**; a rules test pins that clients cannot read or write
them (subscriber PII is only reachable through admin-gated routes). Plus `email_confirm_tokens` (server-only).
No composite indexes (single-field `where` + in-memory sort, house convention).

## UI (`src/components/email/`, shadcn primitives, theme tokens)
Overview, Broadcasts list (All/Drafts/Scheduled/Sent + empty state), Editor Write step (subject,
preheader, A/B variant, toolbar, body, side panel, inbox check), Design dialog, Preview dialog
(computer/phone/dark), Templates dialog, Send step (audience filters, Now/Pick a time with calendar and
time slots, From/Subject), Subscribers table + Import contacts (CSV), Email settings (sender, domain
verification), Start-newsletter dialog. Skipped: Eden's AI side panel, sequences, automations.

## Proof
Unit tests (adapter, unsubscribe/suppression, cap, confirm token, plan gate), component tests for the
key dialogs, tsc, lint. Screenshot harness (uncommitted) at 1440 light and dark in `/workspace/qa-news/`.
