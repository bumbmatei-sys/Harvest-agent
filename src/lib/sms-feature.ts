/**
 * THE-245 — the master switch for the SMS feature, across the whole app.
 *
 * ─── The switch ──────────────────────────────────────────────────────────────
 *
 * ONE VALUE. Set `SMS_FEATURE_ENABLED` to `true` and every surface below comes
 * back exactly as it was. Nothing is deleted to hide it: no route file, no
 * component, no collection, no plan-matrix cell. `smsAutomation` and
 * `textToGive` keep their values in `PLAN_FEATURES` — the gate sits IN FRONT of
 * them, so the tiers that own the capability still own it and get it back
 * whole.
 *
 * ⚠️ WHY IT IS NOT IN `utils/plan-features.ts` with the other three master
 * switches (AI_TELEGRAM_ASSISTANT_ENABLED, AFFILIATE_PROGRAM_ENABLED,
 * DODO_BILLING_ENABLED). That file is being edited concurrently for the
 * repricing work, so THE-245 was asked to keep out of it. This module is the
 * same idiom in its own file, and it is a better fit for the one thing those
 * three never had to do: `sendSms` and the public `/api/sms/incoming` webhook
 * read this switch, and `plan-features.ts` pulls the whole pricing matrix into
 * any module that imports it. THIS FILE IMPORTS NOTHING and must not start to,
 * so the webhook stays cheap and the flag stays readable from both the client
 * bundle and a route handler.
 *
 * ─── Why it is off ───────────────────────────────────────────────────────────
 *
 * The feature is UNTESTED and it is about to be marketed. SMS is not a cosmetic
 * surface: every send spends real money on a Twilio account and arrives on a
 * real phone. `/api/sms/incoming` is public and unauthenticated — a Twilio
 * number pointed at it drives Text-to-Give with no session at all — so hiding
 * the nav entry alone would leave the feature fully live to anyone holding the
 * number. The gate is therefore SERVER-SIDE FIRST and the UI follows it.
 *
 * ─── What it turns off ───────────────────────────────────────────────────────
 *
 * Server (each refuses with 503 while off; none of them deletes anything):
 *   · `sendSms` — the single send funnel. Nothing reaches Twilio.
 *   · `sendAutomatedSms` — returns before it sends OR logs, so the three
 *     non-SMS callers (check-in, event registration, pledge) simply do not text.
 *     🔴 THEY ARE OTHERWISE UNAFFECTED: all three are best-effort and already
 *     no-op for any tenant without Twilio credentials, so a check-in still
 *     records, a registration still confirms, a pledge is still written, and
 *     every email confirmation still sends.
 *   · `/api/sms/broadcast`, `/api/sms/config`, `/api/sms/test`, `/api/sms-usage`
 *   · `/api/sms/incoming` — the public webhook, and the reason this is a
 *     server-side switch rather than a UI one.
 *   · `/api/plans` — omits `smsAutomation` from the published catalogue, so the
 *     marketing site cannot render a plan row for it.
 *
 * Client:
 *   · The `/admin/sms` nav entry and section (AdminSms, which hosts
 *     Text-to-Give).
 *   · The Twilio credential form (settings/SmsSection).
 *   · The "Send Reminder" SMS blast on a pledge campaign (AdminFundraising).
 *   · The "SMS Broadcasts" permission row (AdminRoles) — display only;
 *     stored `manageSms` grants are untouched and come back with the flag.
 *   · The "SMS Automation" line on the in-app plan cards (PlanUpgradeSection).
 *   · The "SMS" area in the support contact form (ContactModal).
 *   · The two SMS usage tiles on the super-admin tenant panel.
 *
 * ─── 🔴 Text-to-Give goes with it, deliberately ──────────────────────────────
 *
 * Text-to-Give is a GIVING capability, but it is inbound SMS end to end: the
 * keyword arrives on `/api/sms/incoming` and the reply goes back out through
 * `sendSms`. It is gated per tenant by BYO Twilio credentials, not by plan, so
 * "hide SMS" and "hide Text-to-Give" are the same act — there is no
 * configuration in which one works and the other does not. Stated here because
 * it is the consequence a reader is most likely to miss.
 *
 * ─── 🔴 No data is touched ───────────────────────────────────────────────────
 *
 * `tenants/{t}/smsLogs` and `tenants/{t}/smsBroadcasts` are neither read nor
 * written by this switch, and nothing migrates or deletes them. A church that
 * gets SMS back finds its history where it left it. The saved Twilio
 * credentials at `tenants/{t}/integrations/twilio` — including the `text2give`
 * keyword — are left in place for the same reason.
 */
export const SMS_FEATURE_ENABLED = false;

/**
 * What every gated route answers with while the switch is off.
 *
 * 503 rather than 404: the route EXISTS and is coming back, which is what a
 * Twilio webhook retry and an admin's stale browser tab should both be told.
 */
export const SMS_HIDDEN_MESSAGE = 'SMS is temporarily unavailable.';
