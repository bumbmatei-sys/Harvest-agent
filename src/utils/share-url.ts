import { useEffect, useState } from 'react';
import { getTenantScope } from './tenant-scope';

/**
 * Build the public, shareable URL for a path like `/blog/abc123`.
 *
 * On a tenant subdomain the URL is the tenant's white-label host
 * (`https://<tenantId>.theharvest.app/...`) — this mirrors the URL shape
 * AdminEvents already uses (AdminEvents.tsx:125) so a shared link points at the
 * tenant's own domain and never leaks the Harvest domain on a white-label host.
 *
 * When there is no tenant scope (platform / super-admin context, or SSR) it
 * falls back to the current origin so the button still produces a working link.
 */
export function buildShareUrl(tenantId: string | null, path: string): string {
  const p = path.startsWith('/') ? path : `/${path}`;
  if (tenantId) return `https://${tenantId}.theharvest.app${p}`;
  if (typeof window !== 'undefined') return `${window.location.origin}${p}`;
  return p;
}

/**
 * Resolve the shareable base URL for the current tenant the same way the member
 * views do (getTenantScope). Returns '' until resolved. Use for list views that
 * build several item URLs from one base.
 */
export function useShareBaseUrl(): string {
  const [base, setBase] = useState('');
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const tenantId = await getTenantScope();
      if (cancelled) return;
      setBase(
        tenantId
          ? `https://${tenantId}.theharvest.app`
          : typeof window !== 'undefined'
          ? window.location.origin
          : '',
      );
    })();
    return () => {
      cancelled = true;
    };
  }, []);
  return base;
}

/**
 * Convenience for single-item detail views: resolves the full public URL for
 * `path` (e.g. `/blog/abc123`). Pass null to skip resolution. Returns '' until
 * resolved; ShareButton renders disabled while empty.
 */
export function usePublicShareUrl(path: string | null): string {
  const [url, setUrl] = useState('');
  useEffect(() => {
    let cancelled = false;
    if (!path) {
      setUrl('');
      return;
    }
    (async () => {
      const tenantId = await getTenantScope();
      if (!cancelled) setUrl(buildShareUrl(tenantId, path));
    })();
    return () => {
      cancelled = true;
    };
  }, [path]);
  return url;
}
