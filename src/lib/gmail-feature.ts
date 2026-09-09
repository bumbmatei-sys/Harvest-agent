/**
 * THE-339 — the master switch for the GMAIL connection, across the whole app.
 *
 * ─── The switch ──────────────────────────────────────────────────────────────
 *
 * ONE VALUE, in the shape `sms-feature.ts` established and `newsletter-feature.ts`
 * followed, for the same reason. Setting `GMAIL_FEATURE_ENABLED` to `true` brings
 * every surface below back exactly as it was, because nothing is deleted to hide
 * it: no route file, no component, no collection, no plan-matrix cell. The
 * `gmail` entry in `INTEGRATION_PROVIDERS` stays exactly as it is — `concern:
 * 'crm'`, `feature: 'crm'`, `outboundSend: true` — so the flip back restores the
 * identical entitlement rather than a re-derived one, and `crm: true` on the free
 * tier keeps meaning what it means today.
 *
 * ⚠️ THIS FILE IMPORTS NOTHING, deliberately, exactly as `sms-feature.ts` and
 * `newsletter-feature.ts` do. The flag is read from the client bundle (the
 * Integrations section, the CRM contact panel) and from four route handlers, and
 * pulling the pricing matrix into any of them would be the cost `sms-feature.ts`
 * refuses to pay. Do not give it an import.
 *
 * ─── 🔴 Why it is OFF ────────────────────────────────────────────────────────
 *
 * The founder: "hide gmail connection feature to email users until harvest
 * scheduler that will have an inbox."
 *
 * The reasoning is the one #481 applied to SMS, the newsletter and QuickBooks: a
 * half-feature is worse than an absent one. Gmail's half is unusually visible.
 * An admin can send a CRM contact an email today and there is nowhere for the
 * reply to land — no inbox, no thread, no read state — so the contact answers
 * into a mailbox Harvest cannot show them, and the conversation ends outside the
 * product that started it.
 *
 * 🔴 AND IT HAS A COST TODAY THAT THE OTHER THREE DID NOT. `86bbnjmua` (THE-194):
 * Google has not verified the Harvest OAuth app, so a church connecting Gmail is
 * shown an "unsafe app" warning and has to click past it. Asking a pastor to
 * dismiss a Google security warning to reach a feature with no inbox behind it is
 * the worst version of this, and it is what the switch stops.
 *
 * ─── What it turns off ───────────────────────────────────────────────────────
 *
 * Server (each refuses with 503; none of them deletes anything):
 *   · `/api/composio/gmail/connect`  — no NEW OAuth grant is started, which is
 *     the line that actually stops the unverified-app warning being shown.
 *   · `/api/composio/gmail/callback` — no grant is completed, so a stale tab
 *     carrying a signed state cannot finish one after the switch went off.
 *   · `/api/composio/gmail/address`  — the sending address is a send-time value
 *     and nothing sends.
 *   · `/api/crm/send-email`          — 🔴 THE SEND ITSELF. A hidden button over a
 *     live route is not a hidden feature.
 *
 * Client:
 *   · The Gmail card in Settings → Integrations (connect, sending address).
 *   · The "Email" and "Connect your email" controls on a CRM contact, and the
 *     `/api/composio/gmail/status` request that chooses between them.
 *
 * ─── 🔴 TWO ROUTES STAY REACHABLE, AND THAT IS THE POINT ─────────────────────
 *
 * `/api/composio/gmail/status` and `/api/composio/gmail/disconnect` are NOT
 * gated. A tenant that connected Gmail before the switch went off still holds a
 * live OAuth grant on its own Google account, and 503-ing the revoke path would
 * leave that grant in place with no way to see or withdraw it from inside
 * Harvest. A connection nobody can see or revoke is worse than a visible one —
 * more so for a grant made through an app Google has not verified.
 *
 * So the Integrations section still ASKS whether this admin's connection is live,
 * and still offers Disconnect when it is. What it does not offer is Connect, a
 * sending address, or any way to send. Neither route can create a grant or send
 * a message: `status` reads one document keyed on the caller's own uid, and
 * `disconnect` only ever removes.
 *
 * ─── 🔴 No data is touched ───────────────────────────────────────────────────
 *
 * `tenants/{t}/integrations/{uid}_gmail` is neither deleted nor rewritten by this
 * switch. An admin who leaves the connection alone finds it exactly where it was
 * when Gmail comes back.
 *
 * ⚠️ THE GDPR PATHS DO NOT READ THIS FLAG, and must not start to.
 * `member-erasure.ts` and `member-export.ts` sweep the `gmail` integration
 * document by name, in the same hardcoded provider list that already carries
 * `quickbooks` while the QuickBooks switch is off. A member's erasure and export
 * rights do not depend on whether a feature is advertised.
 *
 * ⚠️ `assertSendOnlyGmailScopes` IS NOT WEAKENED, MOVED OR CALLED FROM HERE. It
 * guards the connect route over `lib/gmail-scopes.ts` and still fails closed on
 * every path that reaches it; the switch returns BEFORE it, so the guard is
 * unreached rather than relaxed. When Gmail comes back WITH an inbox, widening
 * that scope is a deliberate, separate decision the founder makes — never a side
 * effect of flipping this line.
 */
export const GMAIL_FEATURE_ENABLED = false;

/**
 * What every gated route answers with while the switch is off.
 *
 * 503 rather than 404, for the reason `SMS_HIDDEN_MESSAGE` and
 * `NEWSLETTER_HIDDEN_MESSAGE` are 503s: the route EXISTS and is coming back,
 * which is what an admin's stale browser tab should be told.
 */
export const GMAIL_HIDDEN_MESSAGE = 'Gmail sending is temporarily unavailable.';

/**
 * What the Integrations section says in place of the Gmail card.
 *
 * Exported so the guard can assert the surface says something rather than
 * rendering an empty region, and so the copy is not duplicated at the call site.
 */
export const GMAIL_PAUSED_NOTICE =
  'Email sending from your own Gmail account is paused until the Harvest scheduler ships with an inbox.';
