import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, expect, test } from 'vitest'
import {
  projectReferencePricingMetadata,
  referencePricingDisplayFields,
} from '../../../../server/reference-pricing-projection.mjs'
import type { UsageReportSessionDiagnosticsResponse } from '../api/usage-report'
import { buildModelRows } from '../lib/ledger-rows'
import {
  LedgerRecordedCost,
  ReferencePricingDetail,
} from './reference-pricing-detail'
import { SessionDiagnosticsPanel } from './status-section/session-diagnostics-panel'

const priced = projectReferencePricingMetadata({
  billing_mode: 'alibaba_token_plan_subscription',
  reference_cost_status: 'priced',
  reference_cost_source_label: 'Alibaba public rate card',
  reference_cost_total_usd: 0.0125,
  actual_invoice_cost_known: false,
})

const missing = projectReferencePricingMetadata({
  model: 'qwen',
})

afterEach(() => {
  cleanup()
})

function text(testId: string) {
  return screen.getByTestId(testId).textContent ?? ''
}

test('session detail shows reference fields separately from recorded cost', () => {
  render(
    <ReferencePricingDetail detail={priced} recordedResponseCostUsd={1.25} />
  )

  expect(text('reference-pricing-detail')).toContain(
    'Separate from recorded response cost and invoice totals.'
  )
  expect(text('reference-pricing-recorded-response-cost')).toContain('$1.25')
  expect(text('reference-pricing-billing_mode')).toContain(
    'alibaba_token_plan_subscription'
  )
  expect(text('reference-pricing-reference_amount_usd')).toContain('$0.0125')
  expect(text('reference-pricing-source')).toContain('Alibaba public rate card')
  expect(text('reference-pricing-status')).toContain('priced')
  expect(text('reference-pricing-actual_invoice_cost_known')).toContain('false')
  expect(text('reference-pricing-reference_amount_usd')).not.toContain('$1.25')
  expect(text('reference-pricing-detail')).not.toContain('$1.2625')
})

test('missing reference coverage stays explicit and unknown invoice cost stays unknown', () => {
  render(
    <ReferencePricingDetail detail={missing} recordedResponseCostUsd={null} />
  )

  expect(text('reference-pricing-recorded-response-cost')).toContain('unknown')
  expect(text('reference-pricing-recorded-response-cost')).not.toContain(
    '$0.00'
  )
  expect(text('reference-pricing-reference_amount_usd')).toContain('missing')
  expect(text('reference-pricing-billing_mode')).toContain('missing')
  expect(text('reference-pricing-source')).toContain('missing')
  expect(text('reference-pricing-status')).toContain('missing')
  expect(text('reference-pricing-actual_invoice_cost_known')).toContain(
    'missing'
  )
  expect(text('reference-pricing-detail')).not.toContain('$0.00')
})

test('an absent reference detail is not invented', () => {
  render(<ReferencePricingDetail detail={undefined} />)
  expect(screen.queryByTestId('reference-pricing-detail')).toBeNull()
})

test('the ledger cost cell keeps recorded spend apart from the reference amount', () => {
  render(
    <LedgerRecordedCost recordedCostUsd={null} referencePricing={priced} />
  )

  expect(text('ledger-recorded-cost')).toBe('—')
  expect(text('reference-pricing-reference_amount_usd')).toContain('$0.0125')
  expect(text('ledger-recorded-cost')).not.toContain('0.0125')
  expect(
    screen.queryByTestId('reference-pricing-recorded-response-cost')
  ).toBeNull()
})

test('session diagnostics renders the labelled reference pricing block', () => {
  const response: UsageReportSessionDiagnosticsResponse = {
    metadata: { from: '2026-05-01', to: '2026-05-08', limit: 1 },
    sessionDiagnostics: [
      {
        session_id: 'sess-ref',
        provider: 'alibaba',
        model: 'qwen',
        created_at: '2026-05-01T00:00:00Z',
        response_cost_usd: null,
        reference_pricing: priced,
      },
    ],
  }

  render(<SessionDiagnosticsPanel response={response} loading={false} />)

  expect(text('reference-pricing-recorded-response-cost')).toContain('unknown')
  expect(text('reference-pricing-billing_mode')).toContain(
    'alibaba_token_plan_subscription'
  )
  expect(text('reference-pricing-reference_amount_usd')).toContain('$0.0125')
  expect(text('reference-pricing-source')).toContain('Alibaba public rate card')
  expect(text('reference-pricing-status')).toContain('priced')
  expect(text('reference-pricing-actual_invoice_cost_known')).toContain('false')
})

test('model rows carry the reference detail without changing recorded cost', () => {
  const rows = buildModelRows(
    [
      {
        provider: 'alibaba',
        model: 'qwen',
        traces: 2,
        token_total: 20,
        usd_cost: null,
        period_start: null,
        period_end: null,
        reference_pricing: priced,
      },
    ],
    [],
    [],
    []
  )

  expect(rows[0]?.cost_usd).toBeNull()
  expect(rows[0]?.reference_pricing?.reference_amount_usd).toBe(0.0125)
  expect(rows[0]?.reference_pricing?.label).toBe('reference_pricing')
  expect(
    referencePricingDisplayFields(rows[0]?.reference_pricing)?.note
  ).toContain('Separate from recorded response cost')
})
