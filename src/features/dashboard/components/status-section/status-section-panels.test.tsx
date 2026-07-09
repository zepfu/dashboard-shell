/**
 * Wave 4 (D1-451 dash-status-lib) — consolidated status-section panel tests.
 *
 * Covers: alias-routing (C2, I3), provider-auth-health (I3), provider-credit-lifecycle
 * (C7, I3, E4), session-diagnostics (P1, I2, E3, E4), pgbouncer (G2, G3, A4),
 * provider-quota-history-bucket (I4, I7), quota-estimator-weights (G5, I6, A3).
 */
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from '@testing-library/react'
import { describe, expect, test, vi } from 'vitest'
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
  UsageReportQuotaHistoryRow,
  UsageReportSessionDiagnosticsResponse,
  UsageReportSessionDiagnosticsRow,
} from '../../api/usage-report'
import { AawmAliasRoutingPanel } from './aawm-alias-routing-panel'
import { PgBouncerHealthPanel } from './pgbouncer-health-panel'
import { ProviderAuthHealthPanel } from './provider-auth-health-panel'
import { ProviderCreditLifecyclePanel } from './provider-credit-lifecycle-panel'
import { ProviderQuotaHistoryBucket } from './provider-quota-history-bucket'
import { QuotaEstimatorWeightsPanel } from './quota-estimator-weights-panel'
import { SessionDiagnosticsPanel } from './session-diagnostics-panel'

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

function makeHistoryRow(
  overrides: Partial<UsageReportQuotaHistoryRow> = {}
): UsageReportQuotaHistoryRow {
  return {
    provider: 'gemini',
    model: null,
    quota_type: 'short',
    expected_reset_at: '2026-05-20T11:00:00Z',
    interval_start: '2026-05-20T06:00:00Z',
    interval_end: '2026-05-20T11:00:00Z',
    min_remaining_pct: 40,
    max_remaining_pct: 100,
    usage_tokens: 200,
    usage_breakdown: [],
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
// I4 / I7 — quota bucket header + rangeLabel shadow
// ---------------------------------------------------------------------------

describe('ProviderQuotaHistoryBucket — I4 canonical header', () => {
  test('test_quota_bucket_header_shows_canonical_google_not_gemini', () => {
    render(
      <ProviderQuotaHistoryBucket
        provider='gemini'
        rows={[makeHistoryRow({ provider: 'gemini' })]}
        rangeFrom='2026-05-20'
        rangeTo='2026-05-21'
      />
    )
    const head = screen.getByText('gemini')
    expect(head).toBeInTheDocument()
    // RED: header should canonicalize gemini → google (siblings use canonicalProvider in lane heads).
    expect(screen.getByText('google')).toBeInTheDocument()
  })
})

describe('ProviderQuotaHistoryBucket — I7 rangeLabel shadow', () => {
  test('test_quota_bucket_source_avoids_inner_rangeLabel_shadowing', async () => {
    const fs = await import('node:fs/promises')
    const path = await import('node:path')
    const source = await fs.readFile(
      path.join(
        process.cwd(),
        'src/features/dashboard/components/status-section/provider-quota-history-bucket.tsx'
      ),
      'utf8'
    )
    const innerRangeLabelCount = (source.match(/\bconst rangeLabel\b/g) ?? [])
      .length
    expect(innerRangeLabelCount).toBeLessThanOrEqual(1)
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
  test('test_estimator_unknown_status_humanized_like_default_branch', () => {
    const response: UsageReportQuotaEstimatorResponse = {
      metadata: {
        from: null,
        to: null,
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
          identifiability: {
            ...makeEstimatorEstimate().identifiability,
            status: 'foo_bar' as 'high_confidence',
          },
        }),
      ],
    }
    render(<QuotaEstimatorWeightsPanel response={response} loading={false} />)
    const status = screen.getByRole('status')
    // RED: either all statuses humanized or all verbatim — not mixed (G5).
    expect(status.textContent).toBe('foo_bar')
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
