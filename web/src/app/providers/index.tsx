import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import i18n from '@/shared/i18n/i18n';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      staleTime: 30_000,
      refetchOnWindowFocus: false,
    },
  },
});

interface AppProvidersProps {
  children: React.ReactNode;
}

/**
 * Re-render the whole app subtree when the i18n language changes.
 *
 * Why: date/time strings come from `shared/utils/datetime-intl.ts`, whose
 * `locale()` reads the i18next singleton at format time (NOT via a React
 * hook). Components that use those formatters but don't call
 * `useTranslation()` (most chart/table cells) therefore have no subscription
 * to language changes — they keep showing the old locale's dates until some
 * unrelated state change happens to re-render them.
 *
 * The least-invasive correct fix is a SINGLE high-level subscription here,
 * above RouterProvider: on 'languageChanged' we bump a counter, which
 * re-renders `children` (the entire router subtree) once. Every date
 * call-site re-runs and re-reads the new locale — no per-call-site edits,
 * no whole-app remount (a state bump is not a `key` change, so component
 * instances / scroll / focus / react-query cache are all preserved).
 * i18next fires 'languageChanged' after the resources are loaded, so by the
 * time this re-render runs `locale()` already returns the new value.
 */
function LanguageReactivityBoundary({ children }: { children: React.ReactNode }) {
  const [, forceRender] = React.useReducer((n: number) => n + 1, 0);
  React.useEffect(() => {
    i18n.on('languageChanged', forceRender);
    return () => {
      i18n.off('languageChanged', forceRender);
    };
  }, []);
  return <>{children}</>;
}

export function AppProviders({ children }: AppProvidersProps) {
  return (
    <QueryClientProvider client={queryClient}>
      <LanguageReactivityBoundary>{children}</LanguageReactivityBoundary>
    </QueryClientProvider>
  );
}
