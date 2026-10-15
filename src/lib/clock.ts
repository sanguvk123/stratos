// The countdown is PRESENTATION ONLY. It never decides whether an answer counts: the server does,
// with its own clock, at the moment the answer arrives (ARCHITECTURE.md §4.5, §11.2). A browser
// whose clock is wrong can therefore make the timer look off, but cannot gain or lose time.
//
// To keep the display honest, the browser measures its offset from the server clock using each API
// response's `serverNow`, and shows `closesAt - (Date.now() + offset)`.

export function clockOffset(serverNow: number, receivedAtLocal: number = Date.now()): number {
  return serverNow - receivedAtLocal;
}

/** Whole seconds remaining, rounded up, never negative. */
export function secondsLeft(closesAt: number, offset: number, localNow: number = Date.now()): number {
  return Math.max(0, Math.ceil((closesAt - (localNow + offset)) / 1000));
}

export function formatClock(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export function formatMetres(metres: number): string {
  return `${metres.toLocaleString('en-US')} m`;
}
