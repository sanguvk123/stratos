import type { NextRequest } from 'next/server';
import { handle, json, requirePlayer, runtime } from '@/server/runtime';

export const dynamic = 'force-dynamic';

/** Authoritative state for a session. A reconnect or refresh calls this and gets the original deadline. */
export async function GET(req: NextRequest, { params }: { params: { sessionId: string } }) {
  return handle(() => json(runtime().game.getView(requirePlayer(req), params.sessionId)));
}
