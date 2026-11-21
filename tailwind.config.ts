import type { Config } from 'tailwindcss';
import { COLOURS } from './lib/design/tokens';

const config: Config = {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        nuit: { DEFAULT: COLOURS.nuit, raised: COLOURS.nuitRaised },
        papier: { DEFAULT: COLOURS.papier, deep: COLOURS.papierDeep },
        ink: { DEFAULT: COLOURS.ink, muted: COLOURS.inkMuted },
        bordeaux: { DEFAULT: COLOURS.bordeaux, dark: COLOURS.bordeauxDark },
        or: { DEFAULT: COLOURS.or, soft: COLOURS.orSoft },
        line: COLOURS.line,
      },
      fontFamily: {
        display: ['var(--font-display)', 'Georgia', 'serif'],
        body: ['var(--font-body)', 'system-ui', 'sans-serif'],
        label: ['var(--font-label)', 'ui-monospace', 'monospace'],
      },
      maxWidth: { page: '84rem' },
      letterSpacing: { label: '0.14em' },
    },
  },
  plugins: [],
};

export default config;
