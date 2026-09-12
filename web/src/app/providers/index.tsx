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
    function onLanguageChanged() {
      forceRender();
      // 🔴 Re-fetch the responses whose TEXT the SERVER localizes.
      //
      // A re-render is enough for anything formatted in the browser, and it was
      // enough for everything here until 2026-08-19, when the licence status
      // became locale-dependent on the server: design D12 makes the page, the
      // banner, the CLI and the reminder email render the same sentence, so
      // `reason`, `next_step.summary` and `reminder.headline` are composed and
      // translated on that side and printed verbatim here.
      //
      // The client sends the current language as Accept-Language, so a cached
      // response carries the language it was FETCHED under. Without this the
      // page switches to Chinese while those three sentences stay English until
      // the 60s refetch or a reload — measured in the browser, which is how this
      // was found.
      //
      // 🚫 Scoped to 'license' rather than invalidating everything: it is the only
      // cached payload the server localizes today. Error messages are localized
      // too (shared.LocaleMiddleware) but arrive per mutation and are never cached.
      // A blanket invalidation would re-fetch every table on a language toggle.
      void queryClient.invalidateQueries({ queryKey: ['license'] });
    }
    i18n.on('languageChanged', onLanguageChanged);
    return () => {
      i18n.off('languageChanged', onLanguageChanged);
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
