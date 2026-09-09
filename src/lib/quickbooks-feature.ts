/**
 * THE-335 — the master switch for the QUICKBOOKS integration, across the whole
 * app.
 *
 * ─── The switch ──────────────────────────────────────────────────────────────
 *
 * ONE VALUE, in the shape `sms-feature.ts` established and for the same reason.
 * Setting `QUICKBOOKS_FEATURE_ENABLED` to `true` brings every surface below back
 * exactly as it was, because nothing is deleted to hide it: no route file, no
 * component, no field, no stored connection.
 *
 * ⚠️ THIS FILE IMPORTS NOTHING, deliberately, exactly as `sms-feature.ts` does.
 * The flag is read from the client bundle (AdminAccounting) and from five route
 * handlers, and it must stay readable from both without dragging anything
 * behind it.
 *
 * ─── 🔴 Why it is OFF ────────────────────────────────────────────────────────
 *
 * The founder: "hide quickbooks connection entirely because I did not check it.
 * Hide it from marketing site as well."
 *
 * ⚠️ NEVER TESTED, so it must not be sold or offered — the same reasoning that
 * hides SMS and that hides custom domains (the custom-domain switch). An
 * integration that APPEARS to work and does not is worse than one that is
 * absent: a church that connects it believes its books are being kept, stops
 * reconciling by hand, and finds out at the year end.
 *
 * ─── What it turns off ───────────────────────────────────────────────────────
 *
 * Server (each refuses with 503; none of them deletes anything):
 *   · `/api/composio/quickbooks/connect` — starts the OAuth handshake.
 *   · `/api/composio/quickbooks/callback` — completes it and writes the
 *     connection.
 *   · `/api/composio/quickbooks/status` — reports whether one exists.
 *   · `/api/composio/quickbooks/disconnect` — removes it.
 *   · `/api/quickbooks/sync` — pushes a receipt to QuickBooks. 🔴 THE ONLY ONE
 *     THAT SPENDS ANYTHING OR WRITES OUTSIDE HARVEST, and the reason this is a
 *     server-side switch rather than a UI one.
 *
 * Client:
 *   · The whole QuickBooks card in `AdminAccounting` — connect, disconnect and
 *     the connection state.
 *   · The per-invoice sync badges, the retry control and the QuickBooks column
 *     in the invoice table.
 *
 * 🔴 ACCOUNTING ITSELF IS NOT HIDDEN, and that distinction is the whole point.
 * `accountingTools` is a real, working capability — invoices, receipts and the
 * statements sub-tab all ship. Hiding the accounting screen to hide one
 * unverified integration on it would withdraw a live capability to hide a dead
 * one, which is the error the custom-domain switch names on the branding
 * entry. `AdminAccounting` already routes every QuickBooks surface through one
 * `isQbEnabled` boolean, so this flag joins that boolean and the screen renders
 * with the QuickBooks card, column and badges simply absent.
 *
 * ─── 🔴 No data is touched, and GDPR is not gated ────────────────────────────
 *
 * A connection a tenant made before this switch closed is left exactly where it
 * is: `tenants/{t}/integrations/{uid}_quickbooks` is neither read nor written by
 * this flag, and `quickbooksSyncStatus` / `quickbooksReceiptId` stay on the
 * invoices that carry them. A tenant that gets QuickBooks back finds its
 * connection and its sync history where it left them.
 *
 * ⚠️ THE GDPR PATHS DO NOT READ THIS FLAG, AND MUST NOT START TO.
 * `member-erasure.ts` deletes and `member-export.ts` reports the
 * `{uid}_quickbooks` integration document by name, unconditionally, because a
 * tenant MAY have connected QuickBooks before it was hidden — and a member's
 * erasure and access rights do not depend on whether the product currently
 * advertises the integration that holds their data. Gating either sweep on this
 * flag would leave a live OAuth grant undeleted after an erasure reported clean.
 */
export const QUICKBOOKS_FEATURE_ENABLED = false;

/**
 * What every gated route answers with while the switch is off.
 *
 * 503 rather than 404, for the reason `SMS_HIDDEN_MESSAGE` is a 503: the route
 * EXISTS and is coming back, which is what a provider callback retry and an
 * admin's stale browser tab should both be told.
 */
export const QUICKBOOKS_HIDDEN_MESSAGE = 'QuickBooks is temporarily unavailable.';
