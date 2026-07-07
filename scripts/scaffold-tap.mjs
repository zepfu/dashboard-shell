#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..'
)
const KNOWN_FLAGS = new Set([
  'moduleId',
  'name',
  'basePath',
  'apiBase',
  'accentColor',
  'description',
  'help',
])

if (isDirectRun()) {
  try {
    const result = main(process.argv.slice(2), { cwd: process.cwd() })
    if (typeof result === 'number') {
      process.exit(result)
    }
  } catch (error) {
    process.stderr.write(`${error.message}\n`)
    process.exit(1)
  }
}

export function main(argv = process.argv.slice(2), options = {}) {
  const { cwd = process.cwd() } = options
  const args = parseArgs(argv)

  if (args.help || !args._[0]) {
    printUsage()
    return args.help ? 0 : 1
  }

  const config = buildScaffoldConfig({ ...args, cwd })
  return scaffoldDashboard(config)
}

function buildScaffoldConfig(parsedArgs) {
  const targetDir = path.resolve(parsedArgs.cwd, parsedArgs._[0])
  const moduleId = normalizeId(parsedArgs.moduleId ?? path.basename(targetDir))
  const displayName = parsedArgs.name ?? moduleId
  const moduleTitle = toTitle(displayName)
  const basePath = ensureLeadingSlash(
    parsedArgs.basePath ?? `/${moduleId.replace(/-dashboard$/, '')}`
  )
  const apiBase = parsedArgs.apiBase ?? `/api${basePath}`
  const accentColor = parsedArgs.accentColor ?? 'hsl(220 70% 50%)'
  const description =
    parsedArgs.description ?? `Operator dashboard for ${displayName}`

  return {
    targetDir,
    moduleId,
    displayName,
    moduleTitle,
    basePath,
    apiBase,
    accentColor,
    description,
  }
}

function scaffoldDashboard(config) {
  const {
    targetDir,
    moduleId,
    displayName,
    moduleTitle,
    basePath,
    apiBase,
    accentColor,
    description,
  } = config

  if (fs.existsSync(targetDir) && fs.readdirSync(targetDir).length > 0) {
    throw new Error(
      `Refusing to scaffold into non-empty directory: ${targetDir}`
    )
  }

  fs.mkdirSync(targetDir, { recursive: true })
  fs.mkdirSync(path.join(targetDir, 'src/pages'), { recursive: true })
  fs.mkdirSync(path.join(targetDir, 'src/styles'), { recursive: true })

  copyFromShell(
    path.join(repoRoot, 'src/components/ui'),
    path.join(targetDir, 'src/components/ui')
  )
  copyFromShell(
    path.join(repoRoot, 'src/lib/utils.ts'),
    path.join(targetDir, 'src/lib/utils.ts')
  )
  copyFromShell(
    path.join(repoRoot, 'src/styles/theme.css'),
    path.join(targetDir, 'src/styles/theme.css')
  )
  copyFromShell(
    path.join(repoRoot, 'components.json'),
    path.join(targetDir, 'components.json')
  )

  writeFile(
    path.join(targetDir, 'package.json'),
    JSON.stringify(buildPackageJson({ moduleId }), null, 2)
  )
  writeFile(path.join(targetDir, 'index.html'), buildIndexHtml({ moduleTitle }))
  writeFile(
    path.join(targetDir, 'vite.config.ts'),
    buildViteConfig({ moduleId })
  )
  writeFile(path.join(targetDir, 'eslint.config.js'), buildEslintConfig())
  writeFile(path.join(targetDir, 'src/main.tsx'), buildMainTsx())
  writeFile(
    path.join(targetDir, 'src/module.ts'),
    buildModuleTs({
      moduleId,
      displayName,
      moduleTitle,
      basePath,
      apiBase,
      accentColor,
      description,
    })
  )
  writeFile(
    path.join(targetDir, 'src/pages/Overview.tsx'),
    buildOverviewTsx({ moduleTitle })
  )
  writeFile(path.join(targetDir, 'src/styles/index.css'), buildIndexCss())
  writeFile(
    path.join(targetDir, 'README.md'),
    buildReadme({ moduleTitle, moduleId })
  )

  process.stdout.write(`Created remote dashboard starter at ${targetDir}\n`)
  return 0
}

export function parseArgs(argv) {
  const parsed = { _: [] }

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]

    if (arg === '--') {
      parsed._.push(...argv.slice(index + 1))
      break
    }

    if (!arg.startsWith('--')) {
      parsed._.push(arg)
      continue
    }

    if (arg === '--help') {
      parsed.help = true
      continue
    }

    const token = arg.slice(2)
    const separatorIndex = token.indexOf('=')
    const rawKey =
      separatorIndex === -1 ? token : token.slice(0, separatorIndex)
    const rawValue =
      separatorIndex === -1 ? undefined : token.slice(separatorIndex + 1)
    const key = rawKey.replace(/-([a-z])/g, (_, char) => char.toUpperCase())

    if (!KNOWN_FLAGS.has(key)) {
      throw new Error(`Unsupported argument: ${arg}`)
    }

    if (key === 'help') {
      if (rawValue !== undefined) {
        throw new Error(`Unsupported value for --help`)
      }
      parsed.help = true
      continue
    }

    if (rawValue !== undefined) {
      parsed[key] = rawValue
      continue
    }

    const next = argv[index + 1]
    if (next && !next.startsWith('--')) {
      parsed[key] = next
      index += 1
      continue
    }

    throw new Error(`Missing value for ${arg}`)
  }

  return parsed
}

function printUsage() {
  process.stdout.write(`Usage:
  pnpm scaffold:dashboard ../example-dashboard --module-id example-dashboard --name "Example" --base-path /example

Options:
  --module-id     Module Federation remote name and manifest id.
  --name          Human-readable module name.
  --base-path     Shell route prefix. Defaults to /<module-id>.
  --api-base      Server-side API prefix. Defaults to /api<base-path>.
  --accent-color  CSS color consumed by shell chrome. Defaults to hsl(220 70% 50%).
  --description   Module description shown in shell chrome.
`)
}

function isDirectRun() {
  return process.argv[1] === fileURLToPath(import.meta.url)
}

function copyFromShell(source, destination) {
  fs.mkdirSync(path.dirname(destination), { recursive: true })
  fs.cpSync(source, destination, { recursive: true })
}

function writeFile(destination, content) {
  fs.mkdirSync(path.dirname(destination), { recursive: true })
  fs.writeFileSync(destination, `${content.trimEnd()}\n`)
}

function buildPackageJson({ moduleId }) {
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

function buildIndexHtml({ moduleTitle }) {
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

function buildViteConfig({ moduleId }) {
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

function buildModuleTs({
  moduleId,
  displayName,
  moduleTitle,
  basePath,
  apiBase,
  accentColor,
  description,
}) {
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

function buildOverviewTsx({ moduleTitle }) {
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
          variables. The remote owns page-level data views and interactions.
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

function buildReadme({ moduleTitle, moduleId }) {
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
