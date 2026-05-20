/**
 * Dashboard route entry point — Phosphor Atlas shell.
 *
 * Wave 9: v9.7 reference parity updates:
 * - Sidebar: restyled with team-switcher, 4 nav groups, sidebar-footer.
 *   Routes are NOT rewired (operator decision 2) — visual-only restyle.
 * - Page-header: Playfair Display italic page title, freshness indicator,
 *   fleet-pulse strip (reused horizontal HealthStrip), attribution legend.
 * - DateControls promoted to live state (operator decision 4).
 * - Controls bar styled per reference (control-input).
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
  type UsageReportSummary,
} from './api/usage-report'
import { AlertsRail } from './components/alerts-rail'
import AnchorBar from './components/anchor-bar'
import { computeDeltaPct } from './components/comparison-panel'
import { DateControls } from './components/date-controls'
import { KpiStrip } from './components/kpi-strip'
import PhosphorDashboard from './components/phosphor-dashboard'
import { PhosphorLayout } from './components/phosphor-layout'
import { PhosphorSidebar } from './components/phosphor-sidebar'
import { type CellDef, HealthStrip } from './components/primitives/health-strip'
import {
  SlicerBar,
  type SlicerFilters,
  type SlicerOptions,
  SLICER_EMPTY_FILTERS,
} from './components/slicer-bar'
import { useAlertsFromAnomalies } from './hooks/use-alerts-from-anomalies'
import { useAnomalyDetection } from './hooks/use-anomaly-detection'
import { computeFleetErrors, computeFleetP95 } from './lib/usage-report-display'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function defaultDateRange(): { from: string; to: string } {
  const now = new Date()
  // Wave 24-Index (operator F3): default range is 30 days back → today (UTC).
  // Reverts Wave 16-V 1-day default per operator decision.
  const from = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - 30)
  )
  // Server uses exclusive upper bound `< $2::date`; add 1 day so today's data is included.
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

// ---------------------------------------------------------------------------
// Fleet pulse data (aggregate health cells for horizontal strip)
// ---------------------------------------------------------------------------

/** Number of 5-minute buckets in a 24-hour health window (24 × 12). */
const FLEET_PULSE_CELL_COUNT = 288

/**
 * Derives fleet-wide health cells from `providerLatencyHealth` rows by
 * collapsing all providers into one cell per 5-minute bucket.
 *
 * B1 fix (wave34-data-flow-audit ✘-1): replaces the hardcoded static color
 * pattern with data-driven aggregation using the worst-status rule:
 *   red > orange > blue > green
 * where red = errors + no p95 (service down), orange = errors present,
 * blue = no p95 data, green = normal.
 *
 * Mirrors the per-bucket collapse logic in phosphor-dashboard's padHealthCells
 * without the provider filter, then pads/truncates to exactly 288 cells.
 */
function deriveFleetPulseCells(
  healthRows: UsageReportProviderLatencyHealthRow[]
): CellDef[] {
  // Group all rows by bucket_start (newest first, matching API order DESC).
  const bucketMap = new Map<string, UsageReportProviderLatencyHealthRow[]>()
  healthRows.forEach((row, idx) => {
    const key =
      row.bucket_start != null
        ? String(row.bucket_start)
        : `__missing_${idx.toString()}__`
    const group = bucketMap.get(key)
    if (group !== undefined) {
      group.push(row)
    } else {
      bucketMap.set(key, [row])
    }
  })

  // Emit one CellDef per bucket: aggregate p95 (max) and error counts (sum).
  const cellsDesc: CellDef[] = Array.from(bucketMap.values()).map((group) => {
    let maxP95: number | null = null
    let totalErrors = 0
    for (const r of group) {
      if (r.upstream_p95_ms !== null) {
        maxP95 =
          maxP95 === null
            ? r.upstream_p95_ms
            : Math.max(maxP95, r.upstream_p95_ms)
      }
      totalErrors +=
        r.provider_error_events +
        r.provider_5xx_events +
        r.provider_timeout_events +
        r.network_error_events +
        r.rate_limit_events +
        r.capacity_events
    }
    const bucketStart = group.find((r) => r.bucket_start != null)?.bucket_start

    return {
      color: 'var(--card-2)',
      bucketStart: bucketStart ?? undefined,
      rawP95Ms: maxP95,
      rawErrorCount: totalErrors,
    }
  })

  // Reverse DESC → ASC so oldest is left (−24h) and newest is right (now).
  const cells = cellsDesc.reverse()

  if (cells.length >= FLEET_PULSE_CELL_COUNT) {
    return cells.slice(cells.length - FLEET_PULSE_CELL_COUNT)
  }

  const pad = Array.from<CellDef>({
    length: FLEET_PULSE_CELL_COUNT - cells.length,
  }).fill({
    color: 'var(--card-2)',
  })
  return [...pad, ...cells]
}

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
  // Wave 16-V: grain hardcoded to 'day'; per-visual grain logic in PhosphorDashboard untouched
  const grain: UsageReportGrain = 'day'
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

  const handleRangeChange = (nextFrom: string, nextTo: string): void => {
    setFrom(nextFrom)
    setTo(nextTo)
  }

  // Wave 36 Fix 1: queryKey now matches PhosphorDashboard's key shape exactly
  // (includes filter arrays) so React Query deduplicates both subscribers into a
  // single cache entry and fires only ONE HTTP request per page load.
  const {
    data: summaryReport,
    isLoading: summaryLoading,
    dataUpdatedAt,
  } = useQuery({
    queryKey: [
      'usage-report-phosphor',
      from,
      to,
      grain,
      slicerFilters.providers,
      slicerFilters.repositories,
      slicerFilters.clients,
      slicerFilters.environments,
      slicerFilters.models,
    ],
    queryFn: () =>
      fetchUsageReport({
        from,
        to,
        grain,
        groupBy: ['provider', 'model', 'repository'],
        provider: slicerFilters.providers,
        repository: slicerFilters.repositories,
        client: slicerFilters.clients,
        environment: slicerFilters.environments,
        model: slicerFilters.models,
      }),
    // Wave 37 W37-2: align client staleTime with server REPORT_CACHE_TTL_MS
    // (5 min). Without this, React Query marks data stale after the global
    // default (10 s) and refetches on every tab-focus event even though the
    // server returns cached responses for the full 5-minute window.
    staleTime: 5 * 60 * 1000,
  })

  // Wave 36 Fix 4: showComparison gates the priorReport query in PhosphorDashboard
  // so the prior-window API call is only made when the ComparisonPanel is visible
  // (viewport ≥3840px). Initialised synchronously to avoid a false-trigger flash.
  const [showComparison, setShowComparison] = useState(() =>
    typeof window === 'undefined'
      ? false
      : window.matchMedia('(min-width: 3840px)').matches
  )
  useEffect(() => {
    if (typeof window === 'undefined') return
    const mq = window.matchMedia('(min-width: 3840px)')
    const onChange = (e: MediaQueryListEvent): void => {
      setShowComparison(e.matches)
    }
    mq.addEventListener('change', onChange)
    return () => {
      mq.removeEventListener('change', onChange)
    }
  }, [])

  // 14-B.2: freshness format per mockup line 2384:
  //   "FETCHED HH:MM:SS UTC · Xs ago"
  // Re-evaluate every 10 s so relative time stays current.
  //
  // Wave 35 (wave35-data-flow-audit ⚠-6): use metadata.latestRecordAt as the
  // displayed timestamp so the operator sees when the most recent data event
  // arrived (server max created_at), not when the browser fetch landed.
  // Fall back to dataUpdatedAt if latestRecordAt is null/undefined.
  const [freshnessStr, setFreshnessStr] = useState<string>('Loading…')
  useEffect(() => {
    const compute = (): void => {
      if (dataUpdatedAt === 0) {
        setFreshnessStr('Loading…')
        return
      }
      const latestRecordAt = summaryReport?.metadata?.latestRecordAt
      // Use latestRecordAt (data recency) for the timestamp display; fall back
      // to the browser-side dataUpdatedAt when the server value is unavailable.
      const displayDate =
        latestRecordAt != null
          ? new Date(latestRecordAt)
          : new Date(dataUpdatedAt)
      const timeUTC = displayDate.toUTCString().split(' ')[4] ?? ''
      // Always use current time for the relative "Xm ago" distance so it stays
      // accurate on the 10 s interval regardless of which date is displayed.
      const distance = formatDistanceToNow(displayDate)
      setFreshnessStr(`FETCHED ${timeUTC} UTC · ${distance} ago`)
    }
    compute()
    const id = setInterval(compute, 10_000)
    return () => {
      clearInterval(id)
    }
  }, [dataUpdatedAt, summaryReport?.metadata?.latestRecordAt])

  // B3 fix: Compute fleet-wide P95 from all provider latency health rows
  // using a requests-weighted average (replaces the former Math.max that was
  // skewed by low-sample anthropic/claude-opus-4-7 buckets).
  const fleetP95Ms = useMemo(
    () => computeFleetP95(summaryReport?.providerLatencyHealth ?? []),
    [summaryReport?.providerLatencyHealth]
  )

  // 15-C.1 / Wave 31: Real error count from 14-day per-event observations.
  // B2 fix: pass from/to so the Errors KPI tile aligns with the user's
  // selected date range (instead of always counting the full 14-day window).
  const fleetErrors = useMemo(
    () =>
      computeFleetErrors(
        summaryReport?.providerErrorObservations ?? [],
        from,
        to
      ),
    [summaryReport?.providerErrorObservations, from, to]
  )

  // B1 fix: Derive fleet-wide health cells from real providerLatencyHealth data
  // (replaces the hardcoded static color pattern per wave34-data-flow-audit ✘-1).
  const fleetPulseCells = useMemo(
    () => deriveFleetPulseCells(summaryReport?.providerLatencyHealth ?? []),
    [summaryReport?.providerLatencyHealth]
  )

  const kpiSummary = useMemo(
    () => toKpiSummary(summaryReport?.summary, fleetP95Ms, fleetErrors),
    [summaryReport?.summary, fleetP95Ms, fleetErrors]
  )

  // Wave 35 (wave35-data-flow-audit ⚠-5): receive the prior-period summary from
  // PhosphorDashboard (which owns the priorReport query) so we can compute signed
  // % deltas for the KPI strip without duplicating the query in index.tsx.
  const [priorSummary, setPriorSummary] = useState<
    UsageReportSummary | undefined
  >(undefined)
  const handlePriorSummaryReady = useCallback(
    (summary: UsageReportSummary | undefined): void => {
      setPriorSummary(summary)
    },
    []
  )

  // Wave 37 SF-4: receive prior-window fleet P95 and fleet errors from
  // PhosphorDashboard so all 6 KPI tiles can show a delta arrow.
  // `p95_ms` and `errors` are derived from health rows (not present in
  // UsageReportSummary), so they are passed via a dedicated callback.
  const [priorHealth, setPriorHealth] = useState<
    { priorP95: number; priorErrors: number } | undefined
  >(undefined)
  const handlePriorHealthReady = useCallback(
    (data: { priorP95: number; priorErrors: number } | undefined): void => {
      setPriorHealth(data)
    },
    []
  )

  // W38-3: Viewport gating note — kpiDeltas only populates when priorSummary is
  // defined, which only happens at ≥3840px viewports. The `showComparison` flag
  // (derived from a matchMedia for min-width: 3840px) gates the priorReport query
  // inside PhosphorDashboard; at narrower viewports the query is disabled, so
  // onPriorSummaryReady never fires and priorSummary stays undefined. As a result
  // all 6 delta arrows always render "—" at 2K viewports. This is intentional —
  // the ComparisonPanel that consumes prior data is only mounted at ≥3840px, so
  // there is no need to pay for the prior-period API call at smaller viewports.
  //
  // Compute signed-fractional deltas for each KPI key (format: 0.124 = +12.4%).
  // Uses computeDeltaPct (returns signed %, e.g. 12.4) divided by 100 so the
  // KpiStrip's renderDelta (which multiplies by 100) displays the correct value.
  // Returns undefined for a key when prior data is unavailable or prior is zero.
  // Wave 37 SF-4: p95_ms and errors deltas now wired via priorHealth from
  // PhosphorDashboard's onPriorHealthReady callback.
  const kpiDeltas = useMemo((): Partial<
    Record<keyof KpiSummaryShape, number>
  > => {
    if (kpiSummary === undefined || priorSummary === undefined) {
      return {}
    }
    const raw = {
      cost_usd: computeDeltaPct(kpiSummary.cost_usd, priorSummary.usd_cost),
      requests: computeDeltaPct(kpiSummary.requests, priorSummary.traces),
      token_in: computeDeltaPct(kpiSummary.token_in, priorSummary.token_in),
      token_out: computeDeltaPct(kpiSummary.token_out, priorSummary.token_out),
      // p95_ms and errors: derived from prior health rows (not in UsageReportSummary).
      // Available only when showComparison is true (priorReport query fires at ≥3840px).
      p95_ms:
        priorHealth !== undefined && priorHealth.priorP95 !== 0
          ? computeDeltaPct(kpiSummary.p95_ms, priorHealth.priorP95)
          : null,
      errors:
        priorHealth !== undefined && priorHealth.priorErrors !== 0
          ? computeDeltaPct(kpiSummary.errors, priorHealth.priorErrors)
          : null,
    }
    const result: Partial<Record<keyof KpiSummaryShape, number>> = {}
    for (const [key, val] of Object.entries(raw)) {
      if (val !== null) {
        result[key as keyof KpiSummaryShape] = val / 100
      }
    }
    return result
  }, [kpiSummary, priorSummary, priorHealth])

  const anomalies = useAnomalyDetection(
    (summaryReport?.providerLatencyHealth ?? []).filter(
      (r): r is typeof r & { bucket_start: string } => r.bucket_start !== null
    ),
    summaryReport?.metadata
  )

  // Wave 37 SF-1 / W37-1: queryKey now matches PhosphorDashboard's key shape
  // exactly (`['usage-report-quotas', from, to]`) so React Query deduplicates
  // both subscribers into a single cache entry and fires only ONE HTTP request
  // per load. The previous key `['usage-report-quotas-shell']` differed in
  // shape and could never hash to the same entry as PhosphorDashboard's key.
  // Wave 37 W37-2: staleTime aligned with server REPORT_CACHE_TTL_MS (5 min).
  const { data: quotasData } = useQuery({
    queryKey: ['usage-report-quotas', from, to],
    queryFn: fetchUsageReportQuotas,
    staleTime: 5 * 60 * 1000,
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
          {/* KPI strip — dominant header element */}
          {/* Wave 35 (⚠-5 R-B): deltas wired from priorReport.summary via
              onPriorSummaryReady callback. Signed-fractional format (0.124 = +12.4%).
              Wave 35 (S1): className='kpi-strip' added for probe/test selector parity. */}
          <KpiStrip
            summary={kpiSummary}
            loading={summaryLoading}
            deltas={kpiDeltas}
            className='kpi-strip'
          />

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
              }}
            >
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
              <HealthStrip cells={fleetPulseCells} orientation='horizontal' />
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

          {/* Anchor bar — flush to page-header via border-top: none */}
          {/* 14-B.1: negative marginTop hack removed — page-header has no card chrome */}
          <AnchorBar
            activeSection={activeSection}
            onSectionChange={setActiveSection}
          />

          {/* Wave 16-V controls row: SlicerBar left, DateControls right (inline) */}
          {/* Period buttons + grain selector removed per operator decision.        */}
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
            {/* 15-D.5: SlicerBar inline with DateControls (Wave 16-V reposition) */}
            <SlicerBar
              filters={slicerFilters}
              options={slicerOptions}
              onChange={setSlicerFilters}
            />
            {/* DateControls: From/To inputs + Apply — period buttons removed (Wave 16-V) */}
            <DateControls
              initialFrom={from}
              initialTo={to}
              onRangeChange={handleRangeChange}
            />
          </div>

          {/* Main dashboard content */}
          {/* 15-C.4: searchTerm passed for client-side row filtering */}
          {/* 15-D.5: filters + onOptionsReady wired for slicer */}
          {/* Wave 35: onPriorSummaryReady wired to receive prior-period summary for KPI deltas */}
          {/* Wave 36 Fix 1: report + reportLoading hoisted from index.tsx query (dedup). */}
          {/* Wave 36 Fix 3: skeleton rendered when loading and no data yet (see below). */}
          {/* Wave 36 Fix 4: showComparison gates priorReport query to ≥3840px viewports. */}
          {summaryLoading && summaryReport === undefined ? (
            <div
              className='dashboard-loading-skeleton'
              aria-busy='true'
              aria-label='Loading dashboard'
            >
              {/* Header bar placeholder */}
              <div
                className='skeleton-block'
                style={{ height: '32px', marginBottom: '16px', width: '40%' }}
              />
              {/* KPI tile row placeholder (6 tiles) */}
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(6, 1fr)',
                  gap: '8px',
                  marginBottom: '16px',
                }}
              >
                {Array.from({ length: 6 }).map((_, i) => (
                  // Index key is safe: static placeholder, no state or reorder
                  <div
                    key={i}
                    className='skeleton-block'
                    style={{ height: '64px' }}
                  />
                ))}
              </div>
              {/* Provider card grid placeholder (~8 cards) */}
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))',
                  gap: '8px',
                }}
              >
                {Array.from({ length: 8 }).map((_, i) => (
                  // Index key is safe: static placeholder, no state or reorder
                  <div
                    key={i}
                    className='skeleton-block'
                    style={{ height: '160px' }}
                  />
                ))}
              </div>
            </div>
          ) : (
            <PhosphorDashboard
              from={from}
              to={to}
              grain={grain}
              searchTerm={searchTerm}
              filters={slicerFilters}
              onOptionsReady={handleSlicerOptionsReady}
              onPriorSummaryReady={handlePriorSummaryReady}
              onPriorHealthReady={handlePriorHealthReady}
              report={summaryReport}
              reportLoading={summaryLoading}
              showComparison={showComparison}
              quotas={quotasData?.quotas}
            />
          )}
        </div>
      }
      alerts={<AlertsRail alerts={alerts} />}
    />
  )
}

// Future waves: expose from/to/grain as props on Dashboard for multi-view routing.
