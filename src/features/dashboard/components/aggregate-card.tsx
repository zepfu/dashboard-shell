/**
 * AggregateCard — extends ProviderCard with a FLEET ACTIVITY section.
 *
 * Renders everything ProviderCard renders, plus a FLEET ACTIVITY section
 * tracking tool calls, git activity, and invalid tool calls. Renders an
 * inline pulse-dot inside the "Invalid Tool Calls" label when
 * `invalidToolCalls > 0` (mockup L2766).
 *
 * Wave 11 PR2 (11-e):
 * - Adds `aggregate` class to the card wrapper via ProviderCard.wrapperClassName
 *   so `.provider-card.aggregate` CSS rules apply (dashed amber border, hidden
 *   below 2100px viewport width).
 * - FLEET ACTIVITY moved inside card-pane-left using the pc-sub-title /
 *   pc-mini-table pattern consistent with TOKEN CACHE and REASONING sections.
 *
 * Wave 14-D:
 * - 14-D.1: Fleet activity refactored to 3-column grid (label | value | sublabel)
 *   per mockup spec (lines 1101-1135). CSS class `fleet-activity-list` /
 *   `fleet-activity-row` added to index.css Wave 14-D block.
 * - 14-D.2: Aggregate health cells gain `filter: saturate(0.95) brightness(1.02)`
 *   tint via `.provider-card.aggregate .health-strip-cell` CSS rule.
 *
 * Wave 25 (25-AggregatePulse):
 * - Pulse-dot moved inline inside the "Invalid Tool Calls" label per mockup L2766.
 *   Trigger changed from `recentErrors > 0` to `invalidToolCalls > 0`.
 *
 * Implementation note: fleet activity rows use a semantic `<dl>` description
 * list where each label is a `<dt>` and each value+sublabel are `<dd>` elements.
 * Tests query labels with `{ exact: true }` to avoid substring ambiguity between
 * "Tool Calls" and "Invalid Tool Calls".
 */
import type { ReactElement, ReactNode } from 'react'
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
  /** Optional sublabel (e.g. "+12% vs prior", "3.2/min"). Rendered in third column. */
  sublabel?: string
  /** When true, value is rendered in accent-hot (red) color and row gets `.invalid` class. */
  hot?: boolean
  /**
   * Optional glyph rendered inside the label `<dt>` before the text.
   * Used by the "Invalid Tool Calls" row to embed the pulse-dot inline per
   * mockup L2766: `<span class="pulse-dot" aria-hidden="true"></span>`.
   */
  inlineGlyph?: ReactNode
}

/**
 * A single fleet activity row rendered as dt + dd (value) + dd (sublabel).
 * Uses `display: contents` so all three cells flow into the parent grid's
 * three columns: `minmax(0, 1fr) 64px auto`.
 */
function FleetRow({
  label,
  value,
  sublabel,
  hot = false,
  inlineGlyph,
}: FleetRowProps): ReactElement {
  const rowClass = hot ? 'fleet-activity-row invalid' : 'fleet-activity-row'
  const valClass = hot ? 'value accent-hot' : 'value'
  return (
    <div className={rowClass}>
      <dt className='label'>
        {inlineGlyph}
        {label}
      </dt>
      <dd className={valClass}>{value}</dd>
      <dd className='sublabel'>
        {/* TODO: populate with real "vs prior" / rate / status data when available */}
        {sublabel ?? ''}
      </dd>
    </div>
  )
}

// ---------------------------------------------------------------------------
// AggregateCard
// ---------------------------------------------------------------------------

/**
 * AggregateCard renders a ProviderCard with:
 *  - `aggregate` wrapper class (dashed amber border via CSS, hidden <2100px)
 *  - FLEET ACTIVITY sub-section inside card-pane-left (pc-sub-title pattern)
 *  - Inline pulse-dot inside the "invalid tool calls" label when `invalidToolCalls > 0`
 *    (mockup L2766; trigger is `invalidToolCalls > 0`, not `recentErrors > 0`)
 */
export function AggregateCard({
  config,
  data,
  healthCells,
  quotas,
  fleetActivity,
  anomalies,
}: AggregateCardProps): ReactElement {
  const invalidHot = fleetActivity.invalidToolCalls > 0

  // Fleet activity content rendered inside card-pane-left via extraPaneLeft
  // slot — mirrors the pc-sub-title / pc-mini-table pattern used for TOKEN
  // CACHE and REASONING sections in ProviderCard.
  const fleetActivitySection = (
    <>
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
       * 3-column grid per mockup lines 1101-1135:
       *   col 1: label (minmax(0, 1fr)) — muted, mono, 10px
       *   col 2: value (64px) — right-aligned, fg color; accent-hot when invalid
       *   col 3: sublabel (auto) — muted, 9px, lowercase, right-aligned
       *
       * Each <div class="fleet-activity-row"> uses `display: contents` so its
       * dt/dd children flow directly into the grid columns.
       *
       * Tests use exact-match queries (`{ exact: true }`) to avoid ambiguity
       * between "Tool Calls" and "Invalid Tool Calls".
       */}
      <dl className='fleet-activity-list'>
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
          label='invalid tool calls'
          value={fleetActivity.invalidToolCalls.toLocaleString()}
          hot={invalidHot}
          inlineGlyph={
            invalidHot ? (
              <span
                className='pulse-dot'
                aria-label='invalid tool calls detected'
                style={{
                  display: 'inline-block',
                  width: '6px',
                  height: '6px',
                  borderRadius: '50%',
                  background: 'var(--accent-hot)',
                  boxShadow: '0 0 4px rgba(239, 68, 68, 0.7)',
                  marginRight: '4px',
                  verticalAlign: 'middle',
                }}
              />
            ) : undefined
          }
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
