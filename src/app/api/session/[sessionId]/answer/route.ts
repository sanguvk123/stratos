import type { NextRequest } from 'next/server';
import { GameError } from '@/server/game/errors';
import { handle, json, readJson, requirePlayer, runtime } from '@/server/runtime';

export const dynamic = 'force-dynamic';

/**
 * Submit the answer. A matching answer (after spelling auto-correction) locks the question and the
 * response carries the FINAL result. The server decides lateness, validity and the score; the
 * client decides nothing.
 */
export async function POST(req: NextRequest, { params }: { params: { sessionId: string } }) {
  return handle(async () => {
    const playerId = requirePlayer(req);
    const body = await readJson(req);
    const { roundId, rawText, requestId } = body;
    if (typeof roundId !== 'string' || typeof rawText !== 'string' || typeof requestId !== 'string') {
      throw new GameError('INVALID', 'roundId, rawText and requestId are required');
    }
    return json(runtime().game.submitAnswer(playerId, params.sessionId, { roundId, rawText, requestId }));
  });
}
