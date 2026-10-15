// Response contracts shared by the server and the client (ARCHITECTURE.md §18.10, amended in §19).
// These are TYPES ONLY. They are what crosses the network, never an internal database row.
//
//   - Active round : the question and its clock. NOTHING about scoring: no predicted tier, no
//                    predicted points, no activity, no hint and no example answer.
//   - Finalized    : the player's OWN answer, final tier and points, and the approved popularity
//                    statistic, which is a share of EARLIER valid answers (§7.9). It is returned
//                    in the response to the answer that locked the question.

export type TierId = 1 | 2 | 3 | 4 | 5 | 6;
export type SessionMode = 'daily' | 'practice';
export type SessionStateDto = 'lobby' | 'active' | 'challenge_complete' | 'abandoned';
export type RoundStateDto = 'question_active' | 'question_closing' | 'reveal';

export type PopularityDto =
  | { kind: 'shown'; percentOfEarlierAnswers: number }
  | { kind: 'under_one_percent' }
  | { kind: 'none_earlier' }
  | { kind: 'suppressed' };

export interface QuestionDto {
  id: string;
  category: string;
  prompt: string;
  /** The scope of the question. Never an example and never a hint. */
  qualifier: string;
}

export interface ActiveRoundDto {
  roundId: string;
  questionIndex: number;
  /** The effective state at `serverNow`: a round past its deadline reads as closing. */
  state: RoundStateDto;
  question: QuestionDto;
  servedAt: number;
  closesAt: number;
}

export interface RoundResultDto {
  roundId: string;
  questionIndex: number;
  category: string;
  prompt: string;
  answerText: string | null;
  tier: TierId | null;
  points: number;
  depthM: number;
  /** null when the player gave no accepted answer: there is nothing to compare. */
  popularity: PopularityDto | null;
}

export interface SessionViewDto {
  serverNow: number;
  sessionId: string;
  mode: SessionMode;
  isRanked: boolean;
  challengeDate: string | null;
  state: SessionStateDto;
  questionCount: number;
  /** Number of questions issued so far. */
  issued: number;
  /** Sum of FINALIZED questions only. */
  totalPoints: number;
  depthM: number;
  results: RoundResultDto[];
  activeRound: ActiveRoundDto | null;
  /** When the next question may be requested, if the previous result is in and the window is open. */
  nextAvailableAt: number | null;
}

export type SubmitRejection =
  | 'NO_MATCH'
  | 'EMPTY_INPUT'
  | 'TOO_LONG'
  | 'AMBIGUOUS_TYPO'
  | 'ROUND_CLOSED'
  | 'ALREADY_ANSWERED'
  | 'TOO_MANY_ATTEMPTS';

export type SubmitResultDto =
  | {
      /** The answer counted: the question is locked and `result` is the FINAL score for it. */
      accepted: true;
      /** The answer as the game understood it (so a misspelling shows what it was read as). */
      answerText: string;
      /** true when the typed text was auto-corrected to a different spelling. */
      corrected: boolean;
      result: RoundResultDto;
    }
  | { accepted: false; reason: SubmitRejection };

export interface LeaderboardEntryDto {
  rank: number;
  displayName: string;
  totalPoints: number;
  depthM: number;
  isYou: boolean;
}

export interface LeaderboardDto {
  date: string;
  participants: number;
  entries: LeaderboardEntryDto[];
  you: LeaderboardEntryDto | null;
  /** null unless there are enough participants for the statistic to mean something. */
  percentile: number | null;
}

export interface FinalResultDto {
  sessionId: string;
  mode: SessionMode;
  isRanked: boolean;
  challengeDate: string | null;
  totalPoints: number;
  maxPoints: number;
  depthM: number;
  results: RoundResultDto[];
  rank: number | null;
  participants: number | null;
  percentile: number | null;
  shareText: string;
}

export interface HistoryEntryDto {
  sessionId: string;
  mode: SessionMode;
  challengeDate: string | null;
  state: SessionStateDto;
  totalPoints: number;
  depthM: number;
  completedAt: number | null;
}

export interface ApiErrorDto {
  error: string;
  message: string;
  availableAt?: number;
}
