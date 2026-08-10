import React, { useEffect } from 'react';
import { cn } from '@/lib/utils';

/**
 * Modal — a centered dialog on a night scrim. Ported from the Harvest design
 * kit (Feedback).
 *
 * The scrim and the dialog's elevation are the two tokens THE-61 adds
 * (--scrim-night, --ds-sh-xl); both carry a dark value, because a dialog that
 * keeps its light scrim is the most visible way a theme breaks.
 */
// `title` is omitted from the base attributes rather than narrowed: the DOM's
// title is a string tooltip, while a dialog heading routinely carries nodes.
export interface ModalProps extends Omit<React.HTMLAttributes<HTMLDivElement>, 'title'> {
  /** @default true */
  open?: boolean;
  onClose?: () => void;
  title?: React.ReactNode;
  subtitle?: React.ReactNode;
  footer?: React.ReactNode;
  /** Max dialog width in px. @default 480 */
  width?: number;
  /** @default "center" */
  align?: 'center' | 'top';
  children?: React.ReactNode;
}

export function Modal({
  open = true,
  onClose,
  title = null,
  subtitle = null,
  footer = null,
  width = 480,
  align = 'center',
  className,
  children,
  ...rest
}: ModalProps) {
  useEffect(() => {
    if (!open || !onClose) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose?.();
      }}
      className={cn(
        'fixed inset-0 z-[1000] flex justify-center bg-[var(--scrim-night)] p-6 backdrop-blur-[2px]',
        align === 'top' ? 'items-start pt-[72px]' : 'items-center',
        className,
      )}
      {...rest}
    >
      <div
        role="dialog"
        aria-modal="true"
        style={{ maxWidth: width }}
        className="flex max-h-[88vh] w-full flex-col overflow-hidden rounded-brand-xl bg-surface-raised shadow-[var(--ds-sh-xl)]"
      >
        {(title || onClose) && (
          <div className="flex shrink-0 items-start justify-between gap-3 border-b border-line px-6 py-5">
            <div>
              {title && (
                <div className="font-display text-[22px] font-light tracking-display text-strong">
                  {title}
                </div>
              )}
              {subtitle && <div className="mt-[3px] text-[13px] text-muted">{subtitle}</div>}
            </div>
            {onClose && (
              <button
                type="button"
                onClick={onClose}
                aria-label="Close"
                className="flex h-[30px] w-[30px] shrink-0 cursor-pointer items-center justify-center rounded-lg border border-line bg-transparent text-base leading-none text-muted"
              >
                ×
              </button>
            )}
          </div>
        )}
        <div className="min-h-0 flex-1 overflow-y-auto p-6">{children}</div>
        {footer && (
          <div className="flex shrink-0 gap-2.5 border-t border-line px-6 py-4">{footer}</div>
        )}
      </div>
    </div>
  );
}
