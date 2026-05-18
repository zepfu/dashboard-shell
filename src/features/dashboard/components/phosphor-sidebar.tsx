/**
 * PhosphorSidebar — route-scoped flat sidebar for Phosphor Atlas dashboard.
 *
 * Wave 14-A: NEW component.
 *
 * Renders a flat `<aside class="sidebar">` matching mockup lines 127-193 and
 * 2264-2298 verbatim. This component is ONLY used on the dashboard route.
 * All other routes continue to use the host AppSidebar.
 *
 * Structure (per mockup lines 2264-2298):
 * - sidebar-team-switcher (team name)
 * - sidebar-section × 4: Dashboards, General, Pages, Other
 * - sidebar-footer (user display)
 *
 * Routing: items are TanStack Router <Link> elements pointing to the same
 * URLs as the host AppSidebar. Active item is detected via useLocation().
 *
 * CSS rules for .sidebar, .sidebar-section, etc. live in src/styles/index.css
 * in the "Wave 14-A: Phosphor sidebar" block.
 */
import type { ReactElement } from 'react'
import { Link, useLocation } from '@tanstack/react-router'

// ---------------------------------------------------------------------------
// Nav data matching mockup lines 2264-2298
// ---------------------------------------------------------------------------

interface NavItem {
  readonly label: string
  readonly href: string
}

interface NavSection {
  readonly title: string
  readonly items: readonly NavItem[]
}

const NAV_SECTIONS: readonly NavSection[] = [
  {
    title: 'Dashboards',
    items: [
      { label: 'Overview', href: '/aawm-tap/overview' },
      { label: 'Processes', href: '/aawm-tap/processes' },
      { label: 'Watchlist', href: '/aawm-tap/watchlist' },
    ],
  },
  {
    title: 'General',
    items: [
      { label: 'Dashboard', href: '/' },
      { label: 'Apps', href: '/apps' },
      { label: 'Chats', href: '/chats' },
      { label: 'Tasks', href: '/tasks' },
      { label: 'Users', href: '/users' },
    ],
  },
  {
    title: 'Pages',
    items: [
      { label: 'Auth', href: '/sign-in' },
      { label: 'Errors', href: '/errors/not-found' },
    ],
  },
  {
    title: 'Other',
    items: [
      { label: 'Settings', href: '/settings' },
      { label: 'Help Center', href: '/help-center' },
    ],
  },
] as const

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * PhosphorSidebar renders the Phosphor Atlas flat left sidebar.
 *
 * Used exclusively on the dashboard (`/`) route. The host AppSidebar is
 * suppressed on this route via AuthenticatedLayout's isDashboard check.
 */
export function PhosphorSidebar(): ReactElement {
  const location = useLocation()
  const pathname = location.pathname

  return (
    <>
      <div className='sidebar-team-switcher'>Dashboard Shell ▼</div>

      {NAV_SECTIONS.map((section) => (
        <div key={section.title} className='sidebar-section'>
          <div className='sidebar-group-title'>{section.title}</div>
          {section.items.map((item) => {
            const isActive =
              item.href === '/'
                ? pathname === '/'
                : pathname.startsWith(item.href)
            return (
              <Link
                key={item.href}
                to={item.href}
                className={['sidebar-item', isActive ? 'active' : '']
                  .filter(Boolean)
                  .join(' ')}
              >
                {item.label}
              </Link>
            )
          })}
        </div>
      ))}

      <div className='sidebar-footer'>👤 Local User</div>
    </>
  )
}
