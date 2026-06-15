import {
  Component,
  lazy,
  Suspense,
  type ComponentType,
  type LazyExoticComponent,
  type ReactNode,
} from 'react'
import { AlertTriangle, Loader2 } from 'lucide-react'
import { getAccentStyle } from '@/lib/accent-color'
import { cn } from '@/lib/utils'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { ConfigDrawer } from '@/components/config-drawer'
import { Header } from '@/components/layout/header'
import { Main } from '@/components/layout/main'
import { TopNav } from '@/components/layout/top-nav'
import { ProfileDropdown } from '@/components/profile-dropdown'
import { Search } from '@/components/search'
import { PhosphorLayout } from '@/features/dashboard/components/phosphor-layout'
import { PhosphorSidebar } from '@/features/dashboard/components/phosphor-sidebar'
import {
  normalizeRemoteRoutePath,
  remoteDashboardConfigByKey,
  remoteDashboardHref,
  type RemoteDashboardKey,
  type RemoteDashboardRegistryEntry,
} from './remote-dashboard-registry'
import {
  assertProjectModule,
  buildRemoteRouteProps,
  createRetryableImporter,
  matchRoutePath,
  RemoteModuleContractError,
} from './remote-dashboard-runtime'
import { warnRemoteNavDrift } from './remote-dev-log'
import type { ProjectModule, RemoteRouteConfig } from './types'

type RemoteDashboardRouteProps = {
  moduleKey: RemoteDashboardKey
  routePath: string
}

type RemoteModuleViewProps = {
  routePath: string
}

type RemoteHeaderModule = {
  name: string
  description: string
  icon: ProjectModule['icon']
  basePath: string
  accentColor?: string
  navItems: ProjectModule['navItems']
  routes?: RemoteRouteConfig[]
}

type RemoteDashboardRuntimeConfig = Pick<
  RemoteDashboardRegistryEntry,
  'apiBase' | 'basePath' | 'moduleId'
>

declare global {
  interface Window {
    __DASHBOARD_SHELL_REMOTES__?: Record<string, RemoteDashboardRuntimeConfig>
  }
}

type BoundaryProps = {
  children: ReactNode
  config: RemoteDashboardRegistryEntry
  routePath: string
}

type BoundaryState = {
  error: unknown
}

class RemoteModuleBoundary extends Component<BoundaryProps, BoundaryState> {
  state: BoundaryState = { error: null }

  static getDerivedStateFromError(error: unknown): BoundaryState {
    return { error }
  }

  render() {
    if (this.state.error !== null) {
      const isContractViolation =
        this.state.error instanceof RemoteModuleContractError ||
        (this.state.error instanceof Error &&
          this.state.error.name === 'RemoteModuleContractError')

      return (
        <RemoteDashboardFrame
          module={this.props.config}
          routePath={this.props.routePath}
          configKey={this.props.config.key}
          main={
            <Main>
              <Alert variant='destructive'>
                <AlertTriangle className='size-4' />
                <AlertTitle>
                  {isContractViolation
                    ? 'Dashboard module contract violation'
                    : 'Dashboard module failed to load'}
                </AlertTitle>
                <AlertDescription>
                  {isContractViolation
                    ? `The ${this.props.config.moduleId} remote loaded but its default export does not match the shell ProjectModule contract.`
                    : `Check that the ${this.props.config.moduleId} remote is running and that remoteEntry.js is reachable from the shell.`}
                </AlertDescription>
              </Alert>
            </Main>
          }
        />
      )
    }

    return this.props.children
  }
}

const remoteModuleViews = Object.fromEntries(
  Object.values(remoteDashboardConfigByKey).map((config) => [
    config.key,
    lazy(() => {
      const load = createRetryableImporter(async () => {
        publishRemoteRuntimeConfig(config)
        const remote = await config.importModule()
        assertProjectModule(remote.default)
        publishRemoteRuntimeConfig(config)

        return {
          default: createRemoteModuleView(config, remote.default),
        }
      })
      return load()
    }),
  ])
) as Record<
  RemoteDashboardKey,
  LazyExoticComponent<ComponentType<RemoteModuleViewProps>>
>

export function RemoteDashboardRoute({
  moduleKey,
  routePath,
}: RemoteDashboardRouteProps) {
  const config = remoteDashboardConfigByKey[moduleKey]
  const RemoteModuleView = remoteModuleViews[moduleKey]
  publishRemoteRuntimeConfig(config)

  return (
    <RemoteModuleBoundary config={config} routePath={routePath}>
      <Suspense
        fallback={
          <RemoteDashboardFrame
            module={config}
            routePath={routePath}
            configKey={config.key}
            main={<RemoteLoadingState />}
          />
        }
      >
        <RemoteModuleView routePath={routePath} />
      </Suspense>
    </RemoteModuleBoundary>
  )
}

function publishRemoteRuntimeConfig(config: RemoteDashboardRegistryEntry) {
  if (typeof window === 'undefined') return

  window.__DASHBOARD_SHELL_REMOTES__ = {
    ...(window.__DASHBOARD_SHELL_REMOTES__ ?? {}),
    [config.moduleId]: {
      apiBase: config.apiBase,
      basePath: config.basePath,
      moduleId: config.moduleId,
    },
  }
}

function createRemoteModuleView(
  config: RemoteDashboardRegistryEntry,
  module: ProjectModule
) {
  return function RemoteModuleViewContent({
    routePath,
  }: RemoteModuleViewProps) {
    const resolvedRoutePath = normalizeRemoteRoutePath(routePath)
    const routeMatch = findRemoteRouteMatch(module.routes, resolvedRoutePath)

    if (routeMatch === undefined) {
      return (
        <RemoteRouteNotFound module={module} routePath={resolvedRoutePath} />
      )
    }

    const Component = routeMatch.route.component
    const routeProps = buildRemoteRouteProps(
      config,
      resolvedRoutePath,
      routeMatch.params
    )

    return (
      <RemoteDashboardFrame
        module={module}
        routePath={routeMatch.route.path}
        configKey={config.key}
        main={
          <Main fluid className='min-h-[calc(100svh-4rem)]'>
            <Suspense fallback={<RemoteLoadingState compact />}>
              <Component {...routeProps} />
            </Suspense>
          </Main>
        }
      />
    )
  }
}

function RemoteDashboardFrame({
  module,
  routePath,
  configKey,
  main,
}: {
  module: RemoteHeaderModule
  routePath: string
  configKey?: RemoteDashboardKey
  main: ReactNode
}) {
  return (
    <PhosphorLayout
      sidebar={<PhosphorSidebar />}
      header={
        <RemoteHeader
          module={module}
          routePath={routePath}
          configKey={configKey}
        />
      }
      main={main}
    />
  )
}

function findRemoteRouteMatch(routes: RemoteRouteConfig[], routePath: string) {
  for (const route of routes) {
    const params = matchRoutePath(route.path, routePath)
    if (params !== undefined) return { route, params }
  }
  return undefined
}

function RemoteHeader({
  module,
  routePath,
  configKey,
}: {
  module: RemoteHeaderModule
  routePath: string
  configKey?: RemoteDashboardKey
}) {
  const shellConfig = configKey
    ? remoteDashboardConfigByKey[configKey]
    : Object.values(remoteDashboardConfigByKey).find(
        (entry) => entry.basePath === module.basePath
      )

  const preferredNavItems =
    shellConfig && shellConfig.navItems.length > 0
      ? shellConfig.navItems
      : module.navItems

  if (
    import.meta.env.DEV &&
    shellConfig &&
    module.navItems.length > 0 &&
    shellConfig.navItems.length > 0 &&
    JSON.stringify(module.navItems.map((n) => n.path)) !==
      JSON.stringify(shellConfig.navItems.map((n) => n.path))
  ) {
    warnRemoteNavDrift(shellConfig.moduleId)
  }

  const moduleNavItems =
    preferredNavItems.length > 0
      ? preferredNavItems
      : (module.routes ?? []).map((route) => ({
          label: titleFromPath(route.path),
          path: route.path,
          icon: module.icon,
        }))

  const normalizedRoutePath = normalizeRemoteRoutePath(routePath)
  const navLinks = moduleNavItems.map((navItem) => ({
    title: navItem.label,
    href: remoteDashboardHref(
      shellConfig ?? { basePath: module.basePath },
      navItem.path
    ),
    isActive: isRemoteNavItemActive(navItem.path, normalizedRoutePath),
    accentColor: module.accentColor,
  }))

  const ModuleIcon = module.icon
  const accentStyle = getAccentStyle(module.accentColor, {
    colorVar: '--module-accent',
  })

  return (
    <Header>
      <div className='flex min-w-0 items-center gap-3'>
        <div
          style={accentStyle}
          className={cn(
            'flex size-9 shrink-0 items-center justify-center rounded-md',
            module.accentColor
              ? 'bg-[var(--module-accent)] text-white shadow-sm'
              : 'bg-primary text-primary-foreground'
          )}
        >
          <ModuleIcon className='size-5' />
        </div>
        <div className='min-w-0'>
          <h1 className='truncate text-base font-semibold'>{module.name}</h1>
          <p className='truncate text-xs text-muted-foreground'>
            {module.description}
          </p>
        </div>
      </div>
      <TopNav
        links={navLinks}
        className='ms-6 min-w-0 flex-1 overflow-x-auto pb-1 whitespace-nowrap'
      />
      <div className='ms-auto flex items-center space-x-4'>
        <Search />
        <ConfigDrawer />
        <ProfileDropdown />
      </div>
    </Header>
  )
}

function isRemoteNavItemActive(navPath: string, routePath: string) {
  const normalizedNavPath = normalizeRemoteRoutePath(navPath)
  if (normalizedNavPath === '/') return routePath === '/'
  return (
    routePath === normalizedNavPath ||
    routePath.startsWith(`${normalizedNavPath}/`)
  )
}

function RemoteRouteNotFound({
  module,
  routePath,
}: {
  module: ProjectModule
  routePath: string
}) {
  return (
    <RemoteDashboardFrame
      module={module}
      routePath=''
      configKey={undefined}
      main={
        <Main>
          <Alert>
            <AlertTriangle className='size-4' />
            <AlertTitle>Unknown dashboard route</AlertTitle>
            <AlertDescription>
              `{routePath}` is not exposed by the {module.name} module.
            </AlertDescription>
          </Alert>
        </Main>
      }
    />
  )
}

function RemoteLoadingState({ compact = false }: { compact?: boolean }) {
  const body = (
    <div className='flex items-center gap-2 text-sm text-muted-foreground'>
      <Loader2 className='size-4 animate-spin' />
      Loading dashboard module...
    </div>
  )

  if (compact) return body

  return <Main>{body}</Main>
}

function titleFromPath(path: string): string {
  const title = path === '/' ? 'Overview' : path.replace(/^\//, '')
  return title
    .split('-')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ')
}
