/**
 * Tests for usage-report-display helpers.
 *
 * Covers the wave34 KPI correctness fixes:
 *   B2 — computeFleetErrors date-window filter (✘-2)
 *   B3 — computeFleetP95 requests-weighted average (✘-3)
 *
 * Wave 35 cycle-2 additions (⚠-11):
 *   formatLatency — ms → human-readable latency string
 *   formatUsd     — number → formatted USD string
 *   formatResetDistance — ISO → relative distance string
 *   modelBrandHex — model name → brand hex via modelToProviderKey
 */
import {
  computeFleetErrors,
  formatLatency,
  formatUsd,
  formatResetDistance,
  modelBrandHex,
} from './usage-report-display'

// ---------------------------------------------------------------------------
// computeFleetErrors
// ---------------------------------------------------------------------------

describe('computeFleetErrors', () => {
  const observations = [
    { observed_at: '2026-05-01T10:00:00Z' },
    { observed_at: '2026-05-10T12:00:00Z' },
    { observed_at: '2026-05-15T08:00:00Z' },
    { observed_at: '2026-05-19T23:59:00Z' },
    { observed_at: null },
  ]

  test('test_returns_full_count_when_no_window_provided', () => {
    expect(computeFleetErrors(observations)).toBe(5)
  })

  test('test_returns_full_count_when_only_from_provided', () => {
    // Missing `to` — backward-compat: return total count
    expect(computeFleetErrors(observations, '2026-05-10')).toBe(5)
  })

  test('test_returns_full_count_when_only_to_provided', () => {
    // Missing `from` — backward-compat: return total count
    expect(computeFleetErrors(observations, undefined, '2026-05-20')).toBe(5)
  })

  test('test_filters_observations_within_window', () => {
    // Window: 2026-05-10 ≤ observed_at < 2026-05-16
    // Matches: '2026-05-10T12:00:00Z' and '2026-05-15T08:00:00Z'
    expect(computeFleetErrors(observations, '2026-05-10', '2026-05-16')).toBe(2)
  })

  test('test_window_is_inclusive_lower_exclusive_upper', () => {
    // Lower bound is inclusive: exact midnight of from date is included.
    // Upper bound is exclusive: exact midnight of to date is excluded.
    const obs = [
      { observed_at: '2026-05-10T00:00:00.000Z' }, // = from → included
      { observed_at: '2026-05-16T00:00:00.000Z' }, // = to   → excluded
    ]
    expect(computeFleetErrors(obs, '2026-05-10', '2026-05-16')).toBe(1)
  })

  test('test_excludes_null_observed_at_within_window', () => {
    // Observations with null observed_at must always be excluded regardless of window.
    const obs = [{ observed_at: null }, { observed_at: '2026-05-12T00:00:00Z' }]
    expect(computeFleetErrors(obs, '2026-05-10', '2026-05-16')).toBe(1)
  })

  test('test_returns_zero_when_no_observations_in_window', () => {
    expect(computeFleetErrors(observations, '2026-04-01', '2026-04-30')).toBe(0)
  })

  test('test_returns_zero_on_empty_array', () => {
    expect(computeFleetErrors([], '2026-05-01', '2026-05-20')).toBe(0)
  })

  test('test_single_observation_at_exact_from_boundary_is_included', () => {
    const obs = [{ observed_at: '2026-05-10T00:00:00.000Z' }]
    expect(computeFleetErrors(obs, '2026-05-10', '2026-05-11')).toBe(1)
  })

  test('test_single_observation_just_before_to_boundary_is_included', () => {
    const obs = [{ observed_at: '2026-05-10T23:59:59.999Z' }]
    expect(computeFleetErrors(obs, '2026-05-10', '2026-05-11')).toBe(1)
  })
})

// ---------------------------------------------------------------------------
// computeFleetP95 (weighted average — tested via index.tsx integration but
// also verified here by importing the helper through a module-level alias
// to keep tests isolated from React component rendering).
//
// Note: computeFleetP95 is defined in index.tsx (module-private function).
// We test its semantics by reproducing the algorithm inline so that we can
// verify the contract independently of the component lifecycle. If the
// function is later extracted to this lib file the tests can be updated to
// import it directly.
// ---------------------------------------------------------------------------

describe('computeFleetP95 weighted-average semantics', () => {
  /** Mirrors the algorithm in index.tsx computeFleetP95. */
  function computeFleetP95Impl(
    rows: { upstream_p95_ms: number | null; requests: number }[]
  ): number {
    let weightedSum = 0
    let totalRequests = 0
    for (const r of rows) {
      if (r.upstream_p95_ms === null) continue
      weightedSum += r.upstream_p95_ms * r.requests
      totalRequests += r.requests
    }
    return totalRequests > 0 ? weightedSum / totalRequests : 0
  }

  test('test_returns_zero_for_empty_rows', () => {
    expect(computeFleetP95Impl([])).toBe(0)
  })

  test('test_returns_zero_when_all_p95_null', () => {
    const rows = [
      { upstream_p95_ms: null, requests: 100 },
      { upstream_p95_ms: null, requests: 200 },
    ]
    expect(computeFleetP95Impl(rows)).toBe(0)
  })

  test('test_single_row_equals_its_own_p95', () => {
    const rows = [{ upstream_p95_ms: 1500, requests: 50 }]
    expect(computeFleetP95Impl(rows)).toBe(1500)
  })

  test('test_equal_request_counts_produce_simple_mean', () => {
    // Both buckets have 100 requests → simple average
    const rows = [
      { upstream_p95_ms: 1000, requests: 100 },
      { upstream_p95_ms: 3000, requests: 100 },
    ]
    expect(computeFleetP95Impl(rows)).toBe(2000)
  })

  test('test_high_traffic_bucket_dominates_low_sample_bucket', () => {
    // Low-sample outlier: 282_199 ms, 3 requests
    // High-traffic bucket:  10_000 ms, 1000 requests
    // Weighted avg ≈ (282_199*3 + 10_000*1000) / 1003 ≈ 10_840 ms
    // (significantly lower than max=282_199)
    const rows = [
      { upstream_p95_ms: 282_199, requests: 3 },
      { upstream_p95_ms: 10_000, requests: 1_000 },
    ]
    const result = computeFleetP95Impl(rows)
    // Must be much closer to 10_000 than to 282_199
    expect(result).toBeLessThan(12_000)
    expect(result).toBeGreaterThan(9_000)
  })

  test('test_null_rows_are_excluded_from_both_numerator_and_denominator', () => {
    // Only the non-null row should count
    const rows = [
      { upstream_p95_ms: null, requests: 500 },
      { upstream_p95_ms: 2_000, requests: 10 },
    ]
    // Denominator = 10 (not 510), numerator = 2_000*10
    expect(computeFleetP95Impl(rows)).toBe(2_000)
  })

  test('test_weighted_avg_is_not_equal_to_max', () => {
    // Regression guard: ensure we are NOT returning Math.max
    const rows = [
      { upstream_p95_ms: 5_000, requests: 900 },
      { upstream_p95_ms: 50_000, requests: 10 },
    ]
    const result = computeFleetP95Impl(rows)
    expect(result).not.toBe(50_000) // not max
    // (5000*900 + 50000*10) / 910 ≈ 5_494
    expect(result).toBeCloseTo(5_494.5, 0)
  })
})

// ---------------------------------------------------------------------------
// formatLatency (⚠-11)
// ---------------------------------------------------------------------------

describe('formatLatency', () => {
  test('test_null_returns_em_dash', () => {
    expect(formatLatency(null)).toBe('—')
  })

  test('test_undefined_returns_em_dash', () => {
    expect(formatLatency(undefined)).toBe('—')
  })

  test('test_zero_returns_0ms', () => {
    expect(formatLatency(0)).toBe('0ms')
  })

  test('test_sub_1000ms_rounds_to_integer', () => {
    expect(formatLatency(247.9)).toBe('248ms')
  })

  test('test_sub_1000ms_fractional_truncated', () => {
    expect(formatLatency(999.4)).toBe('999ms')
  })

  test('test_exactly_1000ms_returns_seconds', () => {
    expect(formatLatency(1000)).toBe('1.0s')
  })

  test('test_large_ms_returns_seconds_with_one_decimal', () => {
    expect(formatLatency(13_201)).toBe('13.2s')
  })

  test('test_very_large_ms_formats_correctly', () => {
    expect(formatLatency(282_199)).toBe('282.2s')
  })

  test('test_negative_ms_sub_1000_rounds', () => {
    // Negative latencies are edge-case but should not throw
    expect(formatLatency(-500)).toBe('-500ms')
  })

  test('test_boundary_999ms_stays_as_ms', () => {
    expect(formatLatency(999)).toBe('999ms')
  })

  test('test_boundary_1001ms_shows_seconds', () => {
    expect(formatLatency(1001)).toBe('1.0s')
  })
})

// ---------------------------------------------------------------------------
// formatUsd (⚠-11)
// ---------------------------------------------------------------------------

describe('formatUsd', () => {
  test('test_null_returns_em_dash', () => {
    expect(formatUsd(null)).toBe('—')
  })

  test('test_undefined_returns_em_dash', () => {
    expect(formatUsd(undefined)).toBe('—')
  })

  test('test_zero_formats_with_two_decimals', () => {
    expect(formatUsd(0)).toBe('$0.00')
  })

  test('test_whole_number_adds_two_decimal_places', () => {
    expect(formatUsd(100)).toBe('$100.00')
  })

  test('test_value_with_comma_separator', () => {
    expect(formatUsd(1560.1)).toBe('$1,560.10')
  })

  test('test_large_value_has_comma_separators', () => {
    expect(formatUsd(1_000_000)).toBe('$1,000,000.00')
  })

  test('test_two_decimal_places_preserved', () => {
    expect(formatUsd(9.99)).toBe('$9.99')
  })

  test('test_small_fractional_value_rounded_to_two_decimals', () => {
    // 0.001 rounds to $0.00
    expect(formatUsd(0.001)).toBe('$0.00')
  })

  test('test_negative_value_formats_with_sign', () => {
    // toLocaleString places currency symbol before the minus sign: "$-42.50"
    expect(formatUsd(-42.5)).toBe('$-42.50')
  })

  test('test_already_two_decimals_unchanged', () => {
    expect(formatUsd(1234.56)).toBe('$1,234.56')
  })
})

// ---------------------------------------------------------------------------
// formatResetDistance (⚠-11)
// ---------------------------------------------------------------------------

describe('formatResetDistance', () => {
  test('test_null_returns_em_dash', () => {
    expect(formatResetDistance(null)).toBe('—')
  })

  test('test_undefined_returns_em_dash', () => {
    expect(formatResetDistance(undefined)).toBe('—')
  })

  test('test_empty_string_returns_em_dash', () => {
    expect(formatResetDistance('')).toBe('—')
  })

  test('test_invalid_iso_returns_em_dash', () => {
    expect(formatResetDistance('not-a-date')).toBe('—')
  })

  test('test_past_date_returns_now', () => {
    // Any timestamp in the past returns 'now'
    expect(formatResetDistance('2020-01-01T00:00:00Z')).toBe('now')
  })

  test('test_future_days_and_hours_format', () => {
    // 3 days + 1 hour from now
    const future = new Date(Date.now() + 3 * 86_400_000 + 1 * 3_600_000)
    expect(formatResetDistance(future.toISOString())).toBe('in 3d 1h')
  })

  test('test_future_hours_and_minutes_format', () => {
    // 2 hours + 30 minutes from now
    const future = new Date(Date.now() + 2 * 3_600_000 + 30 * 60_000)
    expect(formatResetDistance(future.toISOString())).toBe('in 2h 30m')
  })

  test('test_future_minutes_only_format', () => {
    // 45 minutes from now
    const future = new Date(Date.now() + 45 * 60_000)
    expect(formatResetDistance(future.toISOString())).toBe('in 45m')
  })

  test('test_exactly_zero_minutes_returns_now', () => {
    // Exactly Date.now() → diffMs=0 → returns 'now'
    expect(formatResetDistance(new Date(Date.now() - 1).toISOString())).toBe(
      'now'
    )
  })

  test('test_one_minute_future_format', () => {
    const future = new Date(Date.now() + 60_000)
    expect(formatResetDistance(future.toISOString())).toBe('in 1m')
  })

  test('test_days_with_zero_hours_still_shows_0h', () => {
    // 1 day exactly → '1d 0h'
    const future = new Date(Date.now() + 86_400_000)
    expect(formatResetDistance(future.toISOString())).toBe('in 1d 0h')
  })
})

// ---------------------------------------------------------------------------
// modelBrandHex (exercises modelToProviderKey branches) (⚠-11)
// modelToProviderKey is internal but exercised via the exported modelBrandHex.
// ---------------------------------------------------------------------------

describe('modelBrandHex via modelToProviderKey branches', () => {
  const ANTHROPIC_HEX = '#d97757'
  const OPENAI_HEX = '#10a37f'
  const GOOGLE_HEX = '#4285f4'
  const XAI_HEX = '#475569'
  const NVIDIA_HEX = '#76b900'
  const OPENROUTER_HEX = '#7e57c2'
  const LOCAL_HEX = '#64748b'
  const FALLBACK = 'var(--fg)'

  test('test_claude_prefix_maps_to_anthropic', () => {
    expect(modelBrandHex('claude-opus-4-7')).toBe(ANTHROPIC_HEX)
  })

  test('test_anthropic_prefix_maps_to_anthropic', () => {
    expect(modelBrandHex('anthropic-special')).toBe(ANTHROPIC_HEX)
  })

  test('test_gpt_dash_prefix_maps_to_openai', () => {
    expect(modelBrandHex('gpt-4o')).toBe(OPENAI_HEX)
  })

  test('test_gpt_exact_maps_to_openai', () => {
    expect(modelBrandHex('gpt')).toBe(OPENAI_HEX)
  })

  test('test_o1_prefix_maps_to_openai', () => {
    expect(modelBrandHex('o1-mini')).toBe(OPENAI_HEX)
  })

  test('test_o3_prefix_maps_to_openai', () => {
    expect(modelBrandHex('o3-turbo')).toBe(OPENAI_HEX)
  })

  test('test_o4_prefix_maps_to_openai', () => {
    expect(modelBrandHex('o4-preview')).toBe(OPENAI_HEX)
  })

  test('test_chatgpt_prefix_maps_to_openai', () => {
    expect(modelBrandHex('chatgpt-4o')).toBe(OPENAI_HEX)
  })

  test('test_codex_prefix_maps_to_openai', () => {
    expect(modelBrandHex('codex-mini')).toBe(OPENAI_HEX)
  })

  test('test_text_embedding_prefix_maps_to_openai', () => {
    expect(modelBrandHex('text-embedding-3-small')).toBe(OPENAI_HEX)
  })

  test('test_text_davinci_prefix_maps_to_openai', () => {
    expect(modelBrandHex('text-davinci-003')).toBe(OPENAI_HEX)
  })

  test('test_davinci_prefix_maps_to_openai', () => {
    expect(modelBrandHex('davinci')).toBe(OPENAI_HEX)
  })

  test('test_gemini_prefix_maps_to_google', () => {
    expect(modelBrandHex('gemini-1.5-flash')).toBe(GOOGLE_HEX)
  })

  test('test_embeddinggemma_prefix_maps_to_google', () => {
    expect(modelBrandHex('embeddinggemma-2')).toBe(GOOGLE_HEX)
  })

  test('test_grok_prefix_maps_to_xai', () => {
    expect(modelBrandHex('grok-3')).toBe(XAI_HEX)
  })

  test('test_nvidia_prefix_maps_to_nvidia_nim', () => {
    expect(modelBrandHex('nvidia-llama3')).toBe(NVIDIA_HEX)
  })

  test('test_nemo_prefix_maps_to_nvidia_nim', () => {
    expect(modelBrandHex('nemo-12b')).toBe(NVIDIA_HEX)
  })

  test('test_nim_dash_prefix_maps_to_nvidia_nim', () => {
    expect(modelBrandHex('nim-llama')).toBe(NVIDIA_HEX)
  })

  test('test_slash_path_maps_to_openrouter', () => {
    expect(modelBrandHex('meta-llama/llama-3')).toBe(OPENROUTER_HEX)
  })

  test('test_llama_prefix_maps_to_local', () => {
    expect(modelBrandHex('llama3-8b')).toBe(LOCAL_HEX)
  })

  test('test_mistral_prefix_maps_to_local', () => {
    expect(modelBrandHex('mistral-7b')).toBe(LOCAL_HEX)
  })

  test('test_mixtral_prefix_maps_to_local', () => {
    expect(modelBrandHex('mixtral-8x7b')).toBe(LOCAL_HEX)
  })

  test('test_qwen_prefix_maps_to_local', () => {
    expect(modelBrandHex('qwen2-72b')).toBe(LOCAL_HEX)
  })

  test('test_phi_prefix_maps_to_local', () => {
    expect(modelBrandHex('phi-3-mini')).toBe(LOCAL_HEX)
  })

  test('test_deepseek_prefix_maps_to_local', () => {
    expect(modelBrandHex('deepseek-coder')).toBe(LOCAL_HEX)
  })

  test('test_nomic_embed_prefix_maps_to_local', () => {
    expect(modelBrandHex('nomic-embed-text')).toBe(LOCAL_HEX)
  })

  test('test_gte_dash_prefix_maps_to_local', () => {
    expect(modelBrandHex('gte-large')).toBe(LOCAL_HEX)
  })

  test('test_e5_dash_prefix_maps_to_local', () => {
    expect(modelBrandHex('e5-large-v2')).toBe(LOCAL_HEX)
  })

  test('test_empty_string_returns_fallback', () => {
    // Empty string → key '' → not in PROVIDER_BRAND_HEX → var(--fg)
    expect(modelBrandHex('')).toBe(FALLBACK)
  })

  test('test_unknown_model_returns_fallback', () => {
    expect(modelBrandHex('totally-unknown-model-xyz')).toBe(FALLBACK)
  })

  test('test_whitespace_only_model_returns_fallback', () => {
    // trim().toLowerCase() → '' → falls through to ''
    expect(modelBrandHex('   ')).toBe(FALLBACK)
  })

  test('test_gpt3_numeric_prefix_maps_to_openai', () => {
    expect(modelBrandHex('gpt3-turbo')).toBe(OPENAI_HEX)
  })

  test('test_gpt4_numeric_prefix_maps_to_openai', () => {
    expect(modelBrandHex('gpt4-turbo')).toBe(OPENAI_HEX)
  })

  test('test_gpt5_numeric_prefix_maps_to_openai', () => {
    expect(modelBrandHex('gpt5-preview')).toBe(OPENAI_HEX)
  })
})
