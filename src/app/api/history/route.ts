import type { NextRequest } from 'next/server';
import { handle, json, requirePlayer, runtime } from '@/server/runtime';

export const dynamic = 'force-dynamic';

/** The caller's own past dives, ranked and practice, newest first. */
export async function GET(req: NextRequest) {
  return handle(() => json(runtime().game.history(requirePlayer(req))));
}
