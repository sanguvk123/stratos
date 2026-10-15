import { SPHERES, boostStrength, revealLevel } from '@/lib/altitude';
import { revealTimeline } from '@/lib/motion';
import { Rocket } from './Rocket';

// The ascent backdrop. Pure CSS and SVG: no images, no canvas, no timers and no hooks, so it renders
// on the server and costs nothing when idle. It uses transform and opacity only, and never a blur
// filter.
//
//   - One gradient layer per sphere, each with its own horizon glow. They cross-fade, so moving up
//     a layer is a slow dissolve rather than a swap.
//   - `darkness` (0..1) lays navy over the sky, and stars fade in as it rises.
//   - Clouds fall past (the climber is the one going up) and thin out with height.
//   - The Earth sits at the bottom: green and close at the surface, then a blue curve with an
//     atmosphere rim that shrinks into the distance.
//   - The rocket idles bottom right. When an answer locks, `boostKey` changes and a launch plays:
//     speed lines, sparks and a flash, with length, count and brightness set by the points.

export interface SkySceneProps {
  /** Which sphere the climber is in: 0 is the surface. */
  sphere?: number;
  /** 0 (bright day) .. 1 (black space). */
  darkness?: number;
  /** Points of the answer that triggered this launch, or null for none. */
  boostPoints?: number | null;
  /** Change this to replay the launch animation. */
  boostKey?: number;
  /** The rocket is hidden on screens where it would crowd the page. */
  showRocket?: boolean;
}

function clamp01(x: number): number {
  return Math.min(1, Math.max(0, x));
}

const CLOUDS = [
  { left: 4, top: 8, w: 38, h: 15, dur: 52, delay: -10, far: false },
  { left: 56, top: 26, w: 42, h: 16, dur: 66, delay: -36, far: false },
  { left: 28, top: 52, w: 34, h: 13, dur: 46, delay: -22, far: false },
  { left: 74, top: 70, w: 36, h: 14, dur: 58, delay: -4, far: false },
  { left: -8, top: 82, w: 44, h: 17, dur: 72, delay: -48, far: false },
  { left: 40, top: 2, w: 28, h: 11, dur: 40, delay: -18, far: true },
  { left: 12, top: 38, w: 26, h: 10, dur: 84, delay: -60, far: true },
  { left: 66, top: 90, w: 30, h: 12, dur: 78, delay: -30, far: true },
] as const;

const SPARK_COLORS = ['#ffd84a', '#ff8a3d', '#ff6b57', '#b8f23a', '#7fe3ff', '#d9b8ff'];

export function SkyScene({
  sphere = 0,
  darkness = 0,
  boostPoints = null,
  boostKey = 0,
  showRocket = true,
}: SkySceneProps) {
  const last = SPHERES.length - 1;
  const index = Math.min(Math.max(0, Math.round(sphere)), last);
  const dark = clamp01(darkness);
  const starOpacity = clamp01((dark - 0.18) * 1.7);
  const farStarOpacity = clamp01((dark - 0.4) * 2);
  const cloudOpacity = clamp01(1 - index / 4);
  const greenEarth = clamp01(1 - index / 2.5);
  const blueEarth = 1 - greenEarth;
  // The visible height of the Earth, in vh, shrinks as the climber rises.
  const earthVisible = 20 - (15 * index) / last;

  const strength = boostPoints === null ? 0 : boostStrength(boostPoints);
  const timeline = boostPoints === null ? null : revealTimeline(revealLevel(boostPoints));
  const seconds = timeline ? timeline.launchSeconds.toFixed(2) : '2';
  const launching = timeline !== null;

  return (
    <div aria-hidden="true" className="pointer-events-none fixed inset-0 -z-10 overflow-hidden bg-[#04051a]">
      {SPHERES.map((s, i) => (
        <div
          key={s.id}
          className="absolute inset-0 transition-opacity"
          style={{
            opacity: i === index ? 1 : 0,
            transitionDuration: 'var(--dur-sky)',
            background: `radial-gradient(120% 55% at 50% 100%, ${s.glow}66 0%, transparent 62%), linear-gradient(to bottom, ${s.skyTop} 0%, ${s.skyBottom} 100%)`,
          }}
        />
      ))}

      <div className="stars absolute inset-0 transition-opacity" style={{ opacity: starOpacity, transitionDuration: 'var(--dur-sky)' }} />
      <div className="stars-far absolute inset-0 transition-opacity" style={{ opacity: farStarOpacity, transitionDuration: 'var(--dur-sky)' }} />

      <div className="absolute inset-0 transition-opacity" style={{ opacity: cloudOpacity, transitionDuration: 'var(--dur-sky)' }}>
        {CLOUDS.map((c, i) => (
          <div
            key={i}
            className={`cloud absolute ${c.far ? 'cloud-far' : ''}`}
            style={{
              left: `${c.left}%`,
              top: `${c.top}%`,
              width: `${c.w}vw`,
              height: `${c.h}vh`,
              animationDuration: `${c.dur}s`,
              animationDelay: `${c.delay}s`,
            }}
          />
        ))}
      </div>

      {/* The Earth: a huge circle whose top edge is the horizon. */}
      <div
        className="absolute left-1/2 aspect-square w-[260vw] -translate-x-1/2 rounded-full transition-[top]"
        style={{ top: `calc(100% - ${earthVisible}vh)`, transitionDuration: 'var(--dur-sky)' }}
      >
        <div
          className="absolute inset-0 rounded-full transition-opacity"
          style={{
            opacity: greenEarth,
            transitionDuration: 'var(--dur-sky)',
            background: 'radial-gradient(circle at 50% 0%, #6cc04a 0%, #3f9a45 16%, #226b3a 46%, #123d27 100%)',
          }}
        />
        <div
          className="absolute inset-0 rounded-full transition-opacity"
          style={{
            opacity: blueEarth,
            transitionDuration: 'var(--dur-sky)',
            background: 'radial-gradient(circle at 50% 0%, #5cb4ff 0%, #2a74e0 12%, #123c9c 42%, #081a52 100%)',
            boxShadow: '0 0 70px 12px rgba(125, 190, 255, 0.6), inset 0 6px 24px rgba(180, 225, 255, 0.55)',
          }}
        />
      </div>

      {/* Navy laid over everything below: the higher you are, the darker. */}
      <div
        className="absolute inset-0 bg-[#04051a] transition-opacity"
        style={{ opacity: dark * 0.5, transitionDuration: 'var(--dur-sky)' }}
      />

      {launching && timeline ? (
        <div key={boostKey} className="absolute inset-0" style={{ ['--launch-seconds' as string]: `${seconds}s` }}>
          <div className="boost-flash absolute inset-0 bg-white" style={{ opacity: 0.12 + 0.28 * strength }} />
          {Array.from({ length: timeline.speedLines }, (_, i) => (
            <div
              key={`l${i}`}
              className="speed-line absolute top-0 w-[3px] rounded-full bg-gradient-to-b from-transparent via-white to-transparent"
              style={{
                left: `${(i * 37 + 11) % 100}%`,
                height: `${16 + ((i * 13) % 28)}vh`,
                opacity: 0.35 + 0.5 * strength,
                animationDelay: `${((i * 7) % 10) * 0.04}s`,
              }}
            />
          ))}
          {Array.from({ length: timeline.sparks }, (_, i) => (
            <div
              key={`s${i}`}
              className="spark absolute"
              style={{
                left: `${6 + ((i * 53) % 88)}%`,
                bottom: `${((i * 17) % 22)}vh`,
                width: `${6 + (i % 3) * 3}px`,
                height: `${6 + (i % 3) * 3}px`,
                background: SPARK_COLORS[i % SPARK_COLORS.length],
                animationDelay: `${((i * 5) % 9) * 0.05}s`,
              }}
            />
          ))}
        </div>
      ) : null}

      {showRocket ? (
        <div className="absolute bottom-[6vh] right-[5vw]" style={{ ['--launch-seconds' as string]: `${seconds}s` }}>
          {launching ? (
            <Rocket key={boostKey} mode="launch" power={strength} size={52} className="hidden sm:block" />
          ) : (
            <Rocket mode="idle" power={0.25} size={52} className="hidden sm:block" />
          )}
        </div>
      ) : null}
    </div>
  );
}
