import { Component, lazy, Suspense, type ReactNode } from 'react'
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
import type { ProjectModule } from './types'

type AawmTapModuleViewProps = {
  routePath: string
}

type BoundaryProps = {
  children: ReactNode
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
        <Main>
          <Alert variant='destructive'>
            <AlertTriangle className='size-4' />
            <AlertTitle>Dashboard module failed to load</AlertTitle>
            <AlertDescription>
              Check that the aawm-tap-dashboard remote is running and that
              `remoteEntry.js` is reachable from the shell.
            </AlertDescription>
          </Alert>
        </Main>
      )
    }

    return this.props.children
  }
}

const AawmTapModuleView = lazy(async () => {
  const remote = await import('aawm-tap-dashboard/module')

  return {
    default: createAawmTapModuleView(remote.default),
  }
})

export function AawmTapDashboardRoute({ routePath }: AawmTapModuleViewProps) {
  return (
    <RemoteModuleBoundary>
      <Suspense fallback={<RemoteLoadingState />}>
        <AawmTapModuleView routePath={routePath} />
      </Suspense>
    </RemoteModuleBoundary>
  )
}

function createAawmTapModuleView(module: ProjectModule) {
  return function AawmTapModuleViewContent({
    routePath,
  }: AawmTapModuleViewProps) {
    const route = module.routes.find(
      (candidate) => candidate.path === routePath
    )

    if (route === undefined) {
      return <RemoteRouteNotFound module={module} routePath={routePath} />
    }

    const Component = route.component

    return (
      <>
        <RemoteHeader module={module} routePath={route.path} />
        <Main fluid className='min-h-[calc(100svh-4rem)]'>
          <Suspense fallback={<RemoteLoadingState compact />}>
            <Component />
          </Suspense>
        </Main>
      </>
    )
  }
}

function RemoteHeader({
  module,
  routePath,
}: {
  module: ProjectModule
  routePath: string
}) {
  const moduleNavItems =
    module.navItems.length > 0
      ? module.navItems
      : module.routes.map((route) => ({
          label: titleFromPath(route.path),
          path: route.path,
          icon: module.icon,
        }))

  const navLinks = moduleNavItems.map((navItem) => ({
    title: navItem.label,
    href: `${module.basePath}${navItem.path}`,
    isActive: navItem.path === routePath,
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
      <TopNav links={navLinks} className='ms-6' />
      <div className='ms-auto flex items-center space-x-4'>
        <Search />
        <ConfigDrawer />
        <ProfileDropdown />
      </div>
    </Header>
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
    <>
      <RemoteHeader module={module} routePath='' />
      <Main>
        <Alert>
          <AlertTriangle className='size-4' />
          <AlertTitle>Unknown dashboard route</AlertTitle>
          <AlertDescription>
            `{routePath}` is not exposed by the {module.name} module.
          </AlertDescription>
        </Alert>
      </Main>
    </>
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
  return path
    .replace(/^\//, '')
    .split('-')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ')
}
