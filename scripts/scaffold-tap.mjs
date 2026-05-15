#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..'
)

const args = parseArgs(process.argv.slice(2))

if (args.help || !args._[0]) {
  printUsage()
  process.exit(args.help ? 0 : 1)
}

const targetDir = path.resolve(process.cwd(), args._[0])
const moduleId = normalizeId(args.moduleId ?? path.basename(targetDir))
const displayName = args.name ?? moduleId
const moduleTitle = toTitle(displayName)
const basePath = ensureLeadingSlash(
  args.basePath ?? `/${moduleId.replace(/-dashboard$/, '')}`
)
const apiBase = args.apiBase ?? `/api${basePath}`
const accentColor = args.accentColor ?? 'hsl(220 70% 50%)'
const description =
  args.description ?? `Operator dashboard for ${displayName}`

if (fs.existsSync(targetDir) && fs.readdirSync(targetDir).length > 0) {
  throw new Error(
    `Refusing to scaffold into non-empty directory: ${targetDir}`
  )
}

fs.mkdirSync(targetDir, { recursive: true })
fs.mkdirSync(path.join(targetDir, 'src/pages'), { recursive: true })
fs.mkdirSync(path.join(targetDir, 'src/styles'), { recursive: true })

copyFromShell('src/components/ui', 'src/components/ui')
copyFromShell('src/lib/utils.ts', 'src/lib/utils.ts')
copyFromShell('src/styles/theme.css', 'src/styles/theme.css')
copyFromShell('components.json', 'components.json')

writeFile('package.json', JSON.stringify(buildPackageJson(), null, 2))
writeFile('index.html', buildIndexHtml())
writeFile('vite.config.ts', buildViteConfig())
writeFile('eslint.config.js', buildEslintConfig())
writeFile('src/main.tsx', buildMainTsx())
writeFile('src/module.ts', buildModuleTs())
writeFile('src/pages/Overview.tsx', buildOverviewTsx())
writeFile('src/styles/index.css', buildIndexCss())
writeFile('README.md', buildReadme())

process.stdout.write(`Created tap starter at ${targetDir}\n`)

function parseArgs(argv) {
  const parsed = { _: [] }

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]

    if (!arg.startsWith('--')) {
      parsed._.push(arg)
      continue
    }

    const [rawKey, rawValue] = arg.slice(2).split('=')
    const key = rawKey.replace(/-([a-z])/g, (_, char) => char.toUpperCase())

    if (rawValue !== undefined) {
      parsed[key] = rawValue
      continue
    }

    const next = argv[index + 1]
    if (next && !next.startsWith('--')) {
      parsed[key] = next
      index += 1
    } else {
      parsed[key] = true
    }
  }

  return parsed
}

function printUsage() {
  process.stdout.write(`Usage:
  pnpm scaffold:tap ../example-dashboard --module-id example-dashboard --name "Example" --base-path /example

Options:
  --module-id     Module Federation remote name and manifest id.
  --name          Human-readable module name.
  --base-path     Shell route prefix. Defaults to /<module-id>.
  --api-base      Server-side API prefix. Defaults to /api<base-path>.
  --accent-color  CSS color consumed by shell chrome. Defaults to hsl(220 70% 50%).
  --description   Module description shown in shell chrome.
`)
}

function copyFromShell(from, to) {
  const source = path.join(repoRoot, from)
  const destination = path.join(targetDir, to)
  fs.mkdirSync(path.dirname(destination), { recursive: true })
  fs.cpSync(source, destination, { recursive: true })
}

function writeFile(relativePath, content) {
  const destination = path.join(targetDir, relativePath)
  fs.mkdirSync(path.dirname(destination), { recursive: true })
  fs.writeFileSync(destination, `${content.trimEnd()}\n`)
}

function buildPackageJson() {
  const shellPackage = JSON.parse(
    fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8')
  )
  const dependencyNames = [
    '@hookform/resolvers',
    '@tailwindcss/vite',
    '@tanstack/react-query',
    ...Object.keys(shellPackage.dependencies).filter((name) =>
      name.startsWith('@radix-ui/')
    ),
    'class-variance-authority',
    'clsx',
    'cmdk',
    'date-fns',
    'input-otp',
    'lucide-react',
    'react',
    'react-day-picker',
    'react-dom',
    'react-hook-form',
    'sonner',
    'tailwind-merge',
    'tailwindcss',
    'tw-animate-css',
    'zod',
  ]
  const devDependencyNames = [
    '@eslint/js',
    '@module-federation/vite',
    '@types/node',
    '@types/react',
    '@types/react-dom',
    '@vitejs/plugin-react-swc',
    'eslint',
    'eslint-plugin-react-hooks',
    'eslint-plugin-react-refresh',
    'globals',
    'prettier',
    'prettier-plugin-tailwindcss',
    'typescript',
    'typescript-eslint',
    'vite',
  ]

  return {
    name: moduleId,
    private: true,
    version: '0.1.0',
    type: 'module',
    scripts: {
      dev: 'vite --host 0.0.0.0 --port 5173 --strictPort --cors',
      build: 'tsc -b && vite build',
      lint: 'eslint .',
      preview: 'vite preview',
    },
    dependencies: pick(shellPackage.dependencies, dependencyNames),
    devDependencies: pick(shellPackage.devDependencies, devDependencyNames),
  }
}

function buildIndexHtml() {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${escapeHtml(moduleTitle)}</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>`
}

function buildViteConfig() {
  return `import path from 'path'
import { federation } from '@module-federation/vite'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react-swc'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [
    federation({
      name: ${JSON.stringify(moduleId)},
      filename: 'remoteEntry.js',
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
    }),
    react(),
    tailwindcss(),
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  build: {
    target: 'esnext',
  },
})`
}

function buildEslintConfig() {
  return `import globals from 'globals'
import js from '@eslint/js'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import { defineConfig } from 'eslint/config'
import tseslint from 'typescript-eslint'

export default defineConfig(
  { ignores: ['dist', '@mf-types', 'src/components/ui'] },
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ['src/**/*.{ts,tsx}'],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'react-refresh/only-export-components': [
        'warn',
        { allowConstantExport: true },
      ],
      'no-console': 'error',
      'no-unused-vars': 'off',
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          args: 'all',
          argsIgnorePattern: '^_',
          caughtErrors: 'all',
          caughtErrorsIgnorePattern: '^_',
          destructuredArrayIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          ignoreRestSiblings: true,
        },
      ],
      '@typescript-eslint/consistent-type-imports': [
        'error',
        {
          prefer: 'type-imports',
          fixStyle: 'inline-type-imports',
          disallowTypeAnnotations: false,
        },
      ],
      'no-duplicate-imports': 'error',
      'no-restricted-syntax': [
        'error',
        {
          selector: "JSXAttribute[name.name='style']",
          message:
            'Use shell design tokens and Tailwind utilities instead of inline JSX styles.',
        },
      ],
    },
  }
)`
}

function buildMainTsx() {
  return `import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './styles/index.css'
import Overview from './pages/Overview'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Overview />
  </StrictMode>
)`
}

function buildModuleTs() {
  return `import { lazy } from 'react'
import { LayoutDashboard as LayoutDashboardIcon } from 'lucide-react'

export default {
  id: ${JSON.stringify(moduleId)},
  name: ${JSON.stringify(displayName)},
  description: ${JSON.stringify(description)},
  icon: LayoutDashboardIcon,
  basePath: ${JSON.stringify(basePath)},
  routes: [
    { path: '/overview', component: lazy(() => import('./pages/Overview')) },
  ],
  navItems: [
    { label: 'Overview', path: '/overview', icon: LayoutDashboardIcon },
  ],
  extensions: [],
  apiBase: ${JSON.stringify(apiBase)},
  accentColor: ${JSON.stringify(accentColor)},
}`
}

function buildOverviewTsx() {
  return `import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'

export default function Overview() {
  return (
    <div className='grid gap-4 lg:grid-cols-3'>
      <Card className='lg:col-span-2'>
        <CardHeader>
          <CardTitle>${escapeJsx(moduleTitle)}</CardTitle>
          <CardDescription>
            Replace this panel with the first live dashboard workflow.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className='rounded-md border border-dashed p-6 text-sm text-muted-foreground'>
            Use shell tokens through Tailwind classes so this remote inherits
            the host theme in standalone and federated modes.
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Module Contract</CardTitle>
          <CardDescription>Remote manifest is exposed at ./module.</CardDescription>
        </CardHeader>
        <CardContent className='text-sm text-muted-foreground'>
          The shell owns routing chrome, auth forwarding, and global theme
          variables. The tap owns page-level data views and interactions.
        </CardContent>
      </Card>
    </div>
  )
}`
}

function buildIndexCss() {
  return `@import 'tailwindcss';
@import 'tw-animate-css';
@import './theme.css';

@custom-variant dark (&:is(.dark *));

@layer base {
  * {
    @apply border-border outline-ring/50;
  }

  body {
    @apply min-h-svh bg-background text-foreground;
  }
}`
}

function buildReadme() {
  return `# ${moduleTitle}

Module Federation remote for the dashboard shell.

## Development

\`\`\`bash
pnpm install
pnpm dev
\`\`\`

The remote exposes \`./module\` through \`remoteEntry.js\`. Add a shell remote
entry for \`${moduleId}\` and point it at
\`http://localhost:5173/remoteEntry.js\` while developing.

Keep page styles token-driven. The host injects the shared CSS variables at
runtime, and standalone mode imports \`src/styles/theme.css\` directly.`
}

function pick(source, names) {
  return Object.fromEntries(
    names
      .filter((name) => source[name])
      .sort()
      .map((name) => [name, source[name]])
  )
}

function ensureLeadingSlash(value) {
  return value.startsWith('/') ? value : `/${value}`
}

function normalizeId(value) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

function toTitle(value) {
  return value
    .replace(/[-_]+/g, ' ')
    .replace(/\b\w/g, (match) => match.toUpperCase())
}

function escapeHtml(value) {
  return value.replace(/[&<>"']/g, (char) => {
    const entities = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;',
    }
    return entities[char]
  })
}

function escapeJsx(value) {
  return value.replace(/[{}<>]/g, '')
}
