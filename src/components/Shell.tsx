import Link from 'next/link';
import type { ReactNode } from 'react';
import { SkyScene, type SkySceneProps } from './SkyScene';

/** Page frame: the sky, a compact wordmark header and a main landmark. */
export function Shell({
  children,
  wide = false,
  ...sky
}: { children: ReactNode; wide?: boolean } & SkySceneProps) {
  return (
    <>
      <SkyScene {...sky} />
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-full focus:bg-stratos-lime focus:px-4 focus:py-2 focus:text-slate-950"
      >
        Skip to content
      </a>
      <header className="mx-auto flex max-w-3xl items-center justify-between px-5 py-4 [text-shadow:0_2px_10px_rgba(3,5,40,0.7)]">
        <Link
          href="/"
          className="font-display text-xl font-black uppercase tracking-[0.3em] text-white"
          aria-label="Stratos home"
        >
          Stratos
        </Link>
        <nav aria-label="Main" className="flex items-center gap-1 font-display text-sm font-bold text-white">
          <Link className="rounded-full px-3 py-2 hover:bg-white/15" href="/leaderboard">
            Leaderboard
          </Link>
          <Link className="rounded-full px-3 py-2 hover:bg-white/15" href="/history">
            History
          </Link>
        </nav>
      </header>
      <main id="main" className={`mx-auto px-5 pb-20 ${wide ? 'max-w-5xl' : 'max-w-3xl'}`}>
        {children}
      </main>
    </>
  );
}
