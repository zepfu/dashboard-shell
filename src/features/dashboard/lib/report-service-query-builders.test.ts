import { describe, expect, test } from 'vitest'
import {
  buildPgBouncerAdminDatabaseUrl,
  buildToolActivityQuery,
  buildQuotaQuery,
  buildReportQueryPressureQuery,
  buildSourceTableHealthQuery,
  buildUsageQuery,
  buildQuotaEstimatorDatasetQuery,
  buildQuotaEstimatorReport,
  buildQuotaEstimatorUsageBucketQuery,
  buildQuotaRangeHistoryQuery,
  buildTokenTrendHealthQuery,
  buildTokenTrendHoursQuery,
  buildTokenTrendModelFirstSeenQuery,
  buildTokenTrendScoreQuery,
  findUpstreamApiProxy,
  normalizePgBouncerPoolRow,
  normalizePgBouncerStatsRow,
  proxyTargetUrl,
} from '../../../../server/report-service.mjs'

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
    expect(query.sql).toContain('AS agent_discovery_inventory_coverage_score')
    expect(query.sql).toContain(
      'AS agent_discovery_inventory_coverage_evaluated'
    )
    expect(query.sql).toContain(
      'AS agent_discovery_inventory_coverage_possible'
    )
    expect(query.sql).toContain(
      'AS agent_discovery_inventory_coverage_failures'
    )
    expect(query.sql).toContain('AS agent_discovery_inventory_missing_count')
    expect(query.sql).toContain('AS agent_terminal_completion_score')
    expect(query.sql).toContain('AS agent_terminal_completion_evaluated')
    expect(query.sql).toContain('AS agent_terminal_completion_possible')
    expect(query.sql).toContain('AS agent_terminal_completion_failures')
    expect(query.sql).toContain('AS agent_compact_summary_events')
    expect(query.sql).toContain('AS agent_compact_summary_thread_count')
    expect(query.sql).toContain('AS agent_compact_summary_id_count')
    expect(query.sql).toContain('AS agent_compact_summary_resume_contexts')
    expect(query.sql).toContain('AS agent_compact_summary_verify_contexts')
    expect(query.sql).toContain('AS agent_compact_summary_source_counts')
    expect(query.sql).toContain(
      'COUNT(*) FILTER (WHERE sh.is_compact_summary IS TRUE)'
    )
    expect(query.sql).toContain(
      "sh.is_compact_summary IS NOT TRUE AND sh.compact_summary_role = 'resume_context'"
    )
    expect(query.sql).toContain(
      "sh.is_compact_summary IS NOT TRUE AND sh.compact_summary_role = 'verify'"
    )
    expect(query.sql).toContain('AS agent_empty_completion_failures')
    expect(query.sql).toContain('AS agent_score_reasons_top')
    expect(query.sql).toContain('AS agent_ignored_path_tracking_policy_score')
    expect(query.sql).toContain('AS agent_baseline_deflection_attempted_score')
    expect(query.sql).toContain(
      'AS agent_sleep_wellness_interruption_incident_score'
    )
    expect(query.sql).toContain(
      'SUM(sh.trace_quality_score) FILTER (WHERE sh.trace_quality_score IS NOT NULL)'
    )
    expect(query.sql).not.toContain(
      'COALESCE(sh.discovery_inventory_coverage_score, 0)'
    )
    expect(query.sql).not.toContain('/compact')
    expect(query.sql).toContain("jsonb_typeof(reason_value.value) = 'string'")
    expect(query.sql).toContain("jsonb_typeof(reason_value.value) = 'object'")
    expect(query.sql).toContain("reason_value.value ->> 'evidence_mode'")
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
    expect(query.sql).toContain('jsonb_each(')
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

  test('test_buildUsageQuery_applies_global_reportable_session_history_filter', () => {
    const query = buildUsageQuery(
      new URLSearchParams({
        from: '2026-05-01',
        to: '2026-05-08',
        grain: 'day',
        group_by: 'provider,model,repository',
        limit: '50000',
      })
    )

    expectReportableSessionHistoryFilter(query.sql)
    expect(query.sql).toContain(
      "lower(COALESCE(sh.client_name, '')) = 'grok-build'"
    )
    expect(query.sql).toContain(
      "COALESCE(NULLIF(sh.model, ''), 'unknown') = 'unknown'"
    )
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
    expect(query.sql).toContain(
      "application_name IN (\n      'dashboard-shell-report-service'"
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

  test('test_buildQuotaQuery_stays_on_rate_limit_tables_and_wtus_lanes', () => {
    const query = buildQuotaQuery()

    expect(query.values).toEqual([])
    expect(query.sql).toContain(
      "ri.quota_type IN ('weekly', 'short', 'weekly_special', " +
        "'short_special', 'requests', 'monthly', 'wtus')"
    )
    expect(query.sql).toContain(
      "MAX(s.remaining_pct) FILTER (WHERE s.quota_type = 'wtus')"
    )
    expect(query.sql).toContain('THEN ri.quota_key')
    expect(query.sql).toContain("'[]'::jsonb AS usage_breakdown")
    expect(query.sql).not.toContain('FROM public.session_history')
    expect(query.sql).not.toContain('COALESCE(sh.start_time, sh.created_at)')
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
      buildQuotaRangeHistoryQuery(params),
      buildQuotaEstimatorDatasetQuery(params, 5),
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

    expect(query.values).toEqual(['2026-05-01', '2026-05-08'])
    expect(query.sql).toContain('WITH filtered_sessions AS MATERIALIZED')
    expect(query.sql).toContain('tool_rows AS MATERIALIZED')
    expect(query.sql).toContain('FROM public.session_history sh')
    expect(query.sql).toContain('JOIN public.session_history_tool_activity a')
    expect(query.sql).toContain('FROM tool_rows')
    expect(query.sql).not.toContain(
      'FROM public.session_history_tool_activity a\n    JOIN public.session_history sh'
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
    expect(query.sql).not.toContain(
      "ri.expected_reset_at < ($2::date::timestamp AT TIME ZONE 'America/New_York')"
    )
    expect(query.sql).toContain('wb.expected_reset_at AS interval_end')
    expect(query.sql).toContain('0::double precision AS velocity_sample_count')
    expect(query.sql).toContain("'[]'::jsonb AS velocity_segments")
    expect(query.sql).toContain("'[]'::jsonb AS velocity_scores")
  })

  test('test_buildQuotaEstimatorDatasetQuery_preserves_training_shapes_and_cache_categories', () => {
    const query = buildQuotaEstimatorDatasetQuery(
      new URLSearchParams({ from: '2026-05-01', to: '2026-05-08' }),
      5
    )

    expect(query.values).toEqual(['2026-05-01', '2026-05-08'])
    expect(query.metadata).toEqual({
      from: '2026-05-01',
      to: '2026-05-08',
      lagMinutes: 5,
    })
    expect(query.sql).toContain('WITH reset_windows AS')
    expect(query.sql).toContain('public.rate_limit_observations')
    expect(query.sql).toContain('public.rate_limit_intervals')
    expect(query.sql).toContain('quota_pct_interval AS')
    expect(query.sql).toContain('llm_usage_event AS')
    expect(query.sql).toContain(
      'COALESCE(sh.end_time, sh.start_time, sh.created_at)'
    )
    expect(query.sql).toContain("INTERVAL '5 minutes'")
    expect(query.sql).toContain(
      'COALESCE(sh.input_tokens, 0)::double precision AS uncached_input_tokens'
    )
    expect(query.sql).toContain(
      'COALESCE(sh.cache_read_input_tokens, 0)::double precision AS cache_read_tokens'
    )
    expect(query.sql).toContain(
      'COALESCE(sh.cache_creation_input_tokens, 0)::double precision AS cache_create_tokens'
    )
    expect(query.sql).toContain(
      "WHEN o.provider = 'anthropic' AND o.quota_key = 'anthropic_unified_7d_sonnet:7d_sonnet' THEN 'special'"
    )
    expect(query.sql).toContain(
      "WHEN o.provider = 'openai' AND o.quota_key = 'codex_bengalfox:secondary' THEN 'special'"
    )
    expect(query.sql).toContain('capped_at_100')
    expect(query.sql).not.toContain('unknown_window')
  })

  test('test_buildQuotaEstimatorReport_keeps_cache_read_as_lower_separate_feature', () => {
    const rows = []
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
      (coefficient) =>
        coefficient.estimate_kind === 'rolling_exponential' &&
        coefficient.feature === 'sonnet:workload'
    )
    const rollingSonnetCacheRead = estimate.coefficients.find(
      (coefficient) =>
        coefficient.estimate_kind === 'rolling_exponential' &&
        coefficient.feature === 'sonnet:cache_read'
    )
    const sonnetRatio = estimate.cache_read_ratios.find(
      (ratio) => ratio.model_family === 'sonnet'
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
    expect(query.sql).not.toContain('release')
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
      proxy
    )

    expect(target.pathname).toBe('/suites/symbols')
    expect(target.searchParams.get('limit')).toBe('50')
    expect(target.searchParams.get('lane')).toBe('type_shape')
  })
})
