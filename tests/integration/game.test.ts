import { describe, expect, it } from 'vitest';
import { matchAnswer } from '@/domain/normalization';
import { computeCohortCounts, scoreAnsweredPlayer, TIER_POINTS, type CohortRow } from '@/domain/scoring';
import { GAME } from '@/server/config';
import { getAnswerIndex, getQuestion, QUESTION_BANK } from '@/server/content/questions';
import { openDb, type Db } from '@/server/db';
import { GameError } from '@/server/game/errors';
import { Game } from '@/server/game/game';
import { createPlayer } from '@/server/game/players';
import { finalCohortCounts } from '@/server/game/population';
import { dailyQuestionIds } from '@/server/game/selection';
import { dateKey } from '@/server/game/util';

const BASE = Date.UTC(2026, 9, 15, 12, 0, 0);
const WINDOW = 60_000 + GAME.finalizeGraceMs + 1;

function env() {
  const db = openDb(':memory:');
  let t = BASE;
  const game = new Game(db, () => t);
  return {
    db,
    game,
    advance: (ms: number) => {
      t += ms;
    },
    set: (ms: number) => {
      t = ms;
    },
    now: () => t,
    player: () => createPlayer(db, t).playerId,
  };
}
type Env = ReturnType<typeof env>;

const questionIds = (date = dateKey(BASE)) => dailyQuestionIds(date);
const answerText = (qid: string, index = 0) => getQuestion(qid).answers[index]!.text;
const rareAnswerText = (qid: string) => getQuestion(qid).answers.at(-1)!.text;
let counter = 0;
const rid = () => `req-${++counter}-${Math.random().toString(36).slice(2, 10)}`;
const count = (e: Env, table: string) =>
  (e.db.get<{ n: number }>(`SELECT COUNT(*) AS n FROM ${table}`) as { n: number }).n;

function begin(e: Env, playerId: string, index = 1) {
  const started = e.game.startSession(playerId, 'daily');
  return e.game.issueRound(playerId, started.sessionId, index);
}

function submit(e: Env, playerId: string, view: ReturnType<typeof begin>, rawText: string, requestId = rid()) {
  return e.game.submitAnswer(playerId, view.sessionId, {
    roundId: view.activeRound!.roundId,
    rawText,
    requestId,
  });
}

/** An answer of this question that is long enough to be spell-corrected, and a misspelling of it. */
function misspelled(qid: string) {
  const index = getAnswerIndex(qid);
  for (const answer of getQuestion(qid).answers) {
    const chars = Array.from(answer.text);
    if (chars.length < 8) continue;
    const typo = [...chars.slice(0, 3), ...chars.slice(4)].join(''); // one letter missing
    const match = matchAnswer(typo, index);
    if (match.ok && match.canonicalAnswerId === answer.id && match.matchedVia === 'typo_correction') {
      return { answer, typo };
    }
  }
  throw new Error(`no misspellable answer for ${qid}`);
}

/** Plays a full ranked climb. `pick(questionId, questionIndex)` returns the answer text or null. */
function playDive(e: Env, playerId: string, pick: (qid: string, index: number) => string | null) {
  let view = e.game.startSession(playerId, 'daily');
  for (let i = 1; i <= 7; i += 1) {
    view = e.game.issueRound(playerId, view.sessionId, i);
    const round = view.activeRound!;
    const text = pick(round.question.id, i);
    if (text !== null) {
      e.game.submitAnswer(playerId, view.sessionId, { roundId: round.roundId, rawText: text, requestId: rid() });
    } else {
      e.advance(WINDOW);
    }
    view = e.game.getView(playerId, view.sessionId);
    if (i < 7) e.advance(GAME.revealWindowMs + 1);
  }
  return view;
}

function expectCode(fn: () => unknown, code: string) {
  try {
    fn();
  } catch (error) {
    expect(error).toBeInstanceOf(GameError);
    expect((error as GameError).code).toBe(code);
    return;
  }
  expect.unreachable(`expected GameError ${code}`);
}

describe('daily challenge setup', () => {
  it('gives every player the same seven ordered questions, fixed by the date', () => {
    const e = env();
    const a = e.game.startSession(e.player(), 'daily');
    const b = e.game.startSession(e.player(), 'daily');
    const rowsA = JSON.parse(e.db.get<{ question_ids: string }>('SELECT question_ids FROM sessions WHERE id = ?', a.sessionId)!.question_ids);
    const rowsB = JSON.parse(e.db.get<{ question_ids: string }>('SELECT question_ids FROM sessions WHERE id = ?', b.sessionId)!.question_ids);
    expect(rowsA).toHaveLength(7);
    expect(rowsA).toEqual(rowsB);
    expect(rowsA).toEqual(questionIds());
    expect(new Set(rowsA).size).toBe(7);
  });

  it('returns the same session on a repeat start: one ranked attempt per player per day', () => {
    const e = env();
    const p = e.player();
    expect(e.game.startSession(p, 'daily').sessionId).toBe(e.game.startSession(p, 'daily').sessionId);
    expect((e.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM sessions WHERE player_id = ?', p) as { n: number }).n).toBe(1);
  });

  it('starts a different challenge on a different UTC day', () => {
    const e = env();
    const p = e.player();
    const first = e.game.startSession(p, 'daily');
    e.advance(24 * 3600 * 1000);
    const second = e.game.startSession(p, 'daily');
    expect(second.sessionId).not.toBe(first.sessionId);
    expect(second.challengeDate).not.toBe(first.challengeDate);
  });
});

describe('round issuance is idempotent and the clock cannot be restarted (§4.6)', () => {
  it('stamps a 60 second deadline at issuance and returns the same round on every retry', () => {
    const e = env();
    const p = e.player();
    const first = begin(e, p);
    e.advance(2_000);
    const retry = e.game.issueRound(p, first.sessionId, 1);
    e.advance(5_000);
    const again = e.game.issueRound(p, first.sessionId, 1);
    for (const v of [retry, again]) {
      expect(v.activeRound!.roundId).toBe(first.activeRound!.roundId);
      expect(v.activeRound!.servedAt).toBe(first.activeRound!.servedAt);
      expect(v.activeRound!.closesAt).toBe(first.activeRound!.closesAt);
    }
    expect(first.activeRound!.closesAt - first.activeRound!.servedAt).toBe(60_000);
    expect(count(e, 'rounds')).toBe(1);
  });

  it('keeps the original deadline when a reconnecting client asks for the state', () => {
    const e = env();
    const p = e.player();
    const first = begin(e, p);
    e.advance(30_000);
    const view = e.game.getView(p, first.sessionId);
    expect(view.activeRound!.closesAt).toBe(first.activeRound!.closesAt);
    expect(view.serverNow - view.activeRound!.servedAt).toBe(30_000);
  });

  it('never reopens a round after its deadline: a late retry gets the closed round, not a new one', () => {
    const e = env();
    const p = e.player();
    const first = begin(e, p);
    e.advance(WINDOW + 5_000);
    const view = e.game.issueRound(p, first.sessionId, 1);
    expect(view.results).toHaveLength(1);
    expect(view.activeRound).toBeNull();
    expect(count(e, 'rounds')).toBe(1);
  });

  it('refuses to skip ahead, and refuses the next question before the previous result is in', () => {
    const e = env();
    const p = e.player();
    const first = begin(e, p);
    expectCode(() => e.game.issueRound(p, first.sessionId, 3), 'OUT_OF_ORDER');
    expectCode(() => e.game.issueRound(p, first.sessionId, 2), 'PREVIOUS_NOT_FINALIZED');
    expectCode(() => e.game.issueRound(p, first.sessionId, 99), 'INVALID_INDEX');
  });

  it('has no enforced pause after a result: the next question is available at once, on the button', () => {
    expect(GAME.revealWindowMs).toBe(0);
    const e = env();
    const p = e.player();
    const first = begin(e, p);
    expect(submit(e, p, first, answerText(first.activeRound!.question.id)).accepted).toBe(true);
    const view = e.game.getView(p, first.sessionId);
    expect(view.activeRound).toBeNull();
    // Nothing to wait for: the button is never disabled and shows no countdown.
    expect(view.nextAvailableAt).not.toBeNull();
    expect(view.nextAvailableAt as number).toBeLessThanOrEqual(view.serverNow);
    expect(e.game.issueRound(p, first.sessionId, 2).activeRound!.questionIndex).toBe(2);
  });

  it('still refuses the next question while the previous one is open (the clock cannot be skipped)', () => {
    const e = env();
    const p = e.player();
    const first = begin(e, p);
    expectCode(() => e.game.issueRound(p, first.sessionId, 2), 'PREVIOUS_NOT_FINALIZED');
  });
});

describe('the first answer we can read locks the question', () => {
  it('accepts a valid answer, locks the round at once and returns the FINAL tier and points', () => {
    const e = env();
    const p = e.player();
    const view = begin(e, p);
    const qid = view.activeRound!.question.id;
    e.advance(10_000);
    const res = submit(e, p, view, answerText(qid));
    expect(res.accepted).toBe(true);
    if (!res.accepted) return;
    expect(res.corrected).toBe(false);
    expect(res.answerText).toBe(answerText(qid));
    expect(res.result.points).toBe(TIER_POINTS[res.result.tier!]);
    expect(res.result.answerText).toBe(answerText(qid));

    // Locked AND scored in the same step: no waiting for a timer.
    expect(count(e, 'candidates')).toBe(1);
    expect(count(e, 'scores')).toBe(1);
    const round = e.db.get<{ state: string; served_at: number; closes_at: number; answered_at: number }>('SELECT * FROM rounds')!;
    expect(round.state).toBe('reveal');
    expect(round.answered_at).toBe(BASE + 10_000);
    expect(round.closes_at).toBe(round.answered_at); // the question ended when the answer arrived
    expect(round.closes_at).toBeLessThan(round.served_at + 60_000);

    const after = e.game.getView(p, view.sessionId);
    expect(after.activeRound).toBeNull();
    expect(after.results).toHaveLength(1);
    expect(after.results[0]).toEqual(res.result);
    expect(after.nextAvailableAt).toBe(BASE + 10_000 + GAME.revealWindowMs);
  });

  it('does not allow a second answer: the lock is final and the score does not change', () => {
    const e = env();
    const p = e.player();
    const view = begin(e, p);
    const qid = view.activeRound!.question.id;
    const first = submit(e, p, view, answerText(qid, 0));
    const second = submit(e, p, view, answerText(qid, 1));
    expect(second).toEqual({ accepted: false, reason: 'ALREADY_ANSWERED' });
    expect(count(e, 'candidates')).toBe(1);
    expect(count(e, 'scores')).toBe(1);
    expect(e.db.get<{ canonical_id: string }>('SELECT canonical_id FROM candidates')!.canonical_id).toBe(getQuestion(qid).answers[0]!.id);
    if (first.accepted) expect(e.game.getView(p, view.sessionId).results[0]).toEqual(first.result);
  });

  it('corrects a misspelling, says so, and scores the answer it was read as', () => {
    const e = env();
    const p = e.player();
    const view = begin(e, p);
    const qid = view.activeRound!.question.id;
    const { answer, typo } = misspelled(qid);
    const res = submit(e, p, view, typo);
    expect(res.accepted).toBe(true);
    if (!res.accepted) return;
    expect(res.corrected).toBe(true);
    expect(res.answerText).toBe(answer.text);
    expect(e.db.get<{ canonical_id: string; matched_via: string }>('SELECT * FROM candidates')).toMatchObject({
      canonical_id: answer.id,
      matched_via: 'typo_correction',
    });
    // A corrected answer is the SAME vote as the correctly spelt one: one canonical answer.
    expect(e.db.get<{ canonical_id: string }>('SELECT canonical_id FROM final_answers')!.canonical_id).toBe(answer.id);
  });

  it('maps aliases to the same canonical answer and does not call that a correction', () => {
    const e = env();
    const p = e.player();
    const view = begin(e, p);
    const qid = view.activeRound!.question.id;
    const answer = getQuestion(qid).answers.find((a) => a.aliases.length > 0);
    if (!answer) return;
    const res = submit(e, p, view, answer.aliases[0]!);
    expect(res).toMatchObject({ accepted: true, answerText: answer.text, corrected: false });
  });

  it('does not lock on an answer it cannot read, and the player may try again', () => {
    const e = env();
    const p = e.player();
    const view = begin(e, p);
    const qid = view.activeRound!.question.id;
    for (const junk of ['', '   ', 'zzz qqq', 'x'.repeat(201)]) {
      expect(submit(e, p, view, junk).accepted).toBe(false);
    }
    expect(count(e, 'candidates')).toBe(0);
    expect(count(e, 'scores')).toBe(0);
    expect(e.game.getView(p, view.sessionId).activeRound!.state).toBe('question_active');
    expect(submit(e, p, view, answerText(qid))).toMatchObject({ accepted: true });
  });

  it('shows nothing about scoring while the question is open: no tier, no points, no activity, no hint', () => {
    const e = env();
    const others = [e.player(), e.player(), e.player()];
    const p = e.player();
    const view = begin(e, p);
    const qid = view.activeRound!.question.id;
    others.forEach((o) => {
      const v = begin(e, o);
      submit(e, o, v, answerText(qid, 0));
    });
    const live = e.game.getView(p, view.sessionId);
    expect(Object.keys(live.activeRound!).sort()).toEqual(['closesAt', 'question', 'questionIndex', 'roundId', 'servedAt', 'state']);
    expect(Object.keys(live.activeRound!.question).sort()).toEqual(['category', 'id', 'prompt', 'qualifier']);
    const json = JSON.stringify(live);
    for (const forbidden of [
      'provisional', 'candidate', 'activity', 'example', 'tier', 'points:',
      'cPrior', 'nPrior', 'c_prior', 'n_prior', 'numerator', 'denominator', 'priorPpm', 'prior_ppm', 'percent',
    ]) {
      expect(json, forbidden).not.toContain(forbidden);
    }
    expect(json).not.toContain(answerText(qid, 0) + '"'); // other players' answers are never echoed
  });

  it('is idempotent by request id, and rejects a reused id with a different answer', () => {
    const e = env();
    const p = e.player();
    const view = begin(e, p);
    const qid = view.activeRound!.question.id;
    const request = 'request-idempotent-1';
    const first = submit(e, p, view, answerText(qid, 0), request);
    const replay = submit(e, p, view, answerText(qid, 0), request);
    expect(replay).toEqual(first);
    expect(count(e, 'submissions')).toBe(1);
    expectCode(() => submit(e, p, view, answerText(qid, 1), request), 'REQUEST_ID_CONFLICT');
    expect(count(e, 'candidates')).toBe(1);
    expect(count(e, 'scores')).toBe(1);
  });

  it('serves the stored response to a replay even long after the question ended', () => {
    const e = env();
    const p = e.player();
    const view = begin(e, p);
    const qid = view.activeRound!.question.id;
    const request = 'request-replay-late';
    const first = submit(e, p, view, answerText(qid), request);
    e.advance(WINDOW + 1_000);
    expect(submit(e, p, view, answerText(qid), request)).toEqual(first);
  });

  it('refuses an answer at exactly the deadline and after it, whatever the client thinks', () => {
    const e = env();
    const p = e.player();
    const view = begin(e, p);
    const qid = view.activeRound!.question.id;
    e.set(view.activeRound!.closesAt);
    expect(submit(e, p, view, answerText(qid))).toEqual({ accepted: false, reason: 'ROUND_CLOSED' });
    e.advance(500);
    expect(submit(e, p, view, answerText(qid, 1))).toEqual({ accepted: false, reason: 'ROUND_CLOSED' });
    expect(count(e, 'candidates')).toBe(0);

    // One millisecond before the deadline is still in time.
    const q = env();
    const pq = q.player();
    const v2 = begin(q, pq);
    q.set(v2.activeRound!.closesAt - 1);
    expect(submit(q, pq, v2, answerText(v2.activeRound!.question.id))).toMatchObject({ accepted: true });
  });

  it('refuses a round that belongs to another player', () => {
    const e = env();
    const a = e.player();
    const b = e.player();
    const view = begin(e, a);
    const other = e.game.startSession(b, 'daily');
    expectCode(
      () =>
        e.game.submitAnswer(b, other.sessionId, {
          roundId: view.activeRound!.roundId,
          rawText: 'x',
          requestId: rid(),
        }),
      'NOT_FOUND',
    );
    expectCode(() => e.game.getView(b, view.sessionId), 'NOT_FOUND');
    expectCode(() => e.game.issueRound(b, view.sessionId, 1), 'NOT_FOUND');
  });

  it('rate-limits a flood of answers the game cannot read', () => {
    const flood = env();
    const fp = flood.player();
    const fv = begin(flood, fp);
    let limited = false;
    for (let i = 0; i < GAME.answerRequestsPerMinute + 5; i += 1) {
      try {
        submit(flood, fp, fv, `zzz junk ${i}`);
      } catch (error) {
        limited = (error as GameError).code === 'RATE_LIMITED';
        break;
      }
    }
    expect(limited).toBe(true);
  });
});

describe('finalization and the rolling cohort (§7.6, §18.3, amended)', () => {
  it('records the score provenance when the answer locks, and finalizing again changes nothing', () => {
    const e = env();
    const p = e.player();
    const view = begin(e, p);
    const qid = view.activeRound!.question.id;
    submit(e, p, view, answerText(qid));
    const roundId = view.activeRound!.roundId;

    expect(e.game.finalizeRound(roundId)).toBe('already_finalized');
    e.advance(WINDOW);
    expect(e.game.finalizeRound(roundId)).toBe('already_finalized');

    expect(count(e, 'scores')).toBe(1);
    expect(count(e, 'final_answers')).toBe(1);
    const score = e.db.get<Record<string, number | string | null>>('SELECT * FROM scores')!;
    expect(score).toMatchObject({
      scoring_config_version: GAME.scoring.version,
      alpha: GAME.scoring.alpha,
      c_prior: 0,
      n_prior: 0,
      cohort_sequence: 1,
      normalization_version: 2,
      depth_m: Number(score.points) * 10,
    });
    expect(score.p_numerator).not.toBeNull();
    expect(score.p_denominator).not.toBeNull();
  });

  it('scores an unanswered question as zero with no vote, once its 60 seconds are up', () => {
    const e = env();
    const p = e.player();
    const view = begin(e, p);
    expect(e.game.finalizeRound(view.activeRound!.roundId)).toBe('not_yet_closed');
    e.advance(WINDOW);
    expect(e.game.finalizeRound(view.activeRound!.roundId)).toBe('finalized');
    const score = e.db.get<{ points: number; tier: number | null; canonical_id: string | null }>('SELECT * FROM scores')!;
    expect(score).toMatchObject({ points: 0, tier: null, canonical_id: null });
    expect(e.db.get<{ canonical_id: string | null }>('SELECT * FROM final_answers')!.canonical_id).toBeNull();
  });

  it('orders the cohort by when answers were locked, not by when questions were issued', () => {
    const e = env();
    const a = e.player();
    const b = e.player();
    const va = begin(e, a); // A is served first...
    e.advance(1_000);
    const vb = begin(e, b);
    const qid = va.activeRound!.question.id;
    e.advance(1_000);
    submit(e, b, vb, answerText(qid, 0)); // ...but B answers first
    e.advance(1_000);
    submit(e, a, va, answerText(qid, 0));

    const rows = e.db.all<{ round_id: string; c_prior: number; n_prior: number; cohort_sequence: number }>(
      'SELECT round_id, c_prior, n_prior, cohort_sequence FROM scores ORDER BY cohort_sequence',
    );
    expect(rows.map((r) => r.round_id)).toEqual([vb.activeRound!.roundId, va.activeRound!.roundId]);
    expect(rows[0]).toMatchObject({ c_prior: 0, n_prior: 0, cohort_sequence: 1 });
    // A was scored against B's earlier answer: one earlier answer, and it matched.
    expect(rows[1]).toMatchObject({ c_prior: 1, n_prior: 1, cohort_sequence: 2 });
  });

  it('never makes an answer wait for someone who has not answered yet', () => {
    const e = env();
    const a = e.player();
    const b = e.player();
    const va = begin(e, a); // never answers
    e.advance(1_000);
    const vb = begin(e, b);
    const res = submit(e, b, vb, answerText(vb.activeRound!.question.id));
    expect(res.accepted).toBe(true); // scored on the spot
    const scoreB = e.db.get<{ n_prior: number; c_prior: number }>('SELECT * FROM scores WHERE round_id = ?', vb.activeRound!.roundId)!;
    expect(scoreB).toMatchObject({ n_prior: 0, c_prior: 0 });

    // A's round closes later, casts no vote, and changes nobody's score.
    e.advance(WINDOW + 1_000);
    expect(e.game.finalizeRound(va.activeRound!.roundId)).toBe('finalized');
    const after = e.db.get<{ n_prior: number; c_prior: number; points: number }>('SELECT * FROM scores WHERE round_id = ?', vb.activeRound!.roundId)!;
    expect(after).toMatchObject({ n_prior: 0, c_prior: 0 });
  });

  it('finalizes every unanswered question that is due, from any ordinary request', () => {
    const e = env();
    const players = [e.player(), e.player(), e.player()];
    players.forEach((p, i) => {
      e.advance(500 * i);
      begin(e, p);
    });
    e.advance(WINDOW + 2_000);
    e.game.leaderboard(null); // any request triggers the sweep
    expect(count(e, 'scores')).toBe(3);
    const seqs = e.db.all<{ cohort_sequence: number }>('SELECT cohort_sequence FROM scores ORDER BY cohort_sequence');
    expect(seqs.map((s) => s.cohort_sequence)).toEqual([1, 2, 3]);
  });

  it('is deterministic: the SQL cohort counts equal the domain function on the same data (§7.12)', () => {
    const e = env();
    const picks = [0, 0, 1, 0, 2, 1, 0, 3];
    const views = picks.map((pick, i) => {
      e.advance(i * 40);
      const p = e.player();
      const v = begin(e, p);
      submit(e, p, v, answerText(v.activeRound!.question.id, pick));
      return v;
    });
    e.game.leaderboard(null);

    const cohort = `${dateKey(BASE)}:${views[0]!.activeRound!.question.id}`;
    const rows = e.db.all<{ cohort_sequence: number; canonical_id: string | null }>(
      'SELECT cohort_sequence, canonical_id FROM final_answers WHERE cohort_key = ?',
      cohort,
    );
    const domainRows: CohortRow[] = rows.map((r) => ({ cohortSequence: r.cohort_sequence, canonicalAnswerId: r.canonical_id, inCohort: true }));
    const qid = views[0]!.activeRound!.question.id;
    for (const answer of getQuestion(qid).answers.slice(0, 4)) {
      for (const seq of [1, 3, 5, 9]) {
        expect(finalCohortCounts(e.db, cohort, seq, answer.id)).toEqual(computeCohortCounts(domainRows, seq, answer.id));
      }
    }
    // And the stored score for every round is reproducible from the stored integers alone.
    for (const row of e.db.all<{ canonical_id: string; prior_ppm: number; c_prior: number; n_prior: number; points: number; p_numerator: string; p_denominator: string }>(
      'SELECT * FROM scores WHERE canonical_id IS NOT NULL',
    )) {
      const redo = scoreAnsweredPlayer({ cPrior: row.c_prior, nPrior: row.n_prior, priorPpm: row.prior_ppm }, GAME.scoring);
      expect(redo.points).toBe(row.points);
      expect(redo.numerator.toString()).toBe(row.p_numerator);
      expect(redo.denominator.toString()).toBe(row.p_denominator);
    }
  });

  it('counts the player exactly once: c_prior and n_prior never include their own answer', () => {
    const e = env();
    const players = [e.player(), e.player(), e.player()];
    const views = players.map((p, i) => {
      e.advance(i * 10);
      return begin(e, p);
    });
    const qid = views[0]!.activeRound!.question.id;
    views.forEach((v, i) => submit(e, players[i]!, v, answerText(qid, 0)));
    const rows = e.db.all<{ n_prior: number; c_prior: number }>('SELECT n_prior, c_prior FROM scores ORDER BY cohort_sequence');
    expect(rows).toEqual([
      { n_prior: 0, c_prior: 0 },
      { n_prior: 1, c_prior: 1 },
      { n_prior: 2, c_prior: 2 },
    ]);
  });
});

describe('a full ranked climb', () => {
  it('completes seven questions, sums the scores, and keeps depth at 10 per point', () => {
    const e = env();
    const p = e.player();
    const final = playDive(e, p, (qid) => answerText(qid, 0));
    expect(final.state).toBe('challenge_complete');
    expect(final.results).toHaveLength(7);
    const sum = final.results.reduce((s, r) => s + r.points, 0);
    expect(final.totalPoints).toBe(sum);
    expect(final.depthM).toBe(sum * 10);
    for (const r of final.results) {
      expect(r.depthM).toBe(r.points * 10);
      expect(r.tier === null ? 0 : TIER_POINTS[r.tier]).toBe(r.points);
    }
    const result = e.game.getFinalResult(p, final.sessionId);
    expect(result.totalPoints).toBe(sum);
    expect(result.maxPoints).toBe(700);
    expect(result.shareText).toContain(`${sum} pts`);
    expect(result.shareText).toContain('climbed');
  });

  it('finishes the moment the seventh answer locks, without waiting for any timer', () => {
    const e = env();
    const p = e.player();
    let view = e.game.startSession(p, 'daily');
    for (let i = 1; i <= 7; i += 1) {
      view = e.game.issueRound(p, view.sessionId, i);
      const res = e.game.submitAnswer(p, view.sessionId, {
        roundId: view.activeRound!.roundId,
        rawText: answerText(view.activeRound!.question.id),
        requestId: rid(),
      });
      expect(res.accepted).toBe(true);
      if (i < 7) e.advance(GAME.revealWindowMs + 1);
    }
    expect(e.game.getView(p, view.sessionId).state).toBe('challenge_complete');
  });

  it('keeps a completed attempt: a refresh or a second start returns it and cannot replay it', () => {
    const e = env();
    const p = e.player();
    const final = playDive(e, p, (qid) => answerText(qid, 0));
    const again = e.game.startSession(p, 'daily');
    expect(again.sessionId).toBe(final.sessionId);
    expect(again.state).toBe('challenge_complete');
    expect(again.totalPoints).toBe(final.totalPoints);
    expectCode(() => e.game.issueRound(p, final.sessionId, 1) && e.game.issueRound(p, final.sessionId, 8), 'INVALID_INDEX');
    expect(e.game.getView(p, final.sessionId).totalPoints).toBe(final.totalPoints);
  });

  it('scores zero for questions left unanswered, and the climb still completes', () => {
    const e = env();
    const p = e.player();
    const final = playDive(e, p, () => null);
    expect(final.state).toBe('challenge_complete');
    expect(final.totalPoints).toBe(0);
    expect(final.results.every((r) => r.points === 0 && r.tier === null && r.answerText === null)).toBe(true);
  });

  it('hides the share text details: tiers and totals only, never an answer or a question', () => {
    const e = env();
    const p = e.player();
    const final = playDive(e, p, (qid) => answerText(qid, 0));
    const share = e.game.getFinalResult(p, final.sessionId).shareText;
    for (const r of final.results) {
      expect(share).not.toContain(r.prompt);
      if (r.answerText) expect(share).not.toContain(r.answerText);
    }
  });

  it('refuses the final result until the climb is complete', () => {
    const e = env();
    const p = e.player();
    const view = begin(e, p);
    expectCode(() => e.game.getFinalResult(p, view.sessionId), 'NOT_FINALIZED');
  });
});

describe('what the client may see (§18.10)', () => {
  it('shows the popularity statistic only on a finalized result, and suppresses it for a small cohort', () => {
    const e = env();
    const p = e.player();
    const final = playDive(e, p, (qid) => answerText(qid, 0));
    for (const r of final.results) expect(r.popularity).toEqual({ kind: 'suppressed' });
  });

  it('refuses a round result before the round is finalized', () => {
    const e = env();
    const p = e.player();
    const view = begin(e, p);
    expectCode(() => e.game.getRoundResult(p, view.sessionId, view.activeRound!.roundId), 'NOT_FINALIZED');
  });

  it('hands the result of a locked round to the player who locked it', () => {
    const e = env();
    const p = e.player();
    const view = begin(e, p);
    const res = submit(e, p, view, answerText(view.activeRound!.question.id));
    expect(res.accepted).toBe(true);
    if (!res.accepted) return;
    expect(e.game.getRoundResult(p, view.sessionId, view.activeRound!.roundId)).toEqual(res.result);
  });

  it('reports a round past its deadline as closing even before any worker has finalized it', () => {
    const e = env();
    const p = e.player();
    const view = begin(e, p);
    e.set(view.activeRound!.closesAt);
    expect(e.game.getView(p, view.sessionId).activeRound!.state).toBe('question_closing');
  });
});

describe('practice mode (§4B, §18.9)', () => {
  it('lets a player start as many practice climbs as they like, each with seven questions', () => {
    const e = env();
    const p = e.player();
    const a = e.game.startSession(p, 'practice');
    const b = e.game.startSession(p, 'practice');
    expect(a.sessionId).not.toBe(b.sessionId);
    expect(a.isRanked).toBe(false);
    expect(a.mode).toBe('practice');
  });

  it('never repeats a question inside one session, and uses every eligible question before repeating any', () => {
    const e = env();
    const p = e.player();
    // Eligible practice questions are the whole bank minus today's seven daily questions.
    const eligible = QUESTION_BANK.length - 7;
    const seen: string[] = [];
    for (let s = 0; s < 3; s += 1) {
      const started = e.game.startSession(p, 'practice');
      const ids = JSON.parse(e.db.get<{ question_ids: string }>('SELECT question_ids FROM sessions WHERE id = ?', started.sessionId)!.question_ids) as string[];
      expect(new Set(ids).size).toBe(7);
      seen.push(...ids);
      // Play it, so the question counts as used.
      for (let i = 1; i <= 7; i += 1) {
        e.game.issueRound(p, started.sessionId, i);
        e.advance(WINDOW);
        e.game.getView(p, started.sessionId);
        e.advance(GAME.revealWindowMs + 1);
      }
    }
    // Three sessions draw 21 questions from the eligible pool. The first `eligible` draws must all
    // be different (the pool is exhausted before any repeat), and only then may questions repeat.
    expect(new Set(seen.slice(0, eligible)).size).toBe(eligible);
    expect(new Set(seen).size).toBe(eligible);
    expect(seen).toHaveLength(21);
  });

  it('holds back today\u2019s daily questions so practice cannot leak them', () => {
    const e = env();
    const p = e.player();
    const started = e.game.startSession(p, 'practice');
    const ids = JSON.parse(e.db.get<{ question_ids: string }>('SELECT question_ids FROM sessions WHERE id = ?', started.sessionId)!.question_ids) as string[];
    const today = new Set(questionIds());
    expect(ids.filter((id) => today.has(id))).toEqual([]);
  });

  it('never enters a ranked cohort, a ranked leaderboard or the priors', () => {
    const e = env();
    const p = e.player();
    const started = e.game.startSession(p, 'practice');
    const view = e.game.issueRound(p, started.sessionId, 1);
    const qid = view.activeRound!.question.id;
    expect(submit(e, p, view, answerText(qid, 0)).accepted).toBe(true);
    expect(count(e, 'final_answers')).toBe(0);
    expect(count(e, 'cohort_counters')).toBe(0);
    expect(count(e, 'scores')).toBe(1);
    expect(e.game.leaderboard(null).participants).toBe(0);
  });

  it('scores against the frozen population of an earlier daily, and practice cannot move it', () => {
    const e = env();
    const first = e.player();
    const started = e.game.startSession(first, 'practice');
    const view = e.game.issueRound(first, started.sessionId, 1);
    const qid = view.activeRound!.question.id;
    const answers = getQuestion(qid).answers;

    // Seed an earlier day's final answers for this very question: 10 of 40 gave answer 0.
    // Foreign keys are switched off only for this seeding, because the rounds behind these rows
    // belong to a past day that was never played in this test.
    const yesterday = dateKey(BASE - 24 * 3600 * 1000);
    e.db.exec('PRAGMA foreign_keys = OFF');
    for (let i = 0; i < 40; i += 1) {
      e.db.run(
        `INSERT INTO final_answers (round_id, cohort_key, player_id, question_id, challenge_date, canonical_id, in_cohort, cohort_sequence, closes_at)
         VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)`,
        `seed-round-${i}`,
        `${yesterday}:${qid}`,
        `seed-player-${i}`,
        qid,
        yesterday,
        i < 10 ? answers[0]!.id : answers[1 + (i % (answers.length - 1))]!.id,
        i + 1,
        BASE - 1000 + i,
      );
    }
    e.db.exec('PRAGMA foreign_keys = ON');

    submit(e, first, view, answers[0]!.text);
    const score = e.db.get<{ c_prior: number; n_prior: number; cohort_sequence: number | null }>(
      'SELECT c_prior, n_prior, cohort_sequence FROM scores WHERE round_id = ?',
      view.activeRound!.roundId,
    )!;
    expect(score).toMatchObject({ c_prior: 10, n_prior: 40, cohort_sequence: null });

    // A second practice player answering the same way afterwards sees exactly the same population:
    // the first player's practice answer did not enter it.
    const second = e.player();
    const s2 = e.game.startSession(second, 'practice');
    const v2 = e.game.issueRound(second, s2.sessionId, 1);
    if (v2.activeRound!.question.id === qid) {
      submit(e, second, v2, answers[0]!.text);
      const again = e.db.get<{ c_prior: number; n_prior: number }>('SELECT c_prior, n_prior FROM scores WHERE round_id = ?', v2.activeRound!.roundId)!;
      expect(again).toEqual({ c_prior: 10, n_prior: 40 });
    }
    // Nothing from practice reached a ranked cohort.
    expect((e.db.get<{ n: number }>("SELECT COUNT(*) AS n FROM final_answers WHERE player_id NOT LIKE 'seed-%'") as { n: number }).n).toBe(0);
  });
});

describe('leaderboard and history', () => {
  it('ranks completed ranked climbs, shares ranks for equal totals, and hides unfinished climbs', () => {
    const e = env();
    const strong = e.player();
    const weak = e.player();
    const tie = e.player();
    const unfinished = e.player();
    playDive(e, strong, (qid) => rareAnswerText(qid));
    playDive(e, weak, () => null);
    playDive(e, tie, () => null);
    begin(e, unfinished);

    const board = e.game.leaderboard(strong);
    expect(board.participants).toBe(3);
    expect(board.entries[0]!.rank).toBe(1);
    expect(board.entries[0]!.isYou).toBe(true);
    expect(board.entries[0]!.totalPoints).toBeGreaterThan(0);
    expect(board.entries.slice(1).map((x) => x.rank)).toEqual([2, 2]); // a tie shares a rank
    expect(board.entries.some((x) => x.displayName.length === 0)).toBe(false);
    expect(board.percentile).toBeNull(); // too few players to claim a percentile
  });

  it('lists a player\u2019s own history, ranked and practice, newest first', () => {
    const e = env();
    const p = e.player();
    playDive(e, p, (qid) => answerText(qid, 0));
    e.advance(1_000);
    const prac = e.game.startSession(p, 'practice');
    e.game.issueRound(p, prac.sessionId, 1);
    const history = e.game.history(p);
    expect(history.map((h) => h.mode)).toEqual(['practice', 'daily']);
    expect(history[1]!.state).toBe('challenge_complete');
    expect(e.game.history(e.player())).toEqual([]);
  });
});

describe('abandonment never blocks a cohort (§4.6.6)', () => {
  it('marks an idle session abandoned, and its open round still finalizes', () => {
    const e = env();
    const a = e.player();
    const b = e.player();
    const va = begin(e, a);
    e.advance(500);
    const vb = begin(e, b);
    submit(e, b, vb, answerText(vb.activeRound!.question.id, 0));
    e.advance(GAME.abandonAfterMs + WINDOW);
    const view = e.game.getView(a, va.sessionId);
    expect(view.state).toBe('abandoned');
    expect(e.game.getView(b, vb.sessionId).results).toHaveLength(1);
    expect(count(e, 'scores')).toBe(2);
    expectCode(() => e.game.issueRound(a, va.sessionId, 2), 'SESSION_NOT_ISSUABLE');
  });
});

describe('atomicity', () => {
  it('rolls back everything if a transaction fails part-way', () => {
    const e = env();
    const p = e.player();
    const view = begin(e, p);
    const before = count(e, 'submissions');
    expect(() =>
      (e.db as Db).tx(() => {
        e.db.run(
          `INSERT INTO submissions (id, round_id, session_id, request_id, payload_hash, raw_text, normalization_version, response_json, submitted_at)
           VALUES ('x', ?, ?, 'will-roll-back', 'h', 'a', 2, '{}', 1)`,
          view.activeRound!.roundId,
          view.sessionId,
        );
        throw new Error('boom');
      }),
    ).toThrow('boom');
    expect(count(e, 'submissions')).toBe(before);
  });

  it('leaves no half-locked round: a lock and its score are written together or not at all', () => {
    const e = env();
    const p = e.player();
    const view = begin(e, p);
    submit(e, p, view, answerText(view.activeRound!.question.id));
    expect(count(e, 'candidates')).toBe(count(e, 'scores'));
    expect(count(e, 'candidates')).toBe(1);
  });
});
