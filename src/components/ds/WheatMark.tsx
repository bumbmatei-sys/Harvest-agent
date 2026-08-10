import React from 'react';
import { cn } from '@/lib/utils';

/**
 * WheatMark — the wheat-stalk mark + "Harvest." wordmark lockup, set in
 * Fraunces Light with its signature gold period. Ported from the Harvest
 * design kit (Brand).
 *
 * ⚠️ The kit defaults `src` to a raw githubusercontent.com URL. That is not
 * carried over: the app ships as a Capacitor shell, where a remote image is a
 * blocking external request, and the mark is the first thing on screen. `src`
 * is required instead, so a caller passes a local asset.
 *
 * `font-display` is Fraunces here. Note the kit's own token for this is
 * `--font-serif`, which in Harvest is Newsreader — mapping it by name would
 * silently set the wordmark in the wrong face.
 */
export interface WheatMarkProps extends React.HTMLAttributes<HTMLSpanElement> {
  /** Mark artwork. Required — pass a local asset, never a remote URL. */
  src: string;
  /** Mark edge length in px. @default 40 */
  size?: number;
  /** @default true */
  showWordmark?: boolean;
  /** Set the wordmark for a navy brand band. @default false */
  onDark?: boolean;
}

export function WheatMark({
  src,
  size = 40,
  showWordmark = true,
  onDark = false,
  className,
  style,
  ...rest
}: WheatMarkProps) {
  return (
    <span
      className={cn('inline-flex items-center', className)}
      style={{ gap: size * 0.28, ...style }}
      {...rest}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={src}
        alt="Harvest"
        className="block object-contain"
        style={{ width: size, height: size }}
      />
      {showWordmark && (
        <span
          // A night band is dark in both themes, so `onDark` pins to cream
          // rather than using the ramp; otherwise the wordmark follows it.
          className={cn(
            'font-display font-light leading-none tracking-display',
            onDark ? 'text-cream' : 'text-strong',
          )}
          style={{ fontSize: size * 0.62 }}
        >
          Harvest<span className="text-gold">.</span>
        </span>
      )}
    </span>
  );
}
