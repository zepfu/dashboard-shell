import {
  buildTokenTrendDayEnvelopes,
  deriveTokenTrendVersionTracks,
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
