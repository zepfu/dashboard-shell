/**
 * Dashboard route entry point — Phosphor Atlas shell.
 *
 * Wave 8: Wires PhosphorDashboard into the main slot, replacing the legacy
 * UsageReportDashboard stub. Date controls state (from/to/grain) is managed
 * here and passed down to both KpiStrip and PhosphorDashboard. The legacy
 * UsageReportDashboard is kept as a fallback import and is NOT rendered; it
 * can be pruned once PhosphorDashboard is proven stable (Wave 9 cleanup).
 */
import { useMemo, useState, type ReactElement } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ConfigDrawer } from '@/components/config-drawer'
import { ProfileDropdown } from '@/components/profile-dropdown'
import { Search } from '@/components/search'
import { fetchUsageReport, type UsageReportGrain } from './api/usage-report'
import { AlertsRail } from './components/alerts-rail'
import AnchorBar from './components/anchor-bar'
import { KpiStrip } from './components/kpi-strip'
import PhosphorDashboard from './components/phosphor-dashboard'
import { PhosphorLayout } from './components/phosphor-layout'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function defaultDateRange(): { from: string; to: string } {
  const now = new Date()
  const from = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - 6)
  )
  const to = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1)
  )
  return {
    from: from.toISOString().slice(0, 10),
    to: to.toISOString().slice(0, 10),
  }
}

// ---------------------------------------------------------------------------
// KpiStrip summary adapter
// ---------------------------------------------------------------------------

/** KpiStrip expects cost_usd / requests / errors / p95_ms — adapt from the
 *  usage report summary which uses usd_cost / traces. The `requests` field is
 *  approximated from traces; errors and p95_ms are not in the summary so they
 *  are zeroed (PhosphorDashboard ProviderCards show per-provider health). */
interface KpiSummaryShape {
  token_in: number
  token_out: number
  cost_usd: number
  requests: number
  errors: number
  p95_ms: number
}

function toKpiSummary(
  summary:
    | { token_in: number; token_out: number; usd_cost: number; traces: number }
    | undefined
): KpiSummaryShape | undefined {
  if (summary === undefined) return undefined
  return {
    token_in: summary.token_in,
    token_out: summary.token_out,
    cost_usd: summary.usd_cost,
    requests: summary.traces,
    errors: 0,
    p95_ms: 0,
  }
}

// ---------------------------------------------------------------------------
// Dashboard
// ---------------------------------------------------------------------------

/**
 * Dashboard is the root component for the /usage route.
 *
 * It wires the PhosphorLayout chrome around PhosphorDashboard (Wave 8),
 * manages date-range/grain state for both KpiStrip and the main content,
 * and passes anomaly-aware data down to the new component tree.
 */
export function Dashboard(): ReactElement {
  const [activeSection, setActiveSection] = useState('status')

  const defaults = useMemo(() => defaultDateRange(), [])
  const [from, _setFrom] = useState(defaults.from)
  const [to, _setTo] = useState(defaults.to)
  const [grain, _setGrain] = useState<UsageReportGrain>('day')

  // Fetch summary here so KpiStrip can receive live data without PhosphorDashboard
  // needing to lift state. PhosphorDashboard runs its own query (same queryKey
  // → shared React Query cache, no double network request).
  const { data: summaryReport, isLoading: summaryLoading } = useQuery({
    queryKey: ['usage-report-phosphor', from, to, grain],
    queryFn: () =>
      fetchUsageReport({
        from,
        to,
        grain,
        groupBy: ['provider', 'model', 'repository'],
      }),
  })

  const kpiSummary = useMemo(
    () => toKpiSummary(summaryReport?.summary),
    [summaryReport?.summary]
  )

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
          <KpiStrip summary={kpiSummary} loading={summaryLoading} />
          <AnchorBar
            activeSection={activeSection}
            onSectionChange={setActiveSection}
          />
        </div>
      }
      main={<PhosphorDashboard from={from} to={to} grain={grain} />}
      alerts={<AlertsRail alerts={[]} />}
    />
  )
}

// Future waves: expose from/to/grain as props on Dashboard for multi-view
// routing. Currently managed as internal state with _setFrom/_setTo/_setGrain
// stubs ready for promotion without lint violations.
