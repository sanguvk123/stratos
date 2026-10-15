import type { NextRequest } from 'next/server';
import { currentPlayer, handle, json, runtime } from '@/server/runtime';

export const dynamic = 'force-dynamic';

/** Public. Finalized, completed ranked dives only. Highlights the viewer when they have a cookie. */
export async function GET(req: NextRequest) {
  return handle(() => {
    const date = req.nextUrl.searchParams.get('date') ?? undefined;
    return json(runtime().game.leaderboard(currentPlayer(req), date));
  });
}
