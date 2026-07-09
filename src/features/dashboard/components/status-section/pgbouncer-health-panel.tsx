import type { ReactElement } from 'react'
import type {
  ShellPgBouncerHealth,
  ShellPgBouncerSidecar,
} from '../../api/usage-report'
import { formatCompactQuantity } from '../../lib/status-formatters'
import { STATUS_PILL_FALLBACK, StatusPanel, statusPill } from './section-chrome'

const PGBOUNCER_STATUS_PILL = {
  green: { label: 'ok', className: 'is-healthy' },
  yellow: { label: 'degraded', className: 'is-warn' },
  red: { label: 'down', className: 'is-bad' },
} as const

function pgBouncerSidecarPill(status: string | undefined): {
  label: string
  className: string
} {
  return statusPill(PGBOUNCER_STATUS_PILL, status, STATUS_PILL_FALLBACK)
}

function formatPgBouncerWait(seconds: number, microseconds: number): string {
  if (seconds > 0) return `${seconds.toFixed(seconds >= 10 ? 0 : 1)}s`
  if (microseconds > 0) return `${Math.round(microseconds).toLocaleString()}us`
  return '0s'
}

function formatPgBouncerBytes(value: number): string {
  if (value >= 1_000_000_000) return `${(value / 1_000_000_000).toFixed(1)}GB`
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}MB`
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}KB`
  return `${Math.round(value).toString()}B`
}

function PgBouncerSidecarCard({
  sidecar,
}: {
  sidecar: ShellPgBouncerSidecar
}): ReactElement {
  const logConfig = sidecar.container.logConfig
  const pool = sidecar.admin.poolSummary
  const stats = sidecar.admin.statsSummary
  const servers = sidecar.admin.serverSummary
  const poolRows = sidecar.admin.pools.slice(0, 3)
  const statusKey = String(sidecar.status)
  const pill = pgBouncerSidecarPill(statusKey)

  return (
    <article className={`pgbouncer-card ${pill.className}`}>
      <div className='pgbouncer-card-head'>
        <div>
          <span className='pgbouncer-card-name'>{sidecar.label}</span>
          <span className='pgbouncer-card-sub'>{sidecar.containerName}</span>
        </div>
        <span className={`status-pill ${pill.className}`}>{pill.label}</span>
      </div>
      <div className='pgbouncer-metrics'>
        <span>
          clients <strong>{pool.clActive}</strong>/
          <strong>{pool.clWaiting}</strong>
        </span>
        <span>
          servers <strong>{pool.svActive}</strong>/
          <strong>{pool.svIdle}</strong>
        </span>
        <span>
          max wait{' '}
          <strong>
            {formatPgBouncerWait(pool.maxWaitSeconds, pool.maxWaitMicroseconds)}
          </strong>
        </span>
        <span>
          upstream <strong>{servers.total}</strong>
        </span>
      </div>
      <div className='pgbouncer-detail-grid'>
        <span>container</span>
        <strong>
          {sidecar.container.status ??
            (sidecar.container.present ? 'unknown' : 'missing')}
        </strong>
        <span>health</span>
        <strong>
          {sidecar.container.health === 'healthy'
            ? 'pass'
            : (sidecar.container.health ?? 'unknown')}
        </strong>
        <span>admin</span>
        <strong>
          {sidecar.admin.status === 'ok' ? 'reachable' : sidecar.admin.status}
        </strong>
        <span>traffic</span>
        <strong>
          {formatCompactQuantity(stats.totalXactCount)} tx /{' '}
          {formatCompactQuantity(stats.totalQueryCount)} q
        </strong>
        <span>bytes</span>
        <strong>
          {formatPgBouncerBytes(stats.totalReceived)} in /{' '}
          {formatPgBouncerBytes(stats.totalSent)} out
        </strong>
        <span>logs</span>
        <strong>
          {logConfig
            ? `${logConfig.type ?? 'n/a'} ${logConfig.maxSize ?? '?'} x${
                logConfig.maxFile ?? '?'
              }`
            : 'n/a'}
        </strong>
      </div>
      {poolRows.length > 0 ? (
        <div className='pgbouncer-pools' aria-label={`${sidecar.label} pools`}>
          {poolRows.map((row) => (
            <div
              className='pgbouncer-pool-row'
              key={`${sidecar.key}-${row.database}-${row.user}`}
            >
              <span>{row.database ?? 'unknown'}</span>
              <span>
                c {row.clActive}/{row.clWaiting} | s {row.svActive}/{row.svIdle}
              </span>
              <span>{row.poolMode ?? 'unknown'}</span>
            </div>
          ))}
        </div>
      ) : (
        <div className='pgbouncer-empty'>
          {sidecar.admin.error ?? sidecar.container.error ?? 'no pool rows'}
        </div>
      )}
    </article>
  )
}

export function PgBouncerHealthPanel({
  health,
  loading,
}: {
  health?: ShellPgBouncerHealth
  loading: boolean
}): ReactElement {
  const sidecars = health?.sidecars ?? []
  const headStatus = health?.status

  return (
    <StatusPanel
      className='pgbouncer-health-panel'
      ariaLabel='PgBouncer health'
      title='PgBouncer'
      subLabel={loading || headStatus == null ? undefined : String(headStatus)}
      loading={loading}
    >
      <div className='pgbouncer-grid'>
        {sidecars.length > 0 ? (
          sidecars.map((sidecar) => (
            <PgBouncerSidecarCard key={sidecar.key} sidecar={sidecar} />
          ))
        ) : (
          <div className='pgbouncer-empty'>no sidecars reported</div>
        )}
      </div>
    </StatusPanel>
  )
}
