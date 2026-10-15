import type { Config } from 'tailwindcss';

// Stratos design tokens. The palette is deliberately small so the accents stay special:
//   electric / cyan   the atmosphere and interactive elements
//   violet / ultra    rarity and special effects
//   coral / orange    the primary call to action and energy
//   lime              the lock-in action and success
//   navy / indigo     high altitude and space
//
// Typography uses SYSTEM rounded faces only (no web font is downloaded): `ui-rounded` on Apple
// devices, Arial Rounded or Trebuchet elsewhere. It looks rounder on Apple devices than on Windows
// or Linux, which is the price of loading nothing from the network.
const config: Config = {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        abyss: {
          950: '#02060d',
          900: '#050d1a',
          800: '#0a1a2e',
        },
        stratos: {
          electric: '#2b7bff',
          cyan: '#22d3ee',
          sky: '#7fe3ff',
          violet: '#8b5cf6',
          ultra: '#7c3aed',
          coral: '#ff6b57',
          orange: '#ffa62b',
          lime: '#b8f23a',
          navy: '#070a2b',
          indigo: '#141a5c',
        },
      },
      fontFamily: {
        display: [
          'ui-rounded',
          '"SF Pro Rounded"',
          '"Arial Rounded MT Bold"',
          'Nunito',
          '"Trebuchet MS"',
          'system-ui',
          'sans-serif',
        ],
      },
    },
  },
  plugins: [],
};

export default config;
