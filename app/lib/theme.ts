/** User-facing theme preference. `system` follows OS `prefers-color-scheme`. */
export type ThemePreference = "light" | "dark" | "system";

export const THEME_STORAGE_KEY = "cp-theme";

const VALID: ReadonlySet<string> = new Set(["light", "dark", "system"]);

export function isThemePreference(value: string | null): value is ThemePreference {
  return value !== null && VALID.has(value);
}

export function getStoredTheme(): ThemePreference {
  if (typeof window === "undefined") return "system";
  try {
    const stored = localStorage.getItem(THEME_STORAGE_KEY);
    return isThemePreference(stored) ? stored : "system";
  } catch {
    return "system";
  }
}

/** Whether the resolved appearance should use the dark palette. */
export function resolveIsDark(preference: ThemePreference): boolean {
  if (preference === "dark") return true;
  if (preference === "light") return false;
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

/** Apply theme to `<html>` and persist preference. */
export function applyTheme(preference: ThemePreference): void {
  const dark = resolveIsDark(preference);
  document.documentElement.classList.toggle("dark", dark);
  document.documentElement.style.colorScheme = dark ? "dark" : "light";
  try {
    localStorage.setItem(THEME_STORAGE_KEY, preference);
  } catch {
    /* private browsing */
  }
}

/** Blocking script injected in `<head>` to prevent a light flash before hydration. */
export const THEME_INIT_SCRIPT = `(function(){try{var k="cp-theme";var t=localStorage.getItem(k);var d=t==="dark"||(t!=="light"&&window.matchMedia("(prefers-color-scheme: dark)").matches);if(d)document.documentElement.classList.add("dark");document.documentElement.style.colorScheme=d?"dark":"light";}catch(e){}})();`;
