'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import type { ActiveRoundDto } from '@/lib/types';
import { AtmosphereProgress } from './AtmosphereProgress';
import { CountdownTimer } from './CountdownTimer';
import { Button, Notice } from './ui';

export interface Feedback {
  tone: 'ok' | 'error' | 'info';
  text: string;
}

interface Props {
  round: ActiveRoundDto;
  total: number;
  left: number | null;
  /** The name of the layer of the atmosphere this question is asked in. */
  sphereName: string;
  feedback: Feedback | null;
  /** True while the lock request is in flight. Nothing is scored or shown until the server answers. */
  busy: boolean;
  onSubmit: (text: string) => void;
}

/**
 * One question: the focal point of the whole game. There is deliberately nothing here about how an
 * answer might score: no estimated tier, no points, no activity and no example answer. The first
 * answer the game can read locks the question, and the editable state only ends when the SERVER says
 * so (the parent swaps this card for the reveal once the round is no longer active).
 */
export function QuestionCard({ round, total, left, sphereName, feedback, busy, onSubmit }: Props) {
  const [text, setText] = useState('');
  const [shakeKey, setShakeKey] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const open = round.state === 'question_active' && (left === null || left > 0);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [round.roundId, open]);

  // A refused answer gives the field a small shake, so the feedback is felt as well as read.
  const refused = feedback?.tone === 'error';
  useEffect(() => {
    if (refused) setShakeKey((k) => k + 1);
  }, [refused, feedback?.text]);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!open || busy || text.trim() === '') return;
    onSubmit(text);
  };

  return (
    <section className="reveal-in" aria-labelledby="question-heading">
      <div className="card-arcade p-5 sm:p-8">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="font-display text-sm font-black uppercase tracking-[0.2em] text-stratos-lime">
              Question {round.questionIndex} of {total}
            </div>
            <div className="mt-1 font-display text-xs font-extrabold uppercase tracking-widest text-sky-100/80">
              {sphereName} {'\u00B7'} {round.question.category}
            </div>
          </div>
          <CountdownTimer left={left} />
        </div>

        <AtmosphereProgress current={round.questionIndex - 1} className="mt-5" />

        <h2
          id="question-heading"
          className="font-display mt-6 text-balance text-3xl font-black leading-tight text-white sm:text-4xl"
        >
          {round.question.prompt}
        </h2>
        <p className="mt-3 text-base text-sky-100/90">{round.question.qualifier}</p>

        <form onSubmit={submit} className="mt-6" noValidate>
          <label htmlFor="answer" className="sr-only">
            Your answer
          </label>
          <div key={shakeKey} className={shakeKey > 0 ? 'shake' : ''}>
            <input
              id="answer"
              ref={inputRef}
              value={text}
              onChange={(e) => setText(e.target.value)}
              readOnly={!open || busy}
              autoComplete="off"
              autoCapitalize="none"
              enterKeyHint="send"
              spellCheck={false}
              maxLength={200}
              aria-describedby="answer-help"
              aria-invalid={refused}
              placeholder={open ? 'Type your answer' : 'Time is up'}
              className="answer-input"
            />
          </div>
          <Button
            type="submit"
            variant="lock"
            large
            disabled={!open || busy || text.trim() === ''}
            className="mt-4 w-full"
          >
            {busy ? 'Locking\u2026' : 'Lock answer'}
          </Button>
          <p id="answer-help" className="mt-3 text-center text-xs text-sky-100/80">
            The first answer we can read ends the question. Small spelling slips are fixed for you.
          </p>
        </form>

        <div className="mt-4 min-h-[3rem]" aria-live="polite">
          {feedback ? <Notice tone={feedback.tone}>{feedback.text}</Notice> : null}
        </div>
      </div>
    </section>
  );
}
