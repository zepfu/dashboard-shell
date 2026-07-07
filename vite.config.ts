import path from 'path'
import {
  defineConfig,
  type HttpProxy,
  type Plugin,
  type ProxyOptions,
} from 'vite'
import react from '@vitejs/plugin-react-swc'
import { federation } from '@module-federation/vite'
import tailwindcss from '@tailwindcss/vite'
import { tanstackRouter } from '@tanstack/router-plugin/vite'
import type { ClientRequest } from 'http'

const aawmTapRemoteEntry =
  process.env.AAWM_TAP_REMOTE_ENTRY ?? '/modules/aawm-tap/remoteEntry.js'
const aawmTapRemoteEntryType =
  process.env.AAWM_TAP_REMOTE_ENTRY_TYPE ?? 'module'
const aawmDashboardRemoteEntry =
  process.env.AAWM_DASHBOARD_REMOTE_ENTRY ?? '/modules/aawm/remoteEntry.js'
const aawmDashboardRemoteEntryType =
  process.env.AAWM_DASHBOARD_REMOTE_ENTRY_TYPE ?? 'module'
const aawmObserveRemoteEntry =
  process.env.AAWM_OBSERVE_REMOTE_ENTRY ??
  '/modules/aawm-observe/remoteEntry.js'
const aawmObserveRemoteEntryType =
  process.env.AAWM_OBSERVE_REMOTE_ENTRY_TYPE ?? 'module'
const aegisRemoteEntry =
  process.env.AEGIS_REMOTE_ENTRY ?? '/modules/aegis/remoteEntry.js'
const aegisRemoteEntryType = process.env.AEGIS_REMOTE_ENTRY_TYPE ?? 'module'
const sluiceRemoteEntry =
  process.env.SLUICE_REMOTE_ENTRY ?? '/modules/sluice/remoteEntry.js'
const sluiceRemoteEntryType = process.env.SLUICE_REMOTE_ENTRY_TYPE ?? 'module'
const shellReportApiTarget =
  process.env.SHELL_REPORT_API_TARGET ?? 'http://127.0.0.1:3010'
const DEFAULT_SHELL_REPORT_PROXY_SHARED_SECRET =
  'dashboard-shell-local-proxy-secret'
const shellReportProxySharedSecret =
  process.env.SHELL_REPORT_PROXY_SHARED_SECRET ??
  DEFAULT_SHELL_REPORT_PROXY_SHARED_SECRET
const REPORT_PROXY_SECRET_HEADER = 'X-Dashboard-Shell-Proxy-Secret'

const shellReportProxyConfig = (): ProxyOptions => ({
  target: shellReportApiTarget,
  changeOrigin: true,
  configure: (proxy: HttpProxy.ProxyServer) => {
    proxy.on('proxyReq', (proxyReq: ClientRequest) => {
      proxyReq.setHeader(
        REPORT_PROXY_SECRET_HEADER,
        shellReportProxySharedSecret
      )
    })
  },
})

const UPSTREAM_SHELL_REPORT_PROXY_PATHS = [
  '/api/aawm-tap',
  '/api/aawm-observe',
  '/api/aawm',
  '/api/aegis',
  '/api/sluice',
  '/hook-api',
] as const
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

const noStoreDevServerResponses = (): Plugin => ({
  name: 'dashboard-shell-dev-no-store',
  apply: 'serve',
  configureServer(server) {
    server.middlewares.use((_request, response, next) => {
      response.setHeader('Cache-Control', 'no-store')
      next()
    })
  },
})

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    noStoreDevServerResponses(),
    tanstackRouter({
      target: 'react',
      autoCodeSplitting: true,
    }),
    federation({
      name: 'dashboard-shell',
      dts: false,
      shareStrategy: 'loaded-first',
      hostInitInjectLocation: 'html',
      remotes: {
        'aawm-tap-dashboard': {
          type: aawmTapRemoteEntryType,
          name: 'aawm-tap-dashboard',
          entry: aawmTapRemoteEntry,
          entryGlobalName: 'aawm-tap-dashboard',
          shareScope: 'default',
        },
        'aawm-dashboard': {
          type: aawmDashboardRemoteEntryType,
          name: 'aawm-dashboard',
          entry: aawmDashboardRemoteEntry,
          entryGlobalName: 'aawm-dashboard',
          shareScope: 'default',
        },
        'aawm-observe-dashboard': {
          type: aawmObserveRemoteEntryType,
          name: 'aawm-observe-dashboard',
          entry: aawmObserveRemoteEntry,
          entryGlobalName: 'aawm-observe-dashboard',
          shareScope: 'default',
        },
        'aegis-dashboard': {
          type: aegisRemoteEntryType,
          name: 'aegis-dashboard',
          entry: aegisRemoteEntry,
          entryGlobalName: 'aegis-dashboard',
          shareScope: 'default',
        },
        sluice: {
          type: sluiceRemoteEntryType,
          name: 'sluice',
          entry: sluiceRemoteEntry,
          entryGlobalName: 'sluice',
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
    headers: {
      'Cache-Control': 'no-store',
    },
    watch: {
      ignored: isIgnoredDevWatchPath,
    },
    proxy: {
      ...Object.fromEntries(
        UPSTREAM_SHELL_REPORT_PROXY_PATHS.map((pathPrefix) => [
          pathPrefix,
          shellReportProxyConfig(),
        ])
      ),
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
