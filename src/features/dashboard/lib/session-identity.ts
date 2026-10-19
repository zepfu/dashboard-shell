/**
 * Session identity display and filter values.
 *
 * Display names and the selected provider model are separate from durable
 * identity. Blank agent ids and inbound aliases stay unknown in the UI.
 * Filter values use the existing report-service sentinels so absent rows match
 * the usage-report contract without copying another field into the gap.
 */

/** Matches filterColumns.agent_id in report-service.mjs. */
export const UNCAPTURED_AGENT_ID_FILTER = 'uncaptured_agent_id'

/** Matches filterColumns.inbound_model_alias in report-service.mjs. */
export const UNKNOWN_INBOUND_MODEL_FILTER = 'unknown_inbound_model'

export function displaySessionIdentityValue(
  value: string | null | undefined
): string {
  if (value === null || value === undefined || value === '') return 'unknown'
  return value
}

/**
 * Exact filter options from observed identity values.
 *
 * `undefined` means the field was not present and is ignored. `null` or `''`
 * means the source recorded no identity, so the API sentinel is offered.
 * Selected values stay listed so a cleared option set does not hide an active
 * filter. Callers must not pass agent display names or selected models.
 */
export function sessionIdentityFilterOptions(
  values: readonly (string | null | undefined)[],
  absentSentinel: string,
  selected?: readonly string[]
): string[] {
  const seen = new Set<string>()
  let sawAbsent = false
  for (const value of values) {
    if (value === undefined) continue
    if (value === null || value === '') {
      sawAbsent = true
      continue
    }
    seen.add(value)
  }
  if (sawAbsent) seen.add(absentSentinel)
  for (const value of selected ?? []) {
    if (value !== '') seen.add(value)
  }
  return [...seen].sort()
}
