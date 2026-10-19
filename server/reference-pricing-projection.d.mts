export const REFERENCE_PRICING_LABEL: 'reference_pricing'
export const REFERENCE_PRICING_DISTINCT_LIMIT: number
export const REFERENCE_PRICING_AGGREGATE_KEYS: readonly string[]

export type ReferencePricingCoverage =
  | 'unknown'
  | 'missing'
  | 'partial'
  | 'known'
  | 'mixed'
  | 'present'

export interface ReferencePricingDetail {
  label: 'reference_pricing'
  billing_mode: string | null
  billing_modes: string[]
  billing_mode_coverage: ReferencePricingCoverage
  billing_modes_truncated: boolean
  reference_amount_usd: number | null
  reference_amount_coverage: ReferencePricingCoverage
  reference_amount_rows: number
  reference_amount_missing_rows: number
  source: string | null
  sources: string[]
  source_coverage: ReferencePricingCoverage
  sources_truncated: boolean
  status: string | null
  statuses: string[]
  status_coverage: ReferencePricingCoverage
  statuses_truncated: boolean
  actual_invoice_cost_known: boolean | null
  actual_invoice_cost_knowledge_coverage: ReferencePricingCoverage
  actual_invoice_cost_known_rows: number
  actual_invoice_cost_unknown_rows: number
  actual_invoice_cost_knowledge_missing_rows: number
  contract_coverage: ReferencePricingCoverage
  contract_rows: number
  contract_missing_rows: number
}

export function referencePricingFilteredColumnSelectSql(alias?: string): string

export function referencePricingAggregateSelectSql(
  alias?: string,
  options?: { fromFiltered?: boolean }
): string

export function referencePricingSelectedObjectSql(
  metadataExpression?: string
): string

export function selectReferencePricingFields(
  metadata: unknown
): Record<string, unknown> | null

export function projectReferencePricingSelected(
  selected: unknown
): ReferencePricingDetail

export function projectReferencePricingMetadata(
  metadata: unknown
): ReferencePricingDetail

export function projectReferencePricingAggregate(
  row: Record<string, unknown> | null | undefined
): ReferencePricingDetail

export function attachReferencePricingDetail(
  row: Record<string, unknown> | null | undefined
): Record<string, unknown>

export const REFERENCE_PRICING_SEPARATION_NOTE: string

export function referencePricingContractPresentSql(
  metadataExpression?: string
): string

export function sanitizeReferencePricingDetail(
  value: unknown
): ReferencePricingDetail | null

export interface ReferencePricingDisplayField {
  key:
    | 'billing_mode'
    | 'reference_amount_usd'
    | 'source'
    | 'status'
    | 'actual_invoice_cost_known'
  label: string
  value: string | null
  coverage: ReferencePricingCoverage
  truncated: boolean
}

export interface ReferencePricingDisplay {
  label: 'reference_pricing'
  note: string
  fields: ReferencePricingDisplayField[]
}

export function referencePricingDisplayFields(
  value: unknown
): ReferencePricingDisplay | null
