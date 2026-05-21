/**
 * PhosphorSidebar — route-scoped flat sidebar for the Phosphor dashboard.
 *
 * This component is used by the dashboard route's PhosphorLayout. It owns the
 * Phosphor visual sidebar treatment, while dashboard module entries come from
 * the shared remote-dashboard metadata so they stay aligned with shell routing.
 */
import type { ReactElement } from 'react'
import { Link, useLocation } from '@tanstack/react-router'
import {
  remoteDashboardHref,
  remoteDashboardMetadata,
} from '@/shell/remote-dashboard-metadata'

interface NavItem {
  readonly label: string
  readonly href: string
  readonly activePrefix?: string
}

interface NavSection {
  readonly title: string
  readonly items: readonly NavItem[]
}

const REMOTE_DASHBOARD_NAV_ITEMS: readonly NavItem[] =
  remoteDashboardMetadata.map((dashboard) => ({
    label: dashboard.name,
    href: remoteDashboardHref(dashboard, dashboard.defaultRoutePath),
    activePrefix: dashboard.basePath,
  }))

const NAV_SECTIONS: readonly NavSection[] = [
  {
    title: 'Dashboards',
    items: REMOTE_DASHBOARD_NAV_ITEMS,
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
            const isActive = isNavItemActive(pathname, item)
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

      <div className='sidebar-footer'>Local User</div>
    </>
  )
}

function isNavItemActive(pathname: string, item: NavItem) {
  if (item.href === '/') return pathname === '/'

  const activePrefix = item.activePrefix ?? item.href
  return pathname === activePrefix || pathname.startsWith(`${activePrefix}/`)
}
