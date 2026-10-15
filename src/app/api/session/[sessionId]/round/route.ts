import type { NextRequest } from 'next/server';
import { GameError } from '@/server/game/errors';
import { handle, json, readJson, requirePlayer, runtime } from '@/server/runtime';

export const dynamic = 'force-dynamic';

/** Issues a question. Idempotent: asking again returns the same round and the same deadline. */
export async function POST(req: NextRequest, { params }: { params: { sessionId: string } }) {
  return handle(async () => {
    const playerId = requirePlayer(req);
    const body = await readJson(req);
    const index = body.questionIndex;
    if (typeof index !== 'number' || !Number.isInteger(index)) {
      throw new GameError('INVALID', 'questionIndex must be an integer');
    }
    return json(runtime().game.issueRound(playerId, params.sessionId, index));
  });
}
