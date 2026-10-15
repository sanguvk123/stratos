'use client';

import { useEffect, useState } from 'react';
import { Shell } from '@/components/Shell';
import { Card, Notice } from '@/components/ui';
import { api } from '@/lib/api';
import { altitudeKm, formatAltitude } from '@/lib/altitude';
import type { LeaderboardDto, LeaderboardEntryDto } from '@/lib/types';

const MEDALS = ['\uD83E\uDD47', '\uD83E\uDD48', '\uD83E\uDD49'];

function Row({ e, index }: { e: LeaderboardEntryDto; index: number }) {
  const medal = e.rank <= 3 ? MEDALS[e.rank - 1] : null;
  return (
    <li
      className={`stage flex items-center gap-3 rounded-2xl px-3 py-3 sm:px-4 ${
        e.isYou ? 'bg-stratos-lime/20 ring-2 ring-stratos-lime' : 'bg-white/5'
      }`}
      style={{ animationDelay: `${Math.min(index, 12) * 40}ms` }}
    >
      <span className="font-display w-12 shrink-0 text-center text-xl font-black text-white">
        {medal ? <span aria-hidden="true">{medal}</span> : null}
        <span className={medal ? 'sr-only' : ''}>#{e.rank}</span>
      </span>
      <span className="min-w-0 flex-1 truncate font-display text-base font-bold text-white sm:text-lg">
        {e.displayName}
        {e.isYou ? <span className="chip chip-lime ml-2 align-middle">you</span> : null}
      </span>
      <span className="text-right">
        <span className="font-display block text-lg font-black tabular-nums text-white">
          {formatAltitude(altitudeKm(e.totalPoints))}
        </span>
        <span className="block text-xs font-bold text-sky-100/80">{e.totalPoints} pts</span>
      </span>
    </li>
  );
}

export default function LeaderboardPage() {
  const [board, setBoard] = useState<LeaderboardDto | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .leaderboard()
      .then(setBoard)
      .catch((e: unknown) => setError(e instanceof Error ? e.message : 'Could not load the leaderboard.'));
  }, []);

  return (
    <Shell sphere={3} darkness={0.45}>
      <Card>
        <h1 className="font-display text-gradient-sky text-4xl font-black">Today{'\u2019'}s leaderboard</h1>
        <p className="mt-2 text-sm text-sky-100/90">
          Daily ranked climbs only, finished and scored. Equal scores share a rank. Practice never appears here.
        </p>
        <p className="mt-2 text-xs text-sky-100/75">
          Everyone is scored against the players who locked their answer before them, so an early player and a late
          player are not measured against exactly the same crowd. Tiers are estimates.
        </p>

        {error ? (
          <div className="mt-4">
            <Notice tone="error">{error}</Notice>
          </div>
        ) : null}
        {!board && !error ? (
          <p className="mt-6 font-display font-bold text-white" role="status">
            Loading{'\u2026'}
          </p>
        ) : null}

        {board ? (
          <>
            <p className="font-display mt-4 text-sm font-extrabold uppercase tracking-widest text-stratos-lime">
              {board.date} {'\u00B7'} {board.participants.toLocaleString('en-IN')} finished
            </p>
            {board.entries.length === 0 ? (
              <p className="mt-6 text-sky-50">Nobody has finished today{'\u2019'}s climb yet. Be the first.</p>
            ) : (
              <ol className="mt-4 space-y-2" aria-label="Top climbers today">
                {board.entries.map((e, i) => (
                  <Row key={`${e.rank}-${e.displayName}-${i}`} e={e} index={i} />
                ))}
              </ol>
            )}
            {board.you && !board.entries.some((e) => e.isYou) ? (
              <p className="mt-4 text-sm font-semibold text-sky-50">
                You are #{board.you.rank} with {board.you.totalPoints} points.
              </p>
            ) : null}
            {board.percentile === null && board.you ? (
              <p className="mt-2 text-xs text-sky-100/75">Too few climbers so far for a percentile.</p>
            ) : null}
          </>
        ) : null}
      </Card>
    </Shell>
  );
}
