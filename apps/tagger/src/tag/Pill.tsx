import type { ReactNode } from 'react';
import { focusRing, press } from '@sparcd/auth-ui';

/** A round button with an icon: All photos and Brighten over the photo, One photo atop the grid. */
export function Pill({ label, icon, pressed, ariaLabel, className = '', onClick }: {
  label: string;
  icon: ReactNode;
  pressed?: boolean;
  ariaLabel?: string;
  className?: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      aria-pressed={pressed}
      aria-label={ariaLabel}
      className={`h-12 pl-3.5 pr-4 inline-flex items-center gap-2 rounded-full text-[18px] font-[600] shadow ${pressed ? 'bg-ink text-paper hover:opacity-90' : 'bg-paper/85 text-ink hover:bg-paper'} ${press} ${focusRing} ${className}`}
    >
      {icon}
      {label}
    </button>
  );
}

export const GridIcon = () => (
  <svg aria-hidden viewBox="0 0 20 20" className="w-5 h-5" fill="currentColor">
    <rect x="2" y="2" width="7" height="7" />
    <rect x="11" y="2" width="7" height="7" />
    <rect x="2" y="11" width="7" height="7" />
    <rect x="11" y="11" width="7" height="7" />
  </svg>
);

export const PhotoIcon = () => (
  <svg aria-hidden viewBox="0 0 20 20" className="w-5 h-5" fill="currentColor">
    <rect x="1" y="4" width="18" height="13" />
  </svg>
);

export const SunIcon = () => (
  <svg aria-hidden viewBox="0 0 20 20" className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
    <circle cx="10" cy="10" r="3.5" fill="currentColor" />
    <path d="M10 1.5v2M10 16.5v2M1.5 10h2M16.5 10h2M4 4l1.4 1.4M14.6 14.6 16 16M4 16l1.4-1.4M14.6 5.4 16 4" />
  </svg>
);
