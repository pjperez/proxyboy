/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/renderer/**/*.{ts,tsx,html}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        'pb-bg': '#1a1b26',
        'pb-surface': '#24283b',
        'pb-surface-hover': '#2f334d',
        'pb-border': '#3b3f5c',
        'pb-text': '#c0caf5',
        'pb-text-dim': '#565f89',
        'pb-accent': '#7aa2f7',
        'pb-success': '#9ece6a',
        'pb-warning': '#e0af68',
        'pb-error': '#f7768e',
        'pb-info': '#7dcfff',
      },
    },
  },
  plugins: [],
};
