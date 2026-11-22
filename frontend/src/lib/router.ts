import { useEffect, useState } from 'react';

export const ROUTES = ['home', 'farm', 'profile', 'edit', 'stats', 'control', 'onboarding', 'login', 'dashboard', 'plan', 'network', 'energy', 'actuation', 'about'] as const;
export type Route = (typeof ROUTES)[number];

function parse(): Route {
  const raw = window.location.hash.replace(/^#\/?/, '').split('?')[0];
  return (ROUTES as readonly string[]).includes(raw) ? (raw as Route) : 'farm';
}

/** Minimal hash router: #/dashboard, #/network, #/energy, #/actuation, #/about */
export function useHashRoute(): [Route, (r: Route) => void] {
  const [route, setRoute] = useState<Route>(parse);
  useEffect(() => {
    const onChange = () => setRoute(parse());
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);
  return [route, (r: Route) => (window.location.hash = `/${r}`)];
}
