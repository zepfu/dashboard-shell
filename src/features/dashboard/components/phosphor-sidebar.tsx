/**
 * PhosphorSidebar — route-scoped flat sidebar for the Phosphor dashboard.
 *
 * This component is used by the dashboard route's PhosphorLayout. It owns the
 * Phosphor visual sidebar treatment, while dashboard module entries come from
 * the shared remote-dashboard metadata so they stay aligned with shell routing.
 */
import { useEffect, useState, type ReactElement } from 'react'
import { Link, useLocation } from '@tanstack/react-router'
import {
  remoteDashboardHref,
  remoteDashboardMetadata,
} from '@/shell/remote-dashboard-metadata'
import { SidebarProvider } from '@/components/ui/sidebar'
import { SidebarQuotaRemaining } from '@/components/layout/sidebar-quota-remaining'
import type {
  UsageReportProviderLatencyHealthRow,
  UsageReportQuotaRow,
} from '../api/usage-report'
import {
  useDashboardAlertSummary,
  type DashboardAlertSummary,
} from '../hooks/use-alerts-from-anomalies'
import { HoverTooltip } from './primitives/hover-tooltip'

interface NavItem {
  readonly label: string
  readonly href: string
  readonly activePrefix?: string
}

interface NavSection {
  readonly title: string
  readonly items: readonly NavItem[]
}

interface PhosphorSidebarProps {
  dashboardAlerts?: DashboardAlertSummary
  alertInput?: {
    anomalies: Parameters<typeof useDashboardAlertSummary>[0]
    summary?: Parameters<typeof useDashboardAlertSummary>[1]
    quotas?: UsageReportQuotaRow[]
    providerErrorObservations?: Parameters<typeof useDashboardAlertSummary>[3]
    dockerLogErrors?: Parameters<typeof useDashboardAlertSummary>[4]
    providerLatencyHealth?: UsageReportProviderLatencyHealthRow[]
  }
}

const ALERT_CLOCK_INTERVAL_MS = 10_000

function DashboardSidebarAlerts({
  input,
  pathname,
}: {
  input: NonNullable<PhosphorSidebarProps['alertInput']>
  pathname: string
}): ReactElement {
  const [now, setNow] = useState(() => new Date())

  useEffect(() => {
    const id = setInterval(() => {
      setNow(new Date())
    }, ALERT_CLOCK_INTERVAL_MS)
    return () => {
      clearInterval(id)
    }
  }, [])

  const dashboardAlerts = useDashboardAlertSummary(
    input.anomalies,
    input.summary,
    input.quotas,
    input.providerErrorObservations,
    input.dockerLogErrors,
    input.providerLatencyHealth,
    now
  )

  return <PhosphorSidebarShell {...{ dashboardAlerts, pathname }} />
}

function PhosphorSidebarShell({
  dashboardAlerts,
  pathname,
}: {
  dashboardAlerts?: DashboardAlertSummary
  pathname: string
}): ReactElement {
  return (
    <>
      <div className='sidebar-team-switcher'>Dashboard Shell ▼</div>

      {NAV_SECTIONS.map((section) => (
        <div key={section.title} className='sidebar-section'>
          <div className='sidebar-group-title'>{section.title}</div>
          {section.items.map((item) => {
            const isActive = isNavItemActive(pathname, item)
            const isDashboard = item.href === '/'
            return (
              <Link
                key={item.href}
                to={item.href}
                className={[
                  'sidebar-item',
                  isDashboard ? 'sidebar-item-dashboard' : '',
                  isActive ? 'active' : '',
                ]
                  .filter(Boolean)
                  .join(' ')}
              >
                <span className='sidebar-item-label'>{item.label}</span>
                {isDashboard && dashboardAlerts !== undefined ? (
                  <SidebarAlertDot alerts={dashboardAlerts} />
                ) : null}
              </Link>
            )
          })}
        </div>
      ))}

      <div className='sidebar-section'>
        <div className='sidebar-group-title'>Quota remaining</div>
        <SidebarProvider>
          <SidebarQuotaRemaining />
        </SidebarProvider>
      </div>

      <div className='sidebar-footer'>Local User</div>
    </>
  )
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

export function PhosphorSidebar({
  dashboardAlerts,
  alertInput,
}: PhosphorSidebarProps): ReactElement {
  const location = useLocation()
  const pathname = location.pathname

  if (dashboardAlerts === undefined && alertInput !== undefined) {
    return <DashboardSidebarAlerts input={alertInput} pathname={pathname} />
  }

  return <PhosphorSidebarShell {...{ dashboardAlerts, pathname }} />
}

function SidebarAlertDot({
  alerts,
}: {
  alerts: DashboardAlertSummary
}): ReactElement {
  const [issuesExpanded, setIssuesExpanded] = useState(false)

  const tooltipContent = (
    <div className='sidebar-alert-tip'>
      <div className='v9-tip-head'>
        Dashboard Alerts
        <span className={`sidebar-alert-tip-status ${alerts.severity}`}>
          {alerts.severity === 'ok'
            ? 'OK'
            : alerts.severity === 'error'
              ? 'Errors'
              : 'Warnings'}
        </span>
      </div>
      {alerts.issues.length === 0 ? (
        <div className='v9-tip-row'>No active issues</div>
      ) : (
        <div className='sidebar-alert-tip-list'>
          {alerts.issues.map((issue, index) => (
            <div
              key={`${issue.severity}-${issue.head}-${index.toString()}`}
              className={`sidebar-alert-tip-row ${issue.severity}`}
            >
              <div className='sidebar-alert-tip-row-head'>{issue.head}</div>
              {issue.sub !== undefined ? (
                <div className='sidebar-alert-tip-row-sub'>{issue.sub}</div>
              ) : null}
            </div>
          ))}
        </div>
      )}
    </div>
  )

  const issueCount = alerts.issues.length

  return (
    <>
      <HoverTooltip
        content={() => tooltipContent}
        panelStyle={{
          minWidth: '260px',
          maxWidth: 'min(420px, calc(100vw - 16px))',
        }}
      >
        <span
          aria-label={`Dashboard alert status: ${alerts.severity}`}
          className={`sidebar-alert-dot ${alerts.severity}`}
          role='status'
        />
      </HoverTooltip>
      {issueCount > 0 ? (
        <>
          <button
            type='button'
            className='sidebar-alert-issues-disclosure'
            aria-label={`${issueCount.toString()} alert issues — expand for details`}
            aria-expanded={issuesExpanded}
            aria-controls='sidebar-alert-issues-panel'
            onClick={() => {
              setIssuesExpanded((open) => !open)
            }}
          >
            {issueCount.toString()}
          </button>
          {issuesExpanded ? (
            <div
              id='sidebar-alert-issues-panel'
              role='region'
              aria-label='Alert issue details'
              className='sidebar-alert-issues-panel'
            >
              {alerts.issues.map((issue, index) => (
                <div
                  key={`${issue.severity}-${issue.head}-${index.toString()}`}
                  className={`sidebar-alert-tip-row ${issue.severity}`}
                >
                  <div className='sidebar-alert-tip-row-head'>{issue.head}</div>
                  {issue.sub !== undefined ? (
                    <div className='sidebar-alert-tip-row-sub'>{issue.sub}</div>
                  ) : null}
                </div>
              ))}
            </div>
          ) : null}
        </>
      ) : null}
    </>
  )
}

function isNavItemActive(pathname: string, item: NavItem) {
  if (item.href === '/') return pathname === '/'

  const activePrefix = item.activePrefix ?? item.href
  return pathname === activePrefix || pathname.startsWith(`${activePrefix}/`)
}
