import type { SVGProps } from 'react';

type IconProps = SVGProps<SVGSVGElement> & { size?: number; active?: boolean };
export function CommunityIcon({ size = 24, active = false, ...props }: IconProps) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>
    <path d="M3.8 11 5 10.6C5 9.4 5.9 8.5 7.1 8.5c1.7 0 2.2 1.9 3.4 3 2.2.9 4.6 1.6 7 3l3.5 0-2.2 1.6 1.7 1.9-3-.9c-2.4 1-5.7 1.6-8.2.8-2.3-.7-3.6-2.8-4.1-5.6Z" fill={active ? 'currentColor' : 'none'} fillOpacity={active ? 0.15 : undefined} />
    <path d="M10.5 11.8c1-3.8 3.5-6.8 7-8.3-.4 4.7-1.1 8.4-2.5 11.1-1.5 0-3.2-.9-4.5-2.8Z" fill={active ? 'currentColor' : 'none'} fillOpacity={active ? 0.15 : undefined} />
    <path d="M4.2 11.7 3.2 14" />
    <path d="M3.2 14c.4.8.1 1.6-.7 2 .1-1 .2-1.6.7-2Z" />
  </svg>;
}
