import path from 'path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react-swc'
import { federation } from '@module-federation/vite'
import tailwindcss from '@tailwindcss/vite'
import { tanstackRouter } from '@tanstack/router-plugin/vite'

const aawmTapRemoteEntry =
  process.env.AAWM_TAP_REMOTE_ENTRY ?? '/modules/aawm-tap/remoteEntry.js'
const aawmTapRemoteEntryType =
  process.env.AAWM_TAP_REMOTE_ENTRY_TYPE ?? 'module'
const shellReportApiTarget =
  process.env.SHELL_REPORT_API_TARGET ?? 'http://127.0.0.1:3010'
const dashboardShellDevPort = Number(
  process.env.DASHBOARD_SHELL_DEV_PORT ?? 3006
)
const repoRoot = path.resolve(__dirname)
const ignoredDevWatchPathNames = new Set([
  '.analysis',
  '.claude',
  '.codex',
  '.gemini',
  '@mf-types',
  'dist',
])

const isIgnoredDevWatchPath = (watchPath: string) => {
  const absoluteWatchPath = path.resolve(repoRoot, watchPath)
  const relativeWatchPath = path.relative(repoRoot, absoluteWatchPath)

  if (
    relativeWatchPath.startsWith('..') ||
    path.isAbsolute(relativeWatchPath)
  ) {
    return false
  }

  return relativeWatchPath
    .split(path.sep)
    .some((segment) => ignoredDevWatchPathNames.has(segment))
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    tanstackRouter({
      target: 'react',
      autoCodeSplitting: true,
    }),
    federation({
      name: 'dashboard-shell',
      dts: false,
      remotes: {
        'aawm-tap-dashboard': {
          type: aawmTapRemoteEntryType,
          name: 'aawm-tap-dashboard',
          entry: aawmTapRemoteEntry,
          entryGlobalName: 'aawm-tap-dashboard',
          shareScope: 'default',
        },
      },
      shared: {
        react: { singleton: true, requiredVersion: '^19.0.0' },
        'react-dom': { singleton: true, requiredVersion: '^19.0.0' },
        '@tanstack/react-query': {
          singleton: true,
          requiredVersion: '^5.0.0',
        },
      },
    }),
    react(),
    tailwindcss(),
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    port: dashboardShellDevPort,
    watch: {
      ignored: isIgnoredDevWatchPath,
    },
    proxy: {
      '/api/aawm-tap': {
        target: shellReportApiTarget,
        changeOrigin: true,
      },
      '/api/shell': {
        target: shellReportApiTarget,
        changeOrigin: true,
      },
    },
  },
  optimizeDeps: {
    // Module Federation owns the React Query singleton; pre-bundling can create
    // a second instance during dev and break remote cache/context sharing.
    exclude: ['@tanstack/react-query'],
  },
  build: {
    target: 'esnext',
  },
})
