import { StrictMode } from 'react'
import ReactDOM from 'react-dom/client'
import {
  QueryCache,
  QueryClient,
  QueryClientProvider,
} from '@tanstack/react-query'
import { RouterProvider, createRouter } from '@tanstack/react-router'
import { handleServerError } from '@/lib/handle-server-error'
import {
  isStaleAssetError,
  reloadForStaleAsset,
} from '@/lib/stale-asset-reload'
import { DirectionProvider } from './context/direction-provider'
import { FontProvider } from './context/font-provider'
import { ThemeProvider } from './context/theme-provider'
// Generated Routes
import { routeTree } from './routeTree.gen'
// Styles
import './styles/index.css'

function reloadOnStaleAssetFailure(value: unknown): boolean {
  if (!isStaleAssetError(value)) {
    return false
  }

  return reloadForStaleAsset()
}

window.addEventListener('vite:preloadError', (event) => {
  event.preventDefault()
  reloadForStaleAsset()
})

window.addEventListener('error', (event) => {
  reloadOnStaleAssetFailure(event.error ?? event.message)
})

window.addEventListener('unhandledrejection', (event) => {
  if (reloadOnStaleAssetFailure(event.reason)) {
    event.preventDefault()
  }
})

function readHttpStatus(error: unknown): number | undefined {
  if (error && typeof error === 'object' && 'status' in error) {
    const status = (error as { status: unknown }).status
    if (typeof status === 'number') return status
  }
  return undefined
}

function isShellQueryRetryDevMode(): boolean {
  // Bracket access avoids Vite compile-time replacement so tests can patch env.DEV.
  const env = import.meta.env as ImportMetaEnv & { DEV?: boolean }
  return env['DEV' as keyof ImportMetaEnv] === true
}

/** Shell QueryClient default retry predicate (exported for tests). */
export function shouldRetryQuery(
  failureCount: number,
  error: unknown
): boolean {
  if (isShellQueryRetryDevMode()) return false
  if (failureCount > 3) return false

  const status = readHttpStatus(error)
  if (status === undefined) return true

  if (status === 401 || status === 403 || status === 404) return false
  if (status === 408 || status === 429) return true
  if (status >= 500 && status < 600) return true

  return false
}

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: (failureCount, error) => shouldRetryQuery(failureCount, error),
      refetchOnWindowFocus: import.meta.env.PROD,
      staleTime: 10 * 1000, // 10s
      gcTime: 5 * 60 * 1000,
      refetchIntervalInBackground: false,
    },
    mutations: {
      onError: (error) => {
        handleServerError(error)
      },
    },
  },
  queryCache: new QueryCache({
    onError: (error) => {
      handleServerError(error)
    },
  }),
})

// Create a new router instance
const router = createRouter({
  routeTree,
  context: { queryClient },
  defaultPreload: 'intent',
  defaultPreloadStaleTime: 0,
})

// Register the router instance for type safety
declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router
  }
}

// Render the app
const rootElement = document.getElementById('root')!
const root = ReactDOM.createRoot(rootElement)
root.render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <FontProvider>
          <DirectionProvider>
            <RouterProvider router={router} />
          </DirectionProvider>
        </FontProvider>
      </ThemeProvider>
    </QueryClientProvider>
  </StrictMode>
)
