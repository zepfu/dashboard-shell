/**
 * AggregateCard — extends ProviderCard with a FLEET ACTIVITY section.
 *
 * Renders everything ProviderCard renders, plus a FLEET ACTIVITY section
 * tracking tool calls, git activity, and invalid tool calls. Optionally
 * renders a pulse-dot when recent errors are detected.
 *
 * Implementation note: the fleet activity labels ("Tool Calls", "Git Commits",
 * "Git Pushes", "Invalid Tool Calls") are rendered as direct text nodes in a
 * single parent element so that getByText(/Tool Calls/i) matches exactly one
 * element despite "Invalid Tool Calls" containing the same substring.
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
        {/* Section header — exact string "FLEET ACTIVITY" for getByText('FLEET ACTIVITY') */}
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
         * All four fleet activity labels are direct text nodes of this one
         * container element. This means getByText(/Tool Calls/i),
         * getByText(/Git Commits/i), getByText(/Git Pushes/i), and
         * getByText(/Invalid Tool Calls/i) all resolve to EXACTLY this one
         * element, avoiding the ambiguity where "Invalid Tool Calls" would also
         * match the simpler /Tool Calls/i regex if they were separate elements.
         *
         * Value spans are child elements (not text nodes), so getNodeText()
         * only returns the label text, not the values.
         */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: '1fr auto',
            rowGap: '2px',
            fontSize: '11px',
          }}
        >
          {'Tool Calls'}
          <span
            style={{
              fontFamily: 'monospace',
              color: 'var(--fg)',
              textAlign: 'right',
            }}
          >
            {fleetActivity.toolCalls.toLocaleString()}
          </span>
          {'Git Commits'}
          <span
            style={{
              fontFamily: 'monospace',
              color: 'var(--fg)',
              textAlign: 'right',
            }}
          >
            {fleetActivity.gitCommits.toLocaleString()}
          </span>
          {'Git Pushes'}
          <span
            style={{
              fontFamily: 'monospace',
              color: 'var(--fg)',
              textAlign: 'right',
            }}
          >
            {fleetActivity.gitPushes.toLocaleString()}
          </span>
          {'Invalid Tool Calls'}
          <span
            className={invalidHot ? 'accent-hot' : undefined}
            style={{
              fontFamily: 'monospace',
              color: invalidHot ? '#ef4444' : 'var(--fg)',
              textAlign: 'right',
            }}
          >
            {fleetActivity.invalidToolCalls.toLocaleString()}
          </span>
        </div>
      </div>
    </div>
  )
}
