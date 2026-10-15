import crypto from 'node:crypto';
import type { NextRequest } from 'next/server';
import { GameError } from '@/server/game/errors';
import { handle, json, runtime } from '@/server/runtime';

export const dynamic = 'force-dynamic';

/**
 * Sweep: finalizes every round that is due, oldest deadline first (§4.5). Every ordinary request
 * already does this lazily, so this endpoint is the backstop for rounds nobody is touching.
 * It is protected by CRON_SECRET and is disabled entirely when that variable is unset.
 */
export async function POST(req: NextRequest) {
  return handle(() => {
    const secret = process.env.CRON_SECRET;
    const given = req.headers.get('authorization') ?? '';
    const expected = `Bearer ${secret ?? ''}`;
    const a = Buffer.from(given);
    const b = Buffer.from(expected);
    if (!secret || a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
      throw new GameError('UNAUTHENTICATED', 'not allowed');
    }
    return json({ finalized: runtime().game.finalizeDue(5_000) });
  });
}
