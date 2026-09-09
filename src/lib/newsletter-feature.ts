/**
 * THE-335 — the master switch for the NEWSLETTER feature, across the whole app.
 *
 * ─── The switch ──────────────────────────────────────────────────────────────
 *
 * ONE VALUE, in the shape `sms-feature.ts` established and for the same reason.
 * Setting `NEWSLETTER_FEATURE_ENABLED` to `true` brings every surface below back
 * exactly as it was, because nothing is deleted to hide it: no route file, no
 * component, no collection, no plan-matrix cell. `newsletterAutomation` stays
 * exactly as it is in `utils/plan-features.ts` — false on free and Individual,
 * true on Small Team and Ministry — so the flip back restores the identical
 * entitlement rather than a re-derived one.
 *
 * ⚠️ THIS FILE IMPORTS NOTHING, deliberately, exactly as `sms-feature.ts` does.
 * The flag is read from the client bundle (the nav, the section, the plan cards,
 * the integrations list) and from a route handler (`/api/newsletter/send`,
 * `/api/plans`), and pulling the pricing matrix into either would be the cost
 * `sms-feature.ts` refuses to pay. Do not give it an import.
 *
 * ─── 🔴 Why it is OFF ────────────────────────────────────────────────────────
 *
 * The founder: "put SMS and newsletter to coming soon. Hide newsletter from the
 * app. It will come together with harvest scheduler."
 *
 * ⚠️ WHAT IS ACTUALLY BUILT, stated plainly because the card that asked for this
 * (86bbupmhx) records the sender as UNBUILT and that is only half right. There
 * IS a working send path today: `/api/newsletter/send` composes the campaign and
 * hands it to the church's OWN Mailchimp audience through Composio. What is
 * unbuilt is the REPLACEMENT that was decided on — bring-your-own Plunk plus the
 * Maily editor, with a marketing layer whose unsubscribe handling is a LEGAL
 * floor. So this is not "hide a screen with nothing behind it"; it is
 * withdrawing a real capability until it is rebuilt on the intended sender, and
 * the marketing site stops selling it at the same time.
 *
 * ─── What it turns off ───────────────────────────────────────────────────────
 *
 * Server (each refuses with 503; none of them deletes anything):
 *   · `/api/newsletter/send` — the send path, including the schedule action.
 *   · `/api/plans` — omits `newsletterAutomation` from the published catalogue,
 *     so the marketing site cannot render a plan row for it.
 *
 * Client:
 *   · The `/admin/newsletter` nav entry and section (NewsletterCampaigns and
 *     NewsletterEditor).
 *   · The "Newsletter" line on the in-app plan cards (PlanUpgradeSection).
 *   · The two `concern: 'newsletter'` integration rows — Instagram and Mailchimp
 *     — in Settings → Integrations. 🔴 GMAIL IS UNTOUCHED BY *THIS* SWITCH: it
 *     is a CRM capability (`concern: 'crm'`, `feature: 'crm'`), so nothing here
 *     reads it and nothing here hides it.
 *
 *     ⚠️ THE SECOND HALF OF THAT SENTENCE HAS SINCE STOPPED BEING TRUE, and is
 *     corrected rather than left to mislead. It read "and it is what sends a
 *     rota invitation, so hiding it here would break the founder's stated
 *     replacement for SMS". THE-340 moved rota invitations onto Resend, from a
 *     Harvest-controlled sender, so a serving invitation no longer depends on
 *     any church's Gmail. THE-339 then hid Gmail on its OWN switch
 *     (`gmail-feature.ts`) — which was only safe BECAUSE of THE-340, and which
 *     changes nothing about this file: the newsletter switch still hides
 *     exactly the two newsletter rows and reads no Gmail flag.
 *
 * ─── 🔴 No data is touched ───────────────────────────────────────────────────
 *
 * `tenants/{t}/newsletters` is neither read nor written by this switch, and a
 * church's connected Mailchimp integration document is left exactly where it is.
 * A church that gets the newsletter back finds its drafts and its audience
 * selection where it left them.
 *
 * ⚠️ THE GDPR PATHS DO NOT READ THIS FLAG, and must not start to.
 * `member-erasure.ts` and `member-export.ts` sweep the `mailchimp` and
 * `instagram` integration documents by name whether or not the feature is
 * advertised — a member's erasure right does not depend on a marketing switch.
 */
export const NEWSLETTER_FEATURE_ENABLED = false;

/**
 * What every gated route answers with while the switch is off.
 *
 * 503 rather than 404, for the reason `SMS_HIDDEN_MESSAGE` is a 503: the route
 * EXISTS and is coming back, which is what an admin's stale browser tab should
 * be told.
 */
export const NEWSLETTER_HIDDEN_MESSAGE = 'Newsletter is temporarily unavailable.';
