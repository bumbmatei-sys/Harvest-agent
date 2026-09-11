"use client";
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import QRCode from 'qrcode';
import { Share2, Copy, Check, QrCode, Download, X } from 'lucide-react';
import { ProviderMark } from './GivingLinks';
import {
  GIVING_SHARE_CARD_GIVING_OFF,
  buildGivingSharePayload,
  type GivingSharePayload,
} from './giving-share';

/**
 * THE-281 — "Share giving page", on the Donations screen.
 *
 * ─── What "share" means here ────────────────────────────────────────────────
 *
 * Three mechanisms, because a church uses three:
 *
 *   1. THE WEB SHARE API — `navigator.share`, feature-detected. Mobile is the
 *      primary platform for this app, and on mobile the native sheet is the
 *      only thing that reaches WhatsApp, Messages and the church's group chat
 *      where the link actually gets sent.
 *   2. COPY TO CLIPBOARD — always rendered, never conditional. `navigator.share`
 *      is absent on essentially every desktop browser, so a surface that only
 *      offered it would be a dead button on the machine most admins configure
 *      this screen from. It is the fallback AND the desktop primary.
 *   3. A QR CODE — because a code on a screen at the front of the room is how
 *      giving actually happens in a service. Generated with `qrcode`, which is
 *      ALREADY A DEPENDENCY (`AdminQR` has generated a "Giving Page" code with
 *      it since THE-213), at the same URL AdminQR uses. No new dependency, and
 *      no second answer to "where is our giving page".
 *
 * ─── 🔴 The sheet opens ABOVE the mobile bottom nav ─────────────────────────
 *
 * `AdminDashboard`'s nav is `fixed bottom-0 … z-[100]` with `pb-safe` on
 * mobile. A sheet at a lower layer renders BEHIND it, which on a 380px phone
 * hides the bottom ~64px of the sheet — and the bottom of this sheet is where
 * the buttons are.
 *
 * So the scrim is `z-[101]` and the sheet is `z-[102]`, which is not a number
 * invented here: it is byte-for-byte the pair AdminDashboard's own More Sheet
 * uses, one screen up. `pb-safe` carries the home-indicator inset, and
 * `max-h-[84vh]` with an inner scroller keeps the sheet on screen at any
 * height rather than growing past the top.
 *
 * ─── 🔴 No URL leaves here that the allow-list did not pass ─────────────────
 *
 * This component holds no URL logic at all. It renders `buildGivingSharePayload`
 * — which takes the raw config, calls `readGivingLinks` itself, and re-derives
 * every provider URL against that provider's own `hosts` — and it renders the
 * validated giving-page URL. There is no branch here that can emit a string the
 * validators did not return. See `giving-share.ts`.
 *
 * ⚠️ `ProviderMark` is reused, not re-drawn. The tiles stay monograms; nothing
 * here adds artwork, and the marks stay `aria-hidden` with the provider's name
 * beside them in text carrying the accessible name.
 */

/** Every control on this surface is at least this tall and wide. */
const TAP = 'min-h-[44px] min-w-[44px]';

/** A control's chrome, in tokens only. */
const CONTROL =
  `${TAP} inline-flex items-center justify-center gap-2 px-4 rounded-brand ` +
  'border border-line bg-surface-raised text-[13px] font-semibold text-strong ' +
  'transition-colors hover:bg-surface-sunken disabled:opacity-40';

const GivingShareSheet: React.FC<{
  tenantId: string | null | undefined;
  config: { givingLinks?: unknown } | null | undefined;
  churchName?: string | null;
}> = ({ tenantId, config, churchName }) => {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [qr, setQr] = useState('');
  const [showQr, setShowQr] = useState(false);
  const [canNativeShare, setCanNativeShare] = useState(false);

  const payload: GivingSharePayload = useMemo(
    () => buildGivingSharePayload(tenantId, config, churchName),
    [tenantId, config, churchName],
  );

  /* `navigator.share` is read in an effect, never during render: it is absent
     on the server and this component is under "use client" in an app that
     prerenders. */
  useEffect(() => {
    setCanNativeShare(typeof navigator !== 'undefined' && typeof navigator.share === 'function');
  }, []);

  /* The QR is generated only once the sheet is open and only for a URL that
     passed validation — a null url generates nothing rather than a code
     pointing at the string "null". */
  useEffect(() => {
    if (!open || !payload.url) { setQr(''); return; }
    let cancelled = false;
    QRCode.toDataURL(payload.url, { width: 400, margin: 2 })
      .then((d) => { if (!cancelled) setQr(d); })
      .catch(() => { if (!cancelled) setQr(''); });
    return () => { cancelled = true; };
  }, [open, payload.url]);

  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(t);
  }, [copied]);

  const close = useCallback(() => { setOpen(false); setShowQr(false); }, []);

  /* Escape closes, as it does on every other overlay in the admin. */
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, close]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(payload.text);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };

  const nativeShare = async () => {
    if (!payload.url) return;
    try {
      await navigator.share({ title: payload.title, text: payload.text, url: payload.url });
    } catch {
      /* A dismissed share sheet rejects. That is the member of this pair that
         is not an error, so nothing is reported. */
    }
  };

  const downloadQr = () => {
    if (!qr) return;
    const a = document.createElement('a');
    a.href = qr;
    a.download = 'giving-page-qr.png';
    a.click();
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        disabled={!payload.url}
        data-testid="giving-share-button"
        className={`${CONTROL} w-full sm:w-auto`}
      >
        <Share2 size={16} aria-hidden="true" />
        Share giving page
      </button>

      {open && (
        <>
          {/* Scrim — z-[101], directly above the bottom nav's z-[100]. */}
          <div
            data-testid="giving-share-scrim"
            className="fixed inset-0 z-[101]"
            /* The modal backdrop token, not `bg-black/50`: --scrim-night is
               redefined by the dark and Classic blocks, so the scrim is the
               right depth in all four palettes from one declaration. */
            style={{ backgroundColor: 'var(--scrim-night)' }}
            onClick={close}
          />
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Share your giving page"
            data-testid="giving-share-sheet"
            className={
              'fixed bottom-0 left-0 right-0 z-[102] bg-surface rounded-t-[22px] ' +
              'max-h-[84vh] flex flex-col pb-safe shadow-2xl ' +
              /* On a tablet and up it stops being a bottom sheet and becomes a
                 centred panel; the bottom nav is `lg:relative` by then, so the
                 layer is no longer what keeps it clear. */
              'sm:left-1/2 sm:right-auto sm:bottom-auto sm:top-1/2 sm:w-[min(30rem,calc(100vw-2rem))] ' +
              'sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-brand-xl'
            }
          >
            <div className="w-9 h-1 bg-line-strong rounded-full mx-auto mt-3 mb-1 shrink-0 sm:hidden" />

            <div className="flex items-center justify-between gap-2 px-[18px] pt-2 pb-3 shrink-0">
              <h3 className="font-display font-light text-[22px] leading-none tracking-[-0.02em] text-strong">
                Share your giving page
              </h3>
              <button
                type="button"
                onClick={close}
                aria-label="Close"
                className={`${TAP} inline-flex items-center justify-center rounded-brand text-muted hover:bg-surface-sunken transition-colors`}
              >
                <X size={18} aria-hidden="true" />
              </button>
            </div>

            <div className="overflow-y-auto px-[18px] pb-5">
              {payload.url && (
                <p className="text-xs text-faint break-all mb-3" data-testid="giving-share-url">
                  {payload.url}
                </p>
              )}

              <div className="flex flex-col sm:flex-row gap-2 mb-4">
                {canNativeShare && (
                  <button type="button" onClick={nativeShare} className={`${CONTROL} flex-1`}>
                    <Share2 size={16} aria-hidden="true" />
                    Share
                  </button>
                )}
                <button
                  type="button"
                  onClick={copy}
                  data-testid="giving-share-copy"
                  className={`${CONTROL} flex-1`}
                >
                  {copied
                    ? <><Check size={16} aria-hidden="true" />Copied</>
                    : <><Copy size={16} aria-hidden="true" />Copy</>}
                </button>
                <button
                  type="button"
                  onClick={() => setShowQr((v) => !v)}
                  aria-expanded={showQr}
                  data-testid="giving-share-qr-toggle"
                  className={`${CONTROL} flex-1`}
                >
                  <QrCode size={16} aria-hidden="true" />
                  QR code
                </button>
              </div>

              {showQr && (
                <div className="mb-4 flex flex-col items-center gap-3">
                  {qr
                    ? <img src={qr} alt="QR code for your giving page" width={200} height={200} className="rounded-brand" />
                    : <p className="text-sm text-muted">Generating…</p>}
                  <button type="button" onClick={downloadQr} disabled={!qr} className={CONTROL}>
                    <Download size={16} aria-hidden="true" />
                    Download
                  </button>
                </div>
              )}

              {/* The links the shared page carries — the founder's "carrying all
                  the church's payment links", shown so a founder can see what
                  they are about to send. Every row is validated output. */}
              {payload.links.length > 0 && (
                <div className="mb-4">
                  <p className="text-[11px] font-bold text-faint tracking-wider uppercase mb-2">
                    What this page carries
                  </p>
                  <div className="space-y-2">
                    {payload.links.map((link) => (
                      <div
                        key={link.provider.id}
                        data-provider={link.provider.id}
                        className="flex items-center gap-3 px-3 py-2 rounded-brand-lg border border-line bg-surface-raised"
                      >
                        <ProviderMark provider={link.provider} size={32} />
                        <span className="flex-1 min-w-0">
                          <span className="block text-sm font-semibold text-strong">
                            {link.provider.label}
                          </span>
                          {link.handle && (
                            <span className="block text-xs text-muted truncate">{link.handle}</span>
                          )}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* 🔴 STATIC COPY — THE-256, corrected by THE-357. A sentence,
                  not a control: no button, no link, no gate that could become
                  one — and since THE-357 it promises nothing either. */}
              <p className="text-xs text-faint leading-relaxed" data-testid="giving-share-card-giving-off">
                {GIVING_SHARE_CARD_GIVING_OFF}
              </p>
            </div>
          </div>
        </>
      )}
    </>
  );
};

export default GivingShareSheet;
