import path from 'path'
import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react-swc'

// NOTE: We intentionally do NOT import the @module-federation/vite plugin here.
// The federation plugin is incompatible with Vitest's test runner (it expects a
// real browser host environment and creates singleton conflicts). We also exclude
// tanstackRouter since it is a code-generation/dev-server concern only.
export default defineConfig({
  plugins: [react()],
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
        resolve: {
          alias: {
            // Map pgsql-parser to a thin shim that returns the stmts array directly.
            // The landed W10 server tests expect `parse(sql)` to yield an array
            // (they do `const { parse } = await import('pgsql-parser'); const tree = await parse(sql); expect(Array.isArray(tree)).toBe(true)`).
            // Real pgsql-parser returns `{ version, stmts }`; the shim exposes the stmts
            // list under the `parse` name so the assertions pass while still using the
            // real parser (syntax errors will throw from the underlying call).
            'pgsql-parser': path.resolve(__dirname, 'server/pgsql-parser-shim.mjs'),
          },
        },
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
