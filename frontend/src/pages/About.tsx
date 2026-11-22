import { motion } from 'framer-motion';
import { BrainCircuit, Cpu, Database, Eye, Route, ShieldAlert, Sparkles, Sun, Tags, type LucideIcon } from 'lucide-react';
import { lazy, Suspense } from 'react';
import { ClassIcon, Swatch } from '../components/ClassIcon';
import { Skeleton, TiltCard } from '../components/ui/primitives';
import { useT, type TKey } from '../i18n';
import { useZoneContext } from '../lib/useZoneContext';
import { useAppStore } from '../store/useAppStore';
import type { StressClass } from '../types';

const PhysarumHero = lazy(() => import('../components/PhysarumHero'));

const STEPS: { key: string; icon: LucideIcon; color: string }[] = [
  { key: 'see', icon: Eye, color: '#1f8096' },
  { key: 'predict', icon: BrainCircuit, color: '#6d5bb5' },
  { key: 'classify', icon: Tags, color: '#f08a24' },
  { key: 'route', icon: Route, color: '#b7791f' },
  { key: 'power', icon: Sun, color: '#d99a1e' },
  { key: 'act', icon: Cpu, color: '#2e9e4f' },
];

export default function About() {
  const t = useT();
  const { config } = useZoneContext();
  const patterns = useAppStore((s) => s.patterns);

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-8 p-4 pb-12">
      <section className="grid items-center gap-6 lg:grid-cols-[1fr_1.15fr]">
        <motion.div initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }} transition={{ duration: 0.6 }}>
          <div className="chip mb-3 border-slime-400/30 text-slime-200">
            <Sparkles size={12} /> {t('about.kicker')}
          </div>
          <h1 className="font-display text-4xl font-bold leading-tight text-white sm:text-5xl">{t('about.title')}</h1>
          <p className="mt-4 text-base leading-relaxed text-slate-300">{t('about.lead')}</p>
          <p className="mt-4 text-xs text-slate-500">{t('about.ref')}</p>
        </motion.div>
        <Suspense fallback={<Skeleton className="h-[420px]" />}>
          <PhysarumHero caption={t('about.heroCaption')} />
        </Suspense>
      </section>

      <section>
        <h2 className="mb-4 font-display text-2xl font-bold text-white">{t('about.pipeline')}</h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {STEPS.map((s, i) => (
            <motion.div key={s.key} initial={{ opacity: 0, y: 24, rotateX: 25 }} whileInView={{ opacity: 1, y: 0, rotateX: 0 }} viewport={{ once: true }} transition={{ delay: i * 0.08, duration: 0.5 }} style={{ transformPerspective: 900 }}>
              <TiltCard className="h-full">
                <div className="glass relative h-full overflow-hidden p-5">
                  <div className="absolute -end-6 -top-6 font-display text-[90px] font-bold leading-none text-white/[0.04]">{i + 1}</div>
                  <div className="mb-3 grid h-11 w-11 place-items-center rounded-xl" style={{ background: `${s.color}22`, color: s.color, boxShadow: `0 0 24px -6px ${s.color}` }}>
                    <s.icon size={22} />
                  </div>
                  <h3 className="font-display text-lg font-bold text-white">{t(`about.step.${s.key}` as TKey)}</h3>
                  <p className="mt-1 text-sm text-slate-400">{t(`about.step.${s.key}.body` as TKey)}</p>
                </div>
              </TiltCard>
            </motion.div>
          ))}
        </div>
      </section>

      <section className="grid gap-3 lg:grid-cols-2">
        <div className="glass p-5">
          <h2 className="mb-3 flex items-center gap-2 font-display text-xl font-bold text-white">
            <Tags size={18} className="text-stress-orange" /> {t('about.classes')}
          </h2>
          <ul className="space-y-2">
            {([0, 1, 2, 3] as StressClass[]).map((c) => (
              <li key={c} className="flex items-center gap-3 rounded-xl bg-white/[0.03] p-2">
                <Swatch cls={c} patterns={patterns} colors={config.class_colors} size={26} />
                <ClassIcon cls={c} size={16} className="text-slate-300" />
                <div>
                  <div className="font-semibold text-white">{t(`class.${c}` as TKey)}</div>
                  <div className="text-xs text-slate-400">{t(`class.${c}.desc` as TKey)}</div>
                </div>
              </li>
            ))}
          </ul>
        </div>
        <div className="glass p-5">
          <h2 className="mb-3 flex items-center gap-2 font-display text-xl font-bold text-white">
            <BrainCircuit size={18} className="text-violet-300" /> {t('about.ai.title')}
          </h2>
          <p className="text-sm leading-relaxed text-slate-300">{t('about.ai.body')}</p>
          <h3 className="mb-2 mt-5 flex items-center gap-2 font-display text-lg font-bold text-white">
            <Database size={16} className="text-water-300" /> {t('about.data.title')}
          </h3>
          <ul className="list-inside list-disc space-y-1 text-sm text-slate-300">
            {(['about.data.s2', 'about.data.weather', 'about.data.dem', 'about.data.solar'] as TKey[]).map((k) => (
              <li key={k}>{t(k)}</li>
            ))}
          </ul>
        </div>
      </section>

      <section className="glass border-amber-400/20 p-5">
        <h2 className="mb-3 flex items-center gap-2 font-display text-xl font-bold text-white">
          <ShieldAlert size={18} className="text-amber-300" /> {t('about.limits.title')}
        </h2>
        <ul className="grid gap-2 sm:grid-cols-2">
          {(['about.limits.1', 'about.limits.2', 'about.limits.3', 'about.limits.4', 'about.limits.5'] as TKey[]).map((k) => (
            <li key={k} className="rounded-xl bg-amber-500/5 p-3 text-sm text-amber-50/90">
              {t(k)}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
