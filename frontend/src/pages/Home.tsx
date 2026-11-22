import { useQuery } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import { ArrowRight, BrainCircuit, CalendarCheck, Droplets, Gauge, Leaf, Satellite, Sprout, Sun, Waves } from 'lucide-react';
import { api } from '../api/client';
import { useConfig, useModelMetrics, useModelPlan } from '../api/hooks';
import { AnimatedNumber } from '../components/ui/primitives';
import { useLang, useT, type TKey } from '../i18n';
import { fmtNumber } from '../lib/format';
import { useAuth } from '../store/useAuth';

const NAVY = '#1d3557';
const SUN = '#d62828';
const PALM = '#2d6a4f';
const SEA = '#2f6db5';

const rise = { initial: { opacity: 0, y: 18 }, whileInView: { opacity: 1, y: 0 }, viewport: { once: true, margin: '-40px' } };

/** Farmer home page: what AIN MIZU does, with live figures from the satellite model. */
export default function Home() {
  const t = useT();
  const lang = useLang();
  const config = useConfig().data!;
  const user = useAuth((s) => s.user);
  const plan = useModelPlan(undefined, Boolean(config.pipeline));
  const metrics = useModelMetrics(Boolean(config.pipeline));
  const last = config.months.last_observed;
  const kpis = useQuery({
    queryKey: ['home-kpis', last],
    queryFn: () => Promise.all(config.zones.map((z) => api.kpis(z.id, last).catch(() => null))),
    staleTime: 10 * 60_000,
  });

  const zones = plan.data?.zones ?? [];
  const fields = zones.reduce((a, z) => a + z.fields, 0);
  const hectares = zones.reduce((a, z) => a + z.area_ha, 0);
  const needing = zones.reduce((a, z) => a + (z.class_next['2'] ?? 0) + (z.class_next['3'] ?? 0), 0);
  const saved = (kpis.data ?? []).filter(Boolean).map((k) => k!.water_saved_pct_vs_equal_split).filter((v) => v !== null && v !== undefined) as number[];
  const savedAvg = saved.length ? saved.reduce((a, b) => a + b, 0) / saved.length : null;
  const m = metrics.data;
  const gain = m ? (100 * (m.persistence.mae - m.lightgbm.mae)) / m.persistence.mae : null;
  const go = (h: string) => { window.location.hash = h; };

  const stats = [
    { icon: Satellite, value: fields, digits: 0, suffix: '', label: t('home.stat.fields'), color: SEA },
    { icon: Sprout, value: hectares, digits: 0, suffix: ' ha', label: t('home.stat.ha'), color: PALM },
    { icon: Droplets, value: fields ? (100 * needing) / fields : null, digits: 0, suffix: ' %', label: t('home.stat.need'), color: SUN },
    { icon: Leaf, value: savedAvg, digits: 0, suffix: ' %', label: t('home.stat.saved'), color: PALM },
  ];
  const steps: { icon: typeof Satellite; title: TKey; text: TKey; color: string }[] = [
    { icon: Satellite, title: 'home.s1.t', text: 'home.s1.d', color: SEA },
    { icon: BrainCircuit, title: 'home.s2.t', text: 'home.s2.d', color: NAVY },
    { icon: CalendarCheck, title: 'home.s3.t', text: 'home.s3.d', color: PALM },
    { icon: Gauge, title: 'home.s4.t', text: 'home.s4.d', color: SUN },
  ];
  const benefits: { icon: typeof Satellite; title: TKey; text: TKey; color: string }[] = [
    { icon: Droplets, title: 'home.b1.t', text: 'home.b1.d', color: SEA },
    { icon: Sun, title: 'home.b2.t', text: 'home.b2.d', color: '#c9a227' },
    { icon: CalendarCheck, title: 'home.b3.t', text: 'home.b3.d', color: PALM },
  ];

  return (
    <div className="pb-0" style={{ color: NAVY }}>
      {/* ------------------------------------------------ hero */}
      <section className="relative overflow-hidden">
        <div className="pointer-events-none absolute -end-32 -top-32 h-96 w-96 rounded-full opacity-20 blur-3xl" style={{ background: SUN }} />
        <div className="pointer-events-none absolute -start-24 bottom-0 h-80 w-80 rounded-full opacity-20 blur-3xl" style={{ background: SEA }} />
        <div className="mx-auto grid max-w-6xl items-center gap-10 px-4 py-10 md:grid-cols-[1.15fr_1fr] md:py-16">
          <motion.div initial={{ opacity: 0, x: -24 }} animate={{ opacity: 1, x: 0 }} transition={{ duration: 0.6 }}>
            <span className="inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-semibold" style={{ background: '#f7f0e1', color: SUN }}>
              <Waves size={13} /> {t('home.kicker')}
            </span>
            <h1 className="mt-4 font-display text-4xl font-bold leading-tight sm:text-5xl" style={{ color: NAVY }}>
              {t('home.title1')} <span style={{ color: SEA }}>{t('home.title2')}</span>
            </h1>
            <p className="mt-4 max-w-xl text-base leading-relaxed" style={{ color: '#475569' }}>{t('home.lead')}</p>
            <div className="mt-6 flex flex-wrap gap-3">
              {user ? (
                <button onClick={() => go('/profile')} className="group inline-flex items-center gap-2 rounded-full px-6 py-3 font-semibold text-[#fff] shadow-lg transition hover:-translate-y-0.5" style={{ background: NAVY, color: '#fff' }}>
                  {t('home.ctaFarm')} <ArrowRight size={17} className="transition group-hover:translate-x-1 rtl:rotate-180" />
                </button>
              ) : (
                <>
                  <button onClick={() => go('/login?register')} className="group inline-flex items-center gap-2 rounded-full px-6 py-3 font-semibold text-[#fff] shadow-lg transition hover:-translate-y-0.5" style={{ background: SUN, color: '#fff' }}>
                    {t('home.ctaStart')} <ArrowRight size={17} className="transition group-hover:translate-x-1 rtl:rotate-180" />
                  </button>
                  <button onClick={() => go('/login')} className="inline-flex items-center gap-2 rounded-full border-2 px-6 py-3 font-semibold transition hover:-translate-y-0.5" style={{ borderColor: NAVY, color: NAVY }}>
                    {t('auth.login')}
                  </button>
                </>
              )}
            </div>
          </motion.div>
          <motion.div initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} transition={{ duration: 0.7, delay: 0.1 }} className="relative mx-auto aspect-square w-64 sm:w-80">
            <div className="absolute inset-0 animate-spin-slow rounded-full border-2 border-dashed" style={{ borderColor: 'rgba(201,162,39,0.6)' }} />
            <div className="absolute inset-4 rounded-full" style={{ background: 'radial-gradient(circle at 50% 40%, #fff, #f7f0e1)' }} />
            <img src="/ain-mizu-logo.png" alt="AIN MIZU" className="absolute inset-6 animate-float rounded-full object-contain drop-shadow-xl" />
          </motion.div>
        </div>
      </section>

      {/* ------------------------------------------------ live figures */}
      <section className="mx-auto max-w-6xl px-4">
        <div className="grid gap-3 rounded-3xl p-4 shadow-xl sm:grid-cols-2 lg:grid-cols-4" style={{ background: NAVY, color: '#fff' }}>
          {stats.map((s, i) => (
            <motion.div key={s.label} {...rise} transition={{ delay: i * 0.08 }} className="flex items-center gap-3 rounded-2xl p-3" style={{ background: 'rgba(255,255,255,0.06)' }}>
              <div className="grid h-12 w-12 shrink-0 place-items-center rounded-full" style={{ background: '#fff', color: s.color }}><s.icon size={22} /></div>
              <div>
                <div className="font-display text-2xl font-bold" style={{ color: '#fff' }}>
                  {s.value === null ? '…' : <AnimatedNumber value={s.value} lang={lang} digits={s.digits} suffix={s.suffix} />}
                </div>
                <div className="text-xs" style={{ color: '#cbd5e1' }}>{s.label}</div>
              </div>
            </motion.div>
          ))}
        </div>
        <p className="mt-2 text-center text-[11px]" style={{ color: '#7b8797' }}>
          {t('home.statNote', { week: plan.data?.forecast_week ?? '…', gain: gain === null ? '…' : fmtNumber(gain, lang, 1) })}
        </p>
      </section>

      {/* ------------------------------------------------ how it works */}
      <section className="mx-auto max-w-6xl px-4 py-12">
        <motion.h2 {...rise} className="text-center font-display text-3xl font-bold" style={{ color: NAVY }}>{t('home.howTitle')}</motion.h2>
        <motion.p {...rise} className="mx-auto mt-2 max-w-2xl text-center text-sm" style={{ color: '#5b6b80' }}>{t('home.howLead')}</motion.p>
        <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {steps.map((s, i) => (
            <motion.div key={s.title} {...rise} transition={{ delay: i * 0.1 }} whileHover={{ y: -6 }}
              className="relative overflow-hidden rounded-3xl bg-white p-5 shadow-[0_12px_30px_-18px_rgba(29,53,87,0.45)]">
              <div className="absolute -end-3 -top-6 font-display text-[88px] font-bold leading-none" style={{ color: 'rgba(29,53,87,0.05)' }}>{i + 1}</div>
              <div className="grid h-12 w-12 place-items-center rounded-2xl text-[#fff]" style={{ background: s.color, color: '#fff' }}><s.icon size={22} /></div>
              <h3 className="mt-4 font-display text-lg font-bold" style={{ color: NAVY }}>{t(s.title)}</h3>
              <p className="mt-1 text-sm leading-relaxed" style={{ color: '#5b6b80' }}>{t(s.text)}</p>
            </motion.div>
          ))}
        </div>
      </section>

      {/* ------------------------------------------------ this week per zone */}
      {zones.length > 0 && (
        <section className="py-12" style={{ background: '#f7f0e1' }}>
          <div className="mx-auto max-w-6xl px-4">
            <motion.h2 {...rise} className="font-display text-3xl font-bold" style={{ color: NAVY }}>{t('home.weekTitle', { week: plan.data?.forecast_week ?? '' })}</motion.h2>
            <div className="mt-6 grid gap-4 md:grid-cols-3">
              {zones.map((z, i) => {
                const name = config.zones.find((c) => c.id === z.zone)?.name ?? z.zone;
                const total = Object.values(z.class_next).reduce((a, b) => a + b, 0) || 1;
                return (
                  <motion.div key={z.zone} {...rise} transition={{ delay: i * 0.1 }} whileHover={{ y: -4 }} className="rounded-3xl bg-white p-5 shadow-[0_12px_30px_-18px_rgba(29,53,87,0.45)]">
                    <div className="text-xs font-semibold uppercase tracking-wider" style={{ color: SUN }}>{name}</div>
                    <div className="mt-1 font-display text-3xl font-bold" style={{ color: NAVY }}>{fmtNumber(z.demand_m3, lang)} m³</div>
                    <div className="text-xs" style={{ color: '#5b6b80' }}>{t('home.weekNeed', { n: z.fields })}</div>
                    <div className="mt-3 flex h-3 overflow-hidden rounded-full" style={{ background: '#eef2f7' }}>
                      {[0, 1, 2, 3].map((c) => (
                        <div key={c} style={{ width: `${(100 * (z.class_next[String(c)] ?? 0)) / total}%`, background: config.class_colors[c] }} />
                      ))}
                    </div>
                    <div className="mt-2 flex justify-between text-[11px]" style={{ color: '#5b6b80' }}>
                      <span>↘ {z.worsening} {t('plan.worsening')}</span>
                      <span>↗ {z.improving} {t('plan.improving')}</span>
                    </div>
                  </motion.div>
                );
              })}
            </div>
          </div>
        </section>
      )}

      {/* ------------------------------------------------ benefits */}
      <section className="mx-auto max-w-6xl px-4 py-12">
        <motion.h2 {...rise} className="text-center font-display text-3xl font-bold" style={{ color: NAVY }}>{t('home.whyTitle')}</motion.h2>
        <div className="mt-8 grid gap-4 md:grid-cols-3">
          {benefits.map((b, i) => (
            <motion.div key={b.title} {...rise} transition={{ delay: i * 0.1 }} whileHover={{ y: -6 }} className="rounded-3xl border bg-white p-6" style={{ borderColor: 'rgba(29,53,87,0.08)' }}>
              <div className="grid h-14 w-14 place-items-center rounded-full" style={{ background: `${b.color}1f`, color: b.color }}><b.icon size={26} /></div>
              <h3 className="mt-4 font-display text-xl font-bold" style={{ color: NAVY }}>{t(b.title)}</h3>
              <p className="mt-2 text-sm leading-relaxed" style={{ color: '#5b6b80' }}>{t(b.text)}</p>
            </motion.div>
          ))}
        </div>
      </section>

      {/* ------------------------------------------------ call to action */}
      <section className="relative overflow-hidden px-4 py-12 text-center" style={{ background: NAVY, color: '#fff' }}>
        <svg className="pointer-events-none absolute inset-x-0 bottom-0 h-16 w-full opacity-20" viewBox="0 0 600 60" preserveAspectRatio="none" aria-hidden>
          <path d="M0 40 Q 25 20 50 40 T 100 40 T 150 40 T 200 40 T 250 40 T 300 40 T 350 40 T 400 40 T 450 40 T 500 40 T 550 40 T 600 40 V60 H0Z" fill="#9cc3ea" />
        </svg>
        <motion.h2 {...rise} className="relative font-display text-3xl font-bold" style={{ color: '#fff' }}>{t('home.ctaTitle')}</motion.h2>
        <p className="relative mx-auto mt-2 max-w-xl text-sm" style={{ color: '#cbd5e1' }}>{t('home.ctaLead')}</p>
        <button onClick={() => go(user ? '/profile' : '/login?register')} className="relative mt-6 inline-flex items-center gap-2 rounded-full px-7 py-3 font-semibold text-[#fff] shadow-lg transition hover:-translate-y-0.5" style={{ background: SUN, color: '#fff' }}>
          {user ? t('home.ctaFarm') : t('home.ctaStart')} <ArrowRight size={17} className="rtl:rotate-180" />
        </button>
      </section>
    </div>
  );
}
