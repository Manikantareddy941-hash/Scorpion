/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        surface: {
          light: '#ffffff',
          dark: '#0f172a',
        },
        card: {
          light: '#f8fafc',
          dark: '#111827',
        },
      },
    },
  },
  plugins: [],
};
