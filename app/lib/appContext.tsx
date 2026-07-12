import { createContext, useContext, useMemo, type ReactNode } from "react";
import { useSearchParams } from "react-router";

const DEFAULT_APP_KEY = "saleswitch";

export interface AppContextValue {
  readonly appKey: string;
  readonly setAppKey: (key: string) => void;
}

const AppContext = createContext<AppContextValue | null>(null);

/** Syncs the active app with the `?app=` search param (cp-app-registry-connector). */
export function AppProvider({ children }: { children: ReactNode }) {
  const [searchParams, setSearchParams] = useSearchParams();
  const appKey = searchParams.get("app") ?? DEFAULT_APP_KEY;

  const value = useMemo<AppContextValue>(
    () => ({
      appKey,
      setAppKey: (key: string) => {
        setSearchParams(
          (prev) => {
            const next = new URLSearchParams(prev);
            next.set("app", key);
            return next;
          },
          { replace: true },
        );
      },
    }),
    [appKey, setSearchParams],
  );

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useAppContext(): AppContextValue {
  const ctx = useContext(AppContext);
  if (!ctx) {
    throw new Error("useAppContext must be used within AppProvider");
  }
  return ctx;
}

export { DEFAULT_APP_KEY };
