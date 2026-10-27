import type { SVGProps } from 'react';

type IconProps = SVGProps<SVGSVGElement> & { size?: number; active?: boolean };
export function DiscoverIcon({ size = 24, active = false, ...props }: IconProps) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>
    {active && <path d="M8 9h8l1 9H7l1-9Z" fill="currentColor" fillOpacity="0.15" stroke="none" />}
    <path d="M9 6V5a3 3 0 0 1 6 0v1M8 6h8l1 3H7l1-3ZM8 9l-1 9h10l-1-9M6 21h12M7 18l-1 3M17 18l1 3M12 16c-1.3 0-2-1-1.5-2 .3-.6.8-1 1.5-2 .7 1 1.2 1.4 1.5 2 .5 1-.2 2-1.5 2ZM3 10l1 1M21 10l-1 1M3 16h1M21 16h-1" />
  </svg>;
}
