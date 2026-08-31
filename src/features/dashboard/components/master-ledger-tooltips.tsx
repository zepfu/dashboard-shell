/**
 * Master ledger hover tooltips and score/latency cell renderers (W11 split).
 */
import { type ReactElement } from 'react'
import {
  AGENT_QUALITY_PASS_FAMILY_KEYS,
  agentQualitySeverityMetrics,
  type AgentQualityFamilyKey,
  type AgentQualityFamilySummary,
  type AgentQualitySummary,
} from '../lib/agent-quality'
import { numFmt } from '../lib/format-utils'
import { formatLatency } from '../lib/usage-report-display'
import type { ModelLatencySummary } from './master-ledger-aggregation'
import { HoverTooltip } from './primitives/hover-tooltip'

const AGENT_FAMILY_LABELS: Record<AgentQualityFamilyKey, string> = {
  quality: 'Quality',
  instruction: 'Instruction',
  tool: 'Tool',
  contract: 'Contract',
  progress: 'Progress',
  risk: 'Risk',
  discoveryInventoryCoverage: 'Discovery inventory',
  terminalCompletion: 'Terminal completion',
}

function formatAgentPercent(score: number | null): string {
  return score === null ? '--' : `${Math.round(score * 100).toString()}%`
}

function humanizeReasonCode(value: string): string {
  return value
    .replace(/[:/_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, (match) => match.toUpperCase())
}

function agentFamilyColor(
  family: AgentQualityFamilyKey,
  summary: AgentQualityFamilySummary
): string {
  if (summary.score === null) return 'var(--fg-muted, #64748b)'
  if (family === 'risk') {
    if (summary.score >= 0.1) return 'var(--accent-hot, #ef4444)'
    if (summary.score > 0) return 'var(--accent-warm, #f59e0b)'
    return 'var(--accent-teal, #14b8a6)'
  }
  if (summary.score < 0.9) return 'var(--accent-hot, #ef4444)'
  if (summary.score < 0.98) return 'var(--accent-warm, #f59e0b)'
  return 'var(--accent-teal, #14b8a6)'
}

function formatCoverage(summary: AgentQualityFamilySummary): string {
  const coverage =
    summary.possible > 0 ? (summary.evaluated / summary.possible) * 100 : 0
  return `${numFmt(summary.evaluated)} / ${numFmt(summary.possible)} checks (${numFmt(coverage, 0)}%)`
}

function formatSignalRate(count: number, evaluated: number): string {
  if (evaluated <= 0) return `${numFmt(count)} / --`
  return `${numFmt(count)} / ${numFmt(evaluated)} (${numFmt((count / evaluated) * 100, 0)}%)`
}

interface AgentQualityDisplaySummary {
  label: string
  color: string
  state: 'review' | 'watch' | 'healthy' | 'unscored'
}

const AGENT_NO_DATA_COLOR = 'var(--accent-cool, #38bdf8)'

function summarizeAgentQuality(
  summary: AgentQualitySummary
): AgentQualityDisplaySummary {
  const passFamilies = AGENT_QUALITY_PASS_FAMILY_KEYS
  const discovery = summary.discoveryInventoryCoverage
  const terminal = summary.terminalCompletion
  const severity = agentQualitySeverityMetrics(summary)
  const worstPassScore = severity.displayWorstPassScore
  const evaluated = passFamilies.reduce(
    (sum, family) => sum + summary[family].evaluated,
    0
  )
  const possible = passFamilies.reduce(
    (sum, family) => sum + summary[family].possible,
    0
  )
  const coveragePct = possible > 0 ? (evaluated / possible) * 100 : null
  const riskScore = severity.riskScore
  const handoffIncidentCount = severity.handoffIssueCount
  const issueCount = severity.totalIssueCount

  if (
    summary.destructiveCheckoutFailures > 0 ||
    summary.emptyCompletionFailures > 0 ||
    discovery.issueCount > 0 ||
    summary.discoveryInventoryMissingCount > 0 ||
    terminal.issueCount > 0 ||
    handoffIncidentCount > 0 ||
    riskScore >= 0.1 ||
    (worstPassScore !== null && worstPassScore < 0.9)
  ) {
    return {
      label: 'Review',
      color: 'var(--accent-hot, #ef4444)',
      state: 'review',
    }
  }

  if (
    issueCount > 0 ||
    riskScore > 0 ||
    (worstPassScore !== null && worstPassScore < 0.98) ||
    (coveragePct !== null && coveragePct < 20)
  ) {
    return {
      label:
        coveragePct !== null && coveragePct < 20 && issueCount === 0
          ? 'Low cov'
          : 'Watch',
      color: 'var(--accent-warm, #f59e0b)',
      state: 'watch',
    }
  }

  return {
    label: worstPassScore === null ? 'Unscored' : 'Healthy',
    color:
      worstPassScore === null
        ? AGENT_NO_DATA_COLOR
        : 'var(--accent-teal, #14b8a6)',
    state: worstPassScore === null ? 'unscored' : 'healthy',
  }
}

function renderAgentQualityTooltip(summary: AgentQualitySummary): ReactElement {
  const families: AgentQualityFamilyKey[] = [
    'quality',
    'instruction',
    'tool',
    'contract',
    'progress',
    'risk',
    'discoveryInventoryCoverage',
    'terminalCompletion',
  ]
  const flags = [
    ['Empty completions', summary.emptyCompletionFailures],
    ['Invalid tool calls', summary.invalidToolCallErrors],
    ['Destructive checkout', summary.destructiveCheckoutFailures],
    ['Large payload risk', summary.largePayloadRisks],
    ['Read-only violations', summary.readOnlyPolicyViolations],
  ] as const
  const visibleFlags = flags.filter(([, count]) => count > 0)
  const ignoredPath = summary.ignoredPathTracking ?? {
    score: null,
    evaluated: 0,
    possible: 0,
    violationCount: 0,
  }
  const baseline = summary.baselineDeflection ?? {
    attemptedScore: null,
    attemptedEvaluated: 0,
    attemptedIncidents: 0,
    incidentScore: null,
    incidentEvaluated: 0,
    incidentIncidents: 0,
    attemptCount: 0,
    toolCallCount: 0,
    inputTokens: 0,
    elapsedMs: 0,
    qualityGateTriggerCount: 0,
    qualityGateFixAttemptCount: 0,
    qualityGateRerunCount: 0,
  }
  const sleep = summary.sleepWellnessInterruption ?? {
    attemptedScore: null,
    attemptedEvaluated: 0,
    attemptedIncidents: 0,
    incidentScore: null,
    incidentEvaluated: 0,
    incidentIncidents: 0,
    interruptionCount: 0,
    outputTokens: 0,
    inputTokens: 0,
    elapsedMs: 0,
    afterUserPushbackCount: 0,
    repeatedCount: 0,
  }
  const discovery = summary.discoveryInventoryCoverage
  const terminal = summary.terminalCompletion
  // Keep older summary objects renderable while compactSummary rolls out.
  const compact = summary.compactSummary ?? {
    eventCount: 0,
    threadCount: 0,
    idCount: 0,
    resumeContextCount: 0,
    verifyContextCount: 0,
    sourceCounts: {},
  }
  const compactSources = Object.entries(compact.sourceCounts)
    .filter(([, count]) => count > 0)
    .sort(
      (left, right) => right[1] - left[1] || left[0].localeCompare(right[0])
    )
  const hasBehaviorSignals =
    ignoredPath.evaluated > 0 ||
    ignoredPath.violationCount > 0 ||
    baseline.attemptedEvaluated > 0 ||
    baseline.incidentEvaluated > 0 ||
    baseline.attemptCount > 0 ||
    sleep.attemptedEvaluated > 0 ||
    sleep.incidentEvaluated > 0 ||
    sleep.interruptionCount > 0 ||
    discovery.evaluated > 0 ||
    summary.discoveryInventoryMissingCount > 0 ||
    terminal.evaluated > 0 ||
    compact.eventCount > 0 ||
    compact.resumeContextCount > 0 ||
    compact.verifyContextCount > 0

  return (
    <div style={{ minWidth: '260px' }}>
      <div className='v9-tip-head' style={{ marginBottom: '4px' }}>
        Agent health
      </div>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'auto auto',
          columnGap: '12px',
          rowGap: '2px',
          fontSize: '9px',
        }}
      >
        {families.map((family) => {
          const item = summary[family]
          const issueLabel = family === 'risk' ? 'risk' : 'fail'
          return (
            <div
              key={family}
              style={{
                display: 'contents',
                color: 'var(--fg, #e2e8f0)',
              }}
            >
              <span style={{ color: agentFamilyColor(family, item) }}>
                {AGENT_FAMILY_LABELS[family]} {formatAgentPercent(item.score)}
              </span>
              <span style={{ color: 'var(--fg-muted, #94a3b8)' }}>
                {formatCoverage(item)} · {numFmt(item.issueCount)} {issueLabel}
              </span>
            </div>
          )
        })}
      </div>
      {visibleFlags.length > 0 ? (
        <>
          <div className='v9-tip-head' style={{ margin: '6px 0 2px' }}>
            Failure flags
          </div>
          {visibleFlags.map(([label, count]) => (
            <div
              key={label}
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                gap: '8px',
                fontSize: '9px',
                color: 'var(--fg, #e2e8f0)',
              }}
            >
              <span>{label}</span>
              <span>{numFmt(count)}</span>
            </div>
          ))}
        </>
      ) : null}
      {hasBehaviorSignals ? (
        <>
          <div className='v9-tip-head' style={{ margin: '6px 0 2px' }}>
            Handoff signals
          </div>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'auto auto',
              columnGap: '12px',
              rowGap: '2px',
              fontSize: '9px',
            }}
          >
            <span style={{ color: 'var(--fg, #e2e8f0)' }}>Ignored paths</span>
            <span style={{ color: 'var(--fg-muted, #94a3b8)' }}>
              {formatAgentPercent(ignoredPath.score)} ·{' '}
              {formatSignalRate(
                ignoredPath.violationCount,
                ignoredPath.evaluated
              )}
            </span>
            <span style={{ color: 'var(--fg, #e2e8f0)' }}>
              Baseline attempted
            </span>
            <span style={{ color: 'var(--fg-muted, #94a3b8)' }}>
              {formatSignalRate(
                baseline.attemptedIncidents,
                baseline.attemptedEvaluated
              )}
            </span>
            <span style={{ color: 'var(--fg, #e2e8f0)' }}>
              Baseline incident
            </span>
            <span style={{ color: 'var(--fg-muted, #94a3b8)' }}>
              {formatSignalRate(
                baseline.incidentIncidents,
                baseline.incidentEvaluated
              )}
            </span>
            <span style={{ color: 'var(--fg, #e2e8f0)' }}>Gate path</span>
            <span style={{ color: 'var(--fg-muted, #94a3b8)' }}>
              {numFmt(baseline.qualityGateTriggerCount)} triggers ·{' '}
              {numFmt(baseline.qualityGateFixAttemptCount)} fixes ·{' '}
              {numFmt(baseline.qualityGateRerunCount)} reruns
            </span>
            <span style={{ color: 'var(--fg, #e2e8f0)' }}>Sleep attempted</span>
            <span style={{ color: 'var(--fg-muted, #94a3b8)' }}>
              {formatSignalRate(
                sleep.attemptedIncidents,
                sleep.attemptedEvaluated
              )}
            </span>
            <span style={{ color: 'var(--fg, #e2e8f0)' }}>Sleep incident</span>
            <span style={{ color: 'var(--fg-muted, #94a3b8)' }}>
              {formatSignalRate(
                sleep.incidentIncidents,
                sleep.incidentEvaluated
              )}
            </span>
            <span style={{ color: 'var(--fg, #e2e8f0)' }}>Sleep severity</span>
            <span style={{ color: 'var(--fg-muted, #94a3b8)' }}>
              {numFmt(sleep.afterUserPushbackCount)} after pushback ·{' '}
              {numFmt(sleep.repeatedCount)} repeated
            </span>
            <span style={{ color: 'var(--fg, #e2e8f0)' }}>
              Discovery inventory
            </span>
            <span style={{ color: 'var(--fg-muted, #94a3b8)' }}>
              {formatAgentPercent(discovery.score)} ·{' '}
              {formatSignalRate(discovery.issueCount, discovery.evaluated)} ·{' '}
              {numFmt(summary.discoveryInventoryMissingCount)} missing
            </span>
            <span style={{ color: 'var(--fg, #e2e8f0)' }}>
              Terminal completion
            </span>
            <span style={{ color: 'var(--fg-muted, #94a3b8)' }}>
              {formatAgentPercent(terminal.score)} ·{' '}
              {formatSignalRate(terminal.issueCount, terminal.evaluated)}
            </span>
            <span style={{ color: 'var(--fg, #e2e8f0)' }}>
              Compact summaries
            </span>
            <span style={{ color: 'var(--fg-muted, #94a3b8)' }}>
              {numFmt(compact.eventCount)} events ·{' '}
              {numFmt(compact.threadCount)} threads
              {compact.resumeContextCount > 0 || compact.verifyContextCount > 0
                ? ` · ${numFmt(compact.resumeContextCount)} resume · ${numFmt(compact.verifyContextCount)} verify`
                : ''}
            </span>
            {compactSources.length > 0 ? (
              <>
                <span style={{ color: 'var(--fg, #e2e8f0)' }}>
                  Compact sources
                </span>
                <span style={{ color: 'var(--fg-muted, #94a3b8)' }}>
                  {compactSources
                    .map(([source, count]) => `${source} ${numFmt(count)}`)
                    .join(' · ')}
                </span>
              </>
            ) : null}
          </div>
        </>
      ) : null}
      {summary.reasons.length > 0 ? (
        <>
          <div className='v9-tip-head' style={{ margin: '6px 0 2px' }}>
            Top reason codes
          </div>
          {summary.reasons.map((reason) => (
            <div
              key={`${reason.family}:${reason.reason}`}
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                gap: '8px',
                fontSize: '9px',
                color: 'var(--fg, #e2e8f0)',
              }}
            >
              <span
                style={{
                  minWidth: 0,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {humanizeReasonCode(reason.family)} ·{' '}
                {humanizeReasonCode(reason.reason)}
              </span>
              <span style={{ flex: '0 0 auto' }}>{numFmt(reason.count)}</span>
            </div>
          ))}
        </>
      ) : null}
    </div>
  )
}

function renderNoAgentQualityTooltip(): ReactElement {
  return (
    <div style={{ minWidth: '220px' }}>
      <div className='v9-tip-head' style={{ marginBottom: '4px' }}>
        Agent health
      </div>
      <div style={{ fontSize: '9px', color: 'var(--fg, #e2e8f0)' }}>
        No score data
      </div>
      <div style={{ fontSize: '9px', color: 'var(--fg-muted, #94a3b8)' }}>
        No evaluated session-history score fields were reported for this row.
      </div>
    </div>
  )
}

function renderAgentScoreIndicator(
  label: string,
  color: string,
  state: AgentQualityDisplaySummary['state'] | 'none'
): ReactElement {
  return (
    <span
      aria-label={`Score: ${label.toLowerCase()}`}
      data-agent-score-indicator='true'
      data-agent-score-state={state}
      style={{
        display: 'inline-block',
        width: '9px',
        height: '9px',
        borderRadius: '999px',
        background: color,
        border: '1px solid rgba(255, 255, 255, 0.34)',
        boxShadow: `0 0 7px ${color}`,
        verticalAlign: 'middle',
      }}
    />
  )
}

export function renderAgentQualityCell(
  summary: AgentQualitySummary | undefined
): ReactElement {
  if (summary === undefined) {
    return (
      <HoverTooltip content={() => renderNoAgentQualityTooltip()}>
        {renderAgentScoreIndicator('no data', AGENT_NO_DATA_COLOR, 'none')}
      </HoverTooltip>
    )
  }

  const displaySummary = summarizeAgentQuality(summary)

  return (
    <HoverTooltip content={() => renderAgentQualityTooltip(summary)}>
      {renderAgentScoreIndicator(
        displaySummary.label,
        displaySummary.color,
        displaySummary.state
      )}
    </HoverTooltip>
  )
}

function formatCoverageCount(count: number | null | undefined): string {
  return count != null && count > 0 ? `${numFmt(count)} rows` : 'no coverage'
}

function formatThroughput(value: number | null | undefined): string {
  return value == null ? '—' : `${numFmt(value, 1)} tok/s`
}

function renderLatencyTooltip(summary: ModelLatencySummary): ReactElement {
  const rows = [
    [
      'Server total p50/p95',
      `${formatLatency(summary.totalServerP50Ms)} / ${formatLatency(
        summary.totalServerP95Ms
      )}`,
      summary.totalServerCount,
    ],
    [
      'Upstream elapsed p50/p95',
      `${formatLatency(summary.upstreamElapsedP50Ms)} / ${formatLatency(
        summary.upstreamElapsedP95Ms
      )}`,
      summary.upstreamElapsedCount,
    ],
    ['TTFT p95', formatLatency(summary.ttftP95Ms), summary.ttftCount],
    [
      'LiteLLM local p95',
      formatLatency(summary.litellmProcessingP95Ms),
      summary.litellmProcessingCount,
    ],
    [
      'Upstream stream p95',
      formatLatency(summary.upstreamStreamP95Ms),
      summary.upstreamStreamCount,
    ],
    [
      'Unclassified p95',
      formatLatency(summary.unclassifiedP95Ms),
      summary.unclassifiedCount,
    ],
    [
      'Session gap p95',
      formatLatency(summary.previousResponseGapP95Ms),
      summary.previousResponseGapCount,
    ],
    [
      'Upstream output tok/s',
      `${formatThroughput(
        summary.upstreamOutputTokensPerSecondP50
      )} / ${formatThroughput(summary.upstreamOutputTokensPerSecondP95)}`,
      summary.upstreamOutputTokensPerSecondCount,
    ],
    [
      'Stream output tok/s',
      `${formatThroughput(
        summary.streamOutputTokensPerSecondP50
      )} / ${formatThroughput(summary.streamOutputTokensPerSecondP95)}`,
      summary.streamOutputTokensPerSecondCount,
    ],
  ] as const

  return (
    <div style={{ minWidth: '280px' }}>
      <div className='v9-tip-head' style={{ marginBottom: '4px' }}>
        Latency split
      </div>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'auto auto auto',
          columnGap: '12px',
          rowGap: '2px',
          fontSize: '9px',
        }}
      >
        {rows.map(([label, value, count]) => (
          <div key={label} style={{ display: 'contents' }}>
            <span style={{ color: 'var(--fg, #e2e8f0)' }}>{label}</span>
            <span style={{ color: 'var(--fg, #e2e8f0)' }}>{value}</span>
            <span style={{ color: 'var(--fg-muted, #94a3b8)' }}>
              {formatCoverageCount(count)}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

export function renderLatencyCell(
  value: number,
  summary: ModelLatencySummary | undefined
): ReactElement {
  const label = formatLatency(value)
  if (summary === undefined) return <>{label}</>
  return (
    <HoverTooltip content={() => renderLatencyTooltip(summary)}>
      {label}
    </HoverTooltip>
  )
}
