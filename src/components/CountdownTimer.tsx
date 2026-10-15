import { formatClock } from '@/lib/clock';

/**
 * The countdown, as a ring with the seconds inside. It is driven directly by the server deadline
 * (see useServerClock) and is never held back by an animation: the ring is a plain stroke offset.
 * It also states the time in words for screen readers and announces only at a few milestones, so a
 * screen reader is not interrupted every second while someone is typing.
 */
export function CountdownTimer({ left, total = 60 }: { left: number | null; total?: number }) {
  if (left === null) return null;
  const urgent = left <= 10;
  const radius = 34;
  const circumference = 2 * Math.PI * radius;
  const fraction = Math.min(1, Math.max(0, left / total));
  const milestone = [30, 10, 5, 0].includes(left) ? `${left} seconds left` : '';
  return (
    <div className="flex items-center gap-3">
      <div className={`relative h-[84px] w-[84px] shrink-0 ${urgent && left > 0 ? 'pulse-urgent' : ''}`}>
        <svg viewBox="0 0 84 84" className="h-full w-full -rotate-90" aria-hidden="true" focusable="false">
          <circle cx="42" cy="42" r={radius} fill="rgba(4,5,34,0.65)" stroke="rgba(255,255,255,0.2)" strokeWidth="8" />
          <circle
            cx="42"
            cy="42"
            r={radius}
            fill="none"
            stroke={urgent ? '#ff6b57' : '#b8f23a'}
            strokeWidth="8"
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={circumference * (1 - fraction)}
            style={{ transition: 'stroke-dashoffset 300ms linear' }}
          />
        </svg>
        <div
          className={`font-display absolute inset-0 flex items-center justify-center text-2xl font-black tabular-nums ${urgent ? 'text-rose-200' : 'text-white'}`}
          aria-hidden="true"
        >
          {left}
        </div>
      </div>
      <div className="font-display text-xs font-extrabold uppercase tracking-widest text-white/85" aria-hidden="true">
        {left === 0 ? 'Time up' : `${formatClock(left)} left`}
      </div>
      <div className="sr-only" role="timer" aria-live="off">
        {left} seconds left
      </div>
      <div className="sr-only" aria-live="polite">
        {milestone}
      </div>
    </div>
  );
}
