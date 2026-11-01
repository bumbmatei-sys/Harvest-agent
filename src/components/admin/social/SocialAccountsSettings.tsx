'use client';
import { useEffect, useState } from 'react';
import { Skeleton } from '@/components/ui/skeleton';
import type { SocialPlatform } from '@/lib/social/platforms';
import type { SocialAccount } from '@/lib/social/types';
import { authFetch } from '@/utils/auth-fetch';
import { AccountsPanel } from './SocialScheduler';

type Load = { status: 'loading' } | { status: 'blocked' } | { status: 'error' } | { status: 'ready'; accounts: SocialAccount[]; sample: boolean };

/**
 * Settings > Social accounts. The founder moved the scheduler's Accounts tab
 * here; the composer's plus opens it. Connecting goes through the same server
 * route the tab used, so a preview still refuses to open a consent screen.
 */
export function SocialAccountsSettings() {
  const [load, setLoad] = useState<Load>({ status: 'loading' });
  const [notice, setNotice] = useState('');

  useEffect(() => {
    let cancelled = false;
    authFetch('/api/social/bootstrap').then(async (response) => {
      if (cancelled) return;
      if (response.status === 403) { setLoad({ status: 'blocked' }); return; }
      if (!response.ok) { setLoad({ status: 'error' }); return; }
      const body = await response.json() as { accounts?: SocialAccount[]; sample?: boolean };
      if (!cancelled) setLoad({ status: 'ready', accounts: Array.isArray(body.accounts) ? body.accounts : [], sample: body.sample === true });
    }, () => { if (!cancelled) setLoad({ status: 'error' }); });
    return () => { cancelled = true; };
  }, []);

  async function connect(platform: SocialPlatform) {
    setNotice('');
    const response = await authFetch('/api/social/connect', { method: 'POST', body: JSON.stringify({ platform }) });
    const body = await response.json().catch(() => ({})) as { error?: string; authUrl?: string };
    if (!response.ok) {
      setNotice(body.error === 'platform_not_offered' ? 'That platform is not offered.' : 'The account could not be connected.');
      return;
    }
    if (typeof body.authUrl === 'string' && body.authUrl) {
      setNotice('Continue in the window that opened.');
      window.location.assign(body.authUrl);
      return;
    }
    setNotice('This preview does not connect a real account.');
  }

  return (
    <section data-testid="settings-social-accounts" className="flex flex-col gap-3">
      {load.status === 'loading' && <Skeleton className="h-40 w-full rounded-xl" />}
      {load.status === 'blocked' && <p className="text-sm text-muted">Social scheduling is not on this plan. Add it from Plan &amp; billing to connect accounts.</p>}
      {load.status === 'error' && <p role="alert" className="text-sm text-muted">Could not load the connected accounts. Please try again.</p>}
      {load.status === 'ready' && <>
        {load.sample && <p className="text-sm text-faint">Sample accounts. Nothing here is a real ministry.</p>}
        <AccountsPanel accounts={load.accounts} onConnect={(platform) => void connect(platform)} />
      </>}
      {notice && <p role="status" className="text-sm text-faint">{notice}</p>}
    </section>
  );
}
