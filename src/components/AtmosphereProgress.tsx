import { SPHERES } from '@/lib/altitude';

/**
 * The seven-layer progression, as a compact row of pips. The current layer is named; reached layers
 * are filled; the rest are dim. The count of pips is the question number, not the score, so it never
 * moves backwards and never depends on how well anyone is doing.
 */
export function AtmosphereProgress({
  current,
  className = '',
}: {
  /** 0-based index of the current layer (question 1 is 0). */
  current: number;
  className?: string;
}) {
  const index = Math.min(Math.max(0, current), SPHERES.length - 1);
  return (
    <div
      className={className}
      role="img"
      aria-label={`Layer ${index + 1} of ${SPHERES.length}: ${SPHERES[index]!.name}`}
    >
      <div className="flex items-center gap-1.5" aria-hidden="true">
        {SPHERES.map((s, i) => (
          <span
            key={s.id}
            className={`h-2.5 flex-1 rounded-full transition-all duration-700 ${
              i < index ? 'bg-white' : i === index ? 'scale-y-125 bg-stratos-lime shadow-[0_0_12px_#b8f23a]' : 'bg-white/25'
            }`}
          />
        ))}
      </div>
      <div className="mt-1.5 flex justify-between font-display text-[0.65rem] font-extrabold uppercase tracking-widest text-white/80" aria-hidden="true">
        <span>{SPHERES[0]!.name}</span>
        <span className="text-stratos-lime">{SPHERES[index]!.name}</span>
        <span>{SPHERES[SPHERES.length - 1]!.name}</span>
      </div>
    </div>
  );
}
