/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Weaver Codex-like palette (see ARCHITECTURE.md §7)
        app: {
          bg: '#0E0F0C',
          sidebar: '#171915',
          elevated: '#1E211D',
          input: '#232722',
        },
        border: {
          DEFAULT: '#2C302B',
          accent: '#3A3F38',
        },
        text: {
          primary: '#F4F4F0',
          secondary: '#9CA3A0',
          muted: '#6B736E',
        },
        accent: {
          DEFAULT: '#8FB89B',
          strong: '#A8C9B8',
        },
        danger: '#E07A5F',
        warning: '#E8B86A',
        success: '#7BAE7F',
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
      },
    },
  },
  plugins: [],
};
