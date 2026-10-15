import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import path from 'node:path';
import type { ApiErrorDto } from '@/lib/types';
import { openDb, type Db } from './db';
import { GameError } from './game/errors';
import { Game } from './game/game';
import { createPlayer, playerIdForToken } from './game/players';

// Process-wide singletons. Next.js can load a route module more than once in development, so the
// handles live on globalThis to make sure there is exactly one connection and one Game.
//
// The key carries a version. A singleton on globalThis survives hot reloads, so after the rules or
// the schema change a running dev server would keep serving the OLD Game against the OLD database
// (it did, once). Bump RUNTIME_VERSION whenever the schema or the round lifecycle changes, and a
// running server builds a fresh Game and opens the matching database file on its next request.
const RUNTIME_VERSION = 2;

interface Runtime {
  db: Db;
  game: Game;
}
const KEY = Symbol.for(`stratos.runtime.v${RUNTIME_VERSION}`);
type Holder = { [KEY]?: Runtime };

export function runtime(): Runtime {
  const holder = globalThis as unknown as Holder;
  if (!holder[KEY]) {
    // The schema changed (a round now locks on its first answer), so this is a NEW file. An old
    // `.data/abyssal.db` is left untouched and is not read.
    const file = process.env.STRATOS_DB ?? path.join(process.cwd(), '.data', 'ascent.db');
    const db = openDb(file);
    holder[KEY] = { db, game: new Game(db) };
  }
  return holder[KEY] as Runtime;
}

export const COOKIE = 'stratos_player';
const COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

function cookieOptions() {
  return {
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: COOKIE_MAX_AGE,
  };
}

/** The signed-in guest, or null. Never creates one. */
export function currentPlayer(req: NextRequest): string | null {
  const token = req.cookies.get(COOKIE)?.value;
  if (!token) return null;
  return playerIdForToken(runtime().db, token);
}

export function requirePlayer(req: NextRequest): string {
  const id = currentPlayer(req);
  if (!id) throw new GameError('UNAUTHENTICATED', 'start a dive first');
  return id;
}

/** Finds the guest for this request, or issues a new server-side identity (§11.4). */
export function ensurePlayer(req: NextRequest): { playerId: string; newToken: string | null } {
  const existing = currentPlayer(req);
  if (existing) return { playerId: existing, newToken: null };
  const created = createPlayer(runtime().db, Date.now());
  return { playerId: created.playerId, newToken: created.token };
}

export function attachIdentity<T>(res: NextResponse<T>, newToken: string | null): NextResponse<T> {
  if (newToken) res.cookies.set(COOKIE, newToken, cookieOptions());
  return res;
}

export function noStore<T>(res: NextResponse<T>): NextResponse<T> {
  res.headers.set('Cache-Control', 'no-store');
  return res;
}

export function json<T>(body: T, status = 200): NextResponse<T> {
  return noStore(NextResponse.json(body, { status }));
}

/** Parses a JSON body. Requiring the JSON content type blocks cross-site form posts (CSRF). */
export async function readJson(req: NextRequest): Promise<Record<string, unknown>> {
  const type = req.headers.get('content-type') ?? '';
  if (!type.toLowerCase().includes('application/json')) {
    throw new GameError('INVALID', 'content-type must be application/json');
  }
  const text = await req.text();
  if (text.length > 4_000) throw new GameError('INVALID', 'request body too large');
  try {
    const parsed: unknown = JSON.parse(text);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) throw new Error('not an object');
    return parsed as Record<string, unknown>;
  } catch {
    throw new GameError('INVALID', 'request body is not valid JSON');
  }
}

/**
 * A GameError, recognised by shape rather than by `instanceof`. Next.js can hold two copies of a
 * module (after a hot reload, or across route bundles), and then `instanceof GameError` is false for
 * an error that really is one, which turned a deliberate refusal into a 500.
 */
function isGameError(error: unknown): error is GameError {
  return (
    error instanceof GameError ||
    (error instanceof Error &&
      error.name === 'GameError' &&
      typeof (error as { code?: unknown }).code === 'string' &&
      typeof (error as { status?: unknown }).status === 'number')
  );
}

/** Runs a handler and turns a deliberate GameError into a typed response. Anything else is a bug. */
export async function handle(fn: () => Promise<NextResponse> | NextResponse): Promise<NextResponse> {
  try {
    return await fn();
  } catch (error) {
    if (isGameError(error)) {
      const body: ApiErrorDto = { error: error.code, message: error.message };
      const available = error.extra.availableAt;
      if (typeof available === 'number') body.availableAt = available;
      const res = json(body, error.status);
      const current = error.extra.currentVersion;
      if (typeof current === 'number') res.headers.set('X-Current-Version', String(current));
      return res;
    }
    console.error('unhandled error in route', error);
    return json<ApiErrorDto>({ error: 'INTERNAL', message: 'something went wrong' }, 500);
  }
}
