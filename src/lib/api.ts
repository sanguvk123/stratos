import type {
  ApiErrorDto,
  FinalResultDto,
  HistoryEntryDto,
  LeaderboardDto,
  SessionMode,
  SessionViewDto,
  SubmitResultDto,
} from './types';

// Typed browser client for the game API. The client decides nothing about scoring, lateness or
// validity: every answer, deadline and score here was computed by the server.

export class ApiError extends Error {
  readonly code: string;
  readonly status: number;
  readonly availableAt?: number;
  readonly currentVersion?: number;

  constructor(status: number, body: ApiErrorDto, currentVersion?: number) {
    super(body.message);
    this.name = 'ApiError';
    this.code = body.error;
    this.status = status;
    this.availableAt = body.availableAt;
    this.currentVersion = currentVersion;
  }
}

async function call<T>(method: 'GET' | 'POST', url: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, {
      method,
      credentials: 'same-origin',
      cache: 'no-store',
      headers: body === undefined ? undefined : { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError(0, { error: 'NETWORK', message: 'You appear to be offline. Reconnecting\u2026' });
  }
  const text = await res.text();
  let parsed: unknown = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = null;
  }
  if (!res.ok) {
    const fallback: ApiErrorDto = { error: 'ERROR', message: `Request failed (${res.status})` };
    const header = res.headers.get('X-Current-Version');
    throw new ApiError(
      res.status,
      parsed && typeof parsed === 'object' && 'error' in parsed ? (parsed as ApiErrorDto) : fallback,
      header ? Number(header) : undefined,
    );
  }
  return parsed as T;
}

/** A fresh idempotency key. Reused on a retry of the SAME request so a replay cannot double-submit. */
export function newRequestId(): string {
  return crypto.randomUUID();
}

export const api = {
  startSession: (mode: SessionMode) => call<SessionViewDto>('POST', '/api/session', { mode }),
  getSession: (sessionId: string) => call<SessionViewDto>('GET', `/api/session/${sessionId}`),
  issueRound: (sessionId: string, questionIndex: number) =>
    call<SessionViewDto>('POST', `/api/session/${sessionId}/round`, { questionIndex }),
  submitAnswer: (sessionId: string, input: { roundId: string; rawText: string; requestId: string }) =>
    call<SubmitResultDto>('POST', `/api/session/${sessionId}/answer`, input),
  getResult: (sessionId: string) => call<FinalResultDto>('GET', `/api/session/${sessionId}/result`),
  leaderboard: (date?: string) =>
    call<LeaderboardDto>('GET', date ? `/api/leaderboard?date=${encodeURIComponent(date)}` : '/api/leaderboard'),
  history: () => call<HistoryEntryDto[]>('GET', '/api/history'),
};
