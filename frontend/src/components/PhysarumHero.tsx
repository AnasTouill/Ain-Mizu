import { motion, useMotionValue, useSpring } from 'framer-motion';
import { useEffect, useRef } from 'react';

/**
 * Agent-based Physarum polycephalum simulation (Jones 2010): thousands of agents sense the
 * chemo-attractant trail ahead, turn towards it, move and deposit; the trail diffuses and decays.
 * "Food" (the three zones and neighbouring towns, placed by their real lon/lat) keeps emitting
 * attractant, so the mold grows a transport network between them. Rendered on a canvas tilted in 3D.
 */
const W = 300;
const H = 210;
const N_AGENTS = 9000;
const BBOX = { lon0: 7.9, lon1: 11.0, lat0: 33.4, lat1: 36.2 };
export const HERO_FOOD: { name: string; lon: number; lat: number; zone?: boolean }[] = [
  { name: 'Kairouan', lon: 10.1, lat: 35.68, zone: true },
  { name: 'Sidi Bouzid', lon: 9.49, lat: 35.04, zone: true },
  { name: 'Kebili', lon: 8.97, lat: 33.7, zone: true },
  { name: 'Gafsa', lon: 8.78, lat: 34.42 },
  { name: 'Tozeur', lon: 8.13, lat: 33.92 },
  { name: 'Sfax', lon: 10.76, lat: 34.74 },
  { name: 'Gabès', lon: 10.1, lat: 33.88 },
  { name: 'Kasserine', lon: 8.84, lat: 35.17 },
];
const toGrid = (lon: number, lat: number): [number, number] => [
  ((lon - BBOX.lon0) / (BBOX.lon1 - BBOX.lon0)) * W,
  ((BBOX.lat1 - lat) / (BBOX.lat1 - BBOX.lat0)) * H,
];

function palette(): Uint8ClampedArray {
  const lut = new Uint8ClampedArray(256 * 3);
  const stops: [number, [number, number, number]][] = [
    // washi paper -> sand -> olive grove -> Ain-Mizu teal -> deep oasis water
    [0, [250, 248, 245]],
    [0.22, [226, 218, 196]],
    [0.5, [128, 146, 96]],
    [0.78, [31, 128, 150]],
    [1, [12, 66, 80]],
  ];
  for (let i = 0; i < 256; i++) {
    const v = i / 255;
    let k = 0;
    while (k < stops.length - 2 && v > stops[k + 1][0]) k++;
    const [a, ca] = stops[k];
    const [b, cb] = stops[k + 1];
    const t = (v - a) / (b - a);
    for (let c = 0; c < 3; c++) lut[i * 3 + c] = ca[c] + (cb[c] - ca[c]) * t;
  }
  return lut;
}

export default function PhysarumHero({ caption }: { caption: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const rx = useSpring(useMotionValue(50), { stiffness: 60, damping: 14 });
  const rz = useSpring(useMotionValue(-10), { stiffness: 60, damping: 14 });

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    canvas.width = W;
    canvas.height = H;
    const trail = new Float32Array(W * H);
    const next = new Float32Array(W * H);
    const ax = new Float32Array(N_AGENTS);
    const ay = new Float32Array(N_AGENTS);
    const ah = new Float32Array(N_AGENTS);
    const food = HERO_FOOD.map((f) => toGrid(f.lon, f.lat));
    for (let i = 0; i < N_AGENTS; i++) {
      const [fx, fy] = food[i % food.length];
      const r = Math.random() * 18;
      const a = Math.random() * Math.PI * 2;
      ax[i] = (fx + Math.cos(a) * r + W) % W;
      ay[i] = (fy + Math.sin(a) * r + H) % H;
      ah[i] = Math.random() * Math.PI * 2;
    }
    const lut = palette();
    const img = ctx.createImageData(W, H);
    const SA = 0.45;
    const SO = 8;
    const RA = 0.4;
    const sense = (x: number, y: number) => {
      const ix = ((Math.floor(x) % W) + W) % W;
      const iy = ((Math.floor(y) % H) + H) % H;
      return trail[iy * W + ix];
    };
    let raf = 0;
    let visible = true;
    const io = new IntersectionObserver(([e]) => (visible = e.isIntersecting));
    io.observe(canvas);

    const step = () => {
      raf = requestAnimationFrame(step);
      if (!visible || document.hidden) return;
      for (const [fx, fy] of food) {
        for (let dy = -2; dy <= 2; dy++)
          for (let dx = -2; dx <= 2; dx++) {
            const x = Math.round(fx) + dx;
            const y = Math.round(fy) + dy;
            if (x >= 0 && x < W && y >= 0 && y < H) trail[y * W + x] += 4;
          }
      }
      for (let i = 0; i < N_AGENTS; i++) {
        const h = ah[i];
        const f = sense(ax[i] + Math.cos(h) * SO, ay[i] + Math.sin(h) * SO);
        const l = sense(ax[i] + Math.cos(h - SA) * SO, ay[i] + Math.sin(h - SA) * SO);
        const r = sense(ax[i] + Math.cos(h + SA) * SO, ay[i] + Math.sin(h + SA) * SO);
        if (f < l && f < r) ah[i] += (Math.random() < 0.5 ? -1 : 1) * RA;
        else if (l > r) ah[i] -= RA;
        else if (r > l) ah[i] += RA;
        ax[i] = (ax[i] + Math.cos(ah[i]) + W) % W;
        ay[i] = (ay[i] + Math.sin(ah[i]) + H) % H;
        trail[(Math.floor(ay[i]) % H) * W + (Math.floor(ax[i]) % W)] += 1.1;
      }
      for (let y = 0; y < H; y++) {
        const ym = ((y - 1 + H) % H) * W;
        const y0 = y * W;
        const yp = ((y + 1) % H) * W;
        for (let x = 0; x < W; x++) {
          const xm = (x - 1 + W) % W;
          const xp = (x + 1) % W;
          const s =
            trail[ym + xm] + trail[ym + x] + trail[ym + xp] + trail[y0 + xm] + trail[y0 + x] + trail[y0 + xp] + trail[yp + xm] + trail[yp + x] + trail[yp + xp];
          next[y0 + x] = (s / 9) * 0.9;
        }
      }
      trail.set(next);
      const d = img.data;
      for (let i = 0; i < W * H; i++) {
        const v = Math.min(255, Math.floor(Math.sqrt(trail[i] / 9) * 255));
        d[i * 4] = lut[v * 3];
        d[i * 4 + 1] = lut[v * 3 + 1];
        d[i * 4 + 2] = lut[v * 3 + 2];
        d[i * 4 + 3] = 255;
      }
      ctx.putImageData(img, 0, 0);
    };
    raf = requestAnimationFrame(step);
    return () => {
      cancelAnimationFrame(raf);
      io.disconnect();
    };
  }, []);

  return (
    <div
      ref={wrapRef}
      className="relative h-[340px] w-full overflow-hidden rounded-3xl border border-white/10 bg-ink-950 sm:h-[420px]"
      style={{ perspective: 1100 }}
      onPointerMove={(e) => {
        const r = wrapRef.current?.getBoundingClientRect();
        if (!r) return;
        rx.set(42 + ((e.clientY - r.top) / r.height) * 20);
        rz.set(-18 + ((e.clientX - r.left) / r.width) * 16);
      }}
      onPointerLeave={() => { rx.set(50); rz.set(-10); }}
    >
      <motion.div className="absolute inset-[-10%] origin-center" style={{ rotateX: rx, rotateZ: rz, transformStyle: 'preserve-3d' }}>
        <canvas ref={canvasRef} className="h-full w-full" style={{ imageRendering: 'auto', filter: 'saturate(1.05) contrast(1.04)' }} aria-hidden />
        {HERO_FOOD.map((f) => {
          const [x, y] = toGrid(f.lon, f.lat);
          return (
            <div key={f.name} className="absolute" style={{ left: `${(x / W) * 100}%`, top: `${(y / H) * 100}%` }}>
              <span className={`absolute -translate-x-1/2 -translate-y-1/2 rounded-full ${f.zone ? 'h-3.5 w-3.5 border-2 border-paper bg-slime-400 shadow-[0_2px_10px_rgba(168,83,42,0.55)]' : 'h-2 w-2 bg-slime-400/70'}`} />
              {f.zone && <span className="absolute ms-3 -translate-y-1/2 whitespace-nowrap rounded bg-paper/85 px-1.5 text-[11px] font-bold text-slate-100 shadow-panel">{f.name}</span>}
            </div>
          );
        })}
      </motion.div>
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-ink-950 via-transparent to-ink-950/40" />
      <p className="absolute bottom-3 start-4 text-xs italic text-slate-400">{caption}</p>
    </div>
  );
}
