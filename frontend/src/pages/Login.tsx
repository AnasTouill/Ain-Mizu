import { motion } from 'framer-motion';
import { Loader2, LogIn, Sprout, UserPlus } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { ApiError, api } from '../api/client';
import { FullLogo } from '../components/layout/Logo';
import { useT } from '../i18n';
import { useAppStore } from '../store/useAppStore';
import { useAuth } from '../store/useAuth';

const DEMO = ['farmer.kebili@demo.tn', 'farmer.kairouan@demo.tn', 'farmer.sidibouzid@demo.tn'];

/** Page 0 (ARCHITECTURE.md 15): sign in or create a farmer account. */
export default function Login() {
  const t = useT();
  const lang = useAppStore((s) => s.lang);
  const setAuth = useAuth((s) => s.setAuth);
  const [tab, setTab] = useState<'login' | 'register'>('login');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = tab === 'login' ? await api.login(email, password) : await api.register(name, email, password, lang);
      setAuth(res.access_token, res.user);
      window.location.hash = res.user.farm_ids.length ? '/profile' : '/onboarding';
    } catch (err) {
      setError(err instanceof ApiError && err.status !== 0 ? err.message : t('app.backendDown'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-full items-center justify-center p-4">
      <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} className="glass-strong w-full max-w-md p-6">
        <div className="mb-5 flex flex-col items-center gap-3 text-center">
          <FullLogo width={150} />
          <div>
            <h1 className="font-display text-2xl font-bold text-white">{t('auth.title')}</h1>
            <p className="text-sm text-slate-400">{t('auth.subtitle')}</p>
          </div>
        </div>

        <div className="mb-4 grid grid-cols-2 gap-1 rounded-xl border border-white/10 bg-white/5 p-1" role="tablist">
          {(['login', 'register'] as const).map((k) => (
            <button
              key={k}
              role="tab"
              aria-selected={tab === k}
              onClick={() => { setTab(k); setError(null); }}
              className={`flex items-center justify-center gap-1.5 rounded-lg py-2 text-sm font-semibold transition ${tab === k ? 'bg-water-500/25 text-white' : 'text-slate-400 hover:text-white'}`}
            >
              {k === 'login' ? <LogIn size={15} /> : <UserPlus size={15} />}
              {t(k === 'login' ? 'auth.login' : 'auth.register')}
            </button>
          ))}
        </div>

        <form onSubmit={submit} className="space-y-3">
          {tab === 'register' && (
            <label className="block">
              <span className="label">{t('auth.name')}</span>
              <input required value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" className="input mt-1" placeholder="Ali Ben Salah" />
            </label>
          )}
          <label className="block">
            <span className="label">{t('auth.email')}</span>
            <input required type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" className="input mt-1" placeholder="nom@exemple.tn" />
          </label>
          <label className="block">
            <span className="label">{t('auth.password')}</span>
            <input required type="password" minLength={6} value={password} onChange={(e) => setPassword(e.target.value)} autoComplete={tab === 'login' ? 'current-password' : 'new-password'} className="input mt-1" />
          </label>
          {error && <p role="alert" className="rounded-lg border border-red-400/30 bg-red-500/10 px-3 py-2 text-sm text-red-200">{error}</p>}
          <button disabled={busy} className="flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-water-500 to-slime-400 py-2.5 font-bold text-ink-950 transition hover:brightness-110 disabled:opacity-60">
            {busy ? <Loader2 size={16} className="animate-spin" /> : tab === 'login' ? <LogIn size={16} /> : <Sprout size={16} />}
            {t(tab === 'login' ? 'auth.loginBtn' : 'auth.registerBtn')}
          </button>
        </form>

        {tab === 'login' && (
          <div className="mt-4 rounded-xl border border-white/10 bg-white/5 p-3 text-xs text-slate-400">
            <div className="mb-1 font-semibold text-slate-300">{t('auth.demo')}</div>
            {DEMO.map((d) => (
              <button key={d} type="button" onClick={() => { setEmail(d); setPassword('demo1234'); }} className="block font-mono text-water-200 hover:underline">
                {d}
              </button>
            ))}
            <div className="mt-1">{t('auth.demoPw')} <span className="font-mono text-slate-200">demo1234</span></div>
          </div>
        )}
      </motion.div>
    </div>
  );
}
