/**
 * ProviderCard — per-provider metrics card for Phosphor Atlas dashboard.
 *
 * Wave 11 (S2-21/S2-22): orchestration shell; types, helpers, quota tooltip,
 * QuotaBarRow, and section UI live in sibling modules.
 */
import { memo, type ReactElement, type ReactNode } from 'react'
import type { UsageReportLocalHealthRow } from '../api/usage-report'
import { HealthStrip } from './primitives/health-strip'
import {
  ProviderCardMetricsBody,
  ProviderCardTopModelsPane,
} from './provider-card-sections'
import type {
  AnomalyFlags,
  ProviderCardConfig,
  ProviderMetrics,
  QuotaBarGroup,
  QuotaLane,
  TopModelRow,
} from './provider-card-types'

export type {
  AnomalyFlags,
  ProviderCardConfig,
  ProviderMetrics,
  QuotaBarGroup,
  QuotaLane,
  QuotaRowConfig,
  QuotaTipModel,
  TopModelRow,
} from './provider-card-types'

export interface ProviderCardProps {
  config: ProviderCardConfig
  data: ProviderMetrics
  healthCells: { color: string }[]
  /** Wave 11 PR3 (11-i): each entry is one quota-type bar with 100 segments. */
  quotas?: QuotaBarGroup[]
  /**
   * Wave 41 multi-reset redesign: structured lane data for the quota section.
   * When provided, `lanes` takes precedence over `quotas` for rendering.
   */
  lanes?: QuotaLane[]
  anomalies?: AnomalyFlags
  /** Per-model mini-table rows shown in card-pane-right at ≥3840px. */
  topModels?: TopModelRow[]
  /** Local infrastructure and model health chips shown only on the Local card. */
  localHealthItems?: UsageReportLocalHealthRow[]
  /**
   * Additional class name(s) merged into the root `provider-card` div.
   * Used by AggregateCard to add the `aggregate` class for CSS targeting.
   */
  wrapperClassName?: string
  /** Type-safe aggregate styling (preferred over parsing wrapperClassName). */
  variant?: 'aggregate'
  /**
   * Optional content rendered at the end of `card-pane-left`, after the
   * REASONING sub-section. Used by AggregateCard to inject FLEET ACTIVITY
   * inside the standard card layout flow.
   */
  extraPaneLeft?: ReactNode
}

function ProviderCardInner({
  config,
  data,
  healthCells,
  quotas = [],
  lanes,
  anomalies,
  topModels = [],
  localHealthItems = [],
  wrapperClassName,
  variant,
  extraPaneLeft,
}: ProviderCardProps): ReactElement {
  const isAggregateVariant =
    variant === 'aggregate' ||
    (wrapperClassName !== undefined &&
      wrapperClassName.split(/\s+/).includes('aggregate'))

  const rootClassName = [
    'provider-card',
    variant === 'aggregate' ? 'aggregate' : undefined,
    wrapperClassName,
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <div
      className={rootClassName}
      style={{
        background: 'var(--card)',
        border: '1px solid var(--border)',
        borderRadius: 0,
        padding: '10px',
        paddingRight: '22px',
        maxWidth: '460px',
        width: '100%',
        display: 'flex',
        flexDirection: 'column',
        position: 'relative',
        fontSize: 'clamp(10px, 0.55vw, 14px)',
      }}
    >
      <HealthStrip cells={healthCells} orientation='vertical' />

      <div
        className='provider-name'
        style={{
          ...(!isAggregateVariant && {
            color: 'var(--accent-chrome)',
          }),
          fontWeight: 600,
          textTransform: 'uppercase',
          marginBottom: '6px',
          borderBottom: '1px solid var(--border)',
          paddingBottom: '4px',
          letterSpacing: '0.05em',
        }}
      >
        <span>{config.provider.toUpperCase()}</span>
      </div>

      <ProviderCardMetricsBody
        config={config}
        data={data}
        localHealthItems={localHealthItems}
        quotas={quotas}
        lanes={lanes}
        anomalies={anomalies}
        extraPaneLeft={extraPaneLeft}
      />

      {topModels.length > 0 && (
        <ProviderCardTopModelsPane
          topModels={topModels}
          errorCount={data.errors}
        />
      )}
    </div>
  )
}

export const ProviderCard = memo(ProviderCardInner)
