import { AnimatePresence, motion } from 'framer-motion';
import { CircleCheck, Info, TriangleAlert, X, XCircle } from 'lucide-react';
import { useToasts, type ToastKind } from '../../store/toasts';

const STYLE: Record<ToastKind, { icon: typeof Info; ring: string; text: string }> = {
  error: { icon: XCircle, ring: 'border-red-400/40', text: 'text-red-300' },
  warning: { icon: TriangleAlert, ring: 'border-amber-400/40', text: 'text-amber-300' },
  success: { icon: CircleCheck, ring: 'border-emerald-400/40', text: 'text-emerald-300' },
  info: { icon: Info, ring: 'border-water-400/40', text: 'text-water-300' },
};

export function Toaster() {
  const toasts = useToasts((s) => s.toasts);
  const dismiss = useToasts((s) => s.dismiss);
  return (
    <div className="pointer-events-none fixed bottom-10 end-3 z-[1000] flex w-[min(92vw,380px)] flex-col gap-2" aria-live="polite">
      <AnimatePresence initial={false}>
        {toasts.map((t) => {
          const s = STYLE[t.kind];
          const Icon = s.icon;
          return (
            <motion.div
              key={t.id}
              layout
              initial={{ opacity: 0, y: 24, scale: 0.95, rotateX: -20 }}
              animate={{ opacity: 1, y: 0, scale: 1, rotateX: 0 }}
              exit={{ opacity: 0, x: 40, scale: 0.95 }}
              transition={{ type: 'spring', stiffness: 380, damping: 30 }}
              style={{ transformPerspective: 800 }}
              className={`glass-strong pointer-events-auto flex items-start gap-3 border ${s.ring} p-3`}
              role={t.kind === 'error' ? 'alert' : 'status'}
            >
              <Icon size={18} className={`mt-0.5 shrink-0 ${s.text}`} />
              <div className="min-w-0 flex-1">
                <div className="text-sm font-semibold text-white">{t.title}</div>
                {t.message && <div className="mt-0.5 break-words text-xs text-slate-300">{t.message}</div>}
              </div>
              <button onClick={() => dismiss(t.id)} className="rounded-md p-1 text-slate-400 hover:bg-white/10 hover:text-white" aria-label="close">
                <X size={14} />
              </button>
            </motion.div>
          );
        })}
      </AnimatePresence>
    </div>
  );
}
