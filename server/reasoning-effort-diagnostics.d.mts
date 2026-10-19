export interface ReasoningEffortDiagnostics {
  reasoning_effort_requested: string | null
  reasoning_effort_source: string | null
  reasoning_effort_native_provider: string | null
  reasoning_effort_native_value: string | null
  reasoning_effort_native_field: string | null
  reasoning_effort_supported_ceiling: string | null
  reasoning_effort_resolved_model: string | null
  reasoning_effort_resolved_provider: string | null
  reasoning_effort_candidate_attempt: number | null
  reasoning_effort_mapping_reason: string | null
  reasoning_effort_clamped_from: string | null
  reasoning_effort_clamp_reason: string | null
  reasoning_effort_config_value: string | null
  reasoning_effort_config_source: string | null
}

export interface ReasoningEffortDisplayField {
  readonly key: keyof ReasoningEffortDiagnostics
  readonly label: string
}

export const REASONING_EFFORT_MAPPING_SCALARS: readonly string[]
export const REASONING_EFFORT_ATTEMPT_CONFIG_SCALARS: readonly string[]
export const REASONING_EFFORT_DIAGNOSTIC_KEYS: readonly string[]
export const REASONING_EFFORT_RECONCILIATION_NOTE: string
export const REASONING_EFFORT_SCOPE_NOTE: string
export const REASONING_EFFORT_DISPLAY_FIELDS: readonly ReasoningEffortDisplayField[]

export function reasoningEffortMetadataPresentSql(columnPrefix?: string): string

export function reasoningEffortDiagnosticsProjectionSql(
  metadataExpr: string
): string

export function reasoningEffortDiagnosticFlagSql(columnPrefix?: string): string

export function reasoningEffortDiagnosticCategorySql(
  columnPrefix?: string
): string

export function normalizeReasoningEffortDiagnostics(
  value: unknown
): ReasoningEffortDiagnostics | null

export function formatReasoningEffortScalar(value: unknown): string

export const REASONING_EFFORT_PRODUCER_FIXTURES: {
  readonly unchangedMapping: Readonly<Record<string, string | number>>
  readonly ceilingClampProviderMapping: Readonly<
    Record<string, string | number>
  >
  readonly candidateOverride: Readonly<Record<string, string | number>>
  readonly missingMetadata: Readonly<Record<string, string | number>>
  readonly partialMissing: Readonly<Record<string, string | number>>
}
