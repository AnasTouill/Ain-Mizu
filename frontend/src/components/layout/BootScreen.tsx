import { motion } from 'framer-motion';
import { RotateCcw, ServerCrash } from 'lucide-react';
import { useT } from '../../i18n';
import { FullLogo } from './Logo';

export function BootScreen() {
  const t = useT();
  return (
    <div className="app-bg relative grid h-dvh place-items-center overflow-hidden">
      <motion.div
        initial={{ opacity: 0, scale: 0.9, rotateX: 25 }}
        animate={{ opacity: 1, scale: 1, rotateX: 0 }}
        transition={{ duration: 0.8, ease: [0.22, 1, 0.36, 1] }}
        style={{ transformPerspective: 900 }}
        className="flex flex-col items-center gap-5"
      >
        <div className="animate-float">
          <FullLogo width={200} />
        </div>
        <div className="ma-rule w-40" aria-hidden />
        <div className="flex items-center gap-2 text-sm text-slate-400">
          <span className="relative flex h-2 w-2">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-water-400 opacity-75" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-water-400" />
          </span>
          {t('app.loading')}
        </div>
      </motion.div>
    </div>
  );
}

export function BootError({ onRetry }: { onRetry: () => void }) {
  const t = useT();
  return (
    <div className="app-bg grid h-dvh place-items-center p-4">
      <div className="glass max-w-md p-6 text-center">
        <ServerCrash className="mx-auto mb-3 text-red-400" size={40} />
        <h1 className="font-display text-xl font-bold text-white">{t('app.backendDown')}</h1>
        <p className="mt-2 text-sm text-slate-400">{t('app.backendDownHint')}</p>
        <button className="btn-primary mt-5" onClick={onRetry}>
          <RotateCcw size={16} /> {t('app.retry')}
        </button>
      </div>
    </div>
  );
}
