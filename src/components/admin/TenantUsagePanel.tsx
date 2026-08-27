"use client";
import React, { useEffect, useState } from 'react';
import { auth } from '../../firebase';
import { SMS_FEATURE_ENABLED } from '../../lib/sms-feature';

/**
 * Per-tenant consumption detail for the super-admin Tenants screen — RAG query
 * and ingest tokens against their caps, knowledge-base size, and SMS segments.
 *
 * Read-only. It renders a row expansion inside the tenant card (the same
 * idiom as the delete confirmation directly below it in AdminTenants), and
 * reads /api/admin/tenant-usage, which is super-admin gated. The existing
 * /api/rag-usage and /api/sms-usage routes are deliberately NOT reused: they
 * resolve the tenant from the caller's own token and must stay that way.
 */

export interface TenantUsage {
  tenantId: string;
  name: string;
  plan: string;
  month: string;
  rag: {
    queryTokensUsed: number; queryTokensCap: number;
    ingestTokensUsed: number; ingestTokensCeiling: number;
  };
  knowledgeBase: { sources: number; sourcesTruncated: boolean; chunks: number; chunksTruncated: boolean };
  sms: {
    platformSegments: number;
    platformCap: number | null;
    platformAvailable: boolean;
    byoSegments: number;
    credentialSource: 'platform' | 'byo' | null;
  };
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(n >= 10_000 ? 0 : 1)}k`;
  return `${Math.round(n)}`;
}

/** Bar + "used / limit". Only ever rendered where a limit genuinely applies —
 * an unmetered counter gets a sentence, not an empty meter. */
function Meter({ label, used, limit }: { label: string; used: number; limit: number }) {
  const pct = limit > 0 ? Math.min(100, Math.round((used / limit) * 100)) : 0;
  const over = limit > 0 && used >= limit;
  const warn = pct >= 80 && !over;
  return (
    <div className="flex-1 min-w-[180px]">
      <div className="flex justify-between items-baseline gap-2">
        <span className="text-[11.5px] font-semibold text-muted">{label}</span>
        <span className={`text-[11.5px] font-bold ${over ? 'text-red-600' : 'text-strong'}`}>
          {formatTokens(used)} / {formatTokens(limit)}
        </span>
      </div>
      <div className="h-1.5 rounded-full bg-surface-sunken overflow-hidden mt-1.5">
        <div
          className="h-full rounded-full transition-all"
          style={{
            width: `${pct}%`,
            background: over ? '#DC2626' : warn ? '#E67E22' : 'var(--brand-color, #C9963A)',
          }}
        />
      </div>
      <span className="text-[10.5px] text-faint">{pct}% of plan</span>
    </div>
  );
}

function Stat({ label, value, hint }: { label: string; value: React.ReactNode; hint?: React.ReactNode }) {
  return (
    <div className="flex-1 min-w-[140px]">
      <p className="text-[11.5px] font-semibold text-muted">{label}</p>
      <p className="text-lg font-semibold text-strong leading-tight mt-0.5">{value}</p>
      {hint && <p className="text-[10.5px] text-faint mt-0.5">{hint}</p>}
    </div>
  );
}

const TenantUsagePanel: React.FC<{ tenantId: string }> = ({ tenantId }) => {
  const [usage, setUsage] = useState<TenantUsage | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError('');
      try {
        const token = await auth.currentUser?.getIdToken();
        if (!token) { if (!cancelled) setError('Not authenticated'); return; }
        const res = await fetch(`/api/admin/tenant-usage?tenantId=${encodeURIComponent(tenantId)}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        const data = await res.json();
        if (cancelled) return;
        if (!res.ok) { setError(data.error || 'Failed to load usage'); return; }
        setUsage(data);
      } catch (e: any) {
        if (!cancelled) setError(e?.message || 'Failed to load usage');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [tenantId]);

  if (loading) {
    return <p className="text-xs text-muted">Loading usage…</p>;
  }
  if (error || !usage) {
    return <p className="text-xs text-red-600">Usage unavailable — {error || 'no data'}.</p>;
  }

  const { rag, knowledgeBase: kb, sms } = usage;

  return (
    <div className="space-y-4">
      <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-gold">
        Usage · {usage.month} · {usage.plan}
      </p>

      <div className="flex flex-wrap gap-6">
        <Meter label="RAG query tokens · this month" used={rag.queryTokensUsed} limit={rag.queryTokensCap} />
        <Meter label="RAG ingest tokens · lifetime" used={rag.ingestTokensUsed} limit={rag.ingestTokensCeiling} />
      </div>

      <div className="flex flex-wrap gap-6 pt-1">
        <Stat
          label="Knowledge base"
          value={`${kb.sources.toLocaleString()} source${kb.sources === 1 ? '' : 's'}`}
          hint={`${kb.chunks.toLocaleString()}${kb.chunksTruncated ? '+' : ''} chunk${kb.chunks === 1 ? '' : 's'}${kb.sourcesTruncated ? ' · source count capped' : ''}`}
        />

        {/* TWO SMS NUMBERS, NEVER ONE. `smsSegments` is what Harvest paid for;
            `smsSegmentsByo` is what the church paid Twilio for directly. Adding
            them would produce a figure that means nothing.

            THE-245 — both tiles are withheld while SMS is hidden. This panel is
            super-admin-only and makes no promise to a church, so it is the
            weakest of the hidden surfaces; it goes anyway because the numbers
            can only be 0 and 'Not configured' while nothing can send, and two
            tiles reporting a feature the platform is not offering are noise at
            best and a contradiction at worst. The usage DOCUMENTS behind them
            are untouched — nothing is deleted, and the tiles come back with the
            switch reading the same history. */}
        {SMS_FEATURE_ENABLED && (<>
        <Stat
          label="SMS · Harvest's Twilio"
          value={sms.platformAvailable ? sms.platformSegments.toLocaleString() : 'n/a'}
          hint={
            sms.platformAvailable
              ? (sms.platformCap === null
                  ? 'segments this month · unmetered tier'
                  : `of ${sms.platformCap.toLocaleString()} segments this month`)
              : 'No platform Twilio account yet — every tenant sends on their own'
          }
        />
        <Stat
          label="SMS · own Twilio (BYO)"
          value={sms.credentialSource === null ? '—' : sms.byoSegments.toLocaleString()}
          hint={
            sms.credentialSource === 'byo'
              ? 'segments this month · billed by Twilio, no cap'
              : sms.credentialSource === null
                ? 'Not configured — this tenant cannot send SMS'
                : 'No own credentials on file'
          }
        />
        </>)}
      </div>
    </div>
  );
};

export default TenantUsagePanel;
