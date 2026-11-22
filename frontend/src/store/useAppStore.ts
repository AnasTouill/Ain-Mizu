import { create } from 'zustand';
import { createJSONStorage, persist, type StateStorage } from 'zustand/middleware';
import type { Lang, ZoneId } from '../types';

export type Horizon = 0 | 1 | 2 | 3;
export type ViewMode = '2d' | '3d';
export interface Layers {
  fields: boolean;
  network: boolean;
  sources: boolean;
  satellite: boolean;
  pruned: boolean;
}

export type Mode = 'farmer' | 'expert';

interface AppState {
  /** farmer = one farm, simple view (default); expert = zone-wide technical screens */
  mode: Mode;
  farmerId: string | null;
  setMode: (m: Mode) => void;
  setFarmer: (id: string | null, zone?: ZoneId) => void;
  zone: ZoneId;
  /** month selected on the slider (observed months) */
  month: string;
  /** 0 = now (slider month), 1..3 = forecast months after the last observation */
  horizon: Horizon;
  layers: Layers;
  view: ViewMode;
  lang: Lang;
  patterns: boolean;
  selectedFieldId: string | null;
  playing: boolean;
  energyDate: string;
  actuationHour: number;
  setZone: (zone: ZoneId) => void;
  setMonth: (month: string) => void;
  setHorizon: (h: Horizon) => void;
  toggleLayer: (key: keyof Layers) => void;
  setView: (v: ViewMode) => void;
  setLang: (lang: Lang) => void;
  setPatterns: (on: boolean) => void;
  selectField: (id: string | null) => void;
  setPlaying: (on: boolean) => void;
  setEnergyDate: (d: string) => void;
  setActuationHour: (h: number) => void;
}

// localStorage can be unavailable (private mode, blocked storage): never let it break the app.
const safeStorage: StateStorage = {
  getItem: (name) => {
    try {
      return window.localStorage.getItem(name);
    } catch {
      return null;
    }
  },
  setItem: (name, value) => {
    try {
      window.localStorage.setItem(name, value);
    } catch {
      /* ignore */
    }
  },
  removeItem: (name) => {
    try {
      window.localStorage.removeItem(name);
    } catch {
      /* ignore */
    }
  },
};

export const useAppStore = create<AppState>()(
  persist(
    (set) => ({
      mode: 'farmer',
      farmerId: null,
      setMode: (mode) => set({ mode, playing: false }),
      setFarmer: (farmerId, zone) => set(zone ? { farmerId, zone, selectedFieldId: null } : { farmerId, selectedFieldId: null }),
      zone: 'kebili',
      month: '',
      horizon: 0,
      layers: { fields: true, network: true, sources: true, satellite: false, pruned: false },
      view: '2d',
      lang: 'fr',
      patterns: true,
      selectedFieldId: null,
      playing: false,
      energyDate: '',
      actuationHour: 12,
      setZone: (zone) => set({ zone, selectedFieldId: null }),
      setMonth: (month) => set({ month }),
      setHorizon: (horizon) => set(horizon > 0 ? { horizon, playing: false } : { horizon }),
      toggleLayer: (key) => set((s) => ({ layers: { ...s.layers, [key]: !s.layers[key] } })),
      setView: (view) => set({ view }),
      setLang: (lang) => set({ lang }),
      setPatterns: (patterns) => set({ patterns }),
      selectField: (selectedFieldId) => set({ selectedFieldId }),
      setPlaying: (playing) => set(playing ? { playing, horizon: 0 } : { playing }),
      setEnergyDate: (energyDate) => set({ energyDate }),
      setActuationHour: (actuationHour) => set({ actuationHour }),
    }),
    {
      name: 'physarum-grid-ui',
      version: 1,
      storage: createJSONStorage(() => safeStorage),
      partialize: (s) => ({
        mode: s.mode,
        farmerId: s.farmerId,
        zone: s.zone,
        lang: s.lang,
        layers: s.layers,
        patterns: s.patterns,
        view: s.view,
      }),
    },
  ),
);
