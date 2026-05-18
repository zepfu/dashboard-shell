/**
 * Tasks feature entry-point.
 *
 * Exports:
 *
 *  `Tasks` — Thin plugin-boundary component. Wraps its content with
 *  `data-plugin="tasks"` and imports the scoped `tasks.module.css` so the
 *  Phosphor token override (`--accent-chrome: #6366f1`) is injected into the
 *  document. Has **no** router or Sidebar dependencies — safe to render in
 *  unit tests without any provider wrappers.
 *
 *  `TasksRoute` — Full authenticated route component. Renders `TasksPage`
 *  (which includes the TanStack Table + dialogs) inside the shared layout
 *  chrome (Header + Main). Always rendered within the app's RouterProvider
 *  and SidebarProvider.
 *
 * The CSS import is a side-effect: Vite injects the `[data-plugin="tasks"]`
 * rule so that `document.styleSheets` contains it during testing.
 *
 * See docs/plugins/theme-contract.md for the full plugin token contract.
 */
import { type ReactElement } from 'react'
import { ConfigDrawer } from '@/components/config-drawer'
import { Header } from '@/components/layout/header'
import { Main } from '@/components/layout/main'
import { ProfileDropdown } from '@/components/profile-dropdown'
import { Search } from '@/components/search'
import { TasksPage } from './tasks-page'
import './tasks.module.css'

/**
 * Tasks is the plugin-boundary marker component exported for test isolation.
 *
 * Renders a `<div data-plugin="tasks">` wrapper with a minimal stub of the
 * tasks page chrome (heading only). This is intentionally lightweight — it has
 * no dependency on TanStack Router's `getRouteApi`, SidebarProvider, or any
 * other app-level context so that `plugin-theme-override.test.tsx` can render
 * it with a plain `render(<Tasks />)`.
 *
 * The real tasks content (TasksTable, TasksDialogs) is rendered by
 * `TasksRoute`, which wraps `TasksPage` inside the authenticated layout.
 */
export function Tasks(): ReactElement {
  return (
    <div data-plugin='tasks'>
      <div className='flex flex-wrap items-end justify-between gap-2'>
        <div>
          <h2 className='text-2xl font-bold tracking-tight'>Tasks</h2>
          <p className='text-muted-foreground'>
            Here&apos;s a list of your tasks for this month!
          </p>
        </div>
      </div>
    </div>
  )
}

/**
 * TasksRoute is the full route component used by
 * `src/routes/_authenticated/tasks/index.tsx`.
 *
 * Wraps `TasksPage` (full tasks table + dialogs) with authenticated layout
 * chrome. Requires RouterProvider and SidebarProvider in the component tree.
 */
export function TasksRoute(): ReactElement {
  return (
    <>
      <Header fixed>
        <Search />
        <div className='ms-auto flex items-center space-x-4'>
          <ConfigDrawer />
          <ProfileDropdown />
        </div>
      </Header>

      <Main className='flex flex-1 flex-col gap-4 sm:gap-6'>
        <TasksPage />
      </Main>
    </>
  )
}
