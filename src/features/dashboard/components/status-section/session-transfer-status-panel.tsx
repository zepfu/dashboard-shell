import { useState, type FormEvent, type ReactElement } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  SESSION_TRANSFER_RETENTION,
  sessionTransferStatusQueryOptions,
  type SessionTransferAvailability,
  type SessionTransferRecord,
  type SessionTransferStatusResponse,
} from '../../api/session-transfer-status'
import { STATUS_PILL_FALLBACK, StatusPanel, statusPill } from './section-chrome'

const AVAILABILITY_PILL = {
  live: { label: 'live', className: 'is-healthy' },
  stale: { label: 'stale', className: 'is-warn' },
  terminal: { label: 'terminal', className: 'is-unknown' },
  expired: { label: 'not registered', className: 'is-unknown' },
  unavailable: { label: 'unavailable', className: 'is-unknown' },
  unsupported: { label: 'unsupported', className: 'is-unknown' },
} as const

const TERMINAL_PILL = {
  completed: { label: 'completed', className: 'is-healthy' },
  failed: { label: 'failed', className: 'is-bad' },
  cancelled: { label: 'cancelled', className: 'is-bad' },
  disconnected: { label: 'disconnected', className: 'is-bad' },
  timed_out: { label: 'timed out', className: 'is-bad' },
} as const

function retentionSentence(status: SessionTransferStatusResponse): string {
  return `Active status is kept for ${status.retention.active_ttl_seconds} seconds and terminal status for ${status.retention.terminal_ttl_seconds} seconds.`
}

function availabilityMessage(
  status: SessionTransferStatusResponse
): string | null {
  if (status.availability === 'expired') {
    return `No live transfer is registered for this session. ${retentionSentence(status)} Absence is not a completed, failed, or zero-work transfer.`
  }
  if (status.availability === 'unsupported') {
    return 'Live transfer status is not supported by the configured proxy. Unsupported status is not a completed, failed, or zero-work transfer.'
  }
  if (status.availability === 'unavailable') {
    if (status.reason === 'credentials_unconfigured') {
      return 'Live transfer status is unavailable because the report service has no LiteLLM credential. Unavailable status is not a completed, failed, or zero-work transfer.'
    }
    return 'Live transfer status is unavailable. Unavailable status is not a completed, failed, or zero-work transfer.'
  }
  if (status.availability === 'stale') {
    return 'Stale status is still inside the short registry window and is not a terminal outcome.'
  }
  return null
}

function transferPill(transfer: SessionTransferRecord) {
  if (transfer.freshness === 'stale') {
    return AVAILABILITY_PILL.stale
  }
  if (transfer.freshness === 'terminal') {
    const phase = transfer.terminal_state ?? transfer.phase
    if (phase && phase in TERMINAL_PILL) {
      return TERMINAL_PILL[phase as keyof typeof TERMINAL_PILL]
    }
    return AVAILABILITY_PILL.terminal
  }
  if (transfer.freshness === 'live') return AVAILABILITY_PILL.live
  return AVAILABILITY_PILL.unavailable
}

function Counter({
  label,
  value,
  testId,
}: {
  label: string
  value: number | null
  testId: string
}) {
  if (value === null) return null
  return (
    <span>
      {label} <strong data-testid={testId}>{value}</strong>
    </span>
  )
}

function TransferRecordCard({
  transfer,
}: {
  transfer: SessionTransferRecord
}): ReactElement {
  const pill = transferPill(transfer)
  const showMeasurement = transfer.freshness !== 'unavailable' && transfer.phase
  return (
    <article
      className='status-estimator-lane'
      data-testid='session-transfer-record'
    >
      <div className='status-estimator-lane-head'>
        <span data-testid='session-transfer-phase'>
          {showMeasurement ? transfer.phase : 'unavailable'}
        </span>
        <span className={`status-pill ${pill.className}`}>{pill.label}</span>
      </div>
      <div
        className='status-estimator-meta-grid'
        data-testid='session-transfer-freshness'
      >
        <span>
          freshness <strong>{transfer.freshness}</strong>
        </span>
        {transfer.provider ? (
          <span>
            provider <strong>{transfer.provider}</strong>
          </span>
        ) : null}
        {transfer.model ? (
          <span>
            model <strong>{transfer.model}</strong>
          </span>
        ) : null}
        {transfer.litellm_call_id ? (
          <span>
            call <strong>{transfer.litellm_call_id}</strong>
          </span>
        ) : null}
      </div>
      {showMeasurement ? (
        <div className='status-estimator-meta-grid'>
          <Counter
            label='upstream chunks'
            value={transfer.upstream_chunk_count}
            testId='session-transfer-upstream-chunks'
          />
          <Counter
            label='downstream chunks'
            value={transfer.downstream_chunk_count}
            testId='session-transfer-downstream-chunks'
          />
          <Counter
            label='upstream bytes'
            value={transfer.upstream_byte_count}
            testId='session-transfer-upstream-bytes'
          />
          <Counter
            label='downstream bytes'
            value={transfer.downstream_byte_count}
            testId='session-transfer-downstream-bytes'
          />
        </div>
      ) : (
        <p role='status'>
          Counters are withheld because this transfer status is unavailable.
        </p>
      )}
    </article>
  )
}

export function SessionTransferStatusPanel({
  sessionId,
  draftSessionId,
  suggestedSessionIds,
  status,
  loading,
  onDraftSessionId,
  onSelectSession,
  onClearSession,
  onRefresh,
}: {
  sessionId: string | null
  draftSessionId: string
  suggestedSessionIds: readonly string[]
  status: SessionTransferStatusResponse | undefined
  loading: boolean
  onDraftSessionId: (value: string) => void
  onSelectSession: (sessionId: string) => void
  onClearSession: () => void
  onRefresh: () => void
}): ReactElement {
  const headPill = status
    ? statusPill(AVAILABILITY_PILL, status.availability, STATUS_PILL_FALLBACK)
    : undefined
  const message = status ? availabilityMessage(status) : null

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const next = draftSessionId.trim()
    if (!next) return
    onSelectSession(next)
  }

  return (
    <StatusPanel
      className='status-estimator-panel'
      ariaLabel='Live transfer status'
      title='Live transfer status'
      subLabel={
        sessionId
          ? `session ${sessionId}`
          : 'Select a session to read the short-lived registry'
      }
      loading={loading}
      headPill={headPill}
    >
      <form className='session-transfer-selector' onSubmit={submit}>
        <label htmlFor='session-transfer-session-id'>Session</label>
        <input
          id='session-transfer-session-id'
          name='session_id'
          value={draftSessionId}
          autoComplete='off'
          spellCheck={false}
          onChange={(event) => {
            onDraftSessionId(event.target.value)
          }}
        />
        <button type='submit'>Show live status</button>
        {sessionId ? (
          <button type='button' onClick={onClearSession}>
            Clear session
          </button>
        ) : null}
        {sessionId ? (
          <button type='button' onClick={onRefresh} disabled={loading}>
            Refresh live status
          </button>
        ) : null}
      </form>
      {suggestedSessionIds.length > 0 ? (
        <div className='session-transfer-suggestions'>
          {suggestedSessionIds.map((suggestedId) => (
            <button
              key={suggestedId}
              type='button'
              aria-pressed={suggestedId === sessionId}
              onClick={() => {
                onSelectSession(suggestedId)
              }}
            >
              {suggestedId}
            </button>
          ))}
        </div>
      ) : null}
      {!sessionId ? (
        <p className='status-estimator-empty' role='status'>
          Select a session to read live transfer status. Historical diagnostics
          do not show this short-lived status.
        </p>
      ) : null}
      {sessionId && !status && loading ? (
        <p className='status-estimator-empty' role='status'>
          Checking live transfer status…
        </p>
      ) : null}
      {message ? (
        <p
          className='status-estimator-empty'
          role='status'
          data-testid='session-transfer-availability'
        >
          {message}
        </p>
      ) : null}
      {status && status.transfers.length > 0 ? (
        <div className='status-estimator-grid'>
          {status.transfers.map((transfer, index) => (
            <TransferRecordCard
              key={transfer.litellm_call_id ?? `${transfer.phase}-${index}`}
              transfer={transfer}
            />
          ))}
        </div>
      ) : null}
      {status?.truncated ? (
        <p role='status'>Showing the newest bounded transfer records.</p>
      ) : null}
    </StatusPanel>
  )
}

export function SessionTransferStatusView({
  suggestedSessionIds = [],
  viewActive = true,
  refetchIntervalMs,
}: {
  suggestedSessionIds?: readonly string[]
  viewActive?: boolean
  refetchIntervalMs?: number | false
}): ReactElement {
  const [draftSessionId, setDraftSessionId] = useState('')
  const [sessionId, setSessionId] = useState<string | null>(null)
  const query = useQuery(
    sessionTransferStatusQueryOptions({
      sessionId,
      viewActive,
      refetchIntervalMs,
    })
  )
  const visibleStatus =
    sessionId && query.data?.selection.session_id === sessionId
      ? query.data
      : undefined

  return (
    <SessionTransferStatusPanel
      sessionId={sessionId}
      draftSessionId={draftSessionId}
      suggestedSessionIds={suggestedSessionIds}
      status={query.isError ? unavailableFallback(sessionId) : visibleStatus}
      loading={Boolean(sessionId) && query.isPending && !query.isError}
      onDraftSessionId={setDraftSessionId}
      onSelectSession={(next) => {
        setDraftSessionId(next)
        setSessionId(next)
      }}
      onClearSession={() => {
        setDraftSessionId('')
        setSessionId(null)
      }}
      onRefresh={() => {
        void query.refetch()
      }}
    />
  )
}

function unavailableFallback(
  sessionId: string | null
): SessionTransferStatusResponse | undefined {
  if (!sessionId) return undefined
  return {
    schema_version: 'session-transfer-status.v1',
    availability: 'unavailable' satisfies SessionTransferAvailability,
    reason: 'upstream_unreachable',
    retention: SESSION_TRANSFER_RETENTION,
    selection: {
      session_id: sessionId,
      codex_session_id: null,
      canonical_session_id: null,
    },
    registry: null,
    observed_at: null,
    truncated: false,
    transfers: [],
  }
}
