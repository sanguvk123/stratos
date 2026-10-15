'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { api, ApiError, newRequestId } from '@/lib/api';
import { altitudeKm, darkness, sphereForQuestion } from '@/lib/altitude';
import { revealLevel } from '@/lib/altitude';
import { revealTimeline } from '@/lib/motion';
import type { SessionMode, SessionViewDto, SubmitRejection } from '@/lib/types';
import { useServerClock } from '@/lib/useServerClock';
import { AltitudeCounter } from './AltitudeCounter';
import { QuestionCard, type Feedback } from './QuestionCard';
import { RevealCard } from './RevealCard';
import { Shell } from './Shell';
import { Button, ButtonLink, Card, Notice } from './ui';

const REJECTION_COPY: Record<SubmitRejection, string> = {
  NO_MATCH: 'We could not read that as one of the answers for this question. Try again \u2014 the clock is still running.',
  EMPTY_INPUT: 'Type an answer first.',
  TOO_LONG: 'That answer is too long. Keep it under 200 characters.',
  AMBIGUOUS_TYPO: 'That could mean more than one answer. Try spelling it out in full.',
  ROUND_CLOSED: 'Time is up. This answer arrived after the deadline and was not counted.',
  ALREADY_ANSWERED: 'You have already locked an answer for this question.',
  TOO_MANY_ATTEMPTS: 'You have tried too many times on this question.',
};

/** The heads-up display: altitude (counting up when it changes) and the running score. */
function Hud({ view, delayMs }: { view: SessionViewDto; delayMs: number }) {
  return (
    <div className="mb-4 flex items-end justify-between gap-4 [text-shadow:0_2px_10px_rgba(3,5,40,0.7)]">
      <AltitudeCounter km={altitudeKm(view.totalPoints)} delayMs={delayMs} />
      <div className="text-right">
        <span className={`chip ${view.isRanked ? 'chip-lime' : 'chip-glass'}`}>
          {view.isRanked ? 'Daily climb \u00B7 ranked' : 'Practice \u00B7 unranked'}
        </span>
        <div className="mt-1 font-display text-sm font-extrabold uppercase tracking-widest text-white/90">
          {view.totalPoints} points
        </div>
      </div>
    </div>
  );
}

function Launchpad({ view, busy, onBegin }: { view: SessionViewDto; busy: boolean; onBegin: () => void }) {
  const daily = view.isRanked;
  return (
    <div className="reveal-in space-y-4">
      <div>
        <h1 className="font-display text-gradient-sky text-4xl font-black sm:text-5xl">Launchpad</h1>
        <p className="mt-2 max-w-xl text-sky-50">
          You are standing on the surface of the Earth. Seven questions take you up through the layers of the
          atmosphere and out into space.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <section className={`card-arcade p-5 ${daily ? 'ring-4 ring-stratos-lime/70' : 'opacity-90'}`}>
          <span className="chip chip-lime">Ranked</span>
          <h2 className="font-display mt-3 text-2xl font-black text-white">Daily Climb</h2>
          <p className="mt-1 text-sm text-sky-100/90">
            The same seven questions for everyone. One attempt a day, and the day resets at midnight UTC.
          </p>
          <div className="mt-4">
            {daily ? (
              <Button variant="primary" large className="w-full" disabled={busy} onClick={onBegin}>
                {busy ? 'Starting\u2026' : 'Start daily climb'}
              </Button>
            ) : (
              <ButtonLink href="/play/daily" variant="secondary" className="w-full">
                Switch to daily
              </ButtonLink>
            )}
          </div>
        </section>

        <section className={`card-arcade p-5 ${!daily ? 'ring-4 ring-stratos-cyan/70' : 'opacity-90'}`}>
          <span className="chip chip-glass">Unranked</span>
          <h2 className="font-display mt-3 text-2xl font-black text-white">Practice</h2>
          <p className="mt-1 text-sm text-sky-100/90">
            Fresh questions every time, scored against an earlier day{'\u2019'}s players. It never touches the leaderboard.
          </p>
          <div className="mt-4">
            {!daily ? (
              <Button variant="primary" large className="w-full" disabled={busy} onClick={onBegin}>
                {busy ? 'Starting\u2026' : 'Start practice'}
              </Button>
            ) : (
              <ButtonLink href="/play/practice" variant="secondary" className="w-full">
                Switch to practice
              </ButtonLink>
            )}
          </div>
        </section>
      </div>

      <ul className="grid gap-2 text-sm text-white sm:grid-cols-3 [text-shadow:0_1px_8px_rgba(3,5,40,0.7)]">
        <li className="card-arcade px-4 py-3">
          <b className="font-display">7 questions</b>
          <br />
          one answer each
        </li>
        <li className="card-arcade px-4 py-3">
          <b className="font-display">60 seconds</b>
          <br />
          starting when it appears
        </li>
        <li className="card-arcade px-4 py-3">
          <b className="font-display">Rarer = higher</b>
          <br />
          1 point is 1 km
        </li>
      </ul>
    </div>
  );
}

export function Dive({ mode, initialSessionId }: { mode: SessionMode; initialSessionId: string | null }) {
  const router = useRouter();
  const [view, setView] = useState<SessionViewDto | null>(null);
  const [fatal, setFatal] = useState<string | null>(null);
  const [offline, setOffline] = useState(false);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  // The launch that plays when an answer locks. It carries the round it belongs to, so a reload
  // (which has no boost) shows an old result without replaying anything.
  const [boost, setBoost] = useState<{ roundId: string; points: number; key: number; corrected: boolean } | null>(null);
  const pending = useRef<{ key: string; id: string } | null>(null);
  const loadedRef = useRef(false);

  const active = view?.activeRound ?? null;
  const { left, sync } = useServerClock(active ? active.closesAt : null);

  const apply = useCallback(
    (next: SessionViewDto) => {
      sync(next.serverNow);
      setView(next);
      setOffline(false);
      const url = new URL(window.location.href);
      if (url.searchParams.get('s') !== next.sessionId) {
        url.searchParams.set('s', next.sessionId);
        window.history.replaceState(null, '', url.toString());
      }
    },
    [sync],
  );

  const fail = useCallback((error: unknown) => {
    if (error instanceof ApiError && error.code === 'NETWORK') {
      setOffline(true);
      return;
    }
    setFatal(error instanceof Error ? error.message : 'Something went wrong.');
  }, []);

  // Load (or resume) once. A refresh lands back on the SAME session and the SAME deadline.
  useEffect(() => {
    if (loadedRef.current) return;
    loadedRef.current = true;
    (async () => {
      try {
        if (initialSessionId) {
          try {
            apply(await api.getSession(initialSessionId));
            return;
          } catch (error) {
            if (!(error instanceof ApiError) || (error.status !== 404 && error.status !== 401)) throw error;
          }
        }
        apply(await api.startSession(mode));
      } catch (error) {
        fail(error);
      }
    })();
  }, [apply, fail, initialSessionId, mode]);

  const sessionId = view?.sessionId ?? null;
  const awaitingFinalization = active !== null && left === 0;

  // Once the timer ends with nothing locked, poll until the server closes the round.
  useEffect(() => {
    if (!sessionId || !awaitingFinalization) return;
    const id = window.setInterval(async () => {
      try {
        apply(await api.getSession(sessionId));
      } catch (error) {
        fail(error);
      }
    }, 1_000);
    return () => window.clearInterval(id);
  }, [sessionId, awaitingFinalization, apply, fail]);

  // Reconnect: when the browser comes back online, resync from the server.
  useEffect(() => {
    if (!sessionId) return;
    const resync = async () => {
      try {
        apply(await api.getSession(sessionId));
      } catch (error) {
        fail(error);
      }
    };
    const onVisible = () => {
      if (document.visibilityState === 'visible') void resync();
    };
    window.addEventListener('online', resync);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.removeEventListener('online', resync);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [sessionId, apply, fail]);

  // Opening a climb that is already finished goes straight to its results. A climb finished just
  // now stays on the last reveal, so the final launch can be seen, and the player taps through.
  useEffect(() => {
    if (view?.state === 'challenge_complete' && boost === null) router.push(`/result/${view.sessionId}`);
  }, [view?.state, view?.sessionId, boost, router]);

  const issue = async (index: number) => {
    if (!sessionId) return;
    setBusy(true);
    setFeedback(null);
    setBoost(null);
    try {
      apply(await api.issueRound(sessionId, index));
    } catch (error) {
      if (error instanceof ApiError && (error.code === 'TOO_EARLY' || error.code === 'PREVIOUS_NOT_FINALIZED')) {
        setFeedback({ tone: 'info', text: 'One moment \u2014 the next question is not ready yet. Try again.' });
        apply(await api.getSession(sessionId).catch(() => view as SessionViewDto));
      } else {
        fail(error);
      }
    } finally {
      setBusy(false);
    }
  };

  const submit = async (text: string) => {
    if (!sessionId || !active) return;
    // Reuse the request id if this exact answer is being retried after a dropped connection, so a
    // replay can never be counted twice.
    const key = `${active.roundId}|${text}`;
    if (pending.current?.key !== key) pending.current = { key, id: newRequestId() };
    setBusy(true);
    try {
      const res = await api.submitAnswer(sessionId, {
        roundId: active.roundId,
        rawText: text,
        requestId: pending.current.id,
      });
      pending.current = null;
      if (res.accepted) {
        // The SERVER has locked the question and scored it. Only now do the reward effects start,
        // and every number they show is the one the server returned.
        setFeedback(null);
        setBoost({ roundId: res.result.roundId, points: res.result.points, key: Date.now(), corrected: res.corrected });
        apply(await api.getSession(sessionId));
      } else {
        setFeedback({ tone: 'error', text: REJECTION_COPY[res.reason] });
        if (res.reason === 'ROUND_CLOSED' || res.reason === 'ALREADY_ANSWERED') {
          apply(await api.getSession(sessionId));
        }
      }
    } catch (error) {
      if (error instanceof ApiError && error.code === 'RATE_LIMITED') {
        setFeedback({ tone: 'error', text: 'Slow down a little and try again.' });
      } else if (error instanceof ApiError && error.code === 'NETWORK') {
        setOffline(true);
        setFeedback({ tone: 'error', text: 'Connection lost. Your answer was not confirmed \u2014 lock it again.' });
      } else {
        fail(error);
      }
    } finally {
      setBusy(false);
    }
  };

  if (fatal) {
    return (
      <Shell>
        <Card>
          <h1 className="font-display text-2xl font-black text-white">Turbulence</h1>
          <div className="mt-3">
            <Notice tone="error">{fatal}</Notice>
          </div>
          <div className="mt-5">
            <Button variant="primary" onClick={() => window.location.reload()}>
              Try again
            </Button>
          </div>
        </Card>
      </Shell>
    );
  }
  if (!view) {
    return (
      <Shell>
        <Card>
          <p className="font-display text-xl font-black text-white" role="status">
            Fuelling the rocket{'\u2026'}
          </p>
        </Card>
      </Shell>
    );
  }

  // Each question is asked in its own layer of the atmosphere. Between questions the sky is already
  // the NEXT layer, so answering visibly lifts you up.
  const lastResult = view.results[view.results.length - 1] ?? null;
  const sphereIndex = active ? active.questionIndex - 1 : Math.min(view.issued, view.questionCount - 1);
  const sphere = sphereForQuestion(sphereIndex);
  const nextIndex = view.issued + 1;
  const justLocked = boost !== null && lastResult !== null && boost.roundId === lastResult.roundId;
  const hudDelay = justLocked && boost ? revealTimeline(revealLevel(boost.points)).pointsMs + 400 : 0;
  const nextSphere = view.issued < view.questionCount ? sphereForQuestion(view.issued) : null;

  return (
    <Shell
      sphere={sphereIndex}
      darkness={darkness(sphereIndex, view.totalPoints)}
      boostPoints={boost?.points ?? null}
      boostKey={boost?.key ?? 0}
    >
      {view.state !== 'lobby' ? <Hud view={view} delayMs={hudDelay} /> : null}

      {offline ? (
        <div className="mb-4">
          <Notice tone="error">You are offline. Reconnecting{'\u2026'} Your timer is kept by the server.</Notice>
        </div>
      ) : null}

      {view.state === 'abandoned' ? (
        <Card>
          <h1 className="font-display text-2xl font-black text-white">This climb was left unfinished</h1>
          <p className="mt-3 text-sky-50">It sat idle too long and was closed. Questions you had not reached scored 0.</p>
          <div className="mt-5">
            <ButtonLink href="/play/practice" variant="primary">
              Try a practice climb
            </ButtonLink>
          </div>
        </Card>
      ) : view.state === 'lobby' ? (
        <Launchpad view={view} busy={busy} onBegin={() => issue(1)} />
      ) : active && !awaitingFinalization ? (
        <QuestionCard
          key={active.roundId}
          round={active}
          total={view.questionCount}
          left={left}
          sphereName={sphere.name}
          feedback={feedback}
          busy={busy}
          onSubmit={submit}
        />
      ) : active ? (
        <Card>
          <h2 className="font-display text-2xl font-black text-white">Time is up</h2>
          <p className="mt-3 text-sky-50" role="status">
            Closing this question{'\u2026'}
          </p>
        </Card>
      ) : lastResult ? (
        <div className="space-y-5">
          <RevealCard
            key={lastResult.roundId}
            result={lastResult}
            total={view.questionCount}
            corrected={justLocked && boost !== null && boost.corrected}
            animate={justLocked}
          />
          <div className="flex flex-wrap items-center gap-4">
            {view.state === 'challenge_complete' ? (
              <Button variant="primary" large onClick={() => router.push(`/result/${view.sessionId}`)}>
                See your climb
              </Button>
            ) : (
              // No timer and never disabled by one: the player moves on when they are ready.
              <Button variant="primary" large disabled={busy} onClick={() => issue(nextIndex)}>
                {busy ? 'Climbing\u2026' : nextSphere ? `Climb to the ${nextSphere.name}` : 'Next question'}
              </Button>
            )}
            <span className="font-display text-sm font-extrabold uppercase tracking-widest text-white [text-shadow:0_1px_8px_rgba(3,5,40,0.7)]">
              {view.issued} of {view.questionCount} done
            </span>
          </div>
          {feedback ? <Notice tone={feedback.tone}>{feedback.text}</Notice> : null}
        </div>
      ) : null}
    </Shell>
  );
}
