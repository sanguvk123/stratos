'use client';

import { revealLevel } from '@/lib/altitude';
import { revealTimeline } from '@/lib/motion';
import type { PopularityDto, RoundResultDto } from '@/lib/types';
import { TIER_BLURBS } from '@/lib/tiers';
import { useCountUp } from './AltitudeCounter';
import { RarityBadge } from './ui';

function popularityCopy(p: PopularityDto | null): string | null {
  if (p === null) return null;
  switch (p.kind) {
    case 'shown':
      return `${p.percentOfEarlierAnswers}% of earlier valid answers matched yours.`;
    case 'under_one_percent':
      return 'Fewer than 1% of earlier valid answers matched yours.';
    case 'none_earlier':
      return 'No earlier answer matched yours.';
    case 'suppressed':
      return 'Too few earlier answers yet for a popularity figure.';
  }
}

/**
 * The signature moment. Everything on this card comes from the server's final result: the
 * recognised answer, the tier and the exact points. Nothing is shown, counted or guessed before the
 * server has confirmed the lock. The staging (lock stamp, answer, tier, points) uses a timeline whose
 * length grows with the points, so a rare answer feels bigger, and a 10-point answer is still quick.
 */
export function RevealCard({
  result,
  total,
  corrected = false,
  animate = true,
}: {
  result: RoundResultDto;
  total: number;
  /** true when what the player typed was fixed to a different spelling. */
  corrected?: boolean;
  /** false when this card is shown for an old question (a reload), so nothing replays. */
  animate?: boolean;
}) {
  const level = revealLevel(result.points);
  const timeline = revealTimeline(level);
  const delay = (ms: number) => (animate ? { animationDelay: `${ms}ms` } : { animation: 'none' });
  // The points count up from 0 to the server's final number, after the tier has landed.
  const shownPoints = useCountUp(result.points, animate ? timeline.pointsMs : 0, 700, animate ? 0 : result.points);
  const popularity = popularityCopy(result.popularity);

  if (!result.answerText) {
    return (
      <section className={`card-arcade p-5 sm:p-8 ${animate ? 'reveal-in' : ''}`} aria-live="polite">
        <div className="font-display text-sm font-black uppercase tracking-[0.2em] text-sky-100/80">
          Question {result.questionIndex} of {total}
        </div>
        <h2 className="font-display mt-3 text-2xl font-black text-white">Time ran out</h2>
        <p className="mt-2 text-sky-100/90">{result.prompt}</p>
        <div className="mt-5 flex flex-wrap items-center gap-3">
          <RarityBadge tier={null} />
          <span className="font-display text-xl font-black text-white">+0 points</span>
        </div>
        <p className="mt-4 text-sm text-sky-100/80">
          No answer was locked in time. The next layer is waiting.
        </p>
      </section>
    );
  }

  return (
    <section
      className={`card-arcade p-5 sm:p-8 ${animate && timeline.shake ? 'shake-big' : ''} ${animate ? 'reveal-in' : ''}`}
      aria-live="polite"
    >
      <div className="flex items-center justify-between gap-3">
        <div className="font-display text-sm font-black uppercase tracking-[0.2em] text-sky-100/80">
          Question {result.questionIndex} of {total}
        </div>
        <span
          className={`chip chip-lime ${animate ? 'stamp' : ''}`}
          style={delay(timeline.lockMs)}
        >
          Answer locked
        </span>
      </div>

      <p className="mt-3 text-sm text-sky-100/80">{result.prompt}</p>

      <div className={animate ? 'stage' : ''} style={delay(timeline.answerMs)}>
        <div className="font-display mt-5 text-xs font-extrabold uppercase tracking-widest text-sky-100/80">
          {corrected ? 'We read your answer as\u2026' : 'You answered'}
        </div>
        <div className="font-display text-gradient-sky mt-1 break-words text-4xl font-black leading-tight sm:text-5xl">
          {result.answerText}
        </div>
      </div>

      <div className="mt-5 flex flex-wrap items-center gap-4">
        <div className={animate ? 'stamp' : ''} style={delay(timeline.tierMs)}>
          <RarityBadge tier={result.tier} size="lg" />
        </div>
        <div className={animate ? 'pop' : ''} style={delay(timeline.pointsMs)}>
          <span className="font-display text-gradient-hot text-5xl font-black tabular-nums sm:text-6xl">
            +{shownPoints}
          </span>
          <span className="font-display ml-2 text-lg font-extrabold uppercase tracking-widest text-white/90">pts</span>
        </div>
      </div>

      <div className={animate ? 'stage' : ''} style={delay(timeline.pointsMs + 150)}>
        {result.tier ? <p className="mt-4 text-base text-sky-50">{TIER_BLURBS[result.tier]}</p> : null}
        {popularity ? <p className="mt-1 text-sm text-sky-100/85">{popularity}</p> : null}
        <p className="mt-4 text-xs text-sky-100/70">
          Scored the moment you locked your answer, against the valid answers of players who locked before you.
          Tiers are estimates.
        </p>
      </div>
    </section>
  );
}
