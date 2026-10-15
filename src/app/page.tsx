import { Rocket } from '@/components/Rocket';
import { Shell } from '@/components/Shell';
import { ButtonLink, Card } from '@/components/ui';
import { TIER_POINTS } from '@/domain/scoring';
import { SPHERES } from '@/lib/altitude';
import { TIER_BLURBS, TIER_GLYPHS, TIER_LABELS } from '@/lib/tiers';
import type { TierId } from '@/lib/types';
import { RarityBadge } from '@/components/ui';

const TIERS: TierId[] = [1, 2, 3, 4, 5, 6];

export default function HomePage() {
  return (
    <Shell sphere={0} darkness={0.05}>
      <section className="reveal-in relative pt-4 text-center sm:pt-10">
        <div className="mx-auto mb-2 flex justify-center">
          <Rocket mode="idle" power={0.5} size={64} />
        </div>
        <h1 className="font-display text-gradient-sky text-6xl font-black uppercase tracking-[0.18em] [filter:drop-shadow(0_4px_0_rgba(20,20,90,0.55))] sm:text-8xl">
          Stratos
        </h1>
        <p className="font-display text-gradient-hot mt-3 text-2xl font-black sm:text-3xl">Know the rare. Rise higher.</p>
        <p className="mx-auto mt-4 max-w-xl text-lg font-semibold text-white [text-shadow:0_2px_12px_rgba(3,5,40,0.75)]">
          Seven questions. Sixty seconds each. The rarer your answer, the higher it launches you, from the surface of
          the Earth to the edge of space.
        </p>

        <div className="mt-8 flex flex-col items-center justify-center gap-4 sm:flex-row">
          <ButtonLink href="/play/daily" variant="primary" large>
            Start Daily Climb
          </ButtonLink>
          <ButtonLink href="/play/practice" variant="secondary">
            Practice mode
          </ButtonLink>
        </div>
        <p className="mt-4 text-sm font-semibold text-white/90 [text-shadow:0_1px_8px_rgba(3,5,40,0.75)]">
          No sign-up. The daily climb resets at midnight UTC.
        </p>
      </section>

      <ul className="mt-12 grid gap-3 sm:grid-cols-3">
        {[
          ['7', 'questions a climb', 'One open answer each. No choices, no hints.'],
          ['60s', 'per question', 'The clock starts the moment a question appears.'],
          ['1 pt = 1 km', 'of altitude', 'A perfect climb is 700 points: 700 km.'],
        ].map(([big, small, text]) => (
          <li key={small} className="card-arcade p-5 text-center">
            <div className="font-display text-gradient-hot text-4xl font-black">{big}</div>
            <div className="font-display mt-1 text-xs font-extrabold uppercase tracking-widest text-sky-100">{small}</div>
            <p className="mt-2 text-sm text-sky-50/90">{text}</p>
          </li>
        ))}
      </ul>

      <Card className="mt-6">
        <h2 className="font-display text-2xl font-black text-white">How it works</h2>
        <ol className="mt-4 list-decimal space-y-2 pl-5 text-sky-50">
          <li>Read the question and type one answer.</li>
          <li>
            The first answer we can read <b>locks</b> the question. Spelling slips are corrected for you; an answer we
            cannot read does not use up your turn.
          </li>
          <li>Your rocket launches. The rarer your answer among earlier players, the bigger the launch.</li>
          <li>You only see your tier and points once your answer is locked.</li>
        </ol>
      </Card>

      <Card className="mt-6">
        <h2 className="font-display text-2xl font-black text-white">Seven layers of sky</h2>
        <p className="mt-2 text-sm text-sky-100/90">
          Each question is asked in its own layer, and the sky darkens as you rise.
        </p>
        <ol className="mt-4 grid gap-2 sm:grid-cols-2">
          {SPHERES.map((s, i) => (
            <li key={s.id} className="flex items-center gap-3 rounded-2xl bg-white/5 px-3 py-2">
              <span
                className="font-display flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-sm font-black text-slate-950"
                style={{ background: `linear-gradient(180deg, ${s.skyBottom}, ${s.glow})` }}
              >
                {i + 1}
              </span>
              <span>
                <span className="font-display block font-black text-white">{s.name}</span>
                <span className="block text-xs text-sky-100/80">{s.blurb}</span>
              </span>
            </li>
          ))}
        </ol>
      </Card>

      <Card className="mt-6">
        <h2 className="font-display text-2xl font-black text-white">Six tiers of rare</h2>
        <ul className="mt-4 space-y-3">
          {TIERS.map((tier) => (
            <li key={tier} className="flex flex-wrap items-center justify-between gap-3">
              <span className="flex flex-wrap items-center gap-3">
                <RarityBadge tier={tier} />
                <span className="text-sm text-sky-100/90">{TIER_BLURBS[tier]}</span>
              </span>
              <span className="font-display text-xl font-black tabular-nums text-white">{TIER_POINTS[tier]} pts</span>
              <span className="sr-only">
                {TIER_LABELS[tier]} {TIER_GLYPHS[tier]}
              </span>
            </li>
          ))}
        </ul>
        <p className="mt-4 text-xs text-sky-100/75">
          Tiers are an estimate of how common an answer was among the players scored before you. They depend on how
          many people have played, and they never mean an answer was literally one of a kind.
        </p>
      </Card>

      <p className="font-display mt-8 text-center text-sm font-bold text-white [text-shadow:0_1px_8px_rgba(3,5,40,0.75)]">
        <a href="/leaderboard" className="text-stratos-lime underline">
          Today{'\u2019'}s leaderboard
        </a>
        {' \u00B7 '}
        <a href="/history" className="text-stratos-lime underline">
          Your climbs
        </a>
      </p>
    </Shell>
  );
}
