"use client";
import React, { useState } from 'react';
import { Share2, Check } from 'lucide-react';

interface ShareButtonProps {
  /** Fully-resolved public URL to share (build with utils/share-url helpers). */
  url: string;
  /** Optional title passed to the native share sheet. */
  title?: string;
  /** Visible button text (default "Share"). */
  label?: string;
  /** Extra classes merged onto the button (layout / spacing overrides). */
  className?: string;
}

/**
 * Reusable share control. On click it opens the native share sheet when the
 * device supports it (mobile), otherwise it copies the URL to the clipboard and
 * shows a transient "Copied!" confirmation.
 *
 * The native-share-with-clipboard-fallback logic mirrors BiblePage.handleShare
 * (BiblePage.tsx:459) — swallow AbortError (the user cancelled the share sheet),
 * and fall back to copy on any other error. The "Copied!" state mirrors the
 * transient copy confirmation in AdminEvents (AdminEvents.tsx:368/696).
 */
const ShareButton: React.FC<ShareButtonProps> = ({ url, title, label = 'Share', className }) => {
  const [copied, setCopied] = useState(false);

  const copyToClipboard = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard unavailable (e.g. insecure context) — nothing more we can do.
    }
  };

  const handleShare = async () => {
    if (!url) return;
    if (navigator.share) {
      try {
        await navigator.share(title ? { title, url } : { url });
      } catch (e: any) {
        if (e?.name !== 'AbortError') copyToClipboard();
      }
    } else {
      copyToClipboard();
    }
  };

  return (
    <button
      type="button"
      onClick={handleShare}
      disabled={!url}
      aria-label={label}
      title={label}
      className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold transition-opacity hover:opacity-90 disabled:opacity-40 ${className || ''}`}
      style={{
        color: 'var(--brand-color, #B8962E)',
        background: 'color-mix(in srgb, var(--brand-color, #B8962E) 12%, white)',
      }}
    >
      {copied ? <Check size={14} strokeWidth={2.5} /> : <Share2 size={14} strokeWidth={2.5} />}
      {copied ? 'Copied!' : label}
    </button>
  );
};

export default ShareButton;
