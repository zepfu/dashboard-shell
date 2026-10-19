/**
 * Category-level config-change filter vocabulary and coverage counts.
 *
 * Counts come from the usage-report summary. Labels stay on the four public
 * categories and never include file contents, variable names, commands, or paths.
 */
import type {
  UsageReportConfigChangeFields,
  UsageReportConfigChangeFilterValue,
} from '../api/usage-report'

export const CONFIG_CHANGE_FILTER_OPTIONS = [
  'true',
  'false',
  'unknown',
  'evaluated',
] as const satisfies readonly UsageReportConfigChangeFilterValue[]

const CONFIG_CHANGE_FILTER_VALUES = new Set<string>([
  'true',
  'false',
  'null',
  'unknown',
  'evaluated',
  'unevaluated',
])

type ConfigChangeCategory = {
  key:
    | 'changed_pre_commit_config'
    | 'changed_env_file'
    | 'changed_pyproject_toml'
    | 'changed_gitignore'
  label: string
  trueField: keyof UsageReportConfigChangeFields
  falseField: keyof UsageReportConfigChangeFields
  unknownField: keyof UsageReportConfigChangeFields
}

export const CONFIG_CHANGE_CATEGORIES = [
  {
    key: 'changed_pre_commit_config',
    label: 'Pre-commit config',
    trueField: 'changed_pre_commit_config_true_rows',
    falseField: 'changed_pre_commit_config_false_rows',
    unknownField: 'changed_pre_commit_config_unknown_rows',
  },
  {
    key: 'changed_env_file',
    label: 'Env file',
    trueField: 'changed_env_file_true_rows',
    falseField: 'changed_env_file_false_rows',
    unknownField: 'changed_env_file_unknown_rows',
  },
  {
    key: 'changed_pyproject_toml',
    label: 'Pyproject',
    trueField: 'changed_pyproject_toml_true_rows',
    falseField: 'changed_pyproject_toml_false_rows',
    unknownField: 'changed_pyproject_toml_unknown_rows',
  },
  {
    key: 'changed_gitignore',
    label: 'Gitignore',
    trueField: 'changed_gitignore_true_rows',
    falseField: 'changed_gitignore_false_rows',
    unknownField: 'changed_gitignore_unknown_rows',
  },
] as const satisfies readonly ConfigChangeCategory[]

export type ConfigChangeFilterKey =
  (typeof CONFIG_CHANGE_CATEGORIES)[number]['key']

export function isConfigChangeFilterValue(
  value: string
): value is UsageReportConfigChangeFilterValue {
  return CONFIG_CHANGE_FILTER_VALUES.has(value)
}

/** Public label for true / false / unknown-or-unevaluated / evaluated. */
export function formatConfigChangeFilterValue(value: string): string {
  if (value === 'null' || value === 'unknown' || value === 'unevaluated') {
    return 'unknown or unevaluated'
  }
  return value
}

export interface ConfigChangeCategoryCoverage {
  key: ConfigChangeFilterKey
  label: string
  trueRows: number | null
  falseRows: number | null
  unknownRows: number | null
}

export interface ConfigChangeCoverageView {
  evaluatedRows: number | null
  unevaluatedRows: number | null
  anyTrueRows: number | null
  categories: ConfigChangeCategoryCoverage[]
}

function finiteCount(value: number | null | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

export function buildConfigChangeCoverage(
  summary: UsageReportConfigChangeFields | null | undefined
): ConfigChangeCoverageView {
  return {
    evaluatedRows: finiteCount(summary?.config_change_evaluated_rows),
    unevaluatedRows: finiteCount(summary?.config_change_unevaluated_rows),
    anyTrueRows: finiteCount(summary?.config_change_any_true_rows),
    categories: CONFIG_CHANGE_CATEGORIES.map((category) => ({
      key: category.key,
      label: category.label,
      trueRows: finiteCount(summary?.[category.trueField]),
      falseRows: finiteCount(summary?.[category.falseField]),
      unknownRows: finiteCount(summary?.[category.unknownField]),
    })),
  }
}

export function formatConfigChangeCount(value: number | null): string {
  return value === null ? '—' : String(value)
}
