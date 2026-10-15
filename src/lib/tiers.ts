import type { TierId } from '@/domain/scoring';

// Display copy for the six tiers. COPY ONLY: scoring and storage use the numeric TierId, so
// renaming a tier is a one-line change here (ARCHITECTURE.md §8.2).
//
// The labels describe how RARE an answer is. They deliberately do not reuse the atmosphere layers
// (Troposphere, Stratosphere...), which describe how HIGH the player has climbed, so the two
// ideas never compete. Every blurb is worded as an estimate: a tier says how common an answer was
// among the players scored before you, not that it was literally unique. Hence "Singular", not
// "Unique", and no blurb says "nobody".
//
// NOTE FOR THE OWNER: "Rare" also appears in Krillion's published tier names. It is kept because it
// is the plain word for tier 3; change it here if a fully original vocabulary is wanted.

export const TIER_LABELS: Readonly<Record<TierId, string>> = {
  1: 'Familiar',
  2: 'Uncommon',
  3: 'Rare',
  4: 'Obscure',
  5: 'Exceptional',
  6: 'Singular',
};

export const TIER_BLURBS: Readonly<Record<TierId, string>> = {
  1: 'Most players think of this first.',
  2: 'Familiar, but not the first thing most people say.',
  3: 'Fewer players land here.',
  4: 'A distinctive answer that few players gave.',
  5: 'Very few players gave this answer.',
  6: 'Close to the rarest answer anyone gave.',
};

/**
 * Arcade colours for each tier, cool to hot as rarity rises. `ink` is the text colour that stays
 * readable on that tier's gradient. Colour is never the only cue: the label and glyph carry the
 * meaning too.
 */
export const TIER_COLORS: Readonly<
  Record<TierId, { from: string; to: string; glow: string; ink: string }>
> = {
  1: { from: '#4ade80', to: '#16a34a', glow: 'rgba(74, 222, 128, 0.55)', ink: '#052e16' },
  2: { from: '#2dd4bf', to: '#0d9488', glow: 'rgba(45, 212, 191, 0.55)', ink: '#042f2e' },
  3: { from: '#60a5fa', to: '#2563eb', glow: 'rgba(96, 165, 250, 0.6)', ink: '#ffffff' },
  4: { from: '#a78bfa', to: '#6d28d9', glow: 'rgba(167, 139, 250, 0.65)', ink: '#ffffff' },
  5: { from: '#fdba74', to: '#f97316', glow: 'rgba(251, 146, 60, 0.7)', ink: '#2a1204' },
  6: { from: '#fde047', to: '#f59e0b', glow: 'rgba(250, 204, 21, 0.8)', ink: '#2a1b02' },
};

/** A non-colour cue for each tier (the UI must not rely on colour alone). */
export const TIER_GLYPHS: Readonly<Record<TierId, string>> = {
  1: '\u25CF',
  2: '\u25CF\u25CF',
  3: '\u25C6',
  4: '\u25C6\u25C6',
  5: '\u2605',
  6: '\u2605\u2605',
};

/** Spoiler-free emoji for the share card: a square per question, deeper blue is rarer. */
export const TIER_SHARE_SQUARES: Readonly<Record<TierId, string>> = {
  1: '\u2B1C',
  2: '\uD83D\uDFE6',
  3: '\uD83D\uDFE6',
  4: '\uD83D\uDFE6',
  5: '\uD83D\uDFEA',
  6: '\uD83D\uDFE8',
};

export function tierLabel(tier: TierId | null): string {
  return tier === null ? 'No answer' : TIER_LABELS[tier];
}
