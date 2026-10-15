import { useId } from 'react';

// Stratos' recurring companion: a small, round-nosed rocket with a coral fin set and a cyan window.
// Pure SVG, no image file. `mode` picks the CSS animation (see globals.css):
//   idle    a gentle bob, while a question is open
//   launch  fly up and away, then a fresh rocket rises into place (plays once per boost key)
//   still   no motion
// `flame` scales with `power` (0..1): a stronger answer burns longer and hotter.

export function Rocket({
  mode = 'idle',
  power = 0.3,
  className = '',
  size = 56,
}: {
  mode?: 'idle' | 'launch' | 'still';
  power?: number;
  className?: string;
  size?: number;
}) {
  // Two rockets can be on one page (the landing page, plus the sky's), so gradient ids must be unique.
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, '');
  const bodyId = `rk-body-${uid}`;
  const flameId = `rk-flame-${uid}`;
  const p = Math.min(1, Math.max(0, power));
  const flameLength = 26 + Math.round(34 * p);
  const cls = mode === 'idle' ? 'rocket-idle' : mode === 'launch' ? 'rocket-launch' : '';
  const height = Math.round(size * 1.9);
  return (
    <div className={`rocket ${cls} ${className}`} aria-hidden="true">
      <svg width={size} height={height} viewBox="0 0 56 106" role="presentation" focusable="false">
        <defs>
          <linearGradient id={bodyId} x1="0" y1="0" x2="1" y2="0">
            <stop offset="0" stopColor="#dfe9ff" />
            <stop offset="0.55" stopColor="#ffffff" />
            <stop offset="1" stopColor="#b9c8f5" />
          </linearGradient>
          <linearGradient id={flameId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#fffbd0" />
            <stop offset="0.45" stopColor="#ffb23d" />
            <stop offset="1" stopColor="#ff4e2a" stopOpacity="0" />
          </linearGradient>
        </defs>
        {/* fins */}
        <path d="M14 56 L1 78 L16 72 Z" fill="#ff6b57" />
        <path d="M42 56 L55 78 L40 72 Z" fill="#ff6b57" />
        {/* body */}
        <path d="M28 2 C41 14 44 38 41 72 L15 72 C12 38 15 14 28 2 Z" fill={`url(#${bodyId})`} />
        {/* nose */}
        <path d="M28 2 C34 8 38 15 39.5 22 L16.5 22 C18 15 22 8 28 2 Z" fill="#ff6b57" />
        {/* window */}
        <circle cx="28" cy="40" r="8.5" fill="#22d3ee" stroke="#ffffff" strokeWidth="3" />
        <circle cx="25.5" cy="37.5" r="2.4" fill="#ffffff" opacity="0.8" />
        {/* nozzle */}
        <rect x="19" y="72" width="18" height="6" rx="2" fill="#7c3aed" />
        {/* flame */}
        <path className="flame" d={`M21 78 L35 78 L28 ${78 + flameLength} Z`} fill={`url(#${flameId})`} />
      </svg>
    </div>
  );
}
