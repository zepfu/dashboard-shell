# Sibling Dashboard Setup

This is the shell-side process for wiring another sibling dashboard repo into
`dashboard-shell`.

Sibling repos own their internal build, page, test, and backend docs. This file
only covers the pieces the shell must know so the dashboard loads in shell
chrome in both live dev containers and static/prod-style containers.

## Current Siblings

| Dashboard | Repo | Module id | Base path | API base | Dev port | Static module path |
| --- | --- | --- | --- | --- | --- | --- |
| AAWM TAP | `../aawm-tap-dashboard` | `aawm-tap-dashboard` | `/aawm-tap` | `/api/aawm-tap` | `5173` | `/modules/aawm-tap/remoteEntry.js` |
| Aegis | `../aegis-dashboard` | `aegis-dashboard` | `/aegis` | `/api/aegis` | `5174` | `/modules/aegis/remoteEntry.js` |
| Sluice | `../sluice-dashboard` | `sluice` | `/sluice` | `/api/sluice` | `5175` | `/modules/sluice/remoteEntry.js` |

## Inputs Required From The Sibling Repo

Before shell integration, the sibling repo needs to provide:

- `src/module.ts` with a default export that satisfies the shell
  `ProjectModule` contract.
- A Vite Module Federation config that exposes `./module` from
  `./src/module.ts` and emits `remoteEntry.js`.
- `dts: false` in the federation config until the local type-hint websocket is
  made reliable across the dev containers.
- A normal dev script that runs the real Vite federation server, usually
  `npm run dev -- --host 0.0.0.0 --port <port> --strictPort --cors`.
- A static Docker image that serves the built remote from port `80` and keeps
  `remoteEntry.js` non-cacheable.
- The backend target URL and credential environment variable names for the shell
  report/proxy service.

Do not use `VITE_*` variables for secrets. Browser code should call only the
shell-provided `apiBase`; the shell report/proxy service injects credentials
server-side.

## Shell Registration

Add the dashboard to the shell in these places:

1. `vite.config.ts`
   - Add remote entry defaults, for example
     `/modules/example/remoteEntry.js`.
   - Add an env override, for example `EXAMPLE_REMOTE_ENTRY`.
   - Add the Module Federation remote mapping under `remotes`.
   - Add the browser dev proxy for `/api/example` to
     `SHELL_REPORT_API_TARGET`.

2. `src/vite-env.d.ts`
   - Add an ambient declaration for `'<module-id>/module'`.
   - Keep the declaration self-contained. Use
     `type ProjectModule = import('./shell/types').ProjectModule` instead of a
     top-level import.

3. `src/shell/remote-dashboard-registry.ts`
   - Add one registry entry with `moduleId`, `basePath`, `apiBase`,
     `accentColor`, `defaultRoutePath`, `navItems`, and `importModule`.
   - Keep nav item paths relative to the remote base path.

4. `src/routes/_authenticated/<base>/index.tsx`
   - Mount the default remote route.

5. `src/routes/_authenticated/<base>/$.tsx`
   - Forward subroutes into the generic remote route loader.

6. `server/report-service.mjs`
   - Add the `/api/<dashboard>` upstream proxy config.
   - Use explicit target and credential env names.
   - Strip browser-sent auth headers and inject server-side credentials only.

7. `.env.example`
   - Add the dashboard backend target and empty credential placeholders.

The left sidebar and command menu should derive dashboard entries from the
registry. Avoid adding separate static nav data for each remote.

## Dev Container Wiring

Dev containers are intended to be real live development environments. The shell
compose file should bind-mount each sibling checkout and run the sibling's real
Vite federation dev server so edits in the sibling repo show without rebuilding
an image.

Add a service to `docker-compose.dev.yml`:

```yaml
example-dashboard-dev:
  image: node:22-alpine
  container_name: dashboard-shell-example-dashboard-dev
  restart: unless-stopped
  working_dir: /workspace/example-dashboard
  environment:
    CHOKIDAR_USEPOLLING: "${CHOKIDAR_USEPOLLING:-true}"
    EXAMPLE_REMOTE_DEV_PORT: "${EXAMPLE_REMOTE_DEV_PORT:-5176}"
    WATCHPACK_POLLING: "${WATCHPACK_POLLING:-true}"
  ports:
    - "${EXAMPLE_REMOTE_DEV_PORT:-5176}:${EXAMPLE_REMOTE_DEV_PORT:-5176}"
  networks:
    - aawm_tap
  volumes:
    - ../example-dashboard:/workspace/example-dashboard
    - example_dashboard_dev_node_modules:/workspace/example-dashboard/node_modules
    - example_dashboard_dev_npm_cache:/root/.npm
  command:
    - sh
    - -lc
    - |
      npm ci
      npm run dev -- --host 0.0.0.0 --port "$${EXAMPLE_REMOTE_DEV_PORT:-5176}" --strictPort --cors
  healthcheck:
    test:
      [
        "CMD-SHELL",
        "wget -qO- http://127.0.0.1:$${EXAMPLE_REMOTE_DEV_PORT:-5176}/remoteEntry.js >/dev/null",
      ]
    interval: 30s
    timeout: 5s
    start_period: 30s
    retries: 5
```

Then update `dashboard-shell-dev`:

- Add `depends_on.<service>.condition: service_healthy`.
- Set the remote entry env to the browser-accessible host URL:
  `EXAMPLE_REMOTE_ENTRY=http://localhost:${EXAMPLE_REMOTE_DEV_PORT:-5176}/remoteEntry.js`.
- Set `EXAMPLE_REMOTE_ENTRY_TYPE=module`.

Use the sibling repo's package manager. The current Aegis and Sluice repos use
`npm` with `package-lock.json`; a future `pnpm` sibling should use the same
Corepack/store pattern as the shell service.

Avoid using a standalone helper that serves a hand-written `remoteEntry.js`
unless it is proven to implement the same Module Federation interface as the
real dev server. The shell-mounted browser smoke is the source of truth.

## Static / Prod-Style Container Wiring

Static containers build the sibling remote image and serve its built assets from
port `80`. The shell nginx container proxies stable `/modules/<base>/...` paths
to those remote containers.

Add a service to `docker-compose.yml`:

```yaml
example-dashboard:
  restart: unless-stopped
  build:
    context: ../example-dashboard
    dockerfile: Dockerfile
  image: example-dashboard-remote:local
  expose:
    - "80"
  healthcheck:
    test: ["CMD-SHELL", "wget -qO- http://127.0.0.1/remoteEntry.js >/dev/null"]
    interval: 30s
    timeout: 5s
    start_period: 10s
    retries: 3
  networks:
    - aawm_tap
```

Then update the `dashboard-shell` service:

- Add a `depends_on` health gate for the new static remote service.
- Keep the shell image build context as this repo. The shell build should use
  the default remote entry path from `vite.config.ts`, not a sibling dev URL.

Add nginx module proxying:

```nginx
location = /modules/example/remoteEntry.js {
  set $example_dashboard http://example-dashboard:80;
  rewrite ^/modules/example/(.*)$ /$1 break;
  proxy_pass $example_dashboard;
  proxy_http_version 1.1;
  proxy_set_header Host $host;
  proxy_connect_timeout 5s;
  proxy_read_timeout 60s;
  add_header Cache-Control "no-store" always;
}

location ^~ /modules/example/ {
  set $example_dashboard http://example-dashboard:80;
  rewrite ^/modules/example/(.*)$ /$1 break;
  proxy_pass $example_dashboard;
  proxy_http_version 1.1;
  proxy_set_header Host $host;
  proxy_connect_timeout 5s;
  proxy_read_timeout 60s;
}
```

If the dashboard has a backend, add an nginx `/api/example/` location that
proxies to `dashboard-shell-reports:3010`. The report/proxy service should then
rewrite `/api/example/*` to the real backend target.

## Verification

Run these checks before marking a sibling integration complete:

```bash
node --check server/report-service.mjs
docker compose config --quiet
docker compose -f docker-compose.dev.yml config --quiet
pnpm lint
pnpm build
```

Dev container verification:

```bash
docker compose -f docker-compose.dev.yml up -d example-dashboard-dev dashboard-shell-dev
curl -I http://127.0.0.1:5176/remoteEntry.js
curl http://127.0.0.1:3006/api/shell/health
```

Then smoke the shell-mounted route in a browser:

- `http://127.0.0.1:3006/example`
- `http://127.0.0.1:3006/example/<default-route>`

Static/prod-style container verification:

```bash
docker compose up -d --build example-dashboard dashboard-shell
curl -I http://127.0.0.1:3005/modules/example/remoteEntry.js
curl http://127.0.0.1:3005/api/shell/health
```

Then smoke the shell-mounted route in a browser:

- `http://127.0.0.1:3005/example`
- `http://127.0.0.1:3005/example/<default-route>`

The route is not complete until the remote renders inside shell chrome without
Module Federation load errors, stale chunk errors, or leaked browser-side
credentials. A page-level backend `500` can be tracked separately only after the
remote module itself has loaded and rendered.

## Runtime Notes

- Changes to a sibling repo should hot-reload in its dev container because the
  source is bind-mounted and the real Vite dev server is running.
- Changes to shell Vite config, compose wiring, or Module Federation remote
  entry env values usually require restarting `dashboard-shell-dev`.
- Changes under `server/report-service.mjs` require restarting the report
  service container. The source is bind-mounted, but plain Node does not reload
  already-imported modules.
- Dependency changes in static/prod-style images require a rebuild.
