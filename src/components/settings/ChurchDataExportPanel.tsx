"use client";

import React, { useEffect, useState } from 'react';
import { Download } from 'lucide-react';
import { authFetch } from '../../utils/auth-fetch';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import {
  Item,
  ItemContent,
  ItemDescription,
  ItemMedia,
  ItemTitle,
} from '@/components/ui/item';

const ROW = 'w-full gap-3 px-5 py-4 text-left bg-surface-raised rounded-brand border-line shadow-[var(--ds-sh-sm)] hover:bg-[color-mix(in_srgb,var(--surface-sunken)_60%,transparent)] min-h-11 sm:min-h-0';

interface ExportJob {
  id: string;
  status: 'running' | 'ready' | 'failed' | 'consumed';
  error?: string | null;
}

/**
 * THE-228 — "Export church data" on admin Settings.
 *
 * The button starts the export. While that request runs the label is the
 * progress. When the file is ready, Download fetches a 15-minute signed URL,
 * saves the zip, then asks the server to delete the object.
 *
 * The request carries no tenant id. The server reads the tenant from the
 * Firebase token, or from the user document when the claim is absent.
 */
const ChurchDataExportPanel: React.FC = () => {
  const [job, setJob] = useState<ExportJob | null>(null);
  const [phase, setPhase] = useState<'idle' | 'preparing' | 'downloading' | 'opened'>('idle');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await authFetch('/api/church-export');
        const data = await res.json().catch(() => ({} as { error?: string; export?: ExportJob | null }));
        if (cancelled) return;
        if (!res.ok) {
          // A 403 means this admin may open Settings and still may not export
          // the church. That is a refusal, not a failed read — the button stays,
          // and the error appears when they actually start one.
          if (res.status === 403) return;
          setError(typeof data.error === 'string' ? data.error : 'Could not load export status.');
          return;
        }
        if (data.export) {
          setJob(data.export);
          if (data.export.status === 'failed' && data.export.error) setError(data.export.error);
        }
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Could not load export status.');
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const start = async () => {
    setPhase('preparing');
    setError(null);
    try {
      const res = await authFetch('/api/church-export', { method: 'POST', body: '{}' });
      const data = await res.json().catch(() => ({} as { error?: string; exportId?: string; status?: string }));
      if (!res.ok || !data.exportId) {
        setError(typeof data.error === 'string' ? data.error : 'Export failed.');
        setPhase('idle');
        return;
      }
      setJob({ id: data.exportId, status: 'ready' });
      setPhase('idle');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Export failed.');
      setPhase('idle');
    }
  };

  const download = async () => {
    if (!job || job.status !== 'ready') return;
    setPhase('downloading');
    setError(null);
    try {
      const res = await authFetch('/api/church-export/url', {
        method: 'POST',
        body: JSON.stringify({ exportId: job.id }),
      });
      const data = await res.json().catch(() => ({} as { error?: string; url?: string }));
      if (!res.ok || !data.url) {
        setError(typeof data.error === 'string' ? data.error : 'Could not start the download.');
        setPhase('idle');
        return;
      }

      let saved = false;
      try {
        const file = await fetch(data.url);
        if (file.ok) {
          const blob = await file.blob();
          const href = URL.createObjectURL(blob);
          const anchor = document.createElement('a');
          anchor.href = href;
          anchor.download = 'church-export.zip';
          document.body.appendChild(anchor);
          anchor.click();
          anchor.remove();
          URL.revokeObjectURL(href);
          saved = true;
        }
      } catch {
        saved = false;
      }

      if (!saved) {
        const opened = window.open(data.url, '_blank', 'noopener,noreferrer');
        if (!opened) {
          setError('The download was blocked. The file is still ready.');
          setPhase('idle');
          return;
        }
        setPhase('opened');
        return;
      }

      const done = await authFetch('/api/church-export/complete', {
        method: 'POST',
        body: JSON.stringify({ exportId: job.id }),
      });
      const doneBody = await done.json().catch(() => ({} as { error?: string }));
      if (!done.ok) {
        setError(typeof doneBody.error === 'string' ? doneBody.error : 'The file downloaded, but it could not be removed from storage.');
        setPhase('idle');
        return;
      }
      setJob({ id: job.id, status: 'consumed' });
      setPhase('idle');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not start the download.');
      setPhase('idle');
    }
  };

  const removeCopy = async () => {
    if (!job) return;
    setError(null);
    try {
      const done = await authFetch('/api/church-export/complete', {
        method: 'POST',
        body: JSON.stringify({ exportId: job.id }),
      });
      const doneBody = await done.json().catch(() => ({} as { error?: string }));
      if (!done.ok) {
        setError(typeof doneBody.error === 'string' ? doneBody.error : 'Could not remove the export.');
        return;
      }
      setJob({ id: job.id, status: 'consumed' });
      setPhase('idle');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not remove the export.');
    }
  };

  const preparing = phase === 'preparing';
  const ready = job?.status === 'ready' && phase !== 'preparing';

  return (
    <div className="space-y-3" data-church-export="">
      <Item
        variant="outline"
        render={<button type="button" onClick={start} disabled={preparing || phase === 'downloading'} />}
        className={ROW}
        aria-busy={preparing}
        aria-label="Export church data"
      >
        <ItemMedia variant="icon">
          <Download size={18} className="text-gold shrink-0" />
        </ItemMedia>
        <ItemContent className="min-w-0">
          <ItemTitle className="text-sm font-semibold text-strong">
            {preparing ? 'Preparing export…' : 'Export church data'}
          </ItemTitle>
          <ItemDescription className="text-xs text-faint">
            Members, contacts, giving and events for this ministry, as CSV files. The link lasts 15 minutes and the file is removed after you download it.
          </ItemDescription>
        </ItemContent>
      </Item>

      {ready && (
        <p role="status" className="text-sm text-muted">Ready</p>
      )}
      {ready && (
        <Item
          variant="outline"
          render={<button type="button" onClick={download} disabled={phase === 'downloading'} />}
          className={ROW}
          aria-label="Download"
        >
          <ItemContent className="min-w-0">
            <ItemTitle className="text-sm font-semibold text-strong">
              {phase === 'downloading' ? 'Downloading…' : 'Download'}
            </ItemTitle>
          </ItemContent>
        </Item>
      )}
      {phase === 'opened' && (
        <Item
          variant="outline"
          render={<button type="button" onClick={removeCopy} />}
          className={ROW}
          aria-label="Remove stored copy"
        >
          <ItemContent className="min-w-0">
            <ItemTitle className="text-sm font-semibold text-strong">Remove stored copy</ItemTitle>
          </ItemContent>
        </Item>
      )}
      {job?.status === 'consumed' && phase === 'idle' && (
        <p role="status" className="text-sm text-muted">Downloaded. The copy has been removed from storage.</p>
      )}
      {error && (
        <Alert variant="destructive">
          <AlertTitle>Export failed</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
    </div>
  );
};

export default ChurchDataExportPanel;
