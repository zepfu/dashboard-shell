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

## Provider Status Health Strips

Provider Status cards render vertical health strips as overlay affordances. The
strip shell must stay absolutely positioned inside the card and must not
participate in normal card layout flow, even when the strip has an auto-generated
tooltip. The shell uses `pointer-events: none` with an inner hover zone restoring
pointer events so the tooltip remains reachable without adding blank space above
the provider header.

The Provider Status Health card list uses masonry-style column stacks instead
of the shared Provider Status quota grid. Recent quota-history bars or Local
health chips may make one provider card taller than its neighbors, but sparse
provider cards should keep compact heights and later cards should pack upward
inside their column instead of reserving a row sized to the tallest provider
card. The aggregate totals card is the trailing Health card and belongs in the
trailing responsive column; it must not be assigned from provider-count modulo
column-count because the canonical provider list currently has eight entries.

Secondary General dashboard reports must fail visibly instead of hanging the
page-load path. The `token-trend-summary` and `quota-history` report routes use
endpoint-specific statement timeouts; on database timeout they return empty
payloads with `metadata.degraded=true`, a `database_timeout` reason, and a
section-level `Degraded` badge in the dashboard.

## CSP And Asset Loading

Static/prod-style shell hosting serves remotes from same-origin
`/modules/<base>/remoteEntry.js` paths and APIs from same-origin
`/api/<dashboard>/*` paths. The static shell CSP must therefore allow same-origin
scripts and same-origin XHR/fetch. Remotes should avoid direct upstream service
URLs in browser code so the shell proxy remains the only network boundary.
