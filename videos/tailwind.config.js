/** @type {import('tailwindcss').Config} */
export default {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Memoria design tokens
        'surface-app': 'var(--surface-app)',
        'surface-sidebar': 'var(--surface-sidebar)',
        'surface-card': 'var(--surface-card)',
        'text-primary': 'var(--text-primary)',
        'text-secondary': 'var(--text-secondary)',
        'text-muted': 'var(--text-muted)',
        'border-default': 'var(--border-default)',
        'accent-blue': 'var(--accent-blue)',
        'state-hover': 'var(--state-hover)',
        'state-selected': 'var(--state-selected)',
      },
      fontFamily: {
        sans: ['Inter', 'sans-serif'],
        mono: ['IBM Plex Mono', 'monospace'],
      },
    },
  },
  plugins: [],
};
