import 'server-only';

import type { EmailActor, EmailService, EmailFailure, DraftInput, ImportRow, WhenInput, EmailSettings } from '@/lib/email/service';

export type EmailActionBody =
  | { action: 'overview'; tenantId?: string | null }
  | { action: 'saveDraft'; tenantId?: string | null; draft: DraftInput }
  | { action: 'delete'; tenantId?: string | null; id: string }
  | { action: 'send'; tenantId?: string | null; id: string; when: WhenInput; mode: 'preview' | 'confirm'; confirmToken?: string | null }
  | { action: 'sendTest'; tenantId?: string | null; id: string }
  | { action: 'import'; tenantId?: string | null; rows: ImportRow[]; consentConfirmed: boolean }
  | { action: 'saveSettings'; tenantId?: string | null; settings: Partial<EmailSettings> }
  | { action: 'domain'; tenantId?: string | null; op: 'register' | 'check'; domain?: string };

/** Actions that reach the vendor. These need credentials; the rest do not. */
export function needsProvider(body: EmailActionBody): boolean {
  return body.action === 'send' || body.action === 'sendTest' || body.action === 'domain';
}

const STATUS: Record<string, number> = {
  not_authorized: 403,
  cross_tenant: 403,
  plan_required: 403,
  not_found: 404,
  invalid: 400,
  sender_not_ready: 409,
  no_recipients: 409,
  already_sent: 409,
  time_not_future: 400,
  volume_cap: 429,
  publishing_closed: 403,
  confirm_required: 409,
  confirm_expired: 409,
  confirm_reused: 409,
  confirm_mismatch: 409,
  provider_unavailable: 502,
};

export async function dispatchEmailAction(
  service: EmailService,
  actor: EmailActor,
  body: EmailActionBody,
): Promise<{ status: number; body: unknown }> {
  const t = body.tenantId ?? null;
  let result: { ok: boolean };
  switch (body.action) {
    case 'overview': result = await service.list(actor, t); break;
    case 'saveDraft': result = await service.saveDraft(actor, t, body.draft ?? {}); break;
    case 'delete': result = await service.remove(actor, t, String(body.id ?? '')); break;
    case 'send':
      result = await service.send(actor, t, {
        id: String(body.id ?? ''),
        when: body.when ?? { mode: 'now' },
        mode: body.mode === 'confirm' ? 'confirm' : 'preview',
        confirmToken: body.confirmToken,
      });
      break;
    case 'sendTest': result = await service.sendTest(actor, t, String(body.id ?? '')); break;
    case 'import':
      result = await service.importContacts(actor, t, { rows: Array.isArray(body.rows) ? body.rows : [], consentConfirmed: body.consentConfirmed === true });
      break;
    case 'saveSettings': result = await service.saveSettings(actor, t, body.settings ?? {}); break;
    case 'domain': result = await service.domain(actor, t, { op: body.op === 'register' ? 'register' : 'check', domain: body.domain }); break;
    default:
      return { status: 400, body: { ok: false, error: 'invalid', message: 'Unknown action.' } };
  }
  if (result.ok) return { status: 200, body: result };
  const failure = result as unknown as EmailFailure;
  return { status: STATUS[failure.error] ?? 400, body: failure };
}
