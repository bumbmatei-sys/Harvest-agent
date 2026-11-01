'use client';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { handleProblem, normalizeHandle, storefrontAddress } from '@/lib/storefront/handle';
import { authFetch } from '@/utils/auth-fetch';

export interface StorefrontAddressApi {
  current(): Promise<string>;
  check(handle: string): Promise<{ available: boolean; reason: string | null }>;
  change(handle: string): Promise<string>;
}

export function liveStorefrontAddressApi(tenantId: string): StorefrontAddressApi {
  const json = async <T,>(response: Response): Promise<T> => {
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(typeof body.error === 'string' ? body.error : 'Something went wrong. Please try again.');
    return body as T;
  };
  const q = encodeURIComponent(tenantId);
  return {
    current: async () => (await json<{ handle: string }>(await authFetch(`/api/storefront?tenantId=${q}`))).handle,
    check: async (handle) => json(await authFetch(`/api/storefront/handle?tenantId=${q}&handle=${encodeURIComponent(handle)}`)),
    change: async (handle) => (await json<{ handle: string }>(await authFetch('/api/storefront/handle', {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tenantId, handle }),
    }))).handle,
  };
}

type Check = { state: 'idle' } | { state: 'checking' } | { state: 'ok' } | { state: 'bad'; reason: string };

/**
 * "Your address" (Eden's Storefront > Handle): where the Storefront lives,
 * {handle}.theharvest.app. Changing it moves only the address; the page, its
 * blocks and every record stay where they are.
 */
export function StorefrontAddress({ api, initialHandle, onChanged }: {
  api: StorefrontAddressApi;
  initialHandle?: string;
  onChanged?: (handle: string) => void;
}) {
  const [saved, setSaved] = useState<string | null>(initialHandle ?? null);
  const [draft, setDraft] = useState(initialHandle ?? '');
  const [check, setCheck] = useState<Check>({ state: 'idle' });
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (initialHandle !== undefined) return;
    api.current().then((handle) => { setSaved(handle); setDraft(handle); }, (e: Error) => setError(e.message));
  }, [api, initialHandle]);

  const handle = normalizeHandle(draft);
  useEffect(() => {
    if (saved === null || handle === saved) { setCheck({ state: 'idle' }); return; }
    const problem = handleProblem(handle);
    if (problem) { setCheck({ state: 'bad', reason: problem }); return; }
    setCheck({ state: 'checking' });
    let cancelled = false;
    const timer = setTimeout(() => {
      api.check(handle).then(
        (result) => { if (!cancelled) setCheck(result.available ? { state: 'ok' } : { state: 'bad', reason: result.reason ?? 'That address is taken.' }); },
        () => { if (!cancelled) setCheck({ state: 'bad', reason: 'Could not check the address.' }); },
      );
    }, 300);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [api, handle, saved]);

  if (saved === null) return error ? <p role="alert" className="text-sm text-muted">{error}</p> : <Skeleton className="h-16 w-full rounded-xl" />;

  const save = async () => {
    setSaving(true); setError('');
    try {
      const next = await api.change(handle);
      setSaved(next); setDraft(next); setCheck({ state: 'idle' });
      onChanged?.(next);
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not change the address.'); }
    finally { setSaving(false); }
  };

  return (
    <section data-storefront-address className="flex flex-col gap-2 rounded-xl border border-line bg-surface-raised p-4" aria-label="Your address">
      <div>
        <h2 className="font-semibold text-strong">Your address</h2>
        <p className="text-xs text-muted">Where your Storefront lives. Changing it moves only the address; your old one stops working.</p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex min-w-0 flex-1 items-center rounded-lg border border-line bg-card pr-3">
          <Input aria-label="Address" value={draft} maxLength={40} onChange={(e) => { setDraft(e.target.value); setError(''); }}
            className="min-h-11 border-0 bg-transparent shadow-none focus-visible:ring-0 sm:min-h-0" />
          <span className="shrink-0 text-sm text-muted">.theharvest.app</span>
        </div>
        <Button type="button" className="min-h-11 sm:min-h-0" disabled={saving || handle === saved || check.state !== 'ok'} onClick={() => void save()}>
          {saving ? 'Saving…' : 'Change'}
        </Button>
      </div>
      {check.state === 'checking' && <p className="text-xs text-faint">Checking…</p>}
      {check.state === 'ok' && <p role="status" className="text-xs text-muted">{handle}.theharvest.app is free.</p>}
      {check.state === 'bad' && <p role="alert" className="text-xs text-danger">{check.reason}</p>}
      {error && <p role="alert" className="text-xs text-danger">{error}</p>}
      <a href={storefrontAddress(saved)} target="_blank" rel="noopener noreferrer" className="break-all text-xs text-muted underline">{storefrontAddress(saved)}</a>
    </section>
  );
}
