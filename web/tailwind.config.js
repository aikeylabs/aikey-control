/** @type {import('tailwindcss').Config} */
export default {
  content: [
    './index.html',
    './src/**/*.{js,ts,jsx,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        background: 'var(--background)',
        foreground: 'var(--foreground)',
        card: {
          DEFAULT: 'var(--card)',
          foreground: 'var(--card-foreground)',
        },
        border: 'var(--border)',
        primary: {
          DEFAULT: 'var(--primary)',
          foreground: 'var(--primary-foreground)',
        },
        muted: {
          DEFAULT: 'var(--muted)',
          foreground: 'var(--muted-foreground)',
        },
        sidebar: {
          DEFAULT: 'var(--sidebar)',
          border: 'var(--sidebar-border)',
          accent: 'var(--sidebar-accent)',
        },
        destructive: {
          DEFAULT: 'var(--destructive)',
        },
      },
      fontFamily: {
        sans: ['Inter', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'monospace'],
      },
      borderRadius: {
        sm: '2px',
        DEFAULT: '4px',
        md: '4px',
        lg: '6px',
      },
      boxShadow: {
        card: 'var(--shadow-sm)',
        'glow-primary': 'var(--glow-primary)',
        'glow-primary-hover': 'var(--glow-primary-hover)',
        'glow-destructive': 'var(--glow-destructive)',
      },
    },
  },
  plugins: [],
};
