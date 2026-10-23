import { afterEach, describe, expect, it, vi } from 'vitest';

import { SubscribeBlock, SubscribeForm, postSubscribe } from '@/components/email/SubscribeBlock';
import PublicSubscribe from '@/components/PublicSubscribe';
import { all, byName, click, flush, mount, need, text, type, unmount } from './dom';

afterEach(async () => {
  await unmount();
  vi.restoreAllMocks();
});

const field = (label: string) => need(all('input').find((i) => i.getAttribute('name') === label), label) as HTMLInputElement;
const submit = () => click(need(byName('button', /Subscribe|Sending/), 'submit'));

describe('SubscribeForm', () => {
  it('sends the name and email, then tells the visitor to check their email (not that they are subscribed)', async () => {
    const onSubmit = vi.fn(async () => ({ ok: true as const }));
    await mount(<SubscribeForm onSubmit={onSubmit} />);
    await type(field('name'), 'Ana Rivera');
    await type(field('email'), 'ana@x.org');
    await submit();
    await flush();
    expect(onSubmit).toHaveBeenCalledWith({ name: 'Ana Rivera', email: 'ana@x.org', website: '' });
    expect(need(document.querySelector('[data-subscribe-done]'), 'done').textContent).toContain('Check your email');
    expect(text()).not.toMatch(/you are subscribed|thanks for subscribing/i);
    expect(document.querySelector('form')).toBeNull();
  });

  it('shows a refusal as an error and keeps what was typed', async () => {
    const onSubmit = vi.fn(async () => ({ ok: false as const, message: 'Please enter a valid email address.' }));
    await mount(<SubscribeForm onSubmit={onSubmit} />);
    await type(field('name'), 'Ana');
    await type(field('email'), 'nope');
    await submit();
    await flush();
    expect(need(document.querySelector('[role=alert]'), 'alert').textContent).toBe('Please enter a valid email address.');
    expect(field('email').value).toBe('nope');
    expect(document.querySelector('[data-subscribe-done]')).toBeNull();
  });

  it('has a honeypot field a person never sees, hidden from assistive tech and the tab order', async () => {
    await mount(<SubscribeForm onSubmit={async () => ({ ok: true })} />);
    const trap = field('website');
    expect(trap.tabIndex).toBe(-1);
    expect(trap.closest('[aria-hidden]')).toBeTruthy();
  });

  it('does not send twice while a send is in flight', async () => {
    let release: (v: { ok: true }) => void = () => {};
    const onSubmit = vi.fn(() => new Promise<{ ok: true }>((r) => { release = r; }));
    await mount(<SubscribeForm onSubmit={onSubmit} />);
    await type(field('name'), 'Ana');
    await type(field('email'), 'ana@x.org');
    await submit();
    expect(need(byName('button', 'Sending…'), 'busy').hasAttribute('disabled')).toBe(true);
    release({ ok: true });
    await flush();
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });
});

describe('postSubscribe', () => {
  it('posts JSON to the public endpoint and reports success', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    expect(await postSubscribe({ name: 'Ana', email: 'ana@x.org', website: '' })).toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledWith('/api/email/subscribe', expect.objectContaining({ method: 'POST' }));
  });
  it("passes the server's refusal through and turns a network failure into plain words", async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response(JSON.stringify({ error: 'Too many requests.' }), { status: 429 }));
    expect(await postSubscribe({ name: 'Ana', email: 'a@x.org', website: '' })).toEqual({ ok: false, message: 'Too many requests.' });
    vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(new Error('offline'));
    expect(await postSubscribe({ name: 'Ana', email: 'a@x.org', website: '' })).toMatchObject({ ok: false, message: expect.stringContaining('could not reach') });
  });
});

describe('SubscribeBlock (the piece a link-in-bio template drops in)', () => {
  it('block variant: heading, help text and the form in place', async () => {
    await mount(<SubscribeBlock onSubmit={async () => ({ ok: true })} />);
    const block = need(document.querySelector('[data-subscribe-block]'), 'block');
    expect(block.textContent).toContain('Subscribe to our newsletter');
    expect(block.querySelector('form')).toBeTruthy();
  });

  it('button variant: one "Subscribe to newsletter" button that opens the form in a dialog', async () => {
    await mount(<SubscribeBlock variant="button" onSubmit={async () => ({ ok: true })} />);
    expect(document.querySelector('form')).toBeNull();
    const button = need(document.querySelector<HTMLElement>('[data-subscribe-button]'), 'button');
    expect(button.textContent).toContain('Subscribe to newsletter');
    await click(button);
    await flush();
    expect(need(document.querySelector('[role=dialog] form'), 'dialog form')).toBeTruthy();
  });

  it('the headings and button text can be set by the template', async () => {
    await mount(<SubscribeBlock heading="Join the list" description="Weekly notes." buttonLabel="Sign me up" onSubmit={async () => ({ ok: true })} />);
    expect(text()).toContain('Join the list');
    expect(text()).toContain('Weekly notes.');
    expect(byName('button', 'Sign me up')).toBeTruthy();
  });
});

describe('PublicSubscribe', () => {
  it('shows the ministry name and the confirm-by-email promise, with no tenant data beyond name and logo', async () => {
    await mount(<PublicSubscribe tenantName="Grace Church" logo={null} />);
    expect(text()).toContain('Grace Church');
    expect(text()).toContain('confirm your address');
    expect(document.querySelector('[data-subscribe-form]')).toBeTruthy();
  });
});
