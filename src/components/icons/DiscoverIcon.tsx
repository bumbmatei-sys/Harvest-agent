import type { SVGProps } from 'react';

type IconProps = SVGProps<SVGSVGElement> & { size?: number; active?: boolean };
export function DiscoverIcon({ size = 24, active = false, ...props }: IconProps) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>
    {active && <circle cx="12" cy="12" r="9" fill="currentColor" fillOpacity="0.15" stroke="none" />}
    <circle cx="12" cy="12" r="9" />
    <path d="M16 8 14 14 10 10Z" fill="var(--brand-color)" strokeWidth={1.5} />
    <path d="M8 16 10 10 14 14Z" strokeWidth={1.5} />
  </svg>;
}
