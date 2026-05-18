/**
 * AggregateCard — extends ProviderCard with a FLEET ACTIVITY section.
 *
 * Renders everything ProviderCard renders, plus a FLEET ACTIVITY section
 * tracking tool calls, git activity, and invalid tool calls. Optionally
 * renders a pulse-dot when recent errors are detected.
 *
 * Implementation note: fleet activity rows use a semantic `<dl>` description
 * list where each label is a `<dt>` and each value is a `<dd>`. Tests query
 * labels with `{ exact: true }` to avoid substring ambiguity between "Tool
 * Calls" and "Invalid Tool Calls".
 */
import type { ReactElement } from 'react'
import {
  ProviderCard,
  type ProviderCardConfig,
  type ProviderMetrics,
  type QuotaRowConfig,
  type AnomalyFlags,
} from './provider-card'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Fleet-level activity metrics for the aggregate card. */
export interface FleetActivity {
  toolCalls: number
  gitCommits: number
  gitPushes: number
  invalidToolCalls: number
  recentErrors?: number
}

export interface AggregateCardProps {
  config: ProviderCardConfig
  data: ProviderMetrics
  healthCells: { color: string }[]
  quotas: QuotaRowConfig[]
  fleetActivity: FleetActivity
  anomalies?: AnomalyFlags
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface FleetRowProps {
  label: string
  value: string
  className?: string
  valueStyle?: React.CSSProperties
}

/** A single fleet activity row rendered as dt/dd pair. */
function FleetRow({
  label,
  value,
  className,
  valueStyle,
}: FleetRowProps): ReactElement {
  return (
    <>
      <dt
        style={{
          fontSize: '11px',
          color: 'var(--fg-muted)',
          margin: 0,
        }}
      >
        {label}
      </dt>
      <dd
        className={className}
        style={{
          fontFamily: 'monospace',
          textAlign: 'right',
          margin: 0,
          ...valueStyle,
        }}
      >
        {value}
      </dd>
    </>
  )
}

// ---------------------------------------------------------------------------
// AggregateCard
// ---------------------------------------------------------------------------

/**
 * AggregateCard renders a ProviderCard plus a FLEET ACTIVITY section showing
 * tool call and git activity metrics, with accent-hot highlighting for invalid
 * tool calls and an animated pulse-dot when recent errors are present.
 */
export function AggregateCard({
  config,
  data,
  healthCells,
  quotas,
  fleetActivity,
  anomalies,
}: AggregateCardProps): ReactElement {
  const hasRecentErrors =
    typeof fleetActivity.recentErrors === 'number' &&
    fleetActivity.recentErrors > 0

  const invalidHot = fleetActivity.invalidToolCalls > 0

  return (
    <div>
      {/* Pulse dot — only when there are recent errors */}
      {hasRecentErrors && (
        <div
          className='pulse-dot'
          aria-label='recent errors detected'
          style={{
            width: '8px',
            height: '8px',
            borderRadius: '50%',
            background: 'var(--accent-hot)',
            marginBottom: '4px',
          }}
        />
      )}

      {/* Provider card (base card) */}
      <ProviderCard
        config={config}
        data={data}
        healthCells={healthCells}
        quotas={quotas}
        anomalies={anomalies}
      />

      {/* FLEET ACTIVITY section */}
      <div
        style={{
          background: 'var(--card)',
          border: '1px solid var(--border)',
          borderTop: 'none',
          borderRadius: 0,
          padding: '8px 12px 12px',
        }}
      >
        {/* Section header */}
        <div
          style={{
            fontSize: '9px',
            fontWeight: 700,
            letterSpacing: '0.08em',
            color: 'var(--fg-muted)',
            marginBottom: '4px',
          }}
        >
          FLEET ACTIVITY
        </div>

        {/*
         * Semantic <dl> description list for screen-reader accessibility.
         * Each row is a <dt> (label) + <dd> (value) pair laid out with CSS
         * grid. Tests use exact-match queries (`{ exact: true }`) to avoid
         * ambiguity between "Tool Calls" and "Invalid Tool Calls".
         */}
        <dl
          style={{
            display: 'grid',
            gridTemplateColumns: '1fr auto',
            rowGap: '2px',
            margin: 0,
          }}
        >
          <FleetRow
            label='Tool Calls'
            value={fleetActivity.toolCalls.toLocaleString()}
          />
          <FleetRow
            label='Git Commits'
            value={fleetActivity.gitCommits.toLocaleString()}
          />
          <FleetRow
            label='Git Pushes'
            value={fleetActivity.gitPushes.toLocaleString()}
          />
          <FleetRow
            label='Invalid Tool Calls'
            value={fleetActivity.invalidToolCalls.toLocaleString()}
            className={invalidHot ? 'accent-hot' : undefined}
            valueStyle={{
              color: invalidHot ? '#ef4444' : 'var(--fg)',
            }}
          />
        </dl>
      </div>
    </div>
  )
}
