import { StrictMode } from 'react'
import ReactDOM from 'react-dom/client'
import {
  QueryCache,
  QueryClient,
  QueryClientProvider,
} from '@tanstack/react-query'
import { RouterProvider, createRouter } from '@tanstack/react-router'
import { handleServerError } from '@/lib/handle-server-error'
import { errorText, reloadForStaleAsset } from '@/lib/stale-asset-reload'
import { DirectionProvider } from './context/direction-provider'
import { FontProvider } from './context/font-provider'
import { ThemeProvider } from './context/theme-provider'
// Generated Routes
import { routeTree } from './routeTree.gen'
// Styles
import './styles/index.css'

const chunkLoadFailurePatterns = [
  /failed to fetch dynamically imported module/i,
  /importing a module script failed/i,
  /error loading dynamically imported module/i,
  /chunkloaderror/i,
  /loading chunk .+ failed/i,
]

function isChunkLoadFailure(value: unknown): boolean {
  if (value instanceof Error && value.name === 'ChunkLoadError') {
    return true
  }

  const text = errorText(value)
  return chunkLoadFailurePatterns.some((pattern) => pattern.test(text))
}

function reloadOnChunkLoadFailure(value: unknown): boolean {
  if (!isChunkLoadFailure(value)) {
    return false
  }

  return reloadForStaleAsset()
}

window.addEventListener('vite:preloadError', (event) => {
  event.preventDefault()
  reloadForStaleAsset()
})

window.addEventListener('error', (event) => {
  reloadOnChunkLoadFailure(event.error ?? event.message)
})

window.addEventListener('unhandledrejection', (event) => {
  if (reloadOnChunkLoadFailure(event.reason)) {
    event.preventDefault()
  }
})

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: (failureCount) => {
        if (failureCount >= 0 && import.meta.env.DEV) return false
        if (failureCount > 3 && import.meta.env.PROD) return false
        return true
      },
      refetchOnWindowFocus: import.meta.env.PROD,
      staleTime: 10 * 1000, // 10s
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
