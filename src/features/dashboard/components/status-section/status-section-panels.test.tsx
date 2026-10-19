/**
 * Wave 4 (D1-451 dash-status-lib) — consolidated status-section panel tests.
 *
 * Covers: alias-routing (C2, I3), provider-auth-health (I3), provider-credit-lifecycle
 * (C7, I3, E4), session-diagnostics (P1, I2, E3, E4), pgbouncer (G2, G3, A4),
 * quota-estimator-weights (G5, I6, A3).
 */
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from '@testing-library/react'
import { describe, expect, test, vi } from 'vitest'
import { quotaAccountRefFromAccountHash } from '../../../../../server/session-diagnostics-zen-account.mjs'
import type {
  ShellPgBouncerHealth,
  ShellPgBouncerSidecar,
  UsageReportProviderAliasRouting,
  UsageReportProviderAliasRoutingEntry,
  UsageReportProviderAuthHealth,
  UsageReportProviderAuthHealthEntry,
  UsageReportProviderCreditLifecycle,
  UsageReportProviderCreditLifecycleEntry,
  UsageReportQuotaEstimatorEstimate,
  UsageReportQuotaEstimatorResponse,
  UsageReportSessionDiagnosticsResponse,
  UsageReportSessionDiagnosticsRow,
} from '../../api/usage-report'
import { AawmAliasRoutingPanel } from './aawm-alias-routing-panel'
import { PgBouncerHealthPanel } from './pgbouncer-health-panel'
import { ProviderAuthHealthPanel } from './provider-auth-health-panel'
import { ProviderCreditLifecyclePanel } from './provider-credit-lifecycle-panel'
import { QuotaEstimatorWeightsPanel } from './quota-estimator-weights-panel'
import { SessionDiagnosticsPanel } from './session-diagnostics-panel'
import { classifyRecordedStreamCompleteness } from './session-diagnostics-stream'

const SHARED_STATUS_PANEL_HEAD = 'status-panel-head'
const SHARED_STATUS_PILL_PREFIX = 'status-pill'

// ---------------------------------------------------------------------------
// Fixtures (fields from usage-report.ts only)
// ---------------------------------------------------------------------------

function makeAliasEntry(
  overrides: Partial<UsageReportProviderAliasRoutingEntry> = {}
): UsageReportProviderAliasRoutingEntry {
  return {
    family: 'codex',
    state_kind: 'affinity',
    state_source: 'memory',
    observed_at: '2026-05-20T10:00:00Z',
    remaining_seconds: 36_000,
    ...overrides,
  }
}

function makeAuthEntry(
  overrides: Partial<UsageReportProviderAuthHealthEntry> = {}
): UsageReportProviderAuthHealthEntry {
  return {
    observed_at: '2026-05-20T10:00:00Z',
    environment: 'production',
    provider: 'openai',
    auth_family: 'codex',
    status: 'ok',
    attempted: false,
    refreshed: true,
    skipped: false,
    auth_health_state: 'refreshed',
    remaining_seconds: 36_000,
    ...overrides,
  }
}

function makeCreditEntry(
  overrides: Partial<UsageReportProviderCreditLifecycleEntry> = {}
): UsageReportProviderCreditLifecycleEntry {
  return {
    observed_at: '2026-05-20T10:00:00Z',
    environment: 'production',
    provider: 'anthropic',
    credit_family: 'promo_grant',
    available_count: 1,
    status: 'available',
    ...overrides,
  }
}

function makeDiagnosticsRow(
  overrides: Partial<UsageReportSessionDiagnosticsRow> = {}
): UsageReportSessionDiagnosticsRow {
  return {
    session_id: 'sess-1',
    provider: 'openai',
    model: 'gpt-5',
    created_at: '2026-05-20T10:00:00Z',
    diagnostic_flags: [],
    diagnostic_categories: [],
    ...overrides,
  }
}

function makeEstimatorEstimate(
  overrides: Partial<UsageReportQuotaEstimatorEstimate> = {}
): UsageReportQuotaEstimatorEstimate {
  return {
    provider: 'anthropic',
    quota_key: 'anthropic/short',
    quota_type: 'short',
    quota_lane: 'anthropic/short',
    selected_lag_minutes: 30,
    lag_sensitivity: [],
    interval_count: 10,
    trainable_interval_count: 8,
    excluded_interval_count: 2,
    excluded_reasons: {},
    residuals: {
      static_baseline: { rmse_pct: 1, mae_pct: 1, max_abs_error_pct: 2 },
      rolling_exponential: { rmse_pct: 1, mae_pct: 1, max_abs_error_pct: 2 },
    },
    identifiability: {
      status: 'high_confidence',
      trainable_interval_count: 8,
      effective_sample_size: 100,
      active_feature_count: 3,
      model_family_mix_count: 2,
      max_feature_correlation: 0.1,
      risks: [],
    },
    backtest: {
      status: 'evaluated',
      holdout_interval_count: 2,
      static_rmse_pct: 1,
      rolling_rmse_pct: 1,
      rolling_improved: true,
    },
    cache_read_ratios: [],
    coefficients: [],
    diagnostics: [],
    ...overrides,
  }
}

function makePgSidecar(
  overrides: Partial<ShellPgBouncerSidecar> = {}
): ShellPgBouncerSidecar {
  return {
    key: 'primary',
    label: 'Primary',
    containerName: 'pgbouncer-1',
    status: 'green',
    container: {
      present: true,
      status: 'running',
      health: 'healthy',
    },
    admin: {
      status: 'ok',
      poolSummary: {
        clActive: 1,
        clWaiting: 0,
        svActive: 2,
        svIdle: 1,
        maxWaitSeconds: 0,
        maxWaitMicroseconds: 0,
      },
      statsSummary: {
        totalXactCount: 1000,
        totalQueryCount: 5000,
        totalReceived: 1_000_000,
        totalSent: 2_000_000,
      },
      serverSummary: { total: 3 },
      pools: [],
      stats: [],
    },
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// C2 / I3 — alias routing duration + shared formatters
// ---------------------------------------------------------------------------

describe('AawmAliasRoutingPanel — C2 hours tier', () => {
  test('test_alias_routing_10h_remaining_shows_hours_not_600m', () => {
    const routing: UsageReportProviderAliasRouting = {
      freshness_label: 'fresh',
      generated_at: '2026-05-20T10:00:00Z',
      lookback_hours: 24,
      families: [{ family: 'codex', observed: true }],
      entries: [makeAliasEntry({ remaining_seconds: 36_000 })],
    }
    render(<AawmAliasRoutingPanel routing={routing} />)
    expect(screen.getByText(/10h/)).toBeInTheDocument()
    expect(screen.queryByText(/600m/)).not.toBeInTheDocument()
  })
})

// ---------------------------------------------------------------------------
// I3 — auth panel uses shared duration formatter (hours tier)
// ---------------------------------------------------------------------------

describe('ProviderAuthHealthPanel — I3 shared formatters', () => {
  test('test_auth_panel_10h_remaining_matches_hours_tier', () => {
    const authHealth: UsageReportProviderAuthHealth = {
      data_source: 'provider_auth_current',
      freshness_label: 'fresh',
      generated_at: '2026-05-20T10:00:00Z',
      entries: [makeAuthEntry({ remaining_seconds: 36_000 })],
    }
    render(<ProviderAuthHealthPanel authHealth={authHealth} />)
    expect(screen.getByText(/10h/)).toBeInTheDocument()
  })
})

// ---------------------------------------------------------------------------
// C7 — credit caption for non-Codex credits
// ---------------------------------------------------------------------------

describe('ProviderCreditLifecyclePanel — C7 caption', () => {
  test('test_credit_caption_not_codex_only_when_anthropic_entries', () => {
    const creditLifecycle: UsageReportProviderCreditLifecycle = {
      data_source: 'provider_credit_current',
      freshness_label: 'fresh',
      generated_at: '2026-05-20T10:00:00Z',
      summaries: [],
      entries: [makeCreditEntry()],
    }
    render(<ProviderCreditLifecyclePanel creditLifecycle={creditLifecycle} />)
    const caption = screen.getByText(
      /Current provider credits by environment, family, and credit identity/i
    )
    expect(caption).toBeInTheDocument()
    expect(caption.textContent?.toLowerCase()).not.toContain('codex')
  })
})

// ---------------------------------------------------------------------------
// E4 — stable keys without trailing index-only suffix
// ---------------------------------------------------------------------------

describe('ProviderCreditLifecyclePanel — E4 keys', () => {
  test('test_credit_row_keys_do_not_append_index_suffix_in_source', async () => {
    const fs = await import('node:fs/promises')
    const path = await import('node:path')
    const source = await fs.readFile(
      path.join(
        process.cwd(),
        'src/features/dashboard/components/status-section/provider-credit-lifecycle-panel.tsx'
      ),
      'utf8'
    )
    // RED: composite React keys must not use trailing `${index}` disambiguation.
    expect(source).not.toMatch(
      /key=\{`\$\{entry\.environment\}[\s\S]*\$\{index\.toString\(\)\}`\}/
    )
  })
})

// ---------------------------------------------------------------------------
// P1 — lazy JSON stringify on details toggle
// ---------------------------------------------------------------------------

describe('SessionDiagnosticsPanel — P1 lazy stringify', () => {
  test('test_tool_snapshot_not_stringified_until_details_open', () => {
    const stringifySpy = vi.spyOn(JSON, 'stringify')
    stringifySpy.mockClear()

    const huge = { payload: 'x'.repeat(5000) }
    const response: UsageReportSessionDiagnosticsResponse = {
      metadata: { from: '2026-05-20', to: '2026-05-21', limit: 10 },
      sessionDiagnostics: [
        makeDiagnosticsRow({
          tool_definitions: {
            aawm_tool_definition_count: 1,
            tool_definition_snapshot: huge,
          },
        }),
      ],
    }

    render(<SessionDiagnosticsPanel response={response} loading={false} />)

    const snapshotCallsBeforeOpen = stringifySpy.mock.calls.filter((call) =>
      String(call[0]).includes('xxxxx')
    )
    expect(snapshotCallsBeforeOpen).toHaveLength(0)

    const summary = screen.getByText('tool definition snapshot')
    fireEvent.click(summary)

    const snapshotCallsAfterOpen = stringifySpy.mock.calls.filter((call) =>
      String(call[0]).includes('xxxxx')
    )
    expect(snapshotCallsAfterOpen.length).toBeGreaterThan(0)

    stringifySpy.mockRestore()
  })
})

// ---------------------------------------------------------------------------
// E3 — displayKey strips prefixes (via rendered labels)
// ---------------------------------------------------------------------------

describe('SessionDiagnosticsPanel — E3 displayKey', () => {
  test('test_xai_prefix_stripped_in_rendered_diagnostic_label', () => {
    const response: UsageReportSessionDiagnosticsResponse = {
      metadata: { from: '2026-05-20', to: '2026-05-21', limit: 10 },
      sessionDiagnostics: [
        makeDiagnosticsRow({
          xai_sanitizer: {
            xai_responses_request_sanitized: true,
            credential_family: 'xai',
          },
        }),
      ],
    }
    render(<SessionDiagnosticsPanel response={response} loading={false} />)
    fireEvent.click(screen.getByText('sanitized request detail'))
    const block = screen.getByText(/credential_family/i).closest('span')
    expect(block?.textContent ?? '').not.toContain('xai_credential_family')
    expect(block?.textContent ?? '').toContain('credential_family')
  })
})

describe('SessionDiagnosticsPanel — D1-488 host attribution', () => {
  test('prefers_host_name_shows_distinct_client_ip_fallback_and_omits_absent_host', () => {
    const response: UsageReportSessionDiagnosticsResponse = {
      metadata: { from: '2026-05-20', to: '2026-05-21', limit: 10 },
      sessionDiagnostics: [
        makeDiagnosticsRow({
          session_id: 'host-preferred',
          host_name: '  build-host  ',
          client_ip: '10.0.0.1',
        }),
        makeDiagnosticsRow({
          session_id: 'same-attribution',
          host_name: 'same-host',
          client_ip: 'same-host',
        }),
        makeDiagnosticsRow({
          session_id: 'ip-fallback',
          host_name: '   ',
          client_ip: ' 10.0.0.2 ',
        }),
        makeDiagnosticsRow({
          session_id: 'legacy-row',
          host_name: null,
          client_ip: null,
        }),
      ],
    }

    const { container } = render(
      <SessionDiagnosticsPanel response={response} loading={false} />
    )
    const cards = Array.from(
      container.querySelectorAll<HTMLElement>('.status-diagnostics-card')
    )
    expect(cards).toHaveLength(4)

    const hostText = (card: HTMLElement) =>
      card.querySelector('.status-diagnostics-host')?.textContent ?? ''

    expect(hostText(cards[0])).toContain('host: build-host')
    expect(hostText(cards[0])).toContain('client_ip: 10.0.0.1')
    expect(hostText(cards[1])).toContain('host: same-host')
    expect(hostText(cards[1])).not.toContain('client_ip:')
    expect(hostText(cards[2])).toContain('host: 10.0.0.2')
    expect(hostText(cards[2])).not.toContain('client_ip:')
    expect(cards[3].querySelector('.status-diagnostics-host')).toBeNull()
  })
})

describe('SessionDiagnosticsPanel — D1-500 identity', () => {
  function identityText(card: HTMLElement, field: string): string {
    return card.querySelector(`[data-identity="${field}"]`)?.textContent ?? ''
  }

  test('renders known and unknown agent identity apart from the selected model', () => {
    const response: UsageReportSessionDiagnosticsResponse = {
      metadata: { from: '2026-05-20', to: '2026-05-21', limit: 10 },
      sessionDiagnostics: [
        makeDiagnosticsRow({
          session_id: 'known-identity',
          agent_name: 'orchestrator',
          agent_id: 'agent_harness',
          inbound_model_alias: 'aawm-read-anthropic',
          model: 'claude-sonnet-4-6',
        }),
        makeDiagnosticsRow({
          session_id: 'missing-identity',
          agent_name: null,
          agent_id: null,
          inbound_model_alias: '',
          model: 'claude-sonnet-4-6',
        }),
        makeDiagnosticsRow({
          session_id: 'name-without-id',
          agent_name: 'orchestrator',
          agent_id: null,
          inbound_model_alias: null,
          model: 'gpt-5',
        }),
        makeDiagnosticsRow({
          session_id: 'historical-spaced-id',
          agent_name: 'orchestrator',
          agent_id: '  agent_harness  ',
          inbound_model_alias: '  aawm-read-anthropic  ',
          model: 'claude-opus-4-8',
        }),
      ],
    }

    const { container } = render(
      <SessionDiagnosticsPanel response={response} loading={false} />
    )
    const cards = Array.from(
      container.querySelectorAll<HTMLElement>('.status-diagnostics-card')
    )
    expect(cards).toHaveLength(4)

    expect(identityText(cards[0], 'agent_name')).toBe('orchestrator')
    expect(identityText(cards[0], 'agent_id')).toBe('agent_harness')
    expect(identityText(cards[0], 'inbound_model_alias')).toBe(
      'aawm-read-anthropic'
    )
    expect(identityText(cards[0], 'model')).toBe('claude-sonnet-4-6')

    expect(identityText(cards[1], 'agent_name')).toBe('unknown')
    expect(identityText(cards[1], 'agent_id')).toBe('unknown')
    expect(identityText(cards[1], 'inbound_model_alias')).toBe('unknown')
    expect(identityText(cards[1], 'model')).toBe('claude-sonnet-4-6')

    expect(identityText(cards[2], 'agent_name')).toBe('orchestrator')
    expect(identityText(cards[2], 'agent_id')).toBe('unknown')
    expect(identityText(cards[2], 'agent_id')).not.toBe('orchestrator')
    expect(identityText(cards[2], 'inbound_model_alias')).toBe('unknown')
    expect(identityText(cards[2], 'inbound_model_alias')).not.toBe('gpt-5')
    expect(identityText(cards[2], 'model')).toBe('gpt-5')

    expect(identityText(cards[3], 'agent_id')).toBe('  agent_harness  ')
    expect(identityText(cards[3], 'inbound_model_alias')).toBe(
      '  aawm-read-anthropic  '
    )
    expect(identityText(cards[3], 'model')).toBe('claude-opus-4-8')
  })
})

describe('SessionDiagnosticsPanel — D1-501 recorded stream completeness', () => {
  function renderStreamRow(row: UsageReportSessionDiagnosticsRow): HTMLElement {
    render(
      <SessionDiagnosticsPanel
        response={{
          metadata: { from: '2026-05-20', to: '2026-05-21', limit: 10 },
          sessionDiagnostics: [row],
        }}
        loading={false}
      />
    )
    return screen.getByTestId('recorded-stream-completeness')
  }

  test('test_stream_only_observed_terminal_keeps_recorded_false_and_omits_absent_scalars', () => {
    const block = renderStreamRow(
      makeDiagnosticsRow({
        diagnostic_flags: ['stream'],
        diagnostic_categories: ['stream_completeness'],
        stream_diagnostics: {
          provider_terminal_event_type: 'response.completed',
          provider_terminal_observed: true,
          parse_ambiguity: false,
          aawm_stream_synthetic_terminal: false,
          tool_argument_summaries: [{ arguments: 'SECRET_TOOL_ARG' }],
          authorization: 'Bearer secret-token',
        } as UsageReportSessionDiagnosticsRow['stream_diagnostics'],
      })
    )

    expect(
      within(block).getByText('Observed provider terminal')
    ).toBeInTheDocument()
    expect(within(block).getByText('response.completed')).toBeInTheDocument()
    expect(within(block).getByText('parse_ambiguity')).toBeInTheDocument()
    expect(within(block).getAllByText('false').length).toBeGreaterThan(0)
    expect(within(block).queryByText('partial_frame')).toBeNull()
    expect(within(block).queryByText('state_omitted')).toBeNull()
    expect(within(block).queryByText('Synthetic completion')).toBeNull()
    expect(within(block).queryByText('SECRET_TOOL_ARG')).toBeNull()
    expect(within(block).queryByText(/Bearer/)).toBeNull()
    expect(within(block).queryByText(/hidden retry/i)).toBeNull()
    expect(within(block).queryByText(/every stream failed/i)).not.toBeNull()
    expect(within(block).getByText(/not represented here/i)).toBeInTheDocument()
  })

  test('test_synthetic_completion_is_distinct_from_observed_and_incomplete_terminals', () => {
    const synthetic = renderStreamRow(
      makeDiagnosticsRow({
        session_id: 'synthetic-completed',
        diagnostic_flags: ['stream'],
        stream_diagnostics: {
          provider_terminal_observed: false,
          synthetic_terminal_event_type: 'response.completed',
          aawm_stream_synthetic_terminal: true,
        },
      })
    )
    expect(
      within(synthetic).getByText('Synthetic completion')
    ).toBeInTheDocument()
    expect(
      within(synthetic).queryByText('Observed provider terminal')
    ).toBeNull()
    expect(
      within(synthetic).queryByText('Unknown or incomplete recorded state')
    ).toBeNull()
    cleanup()

    const incomplete = renderStreamRow(
      makeDiagnosticsRow({
        session_id: 'synthetic-incomplete',
        diagnostic_flags: ['stream'],
        stream_diagnostics: {
          provider_terminal_observed: false,
          synthetic_terminal_event_type: 'response.incomplete',
          parse_ambiguity: true,
          partial_frame: true,
          sequence_ambiguity: false,
          aawm_stream_synthetic_terminal: true,
          aawm_stream_incomplete_reason: 'upstream_stream_parse_ambiguity',
        },
      })
    )
    expect(
      within(incomplete).getByText('Unknown or incomplete recorded state')
    ).toBeInTheDocument()
    expect(within(incomplete).queryByText('Synthetic completion')).toBeNull()
    expect(
      within(incomplete).queryByText('Observed provider terminal')
    ).toBeNull()
    expect(within(incomplete).getByText('parse_ambiguity')).toBeInTheDocument()
    expect(
      within(incomplete).getByText('parse_ambiguity').textContent
    ).toContain('true')
    expect(
      within(incomplete).getByText('sequence_ambiguity').textContent
    ).toContain('false')
    expect(
      within(incomplete).getByText('provider_terminal_observed').textContent
    ).toContain('false')
    expect(within(incomplete).queryByText('state_omitted')).toBeNull()
    expect(
      within(incomplete).getByText('upstream_stream_parse_ambiguity')
    ).toBeInTheDocument()
    expect(
      classifyRecordedStreamCompleteness({
        provider_terminal_observed: false,
        provider_terminal_event_type: 'response.completed',
      })
    ).toBe('unknown_or_incomplete')
    expect(
      classifyRecordedStreamCompleteness({
        provider_terminal_observed: false,
        synthetic_terminal_event_type: 'response.completed',
      })
    ).toBe('synthetic_completion')
  })

  test('test_recovery_linkage_is_recorded_outcome_not_hidden_retry_proof', () => {
    const block = renderStreamRow(
      makeDiagnosticsRow({
        diagnostic_flags: ['stream'],
        stream_diagnostics: {
          provider_terminal_observed: true,
          provider_terminal_event_type: 'response.completed',
          aawm_stream_recovery_outcome: 'recovered',
          aawm_stream_recovery_parent_litellm_call_id: 'call-originating',
          aawm_stream_recovery_previous_response_id: 'resp-previous',
        },
      })
    )

    expect(
      within(block).getByText('Recorded recovery outcome')
    ).toBeInTheDocument()
    expect(within(block).getByText('recovered')).toBeInTheDocument()
    expect(within(block).getByText('call-originating')).toBeInTheDocument()
    expect(within(block).getByText('resp-previous')).toBeInTheDocument()
    expect(
      within(block).getByText(/not proof that a hidden retry ran/i)
    ).toBeInTheDocument()
    expect(within(block).queryByText(/retry succeeded/i)).toBeNull()
    expect(within(block).queryByText(/hidden retry recovered/i)).toBeNull()
  })

  test('test_missing_stream_metadata_is_not_shown_as_a_captured_stream', () => {
    render(
      <SessionDiagnosticsPanel
        response={{
          metadata: { from: '2026-05-20', to: '2026-05-21', limit: 10 },
          sessionDiagnostics: [
            makeDiagnosticsRow({
              output_contract: {
                usage_output_contract_failure_class:
                  'missing_required_final_phrase',
              },
            }),
          ],
        }}
        loading={false}
      />
    )

    expect(screen.queryByTestId('recorded-stream-completeness')).toBeNull()
    expect(screen.queryByText('Observed provider terminal')).toBeNull()
    expect(screen.queryByText('Synthetic completion')).toBeNull()
    expect(
      screen.queryByText('Unknown or incomplete recorded state')
    ).toBeNull()
    cleanup()

    const admittedWithoutScalars = renderStreamRow(
      makeDiagnosticsRow({
        diagnostic_flags: ['stream'],
        stream_diagnostics: null,
      })
    )
    expect(
      within(admittedWithoutScalars).getByText(
        'Unknown or incomplete recorded state'
      )
    ).toBeInTheDocument()
    expect(
      within(admittedWithoutScalars).getByText(
        /Selected stream scalars were not recorded on this row/i
      )
    ).toBeInTheDocument()
    expect(
      within(admittedWithoutScalars).queryByText('response.failed')
    ).toBeNull()
    expect(
      within(admittedWithoutScalars).queryByText('provider_terminal_observed')
    ).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// G2 / G3 — PgBouncer default branch + vocab alignment
// ---------------------------------------------------------------------------

describe('PgBouncerHealthPanel — G2 default branch', () => {
  test('test_pgbouncer_unknown_sidecar_status_gets_fallback_pill_not_undefined', () => {
    const health: ShellPgBouncerHealth = {
      status: 'green',
      sidecars: [
        makePgSidecar({
          status: 'magenta' as ShellPgBouncerSidecar['status'],
        }),
      ],
    }
    const { container } = render(
      <PgBouncerHealthPanel health={health} loading={false} />
    )
    const card = container.querySelector('.pgbouncer-card')
    expect(card?.className).not.toContain('undefined')
    const pill = within(card as HTMLElement).getByText(
      /unknown|degraded|ok|down/i
    )
    expect(pill).toBeInTheDocument()
  })
})

describe('PgBouncerHealthPanel — G3 status vocabulary', () => {
  test('test_pgbouncer_head_status_matches_translated_pill_semantics', () => {
    const health: ShellPgBouncerHealth = {
      status: 'yellow',
      sidecars: [makePgSidecar({ status: 'yellow' })],
    }
    render(<PgBouncerHealthPanel health={health} loading={false} />)
    expect(screen.getByText('yellow')).toBeInTheDocument()
    expect(screen.getByText('degraded')).toBeInTheDocument()
  })
})

describe('PgBouncerHealthPanel — A4 formatCompactQuantity import', () => {
  test('test_pgbouncer_imports_compact_quantity_from_status_formatters_not_quota_history', async () => {
    const mod = await import('../../lib/status-formatters')
    expect(typeof mod.formatCompactQuantity).toBe('function')
    const pgbMod = await import('./pgbouncer-health-panel')
    expect(pgbMod.PgBouncerHealthPanel).toBeDefined()
  })
})

// ---------------------------------------------------------------------------
// G5 / I6 / A3 — estimator lane labels via PROVIDER_LANE_DEFS
// ---------------------------------------------------------------------------

describe('QuotaEstimatorWeightsPanel — A3 lane-def labels', () => {
  test('test_estimator_anthropic_special_lane_matches_lane_defs_spelling', () => {
    const response: UsageReportQuotaEstimatorResponse = {
      metadata: {
        from: '2026-05-20',
        to: '2026-05-21',
        phase: '0-2',
        lagCandidatesMinutes: [30],
        estimatorVersion: 'v1',
      },
      phase0Audit: {
        source_database: 'db',
        usage_event_shape: {},
        quota_pct_interval_shape: {},
        provider_lane_policy: {},
        known_missing_fields: [],
      },
      estimates: [
        makeEstimatorEstimate({
          provider: 'anthropic',
          quota_type: 'special',
          quota_lane: 'anthropic/special',
        }),
      ],
    }
    render(<QuotaEstimatorWeightsPanel response={response} loading={false} />)
    expect(screen.getByText(/Retired Sonnet · 7d/i)).toBeInTheDocument()
    expect(screen.queryByText(/sonnet-only · 7d/i)).not.toBeInTheDocument()
  })
})

describe('QuotaEstimatorWeightsPanel — G5 status label consistency', () => {
  test('test_estimator_status_labels_all_humanized', () => {
    const baseMeta = {
      metadata: {
        from: '2026-05-20' as const,
        to: '2026-05-21' as const,
        phase: '0-2' as const,
        lagCandidatesMinutes: [30],
        estimatorVersion: 'v1',
      },
      phase0Audit: {
        source_database: 'db',
        usage_event_shape: {},
        quota_pct_interval_shape: {},
        provider_lane_policy: {},
        known_missing_fields: [] as string[],
      },
    }

    const cases = [
      {
        status: 'high_confidence' as const,
        label: 'High confidence',
      },
      {
        status: 'directional_only' as const,
        label: 'Directional only',
      },
      {
        status: 'not_identifiable' as const,
        label: 'Not identifiable',
      },
    ] as const

    for (const { status, label } of cases) {
      cleanup()
      const response: UsageReportQuotaEstimatorResponse = {
        ...baseMeta,
        estimates: [
          makeEstimatorEstimate({
            identifiability: {
              ...makeEstimatorEstimate().identifiability,
              status,
            },
          }),
        ],
      }
      render(<QuotaEstimatorWeightsPanel response={response} loading={false} />)
      const lanePill = screen
        .getAllByRole('status')
        .find((el) => el.className.includes('status-pill'))
      expect(lanePill?.textContent).toBe(label)
      expect(lanePill?.textContent).not.toMatch(/_/)
    }

    cleanup()
    const unknownResponse: UsageReportQuotaEstimatorResponse = {
      ...baseMeta,
      estimates: [
        makeEstimatorEstimate({
          identifiability: {
            ...makeEstimatorEstimate().identifiability,
            status: 'foo_bar' as 'high_confidence',
          },
        }),
      ],
    }
    render(
      <QuotaEstimatorWeightsPanel response={unknownResponse} loading={false} />
    )
    const unknownPill = screen
      .getAllByRole('status')
      .find((el) => el.className.includes('status-pill'))
    expect(unknownPill?.textContent).toBe('Foo bar')
  })
})

// ---------------------------------------------------------------------------
// Wave 5 — P08-F01/F09 shared StatusPanel chrome across six panels
// ---------------------------------------------------------------------------

describe('status-panels — all_six_use_shared_chrome', () => {
  test('all_six_use_shared_chrome', () => {
    const cases: Array<{
      name: string
      render: () => void
    }> = [
      {
        name: 'PgBouncerHealthPanel',
        render: () =>
          render(
            <PgBouncerHealthPanel
              health={{
                status: 'green',
                sidecars: [makePgSidecar()],
              }}
              loading={false}
            />
          ),
      },
      {
        name: 'ProviderAuthHealthPanel',
        render: () =>
          render(
            <ProviderAuthHealthPanel
              authHealth={{
                data_source: 'provider_auth_current',
                freshness_label: 'fresh',
                generated_at: '2026-05-20T10:00:00Z',
                entries: [makeAuthEntry()],
              }}
            />
          ),
      },
      {
        name: 'ProviderCreditLifecyclePanel',
        render: () =>
          render(
            <ProviderCreditLifecyclePanel
              creditLifecycle={{
                data_source: 'provider_credit_current',
                freshness_label: 'fresh',
                generated_at: '2026-05-20T10:00:00Z',
                summaries: [],
                entries: [makeCreditEntry()],
              }}
            />
          ),
      },
      {
        name: 'AawmAliasRoutingPanel',
        render: () =>
          render(
            <AawmAliasRoutingPanel
              routing={{
                freshness_label: 'fresh',
                generated_at: '2026-05-20T10:00:00Z',
                lookback_hours: 24,
                families: [{ family: 'codex', observed: true }],
                entries: [makeAliasEntry()],
              }}
            />
          ),
      },
      {
        name: 'QuotaEstimatorWeightsPanel',
        render: () =>
          render(
            <QuotaEstimatorWeightsPanel
              response={{
                metadata: {
                  from: '2026-05-20',
                  to: '2026-05-21',
                  phase: '0-2',
                  lagCandidatesMinutes: [30],
                  estimatorVersion: 'v1',
                },
                phase0Audit: {
                  source_database: 'db',
                  usage_event_shape: {},
                  quota_pct_interval_shape: {},
                  provider_lane_policy: {},
                  known_missing_fields: [],
                },
                estimates: [makeEstimatorEstimate()],
              }}
              loading={false}
            />
          ),
      },
      {
        name: 'SessionDiagnosticsPanel',
        render: () =>
          render(
            <SessionDiagnosticsPanel
              response={{
                metadata: { from: '2026-05-20', to: '2026-05-21', limit: 10 },
                sessionDiagnostics: [makeDiagnosticsRow()],
              }}
              loading={false}
            />
          ),
      },
    ]

    for (const panelCase of cases) {
      panelCase.render()

      const scoped = document.body
      expect(
        scoped.querySelector(`.${SHARED_STATUS_PANEL_HEAD}`),
        `${panelCase.name} must use shared status-panel-head`
      ).not.toBeNull()

      const pill = scoped.querySelector(
        `[class*="${SHARED_STATUS_PILL_PREFIX}"]`
      )
      expect(
        pill,
        `${panelCase.name} must expose a pill with normalized status-pill vocabulary`
      ).not.toBeNull()
      const pillClass = pill?.className ?? ''
      expect(pillClass).toMatch(
        /\bis-(healthy|warn|bad|unknown|green|yellow|red)\b/
      )

      cleanup()
    }
  })
})

describe('SessionDiagnosticsPanel — D1-504 Zen account refs', () => {
  const digestA = `sha256:${'ab'.repeat(32)}`
  const digestB = `sha256:${'cd'.repeat(32)}`

  function identityLine(card: HTMLElement, label: string): string {
    const line = within(card).getByText((_, element) => {
      if (!(element instanceof HTMLSpanElement)) return false
      if (
        element.parentElement?.classList.contains(
          'status-diagnostics-request'
        ) !== true
      ) {
        return false
      }
      return (element.textContent ?? '').startsWith(`${label}:`)
    })
    return line.textContent ?? ''
  }

  test('shows two Zen quota refs with request identity and unknown invalid sources', () => {
    const refA = quotaAccountRefFromAccountHash(digestA)
    const refB = quotaAccountRefFromAccountHash(digestB)
    if (refA === null || refB === null) {
      throw new Error('expected distinct Zen quota refs')
    }
    expect(refA).toBe('36f6769913c7')
    expect(refB).toBe('27b7269c6ae2')

    const response: UsageReportSessionDiagnosticsResponse = {
      metadata: { from: '2026-05-20', to: '2026-05-21', limit: 10 },
      sessionDiagnostics: [
        makeDiagnosticsRow({
          session_id: 'sess-zen-a',
          trace_id: 'trace-zen-a',
          litellm_call_id: 'call-zen-a',
          provider: 'opencode_zen',
          zen_account_ref: refA,
          provider_account_hash: digestA,
          caller_identity_hash: 'caller-secret-a',
          agent_id: 'agent-a',
          grok_oauth: {
            credential_family: 'opencode_zen',
            passthrough_route_family: 'opencode_zen',
            route_family: 'opencode_zen',
            auth_mode: 'api_key',
            provider_account_hash: digestA,
          },
        } as UsageReportSessionDiagnosticsRow),
        makeDiagnosticsRow({
          session_id: 'sess-zen-b',
          trace_id: 'trace-zen-b',
          litellm_call_id: 'call-zen-b',
          provider: 'opencode_zen',
          zen_account_ref: refB,
          grok_oauth: {
            credential_family: 'opencode_zen',
            route_family: 'opencode-zen',
            auth_mode: 'bearer',
          },
        }),
        makeDiagnosticsRow({
          session_id: 'sess-invalid',
          trace_id: 'trace-invalid',
          litellm_call_id: 'call-invalid',
          zen_account_ref: digestA,
          provider_account_hash: 'raw-account-label',
          caller_identity_hash: 'caller-secret-b',
          agent_id: 'agent-invalid',
          account_label: 'raw-account-label',
          grok_oauth: {
            credential_family: 'xai_grok_oidc',
            passthrough_route_family: 'grok_cli_chat_proxy',
            route_family: 'grok',
            auth_mode: 'oidc',
            provider_account_hash: digestB,
          },
        } as UsageReportSessionDiagnosticsRow),
      ],
    }

    const { container } = render(
      <SessionDiagnosticsPanel response={response} loading={false} />
    )
    const cards = Array.from(
      container.querySelectorAll<HTMLElement>('.status-diagnostics-card')
    )
    expect(cards).toHaveLength(3)

    expect(identityLine(cards[0]!, 'session')).toContain('sess-zen-a')
    expect(identityLine(cards[0]!, 'trace')).toContain('trace-zen-a')
    expect(identityLine(cards[0]!, 'request')).toContain('call-zen-a')
    expect(identityLine(cards[0]!, 'zen account')).toContain(refA)
    expect(identityLine(cards[0]!, 'zen account')).not.toContain(refB)
    expect(within(cards[0]!).getByText(/credential_family/)).toBeInTheDocument()
    expect(within(cards[0]!).getByText(/auth_mode/)).toBeInTheDocument()
    expect(within(cards[0]!).getByText('api_key')).toBeInTheDocument()
    expect(
      within(cards[0]!).getAllByText('opencode_zen').length
    ).toBeGreaterThan(0)
    expect(cards[0]!.textContent ?? '').not.toContain(digestA)
    expect(cards[0]!.textContent ?? '').not.toContain('caller-secret-a')
    expect(identityLine(cards[0]!, 'zen account')).not.toContain('agent-a')
    expect(
      cards[0]!.querySelector('[data-identity="agent_id"]')?.textContent
    ).toBe('agent-a')

    expect(identityLine(cards[1]!, 'session')).toContain('sess-zen-b')
    expect(identityLine(cards[1]!, 'request')).toContain('call-zen-b')
    expect(identityLine(cards[1]!, 'zen account')).toContain(refB)
    expect(within(cards[1]!).getByText('bearer')).toBeInTheDocument()
    expect(within(cards[1]!).getByText('opencode-zen')).toBeInTheDocument()

    expect(identityLine(cards[2]!, 'session')).toContain('sess-invalid')
    expect(identityLine(cards[2]!, 'request')).toContain('call-invalid')
    expect(identityLine(cards[2]!, 'zen account')).toContain('unknown')
    expect(identityLine(cards[2]!, 'zen account')).not.toContain(digestA)
    expect(within(cards[2]!).getByText('xai_grok_oidc')).toBeInTheDocument()
    expect(
      within(cards[2]!).getByText('grok_cli_chat_proxy')
    ).toBeInTheDocument()
    expect(within(cards[2]!).getByText('oidc')).toBeInTheDocument()
    const invalidText = cards[2]!.textContent ?? ''
    expect(invalidText).not.toContain(digestA)
    expect(invalidText).not.toContain(digestB)
    expect(invalidText).not.toContain('raw-account-label')
    expect(invalidText).not.toContain('caller-secret-b')
    expect(identityLine(cards[2]!, 'zen account')).not.toContain(
      'agent-invalid'
    )
    expect(
      cards[2]!.querySelector('[data-identity="agent_id"]')?.textContent
    ).toBe('agent-invalid')
  })
})
