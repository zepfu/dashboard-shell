import { describe, expect, test, vi } from 'vitest'
import {
  LIVE_SESSION_TRANSFER_REFETCH_INTERVAL_MS,
  SESSION_TRANSFER_STATUS_PATH,
  fetchSessionTransferStatus,
  normalizeSessionTransferStatus,
  sessionTransferStatusQueryOptions,
} from './session-transfer-status'

describe('session transfer status client', () => {
  test('query stays idle until a session is selected in the active view', () => {
    const idle = sessionTransferStatusQueryOptions({
      sessionId: null,
      viewActive: true,
    })
    expect(idle.enabled).toBe(false)
    expect(idle.refetchInterval).toBe(false)
    expect(idle.refetchIntervalInBackground).toBe(false)

    const hidden = sessionTransferStatusQueryOptions({
      sessionId: 'sess-1',
      viewActive: false,
    })
    expect(hidden.enabled).toBe(false)
    expect(hidden.refetchInterval).toBe(false)

    const selected = sessionTransferStatusQueryOptions({
      sessionId: ' sess-1 ',
      viewActive: true,
    })
    expect(selected.enabled).toBe(true)
    expect(selected.refetchInterval).toBe(
      LIVE_SESSION_TRANSFER_REFETCH_INTERVAL_MS
    )
    expect(selected.refetchIntervalInBackground).toBe(false)
    expect(selected.gcTime).toBe(0)
    expect(selected.queryKey).toEqual(['session-transfer-status', 'sess-1'])
  })

  test('requests only the selected session through the shell path', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          schema_version: 'session-transfer-status.v1',
          availability: 'live',
          reason: null,
          selection: { session_id: 'sess-1' },
          registry: { state: 'ok' },
          transfers: [
            {
              phase: 'response_streaming',
              freshness: 'live',
              upstream_chunk_count: 4,
              downstream_chunk_count: 2,
            },
          ],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } }
      )
    )
    try {
      const status = await fetchSessionTransferStatus('sess-1')
      const [url, init] = fetchMock.mock.calls[0] ?? []
      expect(String(url)).toBe(
        `${SESSION_TRANSFER_STATUS_PATH}?session_id=sess-1`
      )
      expect(init).toMatchObject({
        cache: 'no-store',
        headers: { accept: 'application/json' },
      })
      expect(JSON.stringify(init?.headers ?? {})).not.toMatch(
        /authorization|api-key/i
      )
      expect(status.availability).toBe('live')
      expect(status.selection.session_id).toBe('sess-1')
      expect(status.transfers[0]?.upstream_chunk_count).toBe(4)
    } finally {
      fetchMock.mockRestore()
    }
  })

  test('drops content and does not keep counters for expired or unavailable payloads', () => {
    const expired = normalizeSessionTransferStatus({
      availability: 'expired',
      reason: 'retention_elapsed',
      transfers: [
        {
          phase: 'completed',
          freshness: 'terminal',
          upstream_chunk_count: 0,
          content: 'SECRET_PROMPT',
          messages: [{ content: 'SECRET_PROMPT' }],
        },
      ],
    })
    expect(expired.transfers).toEqual([])
    expect(JSON.stringify(expired)).not.toContain('SECRET_PROMPT')

    const unavailable = normalizeSessionTransferStatus({
      availability: 'unavailable',
      reason: 'registry_unavailable',
      transfers: [
        {
          phase: 'failed',
          freshness: 'terminal',
          upstream_chunk_count: 0,
          tool_calls: [{ arguments: 'SECRET_TOOL' }],
        },
      ],
    })
    expect(unavailable.availability).toBe('unavailable')
    expect(unavailable.transfers).toEqual([])
    expect(JSON.stringify(unavailable)).not.toContain('SECRET_TOOL')

    const unsupported = normalizeSessionTransferStatus({
      availability: 'not-a-status',
      transfers: [{ phase: 'completed', upstream_chunk_count: 0 }],
    })
    expect(unsupported.availability).toBe('unsupported')
    expect(unsupported.transfers).toEqual([])
  })
})
