import type { NextRequest } from 'next/server';
import { GameError } from '@/server/game/errors';
import { attachIdentity, ensurePlayer, handle, json, readJson, runtime } from '@/server/runtime';

export const dynamic = 'force-dynamic';

/** Start or resume a dive. Resuming a ranked daily returns the same session (§4.6). */
export async function POST(req: NextRequest) {
  return handle(async () => {
    const body = await readJson(req);
    const mode = body.mode;
    if (mode !== 'daily' && mode !== 'practice') throw new GameError('INVALID', 'mode must be daily or practice');
    const { playerId, newToken } = ensurePlayer(req);
    const view = runtime().game.startSession(playerId, mode);
    return attachIdentity(json(view), newToken);
  });
}
