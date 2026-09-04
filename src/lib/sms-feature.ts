/**
 * THE-245 / THE-314 — the master switch for the SMS feature, across the whole
 * app.
 *
 * ─── The switch ──────────────────────────────────────────────────────────────
 *
 * ONE VALUE. THE-245 promised that setting `SMS_FEATURE_ENABLED` to `true`
 * would bring every surface below back exactly as it was, because nothing was
 * deleted to hide it: no route file, no component, no collection, no plan-matrix
 * cell. 🔴 THE-314 KEPT THAT PROMISE AND IS THE FLIP. Every surface listed
 * further down is live again from this one line.
 *
 * ⚠️ TWO THINGS ARE DELIBERATELY *NOT* AS THEY WERE, and both are the point of
 * THE-314 rather than drift:
 *   · THE PROVIDER IS NOT TWILIO. Sending, receiving and number provisioning
 *     now run on the scheduler vendor's telephony API (`lib/zernio.ts`), and
 *     `lib/twilio.ts` is retired in place — see the note at its head.
 *   · SMS IS MINISTRY-ONLY. `smsAutomation` and `textToGive` are `true` on
 *     `max` alone. Under THE-245 they were true on every paid tier because a
 *     church brought its own credentials and the cell gated nothing; Harvest now
 *     RESELLS, so the cell decides who may spend Harvest's money.
 *
 * ⚠️ WHY IT IS NOT IN `utils/plan-features.ts` with the other master switches
 * (AI_TELEGRAM_ASSISTANT_ENABLED, AFFILIATE_PROGRAM_ENABLED,
 * DODO_BILLING_ENABLED). That file pulls the whole pricing matrix into any
 * module that imports it, and this flag is read by the send funnel and by the
 * public `/api/sms/incoming` webhook. THIS FILE IMPORTS NOTHING and must not
 * start to, so the webhook stays cheap and the flag stays readable from both the
 * client bundle and a route handler.
 *
 * ─── 🔴 Why it is ON, and what had to be true first ──────────────────────────
 *
 * THE-245 turned it off because the feature was untested, every send spent real
 * money, and `/api/sms/incoming` was public and unauthenticated — so hiding the
 * nav entry alone would have left the feature fully live to anyone holding the
 * number. Turning it back on required each of those to be answered:
 *
 *   · THE PUBLIC WEBHOOK IS NOW SIGNED. It verifies an HMAC-SHA256 signature
 *     over the raw body and fails closed. ⚠️ THE TWILIO PATH VERIFIED NOTHING —
 *     no signature check existed anywhere in this repository — so this is new
 *     work, and it is what makes the route safe to open.
 *   · STOP IS HONOURED. The vendor opts a recipient out at the carrier and
 *     refuses later sends with a 409; Harvest mirrors it and refuses before the
 *     round trip (`lib/sms-optout.ts`). Carrier-mandated, and under the reseller
 *     model it protects HARVEST'S number and brand registration.
 *   · EVERY SEND IS METERED AND CAPPED. The cap used to bind on platform sends
 *     only, of which there were none. Now every send is a platform send, and
 *     Ministry carries a real 2,000-segment monthly allotment.
 *   · THE MONEY IS BOUNDED BY PLAN. Only Ministry can reach the send funnel.
 *
 * ─── What it turns off, if it is ever set back to false ──────────────────────
 *
 * Server (each refuses with 503; none of them deletes anything):
 *   · `sendSms` / `sendTenantSms` — the single send funnel. Nothing reaches the
 *     provider.
 *   · `sendAutomatedSms` — returns before it sends OR logs, so the three
 *     non-SMS callers (check-in, event registration, pledge) simply do not text.
 *     🔴 THEY ARE OTHERWISE UNAFFECTED: all three are best-effort and already
 *     no-op for any tenant without a number, so a check-in still records, a
 *     registration still confirms, a pledge is still written, and every email
 *     confirmation still sends.
 *   · `/api/sms/broadcast`, `/api/sms/config`, `/api/sms/test`,
 *     `/api/sms/numbers`, `/api/sms-usage`
 *   · `/api/sms/incoming` — the public webhook, and the reason this is a
 *     server-side switch rather than a UI one.
 *   · `/api/plans` — omits `smsAutomation` from the published catalogue, so the
 *     marketing site cannot render a plan row for it.
 *
 * Client:
 *   · The `/admin/sms` nav entry and section (AdminSms, which hosts
 *     Text-to-Give).
 *   · The number panel (settings/SmsSection).
 *   · The "Send Reminder" SMS blast on a pledge campaign (AdminFundraising).
 *   · The "SMS Broadcasts" permission row (AdminRoles) — display only;
 *     stored `manageSms` grants are untouched.
 *   · The "SMS Automation" line on the in-app plan cards (PlanUpgradeSection).
 *   · The "SMS" area in the support contact form (ContactModal).
 *   · The two SMS usage tiles on the super-admin tenant panel.
 *
 * ─── 🔴 Text-to-Give goes with it, deliberately ──────────────────────────────
 *
 * Text-to-Give is a GIVING capability, but it is inbound SMS end to end: the
 * keyword arrives on `/api/sms/incoming` and the reply goes back out through the
 * send funnel. "Hide SMS" and "hide Text-to-Give" are the same act — there is no
 * configuration in which one works and the other does not.
 *
 * ─── 🔴 No data is touched ───────────────────────────────────────────────────
 *
 * `tenants/{t}/smsLogs` and `tenants/{t}/smsBroadcasts` are neither read nor
 * written by this switch. A church that gets SMS back finds its history where it
 * left it, and its automation templates and Text-to-Give keyword come back with
 * it — `getTenantSmsNumber` reads them from the old `integrations/twilio`
 * document when the new one has not got them yet, so the provider swap does not
 * silently discard configuration a church already entered.
 */
export const SMS_FEATURE_ENABLED = true;

/**
 * What every gated route answers with while the switch is off.
 *
 * 503 rather than 404: the route EXISTS and is coming back, which is what a
 * provider webhook retry and an admin's stale browser tab should both be told.
 */
export const SMS_HIDDEN_MESSAGE = 'SMS is temporarily unavailable.';
