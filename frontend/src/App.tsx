import { motion } from 'framer-motion';
import { lazy, Suspense, useEffect } from 'react';
import { useConfig, useZones } from './api/hooks';
import { PatternDefs } from './components/ClassIcon';
import { BootError, BootScreen } from './components/layout/BootScreen';
import { Footer, RealDataBanner, SyntheticBanner } from './components/layout/Notices';
import { TopBar } from './components/layout/TopBar';
import { ErrorBoundary } from './components/ui/ErrorBoundary';
import { Toaster } from './components/ui/Toaster';
import { Skeleton } from './components/ui/primitives';
import { translate, useT } from './i18n';
import { setMonthOverride } from './lib/months';
import { fmtWeek } from './components/WeeklyChart';
import { useHashRoute, type Route } from './lib/router';
import { useAppStore } from './store/useAppStore';
import { useAuth } from './store/useAuth';
import { api } from './api/client';

const MyFarm = lazy(() => import('./pages/MyFarm'));
const FarmPicker = lazy(() => import('./pages/FarmPicker'));
const Dashboard = lazy(() => import('./pages/Dashboard'));
const NetworkLab = lazy(() => import('./pages/NetworkLab'));
const Energy = lazy(() => import('./pages/Energy'));
const Actuation = lazy(() => import('./pages/Actuation'));
const About = lazy(() => import('./pages/About'));
const ModelPlan = lazy(() => import('./pages/ModelPlan'));
const Login = lazy(() => import('./pages/Login'));
const Onboarding = lazy(() => import('./pages/Onboarding'));
const FarmProfile = lazy(() => import('./pages/FarmProfile'));
const FarmStats = lazy(() => import('./pages/FarmStats'));
const ControlPanel = lazy(() => import('./pages/ControlPanel'));
const EditFarm = lazy(() => import('./pages/EditFarm'));

const PAGES: Record<Route, React.LazyExoticComponent<React.ComponentType>> = {
  farm: MyFarm,
  dashboard: Dashboard,
  network: NetworkLab,
  energy: Energy,
  actuation: Actuation,
  about: About,
  plan: ModelPlan,
  login: Login,
  onboarding: Onboarding,
  profile: FarmProfile,
  stats: FarmStats,
  control: ControlPanel,
  edit: EditFarm,
};

function PageSkeleton() {
  return (
    <div className="grid h-full gap-3 p-3 lg:grid-cols-[330px_1fr]">
      <Skeleton className="h-[60vh]" />
      <Skeleton className="h-[60vh]" />
    </div>
  );
}

export default function App() {
  const t = useT();
  const config = useConfig();
  const zones = useZones();
  const [route, navigate] = useHashRoute();
  const lang = useAppStore((s) => s.lang);
  const month = useAppStore((s) => s.month);
  const zone = useAppStore((s) => s.zone);
  const mode = useAppStore((s) => s.mode);
  const token = useAuth((s) => s.token);
  const user = useAuth((s) => s.user);

  // refresh the profile (farm_ids) once per session; a 401 logs out (api client)
  useEffect(() => {
    if (token) api.me().then((u) => useAuth.getState().setUser(u)).catch(() => undefined);
  }, [token]);

  useEffect(() => {
    document.documentElement.lang = lang;
    document.documentElement.dir = lang === 'ar' ? 'rtl' : 'ltr';
  }, [lang]);

  // initialise month / zone from config.json once it is loaded
  useEffect(() => {
    const cfg = config.data;
    if (!cfg) return;
    const s = useAppStore.getState();
    const pl = cfg.pipeline;
    if (pl) setMonthOverride(pl.forecast_month_key, (l) => translate(l, 'ctrl.nextWeekTitle', { week: fmtWeek(pl.forecast_week, l) }));
    if (!s.month) s.setMonth(cfg.months.last_observed);
    const ids = cfg.zones.map((z) => z.id);
    if (!ids.includes(s.zone)) s.setZone(cfg.ui?.default_zone && ids.includes(cfg.ui.default_zone) ? cfg.ui.default_zone : ids[0]);
  }, [config.data]);

  if (config.isError || zones.isError) return <BootError onRetry={() => { config.refetch(); zones.refetch(); }} />;
  if (!config.data || !zones.data || !month || !config.data.zones.some((z) => z.id === zone)) return <BootScreen />;

  // Farmer mode: only "My farm" (or the farm picker) and "About". Expert mode: the zone-wide screens.
  // Farmer mode: login -> onboarding (until the farm is saved) -> my farm. Expert mode: zone-wide screens.
  const farmerPage = (): Route | 'picker' => {
    if (route === 'about') return 'about';
    if (!token || !user) return 'login';
    if (!user.farm_ids.length || route === 'onboarding') return 'onboarding';
    if (route === 'stats' || route === 'control' || route === 'edit') return route;
    return 'profile';
  };
  const expertOnly: Route[] = ['farm', 'login', 'onboarding', 'profile', 'stats', 'control', 'edit'];
  const pageKey = mode === 'farmer' ? farmerPage() : expertOnly.includes(route) ? 'dashboard' : route;
  const Page = pageKey === 'picker' ? FarmPicker : PAGES[pageKey as Route];
  return (
    <div className="app-bg relative flex h-dvh flex-col overflow-hidden">
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:start-2 focus:top-2 focus:z-[2000] focus:rounded-lg focus:bg-water-500 focus:px-3 focus:py-2 focus:text-ink-950">
        {t('app.skip')}
      </a>
      <PatternDefs colors={config.data.class_colors} />
      <TopBar route={pageKey === 'picker' ? 'farm' : (pageKey as Route)} onNavigate={navigate} />
      {config.data.data_source === 'synthetic' && <SyntheticBanner />}
      {config.data.pipeline && <RealDataBanner info={config.data.pipeline} />}
      <main id="main" className="relative min-h-0 flex-1">
        {/* enter-only transition: the previous page unmounts at once (exit animations of pages that
            hold WebGL canvases / Leaflet maps could stall AnimatePresence) */}
        <motion.div
          key={pageKey}
          className="thin-scroll absolute inset-0 overflow-y-auto"
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
        >
          <ErrorBoundary resetKey={pageKey} title={t('common.error')}>
            <Suspense fallback={<PageSkeleton />}>
              <Page />
            </Suspense>
          </ErrorBoundary>
        </motion.div>
      </main>
      <Footer />
      <Toaster />
    </div>
  );
}
