export class CodexReviewDecisionsQueryError extends Error {
  name: string
}

export const CODEX_REVIEW_DECISION_RATIONALE_MAX_CHARS: number
export const CODEX_REVIEW_DECISION_LABEL_MAX_CHARS: number
export const CODEX_REVIEW_DECISION_IDENTITY_HASH_CHARS: number
export const CODEX_REVIEW_DECISION_SQL_TEXT_CAP: number
export const CODEX_REVIEW_DECISIONS_DEFAULT_LIMIT: number
export const CODEX_REVIEW_DECISIONS_MAX_LIMIT: number
export const CODEX_REVIEW_DECISIONS_TABLE: string

type SearchParamsLike = {
  get(name: string): string | null
}

export function sanitizeCodexReviewDecisionRationale(value: unknown): {
  text: string | null
  truncated: boolean
}

export function buildCodexReviewDecisionsQuery(
  searchParams: SearchParamsLike,
  options?: { from?: string; to?: string }
): {
  sql: string
  values: unknown[]
  metadata: {
    from: string
    to: string
    limit: number
    decisionKey: string | null
    detail: boolean
  }
}

export function normalizeCodexReviewDecisionRow(
  row: Record<string, unknown>
): Record<string, unknown> | null

export function normalizeCodexReviewDecisionRows(
  rows: readonly unknown[]
): Record<string, unknown>[]
