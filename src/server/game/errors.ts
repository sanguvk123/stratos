export type GameErrorCode =
  | 'UNAUTHENTICATED'
  | 'NOT_FOUND'
  | 'INVALID'
  | 'INVALID_INDEX'
  | 'REQUEST_ID_CONFLICT'
  | 'STALE_VERSION'
  | 'RATE_LIMITED'
  | 'OUT_OF_ORDER'
  | 'PREVIOUS_NOT_FINALIZED'
  | 'TOO_EARLY'
  | 'SESSION_NOT_ISSUABLE'
  | 'NOT_FINALIZED';

const STATUS: Record<GameErrorCode, number> = {
  UNAUTHENTICATED: 401,
  NOT_FOUND: 404,
  INVALID: 400,
  INVALID_INDEX: 400,
  REQUEST_ID_CONFLICT: 409,
  STALE_VERSION: 409,
  RATE_LIMITED: 429,
  OUT_OF_ORDER: 409,
  PREVIOUS_NOT_FINALIZED: 409,
  TOO_EARLY: 409,
  SESSION_NOT_ISSUABLE: 409,
  NOT_FINALIZED: 409,
};

/** A deliberate, client-visible refusal. Anything else that is thrown is a bug and becomes a 500. */
export class GameError extends Error {
  readonly code: GameErrorCode;
  readonly status: number;
  readonly extra: Record<string, number | string>;

  constructor(code: GameErrorCode, message: string, extra: Record<string, number | string> = {}) {
    super(message);
    this.name = 'GameError';
    this.code = code;
    this.status = STATUS[code];
    this.extra = extra;
  }
}
