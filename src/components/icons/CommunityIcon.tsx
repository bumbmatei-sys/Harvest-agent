import type { SVGProps } from 'react';

type IconProps = SVGProps<SVGSVGElement> & { size?: number; active?: boolean };
export function CommunityIcon({ size = 24, active = false, ...props }: IconProps) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>
    {active && <path d="M12 3C8 5 7 10 9 14h6c2-4 1-9-3-11Z" fill="currentColor" fillOpacity="0.15" stroke="none" />}
    <path d="M12 3v13M12 7C10 7 9 5.5 9 4M12 10c-2.5 0-4-1.5-4-3M12 13c-3 0-5-1.5-5-3M12 7c2 0 3-1.5 3-3M12 10c2.5 0 4-1.5 4-3M12 13c3 0 5-1.5 5-3M8 16c2-1 6-1 8 0l-1 2H9l-1-2ZM10 18l-1 3M14 18l1 3" />
  </svg>;
}
