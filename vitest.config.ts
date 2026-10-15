import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

// No React plugin yet: every test so far is plain TypeScript on Node (domain logic, services).
// Component tests arrive with Task J and will add the React plugin then. Keep its vite version
// aligned with vitest's, otherwise two copies of vite are installed and `tsc` rejects this file.
export default defineConfig({
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  test: {
    environment: 'node',
    include: ['tests/unit/**/*.test.ts', 'tests/integration/**/*.test.ts'],
    exclude: ['tests/e2e/**', 'node_modules/**'],
  },
});
