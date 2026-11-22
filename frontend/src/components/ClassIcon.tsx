import { CircleCheck, CircleDashed, Droplet, Droplets, TriangleAlert } from 'lucide-react';
import type { StressClass } from '../types';

/** Icons doubling the colour code (colour-blind safe): check, drop, drops, warning. */
export function ClassIcon({ cls, size = 14, className = '' }: { cls: StressClass | null; size?: number; className?: string }) {
  const props = { size, className, 'aria-hidden': true } as const;
  if (cls === null) return <CircleDashed {...props} />;
  if (cls === 0) return <CircleCheck {...props} />;
  if (cls === 1) return <Droplet {...props} />;
  if (cls === 2) return <Droplets {...props} />;
  return <TriangleAlert {...props} />;
}

export const NA_COLOR = '#64748b';

/** Hidden SVG <defs>: pattern fills for the four classes (solid, dots, stripes, cross-hatch). */
export function PatternDefs({ colors }: { colors: string[] }) {
  const [c0, c1, c2, c3] = colors;
  return (
    <svg width="0" height="0" style={{ position: 'absolute' }} aria-hidden focusable="false">
      <defs>
        <pattern id="pat-c0" patternUnits="userSpaceOnUse" width="10" height="10">
          <rect width="10" height="10" fill={c0} />
        </pattern>
        <pattern id="pat-c1" patternUnits="userSpaceOnUse" width="7" height="7">
          <rect width="7" height="7" fill={c1} />
          <circle cx="3.5" cy="3.5" r="1.25" fill="rgba(0,0,0,0.42)" />
        </pattern>
        <pattern id="pat-c2" patternUnits="userSpaceOnUse" width="7" height="7" patternTransform="rotate(45)">
          <rect width="7" height="7" fill={c2} />
          <rect width="2.4" height="7" fill="rgba(0,0,0,0.36)" />
        </pattern>
        <pattern id="pat-c3" patternUnits="userSpaceOnUse" width="7" height="7">
          <rect width="7" height="7" fill={c3} />
          <path d="M0 0L7 7M7 0L0 7" stroke="rgba(0,0,0,0.5)" strokeWidth="1.5" />
        </pattern>
        <pattern id="pat-na" patternUnits="userSpaceOnUse" width="6" height="6" patternTransform="rotate(45)">
          <rect width="6" height="6" fill="#334155" />
          <rect width="1.2" height="6" fill="rgba(226,232,240,0.28)" />
        </pattern>
      </defs>
    </svg>
  );
}

/** Small swatch that shows the class colour + its pattern. */
export function Swatch({ cls, patterns, colors, size = 18 }: { cls: StressClass | null; patterns: boolean; colors: string[]; size?: number }) {
  const fill = cls === null ? (patterns ? 'url(#pat-na)' : NA_COLOR) : patterns ? `url(#pat-c${cls})` : colors[cls];
  return (
    <svg width={size} height={size} viewBox="0 0 18 18" className="shrink-0 rounded-[5px]" aria-hidden>
      <rect width="18" height="18" rx="4" fill={fill} stroke="rgba(255,255,255,0.25)" />
    </svg>
  );
}
