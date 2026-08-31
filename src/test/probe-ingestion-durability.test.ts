import { describe, expect, test } from 'vitest'
import {
  compareLatestSuccessToSource,
  parseArgs,
  parseLiteLlmLogText,
  summarizeIngestionDurability,
} from '../../scripts/probe-ingestion-durability.mjs'

describe('probe-ingestion-durability', () => {
  test('parses successes, queue drops, and large payload warnings', () => {
    const rows = parseLiteLlmLogText(
      [
        '2026-06-06T15:29:04.028Z INFO:     172.30.0.1:58096 - "POST /openai_passthrough/responses HTTP/1.1" 200 OK',
        '2026-06-06T15:29:05.000Z AawmAgentIdentity: session_history queue full and overflow flusher busy; dropping overflow record',
        '2026-06-06T15:29:06.000Z LiteLLM:WARNING: langfuse.py:175 - Langfuse event near/exceeds size limit before SDK enqueue',
        '2026-06-06T15:29:07.000Z INFO:     127.0.0.1:50858 - "GET /health/liveliness HTTP/1.1" 200 OK',
      ].join('\n'),
      'aawm-litellm'
    )

    expect(rows.map((row) => row.type)).toEqual([
      'success',
      'session_history_drop',
      'large_observability_payload',
    ])
    expect(rows[0]).toMatchObject({
      container: 'aawm-litellm',
      observedAt: '2026-06-06T15:29:04.028Z',
      method: 'POST',
      path: '/openai_passthrough/responses',
      status: 200,
    })
  })

  test('compares latest success to source-table freshness', () => {
    const comparison = compareLatestSuccessToSource(
      {
        time: Date.parse('2026-06-06T15:10:00.000Z'),
        iso: '2026-06-06T15:10:00.000Z',
      },
      {
        latestDataAt: '2026-06-06T15:08:30.000Z',
        latestEventAt: '2026-06-06T15:08:30.000Z',
      }
    )

    expect(comparison).toMatchObject({
      status: 'behind_success_traffic',
      lagSeconds: 90,
      sourceAt: '2026-06-06T15:08:30.000Z',
      successAt: '2026-06-06T15:10:00.000Z',
    })
  })

  test('uses latestEventAt when latestDataAt is missing', () => {
    const comparison = compareLatestSuccessToSource(
      {
        time: Date.parse('2026-06-06T15:10:00.000Z'),
        iso: '2026-06-06T15:10:00.000Z',
      },
      {
        latestEventAt: '2026-06-06T15:09:00.000Z',
      }
    )

    expect(comparison).toMatchObject({
      status: 'behind_success_traffic',
      lagSeconds: 60,
      sourceAt: '2026-06-06T15:09:00.000Z',
      successAt: '2026-06-06T15:10:00.000Z',
    })
  })

  test('uses latestPersistedAt when latestDataAt and latestEventAt are missing', () => {
    const comparison = compareLatestSuccessToSource(
      {
        time: Date.parse('2026-06-06T15:10:00.000Z'),
        iso: '2026-06-06T15:10:00.000Z',
      },
      {
        latestPersistedAt: '2026-06-06T15:09:10.000Z',
      }
    )

    expect(comparison).toMatchObject({
      status: 'behind_success_traffic',
      lagSeconds: 50,
      sourceAt: '2026-06-06T15:09:10.000Z',
      successAt: '2026-06-06T15:10:00.000Z',
    })
  })

  test('summarizes red status for dropped records and stale session source', () => {
    const health = {
      databaseEndpoint: {
        host: 'pgbouncer-aawm-dev',
        port: '6432',
        database: 'aawm_tristore',
      },
      sourceTables: {
        tables: [
          {
            tableName: 'session_history',
            latestDataAt: '2026-06-06T15:00:00.000Z',
            latestEventAt: '2026-06-06T15:00:00.000Z',
          },
          {
            tableName: 'rate_limit_observations',
            latestDataAt: '2026-06-06T15:09:50.000Z',
            latestEventAt: '2026-06-06T15:09:50.000Z',
          },
        ],
      },
    }
    const rows = parseLiteLlmLogText(
      [
        '2026-06-06T15:10:00.000Z INFO:     172.30.0.1:58096 - "POST /openai_passthrough/responses HTTP/1.1" 200 OK',
        '2026-06-06T15:10:01.000Z AawmAgentIdentity: session_history queue full and overflow flusher busy; dropping overflow record',
      ].join('\n'),
      'aawm-litellm'
    )

    const summary = summarizeIngestionDurability(health, rows, {
      gapWarnSeconds: 30,
    })

    expect(summary.status).toBe('red')
    expect(summary.traffic.successCount).toBe(1)
    expect(summary.durabilitySignals.sessionDropCount).toBe(1)
    expect(summary.persistenceComparison.sessionHistory.lagSeconds).toBe(600)
    expect(summary.findings.map((finding) => finding.code)).toEqual([
      'session_history_drops_observed',
      'session_history_behind_success_traffic',
    ])
  })

  test('classifies 3xx access logs as http_redirect and excludes them from success/http_error counts', () => {
    const rows = parseLiteLlmLogText(
      [
        '2026-06-06T15:10:00.000Z INFO:     172.30.0.1:58096 - "GET /v1/legacy-endpoint HTTP/1.1" 302 Found',
        '2026-06-06T15:10:01.000Z INFO:     127.0.0.1:58097 - "GET /v1/chat/completions HTTP/1.1" 200 OK',
        '2026-06-06T15:10:02.000Z INFO:     172.30.0.1:58098 - "GET /v1/chat/completions HTTP/1.1" 504 Gateway Timeout',
      ].join('\n'),
      'aawm-litellm'
    )

    expect(rows.map((row) => row.type)).toEqual([
      'http_redirect',
      'success',
      'http_error',
    ])

    const summary = summarizeIngestionDurability(
      {
        sourceTables: {
          tables: [
            {
              tableName: 'session_history',
              latestDataAt: '2026-06-06T15:09:00.000Z',
            },
            {
              tableName: 'rate_limit_observations',
              latestDataAt: '2026-06-06T15:09:00.000Z',
            },
          ],
        },
      },
      rows
    )

    expect(summary.traffic.successCount).toBe(1)
    expect(summary.traffic.httpErrorCount).toBe(1)
    expect(
      summary.findings.find(
        (finding) => finding.code === 'no_success_traffic_observed'
      )
    ).toBe(undefined)
  })

  test('accepts prefixed or mapped source-table health shapes', () => {
    const health = {
      sourceTables: {
        tables: [
          {
            table_name: 'public.session_history',
            latest_data_at: 'ignored because camelCase is required downstream',
            latestDataAt: '2026-06-06T15:10:00.000Z',
            latestEventAt: '2026-06-06T15:09:58.000Z',
          },
        ],
        byName: {
          rate_limit_observations: {
            tableName: 'rate_limit_observations',
            latestDataAt: '2026-06-06T15:09:50.000Z',
            latestEventAt: '2026-06-06T15:09:50.000Z',
          },
        },
      },
    }
    const rows = parseLiteLlmLogText(
      '2026-06-06T15:10:03.000Z INFO:     172.30.0.1:58096 - "POST /v1/chat/completions HTTP/1.1" 200 OK',
      'aawm-litellm'
    )

    const summary = summarizeIngestionDurability(health, rows, {
      gapWarnSeconds: 30,
    })

    expect(summary.sourceTables.sessionHistory).toMatchObject({
      table_name: 'public.session_history',
      latestDataAt: '2026-06-06T15:10:00.000Z',
    })
    expect(summary.sourceTables.rateLimitObservations).toMatchObject({
      tableName: 'rate_limit_observations',
      latestDataAt: '2026-06-06T15:09:50.000Z',
    })
    expect(summary.findings).toEqual([])
  })

  test('fails visibly when source-table freshness is absent', () => {
    const rows = parseLiteLlmLogText(
      '2026-06-06T15:10:03.000Z INFO:     172.30.0.1:58096 - "POST /v1/chat/completions HTTP/1.1" 200 OK',
      'aawm-litellm'
    )

    const summary = summarizeIngestionDurability({}, rows)

    expect(summary.status).toBe('red')
    expect(summary.findings.map((finding) => finding.code)).toEqual([
      'session_history_source_freshness_missing',
      'rate_limit_observations_source_freshness_missing',
    ])
  })

  test('keeps CLI defaults bounded and configurable', () => {
    expect(
      parseArgs([
        '--',
        '--health-file',
        '/tmp/health.json',
        '--containers',
        'aawm-litellm,litellm-dev',
        '--since',
        '30m',
        '--tail',
        '250',
        '--gap-warn-seconds',
        '120',
        '--json',
      ])
    ).toMatchObject({
      healthFile: '/tmp/health.json',
      containers: ['aawm-litellm', 'litellm-dev'],
      since: '30m',
      tail: 250,
      gapWarnSeconds: 120,
      json: true,
    })
  })
})
