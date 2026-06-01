import {
  buildTokenTrendDayEnvelopes,
  classifyTokenTrendActiveVersionFamily,
  deriveTokenTrendActiveVersionLanes,
  deriveTokenTrendModelFirstSeenGroups,
  deriveTokenTrendVersionTracks,
  normalizeTokenTrendClientVersionForLane,
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

test('test_deriveTokenTrendVersionTracks_breaks_lines_across_large_gaps', () => {
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
      hour: 2,
      provider: 'anthropic',
      traces: 1,
      token_total: 100,
      usd_cost: 0,
    },
    {
      day: '2026-05-20',
      hour: 8,
      provider: 'anthropic',
      traces: 1,
      token_total: 100,
      usd_cost: 0,
    },
  ])

  const tracks = deriveTokenTrendVersionTracks(
    envelopes,
    [
      {
        provider: 'anthropic',
        client_name: 'codex-tui',
        client_version: '0.120.0',
        first_seen_at: '2026-05-20T05:00:00.000Z',
        last_seen_at: '2026-05-20T12:00:00.000Z',
        first_seen_day: '2026-05-20',
        first_seen_hour: 1,
        last_seen_day: '2026-05-20',
        last_seen_hour: 8,
        traces: 3,
        token_total: 300,
        usd_cost: 0,
      },
    ],
    ['anthropic'],
    { gapToleranceHours: 2 }
  )

  expect(tracks).toHaveLength(1)
  expect(tracks[0]?.segments).toHaveLength(2)
  expect(tracks[0]?.releasePoint?.hour).toBe(1)
})

test('test_deriveTokenTrendVersionTracks_scales_points_inside_day_envelope_height', () => {
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
      hour: 8,
      provider: 'anthropic',
      traces: 1,
      token_total: 1000,
      usd_cost: 0,
    },
  ])

  const tracks = deriveTokenTrendVersionTracks(
    envelopes,
    [
      {
        provider: 'anthropic',
        client_name: 'codex-tui',
        client_version: '0.120.0',
        first_seen_at: '2026-05-20T12:00:00.000Z',
        last_seen_at: '2026-05-20T12:30:00.000Z',
        first_seen_day: '2026-05-20',
        first_seen_hour: 8,
        last_seen_day: '2026-05-20',
        last_seen_hour: 8,
        traces: 1,
        token_total: 100,
        usd_cost: 0,
      },
    ],
    ['anthropic']
  )

  expect(tracks[0]?.releasePoint?.y).toBeCloseTo(95)
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
