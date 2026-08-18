import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  isThemePreference,
  getStoredTheme,
  resolveIsDark,
  applyTheme,
  THEME_STORAGE_KEY,
  THEME_INIT_SCRIPT,
} from "~/lib/theme.js";

describe("Theme management", () => {
  let storage: Record<string, string> = {};
  let classList: Set<string> = new Set();
  let style: Record<string, string> = {};

  beforeEach(() => {
    storage = {};
    classList = new Set();
    style = {};

    globalThis.localStorage = {
      getItem: (key: string) => storage[key] ?? null,
      setItem: (key: string, val: string) => {
        storage[key] = val;
      },
      removeItem: (key: string) => {
        delete storage[key];
      },
      clear: () => {
        storage = {};
      },
      key: () => null,
      length: 0,
    };

    globalThis.document = {
      documentElement: {
        classList: {
          add: (cls: string) => classList.add(cls),
          remove: (cls: string) => classList.delete(cls),
          toggle: (cls: string, force?: boolean) => {
            const has = classList.has(cls);
            const next = force !== undefined ? force : !has;
            if (next) classList.add(cls);
            else classList.delete(cls);
            return next;
          },
          contains: (cls: string) => classList.has(cls),
        },
        style: style as unknown as CSSStyleDeclaration,
      },
    } as unknown as Document;

    globalThis.window = {
      matchMedia: vi.fn().mockImplementation((query: string) => ({
        matches: false,
        media: query,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
      localStorage: globalThis.localStorage,
    } as unknown as Window & typeof globalThis;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("isThemePreference", () => {
    it("accepts valid preferences", () => {
      expect(isThemePreference("light")).toBe(true);
      expect(isThemePreference("dark")).toBe(true);
      expect(isThemePreference("system")).toBe(true);
    });

    it("rejects invalid values", () => {
      expect(isThemePreference(null)).toBe(false);
      expect(isThemePreference("")).toBe(false);
      expect(isThemePreference("auto")).toBe(false);
      expect(isThemePreference("dim")).toBe(false);
    });
  });

  describe("getStoredTheme", () => {
    it("defaults to system when no storage exists", () => {
      expect(getStoredTheme()).toBe("system");
    });

    it("retrieves stored preference", () => {
      localStorage.setItem(THEME_STORAGE_KEY, "light");
      expect(getStoredTheme()).toBe("light");

      localStorage.setItem(THEME_STORAGE_KEY, "dark");
      expect(getStoredTheme()).toBe("dark");
    });

    it("falls back to system for invalid stored preference", () => {
      localStorage.setItem(THEME_STORAGE_KEY, "invalid");
      expect(getStoredTheme()).toBe("system");
    });
  });

  describe("resolveIsDark", () => {
    it("returns false for light", () => {
      expect(resolveIsDark("light")).toBe(false);
    });

    it("returns true for dark", () => {
      expect(resolveIsDark("dark")).toBe(true);
    });

    it("checks matchMedia for system", () => {
      window.matchMedia = vi.fn().mockImplementation((query) => ({
        matches: query.includes("dark"),
        media: query,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      }));

      expect(resolveIsDark("system")).toBe(true);

      window.matchMedia = vi.fn().mockImplementation(() => ({
        matches: false,
        media: "",
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      }));

      expect(resolveIsDark("system")).toBe(false);
    });
  });

  describe("applyTheme", () => {
    it("applies light theme by removing .dark class and setting colorScheme to light", () => {
      document.documentElement.classList.add("dark");
      applyTheme("light");

      expect(document.documentElement.classList.contains("dark")).toBe(false);
      expect(document.documentElement.style.colorScheme).toBe("light");
      expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe("light");
    });

    it("applies dark theme by adding .dark class and setting colorScheme to dark", () => {
      applyTheme("dark");

      expect(document.documentElement.classList.contains("dark")).toBe(true);
      expect(document.documentElement.style.colorScheme).toBe("dark");
      expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe("dark");
    });
  });

  describe("THEME_INIT_SCRIPT", () => {
    it("is defined and contains logic to set theme before hydration", () => {
      expect(THEME_INIT_SCRIPT).toContain("cp-theme");
      expect(THEME_INIT_SCRIPT).toContain("colorScheme");
      expect(THEME_INIT_SCRIPT).toContain("dark");
    });
  });
});
