/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      fontFamily: {
        sans: ['Geist', 'system-ui', 'sans-serif'],
        heading: ['Instrument Serif', 'Georgia', 'serif'],
        mono: ['monospace'],
      },
      colors: {
        accent: {
          light: '#eff6ff',
          mid: '#bfdbfe',
          DEFAULT: '#1d4ed8',
          dark: '#1e40af',
        },
        surface: '#f3f4f6',
        border: {
          DEFAULT: '#e5e7eb',
          strong: '#d1d5db',
        },
        text: {
          DEFAULT: '#111827',
          muted: '#6b7280',
          subtle: '#9ca3af',
        },
        danger: {
          light: '#fef2f2',
          DEFAULT: '#dc2626',
        },
        warning: {
          light: '#fffbeb',
          DEFAULT: '#d97706',
        },
        success: {
          light: '#f0fdf4',
          DEFAULT: '#16a34a',
        },
      },
      borderRadius: {
        'xl': '12px',
        'lg': '10px',
        'md': '8px',
      },
      boxShadow: {
        sm: '0 1px 3px rgba(0,0,0,0.06), 0 1px 2px rgba(0,0,0,0.04)',
        DEFAULT: '0 4px 16px rgba(0,0,0,0.06), 0 2px 6px rgba(0,0,0,0.04)',
        lg: '0 20px 48px rgba(0,0,0,0.08), 0 8px 16px rgba(0,0,0,0.04)',
      },
    },
  },
  plugins: [],
};
