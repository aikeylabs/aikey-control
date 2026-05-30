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

// Re-render the whole app subtree when the i18n language changes.
//
// Why: date/time strings come from `shared/utils/datetime-intl`, whose
// `locale()` reads the i18next singleton directly (not via the React
// `useTranslation` hook). Components that don't call `useTranslation`
// therefore don't subscribe to `languageChanged` and keep showing the old
// locale's dates until something else happens to re-render them.
//
// The least invasive correct fix is one high-level subscription here (the
// provider that wraps the entire RouterProvider): bumping local state forces
// React to re-render the subtree, so every `datetime-intl` call site
// recomputes against the new locale — without editing each call site and
// without remounting the app. A state bump preserves component instances and
// router / query state, whereas a `key` change or full remount would discard
// them.
function useLanguageRerender(): void {
  const [, force] = React.useReducer((n: number) => n + 1, 0);
  React.useEffect(() => {
    i18n.on('languageChanged', force);
    return () => {
      i18n.off('languageChanged', force);
    };
  }, []);
}

interface AppProvidersProps {
  children: React.ReactNode;
}

export function AppProviders({ children }: AppProvidersProps) {
  useLanguageRerender();
  return (
    <QueryClientProvider client={queryClient}>
      {children}
    </QueryClientProvider>
  );
}
