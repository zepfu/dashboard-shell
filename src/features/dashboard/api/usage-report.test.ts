import { http, HttpResponse } from 'msw'
import { server } from '../../../test/setup'
import {
  fetchUsageReportTokenTrendDay,
  fetchUsageReportTokenTrendSummary,
} from './usage-report'

test('test_fetchUsageReportTokenTrendSummary_sends_filters', async () => {
  let requestedUrl: URL | null = null

  server.use(
    http.get('/api/shell/reports/usage/token-trend-summary', ({ request }) => {
      requestedUrl = new URL(request.url)
      return HttpResponse.json({
        metadata: {
          from: '2026-05-20',
          to: '2026-05-21',
        },
        tokenTrendHours: [],
        tokenTrendVersions: [],
      })
    })
  )

  await expect(
    fetchUsageReportTokenTrendSummary({
      from: '2026-05-20',
      to: '2026-05-21',
      model: ['claude-sonnet-4'],
    })
  ).resolves.toMatchObject({ tokenTrendHours: [], tokenTrendVersions: [] })

  expect(requestedUrl?.searchParams.get('from')).toBe('2026-05-20')
  expect(requestedUrl?.searchParams.get('to')).toBe('2026-05-21')
  expect(requestedUrl?.searchParams.get('model')).toBe('claude-sonnet-4')
})

test('test_fetchUsageReportTokenTrendDay_sends_date_filters_and_signal', async () => {
  let requestedUrl: URL | null = null
  const controller = new AbortController()

  server.use(
    http.get('/api/shell/reports/usage/token-trend-day', ({ request }) => {
      requestedUrl = new URL(request.url)
      expect(controller.signal.aborted).toBe(false)
      return HttpResponse.json({
        metadata: {
          date: '2026-05-20',
          from: '2026-05-20',
          to: '2026-05-21',
        },
        date: '2026-05-20',
        rows: [],
      })
    })
  )

  await expect(
    fetchUsageReportTokenTrendDay(
      {
        from: '2026-05-20',
        to: '2026-05-21',
        date: '2026-05-20',
        provider: ['anthropic', 'openai'],
        repository: ['dashboard-shell'],
        client: ['codex-tui'],
      },
      controller.signal
    )
  ).resolves.toMatchObject({ date: '2026-05-20', rows: [] })

  expect(requestedUrl?.searchParams.get('date')).toBe('2026-05-20')
  expect(requestedUrl?.searchParams.get('from')).toBe('2026-05-20')
  expect(requestedUrl?.searchParams.get('to')).toBe('2026-05-21')
  expect(requestedUrl?.searchParams.get('provider')).toBe('anthropic,openai')
  expect(requestedUrl?.searchParams.get('repository')).toBe('dashboard-shell')
  expect(requestedUrl?.searchParams.get('client')).toBe('codex-tui')
})

test('test_fetchUsageReportTokenTrendDay_uses_server_error_message', async () => {
  server.use(
    http.get('/api/shell/reports/usage/token-trend-day', () =>
      HttpResponse.json({ error: 'bad day' }, { status: 400 })
    )
  )

  await expect(
    fetchUsageReportTokenTrendDay({
      from: '2026-05-20',
      to: '2026-05-21',
      date: '2026-05-20',
    })
  ).rejects.toThrow('bad day')
})
