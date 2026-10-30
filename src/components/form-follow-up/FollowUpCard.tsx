'use client';
import { useEffect, useState } from 'react';
import { DiscoverCard, type LoadState } from '@/components/community/DiscoveryViews';
import { Button } from '@/components/ui/button';
import type { FollowUpItem } from '@/lib/form-follow-up/server';
/** Mounted only after the submission succeeds. Re-read visibility so a withdrawn item is never promoted. */
export function FollowUpCard({ handle, tenantId, formId }: { handle?: string; tenantId?: string; formId?: string }) {
  const [state, setState] = useState<LoadState<FollowUpItem | null>>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let current = true;
    setState({ status: 'loading' });
    const params = handle ? new URLSearchParams({ handle }) : new URLSearchParams({ tenantId: tenantId!, formId: formId! });
    async function load() {
      try {
        const response = await fetch(`/api/form-follow-up?${params}`);
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || 'Could not load the suggested item.');
        if (!('item' in data)) throw new Error('Could not load the suggested item.');
        if (current) setState({ status: 'ready', data: data.item });
      } catch (error) { if (current) setState({ status: 'error', message: error instanceof Error ? error.message : 'Could not load the suggested item.' }); }
    }
    void load();
    return () => { current = false; };
  }, [handle, tenantId, formId, attempt]);
  if (state.status === 'loading') return <p role="status" className="text-sm text-muted">Loading next steps…</p>;
  if (state.status === 'error') return <div role="alert" className="space-y-3"><p className="text-sm text-destructive">Your response was saved. {state.message}</p><Button className="min-h-11" variant="outline" onClick={() => setAttempt(value => value + 1)}>Retry next steps</Button></div>;
  if (!state.data) return null;
  const item = state.data;
  return <DiscoverCard listing={item.listing} kind={item.type} action={{ href: item.href, label: item.type === 'community' ? 'Join' : 'View' }} />;
}
