'use client';

import { useEffect, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { altitudeKm, darkness, formatAltitude, sphereForQuestion } from '@/lib/altitude';
import type { FinalResultDto } from '@/lib/types';
import { AltitudeCounter } from './AltitudeCounter';
import { Rocket } from './Rocket';
import { Shell } from './Shell';
import { Button, ButtonLink, Card, Notice, Stat, RarityBadge } from './ui';

/** The line that sits under the big altitude number. It celebrates finishing without overstating the score. */
function headline(points: number, max: number): string {
  if (points <= 0) return 'You finished the climb. The sky is still up there.';
  const share = points / max;
  if (share >= 0.6) return 'A towering climb.';
  if (share >= 0.3) return 'A strong climb.';
  return 'Climb complete. Every layer counts.';
}

export function ResultView({ sessionId }: { sessionId: string }) {
  const [result, setResult] = useState<FinalResultDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<'ok' | 'fail' | null>(null);

  useEffect(() => {
    api
      .getResult(sessionId)
      .then(setResult)
      .catch((e: unknown) => {
        if (e instanceof ApiError && e.code === 'NOT_FINALIZED') {
          setError('This climb is not finished yet.');
        } else if (e instanceof ApiError && (e.status === 401 || e.status === 404)) {
          setError('We could not find that climb in this browser.');
        } else {
          setError(e instanceof Error ? e.message : 'Something went wrong.');
        }
      });
  }, [sessionId]);

  const copy = async () => {
    if (!result) return;
    try {
      await navigator.clipboard.writeText(result.shareText);
      setCopied('ok');
    } catch {
      setCopied('fail');
    }
  };

  if (error) {
    return (
      <Shell>
        <Card>
          <h1 className="font-display text-2xl font-black text-white">Off course</h1>
          <div className="mt-3">
            <Notice tone="error">{error}</Notice>
          </div>
          <div className="mt-5">
            <ButtonLink href="/" variant="primary">
              Back to the surface
            </ButtonLink>
          </div>
        </Card>
      </Shell>
    );
  }
  if (!result) {
    return (
      <Shell>
        <Card>
          <p className="font-display text-xl font-black text-white" role="status">
            Reading your altimeter{'\u2026'}
          </p>
        </Card>
      </Shell>
    );
  }

  // Altitude is the sum of the server's per-question points, so these agree by construction.
  const km = altitudeKm(result.totalPoints);

  return (
    <Shell sphere={6} darkness={darkness(6, result.totalPoints)}>
      <section className="reveal-in text-center [text-shadow:0_2px_12px_rgba(3,5,40,0.7)]">
        <div className="flex justify-center">
          <Rocket mode="idle" power={Math.min(1, result.totalPoints / 400)} size={60} />
        </div>
        <div className="font-display mt-2 text-sm font-black uppercase tracking-[0.25em] text-sky-100">
          {result.isRanked ? `Daily climb \u00B7 ${result.challengeDate}` : 'Practice climb'}
        </div>
        <h1 className="font-display text-gradient-hot mt-2 text-6xl font-black tabular-nums sm:text-8xl">
          {formatAltitude(km)}
        </h1>
        <p className="font-display mt-1 text-xl font-extrabold text-white">
          {result.totalPoints} of {result.maxPoints} points
        </p>
        <p className="mt-2 text-lg font-semibold text-sky-50">{headline(result.totalPoints, result.maxPoints)}</p>
        <div className="sr-only">
          <AltitudeCounter km={km} label={false} />
        </div>
      </section>

      {result.isRanked ? (
        <Card className="mt-6">
          <div className="grid grid-cols-2 gap-6 sm:grid-cols-3">
            <Stat label="Rank today" value={result.rank !== null ? `#${result.rank}` : '\u2014'} />
            <Stat
              label="Finished today"
              value={result.participants !== null ? result.participants.toLocaleString('en-IN') : '\u2014'}
            />
            {result.percentile !== null ? (
              <Stat label="You beat" value={`${result.percentile}%`} />
            ) : null}
          </div>
          {result.percentile === null ? (
            <p className="mt-4 text-sm text-sky-100/85">
              Not enough climbers have finished yet for a percentile, so we do not show one.
            </p>
          ) : null}
        </Card>
      ) : (
        <p className="mt-5 text-center text-sm font-semibold text-white [text-shadow:0_1px_8px_rgba(3,5,40,0.75)]">
          Practice scores never appear on the leaderboard and do not affect anyone{'\u2019'}s ranked score.
        </p>
      )}

      <Card className="mt-6">
        <h2 className="font-display text-2xl font-black text-white">Your seven answers</h2>
        <ol className="mt-4 divide-y divide-white/10">
          {result.results.map((r) => (
            <li key={r.roundId} className="py-4">
              <div className="font-display text-xs font-extrabold uppercase tracking-widest text-sky-100/75">
                {r.questionIndex}. {sphereForQuestion(r.questionIndex - 1).name} {'\u00B7'} {r.category}
              </div>
              <div className="mt-1 text-sky-50">{r.prompt}</div>
              <div className="mt-2 flex flex-wrap items-center gap-3">
                <span className="font-display text-xl font-black text-white">{r.answerText ?? 'No answer'}</span>
                <RarityBadge tier={r.tier} size="sm" />
                <span className="font-display font-black text-stratos-lime">+{r.points}</span>
              </div>
            </li>
          ))}
        </ol>
      </Card>

      <Card className="mt-6">
        <h2 className="font-display text-2xl font-black text-white">Share your climb</h2>
        <pre className="font-display mt-3 whitespace-pre-wrap rounded-2xl border-2 border-white/15 bg-[#04051a]/80 p-4 text-lg font-bold text-white">
          {result.shareText}
        </pre>
        <p className="mt-2 text-xs text-sky-100/75">Shows tiers and totals only. It never reveals a question or an answer.</p>
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <Button variant="lock" onClick={copy}>
            Copy result
          </Button>
          {copied === 'ok' ? (
            <span role="status" className="font-bold text-lime-200">
              Copied.
            </span>
          ) : null}
          {copied === 'fail' ? (
            <span role="status" className="font-bold text-rose-200">
              Could not copy. Select the text above instead.
            </span>
          ) : null}
        </div>
      </Card>

      <div className="mt-8 flex flex-wrap gap-3">
        <ButtonLink href="/play/practice" variant="primary" large>
          Practice again
        </ButtonLink>
        <ButtonLink href="/leaderboard" variant="secondary">
          Leaderboard
        </ButtonLink>
        <ButtonLink href="/" variant="ghost">
          Home
        </ButtonLink>
      </div>
      {result.isRanked ? (
        <p className="mt-4 text-sm font-semibold text-white [text-shadow:0_1px_8px_rgba(3,5,40,0.75)]">
          Come back tomorrow (UTC) for a new daily climb.
        </p>
      ) : null}
    </Shell>
  );
}
