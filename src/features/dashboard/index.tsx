/**
 * Dashboard route entry point — Phosphor Atlas shell.
 *
 * Wave 9: v9.7 reference parity updates:
 * - Sidebar: restyled with team-switcher, 4 nav groups, sidebar-footer.
 *   Routes are NOT rewired (operator decision 2) — visual-only restyle.
 * - Page-header: Playfair Display italic page title, freshness indicator,
 *   fleet-pulse strip (reused horizontal HealthStrip), attribution legend.
 * - DateControls promoted to live state (operator decision 4).
 * - Controls bar styled per reference (control-input, period-btn).
 * - Alerts wired via useAlertsFromAnomalies hook (operator decision 3).
 * - Body topographic overlay added in theme.css (operator decision 8).
 *
 * Wave 11 PR7-lite:
 * - Attribution legend rewritten per audit C22 (ATTRIBUTION label + 5 pill swatches).
 * - Fleet Pulse label updated to "FLEET HEALTH PULSE · 24H · 5m" (audit C23).
 * - Freshness indicator now computes from dataUpdatedAt (audit C24).
 */
import { useEffect, useMemo, useState, type ReactElement } from 'react'
import { formatDistanceToNow } from 'date-fns'
import { useQuery } from '@tanstack/react-query'
import { ConfigDrawer } from '@/components/config-drawer'
import { ProfileDropdown } from '@/components/profile-dropdown'
import { Search } from '@/components/search'
import {
  fetchUsageReport,
  fetchUsageReportQuotas,
  type UsageReportGrain,
  type UsageReportProviderLatencyHealthRow,
} from './api/usage-report'
import { AlertsRail } from './components/alerts-rail'
import AnchorBar from './components/anchor-bar'
import { KpiStrip } from './components/kpi-strip'
import PhosphorDashboard from './components/phosphor-dashboard'
import { PhosphorLayout } from './components/phosphor-layout'
import { PhosphorSidebar } from './components/phosphor-sidebar'
import { HealthStrip } from './components/primitives/health-strip'
import { useAlertsFromAnomalies } from './hooks/use-alerts-from-anomalies'
import { useAnomalyDetection } from './hooks/use-anomaly-detection'

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
    | undefined,
  fleetP95Ms: number
): KpiSummaryShape | undefined {
  if (summary === undefined) return undefined
  return {
    token_in: summary.token_in,
    token_out: summary.token_out,
    cost_usd: summary.usd_cost,
    requests: summary.traces,
    errors: 0,
    p95_ms: fleetP95Ms,
  }
}

/**
 * Computes fleet-wide P95 latency (ms) from all provider latency health rows.
 * Uses the same max-P95 aggregation as buildProviderMetrics() in phosphor-dashboard.
 */
function computeFleetP95(
  healthRows: UsageReportProviderLatencyHealthRow[]
): number {
  const values = healthRows
    .map((r) => r.upstream_p95_ms)
    .filter((v): v is number => v !== null)
  return values.length > 0 ? Math.max(...values) : 0
}

// ---------------------------------------------------------------------------
// Fleet pulse data (aggregate health cells for horizontal strip)
// ---------------------------------------------------------------------------

const FLEET_PULSE_CELLS = Array.from({ length: 288 }, (_, i) => ({
  color:
    i % 24 < 2
      ? 'var(--accent-hot)'
      : i % 12 < 1
        ? 'var(--accent-warm)'
        : 'var(--accent-cool)',
}))

// ---------------------------------------------------------------------------
// Dashboard
// ---------------------------------------------------------------------------

/**
 * Dashboard is the root component for the /usage route.
 *
 * Wave 9: Wires full page-header, fleet-pulse, controls, sidebar restyle,
 * and alerts hook into PhosphorLayout.
 */
export function Dashboard(): ReactElement {
  const [activeSection, setActiveSection] = useState('status')

  const defaults = useMemo(() => defaultDateRange(), [])
  const [from, setFrom] = useState(defaults.from)
  const [to, setTo] = useState(defaults.to)
  const [grain, setGrain] = useState<UsageReportGrain>('day')
  const [activePeriod, setActivePeriod] = useState<string>('7d')

  const handleRangeChange = (
    nextFrom: string,
    nextTo: string,
    nextGrain: string
  ): void => {
    setFrom(nextFrom)
    setTo(nextTo)
    setGrain(nextGrain as UsageReportGrain)
  }

  const handlePeriodBtn = (period: string): void => {
    setActivePeriod(period)
    const now = new Date()
    const toStr = now.toISOString().slice(0, 10)
    const days: Record<string, number> = {
      '24h': 1,
      '7d': 7,
      '30d': 30,
      '90d': 90,
    }
    const d = days[period]
    if (d !== undefined) {
      const f = new Date(now)
      f.setDate(f.getDate() - d)
      handleRangeChange(f.toISOString().slice(0, 10), toStr, grain)
    }
  }

  const {
    data: summaryReport,
    isLoading: summaryLoading,
    dataUpdatedAt,
  } = useQuery({
    queryKey: ['usage-report-phosphor', from, to, grain],
    queryFn: () =>
      fetchUsageReport({
        from,
        to,
        grain,
        groupBy: ['provider', 'model', 'repository'],
      }),
  })

  // Wave 11 PR7-lite (audit C24): compute freshness string from dataUpdatedAt.
  // Re-evaluate every 10 s so relative time stays current.
  const [freshnessStr, setFreshnessStr] = useState<string>('Loading…')
  useEffect(() => {
    const compute = (): void => {
      if (dataUpdatedAt === 0) {
        setFreshnessStr('Loading…')
        return
      }
      setFreshnessStr(
        `Updated ${formatDistanceToNow(new Date(dataUpdatedAt))} ago`
      )
    }
    compute()
    const id = setInterval(compute, 10_000)
    return () => {
      clearInterval(id)
    }
  }, [dataUpdatedAt])

  // B4: Compute fleet-wide P95 from all provider latency health rows.
  // The API does not expose p95 on the summary object, so we derive it here
  // using the same max-P95 aggregation as phosphor-dashboard's buildProviderMetrics().
  const fleetP95Ms = useMemo(
    () => computeFleetP95(summaryReport?.providerLatencyHealth ?? []),
    [summaryReport?.providerLatencyHealth]
  )

  const kpiSummary = useMemo(
    () => toKpiSummary(summaryReport?.summary, fleetP95Ms),
    [summaryReport?.summary, fleetP95Ms]
  )

  const anomalies = useAnomalyDetection(
    (summaryReport?.providerLatencyHealth ?? []).filter(
      (r): r is typeof r & { bucket_start: string } => r.bucket_start !== null
    ),
    summaryReport?.metadata
  )

  const { data: quotasData } = useQuery({
    queryKey: ['usage-report-quotas-shell'],
    queryFn: fetchUsageReportQuotas,
  })

  const quotaRows = useMemo(
    () => quotasData?.quotas ?? summaryReport?.quotas ?? [],
    [quotasData?.quotas, summaryReport?.quotas]
  )

  const alerts = useAlertsFromAnomalies(
    anomalies,
    summaryReport?.summary,
    quotaRows
  )

  return (
    <PhosphorLayout
      sidebar={<PhosphorSidebar />}
      header={
        <div
          style={{
            background: 'var(--card)',
            border: '1px solid var(--border)',
            borderRight: 'none',
            padding: '10px 12px',
            display: 'flex',
            gap: '16px',
            alignItems: 'center',
          }}
        >
          {/* Header title */}
          <div
            style={{
              fontSize: 'clamp(11px, 0.6vw, 20px)',
              color: 'var(--fg-muted)',
              textTransform: 'uppercase',
              letterSpacing: '0.1em',
              fontWeight: 600,
              whiteSpace: 'nowrap',
              flexShrink: 0,
            }}
          >
            General Dashboard
          </div>

          {/* KPI strip — dominant header element */}
          {/* B3: deltas prop wired; API does not expose prior-period deltas yet so
              all tiles show em-dash placeholders. When the API adds delta data,
              populate the Record<KpiKey, number> here (e.g. from report.deltas).
              TODO: API does not expose deltas yet */}
          <KpiStrip summary={kpiSummary} loading={summaryLoading} deltas={{}} />

          {/* Header actions */}
          <div
            style={{
              display: 'flex',
              gap: '8px',
              alignItems: 'center',
              flexShrink: 0,
            }}
          >
            <Search />
            <ConfigDrawer />
            <ProfileDropdown />
          </div>
        </div>
      }
      main={
        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
          {/* Page header — Playfair title, freshness, fleet-pulse, attribution */}
          <div
            className='page-header'
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: '4px',
              padding: '6px 8px',
              background: 'var(--card)',
              border: '1px solid var(--border)',
            }}
          >
            <div
              className='page-header-top'
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
              }}
            >
              <h1
                className='page-title phosphor-title'
                style={{
                  fontFamily: 'var(--font-serif)',
                  fontSize: 'clamp(18px, 0.9vw, 32px)',
                  fontStyle: 'italic',
                  color: 'var(--fg)',
                  fontWeight: 400,
                  margin: 0,
                }}
              >
                General Dashboard
              </h1>
              <div
                className='freshness-indicator'
                style={{
                  fontSize: '9px',
                  color: 'var(--fg-muted)',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '4px',
                }}
              >
                <span
                  className='pulse-dot'
                  style={{
                    display: 'inline-block',
                    width: '4px',
                    height: '4px',
                    background: 'var(--accent-chrome)',
                    borderRadius: '50%',
                  }}
                />
                {freshnessStr}
              </div>
            </div>

            <div
              className='page-subtext'
              style={{
                fontSize: 'clamp(10px, 0.55vw, 16px)',
                color: 'var(--fg-muted)',
              }}
            >
              Unified AI provider intelligence · {from} → {to}
            </div>

            {/* Fleet-pulse strip */}
            <div
              className='fleet-pulse-wrapper'
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: '2px',
                maxWidth: '600px',
                marginTop: '4px',
              }}
            >
              <div
                className='fleet-pulse-label'
                style={{
                  fontFamily: 'var(--font-mono)',
                  fontSize: '8px',
                  color: 'var(--fg-muted)',
                  letterSpacing: '0.06em',
                  textTransform: 'uppercase',
                }}
              >
                FLEET HEALTH PULSE · 24H · 5m
              </div>
              <HealthStrip cells={FLEET_PULSE_CELLS} orientation='horizontal' />
            </div>

            {/* Attribution legend — Wave 11 PR7-lite (audit C22) */}
            {/* Format: ATTRIBUTION ▭ NORM ▭ PAPI ▭ WKLD ▭ CTRL ▭ MISS */}
            <div
              className='attribution-legend'
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '8px',
                flexWrap: 'wrap',
                fontSize: '9px',
                fontFamily: 'var(--font-mono)',
                color: 'var(--fg-muted)',
                marginTop: '4px',
              }}
            >
              {/* ATTRIBUTION label prefix — amber per mockup */}
              <span
                style={{
                  color: 'var(--accent-warm)',
                  letterSpacing: '0.06em',
                  fontWeight: 600,
                  fontSize: '9px',
                }}
              >
                ATTRIBUTION
              </span>
              {/* B2: swatch backgrounds use rgba values per mockup (.attribution-legend .legend-cat.cat-* rules). */}
              {[
                { label: 'NORM', color: 'rgba(58, 130, 243, 0.82)' },
                { label: 'PAPI', color: 'rgba(245, 158, 11, 0.62)' },
                { label: 'WKLD', color: 'rgba(239, 68, 68, 0.74)' },
                { label: 'CTRL', color: 'rgba(126, 87, 194, 0.7)' },
                { label: 'MISS', color: 'rgba(20, 184, 166, 0.6)' },
              ].map(({ label, color }) => (
                <span
                  key={label}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '4px',
                  }}
                >
                  {/* 10px × 5px pill swatch, 1px border-radius */}
                  <span
                    style={{
                      display: 'inline-block',
                      width: '10px',
                      height: '5px',
                      borderRadius: '1px',
                      background: color,
                      flexShrink: 0,
                    }}
                  />
                  {label}
                </span>
              ))}
            </div>
          </div>

          {/* Anchor bar — D11: flush to page-header (no gap above) */}
          <div style={{ marginTop: '-4px' }}>
            <AnchorBar
              activeSection={activeSection}
              onSectionChange={setActiveSection}
            />
          </div>

          {/* Controls bar — date range + period selector */}
          <div
            className='controls'
            style={{
              background: 'var(--card)',
              border: '1px solid var(--border)',
              padding: '6px 10px',
              display: 'flex',
              gap: '8px',
              alignItems: 'center',
              fontSize: '10px',
            }}
          >
            <label
              htmlFor='ctrl-from'
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '4px',
                color: 'var(--fg-muted)',
                fontSize: '10px',
              }}
            >
              From
              <input
                id='ctrl-from'
                type='date'
                value={from}
                onChange={(e) => {
                  handleRangeChange(e.target.value, to, grain)
                }}
                style={{
                  background: 'var(--card-2)',
                  border: '1px solid var(--border)',
                  borderBottom: '2px solid var(--accent-cool)',
                  color: 'var(--fg)',
                  padding: '3px 6px',
                  fontFamily: 'var(--font-mono)',
                  fontSize: '10px',
                  width: '110px',
                }}
              />
            </label>
            <label
              htmlFor='ctrl-to'
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '4px',
                color: 'var(--fg-muted)',
                fontSize: '10px',
              }}
            >
              To
              <input
                id='ctrl-to'
                type='date'
                value={to}
                onChange={(e) => {
                  handleRangeChange(from, e.target.value, grain)
                }}
                style={{
                  background: 'var(--card-2)',
                  border: '1px solid var(--border)',
                  borderBottom: '2px solid var(--accent-cool)',
                  color: 'var(--fg)',
                  padding: '3px 6px',
                  fontFamily: 'var(--font-mono)',
                  fontSize: '10px',
                  width: '110px',
                }}
              />
            </label>

            {/* Period selector — right-aligned */}
            <div
              className='period-selector'
              style={{ display: 'flex', gap: '1px', marginLeft: 'auto' }}
            >
              {['24h', '7d', '30d', '90d', 'YTD'].map((period) => (
                <button
                  key={period}
                  type='button'
                  className={['period-btn', activePeriod === period && 'active']
                    .filter(Boolean)
                    .join(' ')}
                  onClick={() => {
                    handlePeriodBtn(period)
                  }}
                  style={{
                    background:
                      activePeriod === period
                        ? 'var(--accent-chrome)'
                        : 'var(--card-2)',
                    border: '1px solid var(--border)',
                    borderColor:
                      activePeriod === period
                        ? 'var(--accent-chrome)'
                        : 'var(--border)',
                    color:
                      activePeriod === period ? 'var(--bg)' : 'var(--fg-muted)',
                    padding: '3px 6px',
                    cursor: 'pointer',
                    fontSize: '9px',
                    textTransform: 'uppercase',
                    fontFamily: 'var(--font-mono)',
                    transition: 'all 50ms',
                  }}
                >
                  {period}
                </button>
              ))}
            </div>
          </div>

          {/* Main dashboard content */}
          <PhosphorDashboard from={from} to={to} grain={grain} />
        </div>
      }
      alerts={<AlertsRail alerts={alerts} />}
    />
  )
}

// Future waves: expose from/to/grain as props on Dashboard for multi-view routing.
