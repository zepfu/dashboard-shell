import { createHash } from 'node:crypto'

/**
 * Verified OpenCode Zen account refs for session diagnostics.
 *
 * Quota rows identify an account with
 * `NULLIF(left(md5(COALESCE(account_hash, '')), 12), left(md5(''), 12))`.
 * Zen stores that account_hash as the selected `sha256:` digest from
 * `derive_opencode_provider_account_hash`. This module projects the same
 * 12-character ref from a verified Zen digest and leaves every other
 * account source unknown.
 */

const QUOTA_ACCOUNT_REF_LENGTH = 12
const ZEN_PROVIDER_ACCOUNT_DIGEST = /^sha256:[0-9a-f]{64}$/
const BOUNDED_QUOTA_ACCOUNT_REF = /^[a-f0-9]{12}$/
const SQL_COLUMN_EXPRESSION =
  /^[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z_][A-Za-z0-9_]*)?$/

const RAW_ACCOUNT_FIELD_NAMES = [
  'provider_account_hash',
  'account_hash',
  'account_label',
  'caller_identity_hash',
]

const ROUTE_METADATA_KEYS = [
  'codex_auto_agent_selected_route_family',
  'passthrough_route_family',
  'openai_passthrough_route_family',
  'route_family',
  'anthropic_auto_agent_selected_route_family',
]

const PROVIDER_METADATA_KEYS = [
  'codex_auto_agent_selected_provider',
  'provider',
  'custom_llm_provider',
]

const ATTRIBUTION_RECORD_KEYS = ['metadata', 'grok_oauth', 'xai_sanitizer']

function md5Hex(value) {
  return createHash('md5').update(value, 'utf8').digest('hex')
}

export const EMPTY_QUOTA_ACCOUNT_REF = md5Hex('').slice(
  0,
  QUOTA_ACCOUNT_REF_LENGTH
)

function assertSqlColumnExpression(value, label) {
  if (typeof value !== 'string' || !SQL_COLUMN_EXPRESSION.test(value)) {
    throw new Error(`${label} must be a bare SQL column reference`)
  }
}

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function normalizedToken(value) {
  return typeof value === 'string' ? value.trim().toLowerCase() : ''
}

function isExplicitTrue(value) {
  return value === true || normalizedToken(value) === 'true'
}

export function verifiedZenProviderAccountDigest(value) {
  if (typeof value !== 'string') return null
  const cleaned = value.trim()
  if (!ZEN_PROVIDER_ACCOUNT_DIGEST.test(cleaned)) return null
  return cleaned
}

export function quotaAccountRefFromAccountHash(accountHash) {
  const canonical = typeof accountHash === 'string' ? accountHash : ''
  const ref = md5Hex(canonical).slice(0, QUOTA_ACCOUNT_REF_LENGTH)
  if (ref === EMPTY_QUOTA_ACCOUNT_REF) return null
  return ref
}

export function boundedQuotaAccountRef(value) {
  if (typeof value !== 'string') return null
  const normalized = value.trim().toLowerCase()
  if (!BOUNDED_QUOTA_ACCOUNT_REF.test(normalized)) return null
  if (normalized === EMPTY_QUOTA_ACCOUNT_REF) return null
  return normalized
}

export function quotaAccountRefSql(accountHashSql) {
  if (typeof accountHashSql !== 'string' || accountHashSql.trim() === '') {
    throw new Error('Quota account hash SQL expression is required')
  }
  if (/[;]|--|\/\*|\*\//.test(accountHashSql)) {
    throw new Error('Quota account hash SQL expression is not allowed')
  }
  return `NULLIF(left(md5(COALESCE(${accountHashSql}, '')), ${QUOTA_ACCOUNT_REF_LENGTH.toString()}), left(md5(''), ${QUOTA_ACCOUNT_REF_LENGTH.toString()}))`
}

function sqlEquals(expression, expected) {
  return `lower(btrim(COALESCE(${expression}, ''))) = '${expected}'`
}

function routeBlobSql(metadataExpression) {
  const parts = ROUTE_METADATA_KEYS.map(
    (key) => `${metadataExpression}->>'${key}'`
  ).join(',\n        ')
  return `lower(concat_ws(' ',\n        ${parts}\n      ))`
}

export function sessionDiagnosticsZenAccountSql({
  metadataExpression,
  providerExpression,
}) {
  assertSqlColumnExpression(metadataExpression, 'Zen metadata column')
  assertSqlColumnExpression(providerExpression, 'Zen provider column')

  const hashExpression = `btrim(${metadataExpression}->>'provider_account_hash')`
  const digestVerified = `${hashExpression} ~ '^sha256:[0-9a-f]{64}$'`
  const routeBlob = routeBlobSql(metadataExpression)
  const providerChecks = [
    sqlEquals(providerExpression, 'opencode_zen'),
    ...PROVIDER_METADATA_KEYS.map((key) =>
      sqlEquals(`${metadataExpression}->>'${key}'`, 'opencode_zen')
    ),
  ]
  const admissionSql = `(
    ${digestVerified}
    AND (
      ${sqlEquals(`${metadataExpression}->>'opencode_zen'`, 'true')}
      OR ${sqlEquals(`${metadataExpression}->>'credential_family'`, 'opencode_zen')}
      OR ${providerChecks.join('\n      OR ')}
      OR position('opencode_zen' in ${routeBlob}) > 0
      OR position('opencode-zen' in ${routeBlob}) > 0
    )
  )`
  const projectionSql = `CASE WHEN ${admissionSql} THEN ${quotaAccountRefSql(hashExpression)} ELSE NULL END`
  return { admissionSql, projectionSql }
}

function attributionRecords(row) {
  if (!isRecord(row)) return []
  const records = [row]
  for (const key of ATTRIBUTION_RECORD_KEYS) {
    if (isRecord(row[key])) records.push(row[key])
  }
  return records
}

function routeHasZen(record) {
  const route = ROUTE_METADATA_KEYS.map((key) => normalizedToken(record[key]))
    .filter(Boolean)
    .join(' ')
  return route.includes('opencode_zen') || route.includes('opencode-zen')
}

function hasVerifiedZenAttribution(records) {
  return records.some((record) => {
    if (isExplicitTrue(record.opencode_zen)) return true
    if (normalizedToken(record.credential_family) === 'opencode_zen') {
      return true
    }
    if (
      PROVIDER_METADATA_KEYS.some(
        (key) => normalizedToken(record[key]) === 'opencode_zen'
      )
    ) {
      return true
    }
    return routeHasZen(record)
  })
}

export function projectVerifiedZenAccountRef(row) {
  const records = attributionRecords(row)
  if (!hasVerifiedZenAttribution(records)) return null
  for (const record of records) {
    const digest = verifiedZenProviderAccountDigest(
      record.provider_account_hash
    )
    if (!digest) continue
    return quotaAccountRefFromAccountHash(digest)
  }
  return null
}

export function resolveSessionDiagnosticsZenAccountRef(row) {
  const projected = projectVerifiedZenAccountRef(row)
  if (projected) return projected
  if (!isRecord(row)) return null
  return boundedQuotaAccountRef(row.zen_account_ref)
}

export function omitRawAccountFields(value) {
  if (!isRecord(value)) return value
  const copy = { ...value }
  for (const key of RAW_ACCOUNT_FIELD_NAMES) {
    delete copy[key]
  }
  return copy
}
