import { adminDb } from './firebase-admin';

/**
 * Twilio helpers. Credentials are stored per-tenant (admin-only) at
 * tenants/{tenantId}/integrations/twilio and are only ever read server-side —
 * the auth token is never returned to the client.
 */

export interface TwilioConfig {
  accountSid: string;
  authToken: string;
  fromNumber: string;
  templates?: Record<string, { enabled: boolean; text: string }>;
}

const TWILIO_API = 'https://api.twilio.com/2010-04-01';

export async function getTwilioConfig(tenantId: string): Promise<TwilioConfig | null> {
  const snap = await adminDb.collection('tenants').doc(tenantId).collection('integrations').doc('twilio').get();
  if (!snap.exists) return null;
  const d = snap.data() as Partial<TwilioConfig> | undefined;
  if (!d?.accountSid || !d?.authToken || !d?.fromNumber) return null;
  return { accountSid: d.accountSid, authToken: d.authToken, fromNumber: d.fromNumber, templates: d.templates };
}

function authHeader(sid: string, token: string): string {
  return 'Basic ' + Buffer.from(`${sid}:${token}`).toString('base64');
}

/** Verify credentials by fetching the account resource. */
export async function validateTwilio(sid: string, token: string): Promise<boolean> {
  try {
    const resp = await fetch(`${TWILIO_API}/Accounts/${sid}.json`, {
      headers: { Authorization: authHeader(sid, token) },
    });
    return resp.ok;
  } catch {
    return false;
  }
}

/** Send a single SMS. Returns { ok, sid?, error? }. */
export async function sendSms(
  cfg: { accountSid: string; authToken: string; fromNumber: string },
  to: string,
  body: string,
): Promise<{ ok: boolean; sid?: string; error?: string }> {
  try {
    const params = new URLSearchParams({ To: to, From: cfg.fromNumber, Body: body });
    const resp = await fetch(`${TWILIO_API}/Accounts/${cfg.accountSid}/Messages.json`, {
      method: 'POST',
      headers: {
        Authorization: authHeader(cfg.accountSid, cfg.authToken),
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: params.toString(),
    });
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok) return { ok: false, error: data?.message || `Twilio error ${resp.status}` };
    return { ok: true, sid: data?.sid };
  } catch (e: any) {
    return { ok: false, error: e?.message || 'Send failed' };
  }
}

/** Replace {placeholders} in a template with provided values. */
export function renderTemplate(text: string, vars: Record<string, string>): string {
  return text.replace(/\{(\w+)\}/g, (_, k) => (vars[k] !== undefined ? vars[k] : `{${k}}`));
}

/**
 * Fire an automated SMS for a trigger if the tenant has it enabled and a phone
 * number is available. Best-effort — never throws; logs to smsLogs.
 */
export async function sendAutomatedSms(
  tenantId: string,
  triggerKey: string,
  to: string | null | undefined,
  vars: Record<string, string>,
): Promise<void> {
  try {
    if (!to) return;
    const cfg = await getTwilioConfig(tenantId);
    if (!cfg) return;
    const tpl = cfg.templates?.[triggerKey];
    if (!tpl?.enabled || !tpl.text) return;

    const body = renderTemplate(tpl.text, vars);
    const result = await sendSms(cfg, to, body);
    await adminDb.collection('tenants').doc(tenantId).collection('smsLogs').add({
      trigger: triggerKey,
      phone: to,
      status: result.ok ? 'delivered' : 'failed',
      errorCode: result.error || null,
      sentAt: new Date().toISOString(),
    });
  } catch (e) {
    console.warn(`Automated SMS (${triggerKey}) failed:`, e);
  }
}
