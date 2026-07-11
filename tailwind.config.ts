import type { Config } from "tailwindcss";

/**
 * Control-plane visual design (cp-visual-design). Tailwind v3 + Tremor 3.
 *
 * - `content` MUST include the @tremor/react package or its classes are purged
 *   in the production build (cp-visual-design D5).
 * - `colors.cp.*` are Filament-aligned tokens (CSS variables in app/styles/tokens.css).
 * - `colors.tremor.*` map Tremor's component classes onto the SAME tokens, so the
 *   custom `apoaap-*` CSS and Tremor read one palette.
 */
export default {
  darkMode: "class",
  content: [
    "./app/**/*.{ts,tsx}",
    "./node_modules/@tremor/react/**/*.{js,mjs}",
  ],
  theme: {
    extend: {
      colors: {
        // Filament orange + gray tokens.
        cp: {
          bg: "var(--cp-bg)",
          surface: "var(--cp-surface)",
          "surface-2": "var(--cp-surface-2)",
          border: "var(--cp-border)",
          text: "var(--cp-text)",
          "text-muted": "var(--cp-text-muted)",
          "text-subtle": "var(--cp-text-subtle)",
          accent: "var(--cp-accent)",
          "accent-hover": "var(--cp-accent-hover)",
          "accent-subtle": "var(--cp-accent-subtle)",
          "ok": "var(--cp-ok)",
          "warn": "var(--cp-warn)",
          "danger": "var(--cp-danger)",
          "note-bg": "var(--cp-note-bg)",
          "note-border": "var(--cp-note-border)",
          "note-text": "var(--cp-note-text)",
          "note-text-muted": "var(--cp-note-text-muted)",
          "success-bg": "var(--cp-success-bg)",
          "success-border": "var(--cp-success-border)",
          "success-text": "var(--cp-success-text)",
        },
        // Tremor palette mapped onto the same tokens.
        tremor: {
          brand: {
            faint: "var(--cp-accent-subtle)",
            muted: "var(--cp-accent-subtle)",
            subtle: "var(--cp-accent)",
            DEFAULT: "var(--cp-accent)",
            emphasis: "var(--cp-accent-hover)",
            inverted: "var(--cp-surface)",
          },
          background: {
            muted: "var(--cp-bg)",
            subtle: "var(--cp-surface-2)",
            DEFAULT: "var(--cp-surface)",
            emphasis: "var(--cp-text-muted)",
          },
          border: { DEFAULT: "var(--cp-border)" },
          // Card outlines use the NEUTRAL border, not the accent — the accent is
          // reserved for active nav / focus / links (restrained-accent rule).
          ring: { DEFAULT: "var(--cp-border)" },
          content: {
            subtle: "var(--cp-text-subtle)",
            DEFAULT: "var(--cp-text-muted)",
            emphasis: "var(--cp-text)",
            strong: "var(--cp-text)",
            inverted: "var(--cp-surface)",
          },
        },
      },
      borderRadius: {
        "tremor-small": "0.5rem",
        "tremor-default": "0.75rem",
        "tremor-full": "9999px",
      },
      boxShadow: {
        "tremor-card": "var(--cp-shadow-card)",
      },
      fontFamily: {
        sans: ["var(--cp-font-sans)"],
      },
    },
  },
  safelist: [
    // Tremor dynamic classes that the content scanner can miss.
    { pattern: /^(bg|text|border|ring)-(tremor|cp)-/ },
  ],
  plugins: [],
} satisfies Config;
