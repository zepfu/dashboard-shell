# Remote Dashboard Integration Contract

This is the handoff contract for any repo that needs to render inside
`dashboard-shell`.

The dashboard repo builds a Module Federation remote that owns its data views.
The shell owns global chrome, authenticated route mounting, server-side API
forwarding, runtime theme tokens, and production proxying.

For the shell-side setup sequence, including live dev containers and
static/prod-style containers, see
[`sibling-dashboard-setup.md`](sibling-dashboard-setup.md).
For federated runtime ownership, source-map policy, and lazy-route expectations,
see [`runtime-contracts.md`](runtime-contracts.md).

## Integration Boundary

Remote dashboards should treat the shell as the host frame, not as a component
library to import from at runtime.

The shell provides:

- Authenticated shell layout, header, sidebar, search, profile controls, and
  global settings.
- Route mounting under a stable `basePath`, such as `/aegis` or `/sluice`.
- A browser-safe `apiBase`, such as `/api/aegis`, that the shell proxies
  server-side.
- Runtime CSS variables for light and dark themes.
- Shared Module Federation singletons for React, React DOM, and React Query.

The remote repo provides:

- A Vite Module Federation build with `remoteEntry.js` at the remote web root.
- A default export from `./module` that satisfies the shell `ProjectModule`
  shape.
- Route components for every path it advertises in `routes` and `navItems`.
- Its own data-fetching, page-level state, tests, and standalone dev entrypoint.
- A Docker/static hosting path that can serve `remoteEntry.js` and built assets.

## Remote Deliverables

Each remote repo should expose `./module` through `remoteEntry.js`:

```ts
// src/module.ts
import { lazy } from 'react'
import { LayoutDashboard } from 'lucide-react'

export default {
  id: 'example-dashboard',
  name: 'Example',
  description: 'Example operations dashboard',
  icon: LayoutDashboard,
  basePath: '/example',
  apiBase: '/api/example',
  accentColor: 'hsl(220 70% 50%)',
  routes: [
    { path: '/overview', component: lazy(() => import('./pages/Overview')) },
    { path: '/items/:id', component: lazy(() => import('./pages/ItemDetail')) },
  ],
  navItems: [
    { label: 'Overview', path: '/overview', icon: LayoutDashboard },
  ],
  extensions: [],
}
```

The remote Vite config must expose that module and share the same React
singletons as the shell:

```ts
// vite.config.ts
import { federation } from '@module-federation/vite'

federation({
  name: 'example-dashboard',
  filename: 'remoteEntry.js',
  dts: false,
  exposes: {
    './module': './src/module.ts',
  },
  shared: {
    react: { singleton: true, requiredVersion: '^19.0.0' },
    'react-dom': { singleton: true, requiredVersion: '^19.0.0' },
    '@tanstack/react-query': {
      singleton: true,
      requiredVersion: '^5.0.0',
    },
  },
})
```

Keep Module Federation DTS/type-hints disabled for now. The shell disables them
because the dev-only type websocket can create noisy runtime errors or blank
browser sessions in this local setup.

## Manifest Fields

The shell consumes these manifest fields:

- `id`: Stable Module Federation id. Keep it aligned with the remote name.
- `name`: Visible module name in shell chrome.
- `description`: Short shell-header description.
- `icon`: Lucide-compatible component that accepts `className`.
- `basePath`: Shell route prefix, for example `/aegis`.
- `routes`: Route path to component mappings. Paths are relative to `basePath`.
- `navItems`: Header navigation labels and paths. The shell uses these before
  falling back to route-derived titles.
- `apiBase`: Browser-safe API prefix. Secrets and upstream credentials stay in
  shell/server-side environment variables, not `VITE_*` values.
- `accentColor`: CSS color used by shell chrome for the module icon tile and
  active nav accents.
- `extensions`: Reserved extension slots. Keep it empty unless the shell has a
  tracked consumer for a specific slot.

Do not add manifest fields unless the shell consumes them or a shell TODO tracks
the consuming work.

## Route Contract

Remote route paths are matched inside the shell after stripping the shell
`basePath`.

Supported route patterns:

- Exact paths: `/overview`, `/settings`, `/`.
- Single-segment params: `/items/:id`, `/domains/:domainId`.

The shell currently does not provide wildcard route params to remote components.
Add explicit remote route entries for user-facing pages.

Remote components receive these props:

```ts
type RemoteRouteProps = {
  params: Record<string, string>
  routePath: string
  basePath: string
  apiBase: string
  moduleId: string
  [paramName: string]: unknown
}
```

Use `basePath` for links back into the remote and `apiBase` for browser fetches.
Do not hard-code `localhost`, upstream service ports, API keys, or auth headers
in browser code.

## API Boundary

Browser code should call only the shell-provided `apiBase`.

The shell report/proxy service is responsible for:

- Rewriting browser-safe `/api/<dashboard>/*` requests to the real backend.
- Injecting required service credentials server-side.
- Stripping browser-sent auth headers when a backend expects server credentials.
- Handling network placement between shell containers and backend containers.

Remote repos should document their required backend target, health route, and
credential names, but should not put real secrets in `VITE_*` variables.

## Styling Contract

Use the vendor-and-sync model for now.

Each remote should vendor these shell files into its own repo:

- `src/components/ui/`
- `src/lib/utils.ts`
- `src/styles/theme.css`
- `components.json`

This keeps remote builds predictable and avoids coupling runtime loading to a
second federated component remote. Do not import shell components across Module
Federation yet. Revisit a private package or federated `dashboard-shell/ui`
module only when component drift across dashboards becomes more expensive than
the extra release and runtime complexity.

The shell guarantees these token families are present on `:root` before a remote
mounts:

- Core colors: `--background`, `--foreground`, `--card`, `--card-foreground`,
  `--popover`, `--popover-foreground`, `--primary`, `--primary-foreground`,
  `--secondary`, `--secondary-foreground`, `--muted`,
  `--muted-foreground`, `--accent`, `--accent-foreground`, `--destructive`,
  `--border`, `--input`, and `--ring`.
- Chart colors: `--chart-1` through `--chart-5`.
- Sidebar colors: `--sidebar`, `--sidebar-foreground`, `--sidebar-primary`,
  `--sidebar-primary-foreground`, `--sidebar-accent`,
  `--sidebar-accent-foreground`, `--sidebar-border`, and `--sidebar-ring`.
- Radius tokens: `--radius`, `--radius-sm`, `--radius-md`, `--radius-lg`, and
  `--radius-xl`.

Remote page code should use Tailwind token utilities such as `bg-card`,
`text-foreground`, `border-border`, `text-muted-foreground`, `bg-primary`, and
`text-primary-foreground`. Avoid raw hex colors and JSX inline styles in remote
page code.

The shell toggles `.dark` on the document root. A remote that uses token-backed
Tailwind classes and imports `src/styles/theme.css` in standalone mode will
inherit the same light and dark palettes in both standalone and shell-mounted
modes.


## General Dashboard STATUS Tabs (Shell-Owned)

The root General dashboard `STATUS` section uses first-level section tabs:

- `Health`: PgBouncer sidecar health, provider credit lifecycle, and Provider
  Status health cards (including aggregate totals). Google/Antigravity provider
  health cards remain omitted per product policy.
- `Quota`: Range-aware quota history bars per provider. Broad ranges may return
  degraded base rows with empty usage enrichment when quota-range history
  enrichment exceeds the bounded report timeout.
- `Provider Auth`: `providerAuthHealth` from the usage report payload.
- `Alias Routing`: `providerAliasRouting` from the usage report payload.
- `Weights` and `Diagnostics`: additive estimator and session diagnostics panels.

Provider Auth and Alias Routing are not rendered inside the Health tab; each tab
reuses the same report fetch as the rest of the General dashboard.

## Component And Lint Expectations

Remote dashboards should use their vendored shadcn-compatible primitives for
tabs, tables, buttons, dialogs, forms, cards, skeleton loading states, and status
badges. Keep the interaction semantics from those primitives intact instead of
replacing them with ad hoc div/button markup.

Cards should frame repeated items, modals, or genuinely bounded tools. Page
sections should usually be unframed layouts or full-width bands. Skeleton states
should reserve the same rough footprint as loaded content so shell-mounted pages
do not shift heavily after remote data arrives.

The scaffold installs a page-code lint guard against JSX inline `style`
attributes. The shell does not currently make `jsx-a11y` a shell-wide required
lint plugin for remotes; if a remote adopts it, treat that as a remote-local
policy until this contract is explicitly revised.

## Scaffold

Create a new remote dashboard from this repo with:

```bash
pnpm scaffold:dashboard ../example-dashboard \
  --module-id example-dashboard \
  --name "Example" \
  --base-path /example \
  --accent-color "hsl(220 70% 50%)"
```

The scaffold vendors the current shadcn primitives, theme tokens, `cn()` helper,
federated `module.ts`, standalone entrypoint, and an ESLint rule that rejects JSX
inline `style` attributes in page code.

After scaffolding, run the new dashboard with:

```bash
cd ../example-dashboard
pnpm install
pnpm dev
```

Then point the shell at the generated `remoteEntry.js` while developing.

The older `pnpm scaffold:tap` command remains as a compatibility alias.

## Shell Registration Checklist

When the remote repo is ready, the shell owner needs this handoff payload:

- `moduleId`: Module Federation remote name, such as `example-dashboard`.
- `basePath`: Shell mount path, such as `/example`.
- `apiBase`: Browser API prefix, such as `/api/example`.
- `remoteEntry`: Dev URL and production proxy path.
- `defaultRoutePath`: Route to render at the base path.
- `navItems`: Ordered labels, paths, and preferred Lucide icons.
- `accentColor`: CSS color for module chrome.
- Backend target and credential names for the shell report/proxy service.
- Docker service name, exposed port, and healthcheck route for static hosting.

The shell side then updates:

- `vite.config.ts`: Add the remote entry and Module Federation remote mapping.
- `src/vite-env.d.ts`: Add the ambient `'<module-id>/module'` declaration.
- `src/shell/remote-dashboard-registry.ts`: Add the dashboard config and lazy
  import.
- `src/routes/_authenticated/<base>/index.tsx`: Mount the default remote route.
- `src/routes/_authenticated/<base>/$.tsx` or equivalent splat route: Forward
  subroutes into `RemoteDashboardRoute`.
- `nginx.conf`: Proxy `/modules/<base>/remoteEntry.js` and
  `/modules/<base>/*` to the remote container.
- `docker-compose.yml` and `docker-compose.dev.yml`: Add static and live dev
  services, healthchecks, and remote entry environment variables.
- `server/report-service.mjs`: Add API proxying if the dashboard needs a
  backend through `/api/<dashboard>/*`.

## Verification Checklist

Remote repo verification:

- `pnpm lint`
- `pnpm build`
- `curl -I http://127.0.0.1:<remote-port>/remoteEntry.js`
- Standalone browser smoke for the default page.

Shell integration verification:

- `pnpm lint`
- `pnpm build`
- `docker compose -f docker-compose.yml config`
- `docker compose -f docker-compose.dev.yml config`
- `curl -I http://127.0.0.1:3005/modules/<base>/remoteEntry.js`
- `curl -I http://127.0.0.1:<remote-dev-port>/remoteEntry.js`
- Browser smoke for `http://127.0.0.1:3005/<base>/<default-route>`.
- Browser smoke for `http://127.0.0.1:3006/<base>/<default-route>`.

Do not mark a remote complete until the shell-mounted browser smoke proves that
the remote renders inside shell chrome without module-load errors, stale asset
errors, or backend credential leaks.
