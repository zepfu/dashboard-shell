import type { ReactElement } from 'react'
import {
  SESSION_DIAGNOSTICS_STREAM_RECOVERY_KEYS,
  classifyRecordedStreamCompleteness,
  recordedStreamCompletenessLabel,
  sessionDiagnosticsStreamDisplayEntries,
  sessionDiagnosticsStreamWasRecorded,
  type UsageReportSessionDiagnosticsStream,
} from './session-diagnostics-stream'

const RECOVERY_KEYS = new Set<string>(SESSION_DIAGNOSTICS_STREAM_RECOVERY_KEYS)

function StreamScalarGrid({
  entries,
}: {
  entries: Array<{ key: string; value: string }>
}): ReactElement | null {
  if (entries.length === 0) return null
  return (
    <div className='status-estimator-meta-grid'>
      {entries.map((entry) => (
        <span key={entry.key}>
          {entry.key} <strong>{entry.value}</strong>
        </span>
      ))}
    </div>
  )
}

export function SessionDiagnosticsStreamBlock({
  stream,
  diagnosticFlags,
}: {
  stream: UsageReportSessionDiagnosticsStream | null | undefined
  diagnosticFlags: readonly string[] | null | undefined
}): ReactElement | null {
  if (!sessionDiagnosticsStreamWasRecorded(stream, diagnosticFlags)) {
    return null
  }

  const entries = sessionDiagnosticsStreamDisplayEntries(stream)
  const recoveryEntries = entries.filter((entry) =>
    RECOVERY_KEYS.has(entry.key)
  )
  const scalarEntries = entries.filter((entry) => !RECOVERY_KEYS.has(entry.key))
  const kind = classifyRecordedStreamCompleteness(stream)

  return (
    <div
      className='status-estimator-block'
      data-testid='recorded-stream-completeness'
    >
      <strong>Recorded stream completeness</strong>
      <span className='status-estimator-muted'>
        Stored on this session history row. These fields describe recorded
        stream completeness. Calls that were not written to session history are
        not represented here, and this record does not mean every stream failed.
      </span>
      <span>{recordedStreamCompletenessLabel(kind)}</span>
      {entries.length === 0 ? (
        <span className='status-estimator-muted'>
          Selected stream scalars were not recorded on this row.
        </span>
      ) : null}
      <StreamScalarGrid entries={scalarEntries} />
      {recoveryEntries.length > 0 ? (
        <>
          <strong>Recorded recovery outcome</strong>
          <span className='status-estimator-muted'>
            Recorded outcome and linkage on this session history row. This is
            not proof that a hidden retry ran.
          </span>
          <StreamScalarGrid entries={recoveryEntries} />
        </>
      ) : null}
    </div>
  )
}
