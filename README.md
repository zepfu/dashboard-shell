# Dashboard Shell

Host application for project dashboard modules. This repo currently starts from
the shadcn-admin shell and is being adapted into a Module Federation host.

## Local Module Integration

The first remote is the sibling repo `../aawm-tap-dashboard`, exposed as
`aawm-tap-dashboard/module` with `remoteEntry.js` at the remote web root.

Run the live dev container stack:

```bash
pnpm docker:dev
```

Then open `http://localhost:3006/aawm-tap/overview`. This stack runs Vite
servers in containers with bind-mounted source from this repo and
`../aawm-tap-dashboard`, so changes in either checkout are served live without a
Docker image rebuild. The shell dev server proxies `/api/aawm-tap/*` to the
shell report service, which then forwards to `AAWM_TAP_API_TARGET`. That target
defaults to `http://host.docker.internal:8010`.

The same dev stack starts the shell report API on `SHELL_REPORT_PORT`, which
defaults to `3010`. The browser reads the General dashboard report through
`/api/shell/reports/usage`; `DATABASE_URL` is only read by that server-side
service. The dev shell, dev remote, and dev report service all join the external
`aawm-tap_default` network used by the aawm-tap model containers. The dev report
service also joins `aawm_default` so host-style database URLs can be rewritten to
the internal Postgres service while development stays containerized. If TAP
requires a dashboard key, set `AAWM_TAP_API_KEY` in this repo's `.env`; the shell
service injects it as `X-API-Key` and strips client-sent auth before forwarding.
Do not keep a real TAP key in `../aawm-tap-dashboard/.env` as a `VITE_*` value,
because Vite exposes those values to browser code.

Stop the live dev stack with:

```bash
pnpm docker:dev:down
```

You can also run the same live setup directly on the host with separate
terminals:

```bash
cd ../aawm-tap-dashboard
npm run dev:standalone -- --host 0.0.0.0 --port 5173 --strictPort --cors

cd ../dashboard-shell
pnpm dev:reports

cd ../dashboard-shell
pnpm dev:with-aawm
```

Run the container stack:

```bash
pnpm docker:up
```

Then open `http://localhost:3005/aawm-tap/overview`. Set
`DASHBOARD_SHELL_PORT=3000` if you want to publish the container on port 3000.
The compose services run detached and use `restart: unless-stopped`, so Docker
will bring the shell and the AAWM TAP remote back after a system restart unless
they were intentionally stopped.

The static compose stack also starts `dashboard-shell-reports`, and nginx proxies
`/api/shell/*` and `/api/aawm-tap/*` to that service. Set `DATABASE_URL` in
`.env` or the process environment before starting compose if the General
dashboard should query live report data. Set `AAWM_TAP_API_KEY` here, not in the
remote browser bundle, when TAP requires `X-API-Key`. The static shell, remote,
and report service all join `aawm-tap_default`; the report service also joins
`aawm_default` so a host-published database URL such as `127.0.0.1:5434` can be
rewritten to the internal `aawm-postgres18:5432` endpoint.

The shell defaults to loading the remote through
`/modules/aawm-tap/remoteEntry.js`, which `nginx.conf` proxies to the
`aawm-tap-dashboard` container. For local Vite development, override it with
`AAWM_TAP_REMOTE_ENTRY`.

## Tap UI Contract

Tap remotes should follow the shell contract in
[`docs/tap-ui-contract.md`](docs/tap-ui-contract.md). The current component
sharing model is vendor-and-sync: a tap vendors the shell's shadcn primitives,
`theme.css`, and `cn()` helper locally, then uses shell runtime CSS variables
through token-backed Tailwind classes. The shell now consumes a tap manifest's
`accentColor` in module chrome.

To scaffold a new tap with that baseline:

```bash
pnpm scaffold:tap ../example-dashboard --module-id example-dashboard --name "Example" --base-path /example
```

# Shadcn Admin Dashboard

Admin Dashboard UI crafted with Shadcn and Vite. Built with responsiveness and accessibility in mind.

![alt text](public/images/shadcn-admin.png)

[![Sponsored by Clerk](https://img.shields.io/badge/Sponsored%20by-Clerk-5b6ee1?logo=clerk)](https://go.clerk.com/GttUAaK)

I've been creating dashboard UIs at work and for my personal projects. I always wanted to make a reusable collection of dashboard UI for future projects; and here it is now. While I've created a few custom components, some of the code is directly adapted from ShadcnUI examples.

> This is not a starter project (template) though. I'll probably make one in the future.

## Features

- Light/dark mode
- Responsive
- Accessible
- With built-in Sidebar component
- Global search command
- 10+ pages
- Extra custom components
- RTL support

<details>
<summary>Customized Components (click to expand)</summary>

This project uses Shadcn UI components, but some have been slightly modified for better RTL (Right-to-Left) support and other improvements. These customized components differ from the original Shadcn UI versions.

If you want to update components using the Shadcn CLI (e.g., `npx shadcn@latest add <component>`), it's generally safe for non-customized components. For the listed customized ones, you may need to manually merge changes to preserve the project's modifications and avoid overwriting RTL support or other updates.

> If you don't require RTL support, you can safely update the 'RTL Updated Components' via the Shadcn CLI, as these changes are primarily for RTL compatibility. The 'Modified Components' may have other customizations to consider.

### Modified Components

- scroll-area
- sonner
- separator

### RTL Updated Components

- alert-dialog
- calendar
- command
- dialog
- dropdown-menu
- select
- table
- sheet
- sidebar
- switch

**Notes:**

- **Modified Components**: These have general updates, potentially including RTL adjustments.
- **RTL Updated Components**: These have specific changes for RTL language support (e.g., layout, positioning).
- For implementation details, check the source files in `src/components/ui/`.
- All other Shadcn UI components in the project are standard and can be safely updated via the CLI.

</details>

## Tech Stack

**UI:** [ShadcnUI](https://ui.shadcn.com) (TailwindCSS + RadixUI)

**Build Tool:** [Vite](https://vitejs.dev/)

**Routing:** [TanStack Router](https://tanstack.com/router/latest)

**Type Checking:** [TypeScript](https://www.typescriptlang.org/)

**Linting/Formatting:** [ESLint](https://eslint.org/) & [Prettier](https://prettier.io/)

**Icons:** [Lucide Icons](https://lucide.dev/icons/), [Tabler Icons](https://tabler.io/icons) (Brand icons only)

**Auth (partial):** [Clerk](https://go.clerk.com/GttUAaK)

## Run Locally

Clone the project

```bash
  git clone https://github.com/satnaing/shadcn-admin.git
```

Go to the project directory

```bash
  cd shadcn-admin
```

Install dependencies

```bash
  pnpm install
```

Start the server

```bash
  pnpm run dev
```

## Sponsoring this project ❤️

If you find this project helpful or use this in your own work, consider [sponsoring me](https://github.com/sponsors/satnaing) to support development and maintenance. You can [buy me a coffee](https://buymeacoffee.com/satnaing) as well. Don’t worry, every penny helps. Thank you! 🙏

For questions or sponsorship inquiries, feel free to reach out at [satnaingdev@gmail.com](mailto:satnaingdev@gmail.com).

### Current Sponsor

- [Clerk](https://go.clerk.com/GttUAaK) - authentication and user management for the modern web

## Author

Crafted with 🤍 by [@satnaing](https://github.com/satnaing)

## License

Licensed under the [MIT License](https://choosealicense.com/licenses/mit/)
