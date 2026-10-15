'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Shell } from '@/components/Shell';
import { Card, Notice } from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import { altitudeKm, formatAltitude } from '@/lib/altitude';
import type { HistoryEntryDto } from '@/lib/types';

const STATE_LABEL: Record<HistoryEntryDto['state'], string> = {
  lobby: 'Not started',
  active: 'In progress',
  challenge_complete: 'Finished',
  abandoned: 'Left unfinished',
};

export default function HistoryPage() {
  const [items, setItems] = useState<HistoryEntryDto[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .history()
      .then(setItems)
      .catch((e: unknown) => {
        if (e instanceof ApiError && e.status === 401) setItems([]);
        else setError(e instanceof Error ? e.message : 'Could not load your history.');
      });
  }, []);

  return (
    <Shell sphere={2} darkness={0.3}>
      <Card>
        <h1 className="font-display text-gradient-sky text-4xl font-black">Your climbs</h1>
        <p className="mt-2 text-sm text-sky-100/90">
          Ranked daily climbs and practice climbs are kept apart. Practice never changes a ranked score.
        </p>
        {error ? (
          <div className="mt-4">
            <Notice tone="error">{error}</Notice>
          </div>
        ) : null}
        {items === null && !error ? (
          <p className="mt-6 font-display font-bold text-white" role="status">
            Loading{'\u2026'}
          </p>
        ) : null}
        {items && items.length === 0 ? (
          <p className="mt-6 text-sky-50">
            No climbs yet.{' '}
            <Link href="/" className="font-bold text-stratos-lime underline">
              Take your first
            </Link>
            .
          </p>
        ) : null}
        {items && items.length > 0 ? (
          <ul className="mt-4 space-y-2">
            {items.map((h, i) => {
              const href = h.state === 'challenge_complete' ? `/result/${h.sessionId}` : `/play/${h.mode}?s=${h.sessionId}`;
              return (
                <li key={h.sessionId} className="stage" style={{ animationDelay: `${Math.min(i, 12) * 40}ms` }}>
                  <Link
                    href={href}
                    className="flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-white/5 px-4 py-3 hover:bg-white/10"
                  >
                    <span>
                      <span className="font-display block text-lg font-black text-white">
                        {h.mode === 'daily' ? `Daily climb \u00B7 ${h.challengeDate}` : 'Practice climb'}
                      </span>
                      <span className="text-sm text-sky-100/80">{STATE_LABEL[h.state]}</span>
                    </span>
                    <span className="text-right">
                      <span className="font-display block text-lg font-black tabular-nums text-white">
                        {formatAltitude(altitudeKm(h.totalPoints))}
                      </span>
                      <span className="text-sm font-bold text-stratos-lime">{h.totalPoints} pts</span>
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        ) : null}
      </Card>
    </Shell>
  );
}
