/**
 * Dashboard route entry point — Phosphor Atlas shell.
 *
 * Composes the PhosphorLayout shell chrome with Wave 2 components.
 * KpiStrip summary and AlertsRail alerts will be wired to real data in
 * Waves 4-6; Wave 2 passes stubs so the layout renders correctly.
 */
import { useState, type ReactElement } from 'react'
import { ConfigDrawer } from '@/components/config-drawer'
import { ProfileDropdown } from '@/components/profile-dropdown'
import { Search } from '@/components/search'
import { AlertsRail } from './components/alerts-rail'
import AnchorBar from './components/anchor-bar'
import { KpiStrip } from './components/kpi-strip'
import { PhosphorLayout } from './components/phosphor-layout'
import { UsageReportDashboard } from './components/usage-report-dashboard'

/**
 * Dashboard is the root component for the /usage route.
 *
 * It wires the PhosphorLayout chrome around UsageReportDashboard.
 */
export function Dashboard(): ReactElement {
  const [activeSection, setActiveSection] = useState('status')

  return (
    <PhosphorLayout
      sidebar={
        <div
          className='phosphor-sidebar'
          style={{ padding: '1rem', background: 'var(--card)' }}
        >
          {/* Sidebar navigation — wired in Wave 5 */}
          <div style={{ color: 'var(--fg-muted)', fontSize: '0.75rem' }}>
            Navigation
          </div>
        </div>
      }
      header={
        <div
          style={{
            padding: '0.75rem 1rem',
            borderBottom: '1px solid var(--border)',
          }}
        >
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
            }}
          >
            <h1
              className='phosphor-title'
              style={{
                margin: 0,
                fontSize: '1.25rem',
                color: 'var(--accent-chrome)',
              }}
            >
              Phosphor Atlas
            </h1>
            <div
              style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}
            >
              <Search />
              <ConfigDrawer />
              <ProfileDropdown />
            </div>
          </div>
          {/* KpiStrip — real data wired in Wave 4 */}
          <KpiStrip summary={undefined} loading={true} />
          <AnchorBar
            activeSection={activeSection}
            onSectionChange={setActiveSection}
          />
        </div>
      }
      main={<UsageReportDashboard />}
      alerts={<AlertsRail alerts={[]} />}
    />
  )
}
