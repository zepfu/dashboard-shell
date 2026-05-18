/**
 * TasksPage — full tasks page content component.
 *
 * Renders the tasks list view (table, dialogs, header content) inside the
 * plugin-scoped `data-plugin="tasks"` wrapper so that token overrides from
 * `tasks.module.css` apply to all child content. Does NOT include layout
 * chrome (Header, Main) — those are provided by `TasksRoute` in index.tsx.
 *
 * Note: `TasksTable` uses TanStack Router hooks (`getRouteApi`) and therefore
 * requires a `RouterProvider` in scope. `TasksPage` is only rendered by
 * `TasksRoute` inside the authenticated app shell, which always has the router.
 * For unit tests that need only the plugin-wrapper boundary (not the table),
 * import `Tasks` from `@/features/tasks` instead.
 */
import { type ReactElement } from 'react'
import { TasksDialogs } from './components/tasks-dialogs'
import { TasksPrimaryButtons } from './components/tasks-primary-buttons'
import { TasksProvider } from './components/tasks-provider'
import { TasksTable } from './components/tasks-table'
import { tasks } from './data/tasks'

/**
 * TasksPage renders the full tasks feature content, including the data table
 * and all dialogs, inside the `data-plugin="tasks"` wrapper.
 */
export function TasksPage(): ReactElement {
  return (
    <TasksProvider>
      <div data-plugin='tasks'>
        <div className='flex flex-wrap items-end justify-between gap-2'>
          <div>
            <h2 className='text-2xl font-bold tracking-tight'>Tasks</h2>
            <p className='text-muted-foreground'>
              Here&apos;s a list of your tasks for this month!
            </p>
          </div>
          <TasksPrimaryButtons />
        </div>
        <TasksTable data={tasks} />
        <TasksDialogs />
      </div>
    </TasksProvider>
  )
}
