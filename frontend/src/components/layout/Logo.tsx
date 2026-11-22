import { motion } from 'framer-motion';

/** Animated slime-mold logo: tubes grow out of the water source towards four fields. */
export function Logo({ size = 36, animate = true }: { size?: number; animate?: boolean }) {
  const tubes = [
    { d: 'M32 32 C26 26 20 20 13 15', w: 4.2, delay: 0.05 },
    { d: 'M32 32 C38 25 44 19 51 14', w: 3.2, delay: 0.2 },
    { d: 'M32 32 C38 39 43 45 49 50', w: 5, delay: 0.35 },
    { d: 'M32 32 C25 37 18 42 12 47', w: 2.6, delay: 0.5 },
    { d: 'M13 15 C24 6 40 6 51 14', w: 1.4, delay: 0.8 },
    { d: 'M49 50 C38 58 24 58 12 47', w: 1.4, delay: 0.95 },
  ];
  const nodes = [
    { cx: 13, cy: 15, c: '#2e9e4f' },
    { cx: 51, cy: 14, c: '#f2c230' },
    { cx: 49, cy: 50, c: '#d62f2f' },
    { cx: 12, cy: 47, c: '#f08a24' },
  ];
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden className="shrink-0 drop-shadow-[0_0_12px_rgba(250,204,21,0.35)]">
      <defs>
        <linearGradient id="logo-tube" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#fde047" />
          <stop offset="100%" stopColor="#eab308" />
        </linearGradient>
      </defs>
      <rect width="64" height="64" rx="16" fill="#0a1120" stroke="rgba(255,255,255,0.08)" />
      {tubes.map((t, i) => (
        <motion.path
          key={i}
          d={t.d}
          fill="none"
          stroke="url(#logo-tube)"
          strokeWidth={t.w}
          strokeLinecap="round"
          opacity={t.w < 2 ? 0.7 : 1}
          pathLength={1}
          strokeDasharray="1 1"
          initial={animate ? { strokeDashoffset: 1 } : false}
          animate={{ strokeDashoffset: 0 }}
          transition={{ duration: 0.9, delay: t.delay, ease: 'easeOut' }}
        />
      ))}
      {nodes.map((n, i) => (
        <motion.circle
          key={i}
          cx={n.cx}
          cy={n.cy}
          r={3.4}
          fill={n.c}
          initial={animate ? { scale: 0 } : false}
          animate={{ scale: 1 }}
          transition={{ delay: 0.5 + i * 0.12, type: 'spring', stiffness: 260, damping: 14 }}
        />
      ))}
      <motion.circle
        cx={32}
        cy={32}
        r={6.5}
        fill="#38bdf8"
        initial={{ r: 6.2 }}
        animate={{ r: [6.2, 7.4, 6.2] }}
        transition={{ duration: 2.6, repeat: Infinity, ease: 'easeInOut' }}
      />
      <circle cx={30} cy={30} r={2.2} fill="#e0f2fe" opacity={0.8} />
    </svg>
  );
}
