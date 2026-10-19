/**
 * Fork-review Wave 3 — P04-F07 shared usage filter helpers (RED).
 */
import { describe, expect, test } from 'vitest'
import type { SlicerFilters } from '../components/slicer-bar'
import { usageFilterKeyParts, usageFilterParams } from './usage-filter-params'

const SAMPLE_FILTERS: SlicerFilters = {
  providers: ['anthropic', 'openai'],
  repositories: ['dashboard-shell'],
  clients: ['claude-code'],
  environments: ['production'],
  models: ['claude-sonnet-4-6'],
}

describe('usage filter shared helpers — P04-F07', () => {
  test('test_usage_filter_params_shared_helper', () => {
    const params = usageFilterParams(SAMPLE_FILTERS)
    const keyParts = usageFilterKeyParts(SAMPLE_FILTERS)

    expect(params).toEqual({
      provider: SAMPLE_FILTERS.providers,
      repository: SAMPLE_FILTERS.repositories,
      client: SAMPLE_FILTERS.clients,
      environment: SAMPLE_FILTERS.environments,
      model: SAMPLE_FILTERS.models,
      changed_pre_commit_config: undefined,
      changed_env_file: undefined,
      changed_pyproject_toml: undefined,
      changed_gitignore: undefined,
    })

    expect(keyParts).toEqual([
      SAMPLE_FILTERS.providers,
      SAMPLE_FILTERS.repositories,
      SAMPLE_FILTERS.clients,
      SAMPLE_FILTERS.environments,
      SAMPLE_FILTERS.models,
      undefined,
      undefined,
      undefined,
      undefined,
    ])

    expect(keyParts).toEqual([
      params.provider,
      params.repository,
      params.client,
      params.environment,
      params.model,
      params.changed_pre_commit_config,
      params.changed_env_file,
      params.changed_pyproject_toml,
      params.changed_gitignore,
    ])
  })

  test('test_usage_filter_params_forwards_config_change_filters', () => {
    const filters: SlicerFilters = {
      ...SAMPLE_FILTERS,
      changed_pre_commit_config: ['true', 'false'],
      changed_env_file: ['false'],
      changed_pyproject_toml: ['unknown'],
      changed_gitignore: ['evaluated'],
    }
    const params = usageFilterParams(filters)

    expect(params.changed_pre_commit_config).toEqual(['true', 'false'])
    expect(params.changed_env_file).toEqual(['false'])
    expect(params.changed_pyproject_toml).toEqual(['unknown'])
    expect(params.changed_gitignore).toEqual(['evaluated'])
    expect(usageFilterKeyParts(filters).slice(5)).toEqual([
      ['true', 'false'],
      ['false'],
      ['unknown'],
      ['evaluated'],
    ])
  })
})
