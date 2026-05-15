# Tap UI Contract

This shell is the host and design-system boundary for dashboard taps. A tap is a
Module Federation remote that owns its data views, while the shell owns global
chrome, route mounting, server-side auth forwarding, and runtime theme tokens.

## Current Component-Sharing Decision

Use the vendor-and-sync model for now.

Each tap should vendor the shell's shadcn primitives and helper files into its
own repo:

- `src/components/ui/`
- `src/lib/utils.ts`
- `src/styles/theme.css`
- `components.json`

This keeps remote builds predictable and avoids coupling tap runtime loading to a
second federated component remote. Do not import shell components across Module
Federation yet. Revisit a private package or federated `dashboard-shell/ui`
module only when component drift across taps becomes more expensive than the
extra release/runtime complexity.

## Runtime CSS Variables

The shell guarantees these token families are present on `:root` before a tap
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

Tap page code should use Tailwind token utilities such as `bg-card`,
`text-foreground`, `border-border`, `text-muted-foreground`, `bg-primary`, and
`text-primary-foreground`. Avoid raw hex colors and JSX inline styles in tap
page code.

## Dark Mode

The shell toggles `.dark` on the document root. A tap that uses token-backed
Tailwind classes and imports `src/styles/theme.css` in standalone mode will
inherit the same light and dark palettes in both standalone and shell-mounted
modes.

## Manifest Fields

The remote manifest should export:

- `id`: stable Module Federation id.
- `name`: visible module name in shell chrome.
- `description`: short shell-header description.
- `icon`: lucide-compatible icon component.
- `basePath`: shell route prefix, such as `/aawm-tap`.
- `routes`: route path to component mappings.
- `navItems`: visible nav labels and paths. The shell header uses these labels
  before falling back to route-derived titles.
- `apiBase`: browser-safe API prefix. Credentials stay in shell/server-side
  environment variables, not `VITE_*` values.
- `accentColor`: CSS color used by the shell for the module icon tile and active
  nav accents.

Do not add manifest fields unless the shell consumes them or a TODO item tracks
the consuming work.

## Starter Scaffold

Create a new tap from this repo with:

```bash
pnpm scaffold:tap ../example-dashboard \
  --module-id example-dashboard \
  --name "Example" \
  --base-path /example \
  --accent-color "hsl(220 70% 50%)"
```

The scaffold vendors the current shadcn primitives, theme tokens, `cn()` helper,
federated `module.ts`, standalone entrypoint, and an ESLint rule that rejects JSX
inline `style` attributes in tap page code.

After scaffolding, run the new tap with:

```bash
cd ../example-dashboard
pnpm install
pnpm dev
```

Then point the shell at the generated `remoteEntry.js` while developing.
