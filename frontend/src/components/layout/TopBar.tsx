import { motion } from 'framer-motion';
import { BarChart3, CalendarCheck, Cpu, Gauge, Home, LogOut, Info, Languages, LayoutDashboard, MapPin, Sprout, Sun, UserCog, Waypoints, type LucideIcon } from 'lucide-react';
import { useConfig } from '../../api/hooks';
import { LANGS, useT, type TKey } from '../../i18n';
import type { Route } from '../../lib/router';
import { useAppStore } from '../../store/useAppStore';
import { Logo } from './Logo';
import { useAuth } from '../../store/useAuth';

type NavItem = { id: Route; icon: LucideIcon; label: TKey };
const EXPERT_NAV: NavItem[] = [
  { id: 'dashboard', icon: LayoutDashboard, label: 'nav.dashboard' },
  { id: 'plan', icon: CalendarCheck, label: 'nav.plan' },
  { id: 'network', icon: Waypoints, label: 'nav.network' },
  { id: 'energy', icon: Sun, label: 'nav.energy' },
  { id: 'actuation', icon: Cpu, label: 'nav.actuation' },
  { id: 'about', icon: Info, label: 'nav.about' },
];
const FARMER_NAV: NavItem[] = [
  { id: 'profile', icon: Home, label: 'nav.myFarm' },
  { id: 'stats', icon: BarChart3, label: 'nav.stats' },
  { id: 'control', icon: Gauge, label: 'nav.control' },
  { id: 'about', icon: Info, label: 'nav.about' },
];

function NavLinks({ items, route, onNavigate, layoutId }: { items: NavItem[]; route: Route; onNavigate: (r: Route) => void; layoutId: string }) {
  const t = useT();
  return (
    <>
      {items.map(({ id, icon: Icon, label }) => {
        const active = route === id;
        return (
          <button
            key={id}
            onClick={() => onNavigate(id)}
            aria-current={active ? 'page' : undefined}
            className={`relative flex shrink-0 items-center gap-2 rounded-xl px-3 py-2 text-sm font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-water-400/70 ${
              active ? 'text-white' : 'text-slate-400 hover:text-slate-100'
            }`}
          >
            {active && (
              <motion.span
                layoutId={layoutId}
                className="absolute inset-0 rounded-xl border border-water-400/30 bg-gradient-to-b from-water-500/25 to-water-500/5 shadow-glow"
                transition={{ type: 'spring', stiffness: 380, damping: 32 }}
              />
            )}
            <Icon size={16} className="relative" />
            <span className="relative whitespace-nowrap">{t(label)}</span>
          </button>
        );
      })}
    </>
  );
}

export function TopBar({ route, onNavigate }: { route: Route; onNavigate: (r: Route) => void }) {
  const t = useT();
  const config = useConfig().data;
  const zone = useAppStore((s) => s.zone);
  const setZone = useAppStore((s) => s.setZone);
  const lang = useAppStore((s) => s.lang);
  const setLang = useAppStore((s) => s.setLang);
  const mode = useAppStore((s) => s.mode);
  const setMode = useAppStore((s) => s.setMode);
  const setFarmer = useAppStore((s) => s.setFarmer);
  const zones = config?.zones ?? [];
  const farmerMode = mode === 'farmer';
  const authUser = useAuth((s) => s.user);
  const logout = useAuth((s) => s.logout);
  const items = farmerMode ? (authUser?.farm_ids.length ? FARMER_NAV : FARMER_NAV.filter((n) => n.id === 'about')) : EXPERT_NAV;
  const switchMode = () => {
    setMode(farmerMode ? 'expert' : 'farmer');
    onNavigate(farmerMode ? 'dashboard' : 'profile');
  };

  return (
    <header className="relative z-30 border-b border-white/5 bg-ink-950/75 backdrop-blur-xl">
      <div className="flex items-center gap-3 px-3 py-2 sm:px-4">
        <a href="#/dashboard" className="flex items-center gap-2.5 rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-water-400/70">
          <Logo size={38} />
          <div className="leading-tight">
            <div className="font-display text-lg font-bold tracking-tight text-white">
              Physarum<span className="text-slime-400 text-glow-gold">-Grid</span>
            </div>
            <div className="hidden text-[11px] text-slate-400 md:block">{t('app.tagline')}</div>
          </div>
        </a>

        <nav className={`ms-4 hidden items-center gap-1 ${farmerMode ? 'sm:flex' : 'xl:flex'}`} aria-label="main">
          <NavLinks items={items} route={route} onNavigate={onNavigate} layoutId="nav-pill" />
        </nav>

        <div className="ms-auto flex items-center gap-2">
          {farmerMode && authUser && (
            <button
              onClick={() => { logout(); setFarmer(null); onNavigate('login'); }}
              className="flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-2 py-1 text-sm text-slate-200 hover:bg-white/10"
              title={t('auth.logout')}
            >
              <span className="grid h-7 w-7 place-items-center rounded-full bg-slime-400 font-bold text-ink-950">{authUser.name.charAt(0)}</span>
              <span className="hidden font-semibold sm:inline">{authUser.name}</span>
              <LogOut size={14} className="text-slate-400" />
            </button>
          )}
          <div className={`hidden items-center gap-1 rounded-xl border border-white/10 bg-white/5 p-1 ${farmerMode ? '' : 'md:flex'}`} role="radiogroup" aria-label={t('nav.zone')}>
            <MapPin size={14} className="mx-1 text-water-300" />
            {zones.map((z) => (
              <button
                key={z.id}
                role="radio"
                aria-checked={zone === z.id}
                onClick={() => setZone(z.id)}
                className={`relative rounded-lg px-2.5 py-1 text-xs font-semibold transition ${
                  zone === z.id ? 'text-ink-950' : 'text-slate-300 hover:text-white'
                }`}
              >
                {zone === z.id && (
                  <motion.span layoutId="zone-pill" className="absolute inset-0 rounded-lg bg-slime-400 shadow-glow-gold" transition={{ type: 'spring', stiffness: 400, damping: 30 }} />
                )}
                <span className="relative">{z.name}</span>
              </button>
            ))}
          </div>
          <label className={farmerMode ? 'hidden' : 'md:hidden'}>
            <span className="sr-only">{t('nav.zone')}</span>
            <select
              value={zone}
              onChange={(e) => setZone(e.target.value)}
              className="rounded-xl border border-white/10 bg-ink-800 px-2 py-1.5 text-sm text-slate-100"
            >
              {zones.map((z) => (
                <option key={z.id} value={z.id}>
                  {z.name}
                </option>
              ))}
            </select>
          </label>

          <div className="flex items-center gap-0.5 rounded-xl border border-white/10 bg-white/5 p-1" role="radiogroup" aria-label={t('nav.language')}>
            <Languages size={14} className="mx-1 hidden text-slate-400 sm:block" />
            {LANGS.map((l) => (
              <button
                key={l.id}
                role="radio"
                aria-checked={lang === l.id}
                title={l.native}
                onClick={() => setLang(l.id)}
                className={`rounded-lg px-2 py-1 text-xs font-bold transition ${
                  lang === l.id ? 'bg-white/15 text-white' : 'text-slate-400 hover:text-white'
                }`}
              >
                {l.label}
              </button>
            ))}
          </div>

          <button
            onClick={switchMode}
            className="flex items-center gap-1.5 rounded-xl border border-white/10 bg-white/5 px-2.5 py-1.5 text-xs font-semibold text-slate-300 hover:bg-white/10 hover:text-white"
            title={farmerMode ? t('mode.expert') : t('mode.farmer')}
          >
            {farmerMode ? <UserCog size={15} /> : <Sprout size={15} />}
            <span className="hidden md:inline">{farmerMode ? t('mode.expert') : t('mode.farmer')}</span>
          </button>
        </div>
      </div>
      <nav className={`thin-scroll flex gap-1 overflow-x-auto px-2 pb-2 ${farmerMode ? 'sm:hidden' : 'xl:hidden'}`} aria-label="main">
        <NavLinks items={items} route={route} onNavigate={onNavigate} layoutId="nav-pill-mobile" />
      </nav>
    </header>
  );
}
