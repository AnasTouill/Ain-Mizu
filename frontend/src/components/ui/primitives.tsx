import { animate, motion, useMotionValue, useSpring, useTransform } from 'framer-motion';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { fmtNumber } from '../../lib/format';
import type { Lang } from '../../types';

/** Shimmering placeholder. */
export function Skeleton({ className = '' }: { className?: string }) {
  return <div className={`skeleton rounded-xl ${className}`} aria-hidden />;
}

/** Glass panel with an optional title row. */
export function Panel({
  title,
  icon,
  actions,
  className = '',
  children,
}: {
  title?: ReactNode;
  icon?: ReactNode;
  actions?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  return (
    <section className={`glass p-4 ${className}`}>
      {(title || actions) && (
        <div className="mb-3 flex items-center gap-2">
          {icon && <span className="text-water-300">{icon}</span>}
          {title && <h2 className="label">{title}</h2>}
          {actions && <div className="ms-auto flex items-center gap-2">{actions}</div>}
        </div>
      )}
      {children}
    </section>
  );
}

/** Card that tilts in 3D towards the pointer, with a moving glare. */
export function TiltCard({ children, className = '', max = 9 }: { children: ReactNode; className?: string; max?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const px = useMotionValue(0.5);
  const py = useMotionValue(0.5);
  const rx = useSpring(useTransform(py, [0, 1], [max, -max]), { stiffness: 220, damping: 18 });
  const ry = useSpring(useTransform(px, [0, 1], [-max, max]), { stiffness: 220, damping: 18 });
  const glare = useTransform([px, py], ([x, y]: number[]) =>
    `radial-gradient(420px circle at ${x * 100}% ${y * 100}%, rgba(31,128,150,0.07), transparent 45%)`,
  );
  return (
    <motion.div
      ref={ref}
      onPointerMove={(e) => {
        const r = ref.current?.getBoundingClientRect();
        if (!r) return;
        px.set((e.clientX - r.left) / r.width);
        py.set((e.clientY - r.top) / r.height);
      }}
      onPointerLeave={() => {
        px.set(0.5);
        py.set(0.5);
      }}
      style={{ rotateX: rx, rotateY: ry, transformPerspective: 900, transformStyle: 'preserve-3d' }}
      className={`relative ${className}`}
    >
      {children}
      <motion.div className="pointer-events-none absolute inset-0 rounded-2xl" style={{ background: glare }} />
    </motion.div>
  );
}

/** Number that counts smoothly to its new value. */
export function AnimatedNumber({ value, lang, digits = 0, suffix = '' }: { value: number | null | undefined; lang: Lang; digits?: number; suffix?: string }) {
  const [display, setDisplay] = useState<number | null>(value ?? null);
  const prev = useRef<number>(value ?? 0);
  useEffect(() => {
    if (value === null || value === undefined) {
      setDisplay(null);
      return;
    }
    const controls = animate(prev.current, value, {
      duration: 0.9,
      ease: [0.22, 1, 0.36, 1],
      onUpdate: (v) => setDisplay(v),
    });
    prev.current = value;
    return () => controls.stop();
  }, [value]);
  return (
    <span className="tabular-nums">
      {display === null ? '–' : fmtNumber(display, lang, digits)}
      {display === null ? '' : suffix}
    </span>
  );
}

/** Circular gauge (0..100) with an animated stroke. */
export function Ring({ value, color = '#38bdf8', size = 64, stroke = 7 }: { value: number; color?: string; size?: number; stroke?: number }) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const v = Math.max(0, Math.min(100, value || 0));
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="-rotate-90">
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="rgba(148,163,184,0.15)" strokeWidth={stroke} />
      <motion.circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        fill="none"
        stroke={color}
        strokeWidth={stroke}
        strokeLinecap="round"
        strokeDasharray={c}
        initial={{ strokeDashoffset: c }}
        animate={{ strokeDashoffset: c * (1 - v / 100) }}
        transition={{ duration: 1, ease: [0.22, 1, 0.36, 1] }}
        style={{ filter: `drop-shadow(0 0 6px ${color})` }}
      />
    </svg>
  );
}

/** Accessible segmented control with a sliding indicator. */
export function Segmented<T extends string | number>({
  options,
  value,
  onChange,
  layoutId,
  size = 'md',
  ariaLabel,
}: {
  options: { value: T; label: ReactNode; title?: string; disabled?: boolean }[];
  value: T;
  onChange: (v: T) => void;
  layoutId: string;
  size?: 'sm' | 'md';
  ariaLabel?: string;
}) {
  return (
    <div className="flex rounded-xl border border-white/10 bg-ink-950/60 p-1" role="radiogroup" aria-label={ariaLabel}>
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={String(o.value)}
            role="radio"
            aria-checked={active}
            title={o.title}
            disabled={o.disabled}
            onClick={() => onChange(o.value)}
            className={`relative flex flex-1 items-center justify-center gap-1.5 rounded-lg font-semibold transition disabled:opacity-40 ${
              size === 'sm' ? 'px-2 py-1 text-xs' : 'px-2.5 py-1.5 text-sm'
            } ${active ? 'text-ink-950' : 'text-slate-300 hover:text-white'}`}
          >
            {active && (
              <motion.span
                layoutId={layoutId}
                className="absolute inset-0 rounded-lg bg-water-400 shadow-glow"
                transition={{ type: 'spring', stiffness: 420, damping: 32 }}
              />
            )}
            <span className="relative flex items-center gap-1.5">{o.label}</span>
          </button>
        );
      })}
    </div>
  );
}

/** Small toggle switch row. */
export function Toggle({ checked, onChange, label, icon }: { checked: boolean; onChange: () => void; label: ReactNode; icon?: ReactNode }) {
  return (
    <button
      role="switch"
      aria-checked={checked}
      onClick={onChange}
      className="group flex w-full items-center gap-2.5 rounded-xl px-2 py-1.5 text-start text-sm text-slate-200 transition hover:bg-white/5"
    >
      {icon && <span className={checked ? 'text-water-300' : 'text-slate-500'}>{icon}</span>}
      <span className="flex-1">{label}</span>
      <span className={`relative h-5 w-9 shrink-0 rounded-full transition ${checked ? 'bg-water-500/80' : 'bg-slate-600/60'}`}>
        <motion.span
          layout
          transition={{ type: 'spring', stiffness: 500, damping: 30 }}
          className={`absolute top-0.5 h-4 w-4 rounded-full bg-paper shadow ${checked ? 'end-0.5' : 'start-0.5'}`}
        />
      </span>
    </button>
  );
}
