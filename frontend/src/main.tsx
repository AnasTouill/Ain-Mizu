import { MutationCache, QueryCache, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import ReactDOM from 'react-dom/client';
import 'leaflet/dist/leaflet.css';
import App from './App';
import { ApiError } from './api/client';
import { translate } from './i18n';
import './index.css';
import { toast } from './store/toasts';
import { useAppStore } from './store/useAppStore';

/** Every failed request surfaces as an error toast (de-duplicated in the toast store). */
function reportError(error: unknown) {
  const lang = useAppStore.getState().lang;
  if (error instanceof ApiError && error.status === 0) {
    toast.error(translate(lang, 'app.backendDown'), translate(lang, 'app.backendDownHint'));
  } else if (error instanceof ApiError) {
    toast.error(translate(lang, 'common.error'), error.message);
  } else {
    toast.error(translate(lang, 'common.error'), error instanceof Error ? error.message : String(error));
  }
}

const queryClient = new QueryClient({
  queryCache: new QueryCache({ onError: (error) => reportError(error) }),
  mutationCache: new MutationCache({ onError: (error) => reportError(error) }),
  defaultOptions: {
    queries: {
      staleTime: 60_000,
      refetchOnWindowFocus: false,
      retry: (count, error) => !(error instanceof ApiError && error.status >= 400 && error.status < 500) && count < 2,
    },
  },
});

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </React.StrictMode>,
);
