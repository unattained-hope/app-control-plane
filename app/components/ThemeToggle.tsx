import { useEffect, useState } from "react";
import {
  applyTheme,
  getStoredTheme,
  resolveIsDark,
  type ThemePreference,
} from "~/lib/theme.js";

const OPTIONS: ReadonlyArray<{
  readonly value: ThemePreference;
  readonly label: string;
  readonly title: string;
}> = [
  { value: "light", label: "Light", title: "Light mode" },
  { value: "system", label: "System", title: "Match system appearance" },
  { value: "dark", label: "Dark", title: "Dark mode" },
];

function SunIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="4" stroke="currentColor" strokeWidth="2" />
      <path
        d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  );
}

function SystemIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect x="3" y="4" width="18" height="12" rx="2" stroke="currentColor" strokeWidth="2" />
      <path d="M8 20h8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

function MoonIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M21 14.5A8.5 8.5 0 0 1 9.5 3 7 7 0 1 0 21 14.5Z"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinejoin="round"
      />
    </svg>
  );
}

const ICONS: Record<ThemePreference, () => JSX.Element> = {
  light: SunIcon,
  system: SystemIcon,
  dark: MoonIcon,
};

/**
 * Three-way theme control: light, system (default), or dark.
 * Syncs with the blocking script in root Layout and OS preference changes.
 */
export function ThemeToggle() {
  const [preference, setPreference] = useState<ThemePreference>("system");

  useEffect(() => {
    const stored = getStoredTheme();
    setPreference(stored);
    applyTheme(stored);

    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onSystemChange = () => {
      if (getStoredTheme() === "system") applyTheme("system");
    };
    mq.addEventListener("change", onSystemChange);
    return () => mq.removeEventListener("change", onSystemChange);
  }, []);

  function select(next: ThemePreference) {
    setPreference(next);
    applyTheme(next);
  }

  return (
    <div
      className="apoaap-theme-toggle"
      role="radiogroup"
      aria-label="Color theme"
    >
      {OPTIONS.map((opt) => {
        const Icon = ICONS[opt.value];
        const active = preference === opt.value;
        return (
          <button
            key={opt.value}
            type="button"
            role="radio"
            aria-checked={active}
            title={opt.title}
            className={`apoaap-theme-toggle-btn${active ? " is-active" : ""}`}
            onClick={() => select(opt.value)}
          >
            <Icon />
            <span className="apoaap-theme-toggle-label">{opt.label}</span>
          </button>
        );
      })}
    </div>
  );
}

/** Resolved appearance for conditional UI (e.g. chart colors). */
export function useResolvedDark(): boolean {
  const [dark, setDark] = useState(false);

  useEffect(() => {
    const update = () => setDark(resolveIsDark(getStoredTheme()));
    update();

    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    mq.addEventListener("change", update);
    const observer = new MutationObserver(update);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class"],
    });
    return () => {
      mq.removeEventListener("change", update);
      observer.disconnect();
    };
  }, []);

  return dark;
}
