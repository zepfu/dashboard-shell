/**
 * report-service-query-builders — server-side test suite.
 *
 * Moved from: src/features/dashboard/lib/report-service-query-builders.test.ts
 * Reason: `report-service.mjs` pulls Node-native modules, so this suite runs in
 * the server vitest project (Node environment) instead of the frontend jsdom
 * project.
 */
import { describe, expect, test } from 'vitest'
import {
  buildAegisPgBouncerAdminDatabaseUrl,
  buildPgBouncerAdminDatabaseUrl,
  buildQuotaEstimatorObservationQuery,
  buildQuotaEstimatorReport,
  buildQuotaEstimatorUsageBucketQuery,
  buildQuotaHistoryQuery,
  buildQuotaHistoryFallbackQuery,
  buildQuotaRangeHistoryFallbackQuery,
  buildQuotaQuery,
  normalizeQuotaRow,
  buildQuotaVelocityQuery,
  buildQuotaRangeHistoryQuery,
  buildDegradedUsageQuotaHistoryReport,
  buildDegradedUsageQuotaRangeHistoryReport,
  buildDegradedQuotaReport,
  buildDegradedUsageTokenTrendSummaryReport,
  USAGE_TOKEN_TREND_SUMMARY_SUBQUERY_KEYS,
  buildDegradedUsageToolActivityReport,
  buildReportQueryPressureQuery,
  buildSessionDiagnosticsQuery,
  buildProviderAliasRoutingQuery,
  normalizeProviderAliasRoutingReport,
  buildProviderAuthHealthQuery,
  classifyProviderAuthHealthState,
  normalizeProviderAuthHealthRow,
  normalizeProviderAuthHealthReport,
  buildProviderCreditLifecycleQuery,
  filterLegacyProviderCreditAggregateRows,
  buildProviderCreditLifecycleSummaries,
  normalizeProviderCreditLifecycleRow,
  normalizeProviderCreditLifecycleReport,
  buildSourceTableHealthQuery,
  buildTokenTrendHealthQuery,
  buildTokenTrendHoursQuery,
  buildTokenTrendModelFirstSeenQuery,
  buildTokenTrendScoreQuery,
  buildTokenTrendDayDetailQuery,
  buildToolActivityQuery,
  buildUsageQuery,
  parseUsageReportSort,
  shouldIncludeTokenTrendHealth,
  applyTokenTrendSummaryHealthInclusion,
  findUpstreamApiProxy,
  shouldSuppressCacheRefreshFailureDuringShutdown,
  normalizePgBouncerPoolRow,
  normalizePgBouncerStatsRow,
  USAGE_REPORT_CACHE_SCOPE,
  compactUsageRow,
  shouldIncludeEmptyUsageRowFields,
  buildUsageReportRowSerializationMetadata,
  proxyTargetUrl,
} from './report-service'

function compactWhitespace(sql: string): string {
  return sql.replace(/\s+/g, ' ').trim()
}

function expectSelectAlias(sql: string, alias: string) {
  expect(compactWhitespace(sql).toUpperCase()).toMatch(
    new RegExp(`\\bAS\\s+${alias.toUpperCase()}\\b`)
  )
}

function assertNoShorthandMetadataProjection(sql: string) {
  expect(compactWhitespace(sql).toUpperCase()).not.toMatch(/\bMETADATA\b/)
}

async function parseSQL(sql: string): Promise<{
  version: unknown
  stmts: unknown[]
}> {
  const { parse } = await import('pgsql-parser')
  return (await parse(sql)) as { version: unknown; stmts: unknown[] }
}

async function expectParsableSQL(sql: string): Promise<void> {
  const parsed = await parseSQL(sql)
  expect(parsed).toHaveProperty('version')
  expect(Array.isArray(parsed.stmts)).toBe(true)
  expect(parsed.stmts.length).toBeGreaterThan(0)
}

// ---------------------------------------------------------------------------
// Helper: reportable-session-history filter assertions
// ---------------------------------------------------------------------------

function expectReportableSessionHistoryFilter(sql: string, alias = 'sh') {
  expect(sql).toContain(`${alias}.metadata->>'session_history_usage_record'`)
  expect(sql).toContain(
    `${alias}.metadata->>'session_history_reporting_excluded'`
  )
  expect(sql).toContain(
    `${alias}.metadata->>'session_history_model_reporting_excluded'`
  )
  expect(sql).toContain(`COALESCE(${alias}.input_tokens, 0)`)
  expect(sql).toContain(`COALESCE(${alias}.output_tokens, 0)`)
  expect(sql).toContain(`COALESCE(${alias}.cache_read_input_tokens, 0)`)
  expect(sql).toContain(`COALESCE(${alias}.cache_creation_input_tokens, 0)`)
  expect(sql).toContain(`COALESCE(${alias}.reasoning_tokens_reported, 0)`)
  expect(sql).toContain(`COALESCE(${alias}.reasoning_tokens_estimated, 0)`)
  expect(sql).toContain(`COALESCE(${alias}.response_cost_usd, 0)`)
  expect(sql).toContain(`COALESCE(${alias}.provider_cache_miss_cost_usd, 0)`)
  expect(sql).toContain(`COALESCE(${alias}.tool_call_count, 0) > 0`)
  expect(sql).toContain(`${alias}.metadata->>'passthrough_route_family'`)
  expect(sql).toContain(`${alias}.metadata->>'route_family'`)
  expect(sql).toContain('grok_cli_chat_proxy')
}

// ---------------------------------------------------------------------------
// S4-8: pgsql-parser parse-validation for each built SQL query
//
// These tests import `pgsql-parser` directly and assert against its real return
// shape: `{ version, stmts }`.
// ---------------------------------------------------------------------------

describe('SQL parse-validation (pgsql-parser) (S4-8)', () => {
  test('test_buildUsageQuery_sql_is_syntactically_valid', async () => {
    const query = buildUsageQuery(
      new URLSearchParams({
        from: '2026-05-01',
        to: '2026-05-08',
        grain: 'day',
        group_by: 'provider,model,repository',
        limit: '50000',
      })
    )

    await expectParsableSQL(query.sql)
  })

  test('test_buildQuotaQuery_sql_is_syntactically_valid', async () => {
    const query = buildQuotaQuery()
    await expectParsableSQL(query.sql)
  })

  test('test_buildTokenTrendHoursQuery_sql_is_syntactically_valid', async () => {
    const query = buildTokenTrendHoursQuery(
      new URLSearchParams({ from: '2026-05-01', to: '2026-05-08' })
    )
    await expectParsableSQL(query.sql)
  })

  test('test_buildTokenTrendScoreQuery_sql_is_syntactically_valid', async () => {
    const query = buildTokenTrendScoreQuery(
      new URLSearchParams({
        from: '2026-05-01',
        to: '2026-05-08',
        provider: 'anthropic',
      })
    )
    await expectParsableSQL(query.sql)
  })

  test('test_buildTokenTrendModelFirstSeenQuery_sql_is_syntactically_valid', async () => {
    const query = buildTokenTrendModelFirstSeenQuery(
      new URLSearchParams({ from: '2026-05-01', to: '2026-05-08' })
    )
    await expectParsableSQL(query.sql)
  })

  test('test_buildTokenTrendHealthQuery_sql_is_syntactically_valid', async () => {
    const query = buildTokenTrendHealthQuery(
      new URLSearchParams({ from: '2026-05-01', to: '2026-05-08' })
    )
    await expectParsableSQL(query.sql)
  })

  test('test_buildToolActivityQuery_sql_is_syntactically_valid', async () => {
    const query = buildToolActivityQuery(
      new URLSearchParams({ from: '2026-05-01', to: '2026-05-08' })
    )
    await expectParsableSQL(query.sql)
  })

  test('test_buildQuotaRangeHistoryQuery_sql_is_syntactically_valid', async () => {
    const query = buildQuotaRangeHistoryQuery(
      new URLSearchParams({ from: '2026-05-01', to: '2026-05-08' })
    )
    await expectParsableSQL(query.sql)
  })

  test('test_buildQuotaRangeHistoryFallbackQuery_sql_is_syntactically_valid', async () => {
    const query = buildQuotaRangeHistoryFallbackQuery(
      new URLSearchParams({ from: '2026-05-01', to: '2026-05-08' })
    )
    await expectParsableSQL(query.sql)
  })

  test('test_buildQuotaHistoryQuery_sql_is_syntactically_valid', async () => {
    const query = buildQuotaHistoryQuery(new URLSearchParams())
    await expectParsableSQL(query.sql)
  })

  test('test_buildQuotaEstimatorUsageBucketQuery_sql_is_syntactically_valid', async () => {
    const query = buildQuotaEstimatorUsageBucketQuery(
      new URLSearchParams({ from: '2026-05-01', to: '2026-05-08' })
    )
    await expectParsableSQL(query.sql)
  })

  test('test_buildQuotaEstimatorObservationQuery_sql_is_syntactically_valid', async () => {
    const query = buildQuotaEstimatorObservationQuery(
      new URLSearchParams({ from: '2026-05-01', to: '2026-05-08' })
    )
    await expectParsableSQL(query.sql)
  })

  test('test_buildSourceTableHealthQuery_sql_is_syntactically_valid', async () => {
    const query = buildSourceTableHealthQuery()
    await expectParsableSQL(query.sql)
  })

  test('test_buildReportQueryPressureQuery_sql_is_syntactically_valid', async () => {
    const query = buildReportQueryPressureQuery()
    await expectParsableSQL(query.sql)
  })
})

// ---------------------------------------------------------------------------
// S4-6: buildQuotaEstimatorObservationQuery value assertions
//
// These tests run WITHOUT pgsql-parser (they use string-contains assertions).
// These run in the server vitest project that owns report-service query builder
// contracts and parser-backed behavior checks.
// ---------------------------------------------------------------------------

describe('buildQuotaEstimatorObservationQuery value assertions (S4-6)', () => {
  test('test_buildQuotaEstimatorObservationQuery_returns_correct_values_array', () => {
    const query = buildQuotaEstimatorObservationQuery(
      new URLSearchParams({ from: '2026-05-01', to: '2026-05-08' })
    )

    // Must bind from/to as date-string parameters
    expect(query.values).toEqual(['2026-05-01', '2026-05-08'])
    expect(query.metadata).toEqual({ from: '2026-05-01', to: '2026-05-08' })
  })

  test('test_buildQuotaEstimatorObservationQuery_covers_all_anthropic_quota_keys', () => {
    const query = buildQuotaEstimatorObservationQuery(
      new URLSearchParams({ from: '2026-05-01', to: '2026-05-08' })
    )

    // Anthropic quota keys must all be present in the IN list
    expect(query.sql).toContain("'anthropic_unified_5h:5h'")
    expect(query.sql).toContain("'anthropic_unified_7d:7d'")
    expect(query.sql).toContain("'anthropic_unified_7d_sonnet:7d_sonnet'")
  })

  test('test_buildQuotaEstimatorObservationQuery_covers_all_openai_quota_keys', () => {
    const query = buildQuotaEstimatorObservationQuery(
      new URLSearchParams({ from: '2026-05-01', to: '2026-05-08' })
    )

    // OpenAI quota keys must all be present in the IN list
    expect(query.sql).toContain("'codex:primary'")
    expect(query.sql).toContain("'codex:secondary'")
    expect(query.sql).toContain("'codex_bengalfox:primary'")
    expect(query.sql).toContain("'codex_bengalfox:secondary'")
  })

  test('test_buildQuotaEstimatorObservationQuery_maps_quota_keys_to_lane_names', () => {
    const query = buildQuotaEstimatorObservationQuery(
      new URLSearchParams({ from: '2026-05-01', to: '2026-05-08' })
    )

    // Lane name mappings must be correct per the business rules
    expect(query.sql).toContain("'anthropic_5h_all_model'")
    expect(query.sql).toContain("'anthropic_weekly_all_model'")
    expect(query.sql).toContain("'anthropic_weekly_sonnet'")
    expect(query.sql).toContain("'openai_5h_all_model'")
    expect(query.sql).toContain("'openai_weekly_all_model'")
    expect(query.sql).toContain("'openai_codex_spark_5h'")
    expect(query.sql).toContain("'openai_codex_spark_weekly'")
  })

  test('test_buildQuotaEstimatorObservationQuery_uses_rate_limit_observations_table', () => {
    const query = buildQuotaEstimatorObservationQuery(
      new URLSearchParams({ from: '2026-05-01', to: '2026-05-08' })
    )

    expect(query.sql).toContain('public.rate_limit_observations')
    expect(query.sql).toContain('public.rate_limit_intervals')
    // Must not reference session_history (that's the dataset query)
    expect(query.sql).not.toContain('public.session_history')
  })

  test('test_buildQuotaEstimatorObservationQuery_orders_results_deterministically', () => {
    const query = buildQuotaEstimatorObservationQuery(
      new URLSearchParams({ from: '2026-05-01', to: '2026-05-08' })
    )

    // Must have ORDER BY for deterministic output (required for velocity computation)
    expect(query.sql).toContain('ORDER BY')
    expect(query.sql).toContain('o.provider ASC')
    expect(query.sql).toContain('o.quota_key ASC')
    expect(query.sql).toContain('o.observed_at ASC')
  })

  test('test_buildQuotaEstimatorObservationQuery_clamps_consumed_pct_to_0_100', () => {
    const query = buildQuotaEstimatorObservationQuery(
      new URLSearchParams({ from: '2026-05-01', to: '2026-05-08' })
    )

    // Consumed PCT must be clamped: GREATEST(0, LEAST(100, 100 - remaining_pct))
    expect(query.sql).toContain('GREATEST(0')
    expect(query.sql).toContain('LEAST(100')
    expect(query.sql).toContain('100 - o.remaining_pct')
  })

  test('test_buildQuotaEstimatorObservationQuery_joins_reset_windows_for_interval_bounds', () => {
    const query = buildQuotaEstimatorObservationQuery(
      new URLSearchParams({ from: '2026-05-01', to: '2026-05-08' })
    )

    // The LEFT JOIN between observations and reset_windows must be present
    expect(query.sql).toContain('LEFT JOIN reset_windows rw')
    // JOIN keys: provider, quota_key, expected_reset_at
    expect(query.sql).toContain('rw.provider = o.provider')
    expect(query.sql).toContain('rw.quota_key = o.quota_key')
    expect(query.sql).toContain(
      'rw.expected_reset_at IS NOT DISTINCT FROM o.expected_reset_at'
    )
  })

  test('test_buildQuotaEstimatorObservationQuery_filters_null_quota_types', () => {
    const query = buildQuotaEstimatorObservationQuery(
      new URLSearchParams({ from: '2026-05-01', to: '2026-05-08' })
    )

    // Rows where quota_type could not be determined (ELSE NULL) must be excluded
    expect(query.sql).toContain('WHERE o.quota_type IS NOT NULL')
  })

  test('test_buildQuotaEstimatorObservationQuery_date_range_scoped_to_observed_at', () => {
    const query = buildQuotaEstimatorObservationQuery(
      new URLSearchParams({ from: '2026-05-01', to: '2026-05-08' })
    )

    // Date filtering must use observed_at (not created_at or other timestamps)
    expect(query.sql).toContain('o.observed_at >=')
    expect(query.sql).toContain('o.observed_at <')
    // Must use New York timezone for consistent daily boundaries
    expect(query.sql).toContain("TIME ZONE 'America/New_York'")
  })
})

// ---------------------------------------------------------------------------
// S4-8: Reportable-filter sweep — all session_history-touching queries
// must include the full reportable-filter set
// ---------------------------------------------------------------------------

describe('reportable-filter sweep (S4-8)', () => {
  test('test_all_session_history_queries_have_reportable_filter', () => {
    const params = new URLSearchParams({
      from: '2026-05-01',
      to: '2026-05-08',
      provider: 'openai,anthropic',
    })
    const queries = [
      buildTokenTrendHoursQuery(params),
      buildTokenTrendScoreQuery(params),
      buildTokenTrendModelFirstSeenQuery(params),
      buildQuotaHistoryQuery(params),
      buildQuotaRangeHistoryQuery(params),
      buildQuotaEstimatorUsageBucketQuery(params),
      buildToolActivityQuery(params),
    ]

    for (const query of queries) {
      expectReportableSessionHistoryFilter(query.sql)
    }
  })
})

// ---------------------------------------------------------------------------
// Existing tests from src/features/dashboard/lib/report-service-query-builders.test.ts
// (moved verbatim; W10 adds pgsql-parser + observation-query assertions above)
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// D1-223/224/225 usage identity and billing contracts
// ---------------------------------------------------------------------------

describe('D1-223/224/225 usage identity and billing contracts', () => {
  const billingDetailFields = [
    'quota_limit',
    'quota_used',
    'quota_remaining',
    'billing_period_start_at',
    'billing_period_end_at',
    'raw_provider_fields',
    'evidence',
  ] as const

  test('test_buildUsageQuery_supports_inbound_model_alias_agent_name_and_agent_id_dimensions', () => {
    const query = buildUsageQuery(
      new URLSearchParams({
        from: '2026-05-01',
        to: '2026-05-08',
        grain: 'day',
        group_by: 'repository,inbound_model_alias,agent_name,agent_id',
        limit: '50000',
      })
    )

    expect(query.metadata.groupBy).toEqual([
      'repository',
      'inbound_model_alias',
      'agent_name',
      'agent_id',
    ])
    expect(query.sql).toContain('AS inbound_model_alias')
    expect(query.sql).toContain('AS agent_name')
    expect(query.sql).toContain('AS agent_id')
    expect(query.sql).toContain("NULLIF(sh.inbound_model_alias, '')")
    expect(query.sql).toContain("NULLIF(sh.agent_name, '')")
    expect(query.sql).toContain("NULLIF(sh.agent_id, '')")
  })

  test('test_buildUsageQuery_applies_inbound_model_alias_agent_name_and_agent_id_filters', () => {
    const query = buildUsageQuery(
      new URLSearchParams({
        from: '2026-05-01',
        to: '2026-05-08',
        grain: 'day',
        group_by: 'repository,provider_model',
        limit: '50000',
        inbound_model_alias: 'aawm-read-anthropic',
        agent_name: 'orchestrator',
        agent_id: 'agent_harness',
      })
    )

    expect(query.values).toContainEqual(['aawm-read-anthropic'])
    expect(query.values).toContainEqual(['orchestrator'])
    expect(query.values).toContainEqual(['agent_harness'])
    expect(query.sql).toContain(
      "COALESCE(NULLIF(sh.inbound_model_alias, ''), 'unknown_inbound_model') = ANY("
    )
    expect(query.sql).toContain(
      "COALESCE(NULLIF(sh.agent_name, ''), 'unknown_agent_name') = ANY("
    )
    expect(query.sql).toContain(
      "COALESCE(NULLIF(sh.agent_id, ''), 'uncaptured_agent_id') = ANY("
    )
  })

  test('test_buildUsageQuery_decodes_percent_encoded_csv_filter_elements', () => {
    const encodedClient = 'claude-cli%20%5B2.0.1%5D'
    const encodedProviderModel = 'openai%2Fgpt-4.1'
    const query = buildUsageQuery(
      new URLSearchParams({
        from: '2026-05-01',
        to: '2026-05-08',
        grain: 'day',
        group_by: 'repository,provider_model',
        limit: '50000',
        client: encodedClient,
        provider_model: encodedProviderModel,
      })
    )

    expect(query.values).toContainEqual(['claude-cli [2.0.1]'])
    expect(query.values).toContainEqual(['openai/gpt-4.1'])
    expect(query.values).not.toContainEqual([encodedClient])
    expect(query.values).not.toContainEqual([encodedProviderModel])
  })

  test('test_buildToolActivityQuery_includes_and_returns_agent_id_grouping', () => {
    const query = buildToolActivityQuery(
      new URLSearchParams({
        from: '2026-05-01',
        to: '2026-05-08',
        agent_id: 'agent_harness',
      })
    )

    expect(query.values).toEqual([
      '2026-05-01',
      '2026-05-08',
      5000,
      ['agent_harness'],
    ])
    expect(query.sql).toContain("NULLIF(a.agent_id, '')")
    expect(query.sql).toContain("NULLIF(sh.agent_id, '')")
    expect(query.sql).toContain('agent_name')
    expect(query.sql).toContain('GROUP BY')
    expect(query.sql).toMatch(/SELECT[\s\S]*agent_ids[\s\S]*FROM outer_counts/)
  })

  test('test_quota_queries_surface_billing_detail_fields_when_present', () => {
    const quotaQuery = buildQuotaQuery()
    const estimatorQuery = buildQuotaEstimatorObservationQuery(
      new URLSearchParams({ from: '2026-05-01', to: '2026-05-08' })
    )

    for (const field of billingDetailFields) {
      expect(quotaQuery.sql).toContain(field)
      expect(estimatorQuery.sql).toContain(field)
    }
    expect(quotaQuery.sql).toContain('public.rate_limit_observations')
    expect(estimatorQuery.sql).toContain('public.rate_limit_observations')
  })
})

// ---------------------------------------------------------------------------
// D1-444 direct column reads vs defensive to_jsonb extraction
// ---------------------------------------------------------------------------

describe('D1-444 direct column reads for confirmed schema columns', () => {
  test('test_session_history_and_tool_activity_queries_read_confirmed_columns_directly', () => {
    const usageQuery = buildUsageQuery(
      new URLSearchParams({
        from: '2026-05-01',
        to: '2026-05-08',
        grain: 'day',
        group_by: 'repository,inbound_model_alias,agent_name,agent_id',
        limit: '50000',
      })
    )
    const toolQuery = buildToolActivityQuery(
      new URLSearchParams({ from: '2026-05-01', to: '2026-05-08' })
    )
    const sessionQuery = buildSessionDiagnosticsQuery(
      new URLSearchParams({ from: '2026-05-01', to: '2026-05-08', limit: '5' })
    )

    for (const sql of [usageQuery.sql, toolQuery.sql, sessionQuery.sql]) {
      expect(sql).not.toMatch(/to_jsonb\(sh\)->>/)
    }
    expect(toolQuery.sql).not.toMatch(/to_jsonb\(a\)->>/)
    expect(usageQuery.sql).toContain('sh.inbound_model_alias')
    expect(usageQuery.sql).toContain('sh.agent_name')
    expect(usageQuery.sql).toContain('sh.agent_id')
    expect(toolQuery.sql).toContain('a.agent_id')
    expect(sessionQuery.sql).toContain('sh.trace_id')
    expect(sessionQuery.sql).toContain('sh.model_group')
  })

  test('test_rate_limit_observations_queries_read_confirmed_columns_directly', () => {
    const quotaQuery = buildQuotaQuery()
    const historyQuery = buildQuotaHistoryQuery(new URLSearchParams())
    const rangeQuery = buildQuotaRangeHistoryQuery(
      new URLSearchParams({ from: '2026-05-01', to: '2026-05-08' })
    )
    const estimatorQuery = buildQuotaEstimatorObservationQuery(
      new URLSearchParams({ from: '2026-05-01', to: '2026-05-08' })
    )

    for (const sql of [quotaQuery.sql, estimatorQuery.sql]) {
      expect(sql).toContain('o.quota_limit')
      expect(sql).toContain('o.quota_used')
      expect(sql).toContain('o.quota_remaining')
      expect(sql).toContain('o.billing_period_start_at')
      expect(sql).toContain('o.billing_period_end_at')
      expect(sql).toContain('o.raw_provider_fields')
      expect(sql).toContain('o.evidence')
    }

    for (const sql of [quotaQuery.sql, historyQuery.sql, rangeQuery.sql]) {
      expect(sql).toContain('o.source')
      expect(sql).toContain('o.client')
      expect(sql).not.toMatch(/to_jsonb\(o\)->>/)
      expect(sql).not.toMatch(/to_jsonb\(o\)->'/)
    }

    expect(estimatorQuery.sql).not.toMatch(/to_jsonb\(o\)->>/)
    expect(estimatorQuery.sql).not.toMatch(/to_jsonb\(o\)->'/)
  })

  test('test_rate_limit_intervals_source_and_client_remain_defensive_to_jsonb', () => {
    const rangeQuery = buildQuotaRangeHistoryQuery(
      new URLSearchParams({ from: '2026-05-01', to: '2026-05-08' })
    )
    const historyQuery = buildQuotaHistoryQuery(new URLSearchParams())

    expect(rangeQuery.sql).toContain(
      "NULLIF(TRIM(BOTH FROM COALESCE(to_jsonb(ri)->>'source', '')), '') AS source"
    )
    expect(rangeQuery.sql).toContain(
      "NULLIF(TRIM(BOTH FROM COALESCE(to_jsonb(ri)->>'client', '')), '') AS client"
    )
    expect(historyQuery.sql).toContain("to_jsonb(ri)->>'source'")
    expect(historyQuery.sql).toContain("to_jsonb(ri)->>'client'")
  })
})
// ---------------------------------------------------------------------------
// D1-429 tenant_id authoritative repository dimension contract
// ---------------------------------------------------------------------------

describe('D1-429 tenant_id authoritative repository dimension contract', () => {
  const tenantBackedRepositoryExpr = "COALESCE(sh.tenant_id, 'unknown')"

  const forbiddenRepositoryInferencePatterns = [
    /\bsh\.repository\b/,
    /trace_user_id/,
    /repository_tenant_fallback_skipped/,
    /trace_user_tenant_fallback_skipped/,
    /metadata->>'repository'/,
  ] as const

  function expectNoForbiddenRepositoryInferenceSources(sql: string) {
    for (const pattern of forbiddenRepositoryInferencePatterns) {
      expect(sql).not.toMatch(pattern)
    }
  }

  test('buildUsageQuery_groups_repository_dimension_from_tenant_id_only', () => {
    const query = buildUsageQuery(
      new URLSearchParams({
        from: '2026-05-01',
        to: '2026-05-08',
        grain: 'day',
        group_by: 'repository,provider,model',
        limit: '50000',
      })
    )

    expect(query.metadata.groupBy).toContain('repository')
    expect(query.sql).toContain(`${tenantBackedRepositoryExpr} AS repository`)
    expect(query.sql).toContain(`${tenantBackedRepositoryExpr},`)
    expectNoForbiddenRepositoryInferenceSources(query.sql)
  })

  test('buildUsageQuery_filters_repository_by_tenant_id_not_session_history_repository', () => {
    const query = buildUsageQuery(
      new URLSearchParams({
        from: '2026-05-01',
        to: '2026-05-08',
        grain: 'day',
        group_by: 'provider,model',
        limit: '50000',
        repository: 'tenant-a,tenant-b',
      })
    )

    expect(query.values).toContainEqual(['tenant-a', 'tenant-b'])
    expect(query.sql).toContain(`${tenantBackedRepositoryExpr} = ANY(`)
    expectNoForbiddenRepositoryInferenceSources(query.sql)
  })

  test('buildUsageQuery_tokenTrendHours_and_quotaQuery_do_not_consume_context_window_diagnostics', () => {
    const diagnosticOnlyKeys = [
      'anthropic_context_window_mode',
      'anthropic_context_window_requested_tokens',
      'anthropic_context_window_source',
      'anthropic_context_window_beta',
      'anthropic_context_window_classification',
    ] as const
    const aggregateQueries = [
      buildUsageQuery(
        new URLSearchParams({
          from: '2026-05-01',
          to: '2026-05-08',
          grain: 'day',
          group_by: 'provider,model',
          limit: '50000',
        })
      ).sql,
      buildTokenTrendHoursQuery(
        new URLSearchParams({
          from: '2026-05-01',
          to: '2026-05-08',
        })
      ).sql,
      buildQuotaQuery().sql,
    ]

    for (const sql of aggregateQueries) {
      for (const key of diagnosticOnlyKeys) {
        expect(sql).not.toContain(key)
      }
    }
  })

  test('buildSessionDiagnosticsQuery_projects_and_filters_repository_from_tenant_id', () => {
    const query = buildSessionDiagnosticsQuery(
      new URLSearchParams({
        from: '2026-05-01',
        to: '2026-05-08',
        repository: 'tenant-repo-a',
        limit: '100',
      })
    )

    expect(query.values).toContainEqual(['tenant-repo-a'])
    expect(query.sql).toContain(`${tenantBackedRepositoryExpr} AS repository`)
    expect(query.sql).toContain(`${tenantBackedRepositoryExpr} = ANY(`)
    expectNoForbiddenRepositoryInferenceSources(query.sql)
  })

  test('buildToolActivityQuery_applies_tenant_id_backed_repository_filter_on_joined_session_history', () => {
    const query = buildToolActivityQuery(
      new URLSearchParams({
        from: '2026-05-01',
        to: '2026-05-08',
        repository: 'tenant-tool-activity',
      })
    )

    expect(query.values).toContainEqual(['tenant-tool-activity'])
    expect(query.sql).toContain(`${tenantBackedRepositoryExpr} = ANY(`)
    expectNoForbiddenRepositoryInferenceSources(query.sql)
  })

  test('buildTokenTrendHoursQuery_applies_tenant_id_backed_repository_filter', () => {
    const query = buildTokenTrendHoursQuery(
      new URLSearchParams({
        from: '2026-05-01',
        to: '2026-05-08',
        repository: 'tenant-trend-hours',
      })
    )

    expect(query.values).toContainEqual(['tenant-trend-hours'])
    expect(query.sql).toContain(`${tenantBackedRepositoryExpr} = ANY(`)
    expectNoForbiddenRepositoryInferenceSources(query.sql)
  })
})

// ---------------------------------------------------------------------------
// D1-212/215/213/178/221/222 session diagnostics contracts
// ---------------------------------------------------------------------------

describe('D1-212/215/213/178/221/222 session diagnostics contracts', () => {
  const exactMetadataKeys = [
    'credential_family',
    'grok_native_oauth_managed',
    'grok_native_entrypoint',
    'usage_output_contract_required_final_phrase',
    'usage_output_contract_required_final_phrase_present',
    'usage_output_contract_failure_class',
    'usage_output_contract_setup_only_detected',
    'xai_responses_request_sanitized',
    'xai_responses_sanitized_removed_params',
    'xai_responses_sanitized_tool_count',
    'xai_responses_sanitized_tool_types',
    'xai_tool_choice_without_tools_removed',
    'xai_tool_choice_without_tools_removed_reason',
    'session_history_transcript_attribution_status',
    'session_history_transcript_attribution_source',
    'session_history_transcript_attribution',
    'aawm_tool_definition_snapshot_hash',
    'aawm_tool_definition_snapshot',
    'aawm_alias_routing_audit_events',
    'anthropic_context_window_mode',
    'anthropic_context_window_requested_tokens',
    'anthropic_context_window_source',
    'anthropic_context_window_beta',
    'anthropic_context_window_classification',
  ] as const

  test('test_buildSessionDiagnosticsQuery_selects_exact_metadata_keys_and_filters', () => {
    const query = buildSessionDiagnosticsQuery(
      new URLSearchParams({
        from: '2026-05-01',
        to: '2026-05-08',
        provider: 'xai,anthropic',
        model: 'grok-composer-2.5-fast,claude-opus-4-8',
        repository: 'dashboard-shell',
        client: 'grok-build,codex-tui',
        limit: '250',
      })
    )

    expect(query.metadata).toEqual({
      from: '2026-05-01',
      to: '2026-05-08',
      limit: 250,
      candidateLimit: 50000,
    })
    expect(query.values).toEqual([
      '2026-05-01',
      '2026-05-08',
      ['xai', 'anthropic'],
      ['grok-composer-2.5-fast', 'claude-opus-4-8'],
      ['dashboard-shell'],
      ['grok-build', 'codex-tui'],
      50000,
      250,
    ])
    expect(query.sql).toContain('FROM public.session_history sh')
    expect(query.sql).toContain('WITH candidate_sessions AS MATERIALIZED')
    expect(query.sql).toContain('recent_sessions AS MATERIALIZED')
    expect(query.sql).toContain('ORDER BY sh.created_at DESC')
    expect(query.sql).toContain('LIMIT $7')
    expect(query.sql).toContain('LIMIT $8')
    expect(query.sql).not.toMatch(/metadata::text/i)

    for (const key of exactMetadataKeys) {
      expect(query.sql).toContain(`metadata->>'${key}'`)
    }

    expect(query.sql).toContain('AS diagnostic_flags')
    expect(query.sql).toContain('AS diagnostic_categories')
    expect(query.sql).toContain('AS grok_oauth')
    expect(query.sql).toContain('AS output_contract')
    expect(query.sql).toContain('AS xai_sanitizer')
    expect(query.sql).toContain('AS transcript_attribution')
    expect(query.sql).toContain('AS tool_definitions')
    expect(query.sql).toContain('AS alias_route_events')
  })

  test('test_buildSessionDiagnosticsQuery_projects_grok_side_channel_metadata', () => {
    const query = buildSessionDiagnosticsQuery(
      new URLSearchParams({
        from: '2026-05-01',
        to: '2026-05-08',
        grok_side_channel: 'true',
        grok_side_channel_endpoint_type: 'register,replicas_update',
        limit: '50',
      })
    )

    expect(query.values).toEqual([
      '2026-05-01',
      '2026-05-08',
      ['register', 'replicas_update'],
      50000,
      50,
    ])
    expect(query.sql).toContain("metadata->>'grok_side_channel'")
    expect(query.sql).toContain("metadata->>'grok_side_channel_endpoint_type'")
    expect(query.sql).toContain(
      "metadata->>'grok_side_channel_endpoint_path_template'"
    )
    expect(query.sql).toContain(
      "metadata->>'grok_side_channel_request_content_type'"
    )
    expect(query.sql).toContain(
      "metadata->>'grok_side_channel_request_body_byte_length'"
    )
    expect(query.sql).toContain(
      "metadata->>'grok_side_channel_request_body_sha256'"
    )
    expect(query.sql).toContain(
      "metadata->>'grok_side_channel_request_body_digest_source'"
    )
    expect(query.sql).toContain(
      "metadata->>'grok_side_channel_request_json_container_type'"
    )
    expect(query.sql).toContain(
      "metadata->'grok_side_channel_request_top_level_key_types'"
    )
    expect(query.sql).toContain(
      "metadata->>'grok_side_channel_request_array_length'"
    )
    expect(query.sql).toContain('AS grok_side_channel')
    expect(query.sql).toContain("'grok_side_channel'::text")
    expect(query.sql).not.toMatch(/metadata::text/i)
    expect(query.sql).not.toContain('raw_body')
    expect(query.sql).not.toContain('authorization')
  })

  test('test_buildSessionDiagnosticsQuery_joins_alias_audit_and_tool_definition_snapshots', () => {
    const query = buildSessionDiagnosticsQuery(
      new URLSearchParams({
        from: '2026-05-01',
        to: '2026-05-08',
        limit: '100',
      })
    )

    expect(query.sql).toContain('public.aawm_alias_routing_audit')
    expect(query.sql).toContain(
      'public.session_history_tool_definition_snapshots'
    )
    expect(query.sql).toContain('alias_route_events')
    expect(query.sql).toContain('tool_definition_snapshot')
    expect(query.sql).toContain('snapshot_hash')
    expect(query.sql).toContain('ORDER BY observed_at')
    expect(query.sql).toContain('aawm_tool_definition_snapshot_hash')
    expect(query.sql).toContain('aawm_tool_definition_snapshot')
    expect(query.sql).toContain('aawm_alias_routing_audit_events')
    expect(query.sql).toContain('session_history_transcript_attribution')
    expect(query.sql).toContain(
      "metadata->'session_history_transcript_attribution'->>'reason'"
    )
    expect(query.sql).toContain(
      "metadata->'session_history_transcript_attribution'->>'match_rule'"
    )
    expect(query.sql).toContain(
      "metadata->'session_history_transcript_attribution'->>'updated_at'"
    )
    expect(query.sql).toContain('xai_responses_sanitized_tools')
    expect(query.sql).toContain('xai_tool_choice_without_tools_removed_reason')
    expect(query.sql).toContain('usage_output_contract_setup_only_detected')
    expect(query.sql).toContain('grok_native_oauth_managed')
    expect(query.sql).toContain('grok_native_entrypoint')
    expect(query.sql).not.toContain('IS NOT DISTINCT FROM sh.litellm_call_id')
    expect(query.sql).not.toContain('IS NOT DISTINCT FROM sh.session_id')
    expect(query.sql).not.toContain(
      "IS NOT DISTINCT FROM NULLIF(sh.trace_id, '')"
    )
    expect(query.sql).not.toContain('aa_probe')
  })

  test('test_buildSessionDiagnosticsQuery_keeps_alias_audit_matching_after_limited_rows', () => {
    const query = buildSessionDiagnosticsQuery(
      new URLSearchParams({
        from: '2026-05-01',
        to: '2026-05-08',
        limit: '5',
      })
    )

    expect(query.sql).toContain('FROM recent_sessions rs')
    expect(query.sql).toContain('LEFT JOIN LATERAL')
    expect(query.sql).toContain('FROM public.aawm_alias_routing_audit aa')
    expect(query.sql).toContain(
      "rs.metadata->>'aawm_alias_routing_audit_events' IS NOT NULL"
    )
    expect(query.sql).toContain(
      "rs.metadata->>'codex_auto_agent_audit_events' IS NOT NULL"
    )
    expect(query.sql).toContain(
      "rs.metadata->>'anthropic_auto_agent_audit_events' IS NOT NULL"
    )
    expect(query.sql).toContain("NULLIF(aa.litellm_call_id, '') IS NOT NULL")
    expect(query.sql).toContain('rs.litellm_call_id IS NOT NULL')
    expect(query.sql).toContain(
      "NULLIF(aa.litellm_call_id, '') = rs.litellm_call_id"
    )
    expect(query.sql).toContain("NULLIF(aa.session_id, '') IS NOT NULL")
    expect(query.sql).toContain('rs.session_id IS NOT NULL')
    expect(query.sql).toContain("NULLIF(aa.session_id, '') = rs.session_id")
    expect(query.sql).toContain("NULLIF(aa.trace_id, '') IS NOT NULL")
    expect(query.sql).toContain('rs.trace_id IS NOT NULL')
    expect(query.sql).toContain("NULLIF(aa.trace_id, '') = rs.trace_id")
    expect(query.sql).toContain(
      "rs.metadata->>'aawm_tool_definition_capture_version' IS NOT NULL"
    )
    expect(query.sql).toContain(
      "rs.metadata->>'aawm_tool_definition_snapshot_hash' IS NOT NULL"
    )
    expect(query.sql).toContain(
      "rs.metadata->>'aawm_tool_definition_snapshot' IS NOT NULL"
    )
    expect(query.sql).toContain('rs.session_id IS NOT NULL')
    expect(query.sql).toContain("NULLIF(td.session_id, '') = rs.session_id")
    expect(query.sql).toContain(
      "NULLIF(td.snapshot_hash, '') = rs.metadata->>'aawm_tool_definition_snapshot_hash'"
    )
  })

  test('test_buildSessionDiagnosticsQuery_alias_audit_join_rejects_null_null_correlation_keys', () => {
    const query = buildSessionDiagnosticsQuery(
      new URLSearchParams({
        from: '2026-05-01',
        to: '2026-05-08',
        limit: '10',
      })
    )

    const lateralAudit = query.sql.match(
      /LEFT JOIN LATERAL \([\s\S]*?\) alias_audit ON TRUE/
    )?.[0]
    expect(lateralAudit).toBeTruthy()

    expect(query.sql).not.toMatch(
      /IS NOT DISTINCT FROM\s+(rs|sh)\.(litellm_call_id|session_id|trace_id)/
    )
    expect(query.sql).not.toMatch(/IS NOT DISTINCT FROM\s+NULLIF\(sh\.trace_id/)

    for (const key of ['litellm_call_id', 'session_id', 'trace_id'] as const) {
      expect(lateralAudit).toContain(`NULLIF(aa.${key}, '') IS NOT NULL`)
      expect(lateralAudit).toContain(`rs.${key} IS NOT NULL`)
      expect(lateralAudit).toContain(`NULLIF(aa.${key}, '') = rs.${key}`)
    }
  })

  test('test_buildSessionDiagnosticsQuery_projects_anthropic_context_window_metadata', () => {
    const query = buildSessionDiagnosticsQuery(
      new URLSearchParams({
        from: '2026-05-01',
        to: '2026-05-08',
        limit: '25',
      })
    )

    expect(query.sql).toContain("metadata->>'anthropic_context_window_mode'")
    expect(query.sql).toContain(
      "metadata->>'anthropic_context_window_requested_tokens'"
    )
    expect(query.sql).toContain("metadata->>'anthropic_context_window_source'")
    expect(query.sql).toContain("metadata->>'anthropic_context_window_beta'")
    expect(query.sql).toContain(
      "metadata->'anthropic_context_window_classification'"
    )
    expect(query.sql).toContain('AS anthropic_context_window')
    expect(query.sql).toContain("'anthropic_context_window'::text")
    expect(query.sql).toContain("'context_window'::text")
  })
})

describe('report-service query builders', () => {
  test('test_buildUsageQuery_keeps_legacy_quota_columns_without_rate_limit_joins', () => {
    const query = buildUsageQuery(
      new URLSearchParams({
        from: '2026-05-01',
        to: '2026-05-08',
        grain: 'day',
        group_by: 'provider,model,repository',
        limit: '50000',
      })
    )

    expect(query.values).toEqual(['2026-05-01', '2026-05-08', 50000])
    expect(query.sql).toContain(
      'NULL::timestamp with time zone AS weekly_reset_first'
    )
    expect(query.sql).toContain('NULL::double precision AS min_short_pct')
    expect(query.sql).not.toContain('LEFT JOIN LATERAL')
    expect(query.sql).not.toContain('public.rate_limit_intervals')
    expect(query.sql).not.toContain('quota_key_gaps')
    expect(query.sql).not.toContain('public.rate_limit_observations')
    expect(query.sql).not.toContain('session_history_tool_activity')
    expect(query.sql).not.toContain('outer_counts')
    expect(query.sql).not.toContain('shell_labels')
  })

  test('test_buildUsageQuery_exposes_agent_score_aggregates_without_null_to_zero_scores', () => {
    const query = buildUsageQuery(
      new URLSearchParams({
        from: '2026-05-01',
        to: '2026-05-08',
        grain: 'day',
        group_by: 'provider,model,repository',
        limit: '50000',
      })
    )

    expect(query.sql).toContain('AS agent_quality_score')
    expect(query.sql).toContain('AS agent_instruction_score')
    expect(query.sql).toContain('AS agent_tool_score')
    expect(query.sql).toContain('AS agent_contract_score')
    expect(query.sql).toContain('AS agent_progress_score')
    expect(query.sql).toContain('AS agent_risk_score')
    expectSelectAlias(query.sql, 'agent_discovery_inventory_coverage_score')
    expectSelectAlias(query.sql, 'agent_discovery_inventory_coverage_evaluated')
    expectSelectAlias(query.sql, 'agent_discovery_inventory_coverage_possible')
    expectSelectAlias(query.sql, 'agent_discovery_inventory_coverage_failures')
    expectSelectAlias(query.sql, 'agent_discovery_inventory_missing_count')
    expectSelectAlias(query.sql, 'agent_terminal_completion_score')
    expectSelectAlias(query.sql, 'agent_terminal_completion_evaluated')
    expectSelectAlias(query.sql, 'agent_terminal_completion_possible')
    expectSelectAlias(query.sql, 'agent_terminal_completion_failures')
    expect(query.sql).toContain('AS agent_compact_summary_events')
    expect(query.sql).toContain('AS agent_compact_summary_thread_count')
    expect(query.sql).toContain('AS agent_compact_summary_id_count')
    expect(query.sql).toContain('AS agent_compact_summary_resume_contexts')
    expect(query.sql).toContain('AS agent_compact_summary_verify_contexts')
    expect(query.sql).toContain('AS agent_compact_summary_source_counts')
    expect(query.sql).toContain(
      'NULL::double precision AS agent_compact_summary_events'
    )
    expect(query.sql).toContain(
      'NULL::double precision AS agent_compact_summary_resume_contexts'
    )
    expect(query.sql).toContain(
      'NULL::double precision AS agent_compact_summary_verify_contexts'
    )
    expect(query.sql).toContain('AS agent_empty_completion_failures')
    expect(query.sql).toContain('AS agent_score_reasons_top')
    expect(query.sql).toContain('AS agent_ignored_path_tracking_policy_score')
    expect(query.sql).toContain('AS agent_baseline_deflection_attempted_score')
    expect(query.sql).toContain(
      'AS agent_sleep_wellness_interruption_incident_score'
    )
    expect(query.sql).toContain('NULL::double precision AS agent_quality_score')
    expect(query.sql).not.toContain(
      'COALESCE(sh.discovery_inventory_coverage_score, 0)'
    )
    expect(query.sql).not.toContain('/compact')
    expect(query.sql).toContain('reason_source AS MATERIALIZED')
    expect(query.sql).toContain(
      "COALESCE(reason_summary.agent_score_reasons_top, '[]'::jsonb) AS agent_score_reasons_top"
    )
    expect(query.sql).toContain('jsonb_each(')
    expect(query.sql).toContain('reason_value.value ->>')
    expect(query.sql).not.toContain('COALESCE(sh.trace_quality_score, 0)')
  })

  test('test_buildUsageQuery_projects_filtered_columns_without_select_star', () => {
    const query = buildUsageQuery(
      new URLSearchParams({
        from: '2026-05-01',
        to: '2026-05-08',
        grain: 'day',
        group_by: 'provider,model,repository',
        limit: '50000',
      })
    )

    expect(query.sql).toContain('WITH filtered AS')
    expect(query.sql).not.toContain('SELECT sh.*')
    expect(query.sql).toContain('sh.created_at')
    expect(query.sql).toContain('sh.start_time')
    expect(query.sql).toContain('sh.provider')
    expect(query.sql).toContain('sh.model')
    expect(query.sql).toContain('sh.response_cost_usd')
    expect(query.sql).toContain('sh.agent_score_reasons')
    expect(query.sql).toContain('sh.sleep_wellness_interruption_elapsed_ms')
    expect(query.sql).toContain('FROM filtered sh')
  })

  test('test_buildUsageQuery_exposes_latency_split_and_throughput_percentiles', () => {
    const query = buildUsageQuery(
      new URLSearchParams({
        from: '2026-05-01',
        to: '2026-05-08',
        grain: 'day',
        group_by: 'provider,model,repository',
        limit: '50000',
      })
    )

    expect(query.sql).toContain('AS total_server_elapsed_p95_ms')
    expect(query.sql).toContain('AS llm_upstream_elapsed_p95_ms')
    expect(query.sql).toContain('AS ttft_p95_ms')
    expect(query.sql).toContain('AS litellm_processing_p95_ms')
    expect(query.sql).toContain('AS latency_unclassified_p95_ms')
    expect(query.sql).toContain(
      'AS previous_response_to_current_request_p95_ms'
    )
    expect(query.sql).toContain('AS llm_upstream_output_tokens_per_second_p95')
    expect(query.sql).toContain('AS llm_stream_output_tokens_per_second_p95')
  })

  test('test_buildUsageQuery_exposes_config_change_aggregates_and_filters', () => {
    const query = buildUsageQuery(
      new URLSearchParams({
        from: '2026-05-01',
        to: '2026-05-08',
        grain: 'day',
        group_by: 'provider,model,repository',
        limit: '50000',
        changed_env_file: 'true,null',
        changed_gitignore: 'false',
      })
    )

    expect(query.values).toEqual(['2026-05-01', '2026-05-08', 50000])
    expect(query.sql).toContain('AS config_change_evaluated_rows')
    expect(query.sql).toContain('AS config_change_unevaluated_rows')
    expect(query.sql).toContain('AS config_change_any_true_rows')
    expect(query.sql).toContain('AS changed_pre_commit_config_true_rows')
    expect(query.sql).toContain('AS changed_pre_commit_config_false_rows')
    expect(query.sql).toContain('AS changed_pre_commit_config_unknown_rows')
    expect(query.sql).toContain('AS changed_env_file_true_rows')
    expect(query.sql).toContain('AS changed_pyproject_toml_true_rows')
    expect(query.sql).toContain('AS changed_gitignore_true_rows')
    expect(query.sql).toContain(
      '(sh.changed_env_file IS TRUE OR sh.changed_env_file IS NULL)'
    )
    expect(query.sql).toContain('(sh.changed_gitignore IS FALSE)')
  })

  test('test_buildUsageQuery_uses_fast_usage_signal_filter', () => {
    const query = buildUsageQuery(
      new URLSearchParams({
        from: '2026-05-01',
        to: '2026-05-08',
        grain: 'day',
        group_by: 'provider,model,repository',
        limit: '50000',
      })
    )

    expect(query.sql).toContain('COALESCE(sh.input_tokens, 0)')
    expect(query.sql).toContain('COALESCE(sh.response_cost_usd, 0)')
    expect(query.sql).toContain('COALESCE(sh.tool_call_count, 0) > 0')
    expect(query.sql).not.toContain(
      "sh.metadata->>'session_history_usage_record'"
    )
    expect(query.sql).toContain('reason_bounds AS')
    expect(query.sql).toContain('reason_source AS MATERIALIZED')
  })

  test('aggregate_and_trend_use_same_eligibility', async () => {
    const params = new URLSearchParams({
      from: '2026-05-01',
      to: '2026-05-08',
      grain: 'day',
      group_by: 'provider,model',
      limit: '50000',
    })

    const reportService = (await import('./report-service.mjs')) as Record<
      string,
      ((searchParams: URLSearchParams) => { sql: string }) | undefined
    >
    const aggregateBuilderNames = [
      'buildSummaryQuery',
      'buildTrendQuery',
      'buildClientUsageQuery',
      'buildUsageQuery',
      'buildProviderStatusUsageQuery',
    ] as const

    for (const name of aggregateBuilderNames) {
      const builder =
        name === 'buildUsageQuery' ? buildUsageQuery : reportService[name]
      expect(
        builder,
        `${name} must be available for aggregate eligibility tests`
      ).toBeTypeOf('function')
      expectReportableSessionHistoryFilter(builder!(params).sql)
    }
  })

  test('test_parseUsageReportSort_supports_period_start_dotted_desc', () => {
    const { sort, sortDirection } = parseUsageReportSort(
      new URLSearchParams({
        sort: 'period_start.desc',
      })
    )

    expect(sort).toBe('period_start')
    expect(sortDirection).toBe('DESC')
  })

  test('test_parseUsageReportSort_supports_period_start_with_direction_param', () => {
    const { sort, sortDirection } = parseUsageReportSort(
      new URLSearchParams({
        sort: 'period_start',
        direction: 'asc',
      })
    )

    expect(sort).toBe('period_start')
    expect(sortDirection).toBe('ASC')
  })

  test('test_buildUsageQuery_orders_by_period_start_when_sort_is_dotted', () => {
    const query = buildUsageQuery(
      new URLSearchParams({
        from: '2026-05-01',
        to: '2026-05-08',
        grain: 'day',
        group_by: 'provider',
        sort: 'period_start.desc',
        limit: '10',
      })
    )

    expect(query.sql).toContain('ORDER BY period_start DESC')
  })

  test('test_shouldIncludeTokenTrendHealth_defaults_false', () => {
    expect(
      shouldIncludeTokenTrendHealth(new URLSearchParams({ from: '2026-05-01' }))
    ).toBe(false)
    expect(
      shouldIncludeTokenTrendHealth(
        new URLSearchParams({ include_health: '1' })
      )
    ).toBe(true)
  })

  test('test_applyTokenTrendSummaryHealthInclusion_omits_health_by_default', () => {
    const report = applyTokenTrendSummaryHealthInclusion(
      new URLSearchParams({ from: '2026-05-01', to: '2026-05-08' }),
      {
        metadata: {
          from: '2026-05-01',
          to: '2026-05-08',
          degraded: true,
          degradedReason: 'bounded_raw_lane_policy',
          tokenTrendSummaryRawLaneMaxDays: 7,
          tokenTrendSummaryRangeDays: 30,
        },
        tokenTrendHours: [],
        tokenTrendHealth: [{ provider: 'openai', value: 1 }],
        tokenTrendScores: [],
        tokenTrendVersions: [],
        tokenTrendModelFirstSeen: [],
      }
    )

    expect(report.tokenTrendHealth).toEqual([])
    expect(report.metadata).toMatchObject({
      includeTokenTrendHealth: false,
      tokenTrendHealthOmitted: true,
      degradedReason: 'bounded_raw_lane_policy',
      tokenTrendSummaryRawLaneMaxDays: 7,
    })
  })

  test('test_applyTokenTrendSummaryHealthInclusion_preserves_health_when_requested', () => {
    const healthRows = [{ provider: 'openai', score_bucket: 'p95' }]
    const report = applyTokenTrendSummaryHealthInclusion(
      new URLSearchParams({ include_health: 'true' }),
      {
        metadata: { from: '2026-05-01', to: '2026-05-08' },
        tokenTrendHours: [],
        tokenTrendHealth: healthRows,
        tokenTrendScores: [],
        tokenTrendVersions: [],
        tokenTrendModelFirstSeen: [],
      }
    )

    expect(report.tokenTrendHealth).toEqual(healthRows)
    expect(report.metadata).toMatchObject({
      includeTokenTrendHealth: true,
    })
    expect(report.metadata).not.toHaveProperty('tokenTrendHealthOmitted')
  })

  test('test_buildSourceTableHealthQuery_uses_latest_row_source_table_probes', () => {
    const query = buildSourceTableHealthQuery()

    expect(query.values).toEqual([])
    expect(query.sql).toContain("'public.session_history'::regclass")
    expect(query.sql).toContain("'public.rate_limit_observations'::regclass")
    expect(query.sql).toContain(
      'FROM public.session_history ORDER BY id DESC LIMIT 1'
    )
    expect(query.sql).toContain(
      'FROM public.rate_limit_observations ORDER BY id DESC LIMIT 1'
    )
    expect(query.sql).toContain('latest_persisted_at')
    expect(query.sql).toContain('latest_event_at')
    expect(query.sql).not.toContain('COUNT(*)')
  })

  test('test_buildReportQueryPressureQuery_scopes_dashboard_report_activity', () => {
    const query = buildReportQueryPressureQuery()

    expect(query.values).toEqual([])
    expect(query.sql).toContain('FROM pg_stat_activity')
    expect(query.sql).toMatch(
      /application_name\s+IN\s*\(\s*'dashboard-shell-report-service'/i
    )
    expect(query.sql).toContain("'dashboard-shell-health'")
    expect(query.sql).toContain('wait_event_type')
    expect(query.sql).toContain('clock_timestamp() - query_start')
    expect(query.sql).toContain('MAX(active_age_ms)')
    expect(query.sql).toContain('left(regexp_replace')
    expect(query.sql).not.toContain('public.session_history')
  })

  test('test_pgbouncer_admin_url_and_row_normalizers_sanitize_admin_payload', () => {
    const adminUrl = buildPgBouncerAdminDatabaseUrl(
      'postgresql://aawm:secret@aawm-pgbouncer:6432/aawm_tristore?sslmode=disable'
    )
    const parsedUrl = new URL(adminUrl!)

    expect(parsedUrl.pathname).toBe('/pgbouncer')
    expect(parsedUrl.hostname).toBe('aawm-pgbouncer')
    expect(parsedUrl.port).toBe('6432')
    expect(parsedUrl.searchParams.get('sslmode')).toBe('disable')
    expect(buildPgBouncerAdminDatabaseUrl('not a url')).toBeUndefined()

    const aegisAdminUrl = buildAegisPgBouncerAdminDatabaseUrl({
      AEGIS_DB_PASSWORD: 'aegis secret',
    })
    const parsedAegisUrl = new URL(aegisAdminUrl!)

    expect(parsedAegisUrl.username).toBe('aegis_app')
    expect(parsedAegisUrl.password).toBe('aegis%20secret')
    expect(parsedAegisUrl.hostname).toBe('aegis-pgbouncer')
    expect(parsedAegisUrl.port).toBe('6432')
    expect(parsedAegisUrl.pathname).toBe('/pgbouncer')

    expect(
      buildAegisPgBouncerAdminDatabaseUrl({
        SHELL_REPORT_AEGIS_PGBOUNCER_DATABASE_URL:
          'postgresql://custom:secret@example.invalid:6543/pgbouncer',
        AEGIS_DB_PASSWORD: 'ignored',
      })
    ).toBe('postgresql://custom:secret@example.invalid:6543/pgbouncer')

    expect(
      normalizePgBouncerPoolRow({
        database: 'aawm_tristore',
        user: 'aawm',
        cl_active: '2',
        cl_waiting: '1',
        sv_active: '3',
        sv_idle: '4',
        sv_used: '5',
        sv_tested: '6',
        sv_login: '7',
        maxwait: '8',
        maxwait_us: '900',
        pool_mode: 'transaction',
      })
    ).toEqual({
      database: 'aawm_tristore',
      user: 'aawm',
      clActive: 2,
      clWaiting: 1,
      svActive: 3,
      svIdle: 4,
      svUsed: 5,
      svTested: 6,
      svLogin: 7,
      maxWaitSeconds: 8,
      maxWaitMicroseconds: 900,
      poolMode: 'transaction',
    })

    expect(
      normalizePgBouncerStatsRow({
        database: 'aawm_tristore',
        total_xact_count: '42',
        total_query_count: '84',
        total_received: '2048',
        total_sent: '4096',
        avg_xact_count: '4',
        avg_query_count: '8',
        avg_wait_time: '12',
      })
    ).toEqual({
      database: 'aawm_tristore',
      totalXactCount: 42,
      totalQueryCount: 84,
      totalReceived: 2048,
      totalSent: 4096,
      avgXactCount: 4,
      avgQueryCount: 8,
      avgWaitTime: 12,
    })
  })

  test('test_buildQuotaQuery_preserves_xai_grok_build_quota_keys_as_distinct_lanes', () => {
    const query = buildQuotaQuery()

    expect(query.sql).toContain('xai_grok_build_weekly_credits:credits')
    expect(query.sql).toContain('xai_grok_build_monthly_requests:requests')
    expect(query.sql).toContain('MAX(billing.quota_key)')
    expect(query.sql).toContain('MAX(billing.source)')
    expect(query.sql).toContain('MAX(billing.client)')
    expect(query.sql).toContain('MAX(billing.quota_unit)')
    expect(query.sql).toContain(
      "WHEN ri.quota_key = 'xai_grok_build_weekly_credits:credits' THEN 'weekly'"
    )
    expect(query.sql).toContain(
      "WHEN ri.quota_key = 'xai_grok_build_monthly_requests:requests' THEN 'monthly'"
    )
  })

  test('test_buildQuotaQuery_includes_weekly_overage_included_quota_type', () => {
    const query = buildQuotaQuery()

    expect(query.sql).toContain("'weekly_overage_included'")
    expect(query.sql).toContain(
      "FILTER (WHERE s.quota_type = 'weekly_overage_included')"
    )
    expect(query.sql).toContain('AS weekly_overage_included_remaining_pct')
  })

  test('test_buildQuotaQuery_final_select_projects_remaining_pct_and_billing_identity_per_lane', () => {
    const query = buildQuotaQuery()
    const lanes = [
      'weekly',
      'weekly_overage_included',
      'short',
      'special',
      'short_special',
      'monthly',
      'wtus',
    ] as const

    for (const lane of lanes) {
      expect(query.sql).toContain(
        `MAX(s.remaining_pct) FILTER (WHERE s.quota_type = '${lane}')::double precision AS ${lane}_remaining_pct`
      )
      expect(query.sql).toContain(
        `MAX(billing.quota_key) FILTER (WHERE s.quota_type = '${lane}') AS ${lane}_quota_key`
      )
      expect(query.sql).toContain(
        `MAX(billing.source) FILTER (WHERE s.quota_type = '${lane}') AS ${lane}_source`
      )
      expect(query.sql).toContain(
        `MAX(billing.client) FILTER (WHERE s.quota_type = '${lane}') AS ${lane}_client`
      )
      expect(query.sql).toContain(
        `MAX(billing.quota_unit) FILTER (WHERE s.quota_type = '${lane}') AS ${lane}_quota_unit`
      )
    }
  })

  test('test_normalizeQuotaRow_returns_provider_model_billing_and_default_lane_fields', () => {
    const lanes = [
      'weekly',
      'weekly_overage_included',
      'short',
      'special',
      'short_special',
      'monthly',
      'wtus',
    ] as const

    const row: Record<string, unknown> = {
      provider: 'xai',
      weekly_quota_key: 'xai_grok_build_weekly_credits:credits',
      weekly_source: 'grok_build',
      weekly_client: 'codex',
      weekly_quota_unit: 'credits',
      weekly_quota_limit: 100,
      weekly_quota_used: 25,
      weekly_quota_remaining: 75,
      weekly_billing_observed_at: '2026-07-01T12:00:00.000Z',
      weekly_billing_period_start_at: '2026-07-01T00:00:00.000Z',
      weekly_billing_period_end_at: '2026-07-08T00:00:00.000Z',
      weekly_raw_provider_fields: { plan: 'pro' },
      weekly_evidence: { source: 'observation' },
    }

    const normalized = normalizeQuotaRow(row)

    expect(normalized.provider).toBe('xai')
    expect(normalized.model).toBeNull()
    expect(normalized.billing_details.weekly).toEqual({
      quota_key: 'xai_grok_build_weekly_credits:credits',
      source: 'grok_build',
      client: 'codex',
      quota_unit: 'credits',
      quota_limit: 100,
      quota_used: 25,
      quota_remaining: 75,
      billing_observed_at: '2026-07-01T12:00:00.000Z',
      billing_period_start_at: '2026-07-01T00:00:00.000Z',
      billing_period_end_at: '2026-07-08T00:00:00.000Z',
      raw_provider_fields: { plan: 'pro' },
      evidence: { source: 'observation' },
    })

    for (const lane of lanes) {
      expect(normalized[`${lane}_remaining_pct`]).toBeNull()
      expect(normalized[`${lane}_reset_at`]).toBeNull()
      expect(normalized[`${lane}_interval_start`]).toBeNull()
      expect(normalized[`${lane}_interval_end`]).toBeNull()
      expect(normalized[`${lane}_active`]).toBe(false)
      expect(normalized[`${lane}_usage_tokens`]).toBe(0)
      expect(normalized[`${lane}_usage_breakdown`]).toEqual([])
      expect(normalized[`${lane}_velocity_segments`]).toEqual([])
      expect(normalized[`${lane}_velocity_scores`]).toEqual([])
      expect(normalized[`${lane}_velocity_sample_count`]).toBe(0)
    }
  })

  test('test_quota_query_builders_reuse_canonical_rate_limit_provider_dimension', () => {
    const canonicalRiMappings = [
      "WHEN lower(COALESCE(ri.provider, 'unknown')) IN ('google', 'gemini') THEN 'google'",
      "WHEN lower(COALESCE(ri.provider, 'unknown')) = 'antigravity' THEN 'antigravity'",
      "WHEN lower(COALESCE(ri.provider, 'unknown')) IN ('xai', 'x.ai') THEN 'xai'",
      "WHEN lower(COALESCE(ri.provider, 'unknown')) = 'nvidia' THEN 'nvidia_nim'",
      "WHEN lower(COALESCE(ri.provider, 'unknown')) LIKE 'local_%' THEN 'local'",
    ]
    const queries = [
      buildQuotaQuery(),
      buildQuotaHistoryQuery(new URLSearchParams()),
      buildQuotaHistoryFallbackQuery(new URLSearchParams()),
      buildQuotaRangeHistoryFallbackQuery(
        new URLSearchParams({ from: '2026-05-01', to: '2026-05-08' })
      ),
    ]

    for (const query of queries) {
      for (const fragment of canonicalRiMappings) {
        expect(query.sql).toContain(fragment)
      }
    }
  })

  test('test_buildQuotaRangeHistoryQuery_reuses_canonical_provider_dimension_without_antigravity_lane', () => {
    const query = buildQuotaRangeHistoryQuery(
      new URLSearchParams({ from: '2026-07-01', to: '2026-07-04' })
    )

    expect(query.sql).toContain(
      "WHEN lower(COALESCE(ri.provider, 'unknown')) IN ('google', 'gemini') THEN 'google'"
    )
    expect(query.sql).toContain(
      "WHEN lower(COALESCE(ri.provider, 'unknown')) IN ('xai', 'x.ai') THEN 'xai'"
    )
    expect(query.sql).toContain(
      "WHEN lower(COALESCE(ri.provider, 'unknown')) = 'nvidia' THEN 'nvidia_nim'"
    )
    expect(query.sql).toContain(
      "WHEN lower(COALESCE(ri.provider, 'unknown')) LIKE 'local_%' THEN 'local'"
    )
    expect(query.sql).not.toContain("THEN 'antigravity'")
  })

  test('test_buildQuotaHistoryQuery_reuses_canonical_session_history_provider_dimension_for_usage_join', () => {
    const query = buildQuotaHistoryQuery(new URLSearchParams())

    expect(query.sql).toContain(
      "WHEN lower(COALESCE(sh.provider, 'unknown')) IN ('google', 'gemini') THEN 'google'"
    )
    expect(query.sql).toContain(
      "WHEN lower(COALESCE(sh.provider, 'unknown')) = 'antigravity' THEN 'antigravity'"
    )
    expect(query.sql).toContain(
      "WHEN lower(COALESCE(sh.provider, 'unknown')) IN ('xai', 'x.ai') THEN 'xai'"
    )
    expect(query.sql).toContain(
      "WHEN lower(COALESCE(sh.provider, 'unknown')) = 'nvidia' THEN 'nvidia_nim'"
    )
    expect(query.sql).toContain(
      "WHEN lower(COALESCE(sh.provider, 'unknown')) LIKE 'local_%' THEN 'local'"
    )
  })

  test('test_buildQuotaHistoryQuery_includes_weekly_overage_included_quota_type', () => {
    const query = buildQuotaHistoryQuery(new URLSearchParams())

    expect(query.sql).toContain("'weekly_overage_included'")
    expect(query.sql).not.toContain(
      "WHEN ri.quota_type = 'weekly_overage_included' THEN 'special'"
    )
  })

  test('test_buildQuotaQuery_openai_fallback_union_preserves_provider_column_order', () => {
    const query = buildQuotaQuery()

    const weeklyFallbackSelect = `    SELECT
        weekly.raw_provider,
        'weekly_special' AS raw_quota_type,
        NULL::text AS quota_key,
        weekly.provider,
        weekly.model,
        'special' AS quota_type,
        weekly.expected_reset_at,
        0::double precision AS remaining_pct,
        weekly.interval_start,
        weekly.interval_end,
        weekly.active,
        weekly.quota_rank
    FROM selected weekly`

    const shortFallbackSelect = `    SELECT
        short.raw_provider,
        'short_special' AS raw_quota_type,
        NULL::text AS quota_key,
        short.provider,
        short.model,
        'short_special' AS quota_type,
        short.expected_reset_at,
        0::double precision AS remaining_pct,
        short.interval_start,
        short.interval_end,
        short.active,
        short.quota_rank
    FROM selected short`

    expect(query.sql).toContain(weeklyFallbackSelect)
    expect(query.sql).toContain(shortFallbackSelect)
    expect(query.sql).not.toContain(`weekly.provider,
        weekly.model,
        'special' AS quota_type,
        'weekly_special' AS raw_quota_type`)
    expect(query.sql).toContain("WHERE weekly.provider = 'openai'")
    expect(query.sql).toContain("WHERE short.provider = 'openai'")
  })

  test('test_buildQuotaQuery_stays_on_rate_limit_tables_and_wtus_lanes', () => {
    const query = buildQuotaQuery()

    expect(query.values).toEqual([])
    expect(query.sql).toContain(
      "ri.quota_type IN ('weekly', 'weekly_overage_included', 'short', 'weekly_special', " +
        "'short_special', 'requests', 'monthly', 'wtus')"
    )
    expect(query.sql).toContain(
      "MAX(s.remaining_pct) FILTER (WHERE s.quota_type = 'wtus')"
    )
    expect(query.sql).toContain('THEN ri.quota_key')
    expect(query.sql).not.toContain('usage_by_type')
    expect(query.sql).not.toContain('LEFT JOIN usage_by_type')
    expect(query.sql).not.toContain('LEFT JOIN usage')
    expect(query.sql).not.toContain('FROM public.session_history')
    expect(query.sql).not.toContain('COALESCE(sh.start_time, sh.created_at)')
  })

  test('test_buildQuotaQuery_projects_zero_empty_usage_placeholders_per_lane', () => {
    const query = buildQuotaQuery()
    const lanes = [
      'weekly',
      'weekly_overage_included',
      'short',
      'special',
      'short_special',
      'monthly',
      'wtus',
    ] as const

    for (const lane of lanes) {
      expect(query.sql).toContain(`0::double precision AS ${lane}_usage_tokens`)
      expect(query.sql).toContain(`'[]'::jsonb AS ${lane}_usage_breakdown`)
    }

    expect(query.sql).not.toMatch(/MAX\(usage\.usage_tokens\)/)
    expect(query.sql).not.toMatch(/ARRAY_AGG\(usage\.usage_breakdown\)/)
  })

  test('test_buildQuotaHistoryQuery_emits_quota_identity_metadata_columns', () => {
    const query = buildQuotaHistoryQuery(new URLSearchParams())

    expect(query.sql).toContain(
      "PARTITION BY n.provider, COALESCE(n.model, ''), n.quota_type, COALESCE(n.normalized_quota_key, '')"
    )
    expect(query.sql).toContain('observation_identity AS')
    expect(query.sql).toContain('AND o.provider = n.raw_provider')
    expect(query.sql).toContain(
      'COALESCE(MAX(n.source), MAX(oi.source)) AS source'
    )
    expect(query.sql).toContain(
      'COALESCE(MAX(n.client), MAX(oi.client)) AS client'
    )
    expect(query.sql).toContain('AS quota_key')
    expect(query.sql).toContain('AS source')
    expect(query.sql).toContain('AS client')
    expect(query.sql).toContain('AS quota_unit')
    expect(query.sql).toContain('xai_grok_build_weekly_credits:credits')
    expect(query.sql).toContain('xai_grok_build_monthly_requests:requests')
  })

  test('test_buildQuotaRangeHistoryQuery_emits_observation_backed_quota_identity_metadata_columns', () => {
    const query = buildQuotaRangeHistoryQuery(
      new URLSearchParams({ from: '2026-07-01', to: '2026-07-04' })
    )

    expect(query.values).toEqual(['2026-07-01', '2026-07-04'])
    expect(query.sql).toContain('ri.provider AS raw_provider')
    expect(query.sql).toContain('observation_identity AS')
    expect(query.sql).toContain('AND o.provider = n.raw_provider')
    expect(query.sql).toContain('wb.quota_key')
    expect(query.sql).toContain('wb.source')
    expect(query.sql).toContain('wb.client')
    expect(query.sql).toContain('wb.quota_unit')
    expect(query.sql).toContain('xai_grok_build_weekly_credits:credits')
    expect(query.sql).toContain('xai_grok_build_monthly_requests:requests')
  })

  test('test_buildQuotaHistoryQuery_precomputes_recent_trace_counts', () => {
    const query = buildQuotaHistoryQuery(new URLSearchParams())

    expect(query.sql).toContain('recent_traces_90m AS (')
    expect(query.sql).toContain('LEFT JOIN recent_traces_90m recent')
    expect(query.sql).toContain(
      "COALESCE(sh_recent.start_time, sh_recent.created_at) >= now() - INTERVAL '90 minutes'"
    )
    expect(query.sql).not.toMatch(
      /SELECT\s+COUNT\(\*\)::double precision\s+FROM\s+public\.session_history\s+sh_recent/i
    )
  })

  test('test_quota_key_interval_cte_helper_is_shared_without_duplicate_literals', () => {
    const velocityQuery = buildQuotaVelocityQuery()
    const historyQuery = buildQuotaHistoryQuery(new URLSearchParams())
    const historyFallbackQuery = buildQuotaHistoryFallbackQuery(
      new URLSearchParams()
    )
    const queries = [velocityQuery, historyQuery, historyFallbackQuery]

    for (const query of queries) {
      expect(query.sql.match(/quota_key_gaps AS/g)?.length).toBe(1)
      expect(query.sql.match(/quota_key_interval_hours AS/g)?.length).toBe(1)
      expect(query.sql).toContain(
        'PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY gap_hours) AS interval_hours'
      )
      expect(query.sql).toContain('WHERE gap_hours >= 1.0')
    }

    expect(velocityQuery.sql).toContain('AND quota_key IS NOT NULL')
    expect(historyQuery.sql).not.toMatch(
      /FROM \(\s*SELECT DISTINCT provider, quota_key, quota_type, expected_reset_at[\s\S]*?AND quota_key IS NOT NULL/
    )
  })

  test('test_quota_observation_joins_apply_interval_observed_at_bounds', () => {
    const quotaQuery = buildQuotaQuery()
    const velocityQuery = buildQuotaVelocityQuery()
    const historyQuery = buildQuotaHistoryQuery(new URLSearchParams())
    const historyFallbackQuery = buildQuotaHistoryFallbackQuery(
      new URLSearchParams()
    )
    const rangeHistoryQuery = buildQuotaRangeHistoryQuery(
      new URLSearchParams({ from: '2026-05-01', to: '2026-05-08' })
    )

    expect(quotaQuery.sql).toContain(
      "o.observed_at >= s.interval_start - INTERVAL '5 minutes'"
    )
    expect(quotaQuery.sql).toContain(
      "o.observed_at <= s.expected_reset_at + INTERVAL '5 minutes'"
    )

    expect(velocityQuery.sql).toContain(
      "o.observed_at >= s.interval_start - INTERVAL '5 minutes'"
    )
    expect(velocityQuery.sql).toContain(
      "o.observed_at <= s.expected_reset_at + INTERVAL '5 minutes'"
    )

    expect(historyQuery.sql).toContain(
      "o.observed_at >= n.interval_start - INTERVAL '5 minutes'"
    )
    expect(historyQuery.sql).toContain(
      "o.observed_at <= n.expected_reset_at + INTERVAL '5 minutes'"
    )

    expect(historyFallbackQuery.sql).toContain(
      "o.observed_at >= n.interval_start - INTERVAL '5 minutes'"
    )
    expect(historyFallbackQuery.sql).toContain(
      "o.observed_at <= n.expected_reset_at + INTERVAL '5 minutes'"
    )

    expect(rangeHistoryQuery.sql).toContain(
      "o.observed_at >= n.interval_start - INTERVAL '5 minutes'"
    )
    expect(rangeHistoryQuery.sql).toContain(
      "o.observed_at <= n.expected_reset_at + INTERVAL '5 minutes'"
    )
  })

  test('test_buildQuotaHistoryFallbackQuery_returns_bounded_base_rows_without_usage_enrichment', () => {
    const query = buildQuotaHistoryFallbackQuery(new URLSearchParams())

    expect(query.values).toEqual([])
    expect(query.sql).toContain('ROW_NUMBER() OVER')
    expect(query.sql).toContain('interval_rank <=')
    expect(query.sql).toContain('observation_identity AS')
    expect(query.sql).toContain(
      "n.normalized_quota_key IN (\n          'xai_grok_build_weekly_credits:credits',"
    )
    expect(query.sql).toContain('AND o.provider = n.raw_provider')
    expect(query.sql).toContain('0::double precision AS velocity_sample_count')
    expect(query.sql).toContain("'[]'::jsonb AS velocity_segments")
    expect(query.sql).toContain("'[]'::jsonb AS velocity_scores")
    expect(query.sql).toContain('0::double precision AS usage_tokens')
    expect(query.sql).toContain("'[]'::json AS usage_breakdown")
    expect(query.sql).toContain('public.rate_limit_intervals')
    expect(query.sql).not.toContain('public.session_history')
  })

  test('test_buildQuotaRangeHistoryFallbackQuery_returns_range_base_rows_without_usage_enrichment', () => {
    const query = buildQuotaRangeHistoryFallbackQuery(
      new URLSearchParams({ from: '2026-05-01', to: '2026-05-08' })
    )

    expect(query.values).toEqual(['2026-05-01', '2026-05-08'])
    expect(query.sql).toContain(
      "ri.fromDate < ($2::date::timestamp AT TIME ZONE 'America/New_York')"
    )
    expect(query.sql).toContain(
      "ri.expected_reset_at >= ($1::date::timestamp AT TIME ZONE 'America/New_York')"
    )
    expect(query.sql).toContain("ri.quota_type IN ('short', 'short_special')")
    expect(query.sql).toContain(
      "lower(COALESCE(ri.provider, 'unknown')) IN ('openai', 'anthropic', 'claude')"
    )
    expect(query.sql).toContain('observation_identity AS')
    expect(query.sql).toContain(
      "n.normalized_quota_key IN (\n          'xai_grok_build_weekly_credits:credits',"
    )
    expect(query.sql).toContain('AND o.provider = n.raw_provider')
    expect(query.sql).toContain('0::double precision AS velocity_sample_count')
    expect(query.sql).toContain("'[]'::jsonb AS velocity_segments")
    expect(query.sql).toContain("'[]'::jsonb AS velocity_scores")
    expect(query.sql).toContain('0::double precision AS usage_tokens')
    expect(query.sql).toContain("'[]'::json AS usage_breakdown")
    expect(query.sql).toContain('public.rate_limit_intervals')
    expect(query.sql).not.toContain('public.session_history')
  })

  test('test_degraded_secondary_usage_reports_return_visible_empty_payloads', () => {
    const params = new URLSearchParams({
      from: '2026-05-01',
      to: '2026-05-08',
    })

    expect(buildDegradedUsageQuotaHistoryReport()).toMatchObject({
      metadata: {
        degraded: true,
        degradedReason: 'database_timeout',
        quotaHistoryStatementTimeoutMs: expect.any(Number),
      },
      quotaHistory: [],
    })

    expect(
      buildDegradedUsageQuotaHistoryReport({
        timedOutSubqueries: ['history_enrichment'],
        quotaHistory: [
          {
            provider: 'openai',
            model: null,
            quota_type: 'weekly',
          },
        ],
      })
    ).toMatchObject({
      metadata: {
        degraded: true,
        degradedReason: 'database_timeout',
        timeout: true,
        timedOutSubquery: 'history_enrichment',
        timedOutSubqueries: ['history_enrichment'],
        quotaHistoryStatementTimeoutMs: expect.any(Number),
      },
      quotaHistory: [
        {
          provider: 'openai',
          model: null,
          quota_type: 'weekly',
        },
      ],
    })

    expect(buildDegradedUsageTokenTrendSummaryReport(params)).toMatchObject({
      metadata: {
        from: '2026-05-01',
        to: '2026-05-08',
        degraded: true,
        degradedReason: 'database_timeout',
        timeout: true,
        tokenTrendSummaryStatementTimeoutMs: expect.any(Number),
      },
      tokenTrendHours: [],
      tokenTrendHealth: [],
      tokenTrendScores: [],
      tokenTrendVersions: [],
      tokenTrendModelFirstSeen: [],
    })
  })

  test('test_buildDegradedUsageQuotaRangeHistoryReport_marks_timeout_metadata', () => {
    const params = new URLSearchParams({
      from: '2026-05-01',
      to: '2026-05-08',
    })

    expect(buildDegradedUsageQuotaRangeHistoryReport()).toMatchObject({
      metadata: {
        degraded: true,
        degradedReason: 'database_timeout',
        timeout: true,
        timedOutSubqueries: [],
        quotaRangeHistoryStatementTimeoutMs: expect.any(Number),
      },
      quotaRangeHistory: [],
    })

    expect(
      buildDegradedUsageQuotaRangeHistoryReport({
        searchParams: params,
        timedOutSubqueries: ['history_enrichment'],
        quotaRangeHistory: [
          {
            provider: 'openai',
            model: null,
            quota_type: 'weekly',
          },
        ],
      })
    ).toMatchObject({
      metadata: {
        from: '2026-05-01',
        to: '2026-05-08',
        degraded: true,
        degradedReason: 'database_timeout',
        timeout: true,
        timedOutSubquery: 'history_enrichment',
        timedOutSubqueries: ['history_enrichment'],
        degradedMessage: expect.stringContaining('history_enrichment'),
      },
      quotaRangeHistory: [
        {
          provider: 'openai',
          model: null,
          quota_type: 'weekly',
        },
      ],
    })
  })

  test('test_buildDegradedUsageTokenTrendSummaryReport_identifies_timed_out_subquery', () => {
    const params = new URLSearchParams({
      from: '2026-05-01',
      to: '2026-05-08',
    })

    expect(
      buildDegradedUsageTokenTrendSummaryReport(params, {
        timedOutSubqueries: ['health'],
      })
    ).toMatchObject({
      metadata: {
        degraded: true,
        degradedReason: 'database_timeout',
        degradedMessage: expect.stringContaining('subquery "health"'),
        timeout: true,
        timedOutSubquery: 'health',
        timedOutSubqueries: ['health'],
        tokenTrendSummaryStatementTimeoutMs: expect.any(Number),
      },
      tokenTrendHours: [],
      tokenTrendHealth: [],
      tokenTrendScores: [],
      tokenTrendVersions: [],
      tokenTrendModelFirstSeen: [],
    })
  })

  test('test_buildDegradedUsageTokenTrendSummaryReport_marks_bounded_raw_lane_policy_metadata', () => {
    const params = new URLSearchParams({
      from: '2026-05-01',
      to: '2026-06-01',
    })

    expect(
      buildDegradedUsageTokenTrendSummaryReport(params, {
        skippedSubqueries: ['hours', 'scores', 'versions', 'modelFirstSeen'],
        tokenTrendSummaryRangeDays: 30,
        tokenTrendSummaryRawLaneMaxDays: 7,
        tokenTrendHours: [],
        tokenTrendHealth: [{ provider: 'openai', value: 1 }],
        tokenTrendVersions: [],
      })
    ).toMatchObject({
      metadata: {
        degraded: true,
        degradedReason: 'bounded_raw_lane_policy',
        degradedMessage: expect.stringContaining('skipped'),
        skippedSubqueries: ['hours', 'scores', 'versions', 'modelFirstSeen'],
        unavailableSubqueries: [
          'hours',
          'scores',
          'versions',
          'modelFirstSeen',
        ],
        tokenTrendSummaryRawLaneMaxDays: 7,
        tokenTrendSummaryRangeDays: 30,
        tokenTrendSummaryStatementTimeoutMs: expect.any(Number),
      },
      tokenTrendHours: [],
      tokenTrendHealth: [{ provider: 'openai', value: 1 }],
      tokenTrendScores: [],
      tokenTrendVersions: [],
      tokenTrendModelFirstSeen: [],
    })
  })

  test('test_buildDegradedUsageTokenTrendSummaryReport_preserves_partial_payload', () => {
    const params = new URLSearchParams({
      from: '2026-05-01',
      to: '2026-05-08',
    })

    const healthRows = [{ provider: 'openai', score_bucket: 'p95' }]
    const scoreRows = [{ provider: 'openai', date: '2026-05-01' }]
    const versionRows = [{ provider: 'openai', day: '2026-05-01' }]
    const modelFirstSeenRows = [{ date: '2026-05-01', provider: 'openai' }]

    expect(
      buildDegradedUsageTokenTrendSummaryReport(params, {
        timedOutSubqueries: ['hours'],
        tokenTrendHours: [],
        tokenTrendHealth: healthRows,
        tokenTrendScores: scoreRows,
        tokenTrendVersions: versionRows,
        tokenTrendModelFirstSeen: modelFirstSeenRows,
      })
    ).toMatchObject({
      metadata: {
        degraded: true,
        degradedReason: 'database_timeout',
        degradedMessage: expect.stringContaining('partial payload'),
        timeout: true,
        timedOutSubquery: 'hours',
        timedOutSubqueries: ['hours'],
        tokenTrendSummaryStatementTimeoutMs: expect.any(Number),
      },
      tokenTrendHours: [],
      tokenTrendHealth: healthRows,
      tokenTrendScores: scoreRows,
      tokenTrendVersions: versionRows,
      tokenTrendModelFirstSeen: modelFirstSeenRows,
    })
  })

  test('test_usageTokenTrendSummarySubqueryKeys_match_loader_fanout_order', () => {
    expect(USAGE_TOKEN_TREND_SUMMARY_SUBQUERY_KEYS).toEqual([
      'hours',
      'health',
      'scores',
      'versions',
      'modelFirstSeen',
    ])
  })

  test('test_buildDegradedQuotaReport_returns_bounded_timeout_payload', () => {
    const report = buildDegradedQuotaReport()

    expect(report).toMatchObject({
      metadata: {
        generatedAt: expect.any(String),
        degraded: true,
        degradedReason: 'database_timeout',
        degradedMessage: expect.stringContaining('database timeout'),
        quotaReportStatementTimeoutMs: expect.any(Number),
        latestRecordAt: null,
        latestRecordAgeMinutes: null,
        latestRecordStale: true,
        staleRecordThresholdMinutes: expect.any(Number),
      },
      quotas: [],
    })
  })

  test('test_session_history_reportable_filter_reaches_reporting_query_paths', () => {
    const params = new URLSearchParams({
      from: '2026-05-01',
      to: '2026-05-08',
      provider: 'openai,anthropic',
    })
    const queries = [
      buildTokenTrendHoursQuery(params),
      buildTokenTrendScoreQuery(params),
      buildTokenTrendModelFirstSeenQuery(params),
      buildQuotaHistoryQuery(params),
      buildQuotaRangeHistoryQuery(params),
      buildQuotaEstimatorUsageBucketQuery(params),
      buildToolActivityQuery(params),
    ]

    for (const query of queries) {
      expectReportableSessionHistoryFilter(query.sql)
    }
  })

  test('test_buildToolActivityQuery_reuses_filtered_session_history_call_set', () => {
    const query = buildToolActivityQuery(
      new URLSearchParams({ from: '2026-05-01', to: '2026-05-08' })
    )

    expect(query.values).toEqual(['2026-05-01', '2026-05-08', 5000])
    expect(query.sql).toContain('WITH bounds AS')
    expect(query.sql).toContain('recent_activity AS MATERIALIZED')
    expect(query.sql).toContain('tool_rows AS MATERIALIZED')
    expect(query.sql).toContain('FROM public.session_history_tool_activity a')
    expect(query.sql).toContain('JOIN public.session_history sh')
    expect(query.sql).toContain('a.id > b.min_id')
    expect(query.sql).toContain('FROM tool_rows')
  })

  test('test_buildToolActivityQuery_reuses_canonical_provider_dimension_expression', () => {
    const query = buildToolActivityQuery(
      new URLSearchParams({ from: '2026-05-01', to: '2026-05-08' })
    )

    expect(query.sql).toContain(
      "WHEN lower(COALESCE(sh.provider, 'unknown')) IN ('google', 'gemini') THEN 'google'"
    )
    expect(query.sql).toContain(
      "WHEN lower(COALESCE(sh.provider, 'unknown')) = 'nvidia' THEN 'nvidia_nim'"
    )
    expect(query.sql).toContain(
      "WHEN lower(COALESCE(sh.provider, 'unknown')) LIKE 'local_%' THEN 'local'"
    )
    expect(query.sql).toContain("ELSE COALESCE(sh.provider, 'unknown')")
  })

  test('test_buildDegradedUsageToolActivityReport_returns_bounded_timeout_payload', () => {
    const report = buildDegradedUsageToolActivityReport(
      new URLSearchParams({ from: '2026-05-01', to: '2026-05-08' })
    )

    expect(report).toMatchObject({
      metadata: {
        from: '2026-05-01',
        to: '2026-05-08',
        degraded: true,
        degradedReason: 'database_timeout',
        toolActivityRecentRowLimit: 5000,
        toolActivityRecentIdCapActive: true,
      },
      toolActivity: [],
    })
  })

  test('buildToolActivityQuery_emits_explicit_recent_id_cap_truncation_metadata', () => {
    const query = buildToolActivityQuery(
      new URLSearchParams({ from: '2026-05-01', to: '2026-05-08' })
    )

    expect(query.metadata).toMatchObject({
      from: '2026-05-01',
      to: '2026-05-08',
      toolActivityRecentRowLimit: 5000,
      toolActivityRecentIdCapActive: true,
    })
    expect(query.sql).toContain('window_cap_state AS')
    expect(query.sql).toContain('FROM window_cap_state cap')
    expect(query.sql).toContain('LEFT JOIN (')
    expect(query.sql).not.toContain('CROSS JOIN window_cap_state cap')
    expect(query.sql).toContain('a.id > b.min_id')
    expect(query.sql).toContain('AND a.id <= b.min_id')
    expect(query.sql).toContain('tool_activity_bounded_min_id')
    expect(query.sql).toContain('tool_activity_bounded_max_id')
    expect(query.sql).toContain('tool_activity_recent_row_limit')
    expect(query.sql).toContain('tool_activity_recent_id_cap_active')
    expect(query.sql).toContain(
      'tool_activity_recent_id_cap_truncates_requested_window'
    )
  })

  test('buildToolActivityQuery_preserves_cap_metadata_when_activity_rows_empty', () => {
    const query = buildToolActivityQuery(
      new URLSearchParams({ from: '2026-05-01', to: '2026-05-08' })
    )

    expect(query.sql).toContain('FROM window_cap_state cap')
    expect(query.sql).toContain('LEFT JOIN (')
    expect(query.sql).toMatch(
      /FROM window_cap_state cap\s+LEFT JOIN \(\s+SELECT\s+provider,/s
    )
    expect(query.sql).toContain(
      'ORDER BY activity_rows.provider ASC NULLS LAST'
    )
  })

  test('buildUsageQuery_emits_explicit_agent_score_reasons_cap_truncation_metadata', () => {
    const query = buildUsageQuery(
      new URLSearchParams({
        from: '2026-05-01',
        to: '2026-05-08',
        grain: 'day',
        group_by: 'provider,model,repository',
        limit: '50000',
      })
    )

    expect(query.metadata).toMatchObject({
      from: '2026-05-01',
      to: '2026-05-08',
      agentScoreReasonsRecentRowLimit: 10_000,
      agentScoreReasonsRecentIdCapActive: true,
    })
    expect(query.sql).toContain('reason_bounds AS')
    expect(query.sql).toContain('reason_cap_state AS')
    expect(query.sql).toContain('CROSS JOIN reason_cap_state cap')
    expect(query.sql).toContain('sh.id > rb.min_id')
    expect(query.sql).toContain('sh_window.id <= rb.min_id')
    expect(query.sql).toContain('agent_score_reasons_bounded_min_id')
    expect(query.sql).toContain('agent_score_reasons_bounded_max_id')
    expect(query.sql).toContain('agent_score_reasons_recent_row_limit')
    expect(query.sql).toContain('agent_score_reasons_recent_id_cap_active')
    expect(query.sql).toContain(
      'agent_score_reasons_recent_id_cap_truncates_requested_window'
    )
  })
  test('test_token_trend_signal_queries_cover_full_range_and_hourly_scores', () => {
    const params = new URLSearchParams({
      from: '2026-05-01',
      to: '2026-06-01',
      provider: 'anthropic',
      model: 'claude-sonnet-4-6',
      environment: 'local',
    })
    const healthQuery = buildTokenTrendHealthQuery(params)
    const scoreQuery = buildTokenTrendScoreQuery(params)

    expect(healthQuery.values).toEqual([
      '2026-05-01T04:00:00.000Z',
      '2026-06-01T04:00:00.000Z',
      ['local'],
      ['anthropic'],
      ['claude-sonnet-4-6'],
    ])
    expect(healthQuery.sql).toContain('public.provider_latency_health_5m h')
    expect(healthQuery.sql).toContain(
      "date_trunc('hour', h.bucket_start AT TIME ZONE 'America/New_York')"
    )
    expect(healthQuery.sql).not.toContain('resolveHealthWindow')

    expect(scoreQuery.values).toEqual([
      '2026-05-01',
      '2026-06-01',
      ['local'],
      ['anthropic'],
      ['claude-sonnet-4-6'],
    ])
    expect(scoreQuery.sql).toContain('sh.created_at >=')
    expect(scoreQuery.sql).not.toContain('sh.start_time >=')
    expect(scoreQuery.sql).toContain("date_trunc('hour', (sh.created_at")
    expect(scoreQuery.sql).toContain('sh.trace_quality_score IS NOT NULL')
    expect(scoreQuery.sql).toContain('AS agent_quality_score')
    expect(scoreQuery.sql).toContain('AS agent_risk_score')
    expect(scoreQuery.sql).toContain(
      'AS agent_ignored_path_tracking_policy_score'
    )
    expect(scoreQuery.sql).toContain(
      'AS agent_baseline_deflection_attempted_score'
    )
    expect(scoreQuery.sql).toContain(
      'AS agent_sleep_wellness_interruption_attempted_score'
    )
    expect(scoreQuery.sql).toContain('HAVING')
    expect(scoreQuery.sql).toContain('COUNT(sh.trace_quality_score) > 0')
    expect(scoreQuery.sql).toContain(
      'sh.ignored_path_tracking_policy_score IS NOT NULL'
    )
    expect(scoreQuery.sql).toContain(
      'COUNT(sh.ignored_path_tracking_policy_score) > 0'
    )
    expect(scoreQuery.sql).not.toContain('COALESCE(sh.trace_quality_score, 0)')
  })

  test('test_buildQuotaRangeHistoryQuery_is_range_aware_and_static_for_quota_tab', () => {
    const query = buildQuotaRangeHistoryQuery(
      new URLSearchParams({ from: '2026-05-01', to: '2026-05-08' })
    )

    expect(query.values).toEqual(['2026-05-01', '2026-05-08'])
    expect(query.sql).toContain(
      "ri.fromDate < ($2::date::timestamp AT TIME ZONE 'America/New_York')"
    )
    expect(query.sql).toContain(
      "ri.expected_reset_at >= ($1::date::timestamp AT TIME ZONE 'America/New_York')"
    )
    expect(query.sql).toContain("ri.quota_type IN ('short', 'short_special')")
    expect(query.sql).toContain(
      "lower(COALESCE(ri.provider, 'unknown')) IN ('openai', 'anthropic', 'claude')"
    )
    expect(query.sql).not.toContain(
      "ri.expected_reset_at < ($2::date::timestamp AT TIME ZONE 'America/New_York')"
    )
    expect(query.sql).toContain('wb.expected_reset_at AS interval_end')
    expect(query.sql).toContain('0::double precision AS velocity_sample_count')
    expect(query.sql).toContain("'[]'::jsonb AS velocity_segments")
    expect(query.sql).toContain("'[]'::jsonb AS velocity_scores")
  })

  test('test_buildQuotaEstimatorReport_keeps_cache_read_as_lower_separate_feature', () => {
    const rows: Parameters<typeof buildQuotaEstimatorReport>[0] = []
    const intervals = [
      { sonnet: 1.0, sonnetCache: 0.2, haiku: 0.4, opus: 0.1 },
      { sonnet: 0.6, sonnetCache: 0.7, haiku: 0.8, opus: 0.0 },
      { sonnet: 1.4, sonnetCache: 0.1, haiku: 0.1, opus: 0.2 },
      { sonnet: 0.2, sonnetCache: 0.8, haiku: 1.0, opus: 0.0 },
      { sonnet: 1.1, sonnetCache: 0.3, haiku: 0.0, opus: 0.4 },
      { sonnet: 0.4, sonnetCache: 0.4, haiku: 1.3, opus: 0.1 },
      { sonnet: 1.6, sonnetCache: 0.2, haiku: 0.2, opus: 0.3 },
      { sonnet: 0.7, sonnetCache: 0.9, haiku: 0.5, opus: 0.0 },
    ]
    intervals.forEach((interval, index) => {
      const deltaPct =
        interval.sonnet * 2 +
        interval.sonnetCache * 0.4 +
        interval.haiku * 1 +
        interval.opus * 4
      const base = {
        lag_minutes: 0,
        provider: 'anthropic',
        quota_key: 'anthropic_unified_7d:7d',
        quota_type: 'weekly',
        quota_lane: 'anthropic_weekly_all_model',
        raw_observation_quota_type: 'tokens',
        raw_interval_quota_type: 'weekly',
        expected_reset_at: '2026-05-08T00:00:00.000Z',
        reset_start_at: '2026-05-01T00:00:00.000Z',
        reset_end_at: '2026-05-08T00:00:00.000Z',
        interval_start_at: `2026-05-0${Math.min(index + 1, 8)}T00:00:00.000Z`,
        interval_end_at: `2026-05-0${Math.min(index + 1, 8)}T01:00:00.000Z`,
        previous_consumed_pct: 10 + index,
        current_consumed_pct: 10 + index + deltaPct,
        delta_pct: deltaPct,
        is_reset_boundary: false,
        is_capped_at_100: false,
        trainable: true,
        exclude_reason: null,
        output_tokens: 0,
        cache_create_tokens: 0,
        reasoning_tokens: 0,
        usd_cost: 0,
        tool_calls: 0,
      }
      rows.push(
        {
          ...base,
          model_family: 'sonnet',
          traces: 1,
          uncached_input_tokens: interval.sonnet * 1_000_000,
          cache_read_tokens: interval.sonnetCache * 1_000_000,
        },
        {
          ...base,
          model_family: 'haiku',
          traces: 1,
          uncached_input_tokens: interval.haiku * 1_000_000,
          cache_read_tokens: 0,
        },
        {
          ...base,
          model_family: 'opus',
          traces: 1,
          uncached_input_tokens: interval.opus * 1_000_000,
          cache_read_tokens: 0,
        }
      )
    })

    const report = buildQuotaEstimatorReport(rows, {
      from: '2026-05-01',
      to: '2026-05-08',
    })
    const estimate = report.estimates[0]
    const rollingSonnetWorkload = estimate.coefficients.find(
      (coefficient: { estimate_kind: string; feature: string }) =>
        coefficient.estimate_kind === 'rolling_exponential' &&
        coefficient.feature === 'sonnet:workload'
    )
    const rollingSonnetCacheRead = estimate.coefficients.find(
      (coefficient: { estimate_kind: string; feature: string }) =>
        coefficient.estimate_kind === 'rolling_exponential' &&
        coefficient.feature === 'sonnet:cache_read'
    )
    const sonnetRatio = estimate.cache_read_ratios.find(
      (ratio: { model_family: string }) => ratio.model_family === 'sonnet'
    )

    expect(report.phase0Audit.known_missing_fields).toContain(
      'cache_write_5m_tokens'
    )
    expect(estimate.selected_lag_minutes).toBe(0)
    expect(estimate.backtest.status).toBe('evaluated')
    expect(rollingSonnetWorkload?.coefficient_pct_per_mtok).toBeGreaterThan(0)
    expect(rollingSonnetCacheRead?.coefficient_pct_per_mtok).toBeGreaterThan(0)
    expect(rollingSonnetCacheRead!.coefficient_pct_per_mtok).toBeLessThan(
      rollingSonnetWorkload!.coefficient_pct_per_mtok
    )
    expect(sonnetRatio?.cache_read_vs_uncached_workload_ratio).toBeLessThan(1)
  })

  test('test_buildTokenTrendHoursQuery_includes_tool_call_counts_for_tool_lane', () => {
    const query = buildTokenTrendHoursQuery(
      new URLSearchParams({ from: '2026-05-01', to: '2026-05-08' })
    )

    expect(query.values).toEqual(['2026-05-01', '2026-05-08'])
    expect(query.sql).toContain('sh.created_at >=')
    expect(query.sql).not.toContain('sh.start_time >=')
    expect(query.sql).toContain(
      'SUM(COALESCE(sh.tool_call_count, 0))::double precision AS tool_calls'
    )
  })

  test('test_buildTokenTrendDayDetailQuery_anchors_report_range_on_created_at', () => {
    const query = buildTokenTrendDayDetailQuery(
      new URLSearchParams({
        from: '2026-05-01',
        to: '2026-05-08',
        date: '2026-05-03',
        provider: 'anthropic',
      })
    )

    expect(query.values).toEqual([
      '2026-05-01',
      '2026-05-08',
      ['anthropic'],
      '2026-05-03',
    ])
    expect(query.sql).toContain('sh.created_at >=')
    expect(query.sql).toContain(
      "sh.created_at < ($2::date::timestamp AT TIME ZONE 'America/New_York')"
    )
    expect(query.sql).not.toContain('sh.start_time >=')
    expect(query.sql).not.toContain('sh.start_time <')
    expect(query.sql).toContain(
      "(sh.created_at AT TIME ZONE 'America/New_York')::date = $4::date"
    )
    expect(query.metadata).toEqual({
      date: '2026-05-03',
      from: '2026-05-01',
      to: '2026-05-08',
    })
  })

  test('test_buildTokenTrendModelFirstSeenQuery_uses_local_supported_provider_models', () => {
    const query = buildTokenTrendModelFirstSeenQuery(
      new URLSearchParams({
        from: '2026-05-01',
        to: '2026-05-08',
        provider: 'openai,anthropic',
      })
    )

    expect(query.values).toEqual([
      '2026-05-01',
      '2026-05-08',
      ['openai', 'anthropic'],
    ])
    expect(query.sql).toContain('WITH model_usage AS')
    expect(query.sql).toContain(
      "END IN ('anthropic', 'openai', 'xai', 'google')"
    )
    expect(query.sql).toContain('sh.created_at >=')
    expect(query.sql).not.toContain('sh.start_time >=')
    expect(query.sql).toContain('MIN(sh.created_at) AS first_seen_at')
    expect(query.sql).toContain('MIN((sh.created_at AT TIME ZONE')
    expect(query.sql).not.toContain('WHERE first_seen_local::date >=')
    expect(query.sql).toContain('AS first_seen_day')
    expect(query.sql).toContain('AS first_seen_hour')
    expect(query.sql).toContain('AS observations')
    expect(query.sql).not.toMatch(/\brelease\b/i)
  })

  test('test_aawm_observe_proxy_prefix_covers_handoff_route_patterns', () => {
    const paths = [
      '/api/aawm-observe/metrics/query_range',
      '/api/aawm-observe/metrics/label_values',
      '/api/aawm-observe/traces/search',
      '/api/aawm-observe/profiles/',
      '/api/aawm-observe/profiles/dashboard-shell/report-service/index.html',
      '/api/aawm-observe/manifest',
      '/api/aawm-observe/findings',
      '/api/aawm-observe/scores',
      '/api/aawm-observe/suites',
      '/api/aawm-observe/suites/symbols',
    ]

    for (const path of paths) {
      const proxy = findUpstreamApiProxy(path)
      expect(proxy?.displayName).toBe('AAWM Observe')
    }

    expect(
      findUpstreamApiProxy('/api/aawm-observeish/manifest')
    ).toBeUndefined()
  })

  test('test_aawm_observe_proxy_rewrites_prefix_and_preserves_query', () => {
    const proxy = findUpstreamApiProxy('/api/aawm-observe/suites/symbols')
    expect(proxy).toBeDefined()

    const target = proxyTargetUrl(
      {
        url: '/api/aawm-observe/suites/symbols?limit=50&lane=type_shape',
        headers: { host: 'dashboard-shell.test' },
      },
      proxy!
    )

    expect(target.pathname).toBe('/suites/symbols')
    expect(target.searchParams.get('limit')).toBe('50')
    expect(target.searchParams.get('lane')).toBe('type_shape')
  })
})

// ---------------------------------------------------------------------------
// D1-323 provider alias routing health contracts
// ---------------------------------------------------------------------------

describe('D1-323 provider alias routing health contracts', () => {
  const aliasRoutingMetadataKeys = [
    'codex_auto_agent_affinity_state_source',
    'codex_auto_agent_cooldown_state_source',
    'anthropic_auto_agent_affinity_state_source',
    'anthropic_auto_agent_cooldown_state_source',
    'codex_auto_agent_selected_provider',
    'codex_auto_agent_selected_model',
    'codex_auto_agent_selected_route_family',
    'anthropic_auto_agent_selected_provider',
    'anthropic_auto_agent_selected_model',
    'requested_model_alias',
    'model_alias_label',
    'codex_auto_agent_skipped_candidates',
    'anthropic_auto_agent_skipped_candidates',
  ] as const

  test('test_buildProviderAliasRoutingQuery_projects_safe_metadata_keys', () => {
    const query = buildProviderAliasRoutingQuery(new URLSearchParams())

    expect(query.metadata).toMatchObject({
      lookbackHours: 24,
      limit: 400,
      dataSource: 'recent_observed_session_history',
    })
    expect(query.values).toEqual([400, 24])
    expect(query.sql).toContain('FROM public.session_history sh')
    expect(query.sql).toContain('public.aawm_alias_routing_audit')
    expect(query.sql).not.toMatch(/metadata::text/i)

    for (const key of aliasRoutingMetadataKeys) {
      expect(query.sql).toContain(`'${key}'`)
    }

    expect(query.sql).not.toContain('raw_prompt')
    expect(query.sql).not.toContain('authorization')
    expect(query.sql).not.toContain('access_token')
    expect(query.sql).not.toContain('refresh_token')
    expect(query.sql).not.toContain('sanitized_snapshot')
    expect(query.sql).toContain('cooldown_state_source')
    expect(query.sql).toContain('alias_route_events')
  })

  test('test_normalizeProviderAliasRoutingReport_strips_blocked_candidate_fields', () => {
    const future = new Date(Date.now() + 60_000).toISOString()
    const report = normalizeProviderAliasRoutingReport(
      [
        {
          created_at: '2026-06-28T19:00:00.000Z',
          provider: 'openai',
          model: 'gpt-5',
          inbound_model_alias: 'aawm-code',
          metadata: {
            codex_auto_agent_alias: 'aawm-code',
            codex_auto_agent_affinity_state_source: 'durable_cache',
            codex_auto_agent_selected_provider: 'openai',
            codex_auto_agent_selected_model: 'gpt-5',
            codex_auto_agent_selected_route_family: 'codex_primary',
            codex_auto_agent_skipped_candidates: [
              {
                provider: 'openrouter',
                model: 'gpt-4',
                reason: 'cooldown',
                api_key: 'sk-should-not-appear',
                details: { prompt: 'secret' },
              },
            ],
          },
          alias_route_events: [
            {
              observed_at: '2026-06-28T19:00:00.000Z',
              alias_family: 'codex',
              provider: 'openrouter',
              model: 'gpt-4',
              cooldown_until: future,
              cooldown_state_source: 'memory',
              failure_class: 'rate_limited',
            },
          ],
        },
      ],
      { generatedAt: '2026-06-28T19:00:00.000Z' }
    )

    expect(report.data_source).toBe('recent_observed_session_history')
    expect(report.freshness_label).toContain('not live Redis')
    const serialized = JSON.stringify(report)
    expect(serialized).not.toContain('sk-should-not-appear')
    expect(serialized).not.toContain('secret')
    expect(
      report.entries.some(
        (entry: { state_kind?: string }) => entry.state_kind === 'affinity'
      )
    ).toBe(true)
    expect(
      report.entries.some(
        (entry: { state_kind?: string }) => entry.state_kind === 'cooldown'
      )
    ).toBe(true)
    expect(
      report.entries.find(
        (entry: { state_kind?: string; state_source?: string }) =>
          entry.state_kind === 'affinity'
      )?.state_source
    ).toBe('durable_cache')
  })
})

// ---------------------------------------------------------------------------
// D1-338 provider auth health contracts
// ---------------------------------------------------------------------------

describe('D1-338 provider auth health contracts', () => {
  test('test_buildProviderAuthHealthQuery_projects_safe_provider_auth_current_fields', () => {
    const query = buildProviderAuthHealthQuery(new URLSearchParams())

    expect(query.metadata).toMatchObject({
      limit: 200,
      dataSource: 'provider_auth_current',
    })
    expect(query.values).toEqual([200])
    expect(query.sql).toContain('FROM public.provider_auth_current')
    expect(query.sql).toContain('auth_family')
    expect(query.sql).toContain("left(COALESCE(auth_file_hash, ''), 8)")
    expect(query.sql).toContain("metadata->>'auth_file_source'")
    expect(query.sql).toContain('error_message')
    expect(query.sql).not.toContain('refresh_token')
    expect(query.sql).not.toContain('access_token')
    expect(query.sql).not.toContain('metadata::text')
    expect(query.sql).not.toMatch(/\smetadata\s*\n/i)
  })

  test('test_normalizeProviderAuthHealthRow_short_hash_and_redaction', () => {
    const future = new Date(Date.now() + 120_000).toISOString()
    const row = normalizeProviderAuthHealthRow(
      {
        observed_at: '2026-06-28T19:00:00.000Z',
        environment: 'production',
        provider: 'xai',
        auth_family: 'grok_oidc',
        credential_scope: 'default',
        auth_file_hash: 'abcdef0123456789deadbeef',
        status: 'refreshed',
        attempted: true,
        refreshed: true,
        skipped: false,
        expires_at: future,
        last_success_at: '2026-06-28T19:00:00.000Z',
        source_task: 'grok_oidc_refresh',
        error_class: null,
        error_message:
          'Bearer eyJhbGciOiJIUzI1NiJ9.secret.sig at /home/zepfu/.grok/auth.json',
        auth_file_source: '/home/zepfu/.grok/auth.json',
        metadata: {
          auth_file_source: 'auth_file',
          refresh_token: 'must-not-leak',
          auth_file: '/home/zepfu/.grok/auth.json',
        },
      },
      { nowMs: Date.parse('2026-06-28T19:00:00.000Z') }
    )

    expect(row.auth_file_hash_short).toBe('abcdef01')
    expect(row.auth_file_hash_short).not.toBe('abcdef0123456789deadbeef')
    expect(row.auth_health_state).toBe('refreshed')
    expect(row.auth_file_source).toBeNull()
    expect(row.error_message).toContain('[redacted')
    const serialized = JSON.stringify(row)
    expect(serialized).not.toContain('must-not-leak')
    expect(serialized).not.toContain('/home/zepfu')
  })

  test('test_classifyProviderAuthHealthState_skipped_expired_when_past_expiry', () => {
    const past = new Date(Date.now() - 60_000).toISOString()
    expect(
      classifyProviderAuthHealthState({
        status: 'skipped',
        skipped: true,
        expires_at: past,
      })
    ).toBe('skipped_expired')
    expect(
      classifyProviderAuthHealthState({
        status: 'skipped',
        skipped: true,
        expires_at: null,
      })
    ).toBe('skipped_expired')
  })

  test('test_normalizeProviderAuthHealthReport_failed_row', () => {
    const report = normalizeProviderAuthHealthReport([
      {
        observed_at: '2026-06-28T19:00:00.000Z',
        environment: 'production',
        provider: 'xai',
        auth_family: 'grok_oidc',
        status: 'failed',
        attempted: true,
        refreshed: false,
        skipped: false,
        error_class: 'refresh_error',
        error_message: 'token refresh failed',
      },
    ])
    expect(report.data_source).toBe('provider_auth_current')
    expect(report.entries[0]?.auth_health_state).toBe('failed')
  })
})

// ---------------------------------------------------------------------------
// D1-417 / D1-422 provider credit lifecycle contracts
// ---------------------------------------------------------------------------

describe('D1-417 / D1-422 provider credit lifecycle contracts', () => {
  test('test_buildProviderCreditLifecycleQuery_projects_safe_provider_credit_current_fields', () => {
    const query = buildProviderCreditLifecycleQuery(new URLSearchParams())

    expect(query.metadata).toMatchObject({
      limit: 500,
      dataSource: 'provider_credit_current',
    })
    expect(query.values).toEqual([500])
    expect(query.sql).toContain('FROM public.provider_credit_current')
    expect(query.sql).toContain("provider = 'openai'")
    expect(query.sql).toContain("credit_family = 'codex_rate_limit_reset'")
    expect(query.sql).toContain('AS account_hash_short')
    expect(query.sql).toContain("left(COALESCE(cr.account_hash, ''), 8)")
    expect(query.sql).not.toMatch(/\n\s*account_hash,\s*\n/)
    expect(query.sql).not.toMatch(
      /\n\s*account_hash_short,\s*\n[\s\S]*\n\s*account_hash,\s*\n/
    )
    expect(query.sql).toContain('credit_identity')
    expect(query.sql).toContain('operator_annotation')
    expect(query.sql).toContain('source_url')
    expect(query.sql).not.toContain('raw_provider_fields')
    expect(query.sql).not.toContain('evidence')
    expect(query.sql).not.toContain('SELECT *')
    assertNoShorthandMetadataProjection(query.sql)
    expect(query.sql).toContain('WITH filtered_credit_rows AS')
    expect(query.sql).toContain('FROM public.provider_credit_current cr')
    expect(query.sql).toContain('FROM public.provider_credit_current detail')
    expect(query.sql).toContain('NOT EXISTS')
    expect(query.sql).toContain('NULLIF(BTRIM(COALESCE(detail.credit_identity')
    expect(query.sql).toMatch(/LIMIT \$1;/)
    expect(query.sql).not.toMatch(
      /FROM filtered_credit_rows[\s\S]*LIMIT[\s\S]*NOT EXISTS/
    )
  })

  test('test_filterLegacyProviderCreditAggregateRows_keeps_aggregate_when_no_detail_and_drops_when_multiple_detail', () => {
    const rows = [
      {
        environment: 'staging',
        provider: 'openai',
        account_hash: 'aaaaaaaa',
        credit_family: 'codex_rate_limit_reset',
        source: 'legacy',
        credit_identity: '',
        status: 'available',
        available_count: 5,
      },
      {
        environment: 'production',
        provider: 'openai',
        account_hash: 'bbbbbbbb',
        credit_family: 'codex_rate_limit_reset',
        source: 'x.com',
        credit_identity: 'credit-a',
        status: 'available',
        available_count: 1,
      },
      {
        environment: 'production',
        provider: 'openai',
        account_hash: 'bbbbbbbb',
        credit_family: 'codex_rate_limit_reset',
        source: 'x.com',
        credit_identity: 'credit-b',
        status: 'used',
        available_count: 0,
      },
      {
        environment: 'production',
        provider: 'openai',
        account_hash: 'bbbbbbbb',
        credit_family: 'codex_rate_limit_reset',
        source: 'x.com',
        credit_identity: '',
        status: 'available',
        available_count: 99,
      },
    ]
    const filtered = filterLegacyProviderCreditAggregateRows(rows)
    expect(
      filtered.map(
        (r: { credit_identity?: string | null }) => r.credit_identity ?? ''
      )
    ).toEqual(['', 'credit-a', 'credit-b'])
  })

  test('test_filterLegacyProviderCreditAggregateRows_drops_empty_identity_when_detail_exists', () => {
    const rows = [
      {
        environment: 'production',
        provider: 'openai',
        account_hash: '8e928548abcd',
        credit_family: 'codex_rate_limit_reset',
        source: 'x.com',
        credit_identity: 'credit-a',
        status: 'available',
        available_count: 1,
      },
      {
        environment: 'production',
        provider: 'openai',
        account_hash: '8e928548abcd',
        credit_family: 'codex_rate_limit_reset',
        source: 'x.com',
        credit_identity: '',
        status: 'available',
        available_count: 2,
      },
    ]
    const filtered = filterLegacyProviderCreditAggregateRows(rows)
    expect(filtered).toHaveLength(1)
    expect(filtered[0]?.credit_identity).toBe('credit-a')
  })

  test('test_buildProviderCreditLifecycleSummaries_counts_available_used_expired', () => {
    const entries = [
      {
        environment: 'production',
        provider: 'openai',
        credit_family: 'codex_rate_limit_reset',
        status: 'available',
        available_count: 1,
      },
      {
        environment: 'production',
        provider: 'openai',
        credit_family: 'codex_rate_limit_reset',
        status: 'available',
        available_count: 1,
      },
      {
        environment: 'production',
        provider: 'openai',
        credit_family: 'codex_rate_limit_reset',
        status: 'used',
        available_count: 0,
      },
      {
        environment: 'production',
        provider: 'openai',
        credit_family: 'codex_rate_limit_reset',
        status: 'expired',
        available_count: 0,
      },
    ]
    const summaries = buildProviderCreditLifecycleSummaries(entries)
    expect(summaries[0]).toMatchObject({
      provider: 'openai',
      credit_family: 'codex_rate_limit_reset',
      available_count: 2,
      used_count: 1,
      expired_count: 1,
      total_count: 4,
    })
  })

  test('test_normalizeProviderCreditLifecycleRow_redacts_url_and_operator', () => {
    const row = normalizeProviderCreditLifecycleRow({
      observed_at: '2026-06-28T20:00:00.000Z',
      environment: 'production',
      provider: 'openai',
      account_hash: '8e928548deadbeef',
      credit_family: 'codex_rate_limit_reset',
      credit_type: 'reset',
      available_count: 1,
      expires_at: '2026-06-29T20:00:00.000Z',
      source: 'x.com',
      credit_identity: 'codex-credit-1',
      granted_at: '2026-06-28T19:00:00.000Z',
      status: 'available',
      operator_annotation:
        'token=sk-secret-sentinel-should-not-render path=/home/zepfu/.openai',
      source_url: 'https://user:pass@x.com/status/123?utm=1#frag',
    })

    expect(row.account_hash_short).toBe('8e928548')
    expect(row.account_hash_short).not.toBe('8e928548deadbeef')
    expect(row.status).toBe('available')
    expect(row.source_url).toBe('https://x.com/status/123')
    expect(row.operator_annotation).toContain('[redacted')
    const serialized = JSON.stringify(row)
    expect(serialized).not.toContain('sk-secret-sentinel')
    expect(serialized).not.toContain('/home/zepfu')
    expect(serialized).not.toContain('raw_provider_fields')
    expect(serialized).not.toContain('evidence')
  })

  test('test_normalizeProviderCreditLifecycleReport_preserves_used_vs_expired', () => {
    const report = normalizeProviderCreditLifecycleReport([
      {
        observed_at: '2026-06-28T20:00:00.000Z',
        environment: 'production',
        provider: 'openai',
        account_hash: '8e928548',
        credit_family: 'codex_rate_limit_reset',
        credit_identity: 'used-1',
        status: 'used',
        available_count: 0,
        redeemed_at: '2026-06-28T18:00:00.000Z',
      },
      {
        observed_at: '2026-06-28T20:00:00.000Z',
        environment: 'production',
        provider: 'openai',
        account_hash: '8e928548',
        credit_family: 'codex_rate_limit_reset',
        credit_identity: 'expired-1',
        status: 'expired',
        available_count: 0,
        expires_at: '2026-06-27T20:00:00.000Z',
      },
    ])
    expect(report.data_source).toBe('provider_credit_current')
    expect(
      report.entries.map((entry: { status?: string }) => entry.status)
    ).toEqual(['used', 'expired'])
    expect(report.summaries[0]?.used_count).toBe(1)
    expect(report.summaries[0]?.expired_count).toBe(1)
  })
})

// D1-437 usage row serialization and cache scope
describe('D1-437 usage row serialization', () => {
  test('test_shouldSuppressCacheRefreshFailureDuringShutdown_false_before_shutdown', () => {
    const error = new Error('Cannot use a pool after calling end on the pool')
    expect(shouldSuppressCacheRefreshFailureDuringShutdown(error, false)).toBe(
      false
    )
  })

  test('test_shouldSuppressCacheRefreshFailureDuringShutdown_true_during_shutdown', () => {
    const error = new Error('Cannot use a pool after calling end on the pool')
    expect(shouldSuppressCacheRefreshFailureDuringShutdown(error, true)).toBe(
      true
    )
  })

  test('test_shouldSuppressCacheRefreshFailureDuringShutdown_false_for_other_errors_during_shutdown', () => {
    const error = new Error('unexpected database failure')
    expect(shouldSuppressCacheRefreshFailureDuringShutdown(error, true)).toBe(
      false
    )
  })

  test('test_compactUsageRow_omits_null_undefined_and_empty_string_fields', () => {
    const row = {
      provider: 'openai',
      model: 'gpt-4',
      traces: 12,
      cache_miss_summary: null,
      cache_attempted_summary: undefined,
      reasoning_tokens_sources: '',
      usd_cost: 1.5,
    }
    expect(compactUsageRow(row)).toEqual({
      provider: 'openai',
      model: 'gpt-4',
      traces: 12,
      usd_cost: 1.5,
    })
  })

  test('test_shouldIncludeEmptyUsageRowFields_honors_truthy_query_param', () => {
    expect(
      shouldIncludeEmptyUsageRowFields(
        new URLSearchParams({ include_empty_row_fields: '1' })
      )
    ).toBe(true)
    expect(
      shouldIncludeEmptyUsageRowFields(
        new URLSearchParams({ include_empty_row_fields: 'true' })
      )
    ).toBe(true)
    expect(
      shouldIncludeEmptyUsageRowFields(
        new URLSearchParams({ include_empty_row_fields: 'yes' })
      )
    ).toBe(true)
    expect(shouldIncludeEmptyUsageRowFields(new URLSearchParams())).toBe(false)
  })

  test('test_buildUsageReportRowSerializationMetadata_defaults_to_compact_rows', () => {
    expect(
      buildUsageReportRowSerializationMetadata(new URLSearchParams())
    ).toEqual({
      compactRows: true,
      rowNullFieldsOmitted: true,
      includeEmptyRowFields: false,
    })
  })

  test('test_buildUsageReportRowSerializationMetadata_opt_in_full_rows', () => {
    expect(
      buildUsageReportRowSerializationMetadata(
        new URLSearchParams({ include_empty_row_fields: 'yes' })
      )
    ).toEqual({
      compactRows: false,
      rowNullFieldsOmitted: false,
      includeEmptyRowFields: true,
    })
  })

  test('test_usage_report_cache_scope_is_versioned_usage_v2', () => {
    expect(USAGE_REPORT_CACHE_SCOPE).toBe('usage-v2')
  })
})
