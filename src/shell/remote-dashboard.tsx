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
import type {
  ProjectModule,
  RemoteRouteConfig,
  RemoteRouteProps,
} from './types'

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
      return (
        <RemoteDashboardFrame
          module={this.props.config}
          routePath={this.props.routePath}
          main={
            <Main>
              <Alert variant='destructive'>
                <AlertTriangle className='size-4' />
                <AlertTitle>Dashboard module failed to load</AlertTitle>
                <AlertDescription>
                  Check that the {this.props.config.moduleId} remote is running
                  and that `remoteEntry.js` is reachable from the shell.
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
    lazy(async () => {
      const remote = await config.importModule()

      return {
        default: createRemoteModuleView(config, remote.default),
      }
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

  return (
    <RemoteModuleBoundary config={config} routePath={routePath}>
      <Suspense
        fallback={
          <RemoteDashboardFrame
            module={config}
            routePath={routePath}
            main={<RemoteLoadingState />}
          />
        }
      >
        <RemoteModuleView routePath={routePath} />
      </Suspense>
    </RemoteModuleBoundary>
  )
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
  main,
}: {
  module: RemoteHeaderModule
  routePath: string
  main: ReactNode
}) {
  return (
    <PhosphorLayout
      sidebar={<PhosphorSidebar />}
      header={<RemoteHeader module={module} routePath={routePath} />}
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

function matchRoutePath(pattern: string, routePath: string) {
  const normalizedPattern = normalizeRemoteRoutePath(pattern)
  const normalizedRoutePath = normalizeRemoteRoutePath(routePath)

  if (normalizedPattern === normalizedRoutePath) {
    return {}
  }

  if (normalizedPattern === '/' || normalizedRoutePath === '/') {
    return undefined
  }

  const patternSegments = normalizedPattern.split('/').filter(Boolean)
  const routeSegments = normalizedRoutePath.split('/').filter(Boolean)
  if (patternSegments.length !== routeSegments.length) {
    return undefined
  }

  const params: Record<string, string> = {}
  for (const [index, patternSegment] of patternSegments.entries()) {
    const routeSegment = routeSegments[index]
    if (routeSegment === undefined) return undefined

    if (patternSegment.startsWith(':')) {
      const paramName = patternSegment.slice(1)
      params[paramName] = decodePathSegment(routeSegment)
      continue
    }

    if (patternSegment !== routeSegment) {
      return undefined
    }
  }

  return params
}

function decodePathSegment(segment: string) {
  try {
    return decodeURIComponent(segment)
  } catch {
    return segment
  }
}

function buildRemoteRouteProps(
  config: RemoteDashboardRegistryEntry,
  routePath: string,
  params: Record<string, string>
): RemoteRouteProps {
  return {
    ...params,
    params,
    moduleId: config.moduleId,
    routePath,
    basePath: config.basePath,
    apiBase: config.apiBase,
  }
}

function RemoteHeader({
  module,
  routePath,
}: {
  module: RemoteHeaderModule
  routePath: string
}) {
  const moduleNavItems =
    module.navItems.length > 0
      ? module.navItems
      : (module.routes ?? []).map((route) => ({
          label: titleFromPath(route.path),
          path: route.path,
          icon: module.icon,
        }))

  const normalizedRoutePath = normalizeRemoteRoutePath(routePath)
  const navLinks = moduleNavItems.map((navItem) => ({
    title: navItem.label,
    href: remoteDashboardHref(module, navItem.path),
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
