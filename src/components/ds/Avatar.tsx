import React from 'react';
import { cn } from '@/lib/utils';

/**
 * Avatar — a round member/user mark. Shows a supplied image, or falls back to
 * initials on a warm neutral fill. Ported from the Harvest design kit (Admin).
 *
 * The initials use `text-muted`, not the kit's raw warm-brown: warm-brown on
 * stone-100 is 3.89:1, and initials are text.
 */
export interface AvatarProps extends React.HTMLAttributes<HTMLSpanElement> {
  /** Full name, used for the initials fallback and the image alt. */
  name?: string;
  src?: string | null;
  /** Diameter in px. @default 36 */
  size?: number;
}

const initialsOf = (name: string): string =>
  name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('') || '?';

export function Avatar({ name = '', src = null, size = 36, className, style, ...rest }: AvatarProps) {
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full',
        'border border-line bg-surface-sunken font-sans font-semibold text-muted',
        className,
      )}
      style={{ width: size, height: size, fontSize: size * 0.36, ...style }}
      {...rest}
    >
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={src} alt={name} className="h-full w-full object-cover" />
      ) : (
        initialsOf(name)
      )}
    </span>
  );
}
