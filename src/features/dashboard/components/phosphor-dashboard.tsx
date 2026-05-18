/**
 * PhosphorDashboard — Wave 9 reference-parity integration component.
 *
 * Composes the full set of Phosphor Atlas components into five anchored
 * sections that match the AnchorBar shortcuts:
 *   status → tokens → models → repos → clients
 *
 * Wave 9 changes:
 * - Section label inversion fix: id="models" now contains ProviderCards;
 *   id="health" now contains MasterLedgerTable (matches v9.7 reference).
 * - Dense composition: gap reduced from 2rem to 4–8px; padding from 1rem to 4px.
 * - Section headings: amber color, border-bottom, clamp font-size.
 * - Provider grid: CSS grid repeat(4,1fr) → repeat(8,1fr) at wider breakpoints.
 * - Comparison panel at ≥3840px.
 * - iv-* quota interval class names replacing severity-*.
 *
 * Wave 11 PR1 (11-b, 11-c):
 * - Provider cards move from id="models" → id="status" (title: "Provider Health Summary").
 * - MasterLedgerTable moves from id="health" → id="models" (title: "Model Ledger").
 * - Standalone id="health" section removed; anchor `h` resolves in PR7.
 * - Section order: status → tokens → [models+repos row] → clients.
 * - models+repos wrapped in .ledger-repo-row: side-by-side 8fr/4fr at ≥1600px.
 * - Section titles: Models→Model Ledger, Repos→Repository Breakdown,
 *   Clients→Client Usage.
 *
 * Data is fetched via fetchUsageReport + fetchUsageReportQuotas; anomaly
 * flags come from useAnomalyDetection.
 */
import { useMemo, type ReactElement } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  fetchUsageReport,
  fetchUsageReportQuotas,
  type UsageReportProviderLatencyHealthRow,
  type UsageReportQuotaRow,
  type UsageReportTrendRow,
  type UsageReportGrain,
} from '../api/usage-report'
import { useAnomalyDetection } from '../hooks/use-anomaly-detection'
import { CLIENT_BRAND_COLORS } from '../lib/client-brand-colors'
import { normalizeTrendData } from '../lib/trend-utils'
import { clientColorFor, providerColorFor } from '../lib/usage-report-display'
import { AggregateCard } from './aggregate-card'
import { ClientBreakdownTable, type ClientRow } from './client-breakdown-table'
import { ComparisonPanel } from './comparison-panel'
import { DonutChart, type SliceConfig } from './donut-chart'
import { MasterLedgerTable, type ModelRow } from './master-ledger-table'
import styles from './phosphor-dashboard.module.css'
import {
  ProviderCard,
  type ProviderCardConfig,
  type ProviderMetrics,
  type QuotaRowConfig,
  type TopModelRow,
} from './provider-card'
import { RepoBreakdownTable, type RepoRow } from './repo-breakdown-table'
import { TokenTrendChart, type ProviderSeries } from './token-trend-chart'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Cell count expected by HealthStrip inside ProviderCard. */
const HEALTH_CELL_COUNT = 288

/**
 * Ordered provider series for TokenTrendChart.
 * Colors match the Phosphor design palette reference hex values.
 */
const PROVIDER_SERIES: ProviderSeries[] = [
  {
    key: 'anthropic',
    label: 'Anthropic',
    color: '#cc7855',
    cssClass: 'tt-anthropic',
  },
  {
    key: 'openai',
    label: 'OpenAI',
    color: '#10a37f',
    cssClass: 'tt-openai',
  },
  {
    key: 'google',
    label: 'Google',
    color: '#4285f4',
    cssClass: 'tt-google',
  },
  {
    key: 'xai',
    label: 'xAI',
    color: '#f5f5f5',
    cssClass: 'tt-xai',
  },
  {
    key: 'nvidia_nim',
    label: 'NVIDIA',
    color: '#76b900',
    cssClass: 'tt-nvidia',
  },
  {
    key: 'openrouter',
    label: 'OpenRouter',
    color: '#7e57c2',
    cssClass: 'tt-openrouter',
  },
  {
    key: 'local',
    label: 'Local',
    color: '#94a3b8',
    cssClass: 'tt-local',
  },
]

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PhosphorDashboardProps {
  /** ISO date string for the range start (YYYY-MM-DD). */
  from?: string
  /** ISO date string for the range end (YYYY-MM-DD). */
  to?: string
  /** Aggregation grain: 'day' | 'week' | 'month'. */
  grain?: string
}

// ---------------------------------------------------------------------------
// Section title style helper
// ---------------------------------------------------------------------------

/** Returns a consistent section-title <h2> element matching v9.7 spec. */
function SectionTitle({
  id,
  children,
}: {
  id: string
  children: string
}): ReactElement {
  return (
    <h2
      id={id}
      className='section-title'
      style={{
        fontSize: 'clamp(10px, 0.6vw, 18px)',
        color: 'var(--accent-chrome)',
        textTransform: 'uppercase',
        letterSpacing: '0.05em',
        fontWeight: 600,
        marginBottom: '6px',
        borderBottom: '1px solid var(--border)',
        paddingBottom: '4px',
      }}
    >
      {children}
    </h2>
  )
}

// ---------------------------------------------------------------------------
// Pure helper functions
// ---------------------------------------------------------------------------

/**
 * Returns a default date range of the last 7 days through tomorrow.
 */
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

/**
 * Pads or truncates a health cell array to exactly HEALTH_CELL_COUNT entries.
 * Missing cells are filled with a neutral muted color.
 */
function padHealthCells(
  rows: UsageReportProviderLatencyHealthRow[],
  provider: string
): { color: string }[] {
  const providerRows = rows.filter(
    (r) => r.provider.toLowerCase() === provider.toLowerCase()
  )
  const cells = providerRows.map((row) => ({
    color: healthCellColor(row),
  }))

  if (cells.length >= HEALTH_CELL_COUNT) {
    return cells.slice(cells.length - HEALTH_CELL_COUNT)
  }

  const pad = Array.from({ length: HEALTH_CELL_COUNT - cells.length }, () => ({
    color: 'var(--card-2)',
  }))
  return [...pad, ...cells]
}

/**
 * Determines the health cell color for a single latency health row based on
 * upstream P95 latency, provider error counts, and attribution gaps.
 *
 * Wave 10 D16: cat-miss teal cells for attribution-gap rows.
 */
function healthCellColor(row: UsageReportProviderLatencyHealthRow): string {
  // D16: attribution-gap cells — no upstream latency data and no requests
  if (row.requests === 0 || row.missing_upstream_latency > 0) {
    return 'rgba(20, 184, 166, 0.6)' // cat-miss teal
  }

  const errorCount =
    row.provider_error_events +
    row.provider_5xx_events +
    row.provider_timeout_events +
    row.network_error_events
  if (errorCount > 0) return 'var(--accent-hot)'

  const p95 = row.upstream_p95_ms
  if (p95 === null) return 'var(--card-2)'
  if (p95 > 10_000) return 'var(--accent-hot)'
  if (p95 > 5_000) return 'var(--accent-warm)'
  if (p95 > 2_000) return 'var(--fg-muted)'
  return 'var(--accent-cool)'
}

/**
 * Builds ProviderMetrics from latency health rows for a specific provider.
 * Falls back to summary totals for token/cost fields if health rows are sparse.
 */
function buildProviderMetrics(
  provider: string,
  healthRows: UsageReportProviderLatencyHealthRow[]
): ProviderMetrics {
  const providerRows = healthRows.filter(
    (r) => r.provider.toLowerCase() === provider.toLowerCase()
  )

  const requests = providerRows.reduce((s, r) => s + r.requests, 0)
  const errors = providerRows.reduce(
    (s, r) =>
      s +
      r.provider_error_events +
      r.provider_5xx_events +
      r.provider_timeout_events +
      r.network_error_events,
    0
  )

  // Best available P95 — use most recent row
  const latestRow = providerRows.at(-1)
  const p95 = latestRow?.upstream_p95_ms ?? 0

  return {
    tokens_in: 0, // TODO: wire per-provider token_in from rows groupBy
    tokens_out: 0, // TODO: wire per-provider token_out from rows groupBy
    cost_usd: 0, // TODO: wire per-provider cost from rows groupBy
    requests,
    errors,
    p95_ms: p95,
    cache_input: 0, // TODO: wire from rows groupBy
    cache_creation: 0, // TODO: wire from rows groupBy
    reasoning_reported: 0, // TODO: wire from rows groupBy
    reasoning_estimated: 0, // TODO: wire from rows groupBy
    traces: 0, // TODO: wire from rows groupBy
  }
}

/**
 * Builds aggregate ProviderMetrics by summing across all providers.
 */
function buildAggregateMetrics(
  healthRows: UsageReportProviderLatencyHealthRow[],
  summaryTokenIn: number,
  summaryTokenOut: number,
  summaryCost: number,
  summaryTraces: number,
  summaryCacheInput: number,
  summaryCacheCreation: number,
  summaryReasoningReported: number,
  summaryReasoningEstimated: number
): ProviderMetrics {
  const requests = healthRows.reduce((s, r) => s + r.requests, 0)
  const errors = healthRows.reduce(
    (s, r) =>
      s +
      r.provider_error_events +
      r.provider_5xx_events +
      r.provider_timeout_events +
      r.network_error_events,
    0
  )
  // Fleet-wide P95: pick max P95 across latest bucket rows
  const p95Values = healthRows
    .map((r) => r.upstream_p95_ms)
    .filter((v): v is number => v !== null)
  const p95 = p95Values.length > 0 ? Math.max(...p95Values) : 0

  return {
    tokens_in: summaryTokenIn,
    tokens_out: summaryTokenOut,
    cost_usd: summaryCost,
    requests,
    errors,
    p95_ms: p95,
    cache_input: summaryCacheInput,
    cache_creation: summaryCacheCreation,
    reasoning_reported: summaryReasoningReported,
    reasoning_estimated: summaryReasoningEstimated,
    traces: summaryTraces,
  }
}

/**
 * Builds QuotaRowConfig[] from a UsageReportQuotaRow for display in
 * the provider card quota bar.
 *
 * Wave 9: uses iv-* threshold class names matching v9.7 CSS rules.
 */
function buildQuotaIntervals(
  quotaRows: UsageReportQuotaRow[],
  provider: string
): QuotaRowConfig[] {
  const providerQuotas = quotaRows.filter(
    (r) => r.provider.toLowerCase() === provider.toLowerCase()
  )
  if (providerQuotas.length === 0) return []

  const result: QuotaRowConfig[] = []
  for (const row of providerQuotas) {
    const intervals = [
      {
        pct: row.weekly_remaining_pct,
        active: row.weekly_active,
        velocity: false,
        label: 'Weekly',
        resetDate: undefined as string | undefined,
      },
      {
        pct: row.short_remaining_pct,
        active: row.short_active,
        velocity: true,
        label: 'Short',
        resetDate: undefined as string | undefined,
      },
      {
        pct: row.special_remaining_pct,
        active: row.special_active,
        velocity: false,
        label: 'Special',
        resetDate: undefined as string | undefined,
      },
      {
        pct: row.monthly_remaining_pct,
        active: row.monthly_active,
        velocity: false,
        label: 'Monthly',
        resetDate: undefined as string | undefined,
      },
    ]

    for (const interval of intervals) {
      if (!interval.active || interval.pct === null) continue
      const widthPct = Math.max(0, Math.min(100, interval.pct))
      // v9.7 iv-* threshold class mapping:
      // 0–5% → iv-0-5 (dim cool), 5–10% → iv-5-10 (cool blue),
      // 10–25% → iv-10-25 (teal), 25–50% → iv-25-50 (amber), ≥50% → iv-50-p (red)
      const ivClass =
        widthPct < 5
          ? 'iv-0-5'
          : widthPct < 10
            ? 'iv-5-10'
            : widthPct < 25
              ? 'iv-10-25'
              : widthPct < 50
                ? 'iv-25-50'
                : 'iv-50-p'
      result.push({
        widthPct,
        severityClass: ivClass,
        highVelocity: interval.velocity,
        label: interval.label,
        resetDate: interval.resetDate,
      })
    }
  }

  return result
}

/**
 * Derives unique providers from latency health rows, falling back to
 * providerStatusUsage if health rows are empty.
 */
function deriveProviders(
  healthRows: UsageReportProviderLatencyHealthRow[],
  trendRows: UsageReportTrendRow[]
): string[] {
  const fromHealth = [...new Set(healthRows.map((r) => r.provider))]
  if (fromHealth.length > 0) return fromHealth

  // Fallback: extract from trend rows
  return [...new Set(trendRows.map((r) => r.provider))]
}

/**
 * Builds RepoRow[] from raw UsageReportRow records by aggregating per
 * repository.
 */
function buildRepoRows(
  rows: {
    repository?: string
    token_total: number | null
    usd_cost: number | null
    traces: number | null
    model?: string
  }[]
): RepoRow[] {
  const repoMap = new Map<
    string,
    { tokens: number; cost: number; traces: number; topModel: string }
  >()

  for (const row of rows) {
    const repo = row.repository ?? '(unknown)'
    const existing = repoMap.get(repo)
    if (existing === undefined) {
      repoMap.set(repo, {
        tokens: row.token_total ?? 0,
        cost: row.usd_cost ?? 0,
        traces: row.traces ?? 0,
        topModel: row.model ?? '',
      })
    } else {
      existing.tokens += row.token_total ?? 0
      existing.cost += row.usd_cost ?? 0
      existing.traces += row.traces ?? 0
      // Keep the model with the most activity as "top model"
      if ((row.token_total ?? 0) > 0 && row.model) {
        existing.topModel = row.model
      }
    }
  }

  return [...repoMap.entries()]
    .sort(([, a], [, b]) => b.tokens - a.tokens)
    .map(([repository, data]) => ({
      repository,
      tokens: data.tokens,
      cost_usd: data.cost,
      traces: data.traces,
      top_model: data.topModel,
    }))
}

/**
 * Builds ModelRow[] for MasterLedgerTable from providerStatusUsage rows
 * aggregated by provider+model key.
 */
function buildModelRows(
  rows: {
    provider: string
    model: string
    traces: number
    token_total: number
    usd_cost: number
  }[],
  healthRows: UsageReportProviderLatencyHealthRow[]
): ModelRow[] {
  // Group health data by provider+model for latency lookups
  const healthByKey = new Map<
    string,
    {
      p50: number | null
      p95: number | null
      errors: number
      requests: number
    }
  >()
  for (const row of healthRows) {
    const key = `${row.provider}::${row.model}`
    const existing = healthByKey.get(key)
    const errors =
      row.provider_error_events +
      row.provider_5xx_events +
      row.provider_timeout_events
    if (existing === undefined) {
      healthByKey.set(key, {
        p50: null,
        p95: row.upstream_p95_ms,
        errors,
        requests: row.requests,
      })
    } else {
      existing.errors += errors
      existing.requests += row.requests
      if (row.upstream_p95_ms !== null) {
        existing.p95 =
          existing.p95 !== null
            ? Math.max(existing.p95, row.upstream_p95_ms)
            : row.upstream_p95_ms
      }
    }
  }

  return rows.map((row) => {
    const key = `${row.provider}::${row.model}`
    const health = healthByKey.get(key)
    const requests = health?.requests ?? row.traces
    const errors = health?.errors ?? 0
    const errorPct = requests > 0 ? (errors / requests) * 100 : 0
    const costPer1k =
      row.token_total > 0 ? (row.usd_cost / row.token_total) * 1000 : 0

    return {
      model: row.model,
      provider: row.provider,
      tokens_in: Math.round(row.token_total * 0.6), // TODO: wire token_in from rows groupBy
      tokens_out: Math.round(row.token_total * 0.4), // TODO: wire token_out from rows groupBy
      requests,
      p50_ms: health?.p50 ?? 0,
      p95_ms: health?.p95 ?? 0,
      error_pct: Math.round(errorPct * 10) / 10,
      cost_usd: row.usd_cost,
      cost_per_1k: Math.round(costPer1k * 10000) / 10000,
      quota_pct: 0, // TODO: wire from quota rows
      spark: [row.token_total],
    }
  })
}

/**
 * Builds DonutChart SliceConfig[] from client usage data.
 */
function buildClientSlices(
  clients: {
    client_name: string
    token_total: number
  }[]
): SliceConfig[] {
  return clients
    .filter((c) => c.token_total > 0)
    .sort((a, b) => b.token_total - a.token_total)
    .slice(0, 7)
    .map((c) => ({
      client: c.client_name,
      tokens: c.token_total,
      color:
        CLIENT_BRAND_COLORS[c.client_name] ?? clientColorFor(c.client_name),
    }))
}

/**
 * Builds ClientRow[] for ClientBreakdownTable from API client rows.
 */
function buildClientRows(
  clients: {
    client_name: string
    client_version: string
    traces: number
    token_total: number
    usd_cost: number
  }[]
): ClientRow[] {
  return clients.map((c) => ({
    client: c.client_name,
    version: c.client_version,
    requests: c.traces,
    tokens: c.token_total,
    cost_usd: c.usd_cost,
  }))
}

/**
 * Builds TopModelRow[] for ProviderCard card-pane-right at 4K.
 * Groups providerStatusUsage by provider+model and returns top 3 by tokens.
 */
function buildTopModels(
  rows: {
    provider: string
    model: string
    token_total: number
    usd_cost: number
    traces: number
  }[],
  provider: string
): TopModelRow[] {
  return rows
    .filter((r) => r.provider.toLowerCase() === provider.toLowerCase())
    .sort((a, b) => b.token_total - a.token_total)
    .slice(0, 3)
    .map((r) => ({
      model: r.model,
      tokens: r.token_total,
      cost_usd: r.usd_cost,
      requests: r.traces,
    }))
}

// ---------------------------------------------------------------------------
// Skeleton helpers
// ---------------------------------------------------------------------------

interface SectionSkeletonProps {
  height?: number
}

/** A simple skeleton block used while data is loading. */
function SectionSkeleton({ height = 80 }: SectionSkeletonProps): ReactElement {
  return (
    <div
      aria-hidden='true'
      style={{
        height,
        background: 'var(--card-2)',
        borderRadius: 0,
        animation: 'pulse 1.5s ease-in-out infinite',
      }}
    />
  )
}

// ---------------------------------------------------------------------------
// PhosphorDashboard
// ---------------------------------------------------------------------------

/**
 * PhosphorDashboard renders the full Phosphor Atlas dashboard, composing all
 * Wave 4-6 components into anchored sections that map to AnchorBar shortcuts.
 *
 * Wave 9: Section label inversion corrected — models section contains
 * ProviderCards, health section contains MasterLedgerTable, matching the
 * v9.7 reference (data-tab="models" renders ledger + providers in reference).
 *
 * Wave 11 PR1: Section restructure — provider cards under #status, Model Ledger
 * under #models, standalone #health removed, side-by-side ledger+repo row at
 * ≥1600px via .ledger-repo-row CSS module class.
 */
export default function PhosphorDashboard({
  from,
  to,
  grain,
}: PhosphorDashboardProps): ReactElement {
  const defaults = useMemo(() => defaultDateRange(), [])
  const resolvedFrom = from ?? defaults.from
  const resolvedTo = to ?? defaults.to
  const resolvedGrain = (grain ?? 'day') as UsageReportGrain

  const { data: report, isLoading: reportLoading } = useQuery({
    queryKey: [
      'usage-report-phosphor',
      resolvedFrom,
      resolvedTo,
      resolvedGrain,
    ],
    queryFn: () =>
      fetchUsageReport({
        from: resolvedFrom,
        to: resolvedTo,
        grain: resolvedGrain,
        groupBy: ['provider', 'model', 'repository'],
      }),
  })

  const { data: quotasData } = useQuery({
    queryKey: ['usage-report-quotas'],
    queryFn: fetchUsageReportQuotas,
  })

  const anomalies = useAnomalyDetection(
    (report?.providerLatencyHealth ?? []).filter(
      (r): r is typeof r & { bucket_start: string } => r.bucket_start !== null
    ),
    report?.metadata
  )

  const trendData = useMemo(
    () => normalizeTrendData(report?.trend ?? []),
    [report?.trend]
  )

  const providers = useMemo(
    () =>
      deriveProviders(report?.providerLatencyHealth ?? [], report?.trend ?? []),
    [report?.providerLatencyHealth, report?.trend]
  )

  const quotaRows = useMemo(
    () => quotasData?.quotas ?? report?.quotas ?? [],
    [quotasData?.quotas, report?.quotas]
  )

  const repoRows = useMemo(
    () => buildRepoRows(report?.rows ?? []),
    [report?.rows]
  )

  const modelRows = useMemo(
    () =>
      buildModelRows(
        report?.providerStatusUsage ?? [],
        report?.providerLatencyHealth ?? []
      ),
    [report?.providerStatusUsage, report?.providerLatencyHealth]
  )

  const clientSlices = useMemo(
    () =>
      buildClientSlices(
        (report?.clients ?? []).map((c) => ({
          client_name: c.client_name,
          token_total: c.token_total,
        }))
      ),
    [report?.clients]
  )

  const clientRows = useMemo(
    () => buildClientRows(report?.clients ?? []),
    [report?.clients]
  )

  const summary = report?.summary
  const healthRows = useMemo(
    () => report?.providerLatencyHealth ?? [],
    [report?.providerLatencyHealth]
  )

  // Aggregate card data (fleet-wide totals)
  const aggregateMetrics = useMemo(
    () =>
      buildAggregateMetrics(
        healthRows,
        summary?.token_in ?? 0,
        summary?.token_out ?? 0,
        summary?.usd_cost ?? 0,
        summary?.traces ?? 0,
        summary?.token_cache_input ?? 0,
        summary?.token_cache_creation ?? 0,
        summary?.token_reasoning_reported ?? 0,
        summary?.token_reasoning_estimated ?? 0
      ),
    [healthRows, summary]
  )

  const aggregateConfig: ProviderCardConfig = {
    provider: 'Fleet',
    color: 'var(--accent-chrome)',
  }

  const aggregateHealthCells = useMemo(
    () => padHealthCells(healthRows, ''),
    [healthRows]
  )

  const providerStatusUsage = useMemo(
    () => report?.providerStatusUsage ?? [],
    [report?.providerStatusUsage]
  )

  return (
    <div
      className='phosphor-dashboard main-content'
      style={{
        padding: '0',
        display: 'flex',
        flexDirection: 'column',
        gap: '4px',
      }}
    >
      {/* ── STATUS (Provider Health Summary) ─────────────────────────── */}
      {/* Wave 11 PR1 (11-b): provider cards move here from #models.     */}
      {/* D3: AggregateCard injected as the last peer in the grid;       */}
      {/* CSS hides it below 2100px (see provider-card.module.css).      */}
      <section
        id='status'
        data-tab='status'
        aria-labelledby='section-status-heading'
      >
        <SectionTitle id='section-status-heading'>
          Provider Health Summary
        </SectionTitle>
        {reportLoading ? (
          <SectionSkeleton height={120} />
        ) : (
          <div
            className={`provider-summary ${styles['provider-summary-grid']}`}
          >
            {providers.map((provider) => {
              const config: ProviderCardConfig = {
                provider,
                color: providerColorFor(provider),
              }
              const metrics = buildProviderMetrics(provider, healthRows)
              const cells = padHealthCells(healthRows, provider)
              const quotaIntervals = buildQuotaIntervals(quotaRows, provider)
              const topModels = buildTopModels(providerStatusUsage, provider)

              return (
                <ProviderCard
                  key={provider}
                  config={config}
                  data={metrics}
                  healthCells={cells}
                  quotas={quotaIntervals}
                  anomalies={anomalies}
                  topModels={topModels}
                />
              )
            })}
            {/* D3: AggregateCard as 8th peer — Σ Aggregate Totals in the provider row */}
            <AggregateCard
              config={aggregateConfig}
              data={aggregateMetrics}
              healthCells={aggregateHealthCells}
              quotas={[]}
              fleetActivity={{
                toolCalls: summary?.tool_calls ?? 0,
                gitCommits: summary?.git_commit ?? 0,
                gitPushes: summary?.git_push ?? 0,
                invalidToolCalls: 0,
                recentErrors: healthRows.reduce(
                  (s, r) =>
                    s +
                    r.provider_error_events +
                    r.provider_5xx_events +
                    r.provider_timeout_events,
                  0
                ),
              }}
              anomalies={anomalies}
            />
          </div>
        )}
      </section>

      {/* ── TOKENS ────────────────────────────────────────────────────── */}
      <section
        id='tokens'
        data-tab='tokens'
        aria-labelledby='section-tokens-heading'
      >
        <SectionTitle id='section-tokens-heading'>
          Token Trend · Stacked by Provider · 24h
        </SectionTitle>
        {reportLoading ? (
          <SectionSkeleton height={120} />
        ) : (
          <TokenTrendChart data={trendData} series={PROVIDER_SERIES} />
        )}
      </section>

      {/* ── MODEL LEDGER + REPOSITORY BREAKDOWN (side-by-side ≥1600px) ── */}
      {/* Wave 11 PR1 (11-b, 11-c): ledger moves from #health → #models; */}
      {/* repo stays in #repos; both wrapped for 8fr/4fr grid at 1600px+. */}
      <div className={styles['ledger-repo-row']}>
        <section
          id='models'
          data-tab='models'
          aria-labelledby='section-models-heading'
        >
          <SectionTitle id='section-models-heading'>Model Ledger</SectionTitle>
          {reportLoading ? (
            <SectionSkeleton height={200} />
          ) : (
            <MasterLedgerTable rows={modelRows} />
          )}
        </section>

        <section
          id='repos'
          data-tab='repos'
          aria-labelledby='section-repos-heading'
        >
          <SectionTitle id='section-repos-heading'>
            Repository Breakdown
          </SectionTitle>
          {reportLoading ? (
            <SectionSkeleton height={120} />
          ) : (
            <RepoBreakdownTable rows={repoRows} />
          )}
        </section>
      </div>

      {/* ── CLIENTS ───────────────────────────────────────────────────── */}
      <section
        id='clients'
        data-tab='clients'
        aria-labelledby='section-clients-heading'
      >
        <SectionTitle id='section-clients-heading'>Client Usage</SectionTitle>
        {reportLoading ? (
          <SectionSkeleton height={200} />
        ) : (
          <div
            className='client-section'
            style={{
              display: 'grid',
              gridTemplateColumns: '140px 1fr',
              gap: '4px',
            }}
          >
            <div className='client-donut'>
              <DonutChart slices={clientSlices} />
            </div>
            <div className='client-table-wrapper'>
              <ClientBreakdownTable rows={clientRows} />
            </div>
          </div>
        )}
      </section>

      {/* ── COMPARISON (4K+ only) ─────────────────────────────────────── */}
      {/* D19: hidden by default; CSS module shows at ≥3840px */}
      <section
        id='comparison'
        data-tab='comparison'
        aria-labelledby='section-comparison-heading'
        className={styles['comparison-section']}
      >
        <SectionTitle id='section-comparison-heading'>
          Provider Comparison
        </SectionTitle>
        <ComparisonPanel providers={providers} modelRows={modelRows} />
      </section>
    </div>
  )
}
