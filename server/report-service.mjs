import http from 'node:http'
import process from 'node:process'
import { URL } from 'node:url'
import pg from 'pg'

const { Pool } = pg

const PORT = Number(process.env.SHELL_REPORT_PORT ?? 3010)
const DATABASE_URL = normalizeDatabaseUrl(process.env.DATABASE_URL)
const AAWM_TAP_API_TARGET =
  process.env.AAWM_TAP_API_TARGET ?? 'http://127.0.0.1:8000'
const AAWM_TAP_API_KEY = envSecret(
  'AAWM_TAP_API_KEY',
  'VITE_TAP_API_KEY',
  'VITE_API_KEY'
)
const AAWM_TAP_ACCESS_TOKEN = envSecret(
  'AAWM_TAP_ACCESS_TOKEN',
  'VITE_TAP_ACCESS_TOKEN',
  'VITE_ACCESS_TOKEN'
)
const AAWM_TAP_ADMIN_CAPABILITY = envSecret(
  'AAWM_TAP_ADMIN_CAPABILITY',
  'VITE_TAP_ADMIN_CAPABILITY'
)
const DEFAULT_GROUP_BY = ['environment', 'client', 'repository', 'provider_model']
// Wave 24-D30: raised from 500 to 50000 to fix 30-day undercounting.
// At 30-day daily grain with provider+model+repository groupBy, row count
// exceeds 500. The aggregate-level surfaces (KPI strip, Aggregate Card)
// use report.summary and were always correct; this raise fixes the
// per-row surfaces (Master Ledger, Repo Breakdown, Slicer Repo Options).
// Future work: server-side pagination would be more scalable.
const MAX_LIMIT = 50000
// Wave 28-ServerCap: raised from 250 to 5000.
// At 30-day windows, deployments with many distinct (client_name,
// client_version) pairs were silently truncated, causing the Client
// Adoption surface to show an incomplete list. 5000 matches the order
// of magnitude of MAX_LIMIT and is safe for memory given that client
// rows are a small aggregate (6 columns per pair).
const MAX_CLIENT_ROWS = 5000
const HEALTH_WINDOW_HOURS = Math.max(
  1,
  Math.min(Number(process.env.SHELL_REPORT_HEALTH_WINDOW_HOURS ?? 24), 336)
)
const MAX_HEALTH_ROWS = Math.max(
  100,
  Math.min(Number(process.env.SHELL_REPORT_HEALTH_MAX_ROWS ?? 8_000), 20_000)
)
const MAX_PROVIDER_ERROR_ROWS = 2_000
const MAX_PROVIDER_STATUS_ROWS = 500
const STALE_RECORD_THRESHOLD_MINUTES = 120
const REPORT_CACHE_TTL_MS = Math.max(
  0,
  Number(process.env.SHELL_REPORT_CACHE_TTL_MS ?? 30_000)
)
const MAX_REPORT_CACHE_ENTRIES = 20
const UPSTREAM_FETCH_TIMEOUT_MS = Number(
  process.env.SHELL_REPORT_UPSTREAM_TIMEOUT_MS ?? 30_000
)
const HOP_BY_HOP_HEADERS = new Set([
  'connection',
  'content-encoding',
  'content-length',
  'host',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
])
const CLIENT_AUTH_HEADERS = new Set([
  'authorization',
  'cookie',
  'x-admin-capability',
  'x-api-key',
])

const pool = DATABASE_URL
  ? new Pool({
      connectionString: DATABASE_URL,
      max: Number(process.env.SHELL_REPORT_DB_POOL_MAX ?? 5),
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 10_000,
    })
  : null
const reportCache = new Map()

async function cachedReport(key, load) {
  if (REPORT_CACHE_TTL_MS <= 0) return load()

  const now = Date.now()
  const cached = reportCache.get(key)
  if (cached?.value !== undefined && cached.expiresAt > now) {
    return cached.value
  }
  if (cached?.promise) return cached.promise

  const promise = load()
    .then((value) => {
      reportCache.set(key, {
        value,
        expiresAt: Date.now() + REPORT_CACHE_TTL_MS,
      })
      pruneReportCache()
      return value
    })
    .catch((error) => {
      if (reportCache.get(key)?.promise === promise) {
        reportCache.delete(key)
      }
      throw error
    })

  reportCache.set(key, { promise, expiresAt: 0 })
  pruneReportCache()
  return promise
}

function pruneReportCache() {
  while (reportCache.size > MAX_REPORT_CACHE_ENTRIES) {
    const oldestKey = reportCache.keys().next().value
    if (oldestKey === undefined) return
    reportCache.delete(oldestKey)
  }
}

function normalizeDatabaseUrl(value) {
  if (!value) return value

  const hostRewrite = process.env.SHELL_REPORT_DATABASE_HOST_REWRITE
  if (!hostRewrite) return value

  const databaseUrl = new URL(value)
  const shouldRewrite =
    databaseUrl.hostname === '127.0.0.1' ||
    databaseUrl.hostname === 'localhost'

  if (!shouldRewrite) return value

  const portRewrite = process.env.SHELL_REPORT_DATABASE_PORT_REWRITE
  if (portRewrite) {
    databaseUrl.port = portRewrite
  }

  databaseUrl.hostname = hostRewrite
  return databaseUrl.toString()
}

function envSecret(...names) {
  for (const name of names) {
    const value = process.env[name]
    if (typeof value === 'string' && value.trim() !== '') {
      return value
    }
  }
  return undefined
}

const createdAtEastern = "(sh.created_at AT TIME ZONE 'America/New_York')"
const providerDimension = `
CASE
    WHEN lower(COALESCE(sh.provider, 'unknown')) IN ('google', 'gemini') THEN 'google'
    WHEN lower(COALESCE(sh.provider, 'unknown')) IN ('xai', 'x.ai') THEN 'xai'
    WHEN lower(COALESCE(sh.provider, 'unknown')) LIKE 'xai/%' THEN 'xai'
    WHEN lower(COALESCE(sh.provider, 'unknown')) = 'nvidia' THEN 'nvidia_nim'
    WHEN lower(COALESCE(sh.provider, 'unknown')) LIKE 'nvidia_nim/%' THEN 'nvidia_nim'
    WHEN lower(COALESCE(sh.provider, 'unknown')) LIKE 'nvidia/%' THEN 'nvidia_nim'
    WHEN lower(COALESCE(sh.provider, 'unknown')) LIKE 'local/%' THEN 'local'
    WHEN lower(COALESCE(sh.provider, 'unknown')) LIKE 'local_%' THEN 'local'
    ELSE COALESCE(sh.provider, 'unknown')
END`

const grains = {
  day: `${createdAtEastern}::date`,
  week: `date_trunc('week', ${createdAtEastern})::date`,
  month: `date_trunc('month', ${createdAtEastern})::date`,
}

const dimensions = {
  environment:
    "COALESCE(sh.litellm_environment, 'unknown') || ' [' || COALESCE(sh.litellm_version, '0.0.0') || ']'",
  client:
    "COALESCE(sh.client_name, 'unknown') || ' [' || COALESCE(sh.client_version, '0.0.0') || ']'",
  repository: "COALESCE(sh.tenant_id, 'unknown')",
  provider: providerDimension,
  model: "COALESCE(sh.model, 'unknown')",
  provider_model:
    `${providerDimension} || '/' || COALESCE(sh.model, 'unknown')`,
}

const filterColumns = {
  environment: dimensions.environment,
  client: dimensions.client,
  repository: "COALESCE(sh.tenant_id, 'unknown')",
  provider: providerDimension,
  model: "COALESCE(sh.model, 'unknown')",
  provider_model: dimensions.provider_model,
}

const sortColumns = {
  period_end: 'period_end',
  traces: 'traces',
  usd_cost: 'usd_cost',
  token_total: 'token_total',
}

function sendJson(res, status, body) {
  const payload = JSON.stringify(body)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  })
  res.end(payload)
}

function parseDateParam(value, fallback) {
  if (!value) return fallback()
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    throw new Error(`Invalid date: ${value}`)
  }
  return date.toISOString()
}

function defaultFromDate() {
  const now = new Date()
  return new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - 6)
  ).toISOString()
}

function defaultToDate() {
  const now = new Date()
  return new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1)
  ).toISOString()
}

function parseCsv(value) {
  if (!value) return []
  return value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
}

function parseLimit(value) {
  const parsed = Number(value ?? 200)
  if (!Number.isFinite(parsed) || parsed < 1) return 200
  return Math.min(Math.floor(parsed), MAX_LIMIT)
}

function parseGroupBy(value) {
  const requested = parseCsv(value)
  const groupBy = requested.length ? requested : DEFAULT_GROUP_BY
  const invalid = groupBy.filter((key) => !dimensions[key])
  if (invalid.length) {
    throw new Error(`Unsupported group_by value: ${invalid.join(', ')}`)
  }
  return [...new Set(groupBy)]
}

function appendMultiValueFilter(searchParams, key, whereParts, values) {
  const selected = parseCsv(searchParams.get(key))
  if (!selected.length) return

  const column = filterColumns[key]
  values.push(selected)
  whereParts.push(`${column} = ANY($${values.length}::text[])`)
}

function normalizeNumber(value) {
  if (value === null || value === undefined) return null
  const number = Number(value)
  return Number.isFinite(number) ? number : null
}

function firstRow(result) {
  return result.rows[0] ?? {}
}

function normalizeRow(row) {
  const numericKeys = [
    'min_weekly_pct',
    'max_weekly_pct',
    'min_short_pct',
    'max_short_pct',
    'min_weekly_pct_special',
    'max_weekly_pct_special',
    'min_short_pct_special',
    'max_short_pct_special',
    'traces',
    'token_in',
    'token_out',
    'token_cache_input',
    'token_cache_creation',
    'token_reasoning_reported',
    'token_reasoning_estimated',
    'token_cache_miss',
    'token_total',
    'cache_miss_usd_cost',
    'usd_cost',
    'tool_calls',
    'git_commit',
    'git_push',
    'litellm_processing_total_ms',
    'litellm_processing_average_ms',
    'llm_upstream_elapsed_total_ms',
    'llm_upstream_elapsed_average_ms',
  ]

  const normalized = { ...row }
  for (const key of numericKeys) {
    normalized[key] = normalizeNumber(normalized[key])
  }
  return normalized
}

function buildFilteredWhere(searchParams) {
  const from = parseDateParam(searchParams.get('from'), defaultFromDate)
  const to = parseDateParam(searchParams.get('to'), defaultToDate)
  const values = [from, to]
  const whereParts = [
    `${createdAtEastern}::date >= $1::date`,
    `${createdAtEastern}::date < $2::date`,
  ]

  for (const key of Object.keys(filterColumns)) {
    appendMultiValueFilter(searchParams, key, whereParts, values)
  }

  return { from, to, values, whereParts }
}

function buildSummaryQuery(searchParams) {
  const { values, whereParts } = buildFilteredWhere(searchParams)

  const sql = `
SELECT
    COUNT(*)::double precision AS traces,
    SUM(COALESCE(sh.input_tokens, 0))::double precision AS token_in,
    SUM(COALESCE(sh.output_tokens, 0))::double precision AS token_out,
    SUM(COALESCE(sh.cache_read_input_tokens, 0))::double precision AS token_cache_input,
    SUM(COALESCE(sh.cache_creation_input_tokens, 0))::double precision AS token_cache_creation,
    SUM(COALESCE(sh.reasoning_tokens_reported, 0))::double precision AS token_reasoning_reported,
    SUM(COALESCE(sh.reasoning_tokens_estimated, 0))::double precision AS token_reasoning_estimated,
    SUM(COALESCE(sh.input_tokens, 0)
      + COALESCE(sh.output_tokens, 0)
      + COALESCE(sh.cache_read_input_tokens, 0)
      + COALESCE(sh.cache_creation_input_tokens, 0)
      + COALESCE(sh.reasoning_tokens_reported, 0)
      + COALESCE(sh.reasoning_tokens_estimated, 0))::double precision AS token_total,
    SUM(COALESCE(sh.provider_cache_miss_cost_usd, 0))::double precision AS cache_miss_usd_cost,
    SUM(COALESCE(sh.response_cost_usd, 0))::double precision AS usd_cost,
    SUM(COALESCE(sh.tool_call_count, 0))::double precision AS tool_calls,
    SUM(COALESCE(sh.git_commit_count, 0))::double precision AS git_commit,
    SUM(COALESCE(sh.git_push_count, 0))::double precision AS git_push,
    MIN(sh.start_time) AS period_start,
    MAX(sh.end_time) AS period_end,
    MAX(sh.created_at) AS latest_record_at
FROM public.session_history sh
WHERE ${whereParts.join('\n  AND ')};
`

  return { sql, values }
}

function buildTrendQuery(searchParams) {
  const grain = searchParams.get('grain') ?? 'day'
  if (!grains[grain]) {
    throw new Error(`Unsupported grain: ${grain}`)
  }

  const { values, whereParts } = buildFilteredWhere(searchParams)
  const bucketExpression = grains[grain]

  const sql = `
SELECT
    ${bucketExpression} AS bucket,
    ${providerDimension} AS provider,
    COALESCE(sh.model, 'unknown') AS model,
    COALESCE(sh.tenant_id, 'unknown') AS repository,
    COUNT(*)::double precision AS traces,
    SUM(COALESCE(sh.input_tokens, 0)
      + COALESCE(sh.output_tokens, 0)
      + COALESCE(sh.cache_read_input_tokens, 0)
      + COALESCE(sh.cache_creation_input_tokens, 0)
      + COALESCE(sh.reasoning_tokens_reported, 0)
      + COALESCE(sh.reasoning_tokens_estimated, 0))::double precision AS token_total,
    SUM(COALESCE(sh.response_cost_usd, 0))::double precision AS usd_cost
FROM public.session_history sh
WHERE ${whereParts.join('\n  AND ')}
GROUP BY
    ${bucketExpression},
    ${providerDimension},
    COALESCE(sh.model, 'unknown'),
    COALESCE(sh.tenant_id, 'unknown')
ORDER BY
    ${bucketExpression} ASC,
    ${providerDimension} ASC,
    token_total DESC;
`

  return { sql, values }
}

function buildClientUsageQuery(searchParams) {
  const { values, whereParts } = buildFilteredWhere(searchParams)
  values.push(MAX_CLIENT_ROWS)

  const sql = `
SELECT
    COALESCE(NULLIF(sh.client_name, ''), 'unknown') AS client_name,
    COALESCE(NULLIF(sh.client_version, ''), '0.0.0') AS client_version,
    MIN(sh.created_at) AS first_seen_at,
    MAX(sh.created_at) AS last_seen_at,
    COUNT(*)::double precision AS traces,
    SUM(COALESCE(sh.input_tokens, 0)
      + COALESCE(sh.output_tokens, 0)
      + COALESCE(sh.cache_read_input_tokens, 0)
      + COALESCE(sh.cache_creation_input_tokens, 0)
      + COALESCE(sh.reasoning_tokens_reported, 0)
      + COALESCE(sh.reasoning_tokens_estimated, 0))::double precision AS token_total,
    SUM(COALESCE(sh.response_cost_usd, 0))::double precision AS usd_cost
FROM public.session_history sh
WHERE ${whereParts.join('\n  AND ')}
GROUP BY
    COALESCE(NULLIF(sh.client_name, ''), 'unknown'),
    COALESCE(NULLIF(sh.client_version, ''), '0.0.0')
ORDER BY
    token_total DESC,
    COALESCE(NULLIF(sh.client_name, ''), 'unknown') ASC,
    COALESCE(NULLIF(sh.client_version, ''), '0.0.0') ASC
LIMIT $${values.length};
`

  return { sql, values }
}

function buildProviderLatencyHealthQuery() {
  const sql = `
SELECT
    bucket_start,
    COALESCE(environment, 'unknown') AS environment,
    COALESCE(provider, 'unknown') AS provider,
    COALESCE(model, 'unknown') AS model,
    COALESCE(model_group, 'unknown') AS model_group,
    requests,
    passive_latency_sample_status,
    upstream_p50_ms,
    upstream_p95_ms,
    upstream_p99_ms,
    total_p95_ms,
    proxy_processing_p95_ms,
    missing_upstream_latency,
    provider_error_events,
    rate_limit_events,
    capacity_events,
    provider_5xx_events,
    provider_timeout_events,
    network_error_events,
    auth_failed_events,
    adapter_error_events,
    status_probe_count,
    status_probe_success_pct,
    status_probe_p95_ms,
    provider_ping_avg_ms,
    provider_ping_packet_loss_pct,
    control_ping_avg_ms,
    control_packet_loss_pct,
    control_probe_success_pct,
    provider_ping_minus_control_ms,
    dns_failures,
    tcp_failures,
    tls_failures,
    icmp_failures,
    probed_endpoints,
    status_error_classes,
    min_remaining_pct,
    max_remaining_pct,
    next_expected_reset_at,
    quota_keys,
    request_period_start,
    request_period_end
FROM public.provider_latency_health_5m
WHERE bucket_start >= now() - ($2::double precision * interval '1 hour')
ORDER BY bucket_start DESC, environment, provider, model
LIMIT $1;
`

  return { sql, values: [MAX_HEALTH_ROWS, HEALTH_WINDOW_HOURS] }
}

function buildProviderErrorObservationQuery() {
  const sql = `
SELECT
    observed_at,
    COALESCE(environment, 'unknown') AS environment,
    COALESCE(provider, 'unknown') AS provider,
    COALESCE(model, 'unknown') AS model,
    COALESCE(model_group, 'unknown') AS model_group,
    COALESCE(route_family, 'unknown') AS route_family,
    status_code,
    COALESCE(error_type, 'unknown') AS error_type,
    COALESCE(error_code, 'unknown') AS error_code,
    COALESCE(error_class, 'unknown') AS error_class,
    retry_after_seconds,
    expected_reset_at
FROM public.provider_error_observations
WHERE observed_at >= now() - interval '14 days'
ORDER BY observed_at DESC
LIMIT $1;
`

  return { sql, values: [MAX_PROVIDER_ERROR_ROWS] }
}

// Wave 28-ServerCap: added searchParams parameter to thread the user's
// selected date range (from/to) into the WHERE clause.
// Previously this query hardcoded `now() - interval '24 hours'`, which
// caused the Model Ledger to always display only the last 24 h of
// provider/model data regardless of the operator's selected period
// (operator F#11). Now uses the same parameterised from/to pattern as
// buildClientUsageQuery and buildSummaryQuery, keyed on start_time for
// consistency with the rest of the providerStatusUsage surface.
function buildProviderStatusUsageQuery(searchParams) {
  const { values, whereParts } = buildFilteredWhere(searchParams)
  values.push(MAX_PROVIDER_STATUS_ROWS)

  const sql = `
SELECT
    ${providerDimension} AS provider,
    COALESCE(sh.model, 'unknown') AS model,
    COUNT(*)::double precision AS traces,
    SUM(COALESCE(sh.input_tokens, 0)
      + COALESCE(sh.output_tokens, 0)
      + COALESCE(sh.cache_read_input_tokens, 0)
      + COALESCE(sh.cache_creation_input_tokens, 0)
      + COALESCE(sh.reasoning_tokens_reported, 0)
      + COALESCE(sh.reasoning_tokens_estimated, 0))::double precision AS token_total,
    SUM(COALESCE(sh.response_cost_usd, 0))::double precision AS usd_cost,
    MIN(COALESCE(sh.start_time, sh.created_at)) AS period_start,
    MAX(COALESCE(sh.end_time, sh.start_time, sh.created_at)) AS period_end
FROM public.session_history sh
WHERE ${whereParts.join('\n  AND ')}
GROUP BY
    ${providerDimension},
    COALESCE(sh.model, 'unknown')
ORDER BY
    ${providerDimension} ASC,
    token_total DESC
LIMIT $${values.length};
`

  return { sql, values }
}

function buildQuotaQuery() {
  const sql = `
WITH normalized AS (
    SELECT
        CASE
            WHEN lower(COALESCE(ri.provider, 'unknown')) IN ('xai', 'x.ai') THEN 'xai'
            WHEN lower(COALESCE(ri.provider, 'unknown')) LIKE 'xai/%' THEN 'xai'
            WHEN lower(COALESCE(ri.provider, 'unknown')) = 'nvidia' THEN 'nvidia_nim'
            WHEN lower(COALESCE(ri.provider, 'unknown')) LIKE 'nvidia_nim/%' THEN 'nvidia_nim'
            WHEN lower(COALESCE(ri.provider, 'unknown')) LIKE 'nvidia/%' THEN 'nvidia_nim'
            WHEN lower(COALESCE(ri.provider, 'unknown')) LIKE 'local/%' THEN 'local'
            WHEN lower(COALESCE(ri.provider, 'unknown')) LIKE 'local_%' THEN 'local'
            ELSE COALESCE(ri.provider, 'unknown')
        END AS provider,
        CASE
            WHEN ri.quota_type IN ('monthly', 'requests')
              AND (
                  lower(COALESCE(ri.provider, 'unknown')) LIKE 'xai/%'
                  OR lower(COALESCE(ri.provider, 'unknown')) IN ('xai', 'x.ai')
              )
            THEN NULL
            ELSE NULLIF(ri.model, '')
        END AS model,
        CASE
            WHEN ri.quota_type = 'requests'
              AND (
                  lower(COALESCE(ri.provider, 'unknown')) LIKE 'xai/%'
                  OR lower(COALESCE(ri.provider, 'unknown')) IN ('xai', 'x.ai')
              )
            THEN 'monthly'
            WHEN ri.quota_type = 'weekly_special' THEN 'special'
            WHEN ri.quota_type = 'short_special' THEN 'short_special'
            WHEN ri.quota_type = 'requests' THEN 'short'
            ELSE ri.quota_type
        END AS quota_type,
        ri.expected_reset_at,
        ri.remaining_pct,
        ri.fromDate AS interval_start,
        ri.toDate AS interval_end,
        CASE
            WHEN ri.fromDate <= now() AND ri.toDate > now() THEN true
            ELSE false
        END AS active
    FROM public.rate_limit_intervals ri
    WHERE ri.quota_type IN ('weekly', 'short', 'weekly_special', 'short_special', 'requests', 'monthly')
),
ranked AS (
    SELECT
        *,
        ROW_NUMBER() OVER (
            PARTITION BY provider, COALESCE(model, ''), quota_type
            ORDER BY active DESC, interval_start DESC, interval_end DESC
        ) AS quota_rank
    FROM normalized
),
selected AS (
    SELECT *
    FROM ranked
    WHERE quota_rank = 1
),
selected_with_fallbacks AS (
    SELECT *
    FROM selected
    UNION ALL
    SELECT
        weekly.provider,
        weekly.model,
        'special' AS quota_type,
        weekly.expected_reset_at,
        0::double precision AS remaining_pct,
        weekly.interval_start,
        weekly.interval_end,
        weekly.active,
        weekly.quota_rank
    FROM selected weekly
    WHERE weekly.provider = 'openai'
      AND weekly.model IS NULL
      AND weekly.quota_type = 'weekly'
      AND NOT EXISTS (
          SELECT 1
          FROM selected special
          WHERE special.provider = weekly.provider
            AND special.model IS NOT DISTINCT FROM weekly.model
            AND special.quota_type = 'special'
      )
    UNION ALL
    SELECT
        short.provider,
        short.model,
        'short_special' AS quota_type,
        short.expected_reset_at,
        0::double precision AS remaining_pct,
        short.interval_start,
        short.interval_end,
        short.active,
        short.quota_rank
    FROM selected short
    WHERE short.provider = 'openai'
      AND short.model IS NULL
      AND short.quota_type = 'short'
      AND NOT EXISTS (
          SELECT 1
          FROM selected short_special
          WHERE short_special.provider = short.provider
            AND short_special.model IS NOT DISTINCT FROM short.model
            AND short_special.quota_type = 'short_special'
      )
),
usage_by_type AS (
    SELECT
        s.provider,
        s.model,
        s.quota_type,
        COALESCE(SUM(model_usage.token_total), 0)::double precision AS usage_tokens,
        COALESCE(
            jsonb_agg(
                jsonb_build_object(
                    'model', model_usage.model,
                    'tokens', model_usage.token_total,
                    'cost', model_usage.usd_cost,
                    'traces', model_usage.traces
                )
                ORDER BY model_usage.token_total DESC
            ) FILTER (WHERE model_usage.model IS NOT NULL),
            '[]'::jsonb
        ) AS usage_breakdown
    FROM selected_with_fallbacks s
    LEFT JOIN LATERAL (
        SELECT
            COALESCE(sh.model, 'unknown') AS model,
            COUNT(*)::double precision AS traces,
            SUM(COALESCE(sh.input_tokens, 0)
              + COALESCE(sh.output_tokens, 0)
              + COALESCE(sh.cache_read_input_tokens, 0)
              + COALESCE(sh.cache_creation_input_tokens, 0)
              + COALESCE(sh.reasoning_tokens_reported, 0)
              + COALESCE(sh.reasoning_tokens_estimated, 0))::double precision AS token_total,
            SUM(COALESCE(sh.response_cost_usd, 0))::double precision AS usd_cost
        FROM public.session_history sh
        WHERE s.expected_reset_at IS NOT NULL
          AND sh.start_time >= s.expected_reset_at - CASE
              WHEN s.provider = 'google' THEN INTERVAL '24 hours'
              WHEN s.quota_type = 'monthly' THEN INTERVAL '1 month'
              WHEN s.quota_type IN ('short', 'short_special') THEN INTERVAL '5 hours'
              ELSE INTERVAL '7 days'
          END
          AND sh.start_time < CASE
              WHEN s.expected_reset_at > now() THEN now()
              ELSE s.expected_reset_at
          END
          AND (
              (s.provider = 'google'
                AND ${providerDimension} = 'google'
                AND COALESCE(sh.model, 'unknown') = COALESCE(s.model, 'unknown'))
              OR
              (s.provider <> 'google'
                AND ${providerDimension} = s.provider)
          )
          AND (
              s.provider <> 'openai'
              OR s.quota_type NOT IN ('weekly', 'short')
              OR COALESCE(sh.model, '') NOT ILIKE '%spark%'
          )
          AND (
              s.provider <> 'openai'
              OR s.quota_type NOT IN ('special', 'short_special')
              OR COALESCE(sh.model, '') ILIKE '%spark%'
          )
          AND (
              s.provider <> 'anthropic'
              OR s.quota_type <> 'special'
              OR COALESCE(sh.model, '') ILIKE '%sonnet%'
          )
        GROUP BY COALESCE(sh.model, 'unknown')
    ) model_usage ON true
    GROUP BY s.provider, s.model, s.quota_type
)
SELECT
    s.provider,
    s.model,
    MAX(s.remaining_pct) FILTER (WHERE s.quota_type = 'weekly')::double precision AS weekly_remaining_pct,
    MAX(s.expected_reset_at) FILTER (WHERE s.quota_type = 'weekly') AS weekly_reset_at,
    MAX(s.interval_start) FILTER (WHERE s.quota_type = 'weekly') AS weekly_interval_start,
    MAX(s.interval_end) FILTER (WHERE s.quota_type = 'weekly') AS weekly_interval_end,
    MAX(s.active::int) FILTER (WHERE s.quota_type = 'weekly')::double precision AS weekly_active,
    MAX(usage.usage_tokens) FILTER (WHERE s.quota_type = 'weekly')::double precision AS weekly_usage_tokens,
    (ARRAY_AGG(usage.usage_breakdown) FILTER (WHERE s.quota_type = 'weekly'))[1] AS weekly_usage_breakdown,
    MAX(s.remaining_pct) FILTER (WHERE s.quota_type = 'short')::double precision AS short_remaining_pct,
    MAX(s.expected_reset_at) FILTER (WHERE s.quota_type = 'short') AS short_reset_at,
    MAX(s.interval_start) FILTER (WHERE s.quota_type = 'short') AS short_interval_start,
    MAX(s.interval_end) FILTER (WHERE s.quota_type = 'short') AS short_interval_end,
    MAX(s.active::int) FILTER (WHERE s.quota_type = 'short')::double precision AS short_active,
    MAX(usage.usage_tokens) FILTER (WHERE s.quota_type = 'short')::double precision AS short_usage_tokens,
    (ARRAY_AGG(usage.usage_breakdown) FILTER (WHERE s.quota_type = 'short'))[1] AS short_usage_breakdown,
    MAX(s.remaining_pct) FILTER (WHERE s.quota_type = 'special')::double precision AS special_remaining_pct,
    MAX(s.expected_reset_at) FILTER (WHERE s.quota_type = 'special') AS special_reset_at,
    MAX(s.interval_start) FILTER (WHERE s.quota_type = 'special') AS special_interval_start,
    MAX(s.interval_end) FILTER (WHERE s.quota_type = 'special') AS special_interval_end,
    MAX(s.active::int) FILTER (WHERE s.quota_type = 'special')::double precision AS special_active,
    MAX(usage.usage_tokens) FILTER (WHERE s.quota_type = 'special')::double precision AS special_usage_tokens,
    (ARRAY_AGG(usage.usage_breakdown) FILTER (WHERE s.quota_type = 'special'))[1] AS special_usage_breakdown,
    MAX(s.remaining_pct) FILTER (WHERE s.quota_type = 'short_special')::double precision AS short_special_remaining_pct,
    MAX(s.expected_reset_at) FILTER (WHERE s.quota_type = 'short_special') AS short_special_reset_at,
    MAX(s.interval_start) FILTER (WHERE s.quota_type = 'short_special') AS short_special_interval_start,
    MAX(s.interval_end) FILTER (WHERE s.quota_type = 'short_special') AS short_special_interval_end,
    MAX(s.active::int) FILTER (WHERE s.quota_type = 'short_special')::double precision AS short_special_active,
    MAX(usage.usage_tokens) FILTER (WHERE s.quota_type = 'short_special')::double precision AS short_special_usage_tokens,
    (ARRAY_AGG(usage.usage_breakdown) FILTER (WHERE s.quota_type = 'short_special'))[1] AS short_special_usage_breakdown,
    MAX(s.remaining_pct) FILTER (WHERE s.quota_type = 'monthly')::double precision AS monthly_remaining_pct,
    MAX(s.expected_reset_at) FILTER (WHERE s.quota_type = 'monthly') AS monthly_reset_at,
    MAX(s.interval_start) FILTER (WHERE s.quota_type = 'monthly') AS monthly_interval_start,
    MAX(s.interval_end) FILTER (WHERE s.quota_type = 'monthly') AS monthly_interval_end,
    MAX(s.active::int) FILTER (WHERE s.quota_type = 'monthly')::double precision AS monthly_active,
    MAX(usage.usage_tokens) FILTER (WHERE s.quota_type = 'monthly')::double precision AS monthly_usage_tokens,
    (ARRAY_AGG(usage.usage_breakdown) FILTER (WHERE s.quota_type = 'monthly'))[1] AS monthly_usage_breakdown
FROM selected_with_fallbacks s
LEFT JOIN usage_by_type usage
  ON usage.provider = s.provider
 AND usage.model IS NOT DISTINCT FROM s.model
 AND usage.quota_type = s.quota_type
GROUP BY s.provider, s.model
ORDER BY s.provider ASC, s.model ASC NULLS FIRST;
`

  return { sql, values: [] }
}

function buildQuotaHistoryQuery(searchParams) {
  const from = parseDateParam(searchParams.get('from'), defaultFromDate)
  const to = parseDateParam(searchParams.get('to'), defaultToDate)

  const sql = `
WITH normalized AS (
    SELECT
        CASE
            WHEN lower(COALESCE(ri.provider, 'unknown')) IN ('xai', 'x.ai') THEN 'xai'
            WHEN lower(COALESCE(ri.provider, 'unknown')) LIKE 'xai/%' THEN 'xai'
            WHEN lower(COALESCE(ri.provider, 'unknown')) = 'nvidia' THEN 'nvidia_nim'
            WHEN lower(COALESCE(ri.provider, 'unknown')) LIKE 'nvidia_nim/%' THEN 'nvidia_nim'
            WHEN lower(COALESCE(ri.provider, 'unknown')) LIKE 'nvidia/%' THEN 'nvidia_nim'
            WHEN lower(COALESCE(ri.provider, 'unknown')) LIKE 'local/%' THEN 'local'
            WHEN lower(COALESCE(ri.provider, 'unknown')) LIKE 'local_%' THEN 'local'
            ELSE COALESCE(ri.provider, 'unknown')
        END AS provider,
        CASE
            WHEN ri.quota_type IN ('monthly', 'requests')
              AND (
                  lower(COALESCE(ri.provider, 'unknown')) LIKE 'xai/%'
                  OR lower(COALESCE(ri.provider, 'unknown')) IN ('xai', 'x.ai')
              )
            THEN NULL
            ELSE NULLIF(ri.model, '')
        END AS model,
        CASE
            WHEN ri.quota_type = 'requests'
              AND (
                  lower(COALESCE(ri.provider, 'unknown')) LIKE 'xai/%'
                  OR lower(COALESCE(ri.provider, 'unknown')) IN ('xai', 'x.ai')
              )
            THEN 'monthly'
            WHEN ri.quota_type = 'weekly_special' THEN 'special'
            WHEN ri.quota_type = 'short_special' THEN 'short_special'
            WHEN ri.quota_type = 'requests' THEN 'short'
            ELSE ri.quota_type
        END AS quota_type,
        ri.expected_reset_at,
        ri.remaining_pct,
        ri.fromDate AS interval_start
    FROM public.rate_limit_intervals ri
    WHERE ri.quota_type IN ('weekly', 'weekly_special', 'requests', 'monthly')
      AND ri.expected_reset_at IS NOT NULL
      AND ri.expected_reset_at >= $1::timestamptz
      AND ri.expected_reset_at < $2::timestamptz
),
window_bounds AS (
    SELECT
        provider,
        model,
        quota_type,
        expected_reset_at,
        MIN(interval_start) AS interval_start,
        MIN(remaining_pct)::double precision AS min_remaining_pct,
        MAX(remaining_pct)::double precision AS max_remaining_pct
    FROM normalized
    GROUP BY provider, model, quota_type, expected_reset_at
),
per_model_usage AS (
    SELECT
        wb.provider,
        wb.model AS quota_model,
        wb.quota_type,
        wb.expected_reset_at,
        COALESCE(sh.model, 'unknown') AS sh_model,
        SUM(
            COALESCE(sh.input_tokens, 0)
            + COALESCE(sh.output_tokens, 0)
            + COALESCE(sh.cache_read_input_tokens, 0)
            + COALESCE(sh.cache_creation_input_tokens, 0)
            + COALESCE(sh.reasoning_tokens_reported, 0)
            + COALESCE(sh.reasoning_tokens_estimated, 0)
        )::double precision AS tokens,
        SUM(COALESCE(sh.response_cost_usd, 0))::double precision AS cost,
        COUNT(*)::double precision AS traces
    FROM window_bounds wb
    JOIN public.session_history sh
      ON (
              CASE
                  WHEN lower(COALESCE(sh.provider, 'unknown')) IN ('google', 'gemini') THEN 'google'
                  WHEN lower(COALESCE(sh.provider, 'unknown')) IN ('xai', 'x.ai') THEN 'xai'
                  WHEN lower(COALESCE(sh.provider, 'unknown')) LIKE 'xai/%' THEN 'xai'
                  WHEN lower(COALESCE(sh.provider, 'unknown')) = 'nvidia' THEN 'nvidia_nim'
                  WHEN lower(COALESCE(sh.provider, 'unknown')) LIKE 'nvidia_nim/%' THEN 'nvidia_nim'
                  WHEN lower(COALESCE(sh.provider, 'unknown')) LIKE 'nvidia/%' THEN 'nvidia_nim'
                  WHEN lower(COALESCE(sh.provider, 'unknown')) LIKE 'local/%' THEN 'local'
                  WHEN lower(COALESCE(sh.provider, 'unknown')) LIKE 'local_%' THEN 'local'
                  ELSE COALESCE(sh.provider, 'unknown')
              END
          ) = wb.provider
      AND sh.created_at >= wb.interval_start
      AND sh.created_at < wb.expected_reset_at
      AND (wb.model IS NULL OR sh.model = wb.model)
    GROUP BY wb.provider, wb.model, wb.quota_type, wb.expected_reset_at, COALESCE(sh.model, 'unknown')
)
SELECT
    wb.provider,
    wb.model,
    wb.quota_type,
    wb.expected_reset_at,
    wb.interval_start,
    wb.expected_reset_at AS interval_end,
    wb.min_remaining_pct,
    wb.max_remaining_pct,
    COALESCE(SUM(pmu.tokens), 0)::double precision AS usage_tokens,
    COALESCE(
        json_agg(
            json_build_object(
                'model', pmu.sh_model,
                'tokens', pmu.tokens,
                'cost', pmu.cost,
                'traces', pmu.traces
            )
            ORDER BY pmu.tokens DESC
        ) FILTER (WHERE pmu.sh_model IS NOT NULL),
        '[]'::json
    ) AS usage_breakdown
FROM window_bounds wb
LEFT JOIN per_model_usage pmu
  ON pmu.provider = wb.provider
  AND pmu.quota_type = wb.quota_type
  AND pmu.expected_reset_at = wb.expected_reset_at
  AND (pmu.quota_model IS NOT DISTINCT FROM wb.model)
GROUP BY
    wb.provider,
    wb.model,
    wb.quota_type,
    wb.expected_reset_at,
    wb.interval_start,
    wb.min_remaining_pct,
    wb.max_remaining_pct
ORDER BY wb.expected_reset_at DESC;
`

  return { sql, values: [from, to] }
}

function buildFreshnessQuery() {
  return {
    sql: 'SELECT MAX(sh.created_at) AS latest_record_at FROM public.session_history sh;',
    values: [],
  }
}

// Wave 33: per-(provider, model) tool-activity breakdown.
// CTE 1 (outer_counts): raw call counts keyed by (provider, model, tool_kind, tool_name).
// CTE 2 (shell_labels): normalized command labels for tool_kind='command' rows,
//   skipping noise tokens and stripping flag-only second words.
// Final SELECT emits two kinds of rows:
//   kind='outer' — one row per (provider, model, tool_name)
//   kind='shell' — one row per (provider, model, cmd_label) for command rows
// Both are filtered to the caller's from/to date window via session_history.created_at.
function buildToolActivityQuery(searchParams) {
  const from = parseDateParam(searchParams.get('from'), defaultFromDate)
  const to = parseDateParam(searchParams.get('to'), defaultToDate)
  const values = [from, to]

  // Inline the same provider-normalisation CASE that providerDimension uses,
  // but referenced against sh.provider (the authoritative join column).
  const providerExpr = `
CASE
    WHEN lower(COALESCE(sh.provider, 'unknown')) IN ('google', 'gemini') THEN 'google'
    WHEN lower(COALESCE(sh.provider, 'unknown')) IN ('xai', 'x.ai') THEN 'xai'
    WHEN lower(COALESCE(sh.provider, 'unknown')) LIKE 'xai/%' THEN 'xai'
    WHEN lower(COALESCE(sh.provider, 'unknown')) = 'nvidia' THEN 'nvidia_nim'
    WHEN lower(COALESCE(sh.provider, 'unknown')) LIKE 'nvidia_nim/%' THEN 'nvidia_nim'
    WHEN lower(COALESCE(sh.provider, 'unknown')) LIKE 'nvidia/%' THEN 'nvidia_nim'
    WHEN lower(COALESCE(sh.provider, 'unknown')) LIKE 'local/%' THEN 'local'
    WHEN lower(COALESCE(sh.provider, 'unknown')) LIKE 'local_%' THEN 'local'
    ELSE COALESCE(sh.provider, 'unknown')
END`

  const sql = `
WITH outer_counts AS (
    SELECT
        ${providerExpr} AS provider,
        COALESCE(sh.model, 'unknown') AS model,
        COALESCE(a.tool_kind, 'other') AS tool_kind,
        a.tool_name,
        COUNT(*)::bigint AS calls
    FROM public.session_history_tool_activity a
    JOIN public.session_history sh ON a.litellm_call_id = sh.litellm_call_id
    WHERE (sh.created_at AT TIME ZONE 'America/New_York')::date >= $1::date
      AND (sh.created_at AT TIME ZONE 'America/New_York')::date < $2::date
    GROUP BY
        ${providerExpr},
        COALESCE(sh.model, 'unknown'),
        COALESCE(a.tool_kind, 'other'),
        a.tool_name
),
shell_labels AS (
    SELECT
        ${providerExpr} AS provider,
        COALESCE(sh.model, 'unknown') AS model,
        trim(
            CASE
                WHEN lower(split_part(trim(a.command_text), ' ', 1)) IN (
                    'git','npm','pnpm','yarn','docker','kubectl','gh','pip',
                    'poetry','uv','brew','apt','apt-get','systemctl','pytest',
                    'make','aws','gcloud','terraform'
                )
                THEN lower(split_part(trim(a.command_text), ' ', 1))
                     || ' '
                     || lower(NULLIF(
                            regexp_replace(
                                split_part(trim(a.command_text), ' ', 2),
                                '^-.*$', '', 'g'
                            ),
                            ''
                        ))
                ELSE lower(split_part(trim(a.command_text), ' ', 1))
            END
        ) AS cmd_label,
        COUNT(*)::bigint AS calls
    FROM public.session_history_tool_activity a
    JOIN public.session_history sh ON a.litellm_call_id = sh.litellm_call_id
    WHERE (sh.created_at AT TIME ZONE 'America/New_York')::date >= $1::date
      AND (sh.created_at AT TIME ZONE 'America/New_York')::date < $2::date
      AND a.tool_kind = 'command'
      AND a.command_text IS NOT NULL
      AND a.command_text <> ''
      AND lower(split_part(trim(a.command_text), ' ', 1)) NOT IN (
          'cd','pwd','echo',':','true','false','exit'
      )
    GROUP BY
        ${providerExpr},
        COALESCE(sh.model, 'unknown'),
        trim(
            CASE
                WHEN lower(split_part(trim(a.command_text), ' ', 1)) IN (
                    'git','npm','pnpm','yarn','docker','kubectl','gh','pip',
                    'poetry','uv','brew','apt','apt-get','systemctl','pytest',
                    'make','aws','gcloud','terraform'
                )
                THEN lower(split_part(trim(a.command_text), ' ', 1))
                     || ' '
                     || lower(NULLIF(
                            regexp_replace(
                                split_part(trim(a.command_text), ' ', 2),
                                '^-.*$', '', 'g'
                            ),
                            ''
                        ))
                ELSE lower(split_part(trim(a.command_text), ' ', 1))
            END
        )
)
SELECT
    provider,
    model,
    'outer' AS kind,
    tool_name AS label,
    calls
FROM outer_counts
UNION ALL
SELECT
    provider,
    model,
    'shell' AS kind,
    cmd_label AS label,
    calls
FROM shell_labels
ORDER BY provider ASC, model ASC, kind ASC, calls DESC;
`

  return { sql, values }
}

function normalizeToolActivityRow(row) {
  return {
    provider: row.provider ?? 'unknown',
    model: row.model ?? 'unknown',
    kind: row.kind,
    label: row.label,
    calls: normalizeNumber(row.calls) ?? 0,
  }
}

async function loadQuotaReport() {
  return cachedReport('quotas', async () => {
    const quotaQuery = buildQuotaQuery()
    const freshnessQuery = buildFreshnessQuery()
    const [quotaResult, freshnessResult] = await Promise.all([
      pool.query(quotaQuery.sql, quotaQuery.values),
      pool.query(freshnessQuery.sql, freshnessQuery.values),
    ])
    const freshness = buildFreshnessMetadata(
      firstRow(freshnessResult).latest_record_at
    )

    return {
      metadata: {
        ...freshness,
        staleRecordThresholdMinutes: STALE_RECORD_THRESHOLD_MINUTES,
      },
      quotas: quotaResult.rows.map(normalizeQuotaRow),
    }
  })
}

function normalizeSummary(row) {
  return {
    traces: normalizeNumber(row.traces) ?? 0,
    token_in: normalizeNumber(row.token_in) ?? 0,
    token_out: normalizeNumber(row.token_out) ?? 0,
    token_cache_input: normalizeNumber(row.token_cache_input) ?? 0,
    token_cache_creation: normalizeNumber(row.token_cache_creation) ?? 0,
    token_reasoning_reported:
      normalizeNumber(row.token_reasoning_reported) ?? 0,
    token_reasoning_estimated:
      normalizeNumber(row.token_reasoning_estimated) ?? 0,
    token_total: normalizeNumber(row.token_total) ?? 0,
    usd_cost: normalizeNumber(row.usd_cost) ?? 0,
    cache_miss_usd_cost: normalizeNumber(row.cache_miss_usd_cost) ?? 0,
    tool_calls: normalizeNumber(row.tool_calls) ?? 0,
    git_commit: normalizeNumber(row.git_commit) ?? 0,
    git_push: normalizeNumber(row.git_push) ?? 0,
    period_start: row.period_start ?? null,
    period_end: row.period_end ?? null,
    latest_record_at: row.latest_record_at ?? null,
  }
}

function normalizeTrendRow(row) {
  return {
    bucket: row.bucket,
    provider: row.provider,
    model: row.model,
    repository: row.repository,
    traces: normalizeNumber(row.traces) ?? 0,
    token_total: normalizeNumber(row.token_total) ?? 0,
    usd_cost: normalizeNumber(row.usd_cost) ?? 0,
  }
}

function normalizeClientUsageRow(row) {
  return {
    client_name: row.client_name ?? 'unknown',
    client_version: row.client_version ?? '0.0.0',
    first_seen_at: row.first_seen_at ?? null,
    last_seen_at: row.last_seen_at ?? null,
    traces: normalizeNumber(row.traces) ?? 0,
    token_total: normalizeNumber(row.token_total) ?? 0,
    usd_cost: normalizeNumber(row.usd_cost) ?? 0,
  }
}

function normalizeTextList(value) {
  if (value === null || value === undefined) return null
  if (Array.isArray(value)) return value.filter(Boolean).join(', ') || null
  if (typeof value === 'object') return JSON.stringify(value)
  const text = String(value).trim()
  return text || null
}

function normalizeProviderLatencyHealthRow(row) {
  return {
    bucket_start: row.bucket_start ?? null,
    environment: row.environment ?? 'unknown',
    provider: row.provider ?? 'unknown',
    model: row.model ?? 'unknown',
    model_group: row.model_group ?? 'unknown',
    requests: normalizeNumber(row.requests) ?? 0,
    passive_latency_sample_status:
      normalizeTextList(row.passive_latency_sample_status) ?? 'unknown',
    upstream_p50_ms: normalizeNumber(row.upstream_p50_ms),
    upstream_p95_ms: normalizeNumber(row.upstream_p95_ms),
    upstream_p99_ms: normalizeNumber(row.upstream_p99_ms),
    total_p95_ms: normalizeNumber(row.total_p95_ms),
    proxy_processing_p95_ms: normalizeNumber(row.proxy_processing_p95_ms),
    missing_upstream_latency:
      normalizeNumber(row.missing_upstream_latency) ?? 0,
    provider_error_events: normalizeNumber(row.provider_error_events) ?? 0,
    rate_limit_events: normalizeNumber(row.rate_limit_events) ?? 0,
    capacity_events: normalizeNumber(row.capacity_events) ?? 0,
    provider_5xx_events: normalizeNumber(row.provider_5xx_events) ?? 0,
    provider_timeout_events: normalizeNumber(row.provider_timeout_events) ?? 0,
    network_error_events: normalizeNumber(row.network_error_events) ?? 0,
    auth_failed_events: normalizeNumber(row.auth_failed_events) ?? 0,
    adapter_error_events: normalizeNumber(row.adapter_error_events) ?? 0,
    status_probe_count: normalizeNumber(row.status_probe_count) ?? 0,
    status_probe_success_pct: normalizeNumber(row.status_probe_success_pct),
    status_probe_p95_ms: normalizeNumber(row.status_probe_p95_ms),
    provider_ping_avg_ms: normalizeNumber(row.provider_ping_avg_ms),
    provider_ping_packet_loss_pct: normalizeNumber(
      row.provider_ping_packet_loss_pct
    ),
    control_ping_avg_ms: normalizeNumber(row.control_ping_avg_ms),
    control_packet_loss_pct: normalizeNumber(row.control_packet_loss_pct),
    control_probe_success_pct: normalizeNumber(row.control_probe_success_pct),
    provider_ping_minus_control_ms: normalizeNumber(
      row.provider_ping_minus_control_ms
    ),
    dns_failures: normalizeNumber(row.dns_failures) ?? 0,
    tcp_failures: normalizeNumber(row.tcp_failures) ?? 0,
    tls_failures: normalizeNumber(row.tls_failures) ?? 0,
    icmp_failures: normalizeNumber(row.icmp_failures) ?? 0,
    probed_endpoints: normalizeTextList(row.probed_endpoints),
    status_error_classes: normalizeTextList(row.status_error_classes),
    min_remaining_pct: normalizeNumber(row.min_remaining_pct),
    max_remaining_pct: normalizeNumber(row.max_remaining_pct),
    next_expected_reset_at: row.next_expected_reset_at ?? null,
    quota_keys: normalizeTextList(row.quota_keys),
    request_period_start: row.request_period_start ?? null,
    request_period_end: row.request_period_end ?? null,
  }
}

function normalizeProviderErrorObservationRow(row) {
  return {
    observed_at: row.observed_at ?? null,
    environment: row.environment ?? 'unknown',
    provider: row.provider ?? 'unknown',
    model: row.model ?? 'unknown',
    model_group: row.model_group ?? 'unknown',
    route_family: row.route_family ?? 'unknown',
    status_code: normalizeNumber(row.status_code),
    error_type: row.error_type ?? 'unknown',
    error_code: row.error_code ?? 'unknown',
    error_class: row.error_class ?? 'unknown',
    retry_after_seconds: normalizeNumber(row.retry_after_seconds),
    expected_reset_at: row.expected_reset_at ?? null,
  }
}

function normalizeProviderStatusUsageRow(row) {
  return {
    provider: row.provider ?? 'unknown',
    model: row.model ?? 'unknown',
    traces: normalizeNumber(row.traces) ?? 0,
    token_total: normalizeNumber(row.token_total) ?? 0,
    usd_cost: normalizeNumber(row.usd_cost) ?? 0,
    period_start: row.period_start ?? null,
    period_end: row.period_end ?? null,
  }
}

function normalizeUsageBreakdown(value) {
  if (!Array.isArray(value)) return []
  return value.map((item) => ({
    model: item?.model ?? 'unknown',
    tokens: normalizeNumber(item?.tokens) ?? 0,
    cost: normalizeNumber(item?.cost) ?? 0,
    traces: normalizeNumber(item?.traces) ?? 0,
  }))
}

function normalizeQuotaRow(row) {
  return {
    provider: row.provider,
    model: row.model ?? null,
    weekly_remaining_pct: normalizeNumber(row.weekly_remaining_pct),
    weekly_reset_at: row.weekly_reset_at ?? null,
    weekly_interval_start: row.weekly_interval_start ?? null,
    weekly_interval_end: row.weekly_interval_end ?? null,
    weekly_active: Boolean(normalizeNumber(row.weekly_active)),
    weekly_usage_tokens: normalizeNumber(row.weekly_usage_tokens) ?? 0,
    weekly_usage_breakdown: normalizeUsageBreakdown(
      row.weekly_usage_breakdown
    ),
    short_remaining_pct: normalizeNumber(row.short_remaining_pct),
    short_reset_at: row.short_reset_at ?? null,
    short_interval_start: row.short_interval_start ?? null,
    short_interval_end: row.short_interval_end ?? null,
    short_active: Boolean(normalizeNumber(row.short_active)),
    short_usage_tokens: normalizeNumber(row.short_usage_tokens) ?? 0,
    short_usage_breakdown: normalizeUsageBreakdown(row.short_usage_breakdown),
    special_remaining_pct: normalizeNumber(row.special_remaining_pct),
    special_reset_at: row.special_reset_at ?? null,
    special_interval_start: row.special_interval_start ?? null,
    special_interval_end: row.special_interval_end ?? null,
    special_active: Boolean(normalizeNumber(row.special_active)),
    special_usage_tokens: normalizeNumber(row.special_usage_tokens) ?? 0,
    special_usage_breakdown: normalizeUsageBreakdown(
      row.special_usage_breakdown
    ),
    short_special_remaining_pct: normalizeNumber(
      row.short_special_remaining_pct
    ),
    short_special_reset_at: row.short_special_reset_at ?? null,
    short_special_interval_start: row.short_special_interval_start ?? null,
    short_special_interval_end: row.short_special_interval_end ?? null,
    short_special_active: Boolean(normalizeNumber(row.short_special_active)),
    short_special_usage_tokens:
      normalizeNumber(row.short_special_usage_tokens) ?? 0,
    short_special_usage_breakdown: normalizeUsageBreakdown(
      row.short_special_usage_breakdown
    ),
    monthly_remaining_pct: normalizeNumber(row.monthly_remaining_pct),
    monthly_reset_at: row.monthly_reset_at ?? null,
    monthly_interval_start: row.monthly_interval_start ?? null,
    monthly_interval_end: row.monthly_interval_end ?? null,
    monthly_active: Boolean(normalizeNumber(row.monthly_active)),
    monthly_usage_tokens: normalizeNumber(row.monthly_usage_tokens) ?? 0,
    monthly_usage_breakdown: normalizeUsageBreakdown(
      row.monthly_usage_breakdown
    ),
  }
}

function normalizeQuotaHistoryRow(row) {
  return {
    provider: row.provider ?? 'unknown',
    model: row.model ?? null,
    quota_type: row.quota_type ?? 'unknown',
    expected_reset_at: row.expected_reset_at ?? null,
    interval_start: row.interval_start ?? null,
    interval_end: row.interval_end ?? null,
    min_remaining_pct: normalizeNumber(row.min_remaining_pct),
    max_remaining_pct: normalizeNumber(row.max_remaining_pct),
    usage_tokens: normalizeNumber(row.usage_tokens) ?? 0,
    usage_breakdown: Array.isArray(row.usage_breakdown)
      ? row.usage_breakdown.map((b) => ({
          model: b.model ?? 'unknown',
          tokens: normalizeNumber(b.tokens) ?? 0,
          cost: normalizeNumber(b.cost) ?? 0,
          traces: normalizeNumber(b.traces) ?? 0,
        }))
      : [],
  }
}

function buildFreshnessMetadata(latestRecordAt) {
  const generatedAt = new Date()
  if (!latestRecordAt) {
    return {
      generatedAt: generatedAt.toISOString(),
      latestRecordAt: null,
      latestRecordAgeMinutes: null,
      latestRecordStale: true,
    }
  }

  const latest = new Date(latestRecordAt)
  const ageMinutes = Math.max(
    0,
    Math.round((generatedAt.getTime() - latest.getTime()) / 60_000)
  )

  return {
    generatedAt: generatedAt.toISOString(),
    latestRecordAt: latest.toISOString(),
    latestRecordAgeMinutes: ageMinutes,
    latestRecordStale: ageMinutes > STALE_RECORD_THRESHOLD_MINUTES,
  }
}

function proxyTargetUrl(req) {
  const requestUrl = new URL(req.url, `http://${req.headers.host}`)
  const base = new URL(AAWM_TAP_API_TARGET)
  const rewrittenPath = requestUrl.pathname.replace(/^\/api\/aawm-tap\/?/, '/')
  base.pathname = joinUrlPath(base.pathname, rewrittenPath)
  base.search = requestUrl.search
  return base
}

function joinUrlPath(basePath, requestPath) {
  const normalizedBase = basePath.endsWith('/')
    ? basePath.slice(0, -1)
    : basePath
  const normalizedRequest = requestPath.startsWith('/')
    ? requestPath
    : `/${requestPath}`
  return `${normalizedBase}${normalizedRequest}`
}

function proxyHeaders(req) {
  const headers = {}
  for (const [key, value] of Object.entries(req.headers)) {
    const lowerKey = key.toLowerCase()
    if (HOP_BY_HOP_HEADERS.has(lowerKey) || CLIENT_AUTH_HEADERS.has(lowerKey)) {
      continue
    }
    if (Array.isArray(value)) {
      headers[key] = value.join(', ')
    } else if (value !== undefined) {
      headers[key] = value
    }
  }

  if (AAWM_TAP_API_KEY) {
    headers['X-API-Key'] = AAWM_TAP_API_KEY
  }
  if (AAWM_TAP_ACCESS_TOKEN) {
    headers.Authorization = AAWM_TAP_ACCESS_TOKEN.toLowerCase().startsWith(
      'bearer '
    )
      ? AAWM_TAP_ACCESS_TOKEN
      : `Bearer ${AAWM_TAP_ACCESS_TOKEN}`
  }
  if (AAWM_TAP_ADMIN_CAPABILITY) {
    headers['X-Admin-Capability'] = AAWM_TAP_ADMIN_CAPABILITY
  }

  return headers
}

function responseHeaders(upstreamHeaders) {
  const headers = {}
  upstreamHeaders.forEach((value, key) => {
    const lowerKey = key.toLowerCase()
    if (!HOP_BY_HOP_HEADERS.has(lowerKey) && lowerKey !== 'set-cookie') {
      headers[key] = value
    }
  })
  headers['cache-control'] = headers['cache-control'] ?? 'no-store'
  return headers
}

async function readRequestBody(req) {
  const chunks = []
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  }
  return chunks.length ? Buffer.concat(chunks) : undefined
}

function buildUsageQuery(searchParams) {
  const grain = searchParams.get('grain') ?? 'day'
  if (!grains[grain]) {
    throw new Error(`Unsupported grain: ${grain}`)
  }

  const groupBy = parseGroupBy(searchParams.get('group_by'))
  const from = parseDateParam(searchParams.get('from'), defaultFromDate)
  const to = parseDateParam(searchParams.get('to'), defaultToDate)
  const limit = parseLimit(searchParams.get('limit'))
  const sort = sortColumns[searchParams.get('sort') ?? 'period_end']
  if (!sort) {
    throw new Error(`Unsupported sort: ${searchParams.get('sort')}`)
  }

  const sortDirection =
    searchParams.get('direction')?.toLowerCase() === 'asc' ? 'ASC' : 'DESC'

  const values = [from, to]
  const whereParts = [
    `${createdAtEastern}::date >= $1::date`,
    `${createdAtEastern}::date < $2::date`,
  ]

  for (const key of Object.keys(filterColumns)) {
    appendMultiValueFilter(searchParams, key, whereParts, values)
  }

  values.push(limit)

  const bucketExpression = grains[grain]
  const dimensionSelects = groupBy.map(
    (key) => `${dimensions[key]} AS ${key}`
  )
  const dimensionGroups = groupBy.map((key) => dimensions[key])
  const selectParts = [`${bucketExpression} AS bucket`, ...dimensionSelects]
  const groupParts = [bucketExpression, ...dimensionGroups]

  const sql = `
SELECT
    ${selectParts.join(',\n    ')},

    MIN(weekly.expected_reset_at) AS weekly_reset_first,
    MAX(weekly.expected_reset_at) AS weekly_reset_last,
    MIN(weekly.remaining_pct) AS min_weekly_pct,
    MAX(weekly.remaining_pct) AS max_weekly_pct,

    MIN(COALESCE(short.expected_reset_at, requests.expected_reset_at)) AS short_reset_first,
    MAX(COALESCE(short.expected_reset_at, requests.expected_reset_at)) AS short_reset_last,
    MIN(COALESCE(short.remaining_pct, requests.remaining_pct)) AS min_short_pct,
    MAX(COALESCE(short.remaining_pct, requests.remaining_pct)) AS max_short_pct,

    MIN(weekly_special.expected_reset_at) AS weekly_reset_special_first,
    MAX(weekly_special.expected_reset_at) AS weekly_reset_special_last,
    MIN(weekly_special.remaining_pct) AS min_weekly_pct_special,
    MAX(weekly_special.remaining_pct) AS max_weekly_pct_special,

    MIN(short_special.expected_reset_at) AS short_reset_special_first,
    MAX(short_special.expected_reset_at) AS short_reset_special_last,
    MIN(short_special.remaining_pct) AS min_short_pct_special,
    MAX(short_special.remaining_pct) AS max_short_pct_special,

    COUNT(*)::double precision AS traces,
    SUM(COALESCE(sh.input_tokens, 0))::double precision AS token_in,
    SUM(COALESCE(sh.output_tokens, 0))::double precision AS token_out,
    SUM(COALESCE(sh.cache_read_input_tokens, 0))::double precision AS token_cache_input,
    SUM(COALESCE(sh.cache_creation_input_tokens, 0))::double precision AS token_cache_creation,

    STRING_AGG(DISTINCT
        CASE WHEN sh.reasoning_tokens_source = 'not_applicable'
             THEN NULL
             ELSE sh.reasoning_tokens_source
        END, ', ') AS reasoning_tokens_sources,

    SUM(COALESCE(sh.reasoning_tokens_reported, 0))::double precision AS token_reasoning_reported,
    SUM(COALESCE(sh.reasoning_tokens_estimated, 0))::double precision AS token_reasoning_estimated,

    MAX(CASE WHEN sh.provider_cache_attempted THEN 'attempted' ELSE NULL END) AS cache_attempted_summary,
    MAX(CASE WHEN sh.provider_cache_miss THEN 'miss' ELSE NULL END) AS cache_miss_summary,

    STRING_AGG(DISTINCT
        CASE WHEN sh.provider_cache_miss_reason IS NOT NULL
                  AND sh.provider_cache_miss_reason <> 'null'
             THEN sh.provider_cache_miss_reason
             ELSE NULL
        END, ', ') AS cache_miss_reasons,

    SUM(COALESCE(sh.provider_cache_miss_token_count, 0))::double precision AS token_cache_miss,
    SUM(COALESCE(sh.input_tokens, 0)
      + COALESCE(sh.output_tokens, 0)
      + COALESCE(sh.cache_read_input_tokens, 0)
      + COALESCE(sh.cache_creation_input_tokens, 0)
      + COALESCE(sh.reasoning_tokens_reported, 0)
      + COALESCE(sh.reasoning_tokens_estimated, 0))::double precision AS token_total,
    SUM(COALESCE(sh.provider_cache_miss_cost_usd, 0))::double precision AS cache_miss_usd_cost,
    SUM(COALESCE(sh.response_cost_usd, 0))::double precision AS usd_cost,
    SUM(COALESCE(sh.tool_call_count, 0))::double precision AS tool_calls,
    SUM(COALESCE(sh.git_commit_count, 0))::double precision AS git_commit,
    SUM(COALESCE(sh.git_push_count, 0))::double precision AS git_push,

    ROUND(CAST(SUM(COALESCE(sh.litellm_processing_ms, 0)) AS numeric), 2)::double precision AS litellm_processing_total_ms,
    ROUND(CAST(AVG(sh.litellm_processing_ms) AS numeric), 2)::double precision AS litellm_processing_average_ms,

    ROUND(CAST(SUM(COALESCE(sh.llm_upstream_elapsed_ms, 0)) AS numeric), 2)::double precision AS llm_upstream_elapsed_total_ms,
    ROUND(CAST(AVG(sh.llm_upstream_elapsed_ms) AS numeric), 2)::double precision AS llm_upstream_elapsed_average_ms,

    MIN(sh.start_time) AS period_start,
    MAX(sh.end_time) AS period_end
FROM public.session_history sh
LEFT JOIN LATERAL (
    SELECT ri.expected_reset_at, ri.remaining_pct
    FROM public.rate_limit_intervals ri
    WHERE ri.provider = sh.provider
      AND ri.quota_type = 'weekly'
      AND ri.fromDate <= sh.start_time
      AND ri.toDate > sh.start_time
    ORDER BY ri.fromDate DESC
    LIMIT 1
) weekly ON true
LEFT JOIN LATERAL (
    SELECT ri.expected_reset_at, ri.remaining_pct
    FROM public.rate_limit_intervals ri
    WHERE ri.provider = sh.provider
      AND ri.quota_type = 'short'
      AND ri.fromDate <= sh.start_time
      AND ri.toDate > sh.start_time
    ORDER BY ri.fromDate DESC
    LIMIT 1
) short ON true
LEFT JOIN LATERAL (
    SELECT ri.expected_reset_at, ri.remaining_pct
    FROM public.rate_limit_intervals ri
    WHERE ri.provider = sh.provider
      AND ri.quota_type = 'weekly_special'
      AND ri.fromDate <= sh.start_time
      AND ri.toDate > sh.start_time
    ORDER BY ri.fromDate DESC
    LIMIT 1
) weekly_special ON true
LEFT JOIN LATERAL (
    SELECT ri.expected_reset_at, ri.remaining_pct
    FROM public.rate_limit_intervals ri
    WHERE ri.provider = sh.provider
      AND ri.quota_type = 'short_special'
      AND ri.fromDate <= sh.start_time
      AND ri.toDate > sh.start_time
    ORDER BY ri.fromDate DESC
    LIMIT 1
) short_special ON true
LEFT JOIN LATERAL (
    SELECT ri.expected_reset_at, ri.remaining_pct
    FROM public.rate_limit_intervals ri
    WHERE ri.provider = replace(sh.provider, 'gemini', 'google')
      AND ri.quota_type = 'requests'
      AND ri.model = sh.model
      AND ri.fromDate <= sh.start_time
      AND ri.toDate > sh.start_time
    ORDER BY ri.fromDate DESC
    LIMIT 1
) requests ON true
WHERE ${whereParts.join('\n  AND ')}
GROUP BY
    ${groupParts.join(',\n    ')}
ORDER BY ${sort} ${sortDirection}
LIMIT $${values.length};
`

  return { sql, values, metadata: { from, to, grain, groupBy, limit } }
}

async function handleUsageReport(req, res) {
  if (!pool) {
    sendJson(res, 503, {
      error: 'DATABASE_URL is not configured for the shell report service.',
    })
    return
  }

  const requestUrl = new URL(req.url, `http://${req.headers.host}`)
  const body = await cachedReport(`usage:${requestUrl.search}`, async () => {
    const { sql, values, metadata } = buildUsageQuery(requestUrl.searchParams)
    const summaryQuery = buildSummaryQuery(requestUrl.searchParams)
    const trendQuery = buildTrendQuery(requestUrl.searchParams)
    const clientUsageQuery = buildClientUsageQuery(requestUrl.searchParams)
    const providerLatencyHealthQuery = buildProviderLatencyHealthQuery()
    const providerErrorObservationQuery = buildProviderErrorObservationQuery()
    const providerStatusUsageQuery = buildProviderStatusUsageQuery(requestUrl.searchParams)
    const quotaHistoryQuery = buildQuotaHistoryQuery(requestUrl.searchParams)
    const toolActivityQuery = buildToolActivityQuery(requestUrl.searchParams)
    const quotaReportPromise = loadQuotaReport()

    const [
      result,
      summaryResult,
      trendResult,
      clientUsageResult,
      providerLatencyHealthResult,
      providerErrorObservationResult,
      providerStatusUsageResult,
      quotaHistoryResult,
      toolActivityResult,
      quotaReport,
    ] = await Promise.all([
      pool.query(sql, values),
      pool.query(summaryQuery.sql, summaryQuery.values),
      pool.query(trendQuery.sql, trendQuery.values),
      pool.query(clientUsageQuery.sql, clientUsageQuery.values),
      pool.query(
        providerLatencyHealthQuery.sql,
        providerLatencyHealthQuery.values
      ),
      pool.query(
        providerErrorObservationQuery.sql,
        providerErrorObservationQuery.values
      ),
      pool.query(providerStatusUsageQuery.sql, providerStatusUsageQuery.values),
      pool.query(quotaHistoryQuery.sql, quotaHistoryQuery.values),
      pool.query(toolActivityQuery.sql, toolActivityQuery.values),
      quotaReportPromise,
    ])

    const rows = result.rows.map(normalizeRow)
    const summary = normalizeSummary(firstRow(summaryResult))

    return {
      metadata: {
        ...metadata,
        ...quotaReport.metadata,
        staleRecordThresholdMinutes: STALE_RECORD_THRESHOLD_MINUTES,
      },
      summary,
      trend: trendResult.rows.map(normalizeTrendRow),
      clients: clientUsageResult.rows.map(normalizeClientUsageRow),
      providerLatencyHealth: providerLatencyHealthResult.rows.map(
        normalizeProviderLatencyHealthRow
      ),
      providerErrorObservations: providerErrorObservationResult.rows.map(
        normalizeProviderErrorObservationRow
      ),
      providerStatusUsage: providerStatusUsageResult.rows.map(
        normalizeProviderStatusUsageRow
      ),
      quotas: quotaReport.quotas,
      quotaHistory: quotaHistoryResult.rows.map(normalizeQuotaHistoryRow),
      toolActivity: toolActivityResult.rows.map(normalizeToolActivityRow),
      rows,
    }
  })

  sendJson(res, 200, body)
}

async function handleUsageQuotas(_req, res) {
  if (!pool) {
    sendJson(res, 503, {
      error: 'DATABASE_URL is not configured for the shell report service.',
    })
    return
  }

  sendJson(res, 200, await loadQuotaReport())
}

async function handleAawmTapProxy(req, res) {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), UPSTREAM_FETCH_TIMEOUT_MS)
  let upstreamResponse
  try {
    upstreamResponse = await fetch(proxyTargetUrl(req), {
      method: req.method,
      headers: proxyHeaders(req),
      signal: controller.signal,
      body:
        req.method === 'GET' || req.method === 'HEAD'
          ? undefined
          : await readRequestBody(req),
    })
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      sendJson(res, 504, {
        error: `AAWM TAP upstream timed out after ${UPSTREAM_FETCH_TIMEOUT_MS}ms.`,
      })
      return
    }
    throw error
  } finally {
    clearTimeout(timeout)
  }

  const body = Buffer.from(await upstreamResponse.arrayBuffer())
  res.writeHead(upstreamResponse.status, responseHeaders(upstreamResponse.headers))
  res.end(body)
}

async function handleRequest(req, res) {
  const requestUrl = new URL(req.url, `http://${req.headers.host}`)

  if (req.method === 'GET' && requestUrl.pathname === '/api/shell/health') {
    sendJson(res, 200, {
      ok: true,
      databaseConfigured: Boolean(pool),
    })
    return
  }

  if (
    req.method === 'GET' &&
    requestUrl.pathname === '/api/shell/reports/usage'
  ) {
    await handleUsageReport(req, res)
    return
  }

  if (
    req.method === 'GET' &&
    requestUrl.pathname === '/api/shell/reports/quotas'
  ) {
    await handleUsageQuotas(req, res)
    return
  }

  if (requestUrl.pathname.startsWith('/api/aawm-tap')) {
    await handleAawmTapProxy(req, res)
    return
  }

  sendJson(res, 404, { error: 'Not found' })
}

const server = http.createServer((req, res) => {
  handleRequest(req, res).catch((error) => {
    const message =
      error instanceof Error && error.message ? error.message : 'Unexpected error'
    sendJson(res, 500, {
      error: message,
    })
  })
})

server.listen(PORT, '0.0.0.0', () => {
  process.stdout.write(`dashboard-shell report service listening on ${PORT}\n`)
})

async function shutdown() {
  await pool?.end()
  server.close(() => process.exit(0))
}

process.on('SIGTERM', () => {
  void shutdown()
})
process.on('SIGINT', () => {
  void shutdown()
})
