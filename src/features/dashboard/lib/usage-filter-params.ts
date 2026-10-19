/**
 * Shared usage-report filter fan-out helpers (P04-F07).
 *
 * Both `index.tsx` and `phosphor-dashboard.tsx` must map the same SlicerFilters
 * shape into fetch params + React Query key parts. Keeping the mapping in one
 * place prevents the six inlined call sites from drifting.
 */
import type { UsageReportConfigChangeFilterValue } from '../api/usage-report'
import type { SlicerFilters } from '../components/slicer-bar'

/** API param names are singular (provider/repository/…) per report-service. */
export interface UsageFilterParams {
  provider: string[] | undefined
  repository: string[] | undefined
  client: string[] | undefined
  environment: string[] | undefined
  model: string[] | undefined
  changed_pre_commit_config: UsageReportConfigChangeFilterValue[] | undefined
  changed_env_file: UsageReportConfigChangeFilterValue[] | undefined
  changed_pyproject_toml: UsageReportConfigChangeFilterValue[] | undefined
  changed_gitignore: UsageReportConfigChangeFilterValue[] | undefined
}

type UsageFilterSource = Pick<
  SlicerFilters,
  | 'providers'
  | 'repositories'
  | 'clients'
  | 'environments'
  | 'models'
  | 'changed_pre_commit_config'
  | 'changed_env_file'
  | 'changed_pyproject_toml'
  | 'changed_gitignore'
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
    changed_pre_commit_config: filters?.changed_pre_commit_config,
    changed_env_file: filters?.changed_env_file,
    changed_pyproject_toml: filters?.changed_pyproject_toml,
    changed_gitignore: filters?.changed_gitignore,
  }
}

/**
 * Stable React Query key fragment for slicer dimensions plus config-change
 * filters, in the same order used by every usage-report queryKey.
 */
export function usageFilterKeyParts(
  filters?: UsageFilterSource | null
): readonly [
  string[] | undefined,
  string[] | undefined,
  string[] | undefined,
  string[] | undefined,
  string[] | undefined,
  UsageReportConfigChangeFilterValue[] | undefined,
  UsageReportConfigChangeFilterValue[] | undefined,
  UsageReportConfigChangeFilterValue[] | undefined,
  UsageReportConfigChangeFilterValue[] | undefined,
] {
  return [
    filters?.providers,
    filters?.repositories,
    filters?.clients,
    filters?.environments,
    filters?.models,
    filters?.changed_pre_commit_config,
    filters?.changed_env_file,
    filters?.changed_pyproject_toml,
    filters?.changed_gitignore,
  ]
}
