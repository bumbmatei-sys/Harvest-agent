import { afterEach, expect, it, vi } from 'vitest';

const send = vi.hoisted(() => vi.fn());
vi.mock('resend', () => ({ Resend: class { emails = { send }; } }));
const { sendTransactionalEmail } = await import('../transactional-email');
afterEach(() => { vi.unstubAllEnvs(); send.mockReset(); });

it('passes cancellation idempotency to the existing Resend transport', async () => {
  vi.stubEnv('RESEND_API_KEY', 'test-only');
  send.mockResolvedValue({ data: { id: 'email1' }, error: null });
  expect(await sendTransactionalEmail({ to: 'member@example.test', subject: 'Cancelled', text: 'Contact the organizer',
    replyTo: 'organizer@example.test', idempotencyKey: 'event-cancel-stable-key' })).toEqual({ ok: true, id: 'email1' });
  expect(send).toHaveBeenCalledWith(expect.objectContaining({ to: 'member@example.test', replyTo: 'organizer@example.test' }),
    { idempotencyKey: 'event-cancel-stable-key' });
});

it('propagates a rejected provider response as a failure', async () => {
  vi.stubEnv('RESEND_API_KEY', 'test-only');
  send.mockResolvedValue({ data: null, error: { message: 'Rejected' } });
  expect(await sendTransactionalEmail({ to: 'member@example.test', subject: 'Cancelled', text: 'Contact owner' }))
    .toMatchObject({ ok: false, error: 'Rejected', code: 'provider_error' });
});
