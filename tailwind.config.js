/** @type {import('tailwindcss').Config} */

/* ────────────────────────────────────────────────────────────────────────
 * DESIGN TOKENS
 * Single source of truth for the Scorpion design system.
 * Consume these via Tailwind utilities (bg-neutral-900, text-accent,
 * bg-severity-critical-bg, shadow-md, rounded-lg, …) — avoid ad-hoc hex
 * values in components.
 * ──────────────────────────────────────────────────────────────────────── */

// Neutral gray scale — the dominant surface & text palette.
// 950/900 = app & surface backgrounds, 800 = borders, 300 = body text.
const neutral = {
  50: '#fafafa',
  100: '#f4f4f5',
  200: '#e4e4e7',
  300: '#d4d4d8',
  400: '#a1a1aa',
  500: '#71717a',
  600: '#52525b',
  700: '#3f3f46',
  800: '#27272a',
  900: '#18181b',
  950: '#0b0b0d',
};

// The ONE accent color (brand green). Use sparingly: primary actions,
// active states, key highlights. DEFAULT/400 is the established brand tone.
const accent = {
  50: '#f0f9f1',
  100: '#dcf0de',
  200: '#bbe1c0',
  300: '#93cd9c',
  400: '#6db87a', // brand
  500: '#4e9f5d',
  600: '#3c8049',
  700: '#32663d',
  800: '#2b5234',
  900: '#24432c',
  950: '#102417',
  DEFAULT: '#6db87a',
};

// Semantic tokens for security severity. Each exposes:
//   DEFAULT → vivid color (icons / emphasis)
//   fg      → readable text on dark surfaces
//   bg      → subtle tinted background (badges, row highlights)
//   border  → subtle outline
const severity = {
  critical: {
    DEFAULT: '#ef4444', // red
    fg: '#fca5a5',
    bg: 'rgb(239 68 68 / 0.12)',
    border: 'rgb(239 68 68 / 0.30)',
  },
  high: {
    DEFAULT: '#f97316', // orange
    fg: '#fdba74',
    bg: 'rgb(249 115 22 / 0.12)',
    border: 'rgb(249 115 22 / 0.30)',
  },
  medium: {
    DEFAULT: '#f59e0b', // amber
    fg: '#fcd34d',
    bg: 'rgb(245 158 11 / 0.12)',
    border: 'rgb(245 158 11 / 0.30)',
  },
  low: {
    DEFAULT: '#3b82f6', // blue
    fg: '#93c5fd',
    bg: 'rgb(59 130 246 / 0.12)',
    border: 'rgb(59 130 246 / 0.30)',
  },
  info: {
    DEFAULT: '#64748b', // slate
    fg: '#cbd5e1',
    bg: 'rgb(100 116 139 / 0.14)',
    border: 'rgb(100 116 139 / 0.30)',
  },
};

/* ────────────────────────────────────────────────────────────────────────
 * LEGACY COLOR ALIASES (transitional)
 * The codebase funnels emerald/green/blue/cyan/sky into a single brand
 * green and uses indigo as a gray scale. These aliases route those legacy
 * class names through the new tokens so existing components keep their
 * current appearance until they are migrated onto neutral/accent/severity
 * in the later design-system steps. Remove once migration is complete.
 * ──────────────────────────────────────────────────────────────────────── */
const SHADES = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950];
const mono = (hex) =>
  Object.fromEntries([...SHADES.map((s) => [s, hex]), ['DEFAULT', hex]]);

const legacyAccent = mono(accent.DEFAULT); // was var(--color-primary)

export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        neutral,
        accent,
        severity,

        // Back-compat semantic aliases.
        primary: accent.DEFAULT,
        surface: {
          light: '#ffffff',
          dark: neutral[950],
        },
        card: {
          light: neutral[50],
          dark: neutral[900],
        },

        // Legacy aliases — see note above.
        emerald: legacyAccent,
        green: legacyAccent,
        blue: legacyAccent,
        cyan: legacyAccent,
        sky: legacyAccent,
        indigo: neutral,
      },

      fontFamily: {
        sans: [
          'Inter',
          'ui-sans-serif',
          'system-ui',
          '-apple-system',
          'Segoe UI',
          'Roboto',
          'Helvetica Neue',
          'Arial',
          'sans-serif',
        ],
        mono: [
          'JetBrains Mono',
          'ui-monospace',
          'SFMono-Regular',
          'Menlo',
          'Consolas',
          'monospace',
        ],
      },

      // Extra spacing steps layered on top of Tailwind's default scale.
      spacing: {
        4.5: '1.125rem',
        5.5: '1.375rem',
        7.5: '1.875rem',
        13: '3.25rem',
        15: '3.75rem',
        18: '4.5rem',
      },

      // Border-radius scale.
      borderRadius: {
        sm: '0.375rem', // 6px
        md: '0.5rem', //  8px
        lg: '0.75rem', // 12px
      },

      // Three subtle elevation levels tuned for a dark UI.
      boxShadow: {
        sm: '0 1px 2px 0 rgb(0 0 0 / 0.20)',
        md: '0 2px 6px -1px rgb(0 0 0 / 0.25), 0 1px 2px -1px rgb(0 0 0 / 0.15)',
        lg: '0 8px 24px -6px rgb(0 0 0 / 0.35)',
      },

      // Type scale: display / h1-h4 / body / caption. Generates
      // text-display, text-h1 … utilities; weight is paired in
      // index.css @layer base for native heading tags and components.
      fontSize: {
        display: ['2.25rem', { lineHeight: '1.15', letterSpacing: '-0.02em', fontWeight: '700' }],
        h1: ['1.875rem', { lineHeight: '1.2', letterSpacing: '-0.015em', fontWeight: '600' }],
        h2: ['1.5rem', { lineHeight: '1.25', letterSpacing: '-0.01em', fontWeight: '600' }],
        h3: ['1.25rem', { lineHeight: '1.3', letterSpacing: '-0.005em', fontWeight: '600' }],
        h4: ['1.0625rem', { lineHeight: '1.35', letterSpacing: '0em', fontWeight: '600' }],
        body: ['0.875rem', { lineHeight: '1.55', letterSpacing: '0em', fontWeight: '400' }],
        caption: ['0.75rem', { lineHeight: '1.4', letterSpacing: '0.01em', fontWeight: '500' }],
      },
    },

    // Default border color when a `border` utility is used without an
    // explicit color (Tailwind's preflight otherwise falls back to gray-200).
    borderColor: ({ theme }) => ({
      ...theme('colors'),
      DEFAULT: neutral[800],
    }),
  },
  plugins: [],
};
