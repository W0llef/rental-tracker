import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { readFileSync } from 'node:fs';

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as {
  version: string;
};

/**
 * Build settings come from environment variables so the same code can be built for:
 *  - local development            (base "/",                      channel "dev")
 *  - the live app on main         (base "/rental-tracker/",        channel "live")
 *  - a milestone in review        (base "/rental-tracker/preview/", channel "preview")
 * See .github/workflows/deploy.yml and README.md.
 */
const base = process.env.APP_BASE ?? '/';
// Tests always run as a development build, whatever the deploy settings are.
const channel = process.env.VITEST ? 'dev' : (process.env.APP_CHANNEL ?? 'dev');

export default defineConfig({
  base,
  plugins: [react()],
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
    __APP_CHANNEL__: JSON.stringify(channel),
    __APP_COMMIT__: JSON.stringify(process.env.APP_COMMIT ?? 'local'),
    __APP_BRANCH__: JSON.stringify(process.env.APP_BRANCH ?? 'local'),
  },
  build: {
    target: 'es2022',
    sourcemap: true,
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./tests/setup.ts'],
    include: [
      'tests/unit/**/*.test.{ts,tsx}',
      'tests/db/**/*.test.{ts,tsx}',
      'tests/components/**/*.test.{ts,tsx}',
    ],
  },
});
