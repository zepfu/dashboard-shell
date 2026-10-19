import type { ReactElement, ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { afterEach, describe, expect, test } from 'vitest'
import { server } from '../../../../test/setup'
import { SESSION_TRANSFER_STATUS_PATH } from '../../api/session-transfer-status'
import { SessionTransferStatusView } from './session-transfer-status-panel'

function renderView(ui: ReactElement) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  })
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  )
  return render(ui, { wrapper })
}

function transfer(overrides: Record<string, unknown> = {}) {
  return {
    phase: 'response_streaming',
    freshness: 'live',
    active: true,
    stale: false,
    terminal_state: null,
    upstream_chunk_count: 4,
    upstream_byte_count: 128,
    downstream_chunk_count: 3,
    downstream_byte_count: 96,
    last_heartbeat_at: '2026-10-19T13:00:00.000Z',
    finalized_at: null,
    received_at: '2026-10-19T12:59:00.000Z',
    litellm_call_id: 'call-1',
    session_id: 'sess-live',
    provider: 'openai',
    model: 'gpt-test',
    content: 'SECRET_PROMPT',
    messages: [{ content: 'SECRET_PROMPT' }],
    tool_calls: [{ arguments: 'SECRET_TOOL' }],
    ...overrides,
  }
}

function envelope(
  availability: string,
  transfers: Array<Record<string, unknown>>,
  sessionId: string,
  reason: string | null = null
) {
  return {
    schema_version: 'session-transfer-status.v1',
    availability,
    reason,
    retention: {
      active_ttl_seconds: 180,
      terminal_ttl_seconds: 45,
      stale_after_seconds: 30,
    },
    selection: { session_id: sessionId },
    registry: { state: availability === 'unavailable' ? 'unavailable' : 'ok' },
    observed_at: '2026-10-19T13:00:00.000Z',
    truncated: false,
    transfers,
  }
}

describe('SessionTransferStatusView', () => {
  afterEach(() => {
    cleanup()
  })

  test('does not request status before a session is selected', async () => {
    let requests = 0
    server.use(
      http.get(SESSION_TRANSFER_STATUS_PATH, () => {
        requests += 1
        return HttpResponse.json(
          envelope('expired', [], 'sess-live', 'retention_elapsed')
        )
      })
    )
    renderView(
      <SessionTransferStatusView
        suggestedSessionIds={['sess-live']}
        refetchIntervalMs={false}
      />
    )
    expect(
      screen.getByText(/Select a session to read live transfer status/)
    ).toBeInTheDocument()
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(requests).toBe(0)
  })

  test('follows live, stale, terminal, expired, unavailable, and unsupported responses', async () => {
    let mode:
      | 'live-zero'
      | 'live'
      | 'stale'
      | 'terminal'
      | 'expired'
      | 'unavailable'
      | 'unsupported' = 'live-zero'
    server.use(
      http.get(SESSION_TRANSFER_STATUS_PATH, ({ request }) => {
        const sessionId = new URL(request.url).searchParams.get('session_id')
        expect(sessionId).toBe('sess-live')
        if (mode === 'unsupported') {
          return new HttpResponse(null, { status: 404 })
        }
        if (mode === 'expired') {
          return HttpResponse.json(
            envelope('expired', [], 'sess-live', 'retention_elapsed')
          )
        }
        if (mode === 'unavailable') {
          return HttpResponse.json(
            envelope(
              'unavailable',
              [
                transfer({
                  phase: 'failed',
                  freshness: 'terminal',
                  upstream_chunk_count: 0,
                  downstream_chunk_count: 0,
                }),
              ],
              'sess-live',
              'registry_unavailable'
            )
          )
        }
        if (mode === 'live-zero') {
          return HttpResponse.json(
            envelope(
              'live',
              [
                transfer({
                  phase: 'awaiting_upstream',
                  upstream_chunk_count: 0,
                  upstream_byte_count: 0,
                  downstream_chunk_count: 0,
                  downstream_byte_count: 0,
                }),
              ],
              'sess-live'
            )
          )
        }
        if (mode === 'live') {
          return HttpResponse.json(envelope('live', [transfer()], 'sess-live'))
        }
        if (mode === 'stale') {
          return HttpResponse.json(
            envelope(
              'stale',
              [transfer({ freshness: 'stale', stale: true, active: false })],
              'sess-live'
            )
          )
        }
        return HttpResponse.json(
          envelope(
            'terminal',
            [
              transfer({
                phase: 'completed',
                freshness: 'terminal',
                terminal_state: 'completed',
                active: false,
              }),
            ],
            'sess-live'
          )
        )
      })
    )

    renderView(
      <SessionTransferStatusView
        suggestedSessionIds={['sess-live']}
        refetchIntervalMs={false}
      />
    )
    fireEvent.click(screen.getByRole('button', { name: 'sess-live' }))

    expect(
      await screen.findByTestId('session-transfer-phase')
    ).toHaveTextContent('awaiting_upstream')
    expect(
      screen.getByTestId('session-transfer-upstream-chunks')
    ).toHaveTextContent('0')
    expect(screen.getAllByText('live').length).toBeGreaterThan(0)
    expect(document.body).not.toHaveTextContent('SECRET_PROMPT')
    expect(document.body).not.toHaveTextContent('SECRET_TOOL')

    mode = 'live'
    fireEvent.click(screen.getByRole('button', { name: 'Refresh live status' }))
    await waitFor(() => {
      expect(
        screen.getByTestId('session-transfer-upstream-chunks')
      ).toHaveTextContent('4')
    })
    expect(
      screen.getByTestId('session-transfer-downstream-chunks')
    ).toHaveTextContent('3')
    expect(screen.getByTestId('session-transfer-phase')).toHaveTextContent(
      'response_streaming'
    )

    mode = 'stale'
    fireEvent.click(screen.getByRole('button', { name: 'Refresh live status' }))
    expect(
      await screen.findByText(/not a terminal outcome/)
    ).toBeInTheDocument()
    expect(screen.getByTestId('session-transfer-freshness')).toHaveTextContent(
      'stale'
    )
    expect(
      screen.getByTestId('session-transfer-upstream-chunks')
    ).toHaveTextContent('4')
    expect(screen.queryByText('completed')).toBeNull()

    mode = 'terminal'
    fireEvent.click(screen.getByRole('button', { name: 'Refresh live status' }))
    await waitFor(() => {
      expect(screen.getByTestId('session-transfer-phase')).toHaveTextContent(
        'completed'
      )
    })
    expect(screen.getAllByText('completed').length).toBeGreaterThan(0)

    mode = 'expired'
    fireEvent.click(screen.getByRole('button', { name: 'Refresh live status' }))
    const expired = await screen.findByTestId('session-transfer-availability')
    expect(expired).toHaveTextContent('No live transfer is registered')
    expect(expired).toHaveTextContent('180 seconds')
    expect(expired).toHaveTextContent('45 seconds')
    expect(expired).toHaveTextContent(
      'not a completed, failed, or zero-work transfer'
    )
    expect(screen.queryByTestId('session-transfer-phase')).toBeNull()
    expect(screen.queryByTestId('session-transfer-upstream-chunks')).toBeNull()
    expect(screen.queryByText('completed')).toBeNull()

    mode = 'unavailable'
    fireEvent.click(screen.getByRole('button', { name: 'Refresh live status' }))
    await waitFor(() => {
      expect(
        screen.getByTestId('session-transfer-availability')
      ).toHaveTextContent('Live transfer status is unavailable')
    })
    const unavailable = screen.getByTestId('session-transfer-availability')
    expect(unavailable).toHaveTextContent(
      'not a completed, failed, or zero-work transfer'
    )
    expect(screen.queryByTestId('session-transfer-phase')).toBeNull()
    expect(screen.queryByTestId('session-transfer-upstream-chunks')).toBeNull()
    expect(screen.queryByText('failed')).toBeNull()

    mode = 'unsupported'
    fireEvent.click(screen.getByRole('button', { name: 'Refresh live status' }))
    expect(
      await screen.findByText(/not supported by the configured proxy/)
    ).toBeInTheDocument()
    expect(screen.queryByTestId('session-transfer-upstream-chunks')).toBeNull()
    expect(screen.queryByText('completed')).toBeNull()
  })

  test('clears the previous status when the selection is cleared', async () => {
    server.use(
      http.get(SESSION_TRANSFER_STATUS_PATH, () =>
        HttpResponse.json(
          envelope(
            'terminal',
            [
              transfer({
                phase: 'failed',
                freshness: 'terminal',
                terminal_state: 'failed',
                session_id: 'sess-typed',
              }),
            ],
            'sess-typed'
          )
        )
      )
    )
    renderView(<SessionTransferStatusView refetchIntervalMs={false} />)
    fireEvent.change(screen.getByLabelText('Session'), {
      target: { value: 'sess-typed' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Show live status' }))
    expect(
      await screen.findByTestId('session-transfer-phase')
    ).toHaveTextContent('failed')
    fireEvent.click(screen.getByRole('button', { name: 'Clear session' }))
    expect(screen.queryByTestId('session-transfer-phase')).toBeNull()
    expect(
      screen.getByText(/Select a session to read live transfer status/)
    ).toBeInTheDocument()
    expect(screen.queryByText('failed')).toBeNull()
  })

  test('aborts the in-flight request when the view unmounts', async () => {
    let aborted = false
    server.use(
      http.get(SESSION_TRANSFER_STATUS_PATH, ({ request }) => {
        return new Promise((resolve) => {
          request.signal.addEventListener('abort', () => {
            aborted = true
            resolve(new HttpResponse(null, { status: 499 }))
          })
        })
      })
    )
    const view = renderView(
      <SessionTransferStatusView
        suggestedSessionIds={['sess-live']}
        refetchIntervalMs={false}
      />
    )
    fireEvent.click(screen.getByRole('button', { name: 'sess-live' }))
    await waitFor(() => {
      expect(
        screen.getByText('Checking live transfer status…')
      ).toBeInTheDocument()
    })
    view.unmount()
    await waitFor(() => {
      expect(aborted).toBe(true)
    })
  })
})
