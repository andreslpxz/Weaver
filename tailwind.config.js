/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Weaver Codex-like palette mapped to CSS variables (see ARCHITECTURE.md §7)
        app: {
          bg: 'var(--bg-app)',
          sidebar: 'var(--bg-sidebar)',
          elevated: 'var(--bg-elevated)',
          input: 'var(--bg-input)',
        },
        border: {
          DEFAULT: 'var(--border)',
          accent: 'var(--border-accent)',
        },
        text: {
          primary: 'var(--text-primary)',
          secondary: 'var(--text-secondary)',
          muted: 'var(--text-muted)',
        },
        accent: {
          DEFAULT: 'var(--accent)',
          strong: 'var(--accent-strong)',
        },
        danger: 'var(--danger)',
        warning: 'var(--warning)',
        success: 'var(--success)',
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono', 'Fira Code', 'monospace'],
      },
      fontSize: {
        xxs: '0.6875rem',
      },
      borderRadius: {
        codex: '0.5rem',
      },
      animation: {
        'fade-in': 'fadeIn 0.15s ease-out',
        'slide-up': 'slideUp 0.18s ease-out',
        'pulse-soft': 'pulseSoft 1.6s ease-in-out infinite',
        'breathe': 'breathe 4s ease-in-out infinite',
        'breathe-active': 'breatheActive 1.4s ease-in-out infinite',
        'waveform': 'waveform 0.8s ease-in-out infinite',
        'ripple': 'ripple 2s ease-out infinite',
        'spin-slow': 'spin 3s linear infinite',
      },
      keyframes: {
        fadeIn: { '0%': { opacity: '0' }, '100%': { opacity: '1' } },
        slideUp: {
          '0%': { opacity: '0', transform: 'translateY(4px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        pulseSoft: {
          '0%,100%': { opacity: '1' },
          '50%': { opacity: '0.6' },
        },
        breathe: {
          '0%,100%': { transform: 'scale(1)', opacity: '0.9' },
          '50%': { transform: 'scale(1.06)', opacity: '1' },
        },
        breatheActive: {
          '0%,100%': { transform: 'scale(1)', opacity: '0.85' },
          '50%': { transform: 'scale(1.15)', opacity: '1' },
        },
        waveform: {
          '0%,100%': { transform: 'scaleY(0.4)' },
          '50%': { transform: 'scaleY(1)' },
        },
        ripple: {
          '0%': { transform: 'scale(1)', opacity: '0.6' },
          '100%': { transform: 'scale(2.4)', opacity: '0' },
        },
      },
    },
  },
  plugins: [],
};
