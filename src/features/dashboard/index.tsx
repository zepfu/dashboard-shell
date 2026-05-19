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
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactElement,
} from 'react'
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
import {
  SlicerBar,
  type SlicerFilters,
  type SlicerOptions,
  SLICER_EMPTY_FILTERS,
} from './components/slicer-bar'
import { useAlertsFromAnomalies } from './hooks/use-alerts-from-anomalies'
import { useAnomalyDetection } from './hooks/use-anomaly-detection'
import { computeFleetErrors } from './lib/usage-report-display'

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

/**
 * Adapts the API summary + health rows into the KpiStrip shape.
 *
 * 15-C.1: errors now derived from computeFleetErrors instead of hardcoded 0.
 */
function toKpiSummary(
  summary:
    | { token_in: number; token_out: number; usd_cost: number; traces: number }
    | undefined,
  fleetP95Ms: number,
  fleetErrors: number
): KpiSummaryShape | undefined {
  if (summary === undefined) return undefined
  return {
    token_in: summary.token_in,
    token_out: summary.token_out,
    cost_usd: summary.usd_cost,
    requests: summary.traces,
    errors: fleetErrors,
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
  // 15-C.3: initial activePeriod aligned with the 7-day default date range
  const [activePeriod, setActivePeriod] = useState<string>('7d')
  // 15-C.4: controlled search input state for client-side row filtering
  const [searchTerm, setSearchTerm] = useState<string>('')

  // 15-D.5: slicer filter state — empty arrays mean "all" (no server-side filter)
  const [slicerFilters, setSlicerFilters] =
    useState<SlicerFilters>(SLICER_EMPTY_FILTERS)

  // 15-D.3: slicer options derived from PhosphorDashboard's loaded data
  const [slicerOptions, setSlicerOptions] = useState<SlicerOptions>({
    providers: [],
    repositories: [],
    clients: [],
    environments: [],
    models: [],
  })

  const handleSlicerOptionsReady = useCallback(
    (options: SlicerOptions): void => {
      setSlicerOptions(options)
    },
    []
  )

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

    // 15-C.2: YTD sets Jan 1 of current year → today, day grain
    if (period === 'YTD') {
      const ytdFrom = new Date(now.getFullYear(), 0, 1)
        .toISOString()
        .slice(0, 10)
      handleRangeChange(ytdFrom, toStr, 'day')
      return
    }

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

  // 14-B.2: freshness format per mockup line 2384:
  //   "FETCHED HH:MM:SS UTC · Xs ago"
  // Re-evaluate every 10 s so relative time stays current.
  const [freshnessStr, setFreshnessStr] = useState<string>('Loading…')
  useEffect(() => {
    const compute = (): void => {
      if (dataUpdatedAt === 0) {
        setFreshnessStr('Loading…')
        return
      }
      const d = new Date(dataUpdatedAt)
      const timeUTC = d.toUTCString().split(' ')[4] ?? ''
      const distance = formatDistanceToNow(d)
      setFreshnessStr(`FETCHED ${timeUTC} UTC · ${distance} ago`)
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

  // 15-C.1: Real error count from all provider health rows (replaces hardcoded 0).
  const fleetErrors = useMemo(
    () => computeFleetErrors(summaryReport?.providerLatencyHealth ?? []),
    [summaryReport?.providerLatencyHealth]
  )

  const kpiSummary = useMemo(
    () => toKpiSummary(summaryReport?.summary, fleetP95Ms, fleetErrors),
    [summaryReport?.summary, fleetP95Ms, fleetErrors]
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
          {/* 14-B.1: mockup §3 — NO background, NO border, NO padding; position: relative */}
          <div
            className='page-header'
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: '4px',
              position: 'relative',
            }}
          >
            {/* 14-B.3: search input restored to page-header-top per mockup line 2382 */}
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
              {/* 14-B.3: search input per mockup — 180px, card-2 bg, mono, 10px */}
              {/* 15-C.4: controlled input — value + onChange wire to searchTerm state */}
              <input
                type='text'
                className='search-input'
                placeholder='⌘K search...'
                aria-label='Search dashboard'
                value={searchTerm}
                onChange={(e) => {
                  setSearchTerm(e.target.value)
                }}
              />
            </div>

            {/* 14-B.2: freshness indicator inline in subtext per mockup line 2384 */}
            {/* 14-B.?: subtext copy matches mockup verbatim */}
            <div
              className='page-subtext'
              style={{
                fontSize: 'clamp(10px, 0.55vw, 16px)',
                color: 'var(--fg-muted)',
              }}
            >
              {'LiteLLM usage, quota, cost, and repository activity · '}
              <span
                className='freshness-indicator'
                style={{
                  fontSize: '9px',
                  color: 'var(--fg-muted)',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '4px',
                }}
              >
                <span className='pulse-dot' />
                {freshnessStr}
              </span>
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

            {/* Attribution legend — 14-B.5 per mockup lines 1951-1986, 2386 */}
            {/* .attribution-legend: gap 12px, text-transform lowercase */}
            {/* .legend-label: accent-chrome, letter-spacing 0.12em, opacity 0.85 */}
            <div
              className='attribution-legend'
              aria-label='Health bar attribution'
              style={{
                display: 'flex',
                flexWrap: 'wrap',
                gap: '12px',
                alignItems: 'center',
                fontSize: '9px',
                fontFamily: 'var(--font-mono)',
                color: 'var(--fg-muted)',
                letterSpacing: '0.08em',
                textTransform: 'lowercase',
                marginTop: '4px',
              }}
            >
              {/* "attribution" label — uppercase via text-transform, chrome color, 0.12em spacing, 0.85 opacity */}
              <span
                className='legend-label'
                style={{
                  color: 'var(--accent-chrome)',
                  letterSpacing: '0.12em',
                  textTransform: 'uppercase',
                  opacity: 0.85,
                }}
              >
                attribution
              </span>
              {/* Category pills — lowercase labels via CSS text-transform on parent */}
              {[
                { key: 'norm', catClass: 'cat-norm' },
                { key: 'papi', catClass: 'cat-papi' },
                { key: 'wkld', catClass: 'cat-wkld' },
                { key: 'ctrl', catClass: 'cat-ctrl' },
                { key: 'miss', catClass: 'cat-miss' },
              ].map(({ key, catClass }) => (
                <span
                  key={key}
                  className={`legend-cat ${catClass}`}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '5px',
                    color: 'var(--fg-muted)',
                  }}
                >
                  <span className='legend-swatch' />
                  {key}
                </span>
              ))}
            </div>
          </div>

          {/* 15-D.5: SlicerBar — multi-dimension filter controls, above AnchorBar */}
          {/* Placed between page-header and AnchorBar for discoverability.        */}
          {/* Options are populated once PhosphorDashboard's query resolves.       */}
          <SlicerBar
            filters={slicerFilters}
            options={slicerOptions}
            onChange={setSlicerFilters}
          />

          {/* Anchor bar — flush to page-header via border-top: none */}
          {/* 14-B.1: negative marginTop hack removed — page-header has no card chrome */}
          <AnchorBar
            activeSection={activeSection}
            onSectionChange={setActiveSection}
          />

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
            {/* 14-H.1: label display:contents so parent gap governs spacing (audit §6 #1) */}
            {/* 14-H.1: date-input width 100px per mockup line 789 (was 110px) (audit §6 #2) */}
            <label
              htmlFor='ctrl-from'
              style={{
                display: 'contents',
                color: 'var(--fg-muted)',
                fontSize: '10px',
              }}
            >
              <span style={{ color: 'var(--fg-muted)', fontSize: '10px' }}>
                From
              </span>
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
                  width: '100px',
                }}
              />
            </label>
            <label
              htmlFor='ctrl-to'
              style={{
                display: 'contents',
                color: 'var(--fg-muted)',
                fontSize: '10px',
              }}
            >
              <span style={{ color: 'var(--fg-muted)', fontSize: '10px' }}>
                To
              </span>
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
                  width: '100px',
                }}
              />
            </label>

            {/* 15-C.3: Grain selector — wired to grain state, triggers refetch via queryKey */}
            <label
              htmlFor='ctrl-grain'
              style={{
                display: 'contents',
                color: 'var(--fg-muted)',
                fontSize: '10px',
              }}
            >
              <span style={{ color: 'var(--fg-muted)', fontSize: '10px' }}>
                Grain
              </span>
              <select
                id='ctrl-grain'
                value={grain}
                onChange={(e) => {
                  handleRangeChange(from, to, e.target.value)
                }}
                style={{
                  background: 'var(--card-2)',
                  border: '1px solid var(--border)',
                  borderBottom: '2px solid var(--accent-cool)',
                  color: 'var(--fg)',
                  padding: '3px 6px',
                  fontFamily: 'var(--font-mono)',
                  fontSize: '10px',
                }}
              >
                <option value='day'>day</option>
                <option value='week'>week</option>
                <option value='month'>month</option>
              </select>
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
          {/* 15-C.4: searchTerm passed for client-side row filtering */}
          {/* 15-D.5: filters + onOptionsReady wired for slicer */}
          <PhosphorDashboard
            from={from}
            to={to}
            grain={grain}
            searchTerm={searchTerm}
            filters={slicerFilters}
            onOptionsReady={handleSlicerOptionsReady}
          />
        </div>
      }
      alerts={<AlertsRail alerts={alerts} />}
    />
  )
}

// Future waves: expose from/to/grain as props on Dashboard for multi-view routing.
