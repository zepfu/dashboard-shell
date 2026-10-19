import { EventEmitter } from 'node:events'
import { describe, expect, test } from 'vitest'
import {
  handleSessionTransferStatus,
  loadSessionTransferStatus,
  normalizeSessionTransferUpstream,
  sessionTransferAuthHeaders,
} from './report-service.mjs'

const SELECTION = { session_id: 'sess-1' }

function upstreamRecord(overrides: Record<string, unknown> = {}) {
  return {
    schema_version: 'session-transfer-status.v1',
    litellm_call_id: 'call-1',
    session_id: 'sess-1',
    phase: 'response_streaming',
    active: true,
    stale: false,
    freshness: 'live',
    upstream_chunk_count: 4,
    upstream_byte_count: 128,
    downstream_chunk_count: 3,
    downstream_byte_count: 96,
    last_heartbeat_at: '2026-10-19T13:00:00.000Z',
    received_at: '2026-10-19T12:59:00.000Z',
    provider: 'openai',
    model: 'gpt-test',
    messages: [{ content: 'SECRET_PROMPT' }],
    content: 'SECRET_PROMPT',
    tool_calls: [{ arguments: 'SECRET_TOOL' }],
    error_message: 'SECRET_ERROR',
    ...overrides,
  }
}

function upstreamPayload(
  transfers: Array<Record<string, unknown>>,
  registryState = 'ok'
) {
  return {
    schema_version: 'session-transfer-status.v1',
    registry: {
      state: registryState,
      mode: 'redis',
      error_class: 'SECRET_CLASS',
      redis_key: 'SECRET_REDIS',
    },
    result_count: transfers.length,
    truncated: false,
    transfers,
    messages: ['SECRET_PROMPT'],
  }
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

function createResponse() {
  const res = new EventEmitter() as EventEmitter & {
    writableEnded: boolean
    writableFinished: boolean
    statusCode?: number
    body: Array<string | Buffer>
    writeHead: (status: number, headers: Record<string, string>) => void
    end: (chunk?: string | Buffer) => void
  }
  res.writableEnded = false
  res.writableFinished = false
  res.body = []
  res.writeHead = (status) => {
    res.statusCode = status
  }
  res.end = (chunk) => {
    if (chunk != null) res.body.push(chunk)
    res.writableEnded = true
    res.writableFinished = true
    res.emit('finish')
  }
  return res
}

function readJson(res: ReturnType<typeof createResponse>) {
  return JSON.parse(res.body.map((chunk) => chunk.toString()).join(''))
}

describe('session transfer status endpoint', () => {
  test('requires an explicit session and keeps browser credentials off the upstream request', async () => {
    const missing = createResponse()
    await handleSessionTransferStatus(
      {
        method: 'GET',
        url: '/api/shell/reports/usage/session-transfer-status',
        headers: { authorization: 'Bearer browser-secret', host: 'localhost' },
      },
      missing,
      {
        env: { LITELLM_MASTER_KEY: 'server-master' },
        fetchImpl: async () => {
          throw new Error('upstream should not be called')
        },
      }
    )
    expect(missing.statusCode).toBe(400)
    expect(readJson(missing).error).toMatch(/session_id/)

    let captured: { url: URL; headers: Record<string, string> } | undefined
    const res = createResponse()
    await handleSessionTransferStatus(
      {
        method: 'GET',
        url: '/api/shell/reports/usage/session-transfer-status?session_id=sess-1&messages=SECRET_PROMPT&content=SECRET_PROMPT',
        headers: {
          authorization: 'Bearer browser-secret',
          cookie: 'session=browser',
          'x-api-key': 'browser-key',
          host: 'localhost',
        },
      },
      res,
      {
        env: {
          LITELLM_API_TARGET: 'http://litellm.test',
          LITELLM_MASTER_KEY: 'server-master',
        },
        fetchImpl: async (url: URL, init: RequestInit) => {
          captured = {
            url,
            headers: init.headers as Record<string, string>,
          }
          return jsonResponse(
            upstreamPayload([
              upstreamRecord({
                phase: 'awaiting_upstream',
                upstream_chunk_count: 0,
                upstream_byte_count: 0,
                downstream_chunk_count: 0,
                downstream_byte_count: 0,
              }),
            ])
          )
        },
      }
    )

    expect(captured?.url.pathname).toBe(
      '/internal/aawm/session-transfer-status'
    )
    expect(captured?.url.searchParams.get('session_id')).toBe('sess-1')
    expect(captured?.url.searchParams.get('limit')).toBe('20')
    expect(captured?.url.searchParams.get('messages')).toBeNull()
    expect(captured?.url.searchParams.get('active_only')).toBeNull()
    expect(captured?.headers.Authorization).toBe('Bearer server-master')
    expect(captured?.headers['x-litellm-api-key']).toBe('Bearer server-master')
    expect(JSON.stringify(captured?.headers)).not.toContain('browser-secret')
    expect(JSON.stringify(captured?.headers)).not.toContain('browser-key')
    const body = readJson(res)
    expect(body.availability).toBe('live')
    expect(body.transfers[0]).toMatchObject({
      phase: 'awaiting_upstream',
      freshness: 'live',
      upstream_chunk_count: 0,
      downstream_chunk_count: 0,
    })
    expect(JSON.stringify(body)).not.toContain('SECRET_PROMPT')
    expect(JSON.stringify(body)).not.toContain('SECRET_TOOL')
    expect(JSON.stringify(body)).not.toContain('SECRET_REDIS')
    expect(body.retention).toEqual({
      active_ttl_seconds: 180,
      terminal_ttl_seconds: 45,
      stale_after_seconds: 30,
    })
  })

  test('preserves live, stale, and terminal transfers without message content', () => {
    const live = normalizeSessionTransferUpstream(
      upstreamPayload([upstreamRecord()]),
      SELECTION
    )
    expect(live.availability).toBe('live')
    expect(live.transfers[0]).toMatchObject({
      phase: 'response_streaming',
      freshness: 'live',
      upstream_chunk_count: 4,
      downstream_chunk_count: 3,
    })

    const stale = normalizeSessionTransferUpstream(
      upstreamPayload([
        upstreamRecord({ freshness: 'stale', stale: true, active: false }),
      ]),
      SELECTION
    )
    expect(stale.availability).toBe('stale')
    expect(stale.transfers[0]).toMatchObject({
      phase: 'response_streaming',
      freshness: 'stale',
      upstream_chunk_count: 4,
    })

    const terminal = normalizeSessionTransferUpstream(
      upstreamPayload([
        upstreamRecord({
          phase: 'completed',
          freshness: 'terminal',
          active: false,
          terminal_state: 'completed',
          finalized_at: '2026-10-19T13:00:30.000Z',
        }),
      ]),
      SELECTION
    )
    expect(terminal.availability).toBe('terminal')
    expect(terminal.transfers[0]).toMatchObject({
      phase: 'completed',
      freshness: 'terminal',
      terminal_state: 'completed',
      upstream_chunk_count: 4,
    })
    expect(JSON.stringify(terminal)).not.toContain('SECRET_PROMPT')
  })

  test('does not present expired, unavailable, or unsupported status as an outcome or zero work', () => {
    const expired = normalizeSessionTransferUpstream(
      upstreamPayload([]),
      SELECTION
    )
    expect(expired).toMatchObject({
      availability: 'expired',
      reason: 'retention_elapsed',
      transfers: [],
    })

    const degradedEmpty = normalizeSessionTransferUpstream(
      upstreamPayload([], 'degraded'),
      SELECTION
    )
    expect(degradedEmpty.availability).toBe('unavailable')
    expect(degradedEmpty.transfers).toEqual([])

    const unavailable = normalizeSessionTransferUpstream(
      upstreamPayload(
        [
          upstreamRecord({
            phase: 'failed',
            freshness: 'unavailable',
            upstream_chunk_count: 0,
            downstream_chunk_count: 0,
          }),
        ],
        'unavailable'
      ),
      SELECTION
    )
    expect(unavailable.availability).toBe('unavailable')
    expect(unavailable.transfers).toEqual([])
    expect(JSON.stringify(unavailable.transfers)).not.toContain('failed')

    const unsupported = normalizeSessionTransferUpstream(
      {
        schema_version: 'other',
        transfers: [
          {
            phase: 'completed',
            freshness: 'terminal',
            upstream_chunk_count: 0,
          },
        ],
      },
      SELECTION
    )
    expect(unsupported).toMatchObject({
      availability: 'unsupported',
      reason: 'schema_unsupported',
      transfers: [],
    })
  })

  test('maps upstream failures without echoing their bodies', async () => {
    const env = {
      LITELLM_API_TARGET: 'http://litellm.test',
      LITELLM_ACCESS_TOKEN: 'server-token',
    }
    const unsupported = await loadSessionTransferStatus({
      selection: SELECTION,
      env,
      fetchImpl: async () =>
        jsonResponse({ detail: 'SECRET_MISSING_ROUTE' }, 404),
    })
    expect(unsupported.body).toMatchObject({
      availability: 'unsupported',
      transfers: [],
    })
    expect(JSON.stringify(unsupported.body)).not.toContain(
      'SECRET_MISSING_ROUTE'
    )

    const unauthorized = await loadSessionTransferStatus({
      selection: SELECTION,
      env,
      fetchImpl: async () => jsonResponse({ detail: 'SECRET_DENIED' }, 403),
    })
    expect(unauthorized.body.availability).toBe('unavailable')
    expect(unauthorized.body.reason).toBe('upstream_unauthorized')
    expect(JSON.stringify(unauthorized.body)).not.toContain('SECRET_DENIED')

    const unreachable = await loadSessionTransferStatus({
      selection: SELECTION,
      env,
      fetchImpl: async () => {
        throw new Error('SECRET_DOWN')
      },
    })
    expect(unreachable.body).toMatchObject({
      availability: 'unavailable',
      reason: 'upstream_unreachable',
      transfers: [],
    })
    expect(JSON.stringify(unreachable.body)).not.toContain('SECRET_DOWN')

    let called = false
    const unconfigured = await loadSessionTransferStatus({
      selection: SELECTION,
      env: { LITELLM_API_TARGET: 'http://litellm.test' },
      fetchImpl: async () => {
        called = true
        return jsonResponse(upstreamPayload([]))
      },
    })
    expect(called).toBe(false)
    expect(unconfigured.body.reason).toBe('credentials_unconfigured')
    expect(sessionTransferAuthHeaders('server-token').Authorization).toBe(
      'Bearer server-token'
    )
  })

  test('stops when the selected view disconnects', async () => {
    const res = createResponse()
    const pending = handleSessionTransferStatus(
      {
        method: 'GET',
        url: '/api/shell/reports/usage/session-transfer-status?session_id=sess-1',
        headers: { host: 'localhost' },
      },
      res,
      {
        env: { LITELLM_MASTER_KEY: 'server-master' },
        fetchImpl: (_url: URL, init: RequestInit) =>
          new Promise<Response>((_resolve, reject) => {
            init.signal?.addEventListener('abort', () => {
              const error = new Error('aborted')
              error.name = 'AbortError'
              reject(error)
            })
          }),
      }
    )
    res.emit('close')
    await pending
    expect(res.writableEnded).toBe(false)
    expect(res.statusCode).toBeUndefined()
  })
})
