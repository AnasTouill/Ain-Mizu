import { create } from 'zustand';

export type ToastKind = 'error' | 'info' | 'success' | 'warning';
export interface Toast {
  id: number;
  kind: ToastKind;
  title: string;
  message?: string;
}

interface ToastState {
  toasts: Toast[];
  push: (t: Omit<Toast, 'id'>) => void;
  dismiss: (id: number) => void;
}

let nextId = 1;
const recent = new Map<string, number>();

export const useToasts = create<ToastState>((set, get) => ({
  toasts: [],
  push: (t) => {
    const key = `${t.kind}|${t.title}|${t.message ?? ''}`;
    const now = Date.now();
    if ((recent.get(key) ?? 0) > now - 4000) return; // de-duplicate bursts (e.g. retries)
    recent.set(key, now);
    const id = nextId++;
    set((s) => ({ toasts: [...s.toasts.slice(-3), { ...t, id }] }));
    window.setTimeout(() => get().dismiss(id), t.kind === 'error' ? 7000 : 4200);
  },
  dismiss: (id) => set((s) => ({ toasts: s.toasts.filter((x) => x.id !== id) })),
}));

export const toast = {
  error: (title: string, message?: string) => useToasts.getState().push({ kind: 'error', title, message }),
  info: (title: string, message?: string) => useToasts.getState().push({ kind: 'info', title, message }),
  success: (title: string, message?: string) => useToasts.getState().push({ kind: 'success', title, message }),
  warning: (title: string, message?: string) => useToasts.getState().push({ kind: 'warning', title, message }),
};
