/**
 * PhosphorDashboard — Wave 8 route integration component.
 *
 * Composes the full set of Phosphor Atlas components (ProviderCard /
 * AggregateCard, TokenTrendChart, RepoBreakdownTable, DonutChart,
 * ClientBreakdownTable, MasterLedgerTable) into six anchored sections
 * that match the AnchorBar shortcuts:
 *   status → tokens → models → repos → clients → health
 *
 * Data is fetched via fetchUsageReport + fetchUsageReportQuotas; anomaly
 * flags come from useAnomalyDetection.
 *
 * Legacy UsageReportDashboard is kept as a fallback — dead-code cleanup
 * is deferred to a follow-up wave once this component is proven stable.
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
import { DonutChart, type SliceConfig } from './donut-chart'
import { MasterLedgerTable, type ModelRow } from './master-ledger-table'
import {
  ProviderCard,
  type ProviderCardConfig,
  type ProviderMetrics,
  type QuotaRowConfig,
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
 * Colors match the Phosphor design palette (var(--accent-*) or explicit hex).
 */
const PROVIDER_SERIES: ProviderSeries[] = [
  {
    key: 'anthropic',
    label: 'Anthropic',
    color: providerColorFor('anthropic'),
    cssClass: 'tt-anthropic',
  },
  {
    key: 'openai',
    label: 'OpenAI',
    color: providerColorFor('openai'),
    cssClass: 'tt-openai',
  },
  {
    key: 'google',
    label: 'Google',
    color: providerColorFor('google'),
    cssClass: 'tt-google',
  },
  {
    key: 'xai',
    label: 'xAI',
    color: providerColorFor('xai'),
    cssClass: 'tt-xai',
  },
  {
    key: 'nvidia_nim',
    label: 'NVIDIA',
    color: providerColorFor('nvidia'),
    cssClass: 'tt-nvidia',
  },
  {
    key: 'openrouter',
    label: 'OpenRouter',
    color: providerColorFor('openrouter'),
    cssClass: 'tt-openrouter',
  },
  {
    key: 'local',
    label: 'Local',
    color: providerColorFor('local'),
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
 * upstream P95 latency and provider error counts.
 */
function healthCellColor(row: UsageReportProviderLatencyHealthRow): string {
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
      },
      {
        pct: row.short_remaining_pct,
        active: row.short_active,
        velocity: true,
      },
      {
        pct: row.special_remaining_pct,
        active: row.special_active,
        velocity: false,
      },
      {
        pct: row.monthly_remaining_pct,
        active: row.monthly_active,
        velocity: false,
      },
    ]

    for (const interval of intervals) {
      if (!interval.active || interval.pct === null) continue
      const widthPct = Math.max(0, Math.min(100, interval.pct))
      const severityClass =
        widthPct < 10
          ? 'severity-bad'
          : widthPct < 25
            ? 'severity-warn'
            : 'severity-good'
      result.push({
        widthPct,
        severityClass,
        highVelocity: interval.velocity,
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
    report?.providerLatencyHealth ?? [],
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

  return (
    <div
      className='phosphor-dashboard'
      style={{
        padding: '1rem',
        display: 'flex',
        flexDirection: 'column',
        gap: '2rem',
      }}
    >
      {/* ── STATUS ────────────────────────────────────────────────────── */}
      <section id='status' aria-labelledby='section-status-heading'>
        <h2
          id='section-status-heading'
          style={{
            fontSize: '0.625rem',
            fontWeight: 700,
            letterSpacing: '0.1em',
            textTransform: 'uppercase',
            color: 'var(--fg-muted)',
            marginBottom: '0.5rem',
          }}
        >
          Status
        </h2>
        {reportLoading ? (
          <SectionSkeleton height={180} />
        ) : (
          <AggregateCard
            config={aggregateConfig}
            data={aggregateMetrics}
            healthCells={aggregateHealthCells}
            quotas={[]}
            fleetActivity={{
              toolCalls: summary?.tool_calls ?? 0,
              gitCommits: summary?.git_commit ?? 0,
              gitPushes: summary?.git_push ?? 0,
              invalidToolCalls: 0, // TODO: wire invalidToolCalls when API exposes it
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
        )}
      </section>

      {/* ── TOKENS ────────────────────────────────────────────────────── */}
      <section id='tokens' aria-labelledby='section-tokens-heading'>
        <h2
          id='section-tokens-heading'
          style={{
            fontSize: '0.625rem',
            fontWeight: 700,
            letterSpacing: '0.1em',
            textTransform: 'uppercase',
            color: 'var(--fg-muted)',
            marginBottom: '0.5rem',
          }}
        >
          Tokens
        </h2>
        {reportLoading ? (
          <SectionSkeleton height={120} />
        ) : (
          <TokenTrendChart data={trendData} series={PROVIDER_SERIES} />
        )}
      </section>

      {/* ── MODELS ────────────────────────────────────────────────────── */}
      <section id='models' aria-labelledby='section-models-heading'>
        <h2
          id='section-models-heading'
          style={{
            fontSize: '0.625rem',
            fontWeight: 700,
            letterSpacing: '0.1em',
            textTransform: 'uppercase',
            color: 'var(--fg-muted)',
            marginBottom: '0.5rem',
          }}
        >
          Models
        </h2>
        {reportLoading ? (
          <SectionSkeleton height={120} />
        ) : providers.length > 0 ? (
          <div
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              gap: '0.5rem',
            }}
          >
            {providers.map((provider) => {
              const config: ProviderCardConfig = {
                provider,
                color: providerColorFor(provider),
              }
              const metrics = buildProviderMetrics(provider, healthRows)
              const cells = padHealthCells(healthRows, provider)
              const quotaIntervals = buildQuotaIntervals(quotaRows, provider)

              return (
                <ProviderCard
                  key={provider}
                  config={config}
                  data={metrics}
                  healthCells={cells}
                  quotas={quotaIntervals}
                  anomalies={anomalies}
                />
              )
            })}
          </div>
        ) : (
          <p
            style={{
              fontSize: '0.75rem',
              color: 'var(--fg-muted)',
              padding: '1rem 0',
            }}
          >
            No provider data returned for this range.
          </p>
        )}
      </section>

      {/* ── REPOS ─────────────────────────────────────────────────────── */}
      <section id='repos' aria-labelledby='section-repos-heading'>
        <h2
          id='section-repos-heading'
          style={{
            fontSize: '0.625rem',
            fontWeight: 700,
            letterSpacing: '0.1em',
            textTransform: 'uppercase',
            color: 'var(--fg-muted)',
            marginBottom: '0.5rem',
          }}
        >
          Repos
        </h2>
        {reportLoading ? (
          <SectionSkeleton height={120} />
        ) : (
          <RepoBreakdownTable rows={repoRows} />
        )}
      </section>

      {/* ── CLIENTS ───────────────────────────────────────────────────── */}
      <section id='clients' aria-labelledby='section-clients-heading'>
        <h2
          id='section-clients-heading'
          style={{
            fontSize: '0.625rem',
            fontWeight: 700,
            letterSpacing: '0.1em',
            textTransform: 'uppercase',
            color: 'var(--fg-muted)',
            marginBottom: '0.5rem',
          }}
        >
          Clients
        </h2>
        {reportLoading ? (
          <SectionSkeleton height={200} />
        ) : (
          <div
            style={{
              display: 'flex',
              gap: '1.5rem',
              flexWrap: 'wrap',
              alignItems: 'flex-start',
            }}
          >
            <DonutChart slices={clientSlices} />
            <div style={{ flex: 1, minWidth: '280px' }}>
              <ClientBreakdownTable rows={clientRows} />
            </div>
          </div>
        )}
      </section>

      {/* ── HEALTH ────────────────────────────────────────────────────── */}
      <section id='health' aria-labelledby='section-health-heading'>
        <h2
          id='section-health-heading'
          style={{
            fontSize: '0.625rem',
            fontWeight: 700,
            letterSpacing: '0.1em',
            textTransform: 'uppercase',
            color: 'var(--fg-muted)',
            marginBottom: '0.5rem',
          }}
        >
          Health
        </h2>
        {reportLoading ? (
          <SectionSkeleton height={200} />
        ) : (
          <MasterLedgerTable rows={modelRows} />
        )}
      </section>
    </div>
  )
}
