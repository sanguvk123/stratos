'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { clockOffset, secondsLeft } from './clock';

/**
 * A ticking "seconds left" value for a server deadline. `sync` is called with the `serverNow` of
 * every API response so the offset keeps correcting itself. Pure presentation: see clock.ts.
 */
export function useServerClock(closesAt: number | null) {
  const offset = useRef(0);
  const [left, setLeft] = useState<number | null>(null);

  const sync = useCallback((serverNow: number) => {
    offset.current = clockOffset(serverNow);
  }, []);

  useEffect(() => {
    if (closesAt === null) {
      setLeft(null);
      return;
    }
    const tick = () => setLeft(secondsLeft(closesAt, offset.current));
    tick();
    const id = window.setInterval(tick, 250);
    return () => window.clearInterval(id);
  }, [closesAt]);

  return { left, sync, offset };
}
