/**
 * Browser-safe Zen account ref for session diagnostics.
 *
 * The report query projects `left(md5(account_hash), 12)` for a verified
 * OpenCode Zen sha256 digest. This guard accepts only that 12-character
 * shape. Keep the empty-hash sentinel aligned with
 * `server/session-diagnostics-zen-account.mjs`.
 */

export const EMPTY_QUOTA_ACCOUNT_REF = 'd41d8cd98f00'

const BOUNDED_QUOTA_ACCOUNT_REF = /^[a-f0-9]{12}$/

const RAW_ACCOUNT_FIELD_NAMES = [
  'provider_account_hash',
  'account_hash',
  'account_label',
  'caller_identity_hash',
] as const

export function normalizeSessionDiagnosticsZenAccountRef(
  value: unknown
): string | null {
  if (typeof value !== 'string') return null
  const normalized = value.trim().toLowerCase()
  if (!BOUNDED_QUOTA_ACCOUNT_REF.test(normalized)) return null
  if (normalized === EMPTY_QUOTA_ACCOUNT_REF) return null
  return normalized
}

export function sessionDiagnosticsZenAccountLabel(value: unknown): string {
  return normalizeSessionDiagnosticsZenAccountRef(value) ?? 'unknown'
}

function identityLabel(value: string | null | undefined): string {
  if (typeof value !== 'string') return 'unknown'
  const trimmed = value.trim()
  return trimmed || 'unknown'
}

export function sessionDiagnosticsRequestIdentity(row: {
  session_id?: string | null
  trace_id?: string | null
  litellm_call_id?: string | null
  zen_account_ref?: unknown
}): {
  sessionId: string
  traceId: string
  requestId: string
  zenAccountRef: string
} {
  return {
    sessionId: identityLabel(row.session_id),
    traceId: identityLabel(row.trace_id),
    requestId: identityLabel(row.litellm_call_id),
    zenAccountRef: sessionDiagnosticsZenAccountLabel(row.zen_account_ref),
  }
}

export function omitRawSessionAccountFields<T extends object>(value: T): T {
  const copy: Record<string, unknown> = {
    ...(value as Record<string, unknown>),
  }
  for (const key of RAW_ACCOUNT_FIELD_NAMES) {
    delete copy[key]
  }
  return copy as T
}
