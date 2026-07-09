/**
 * Shared usage-report filter fan-out helpers (P04-F07).
 *
 * Both `index.tsx` and `phosphor-dashboard.tsx` must map the same SlicerFilters
 * shape into fetch params + React Query key parts. Keeping the mapping in one
 * place prevents the six inlined call sites from drifting.
 */
import type { SlicerFilters } from '../components/slicer-bar'

/** API param names are singular (provider/repository/…) per report-service. */
export interface UsageFilterParams {
  provider: string[] | undefined
  repository: string[] | undefined
  client: string[] | undefined
  environment: string[] | undefined
  model: string[] | undefined
}

type UsageFilterSource = Pick<
  SlicerFilters,
  'providers' | 'repositories' | 'clients' | 'environments' | 'models'
>

/**
 * Map slicer filter arrays onto the singular fetchUsageReport* param names.
 * Empty arrays mean "no filter" at the API layer.
 */
export function usageFilterParams(
  filters?: UsageFilterSource | null
): UsageFilterParams {
  return {
    provider: filters?.providers,
    repository: filters?.repositories,
    client: filters?.clients,
    environment: filters?.environments,
    model: filters?.models,
  }
}

/**
 * Stable React Query key fragment for the five slicer dimensions, in the same
 * order used by every usage-report queryKey in the dashboard.
 */
export function usageFilterKeyParts(
  filters?: UsageFilterSource | null
): readonly [
  string[] | undefined,
  string[] | undefined,
  string[] | undefined,
  string[] | undefined,
  string[] | undefined,
] {
  return [
    filters?.providers,
    filters?.repositories,
    filters?.clients,
    filters?.environments,
    filters?.models,
  ]
}
