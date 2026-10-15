'use client';

import Link from 'next/link';
import type { AnchorHTMLAttributes, ButtonHTMLAttributes, ReactNode } from 'react';
import type { TierId } from '@/lib/types';
import { TIER_BLURBS, TIER_COLORS, TIER_GLYPHS, tierLabel } from '@/lib/tiers';

/** Rarity badge: an arcade pill with the tier's own gradient. Label and glyph carry meaning, not colour alone. */
export function RarityBadge({
  tier,
  size = 'md',
  animate = false,
}: {
  tier: TierId | null;
  size?: 'sm' | 'md' | 'lg';
  animate?: boolean;
}) {
  const sizes = {
    sm: 'px-3 py-1 text-xs',
    md: 'px-4 py-1.5 text-sm',
    lg: 'px-6 py-2.5 text-xl',
  }[size];
  if (tier === null) {
    return (
      <span
        className={`font-display inline-flex items-center rounded-full border-2 border-white/25 bg-white/10 font-extrabold uppercase tracking-widest text-slate-200 ${sizes}`}
      >
        No answer
      </span>
    );
  }
  const c = TIER_COLORS[tier];
  return (
    <span
      title={TIER_BLURBS[tier]}
      className={`font-display inline-flex items-center gap-2 rounded-full font-black uppercase tracking-widest ${sizes} ${animate ? 'stamp' : ''}`}
      style={{
        background: `linear-gradient(180deg, ${c.from}, ${c.to})`,
        color: c.ink,
        boxShadow: `0 4px 0 rgba(0,0,0,0.28), 0 0 24px ${c.glow}`,
      }}
    >
      <span aria-hidden="true" className="tracking-[0.2em]">
        {TIER_GLYPHS[tier]}
      </span>
      <span>{tierLabel(tier)}</span>
    </span>
  );
}

/** Kept so existing imports keep working. */
export const TierBadge = RarityBadge;

type ButtonVariant = 'primary' | 'lock' | 'secondary' | 'ghost';

function buttonClass(variant: ButtonVariant, large: boolean, extra: string): string {
  return `btn btn-${variant} ${large ? 'btn-lg' : ''} ${extra}`.trim();
}

export function Button({
  variant = 'secondary',
  large = false,
  className = '',
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant; large?: boolean }) {
  return <button type="button" className={buttonClass(variant, large, className)} {...rest} />;
}

/** A link that looks like a button, for navigation (a real anchor, so it works without scripting). */
export function ButtonLink({
  href,
  variant = 'secondary',
  large = false,
  className = '',
  children,
  ...rest
}: Omit<AnchorHTMLAttributes<HTMLAnchorElement>, 'href'> & {
  href: string;
  variant?: ButtonVariant;
  large?: boolean;
}) {
  return (
    <Link href={href} className={buttonClass(variant, large, className)} {...rest}>
      {children}
    </Link>
  );
}

export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <section className={`card-arcade p-5 sm:p-8 ${className}`}>{children}</section>;
}

export function Stat({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div>
      <div className="font-display text-xs font-extrabold uppercase tracking-widest text-sky-200/80">{label}</div>
      <div className="font-display text-3xl font-black text-white">{value}</div>
    </div>
  );
}

export function Notice({ tone = 'info', children }: { tone?: 'info' | 'error' | 'ok'; children: ReactNode }) {
  const style = {
    info: 'border-cyan-300/50 bg-cyan-400/15 text-cyan-50',
    error: 'border-rose-300/60 bg-rose-500/20 text-rose-50',
    ok: 'border-lime-300/60 bg-lime-400/15 text-lime-50',
  }[tone];
  return (
    <div
      role={tone === 'error' ? 'alert' : 'status'}
      className={`rounded-2xl border-2 px-4 py-3 text-sm font-semibold ${style}`}
    >
      {children}
    </div>
  );
}
