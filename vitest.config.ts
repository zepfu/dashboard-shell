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
    environment: 'jsdom',
    globals: true,
    setupFiles: ['src/test/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
  },
})
