# Runtime Contracts

This document supplements the integration contract for federated dashboards.

## QueryClient

The shell owns the federated-mode `QueryClientProvider`. Remote dashboards should
not wrap shell-mounted routes in their own `QueryClientProvider`; doing so splits
React Query cache identity across the Module Federation boundary. Standalone
remote entrypoints may create their own provider for local development.

Current shell defaults in `src/main.tsx`:

- `staleTime`: `10_000` ms for normal queries.
- `refetchOnWindowFocus`: enabled in production and disabled in development.
- `retry`: disabled in development. In production, retry non-auth Axios errors
  until the shell retry predicate returns false at `failureCount > 3`; never
  retry Axios `401` or `403`.
- `gcTime` / cache time: use TanStack Query defaults unless a route or component
  query overrides them.

Operator-critical workflows that need fresh state on every interaction should
set query-local options such as `staleTime: 0`, targeted polling, or explicit
manual invalidation/refetch. They should not create a second provider in
federated mode.

## Suspense And Lazy Routes

Remote `module.ts` route components should be lazy components. The shell wraps
both the remote module load and the selected remote route component in
`Suspense`, with an error boundary around the module load.

Shell smoke coverage for a remote must prove the shell-mounted route loads
through `remoteEntry.js`, not only that the standalone remote works. When a
remote adds a route in `module.ts`, update the shell smoke path list or test
coverage so the federated chunk is exercised.

## Source Maps

Development builds may use normal Vite source maps as needed.

Production policy is no browser-public source maps by default for the shell or
remote dashboards. If a release needs production stack trace symbolication, use
an upload-only or hidden-source-map workflow and verify the generated `.map`
files are not served from the public static containers.

## CSP And Asset Loading

Static/prod-style shell hosting serves remotes from same-origin
`/modules/<base>/remoteEntry.js` paths and APIs from same-origin
`/api/<dashboard>/*` paths. The static shell CSP must therefore allow same-origin
scripts and same-origin XHR/fetch. Remotes should avoid direct upstream service
URLs in browser code so the shell proxy remains the only network boundary.
