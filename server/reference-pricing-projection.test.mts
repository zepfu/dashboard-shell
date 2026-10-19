import { describe, expect, test } from 'vitest'
import { reasoningEffortDiagnosticsProjectionSql } from './reasoning-effort-diagnostics.mjs'
import {
  REFERENCE_PRICING_LABEL,
  REFERENCE_PRICING_SEPARATION_NOTE,
  projectReferencePricingAggregate,
  projectReferencePricingMetadata,
  referencePricingDisplayFields,
  referencePricingSelectedObjectSql,
  selectReferencePricingFields,
} from './reference-pricing-projection.mjs'
import {
  buildProviderStatusUsageQuery,
  buildSessionDiagnosticsQuery,
  buildSummaryQuery,
  buildUsageQuery,
  compactUsageRow,
  __usageReportTestHelpers,
} from './report-service.mjs'
import { aliasAuditTerminalEvidenceSql } from './session-diagnostics-audit-terminal.mjs'
import { sessionDiagnosticsStreamProjectionSql } from './session-diagnostics-stream.mjs'
import { sessionDiagnosticsZenAccountSql } from './session-diagnostics-zen-account.mjs'

const pricedMetadata = {
  billing_mode: 'alibaba_token_plan_subscription',
  reference_cost_status: 'priced',
  reference_cost_source_label: 'Alibaba public rate card',
  reference_cost_source: 'ignored when a label is present',
  reference_cost_total_usd: '0.0125',
  actual_invoice_cost_known: false,
  reference_cost_source_urls: ['https://unselected.example/rate-card'],
  reference_cost_unpriced_reason: 'not-selected',
}

function aggregateRow(overrides: Record<string, unknown> = {}) {
  return {
    reference_billing_modes: ['alibaba_token_plan_subscription'],
    reference_billing_mode_count: 1,
    reference_billing_mode_rows: 1,
    reference_amount_usd: 0.0125,
    reference_amount_rows: 1,
    reference_amount_missing_rows: 0,
    reference_sources: ['Alibaba public rate card'],
    reference_source_count: 1,
    reference_source_rows: 1,
    reference_statuses: ['priced'],
    reference_status_count: 1,
    reference_status_rows: 1,
    reference_invoice_known_rows: 0,
    reference_invoice_unknown_rows: 1,
    reference_invoice_knowledge_missing_rows: 0,
    reference_contract_rows: 1,
    reference_contract_missing_rows: 0,
    ...overrides,
  }
}

function field(
  detail: NonNullable<ReturnType<typeof referencePricingDisplayFields>>,
  key: string
) {
  return detail.fields.find((entry) => entry.key === key)
}

async function expectParsableSql(sql: string) {
  const { parse } = await import('pgsql-parser')
  const parsed = (await parse(sql)) as { stmts: unknown[] }
  expect(parsed.stmts.length).toBeGreaterThan(0)
}

describe('reference pricing projection', () => {
  test('projects a known estimate with billing mode, amount, source, status, and invoice knowledge', () => {
    const detail = projectReferencePricingMetadata(pricedMetadata)
    const display = referencePricingDisplayFields(detail)

    expect(detail.label).toBe(REFERENCE_PRICING_LABEL)
    expect(detail.billing_mode).toBe('alibaba_token_plan_subscription')
    expect(detail.billing_mode_coverage).toBe('known')
    expect(detail.reference_amount_usd).toBe(0.0125)
    expect(detail.reference_amount_coverage).toBe('known')
    expect(detail.source).toBe('Alibaba public rate card')
    expect(detail.source_coverage).toBe('known')
    expect(detail.status).toBe('priced')
    expect(detail.status_coverage).toBe('known')
    expect(detail.actual_invoice_cost_known).toBe(false)
    expect(detail.actual_invoice_cost_knowledge_coverage).toBe('known')
    expect(detail.contract_coverage).toBe('present')
    expect(display?.note).toBe(REFERENCE_PRICING_SEPARATION_NOTE)
    expect(field(display!, 'billing_mode')?.value).toBe(
      'alibaba_token_plan_subscription'
    )
    expect(field(display!, 'reference_amount_usd')?.value).toBe('$0.0125')
    expect(field(display!, 'source')?.value).toBe('Alibaba public rate card')
    expect(field(display!, 'status')?.value).toBe('priced')
    expect(field(display!, 'actual_invoice_cost_known')?.value).toBe('false')
    expect(JSON.stringify(detail)).not.toContain('unselected.example')
    expect(selectReferencePricingFields(pricedMetadata)).not.toHaveProperty(
      'reference_cost_source_urls'
    )
  })

  test('keeps a missing contract explicit and does not turn it into zero', () => {
    const detail = projectReferencePricingMetadata({
      model: 'qwen',
      billing_mode: '{"mode":"hidden"}',
      reference_cost_total_usd: '',
    })
    const display = referencePricingDisplayFields(detail)

    expect(detail.contract_coverage).toBe('missing')
    expect(detail.reference_amount_usd).toBeNull()
    expect(detail.reference_amount_coverage).toBe('missing')
    expect(detail.billing_mode).toBeNull()
    expect(detail.actual_invoice_cost_known).toBeNull()
    expect(field(display!, 'reference_amount_usd')?.value).toBeNull()
    expect(field(display!, 'reference_amount_usd')?.coverage).toBe('missing')
    expect(JSON.stringify(display)).not.toContain('$0.00')
    expect(JSON.stringify(display)).not.toContain('hidden')
  })

  test('keeps an explicit zero estimate distinct from a missing amount', () => {
    const detail = projectReferencePricingMetadata({
      billing_mode: 'subscription',
      reference_cost_status: 'priced',
      reference_cost_source_label: 'rate card',
      reference_cost_total_usd: 0,
      actual_invoice_cost_known: false,
    })
    const display = referencePricingDisplayFields(detail)

    expect(detail.reference_amount_usd).toBe(0)
    expect(field(display!, 'reference_amount_usd')?.value).toBe('$0.00')
    expect(detail.actual_invoice_cost_known).toBe(false)
  })

  test('does not let a positive estimate render as zero dollars', () => {
    const detail = projectReferencePricingMetadata({
      billing_mode: 'subscription',
      reference_cost_status: 'priced',
      reference_cost_source_label: 'rate card',
      reference_cost_total_usd: 0.000000004,
      actual_invoice_cost_known: false,
    })
    const amount = field(
      referencePricingDisplayFields(detail)!,
      'reference_amount_usd'
    )

    expect(amount?.value).not.toBe('$0.00')
    expect(amount?.value?.startsWith('$0.000000004')).toBe(true)
  })
})

describe('reference pricing stays separate from recorded spend', () => {
  test('unknown invoice cost stays null while the reference amount stays labelled', () => {
    const { normalizeRow } = __usageReportTestHelpers
    const row = normalizeRow(
      aggregateRow({
        usd_cost: null,
        response_cost_rows: 0,
        provider: 'alibaba',
        model: 'qwen',
      })
    )

    expect(row.usd_cost).toBeNull()
    expect(row.reference_pricing.reference_amount_usd).toBe(0.0125)
    expect(row.reference_pricing.actual_invoice_cost_known).toBe(false)
    expect(row.usd_cost).not.toBe(row.reference_pricing.reference_amount_usd)
    expect(row).not.toHaveProperty('reference_amount_usd')
    expect(row.provider).toBe('alibaba')
  })

  test('a recorded total is not replaced by or summed with the reference estimate', () => {
    const { normalizeRow } = __usageReportTestHelpers
    const recorded = normalizeRow(
      aggregateRow({
        usd_cost: 2,
        response_cost_rows: 1,
        reference_amount_usd: 9,
      })
    )
    const missing = normalizeRow(
      aggregateRow({
        usd_cost: 4.25,
        response_cost_rows: 2,
        reference_amount_usd: 0,
        reference_amount_rows: 0,
        reference_amount_missing_rows: 2,
        reference_billing_modes: [],
        reference_billing_mode_count: 0,
        reference_billing_mode_rows: 0,
        reference_sources: [],
        reference_source_count: 0,
        reference_source_rows: 0,
        reference_statuses: [],
        reference_status_count: 0,
        reference_status_rows: 0,
        reference_invoice_known_rows: 0,
        reference_invoice_unknown_rows: 0,
        reference_invoice_knowledge_missing_rows: 2,
        reference_contract_rows: 0,
        reference_contract_missing_rows: 2,
      })
    )

    expect(recorded.usd_cost).toBe(2)
    expect(recorded.reference_pricing.reference_amount_usd).toBe(9)
    expect(recorded.usd_cost).not.toBe(11)
    expect(missing.usd_cost).toBe(4.25)
    expect(missing.reference_pricing.reference_amount_usd).toBeNull()
    expect(missing.reference_pricing.contract_coverage).toBe('missing')
    expect(missing.reference_pricing.reference_amount_coverage).toBe('missing')
  })

  test('summary and provider rows keep recorded cost and labelled reference coverage apart', () => {
    const summary = projectReferencePricingAggregate(
      aggregateRow({
        reference_amount_rows: 1,
        reference_amount_missing_rows: 1,
        reference_contract_rows: 1,
        reference_contract_missing_rows: 1,
        reference_billing_mode_rows: 2,
        reference_source_rows: 2,
        reference_status_rows: 1,
        reference_invoice_unknown_rows: 2,
      })
    )

    expect(summary.reference_amount_usd).toBe(0.0125)
    expect(summary.reference_amount_coverage).toBe('partial')
    expect(summary.reference_amount_usd).not.toBe(0)
    expect(
      referencePricingDisplayFields(summary)?.fields.find(
        (entry) => entry.key === 'reference_amount_usd'
      )?.coverage
    ).toBe('partial')
  })

  test('compact rows keep a null recorded cost and a null reference detail', () => {
    expect(
      compactUsageRow({
        provider: 'openai',
        usd_cost: null,
        reference_pricing: null,
        cache_miss_summary: null,
      })
    ).toEqual({
      provider: 'openai',
      usd_cost: null,
      reference_pricing: null,
    })
  })
})

describe('reference pricing report surface', () => {
  const params = new URLSearchParams({
    from: '2026-05-01',
    to: '2026-05-08',
    grain: 'day',
    group_by: 'provider,model,repository',
    limit: '25',
  })

  test('usage, summary, and provider queries select reference pricing beside recorded cost', async () => {
    const usage = buildUsageQuery(params)
    const summary = buildSummaryQuery(params)
    const provider = buildProviderStatusUsageQuery(params)
    const recorded =
      'SUM(COALESCE(sh.response_cost_usd, 0))::double precision AS usd_cost'

    for (const query of [usage, summary, provider]) {
      expect(query.sql).toContain(recorded)
      expect(query.sql).toContain('AS reference_amount_usd')
      expect(query.sql).toContain('AS reference_billing_modes')
      expect(query.sql).toContain('AS reference_sources')
      expect(query.sql).toContain('AS reference_statuses')
      expect(query.sql).toContain('AS reference_invoice_unknown_rows')
      expect(query.sql).not.toContain('reference_amount_usd AS usd_cost')
      expect(query.sql).not.toContain('reference_cost_source_urls')
      await expectParsableSql(query.sql)
    }
    for (const query of [usage, summary]) {
      expect(query.sql).toContain('changed_pre_commit_config')
    }
    expect(usage.sql).toContain('AS reference_billing_mode')
    expect(usage.sql).toContain("NULLIF(sh.agent_id, '') AS agent_id")
    expect(usage.sql).toContain(
      "NULLIF(sh.inbound_model_alias, '') AS inbound_model_alias"
    )
  })

  test('session diagnostics project bounded reference fields without changing admission', async () => {
    const query = buildSessionDiagnosticsQuery(params)
    const recentStart = query.sql.indexOf('recent_sessions AS MATERIALIZED')
    const recentEnd = query.sql.indexOf('diagnostic_rows AS')
    const recentSql = query.sql.slice(recentStart, recentEnd)
    const zenAccount = sessionDiagnosticsZenAccountSql({
      metadataExpression: 'metadata',
      providerExpression: 'provider',
    })

    expect(recentStart).toBeGreaterThan(-1)
    expect(recentSql).not.toContain('reference_cost_total_usd')
    expect(query.sql).toContain(
      `${referencePricingSelectedObjectSql('metadata')} AS reference_pricing_selected`
    )
    expect(query.sql).toContain(
      'sh.response_cost_usd::double precision AS response_cost_usd'
    )
    expect(query.sql).toContain("'reference_pricing'::text")
    expect(query.sql).toContain("'cost_detail'::text")
    expect(query.sql).toContain(
      sessionDiagnosticsStreamProjectionSql('metadata')
    )
    expect(query.sql).toContain(
      reasoningEffortDiagnosticsProjectionSql('metadata')
    )
    expect(query.sql).toContain(zenAccount.projectionSql)
    expect(query.sql).toContain(aliasAuditTerminalEvidenceSql('aa'))
    expect(query.sql).toContain("NULLIF(sh.agent_id, '') AS agent_id")
    expect(query.sql).toContain(
      "NULLIF(sh.inbound_model_alias, '') AS inbound_model_alias"
    )
    expect(query.sql).toContain("COALESCE(sh.model, 'unknown') AS model")
    expect(query.sql).not.toContain('reference_cost_source_urls')
    await expectParsableSql(query.sql)
  })

  test('session normalization keeps diagnostics and separates recorded cost from the estimate', () => {
    const { normalizeSessionDiagnosticsRow } = __usageReportTestHelpers
    const row = normalizeSessionDiagnosticsRow({
      agent_id: 'agent_harness',
      inbound_model_alias: 'aawm-read',
      model: 'qwen',
      provider: 'alibaba',
      zen_account_ref: '36f6769913c7',
      diagnostic_flags: ['stream', 'zen_account', 'reasoning_effort_mapping'],
      stream_diagnostics: {
        provider_terminal_observed: false,
        provider_terminal_event_type: 'response.completed',
      },
      response_cost_usd: null,
      reference_pricing_selected: selectReferencePricingFields(pricedMetadata),
      alias_route_events: [],
    })

    expect(row.agent_id).toBe('agent_harness')
    expect(row.inbound_model_alias).toBe('aawm-read')
    expect(row.model).toBe('qwen')
    expect(row.zen_account_ref).toBe('36f6769913c7')
    expect(row.diagnostic_flags).toEqual([
      'stream',
      'zen_account',
      'reasoning_effort_mapping',
    ])
    expect(row.stream_diagnostics.provider_terminal_observed).toBe(false)
    expect(row.response_cost_usd).toBeNull()
    expect(row.reference_pricing.label).toBe(REFERENCE_PRICING_LABEL)
    expect(row.reference_pricing.reference_amount_usd).toBe(0.0125)
    expect(row.reference_pricing.actual_invoice_cost_known).toBe(false)
    expect(row).not.toHaveProperty('usd_cost')
    expect(JSON.stringify(row.reference_pricing)).not.toContain(
      'unselected.example'
    )
  })
})
