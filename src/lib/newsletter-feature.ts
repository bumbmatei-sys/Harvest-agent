/**
 * THE-335 — the master switch for the NEWSLETTER feature, across the whole app.
 *
 * ONE VALUE, in the shape `sms-feature.ts` established. Nothing is deleted to hide
 * the newsletter: no route file, no component, no collection, no plan-matrix cell.
 *
 * ⚠️ THIS FILE IMPORTS NOTHING, deliberately, exactly as `sms-feature.ts` does.
 * The flag is read from the client bundle (the nav, the section, the plan cards)
 * and from route handlers (`/api/email/*`, `/api/plans`), and pulling the pricing
 * matrix into either would be the cost `sms-feature.ts` refuses to pay.
 *
 * History: the founder first withdrew the newsletter, saying:
 * "put SMS and newsletter to coming soon. Hide newsletter from the app".
 * The replacement for the Mailchimp sender was unbuilt then. The Plunk-backed
 * workspace is that replacement, and the switch is on.
 *
 * ─── What the newsletter switch governs ──────────────────────────────────────
 *
 * The newsletter is the Plunk-backed email workspace (`components/email/`), reached
 * from the `/admin/newsletter` tab and served by `/api/email/actions` and
 * `/api/email/cron`. While the value is false each of those refuses (the routes
 * with 503), the nav entry and section go away, `/api/plans` omits
 * `newsletterAutomation`, and the in-app plan cards drop their "Newsletter" line.
 * The plan cell itself is never touched: false on free and Individual, true on
 * Small Team and Ministry.
 *
 * ─── 🔴 The legacy Mailchimp path stays OFF, on its own switch ────────────────
 *
 * Before the Plunk workspace there was a Mailchimp sender: `/api/newsletter/send`
 * handed a campaign to the church's own Mailchimp audience through Composio, and
 * an Instagram connection fed `/api/newsletter/generate`. Nothing the new
 * workspace renders reaches either: `NewsletterCampaigns` mounts `EmailWorkspace`
 * and never opens the old `NewsletterEditor`, which is the only caller of the
 * send route. So a Mailchimp or Instagram row in Settings → Integrations would
 * connect an account that nothing sends through, and the send route would accept
 * a request from a client that no longer exists.
 *
 * That is why `LEGACY_MAILCHIMP_NEWSLETTER_ENABLED` is a second value and the
 * newsletter switch does not decide it: turning the newsletter on must not bring
 * those back as a side effect. It hides the two `concern: 'newsletter'`
 * integration rows and makes `/api/newsletter/send` answer 503. Gmail is
 * untouched by both (`concern: 'crm'`, its own switch in `gmail-feature.ts`).
 *
 * ─── 🔴 No data is touched ───────────────────────────────────────────────────
 *
 * `tenants/{t}/newsletters` is neither read nor written by either switch, and a
 * church's connected Mailchimp integration document is left where it is.
 *
 * ⚠️ THE GDPR PATHS DO NOT READ EITHER FLAG, and must not start to.
 * `member-erasure.ts` and `member-export.ts` sweep the `mailchimp` and
 * `instagram` integration documents by name whether or not the feature is
 * advertised — a member's erasure right does not depend on a marketing switch.
 */
export const NEWSLETTER_FEATURE_ENABLED = true;

/**
 * The retired Mailchimp send path and the two integration rows that only fed it.
 * False on purpose; see the header before flipping it.
 */
export const LEGACY_MAILCHIMP_NEWSLETTER_ENABLED = false;

/**
 * What every gated newsletter route answers with while its switch is off.
 *
 * 503 rather than 404, for the reason `SMS_HIDDEN_MESSAGE` is a 503: the route
 * EXISTS, which is what an admin's stale browser tab should be told.
 */
export const NEWSLETTER_HIDDEN_MESSAGE = 'Newsletter is temporarily unavailable.';

/** What the retired `/api/newsletter/send` route answers with. */
export const LEGACY_MAILCHIMP_SEND_RETIRED_MESSAGE =
  'Sending through Mailchimp has been retired. Use the Newsletter tab to send.';
