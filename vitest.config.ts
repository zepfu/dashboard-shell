import path from 'path'
import react from '@vitejs/plugin-react-swc'
import { defineConfig } from 'vitest/config'

// NOTE: We intentionally do NOT import the @module-federation/vite plugin here.
// The federation plugin is incompatible with Vitest's test runner (it expects a
// real browser host environment and creates singleton conflicts). We also exclude
// tanstackRouter since it is a code-generation/dev-server concern only.
export default defineConfig({
  plugins: [react()],
  define: {
    'import.meta.env.DEV': JSON.stringify(false),
    'import.meta.env.PROD': JSON.stringify(true),
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  test: {
    projects: [
      // Frontend jsdom project (default for UI/component tests).
      {
        extends: true,
        test: {
          name: 'frontend',
          environment: 'jsdom',
          globals: true,
          setupFiles: ['src/test/setup.ts'],
          include: ['src/**/*.test.{ts,tsx}'],
          exclude: ['server/**'],
          // Process CSS files so that `import './tasks.module.css'` side-effects
          // inject rules into document.styleSheets during jsdom tests.
          // Required for plugin-theme-override.test.tsx stylesheet scanning.
          css: {
            include: /.+/,
          },
        },
      },
      // Server node project (for report-service query builders and other Node-only tests).
      // Uses environment: 'node' so that native Node modules (redis, pg, pgsql-parser) can be imported
      // without bundling failures that occur under jsdom.
      {
        test: {
          name: 'server',
          environment: 'node',
          globals: true,
          include: ['server/**/*.test.{ts,mts}'],
        },
      },
    ],
  },
})
