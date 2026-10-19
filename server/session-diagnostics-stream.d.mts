export const SESSION_DIAGNOSTICS_STREAM_STRING_LIMIT: number

export function sessionDiagnosticsStreamMetadataPresentSql(
  metadataExpr?: string
): string

export function sessionDiagnosticsStreamFlagSql(metadataExpr?: string): string

export function sessionDiagnosticsStreamCategorySql(
  metadataExpr?: string
): string

export function sessionDiagnosticsStreamProjectionSql(
  metadataExpr?: string
): string

export function normalizeSessionDiagnosticsStream(
  value: unknown
): Record<string, unknown> | null
