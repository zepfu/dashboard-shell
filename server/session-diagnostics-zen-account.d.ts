export {}

declare module './session-diagnostics-zen-account.mjs' {
  export const EMPTY_QUOTA_ACCOUNT_REF: string

  export function verifiedZenProviderAccountDigest(
    value: unknown
  ): string | null
  export function quotaAccountRefFromAccountHash(
    accountHash: unknown
  ): string | null
  export function boundedQuotaAccountRef(value: unknown): string | null
  export function quotaAccountRefSql(accountHashSql: string): string
  export function sessionDiagnosticsZenAccountSql(options: {
    metadataExpression: string
    providerExpression: string
  }): {
    admissionSql: string
    projectionSql: string
  }
  export function projectVerifiedZenAccountRef(
    row: Record<string, unknown> | null | undefined
  ): string | null
  export function resolveSessionDiagnosticsZenAccountRef(
    row: Record<string, unknown> | null | undefined
  ): string | null
  export function omitRawAccountFields<T>(value: T): T
}
