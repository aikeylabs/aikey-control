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
      // Themeable radius (2026-09-04). These were hardcoded 2/4/4/6px, so every
      // `rounded-*` class in the app ignored the theme. The tokens' DARK values
      // are exactly those numbers, so dark geometry is unchanged; light
      // redefines them (8/10/12/16px) to match the reference design.
      borderRadius: {
        sm: 'var(--rad-sm)',
        DEFAULT: 'var(--rad)',
        md: 'var(--rad-md)',
        lg: 'var(--rad-lg)',
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
