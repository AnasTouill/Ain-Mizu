import { motion } from 'framer-motion';
import { ChevronRight, CircleCheck, Droplets, MapPin, Search, Sprout } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useConfig, useFarmers } from '../api/hooks';
import { Segmented, Skeleton } from '../components/ui/primitives';
import { useLang, useT } from '../i18n';
import { fmtNumber } from '../lib/format';
import { useAppStore } from '../store/useAppStore';
import type { AppConfig } from '../types';

export default function FarmPicker() {
  const t = useT();
  const lang = useLang();
  const config = useConfig().data as AppConfig;
  const farmers = useFarmers();
  const setFarmer = useAppStore((s) => s.setFarmer);
  const [zone, setZone] = useState<string>('all');
  const [q, setQ] = useState('');
  const zoneName = (id: string) => config.zones.find((z) => z.id === id)?.name ?? id;

  const list = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return (farmers.data ?? []).filter(
      (f) => (zone === 'all' || f.zone === zone) && (!needle || f.name.toLowerCase().includes(needle) || f.farmer_id.includes(needle)),
    );
  }, [farmers.data, zone, q]);

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-5 p-4 pb-10">
      <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="text-center">
        <div className="mx-auto mb-3 grid h-14 w-14 place-items-center rounded-2xl bg-stress-green/20 text-emerald-300 shadow-[0_0_30px_-6px_#2e9e4f]">
          <Sprout size={28} />
        </div>
        <h1 className="font-display text-3xl font-bold text-white">{t('farm.pick.title')}</h1>
        <p className="mt-1 text-slate-400">{t('farm.pick.subtitle')}</p>
      </motion.div>

      <div className="glass flex flex-col gap-3 p-3 sm:flex-row sm:items-center">
        <label className="flex flex-1 items-center gap-2 rounded-xl border border-white/10 bg-ink-950/60 px-3 py-2.5">
          <Search size={18} className="text-slate-400" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={t('farm.search')}
            className="w-full bg-transparent text-base text-white placeholder:text-slate-500 focus:outline-none"
            aria-label={t('farm.search')}
          />
        </label>
        <div className="sm:w-[440px]">
          <Segmented
            layoutId="picker-zone"
            value={zone}
            onChange={setZone}
            options={[{ value: 'all', label: t('farm.pick.all') }, ...config.zones.map((z) => ({ value: z.id as string, label: z.name }))]}
          />
        </div>
      </div>

      {farmers.isLoading ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 9 }).map((_, i) => (
            <Skeleton key={i} className="h-28" />
          ))}
        </div>
      ) : list.length === 0 ? (
        <p className="text-center text-slate-400">{t('farm.empty')}</p>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {list.map((f, i) => (
            <motion.button
              key={f.farmer_id}
              initial={{ opacity: 0, y: 14 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: Math.min(i * 0.02, 0.4) }}
              whileHover={{ y: -3 }}
              onClick={() => setFarmer(f.farmer_id, f.zone)}
              className="glass group flex items-center gap-3 p-4 text-start transition hover:border-water-400/40"
            >
              <div className="grid h-12 w-12 shrink-0 place-items-center rounded-full bg-gradient-to-br from-slime-400 to-amber-600 font-display text-lg font-bold text-ink-950">
                {f.name.charAt(0)}
              </div>
              <div className="min-w-0 flex-1">
                <div className="truncate font-display text-lg font-bold text-white">{f.name}</div>
                <div className="flex items-center gap-1 text-xs text-slate-400">
                  <MapPin size={12} /> {zoneName(f.zone)} · {t('farm.parcels', { n: f.field_count })} · {fmtNumber(f.area_ha, lang, 1)} {t('common.ha')}
                </div>
                <div className="mt-1.5">
                  {f.fields_need_water > 0 ? (
                    <span className="inline-flex items-center gap-1 rounded-full bg-orange-500/15 px-2 py-0.5 text-xs font-semibold text-orange-300">
                      <Droplets size={12} /> {t('farm.toWater', { n: f.fields_need_water })}
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/15 px-2 py-0.5 text-xs font-semibold text-emerald-300">
                      <CircleCheck size={12} /> {t('farm.allGood')}
                    </span>
                  )}
                </div>
              </div>
              <ChevronRight size={20} className="text-slate-500 transition group-hover:text-white rtl:rotate-180" />
            </motion.button>
          ))}
        </div>
      )}
    </div>
  );
}
