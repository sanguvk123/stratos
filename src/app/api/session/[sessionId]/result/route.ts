import type { NextRequest } from 'next/server';
import { handle, json, requirePlayer, runtime } from '@/server/runtime';

export const dynamic = 'force-dynamic';

/** The final result of a completed dive: totals, breakdown, rank and a spoiler-free share card. */
export async function GET(req: NextRequest, { params }: { params: { sessionId: string } }) {
  return handle(() => json(runtime().game.getFinalResult(requirePlayer(req), params.sessionId)));
}
