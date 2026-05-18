/**
 * AggregateCard — extends ProviderCard with a FLEET ACTIVITY section.
 *
 * Renders everything ProviderCard renders, plus a FLEET ACTIVITY section
 * tracking tool calls, git activity, and invalid tool calls. Optionally
 * renders a pulse-dot when recent errors are detected.
 *
 * Wave 11 PR2 (11-e):
 * - Adds `aggregate` class to the card wrapper via ProviderCard.wrapperClassName
 *   so `.provider-card.aggregate` CSS rules apply (dashed amber border, hidden
 *   below 2100px viewport width).
 * - FLEET ACTIVITY moved inside card-pane-left using the pc-sub-title /
 *   pc-mini-table pattern consistent with TOKEN CACHE and REASONING sections.
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
  type QuotaBarGroup,
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
  /** Wave 11 PR3 (11-i): each entry is one quota-type bar with 12 segments. */
  quotas: QuotaBarGroup[]
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
 * AggregateCard renders a ProviderCard with:
 *  - `aggregate` wrapper class (dashed amber border via CSS, hidden <2100px)
 *  - FLEET ACTIVITY sub-section inside card-pane-left (pc-sub-title pattern)
 *  - Animated pulse-dot when recent errors are present
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

  // Fleet activity content rendered inside card-pane-left via extraPaneLeft
  // slot — mirrors the pc-sub-title / pc-mini-table pattern used for TOKEN
  // CACHE and REASONING sections in ProviderCard.
  const fleetActivitySection = (
    <>
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

      {/* FLEET ACTIVITY sub-section header — pc-sub-title pattern */}
      <h4
        className='pc-sub-title'
        style={{
          fontFamily: 'var(--font-mono)',
          fontSize: '10px',
          color: 'var(--accent-chrome)',
          textTransform: 'uppercase',
          letterSpacing: '0.1em',
          marginTop: '6px',
          marginBottom: '3px',
          paddingTop: '4px',
          borderTop: '1px dashed var(--border)',
          fontWeight: 600,
        }}
      >
        FLEET ACTIVITY
      </h4>

      {/*
       * Semantic <dl> description list for screen-reader accessibility.
       * Each row is a <dt> (label) + <dd> (value) pair laid out with CSS
       * grid. Tests use exact-match queries (`{ exact: true }`) to avoid
       * ambiguity between "Tool Calls" and "Invalid Tool Calls".
       */}
      <dl
        className='pc-mini-table'
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
    </>
  )

  return (
    <ProviderCard
      config={config}
      data={data}
      healthCells={healthCells}
      quotas={quotas}
      anomalies={anomalies}
      wrapperClassName='aggregate'
      extraPaneLeft={fleetActivitySection}
    />
  )
}
