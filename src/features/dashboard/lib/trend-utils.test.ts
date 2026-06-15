import {
  buildTokenTrendDayEnvelopes,
  classifyTokenTrendActiveVersionFamily,
  deriveTokenTrendActiveVersionLanes,
  deriveTokenTrendModelFirstSeenGroups,
  formatBucketLabel,
  normalizeTrendData,
  normalizeTokenTrendClientVersionForLane,
  // parseTrendDayHour is currently module-private; engineer must export it.
  // The import is commented out until the export is added; the test body uses
  // a dynamic import so it fails at runtime rather than at parse time.
} from './trend-utils'

test('test_buildTokenTrendDayEnvelopes_groups_hours_by_day_and_provider', () => {
  const envelopes = buildTokenTrendDayEnvelopes([
    {
      day: '2026-05-20',
      hour: 8,
      provider: 'x.ai',
      traces: 1,
      token_total: 100,
      usd_cost: 0,
    },
    {
      day: '2026-05-20',
      hour: 8,
      provider: 'xai',
      traces: 1,
      token_total: 50,
      usd_cost: 0,
    },
    {
      day: '2026-05-21',
      hour: 9,
      provider: 'gemini',
      traces: 1,
      token_total: 25,
      usd_cost: 0,
    },
  ])

  expect(envelopes).toHaveLength(2)
  expect(envelopes[0]?.hours).toHaveLength(24)
  expect(envelopes[0]?.hours[8]?.totals.xai).toBe(150)
  expect(envelopes[0]?.total).toBe(150)
  expect(envelopes[1]?.hours[9]?.totals.google).toBe(25)
})

test('test_buildTokenTrendDayEnvelopes_supports_request_and_tool_metrics', () => {
  const rows = [
    {
      day: '2026-05-20',
      hour: 8,
      provider: 'openai',
      traces: 5,
      token_total: 1000,
      usd_cost: 0,
      tool_calls: 12,
    },
    {
      day: '2026-05-20',
      hour: 9,
      provider: 'openai',
      traces: 2,
      token_total: 250,
      usd_cost: 0,
      tool_calls: 3,
    },
  ]

  const requestEnvelopes = buildTokenTrendDayEnvelopes(rows, 'requests')
  const toolEnvelopes = buildTokenTrendDayEnvelopes(rows, 'tools')

  expect(requestEnvelopes[0]?.total).toBe(7)
  expect(requestEnvelopes[0]?.hours[8]?.totals.openai).toBe(5)
  expect(toolEnvelopes[0]?.total).toBe(15)
  expect(toolEnvelopes[0]?.hours[9]?.totals.openai).toBe(3)
})

test('test_classifyTokenTrendActiveVersionFamily_normalizes_client_and_provider_families', () => {
  expect(
    classifyTokenTrendActiveVersionFamily({
      provider: 'anthropic',
      client_name: 'claude-code',
      client_version: '2.0.0',
    })
  ).toBe('claude')
  expect(
    classifyTokenTrendActiveVersionFamily({
      provider: 'openai',
      client_name: 'codex-tui',
      client_version: '0.120.0',
    })
  ).toBe('codex')
  expect(
    classifyTokenTrendActiveVersionFamily({
      provider: 'openai',
      client_name: 'codex dev smoke 2026-05-24',
      client_version: '2026.05.24',
    })
  ).toBeNull()
  expect(
    classifyTokenTrendActiveVersionFamily({
      provider: 'openai',
      client_name: 'dev-smoke',
      client_version: 'codex-dev-smoke-2026',
    })
  ).toBeNull()
  expect(
    classifyTokenTrendActiveVersionFamily({
      provider: 'gemini',
      client_name: 'unknown-client',
      client_version: '1.0.0',
    })
  ).toBeNull()
  expect(
    classifyTokenTrendActiveVersionFamily({
      provider: 'x.ai',
      client_name: 'some-router',
      client_version: '1.0.0',
    })
  ).toBeNull()
  expect(
    classifyTokenTrendActiveVersionFamily({
      provider: 'x.ai',
      client_name: 'grok-build',
      client_version: '1.0.0',
    })
  ).toBe('grok')
  expect(
    classifyTokenTrendActiveVersionFamily({
      provider: 'google',
      client_name: 'python-httpx',
      client_version: '0.28.1',
    })
  ).toBeNull()
  expect(
    classifyTokenTrendActiveVersionFamily({
      provider: 'xai',
      client_name: 'curl',
      client_version: '8.5.0',
    })
  ).toBeNull()
  expect(
    classifyTokenTrendActiveVersionFamily({
      provider: 'openrouter',
      client_name: 'unknown-client',
      client_version: '1.0.0',
    })
  ).toBeNull()
})

test('test_normalizeTokenTrendClientVersionForLane_collapses_hash_suffixed_builds', () => {
  expect(normalizeTokenTrendClientVersionForLane('2.1.118.ab0')).toBe('2.1.118')
  expect(normalizeTokenTrendClientVersionForLane('2.1.118.8f1')).toBe('2.1.118')
  expect(normalizeTokenTrendClientVersionForLane('0.130.0')).toBe('0.130.0')
  expect(normalizeTokenTrendClientVersionForLane('0.0.0')).toBe('0.0.0')
  expect(normalizeTokenTrendClientVersionForLane('dev')).toBe('dev')
})

test('test_deriveTokenTrendActiveVersionLanes_aggregates_hash_suffixed_builds', () => {
  const envelopes = buildTokenTrendDayEnvelopes([
    {
      day: '2026-05-20',
      hour: 1,
      provider: 'anthropic',
      traces: 1,
      token_total: 100,
      usd_cost: 0,
    },
    {
      day: '2026-05-20',
      hour: 4,
      provider: 'anthropic',
      traces: 1,
      token_total: 100,
      usd_cost: 0,
    },
  ])

  const lanes = deriveTokenTrendActiveVersionLanes(envelopes, [
    {
      provider: 'anthropic',
      client_name: 'claude-code',
      client_version: '2.1.118.ab0',
      first_seen_at: '2026-05-20T05:00:00.000Z',
      last_seen_at: '2026-05-20T06:00:00.000Z',
      first_seen_day: '2026-05-20',
      first_seen_hour: 1,
      last_seen_day: '2026-05-20',
      last_seen_hour: 2,
      traces: 1,
      token_total: 100,
      usd_cost: 0,
    },
    {
      provider: 'openai',
      client_name: 'claude-cli',
      client_version: '2.1.118.8f1',
      first_seen_at: '2026-05-20T07:00:00.000Z',
      last_seen_at: '2026-05-20T09:00:00.000Z',
      first_seen_day: '2026-05-20',
      first_seen_hour: 3,
      last_seen_day: '2026-05-20',
      last_seen_hour: 4,
      traces: 2,
      token_total: 200,
      usd_cost: 0,
    },
  ])

  const claudeLane = lanes.find((lane) => lane.key === 'claude')
  expect(claudeLane?.segments).toHaveLength(1)
  expect(claudeLane?.rowCount).toBe(1)
  expect(claudeLane?.segments[0]?.clientVersion).toBe('2.1.118')
  expect(claudeLane?.segments[0]?.startGlobalHour).toBe(1)
  expect(claudeLane?.segments[0]?.endGlobalHour).toBe(4)
  expect(claudeLane?.segments[0]?.tokenTotal).toBe(300)
  expect(claudeLane?.segments[0]?.provider).toBe('openai')
  expect(claudeLane?.segments[0]?.providers).toEqual(['openai', 'anthropic'])
  expect(claudeLane?.segments[0]?.clientNames).toEqual([
    'claude-cli',
    'claude-code',
  ])
})

test('test_deriveTokenTrendActiveVersionLanes_filters_families_and_packs_concurrent_versions', () => {
  const envelopes = buildTokenTrendDayEnvelopes([
    {
      day: '2026-05-20',
      hour: 1,
      provider: 'anthropic',
      traces: 1,
      token_total: 100,
      usd_cost: 0,
    },
    {
      day: '2026-05-20',
      hour: 3,
      provider: 'anthropic',
      traces: 1,
      token_total: 100,
      usd_cost: 0,
    },
    {
      day: '2026-05-21',
      hour: 8,
      provider: 'x.ai',
      traces: 1,
      token_total: 50,
      usd_cost: 0,
    },
  ])

  const lanes = deriveTokenTrendActiveVersionLanes(envelopes, [
    {
      provider: 'anthropic',
      client_name: 'claude-code',
      client_version: '2.0.0',
      first_seen_at: '2026-05-20T05:00:00.000Z',
      last_seen_at: '2026-05-20T09:00:00.000Z',
      first_seen_day: '2026-05-20',
      first_seen_hour: 1,
      last_seen_day: '2026-05-20',
      last_seen_hour: 4,
      traces: 4,
      token_total: 400,
      usd_cost: 0,
    },
    {
      provider: 'anthropic',
      client_name: 'claude-cli',
      client_version: '2.1.0',
      first_seen_at: '2026-05-20T07:00:00.000Z',
      last_seen_at: '2026-05-20T10:00:00.000Z',
      first_seen_day: '2026-05-20',
      first_seen_hour: 3,
      last_seen_day: '2026-05-20',
      last_seen_hour: 5,
      traces: 2,
      token_total: 200,
      usd_cost: 0,
    },
    {
      provider: 'openai',
      client_name: 'codex-tui',
      client_version: '0.120.0',
      first_seen_at: '2026-05-20T13:00:00.000Z',
      last_seen_at: '2026-05-20T14:00:00.000Z',
      first_seen_day: '2026-05-20',
      first_seen_hour: 9,
      last_seen_day: '2026-05-20',
      last_seen_hour: 10,
      traces: 1,
      token_total: 100,
      usd_cost: 0,
    },
    {
      provider: 'x.ai',
      client_name: 'grok-build',
      client_version: '0.0.0',
      first_seen_at: '2026-05-21T12:00:00.000Z',
      last_seen_at: '2026-05-21T13:00:00.000Z',
      first_seen_day: '2026-05-21',
      first_seen_hour: 8,
      last_seen_day: '2026-05-21',
      last_seen_hour: 9,
      traces: 1,
      token_total: 50,
      usd_cost: 0,
    },
    {
      provider: 'openrouter',
      client_name: 'router-client',
      client_version: '1.0.0',
      first_seen_at: '2026-05-21T12:00:00.000Z',
      last_seen_at: '2026-05-21T13:00:00.000Z',
      first_seen_day: '2026-05-21',
      first_seen_hour: 8,
      last_seen_day: '2026-05-21',
      last_seen_hour: 9,
      traces: 1,
      token_total: 50,
      usd_cost: 0,
    },
  ])

  const claudeLane = lanes.find((lane) => lane.key === 'claude')
  const codexLane = lanes.find((lane) => lane.key === 'codex')
  const grokLane = lanes.find((lane) => lane.key === 'grok')
  const geminiLane = lanes.find((lane) => lane.key === 'gemini')

  expect(claudeLane?.segments).toHaveLength(2)
  expect(claudeLane?.rowCount).toBe(2)
  expect(
    claudeLane?.segments.map((segment) => segment.rowIndex).sort()
  ).toEqual([0, 1])
  expect(codexLane?.segments).toHaveLength(1)
  expect(grokLane?.segments).toHaveLength(1)
  expect(grokLane?.segments[0]?.clientVersion).toBe('0.0.0')
  expect(geminiLane?.segments).toHaveLength(0)
  expect(lanes.flatMap((lane) => lane.segments)).toHaveLength(4)
})

test('test_deriveTokenTrendModelFirstSeenGroups_maps_supported_provider_models_to_hour_columns', () => {
  const envelopes = buildTokenTrendDayEnvelopes([
    {
      day: '2026-05-20',
      hour: 8,
      provider: 'anthropic',
      traces: 1,
      token_total: 100,
      usd_cost: 0,
    },
    {
      day: '2026-05-21',
      hour: 9,
      provider: 'x.ai',
      traces: 1,
      token_total: 100,
      usd_cost: 0,
    },
  ])

  const groups = deriveTokenTrendModelFirstSeenGroups(envelopes, [
    {
      provider: 'anthropic',
      model: 'claude-sonnet-4-6',
      first_seen_at: '2026-05-20T12:00:00.000Z',
      first_seen_day: '2026-05-20',
      first_seen_hour: 8,
      observations: 2,
      token_total: 250,
    },
    {
      provider: 'openai',
      model: 'gpt-5.5',
      first_seen_at: '2026-05-20T12:10:00.000Z',
      first_seen_day: '2026-05-20',
      first_seen_hour: 8,
      observations: 1,
      token_total: 100,
    },
    {
      provider: 'x.ai',
      model: 'grok-5',
      first_seen_at: '2026-05-21T13:00:00.000Z',
      first_seen_day: '2026-05-21',
      first_seen_hour: 9,
      observations: 3,
      token_total: 300,
    },
    {
      provider: 'openrouter',
      model: 'router-model',
      first_seen_at: '2026-05-21T13:00:00.000Z',
      first_seen_day: '2026-05-21',
      first_seen_hour: 9,
      observations: 3,
      token_total: 300,
    },
  ])

  expect(groups).toHaveLength(2)
  expect(groups[0]?.globalHour).toBe(8)
  expect(groups[0]?.markers.map((marker) => marker.model)).toEqual([
    'claude-sonnet-4-6',
    'gpt-5.5',
  ])
  expect(groups[1]?.globalHour).toBe(33)
  expect(groups[1]?.markers[0]?.provider).toBe('xai')
})

// ---------------------------------------------------------------------------
// Wave 3 (adversarial-review-20260612) — FAILING tests, W3 engineer to fix
// ---------------------------------------------------------------------------

/**
 * S4-9 — `parseTrendDayHour` invalid-hour guard: value `99` must be rejected.
 *
 * The fast-path regex `[T\s](\d{2})` captures any two-digit sequence, including
 * hour `99`. This silently creates data that `buildTrendSignalRows` discards
 * (hours 24–99 are out of range) with no trace. The fix: validate hour ∈ [0,23].
 *
 * This test also pins the UTC/offset consistency fix (S3-3):
 * A timestamp `2026-06-12T23:30:00-04:00` must yield day AND hour from the
 * SAME clock — not day from the local prefix and hour from UTC.
 *
 * EXPORTS NEEDED from token-trend-chart.tsx:
 *   - `parseTrendDayHour(value: string | null | undefined): { day: string; hour: number | null } | null`
 *
 * These tests FAIL until the function is exported.
 */
test('test_parseTrendDayHour_offset_timestamp_day_hour_consistent', async () => {
  // parseTrendDayHour is module-private. The engineer must export it.
  // Dynamic import catches the missing export at runtime → test FAILS.
  const mod = await import('../components/token-trend-chart')
  const { parseTrendDayHour } = mod as unknown as {
    parseTrendDayHour: (
      v: string | null | undefined
    ) => { day: string; hour: number | null } | null
  }

  expect(parseTrendDayHour).toBeDefined()

  // Offset timestamp: 2026-06-12T23:30:00-04:00 is UTC 2026-06-13T03:30:00Z.
  // After fix: day AND hour must derive from the same clock.
  // Option A (UTC clock): day='2026-06-13', hour=3
  // Option B (offset-local clock): day='2026-06-12', hour=23
  // Either is correct as long as they're consistent. Today's fast-path takes
  // the local day (06-12) but can fall through to UTC hour (03) → mismatch.
  const result = parseTrendDayHour('2026-06-12T23:30:00-04:00')
  expect(result).not.toBeNull()
  if (result !== null) {
    // Both clock choices are acceptable — we just verify consistency:
    // local-date + local-hour OR utc-date + utc-hour; never mixed.
    const utcDay = '2026-06-13'
    const utcHour = 3
    const localDay = '2026-06-12'
    const localHour = 23
    const isUtcPair = result.day === utcDay && result.hour === utcHour
    const isLocalPair = result.day === localDay && result.hour === localHour
    expect(isUtcPair || isLocalPair).toBe(true)
  }
})

test('test_parseTrendDayHour_invalid_hour_rejected', async () => {
  const mod = await import('../components/token-trend-chart')
  const { parseTrendDayHour } = mod as unknown as {
    parseTrendDayHour: (
      v: string | null | undefined
    ) => { day: string; hour: number | null } | null
  }

  expect(parseTrendDayHour).toBeDefined()

  // Hour 99 must be rejected — currently the regex captures it and silent data drop occurs.
  // After fix: hour ∉ [0,23] → null or hour: null (no phantom envelope created).
  const badHourResult = parseTrendDayHour('2026-05-20 99:00:00')
  // Must not return hour: 99. Either null result or hour: null.
  if (badHourResult !== null) {
    expect(badHourResult.hour).not.toBe(99)
    expect(
      badHourResult.hour === null ||
        (badHourResult.hour >= 0 && badHourResult.hour <= 23)
    ).toBe(true)
  }
  // null result (full rejection) is also valid and preferred.
})

/**
 * S4-9 — `parseTrendDayHour` with hour 99: a health row with bucket_start
 * `"2026-05-20 99:00:00"` silently produces `hour: 99`, which then creates a
 * cell key `latency|2026-05-20|99` in `addSignalValue`. That key is never read
 * back by `buildTrendSignalRows` (only hours 0–23 are iterated) — data dropped
 * without trace. The fix must prevent `parseTrendDayHour` from producing hour=99.
 *
 * This test pins that `parseTrendDayHour` returns null or `hour: null` for
 * out-of-range hours, so no phantom signal cell is created.
 *
 * EXPORTS NEEDED from token-trend-chart.tsx:
 *   - `parseTrendDayHour(v: string | null | undefined): { day: string; hour: number | null } | null`
 *
 * Until the export is added, the dynamic import returns undefined → FAILS.
 *
 * Also verifies: NaN hour row in `buildTokenTrendDayEnvelopes` does not inflate
 * the total (the array[NaN]=undefined guard already works; this documents it).
 */
test('test_trend_utils_nan_hour_no_phantom_envelope', async () => {
  // Sub-test A: parseTrendDayHour must not return hour=99.
  // (If the export is absent, this test FAILS on the toBeDefined assertion.)
  const mod = await import('../components/token-trend-chart')
  const { parseTrendDayHour } = mod as unknown as {
    parseTrendDayHour: (
      v: string | null | undefined
    ) => { day: string; hour: number | null } | null
  }
  expect(parseTrendDayHour).toBeDefined()

  const result99 = parseTrendDayHour('2026-05-20 99:00:00')
  // After fix: null result (full rejection) or hour: null — never hour: 99.
  if (result99 !== null) {
    expect(result99.hour).not.toBe(99) // FAILS before fix
    expect(
      result99.hour === null ||
        (typeof result99.hour === 'number' &&
          result99.hour >= 0 &&
          result99.hour <= 23)
    ).toBe(true)
  }

  // Sub-test B: NaN hour row does not inflate the buildTokenTrendDayEnvelopes total.
  // (This guard already works via hours[NaN]=undefined — documented here for regression.)
  const rows = [
    {
      day: '2026-05-20',
      hour: NaN,
      provider: 'anthropic',
      traces: 5,
      token_total: 500,
      usd_cost: 0,
    },
    {
      day: '2026-05-20',
      hour: 8,
      provider: 'openai',
      traces: 2,
      token_total: 200,
      usd_cost: 0,
    },
  ]
  const envelopes = buildTokenTrendDayEnvelopes(rows)
  expect(envelopes).toHaveLength(1)
  expect(envelopes[0]!.total).toBe(200) // only the valid row
})

/**
 * S4-11 — `normalizeTokenTrendClientVersionForLane` collapses distinct numeric
 * build suffixes.
 *
 * The regex `/^(\d+\.\d+\.\d+)\.[0-9a-f]{3,}$/i` was intended to strip
 * git-hash suffixes (e.g. `2.1.0.abc123`). But it also matches all-numeric
 * fourth segments (`2.1.118.900`), collapsing distinct patch builds to the
 * same lane key and hiding version-churn data.
 *
 * After fix: the regex requires a non-digit character in the suffix so
 * `2.1.118.900` and `2.1.118.901` normalise to different keys.
 */
test('test_normalize_client_version_numeric_build_not_collapsed', () => {
  // These two builds must NOT collapse to the same key.
  const v1 = normalizeTokenTrendClientVersionForLane('2.1.118.900')
  const v2 = normalizeTokenTrendClientVersionForLane('2.1.118.901')

  // After fix: v1 ≠ v2 (distinct numeric build segments preserved).
  // Before fix: both collapse to '2.1.118' → v1 === v2.
  expect(v1).not.toBe(v2)

  // Hash suffixes must still be stripped.
  const withHash = normalizeTokenTrendClientVersionForLane('2.1.0.abc123f')
  expect(withHash).toBe('2.1.0')

  // A version without a hash suffix returns as-is.
  const plain = normalizeTokenTrendClientVersionForLane('2.1.118')
  expect(plain).toBe('2.1.118')
})

// ---------------------------------------------------------------------------
// Wave 10 (S4-T3): normalizeTrendData / formatBucketLabel coverage
// ---------------------------------------------------------------------------

/**
 * S4-T3 — normalizeTrendData always returns exactly 24 buckets.
 *
 * Pad case: <24 raw buckets → empty prefix buckets added with "Xh" labels.
 * Truncate case: >24 raw buckets → oldest trimmed; most recent 24 kept.
 */
test('test_normalizeTrendData_pads_to_24_buckets_when_fewer_rows', () => {
  // 3 rows → 3 unique buckets → should be padded to 24
  const rows = [
    {
      bucket: '2026-05-20',
      provider: 'anthropic',
      model: 'claude-sonnet',
      repository: '',
      traces: 1,
      token_total: 100,
      usd_cost: 0,
    },
    {
      bucket: '2026-05-21',
      provider: 'openai',
      model: 'gpt-4',
      repository: '',
      traces: 1,
      token_total: 200,
      usd_cost: 0,
    },
    {
      bucket: '2026-05-22',
      provider: 'anthropic',
      model: 'claude-haiku',
      repository: '',
      traces: 1,
      token_total: 50,
      usd_cost: 0,
    },
  ]

  const result = normalizeTrendData(rows)
  expect(result).toHaveLength(24)

  // Last 3 buckets are the real data (most recent at the end)
  expect(result[21]?.label).toBe('2026-05-20')
  expect(result[22]?.label).toBe('2026-05-21')
  expect(result[23]?.label).toBe('2026-05-22')
  // Padded prefix buckets should have empty totals
  expect(result[0]?.totals).toEqual({})
  expect(result[0]?.label).toMatch(/h$/) // e.g. "23h" relative label
})

test('test_normalizeTrendData_truncates_to_24_most_recent_when_more_rows', () => {
  // Generate 30 daily buckets (too many → oldest 6 should be trimmed)
  const rows = Array.from({ length: 30 }, (_, i) => {
    const day = new Date('2026-05-01')
    day.setDate(day.getDate() + i)
    return {
      bucket: day.toISOString().slice(0, 10),
      provider: 'anthropic',
      model: 'claude-sonnet',
      repository: '',
      traces: 1,
      token_total: (i + 1) * 10,
      usd_cost: 0,
    }
  })

  const result = normalizeTrendData(rows)
  expect(result).toHaveLength(24)

  // Most recent bucket must be the last of the 30 generated days
  expect(result[23]?.label).toBe('2026-05-30')
  // The 7th bucket from the end (oldest kept) is 2026-05-07
  expect(result[0]?.label).toBe('2026-05-07')
  // None of the result labels should be a padded "Xh" label
  for (const bucket of result) {
    expect(bucket.label).not.toMatch(/^\d+h$/)
  }
})

/**
 * S4-T3 prior-#58: label-mixing guard.
 *
 * When the raw data includes both ISO-8601 bucket keys and relative "Xh" keys
 * (a mixing scenario from prior issue #58), normalizeTrendData must correctly
 * sort them. ISO-8601 keys sort lexicographically before "Xh" strings, so the
 * buckets should be ordered: ISO dates first (chronologically), then "Xh" keys.
 * The function doesn't prevent mixing (that's the caller's responsibility), but
 * it must not crash and must still return exactly 24 buckets.
 */
test('test_normalizeTrendData_handles_mixed_iso_and_relative_labels', () => {
  // Mix of ISO date buckets and relative "Xh" labels — prior #58 scenario
  const rows = [
    {
      bucket: '2026-05-20',
      provider: 'anthropic',
      model: 'claude-sonnet',
      repository: '',
      traces: 1,
      token_total: 100,
      usd_cost: 0,
    },
    {
      bucket: '3h',
      provider: 'openai',
      model: 'gpt-4',
      repository: '',
      traces: 1,
      token_total: 50,
      usd_cost: 0,
    },
  ]

  const result = normalizeTrendData(rows)
  // Must not throw; always returns 24 buckets
  expect(result).toHaveLength(24)
  // Real buckets are present somewhere in the result
  const labels = result.map((b) => b.label)
  expect(labels).toContain('2026-05-20')
  expect(labels).toContain('3h')
})

/**
 * S4-T3 — normalizeTrendData: NaN-total and negative-total rows are accepted
 * by the bucket map (no crash), but the guard in `buildTokenTrendDayEnvelopes`
 * drops NaN-hour rows. normalizeTrendData itself does NOT drop NaN/negative
 * token_total rows — it sums them faithfully. This test documents that contract.
 */
test('test_normalizeTrendData_sums_negative_and_nan_totals_into_bucket', () => {
  const rows = [
    {
      bucket: '2026-05-20',
      provider: 'anthropic',
      model: 'claude-sonnet',
      repository: '',
      traces: 1,
      token_total: 500,
      usd_cost: 0,
    },
    {
      bucket: '2026-05-20',
      provider: 'anthropic',
      model: 'claude-haiku',
      repository: '',
      traces: 1,
      token_total: -50, // negative: unusual but should not crash
      usd_cost: 0,
    },
  ]

  const result = normalizeTrendData(rows)
  expect(result).toHaveLength(24)
  // The bucket for 2026-05-20 should contain the sum of 500 + (-50) = 450
  const dataBucket = result.find((b) => b.label === '2026-05-20')
  expect(dataBucket).toBeDefined()
  expect(dataBucket?.totals['anthropic']).toBe(450)
})

/**
 * S4-T3 — normalizeTrendData: provider name normalisation.
 * 'x.ai' and 'xai' variant rows must both land in the same canonical 'xai' key.
 */
test('test_normalizeTrendData_normalizes_xai_provider_variants', () => {
  const rows = [
    {
      bucket: '2026-05-20',
      provider: 'x.ai', // variant
      model: 'grok-2',
      repository: '',
      traces: 1,
      token_total: 300,
      usd_cost: 0,
    },
    {
      bucket: '2026-05-20',
      provider: 'xai', // canonical
      model: 'grok-3',
      repository: '',
      traces: 1,
      token_total: 200,
      usd_cost: 0,
    },
  ]

  const result = normalizeTrendData(rows)
  const dataBucket = result.find((b) => b.label === '2026-05-20')
  expect(dataBucket).toBeDefined()
  // Both 'x.ai' and 'xai' must collapse to 'xai'
  expect(dataBucket?.totals['xai']).toBe(500)
  expect(dataBucket?.totals['x.ai']).toBeUndefined()
})

// ---------------------------------------------------------------------------
// Wave 10 (S4-T3): formatBucketLabel coverage
// ---------------------------------------------------------------------------

/**
 * S4-T3 — formatBucketLabel: ISO-8601 date string → MM/DD.
 */
test('test_formatBucketLabel_converts_iso_date_to_mm_dd', () => {
  expect(formatBucketLabel('2026-05-19')).toBe('05/19')
  expect(formatBucketLabel('2026-01-01')).toBe('01/01')
  expect(formatBucketLabel('2026-12-31')).toBe('12/31')
})

/**
 * S4-T3 — formatBucketLabel: ISO-8601 datetime strings → MM/DD (date portion only).
 */
test('test_formatBucketLabel_converts_iso_datetime_to_mm_dd', () => {
  expect(formatBucketLabel('2026-05-19T00:00:00.000Z')).toBe('05/19')
  expect(formatBucketLabel('2026-06-01T12:00:00.000Z')).toBe('06/01')
})

/**
 * S4-T3 — formatBucketLabel: relative "Xh" labels pass through unchanged.
 */
test('test_formatBucketLabel_passes_through_relative_labels', () => {
  expect(formatBucketLabel('23h')).toBe('23h')
  expect(formatBucketLabel('0h')).toBe('0h')
  expect(formatBucketLabel('5h')).toBe('5h')
  // Non-ISO non-relative labels also pass through unchanged
  expect(formatBucketLabel('custom-label')).toBe('custom-label')
})
