import { matchAnswer } from '@/domain/normalization';
import {
  computePopularity,
  MAX_DIVE_POINTS,
  scoreAnsweredPlayer,
  toDepthMetres,
  type TierId,
} from '@/domain/scoring';
import {
  assertRoundTransition,
  assertSessionTransition,
  computeClosesAt,
  decideIssuance,
  effectiveRoundState,
  isFinalizable,
  isSubmissionOpen,
  nextSessionState,
  shouldAbandon,
  type IssuedRound,
  type RoundState,
  type SessionState,
} from '@/domain/statemachine';
import { altitudeKm } from '@/lib/altitude';
import type {
  ActiveRoundDto,
  FinalResultDto,
  HistoryEntryDto,
  LeaderboardDto,
  LeaderboardEntryDto,
  RoundResultDto,
  SessionMode,
  SessionViewDto,
  SubmitRejection,
  SubmitResultDto,
} from '@/lib/types';
import { TIER_SHARE_SQUARES } from '@/lib/tiers';
import { GAME } from '../config';
import {
  getAnswerIndex,
  getAnswerText,
  getPriorPpm,
  getQuestion,
  QUESTION_VERSION,
  toPublicQuestion,
} from '../content/questions';
import type { Db } from '../db';
import { GameError } from './errors';
import { displayNameFor } from './players';
import { finalCohortCounts, practiceReferenceCounts, type Counts } from './population';
import { dailyQuestionIds, practiceQuestionIds } from './selection';
import { cohortKey, dateKey, newId, sha256 } from './util';

interface SessionRow {
  id: string;
  player_id: string;
  mode: SessionMode;
  challenge_id: string | null;
  challenge_date: string | null;
  question_ids: string;
  state: SessionState;
  created_at: number;
  last_activity_at: number;
  completed_at: number | null;
}

interface RoundRow {
  id: string;
  session_id: string;
  question_index: number;
  question_id: string;
  cohort_key: string | null;
  is_ranked: number;
  state: RoundState;
  served_at: number;
  /** served_at + 60 s, or the moment the player's answer locked the round, whichever is first. */
  closes_at: number;
  answered_at: number | null;
  finalized_at: number | null;
  cohort_sequence: number | null;
}

interface ScoreRow {
  round_id: string;
  question_id: string;
  canonical_id: string | null;
  tier: number | null;
  points: number;
  depth_m: number;
  popularity_json: string | null;
}

interface CandidateRow {
  round_id: string;
  canonical_id: string;
  normalization_version: number;
  matched_via: string;
  updated_at: number;
}

export type FinalizeStatus = 'finalized' | 'already_finalized' | 'not_yet_closed';

/** Below this many finished players a daily percentile is not shown (§18.11). */
const MIN_PERCENTILE_PARTICIPANTS = 20;
const LEADERBOARD_LIMIT = 50;

export interface SubmitInput {
  roundId: string;
  rawText: string;
  requestId: string;
}

/**
 * THE ROUND LIFECYCLE (amended in §19).
 *
 * A question is open for up to 60 s. The FIRST answer that matches a valid answer (after spelling
 * auto-correction) locks the round at that instant: closes_at moves back to that moment, the round
 * is finalized in the same transaction, and the result is returned with the response. There is no
 * revision, no provisional tier and no predicted score; the player sees a score only once it is
 * final. A round that is never answered closes at served_at + 60 s and scores zero.
 *
 * COHORT ORDER. Ranked rounds are scored against earlier ranked rounds on the same question
 * (the rolling cohort, §16.2). Because an answered round finalizes inside the transaction that
 * accepts the answer, and writers are serialized, the order in which rounds are finalized is the
 * order in which answers were committed: cohort_sequence. Unanswered rounds hold no vote, so the
 * moment they finalize never changes anyone's score.
 */
export class Game {
  private lastNow = 0;

  constructor(
    private readonly db: Db,
    private readonly clock: () => number = Date.now,
  ) {}

  /** Never goes backwards, even if the system clock does: cohort order relies on it (§4.6.5). */
  now(): number {
    this.lastNow = Math.max(this.lastNow, this.clock());
    return this.lastNow;
  }

  // ---------------------------------------------------------------- sessions

  startSession(playerId: string, mode: SessionMode): SessionViewDto {
    return this.db.tx(() => {
      const now = this.now();
      this.finalizeDue();
      if (mode !== 'daily' && mode !== 'practice') throw new GameError('INVALID', 'unknown mode');
      const session = mode === 'daily' ? this.dailySession(playerId, now) : this.practiceSession(playerId, now);
      return this.buildView(session, now);
    });
  }

  private dailySession(playerId: string, now: number): SessionRow {
    const date = dateKey(now);
    const challengeId = `daily:${date}`;
    this.db.run(
      `INSERT OR IGNORE INTO challenges (id, date, question_ids, scoring_config_version, created_at)
       VALUES (?, ?, ?, ?, ?)`,
      challengeId,
      date,
      JSON.stringify(dailyQuestionIds(date)),
      GAME.scoring.version,
      now,
    );
    const challenge = this.db.get<{ question_ids: string }>(
      'SELECT question_ids FROM challenges WHERE id = ?',
      challengeId,
    ) as { question_ids: string };

    const existing = this.db.get<SessionRow>(
      'SELECT * FROM sessions WHERE player_id = ? AND challenge_id = ?',
      playerId,
      challengeId,
    );
    if (existing) return existing;

    const id = newId();
    this.db.run(
      `INSERT INTO sessions (id, player_id, mode, challenge_id, challenge_date, question_ids, state, created_at, last_activity_at)
       VALUES (?, ?, 'daily', ?, ?, ?, 'lobby', ?, ?)`,
      id,
      playerId,
      challengeId,
      date,
      challenge.question_ids,
      now,
      now,
    );
    return this.mustSession(id);
  }

  private practiceSession(playerId: string, now: number): SessionRow {
    const usage = new Map<string, number>();
    for (const row of this.db.all<{ question_id: string; n: number }>(
      `SELECT r.question_id AS question_id, COUNT(*) AS n
         FROM rounds r JOIN sessions s ON s.id = r.session_id
        WHERE s.player_id = ? AND s.mode = 'practice' GROUP BY r.question_id`,
      playerId,
    )) {
      usage.set(row.question_id, Number(row.n));
    }
    const id = newId();
    const todays = new Set(dailyQuestionIds(dateKey(now)));
    this.db.run(
      `INSERT INTO sessions (id, player_id, mode, challenge_id, challenge_date, question_ids, state, created_at, last_activity_at)
       VALUES (?, ?, 'practice', NULL, NULL, ?, 'lobby', ?, ?)`,
      id,
      playerId,
      JSON.stringify(practiceQuestionIds(usage, todays, id)),
      now,
      now,
    );
    return this.mustSession(id);
  }

  getView(playerId: string, sessionId: string): SessionViewDto {
    return this.db.tx(() => {
      const now = this.now();
      this.finalizeDue();
      const session = this.ownedSession(playerId, sessionId);
      this.maybeAbandon(session, now);
      return this.buildView(this.mustSession(sessionId), now);
    });
  }

  // ---------------------------------------------------------------- issuance

  issueRound(playerId: string, sessionId: string, requestedIndex: number): SessionViewDto {
    return this.db.tx(() => {
      const now = this.now();
      this.finalizeDue();
      const session = this.ownedSession(playerId, sessionId);
      this.maybeAbandon(session, now);
      const current = this.mustSession(sessionId);
      const rounds = this.roundsOf(sessionId);

      const decision = decideIssuance({
        sessionState: current.state,
        rounds: toIssued(rounds),
        requestedIndex,
        nowMs: now,
        revealWindowMs: GAME.revealWindowMs,
        questionCount: GAME.questionCount,
      });

      if (decision.kind === 'refuse') {
        const extra: Record<string, number> = {};
        if (decision.availableAtMs !== undefined) extra.availableAt = decision.availableAtMs;
        throw new GameError(decision.reason, `cannot issue question ${requestedIndex}: ${decision.reason}`, extra);
      }

      if (decision.kind === 'issue') {
        const questionId = (JSON.parse(current.question_ids) as string[])[decision.questionIndex - 1] as string;
        const ranked = current.mode === 'daily';
        if (decision.startsSession) {
          assertSessionTransition(current.state, 'active');
          this.db.run('UPDATE sessions SET state = ? WHERE id = ?', 'active', sessionId);
        }
        this.db.run(
          `INSERT INTO rounds (id, session_id, question_index, question_id, cohort_key, is_ranked, state, served_at, closes_at)
           VALUES (?, ?, ?, ?, ?, ?, 'question_active', ?, ?)`,
          newId(),
          sessionId,
          decision.questionIndex,
          questionId,
          ranked ? cohortKey(current.challenge_date as string, questionId) : null,
          ranked ? 1 : 0,
          decision.servedAtMs,
          decision.closesAtMs,
        );
      }
      this.touch(sessionId, now);
      return this.buildView(this.mustSession(sessionId), now);
    });
  }

  // ------------------------------------------------------------- submissions

  /**
   * Takes what the player typed. If it matches a valid answer (spelling mistakes are corrected),
   * the round is locked and scored in this same transaction and the final result is returned.
   * If it does not match, nothing is locked and the player may type again until the clock runs out.
   */
  submitAnswer(playerId: string, sessionId: string, input: SubmitInput): SubmitResultDto {
    return this.db.tx(() => {
      const now = this.now();
      const session = this.ownedSession(playerId, sessionId);

      if (
        typeof input.rawText !== 'string' ||
        typeof input.requestId !== 'string' ||
        input.requestId.length < 8 ||
        input.requestId.length > 100 ||
        typeof input.roundId !== 'string'
      ) {
        throw new GameError('INVALID', 'malformed answer request');
      }

      const round = this.db.get<RoundRow>('SELECT * FROM rounds WHERE id = ? AND session_id = ?', input.roundId, sessionId);
      if (!round) throw new GameError('NOT_FOUND', 'round not found');

      // 1. Idempotency (§18.5): the same request id returns the stored response, a different
      //    payload under the same id is a conflict. Checked before the deadline on purpose, so a
      //    retry after a lost response gets the result the first request produced.
      const payloadHash = sha256(`${input.roundId}|${input.rawText}`);
      const prior = this.db.get<{ payload_hash: string; response_json: string }>(
        'SELECT payload_hash, response_json FROM submissions WHERE session_id = ? AND request_id = ?',
        sessionId,
        input.requestId,
      );
      if (prior) {
        if (prior.payload_hash !== payloadHash) {
          throw new GameError('REQUEST_ID_CONFLICT', 'this request id was already used with a different answer');
        }
        return JSON.parse(prior.response_json) as SubmitResultDto;
      }

      // 2. The round must still be open (§11.2): decided here, under the write lock, by the server
      //    clock. A round that already took an answer is locked for good.
      if (round.answered_at !== null) return { accepted: false, reason: 'ALREADY_ANSWERED' };
      if (round.state !== 'question_active' || !isSubmissionOpen(now, round.closes_at)) {
        return { accepted: false, reason: 'ROUND_CLOSED' };
      }

      // 3. Rate and attempt limits (§11.1). Replays were handled above, so they never count.
      const recent = this.db.get<{ n: number }>(
        'SELECT COUNT(*) AS n FROM submissions WHERE session_id = ? AND submitted_at > ?',
        sessionId,
        now - 60_000,
      );
      if (Number(recent?.n ?? 0) >= GAME.answerRequestsPerMinute) {
        throw new GameError('RATE_LIMITED', 'too many answers, slow down');
      }
      const attempts = this.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM submissions WHERE round_id = ?', round.id);
      if (Number(attempts?.n ?? 0) >= GAME.maxAttemptsPerRound) {
        return this.record(session, round, input, payloadHash, now, null, { accepted: false, reason: 'TOO_MANY_ATTEMPTS' }, 'TOO_MANY_ATTEMPTS');
      }

      // 4. Validate: correctness is decided before, and independently of, rarity (§2).
      const match = matchAnswer(input.rawText, getAnswerIndex(round.question_id));
      if (!match.ok) {
        return this.record(session, round, input, payloadHash, now, match, { accepted: false, reason: match.reason }, match.reason);
      }

      // 5. LOCK. The accepted answer ends the question at this instant.
      this.db.run(
        `INSERT INTO candidates (round_id, canonical_id, normalization_version, matched_via, updated_at)
         VALUES (?, ?, ?, ?, ?)`,
        round.id,
        match.canonicalAnswerId,
        match.normalizationVersion,
        match.matchedVia,
        now,
      );
      this.db.run('UPDATE rounds SET closes_at = ?, answered_at = ? WHERE id = ?', now, now, round.id);

      // 6. Score it now. The population it is scored against is every earlier finalized round.
      const status = this.finalizeRound(round.id);
      if (status !== 'finalized') {
        throw new Error(`a locked round must finalize at once, got ${status}`);
      }
      const result = this.resultsOf(sessionId).find((r) => r.roundId === round.id);
      if (!result) throw new Error('a finalized round must have a result');

      const response: SubmitResultDto = {
        accepted: true,
        answerText: getAnswerText(round.question_id, match.canonicalAnswerId),
        corrected: match.matchedVia === 'typo_correction',
        result,
      };
      return this.record(session, round, input, payloadHash, now, match, response, null);
    });
  }

  /** Appends to the immutable attempt history and returns the response unchanged. */
  private record(
    session: SessionRow,
    round: RoundRow,
    input: SubmitInput,
    payloadHash: string,
    now: number,
    match: ReturnType<typeof matchAnswer> | null,
    response: SubmitResultDto,
    rejection: SubmitRejection | null,
  ): SubmitResultDto {
    const raw = Array.from(input.rawText).slice(0, 200).join('');
    this.db.run(
      `INSERT INTO submissions (id, round_id, session_id, request_id, payload_hash, raw_text, canonical_id,
                                normalization_version, matched_via, rejection, response_json, submitted_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      newId(),
      round.id,
      session.id,
      input.requestId,
      payloadHash,
      raw,
      match?.ok ? match.canonicalAnswerId : null,
      match?.normalizationVersion ?? 2,
      match?.ok ? match.matchedVia : null,
      rejection,
      JSON.stringify(response),
      now,
    );
    this.touch(session.id, now);
    return response;
  }

  private populationFor(round: RoundRow, canonicalId: string): Counts {
    if (!round.is_ranked) {
      return practiceReferenceCounts(this.db, round.question_id, dateKey(round.served_at), canonicalId);
    }
    return finalCohortCounts(this.db, round.cohort_key as string, round.cohort_sequence as number, canonicalId);
  }

  // ------------------------------------------------------------- finalization

  /**
   * Finalizes every UNANSWERED round whose 60 s are up, oldest deadline first. Called lazily by
   * every request and by the sweep endpoint. Answered rounds never wait for this: they finalize in
   * the transaction that accepted the answer.
   */
  finalizeDue(limit = 500): number {
    const now = this.now();
    const due = this.db.all<{ id: string }>(
      `SELECT id FROM rounds WHERE state != 'reveal' AND closes_at + ? <= ? ORDER BY closes_at, id LIMIT ?`,
      GAME.finalizeGraceMs,
      now,
      limit,
    );
    let finalized = 0;
    for (const { id } of due) {
      if (this.finalizeRound(id) === 'finalized') finalized += 1;
    }
    return finalized;
  }

  /** Idempotent: calling it twice, or concurrently, scores a round exactly once (§7.6). */
  finalizeRound(roundId: string): FinalizeStatus {
    return this.db.tx(() => {
      const round = this.db.get<RoundRow>('SELECT * FROM rounds WHERE id = ?', roundId);
      if (!round) throw new GameError('NOT_FOUND', 'round not found');
      if (round.state === 'reveal') return 'already_finalized';

      const now = this.now();
      // A locked round is closed by its own answer. An open one closes at its deadline, plus grace.
      if (round.answered_at === null && !isFinalizable(now, round.closes_at, GAME.finalizeGraceMs)) {
        return 'not_yet_closed';
      }

      if (round.state === 'question_active') assertRoundTransition('question_active', 'question_closing');
      assertRoundTransition('question_closing', 'reveal');

      const session = this.mustSession(round.session_id);
      const answered = this.db.get<CandidateRow>('SELECT * FROM candidates WHERE round_id = ?', round.id);

      let sequence: number | null = null;
      if (round.is_ranked) {
        const counter = this.db.get<{ next_sequence: number }>(
          'SELECT next_sequence FROM cohort_counters WHERE cohort_key = ?',
          round.cohort_key as string,
        );
        sequence = counter?.next_sequence ?? 1;
        this.db.run(
          `INSERT INTO cohort_counters (cohort_key, next_sequence) VALUES (?, ?)
           ON CONFLICT(cohort_key) DO UPDATE SET next_sequence = excluded.next_sequence`,
          round.cohort_key as string,
          sequence + 1,
        );
        this.db.run('UPDATE rounds SET cohort_sequence = ? WHERE id = ?', sequence, round.id);
        this.db.run(
          `INSERT INTO final_answers (round_id, cohort_key, player_id, question_id, challenge_date, canonical_id,
                                      in_cohort, cohort_sequence, closes_at)
           VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)`,
          round.id,
          round.cohort_key as string,
          session.player_id,
          round.question_id,
          session.challenge_date as string,
          answered?.canonical_id ?? null,
          sequence,
          round.closes_at,
        );
      }

      let tier: number | null = null;
      let points = 0;
      let numerator: string | null = null;
      let denominator: string | null = null;
      let priorPpm: number | null = null;
      let counts: Counts = { cPrior: 0, nPrior: 0 };
      let popularityJson: string | null = null;

      if (answered) {
        const withSequence = { ...round, cohort_sequence: sequence };
        counts = this.populationFor(withSequence, answered.canonical_id);
        priorPpm = getPriorPpm(round.question_id, answered.canonical_id);
        const score = scoreAnsweredPlayer({ ...counts, priorPpm }, GAME.scoring);
        tier = score.tier;
        points = score.points;
        numerator = score.numerator.toString();
        denominator = score.denominator.toString();
        popularityJson = JSON.stringify(
          computePopularity(counts.cPrior, counts.nPrior, GAME.scoring.popularityMinSample),
        );
      }

      this.db.run(
        `INSERT INTO scores (round_id, session_id, question_id, question_version, scoring_config_version, alpha,
                             canonical_id, prior_ppm, c_prior, n_prior, p_numerator, p_denominator, tier, points,
                             depth_m, popularity_json, normalization_version, cohort_sequence, finalized_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        round.id,
        round.session_id,
        round.question_id,
        QUESTION_VERSION,
        GAME.scoring.version,
        GAME.scoring.alpha,
        answered?.canonical_id ?? null,
        priorPpm,
        counts.cPrior,
        counts.nPrior,
        numerator,
        denominator,
        tier,
        points,
        toDepthMetres(points),
        popularityJson,
        answered ? answered.normalization_version : null,
        sequence,
        now,
      );

      this.db.run('UPDATE rounds SET state = ?, finalized_at = ? WHERE id = ?', 'reveal', now, round.id);

      // The session completes once every question has been issued and finalized.
      const rounds = this.roundsOf(round.session_id);
      const after = nextSessionState(session.state, toIssued(rounds), GAME.questionCount);
      if (after !== session.state) {
        assertSessionTransition(session.state, after);
        this.db.run('UPDATE sessions SET state = ?, completed_at = ? WHERE id = ?', after, now, session.id);
      }
      return 'finalized';
    });
  }

  // --------------------------------------------------------------------- views

  private buildView(session: SessionRow, now: number): SessionViewDto {
    const rounds = this.roundsOf(session.id);
    const results = this.resultsOf(session.id);
    const totalPoints = results.reduce((sum, r) => sum + r.points, 0);
    const open = rounds.find((r) => r.state !== 'reveal') ?? null;

    let activeRound: ActiveRoundDto | null = null;
    if (open) {
      activeRound = {
        roundId: open.id,
        questionIndex: open.question_index,
        state: effectiveRoundState(open.state, now, open.closes_at),
        question: toPublicQuestion(getQuestion(open.question_id)),
        servedAt: open.served_at,
        closesAt: open.closes_at,
      };
    }

    let nextAvailableAt: number | null = null;
    const last = rounds[rounds.length - 1];
    if (
      session.state === 'active' &&
      !open &&
      last?.finalized_at != null &&
      rounds.length < GAME.questionCount
    ) {
      nextAvailableAt = last.finalized_at + GAME.revealWindowMs;
    }

    return {
      serverNow: now,
      sessionId: session.id,
      mode: session.mode,
      isRanked: session.mode === 'daily',
      challengeDate: session.challenge_date,
      state: session.state,
      questionCount: GAME.questionCount,
      issued: rounds.length,
      totalPoints,
      depthM: toDepthMetres(totalPoints),
      results,
      activeRound,
      nextAvailableAt,
    };
  }

  private resultsOf(sessionId: string): RoundResultDto[] {
    const rows = this.db.all<ScoreRow & { question_index: number }>(
      `SELECT s.round_id, s.question_id, s.canonical_id, s.tier, s.points, s.depth_m, s.popularity_json, r.question_index
         FROM scores s JOIN rounds r ON r.id = s.round_id
        WHERE s.session_id = ? ORDER BY r.question_index`,
      sessionId,
    );
    return rows.map((row) => {
      const question = getQuestion(row.question_id);
      return {
        roundId: row.round_id,
        questionIndex: row.question_index,
        category: question.category,
        prompt: question.prompt,
        answerText: row.canonical_id ? getAnswerText(row.question_id, row.canonical_id) : null,
        tier: row.tier as TierId | null,
        points: row.points,
        depthM: row.depth_m,
        popularity: row.popularity_json ? (JSON.parse(row.popularity_json) as RoundResultDto['popularity']) : null,
      };
    });
  }

  getRoundResult(playerId: string, sessionId: string, roundId: string): RoundResultDto {
    return this.db.tx(() => {
      this.now();
      this.finalizeDue();
      this.ownedSession(playerId, sessionId);
      const round = this.db.get<RoundRow>('SELECT * FROM rounds WHERE id = ? AND session_id = ?', roundId, sessionId);
      if (!round) throw new GameError('NOT_FOUND', 'round not found');
      const found = this.resultsOf(sessionId).find((r) => r.roundId === roundId);
      if (!found) throw new GameError('NOT_FINALIZED', 'this round has not been finalized yet');
      return found;
    });
  }

  getFinalResult(playerId: string, sessionId: string): FinalResultDto {
    return this.db.tx(() => {
      this.now();
      this.finalizeDue();
      const session = this.ownedSession(playerId, sessionId);
      if (session.state !== 'challenge_complete') {
        throw new GameError('NOT_FINALIZED', 'this climb is not complete yet');
      }
      const results = this.resultsOf(sessionId);
      const totalPoints = results.reduce((sum, r) => sum + r.points, 0);

      let rank: number | null = null;
      let participants: number | null = null;
      let percentile: number | null = null;
      if (session.mode === 'daily') {
        const board = this.dailyTotals(session.challenge_date as string);
        participants = board.length;
        rank = 1 + board.filter((b) => b.totalPoints > totalPoints).length;
        percentile = percentileOf(board, totalPoints);
      }

      return {
        sessionId,
        mode: session.mode,
        isRanked: session.mode === 'daily',
        challengeDate: session.challenge_date,
        totalPoints,
        maxPoints: MAX_DIVE_POINTS,
        depthM: toDepthMetres(totalPoints),
        results,
        rank,
        participants,
        percentile,
        shareText: shareText(session, results, totalPoints),
      };
    });
  }

  // ------------------------------------------------------------- leaderboard

  /** Completed ranked climbs for a date, best first. Ranks are shared for equal totals (§7.5). */
  private dailyTotals(date: string): Array<{ playerId: string; totalPoints: number; completedAt: number }> {
    return this.db
      .all<{ player_id: string; total: number; completed_at: number }>(
        `SELECT s.player_id AS player_id, COALESCE(SUM(sc.points), 0) AS total, s.completed_at AS completed_at
           FROM sessions s JOIN scores sc ON sc.session_id = s.id
          WHERE s.mode = 'daily' AND s.challenge_date = ? AND s.state = 'challenge_complete'
          GROUP BY s.id`,
        date,
      )
      .map((r) => ({ playerId: r.player_id, totalPoints: Number(r.total), completedAt: Number(r.completed_at) }))
      .sort((a, b) => b.totalPoints - a.totalPoints || a.completedAt - b.completedAt || a.playerId.localeCompare(b.playerId));
  }

  leaderboard(viewerId: string | null, date?: string): LeaderboardDto {
    return this.db.tx(() => {
      const now = this.now();
      this.finalizeDue();
      const day = date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : dateKey(now);
      const board = this.dailyTotals(day);
      const toEntry = (b: (typeof board)[number]): LeaderboardEntryDto => ({
        rank: 1 + board.filter((x) => x.totalPoints > b.totalPoints).length,
        displayName: displayNameFor(b.playerId),
        totalPoints: b.totalPoints,
        depthM: toDepthMetres(b.totalPoints),
        isYou: b.playerId === viewerId,
      });
      const mine = viewerId ? board.find((b) => b.playerId === viewerId) : undefined;
      return {
        date: day,
        participants: board.length,
        entries: board.slice(0, LEADERBOARD_LIMIT).map(toEntry),
        you: mine ? toEntry(mine) : null,
        percentile: mine ? percentileOf(board, mine.totalPoints) : null,
      };
    });
  }

  history(playerId: string, limit = 30): HistoryEntryDto[] {
    return this.db.tx(() => {
      this.now();
      this.finalizeDue();
      return this.db
        .all<SessionRow & { total: number }>(
          `SELECT s.*, COALESCE((SELECT SUM(points) FROM scores WHERE session_id = s.id), 0) AS total
             FROM sessions s WHERE s.player_id = ? AND s.state != 'lobby' ORDER BY s.created_at DESC LIMIT ?`,
          playerId,
          limit,
        )
        .map((s) => ({
          sessionId: s.id,
          mode: s.mode,
          challengeDate: s.challenge_date,
          state: s.state,
          totalPoints: Number(s.total),
          depthM: toDepthMetres(Number(s.total)),
          completedAt: s.completed_at,
        }));
    });
  }

  // ------------------------------------------------------------------ helpers

  private mustSession(id: string): SessionRow {
    const row = this.db.get<SessionRow>('SELECT * FROM sessions WHERE id = ?', id);
    if (!row) throw new GameError('NOT_FOUND', 'session not found');
    return row;
  }

  /** The caller must own the session. A missing and a foreign session look the same (§10.2). */
  private ownedSession(playerId: string, sessionId: string): SessionRow {
    const row = this.db.get<SessionRow>('SELECT * FROM sessions WHERE id = ? AND player_id = ?', sessionId, playerId);
    if (!row) throw new GameError('NOT_FOUND', 'session not found');
    return row;
  }

  private roundsOf(sessionId: string): RoundRow[] {
    return this.db.all<RoundRow>('SELECT * FROM rounds WHERE session_id = ? ORDER BY question_index', sessionId);
  }

  private touch(sessionId: string, now: number): void {
    this.db.run('UPDATE sessions SET last_activity_at = ? WHERE id = ?', now, sessionId);
  }

  private maybeAbandon(session: SessionRow, now: number): void {
    if (
      shouldAbandon({
        sessionState: session.state,
        rounds: toIssued(this.roundsOf(session.id)),
        lastActivityMs: session.last_activity_at,
        nowMs: now,
        abandonAfterMs: GAME.abandonAfterMs,
        questionCount: GAME.questionCount,
      })
    ) {
      assertSessionTransition(session.state, 'abandoned');
      this.db.run('UPDATE sessions SET state = ? WHERE id = ?', 'abandoned', session.id);
    }
  }

  /** Test and operations helper: how long a round runs, from the domain rule. */
  static closesAt(servedAtMs: number): number {
    return computeClosesAt(servedAtMs);
  }
}

function toIssued(rounds: readonly RoundRow[]): IssuedRound[] {
  return rounds.map((r) => ({
    questionIndex: r.question_index,
    state: r.state,
    closesAtMs: r.closes_at,
    finalizedAtMs: r.finalized_at,
  }));
}

/** Share of finished players this score beats. Hidden below a minimum, never invented (§18.11). */
function percentileOf(board: ReadonlyArray<{ totalPoints: number }>, totalPoints: number): number | null {
  if (board.length < MIN_PERCENTILE_PARTICIPANTS) return null;
  const below = board.filter((b) => b.totalPoints < totalPoints).length;
  return Math.floor((100 * below) / board.length);
}

/** Spoiler-free: tiers and totals only, never an answer or a question (§18.10). */
function shareText(session: SessionRow, results: readonly RoundResultDto[], totalPoints: number): string {
  const squares = results.map((r) => (r.tier === null ? '\u2B1B' : TIER_SHARE_SQUARES[r.tier])).join('');
  const title = session.mode === 'daily' ? `Stratos ${session.challenge_date}` : 'Stratos (practice)';
  const km = altitudeKm(totalPoints).toLocaleString('en-IN');
  return `${title}\n${squares}\n${totalPoints} pts \u00B7 climbed ${km} km`;
}
