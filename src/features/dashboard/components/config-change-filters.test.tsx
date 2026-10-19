/**
 * D1-503 — config-change filter controls and selected-scope coverage.
 *
 * Filter selections use the public true / false / unknown-or-unevaluated /
 * evaluated vocabulary and travel on the existing aggregate usage contract.
 * Coverage renders summary true, false, and unknown counts per category.
 */
import { fireEvent, render, screen, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { server } from '../../../test/setup'
import {
  fetchUsageReport,
  USAGE_REPORT_DEFAULT_LIMIT,
  type UsageReportConfigChangeFields,
} from '../api/usage-report'
import { usageFilterParams } from '../lib/usage-filter-params'
import { ConfigChangeCoverage } from './config-change-coverage'
import {
  SlicerBar,
  SLICER_EMPTY_FILTERS,
  type SlicerFilters,
  type SlicerOptions,
} from './slicer-bar'

const OPTIONS: SlicerOptions = {
  providers: ['anthropic'],
  repositories: ['dashboard-shell'],
  clients: ['cursor'],
  environments: ['prod'],
  models: ['gpt-4o'],
}

const COVERAGE_SUMMARY = {
  config_change_evaluated_rows: 80,
  config_change_unevaluated_rows: 7,
  config_change_any_true_rows: 44,
  changed_pre_commit_config_true_rows: 11,
  changed_pre_commit_config_false_rows: 12,
  changed_pre_commit_config_unknown_rows: 13,
  changed_env_file_true_rows: 21,
  changed_env_file_false_rows: 0,
  changed_env_file_unknown_rows: 23,
  changed_pyproject_toml_true_rows: 31,
  changed_pyproject_toml_false_rows: 32,
  changed_pyproject_toml_unknown_rows: 33,
  changed_gitignore_true_rows: 41,
  changed_gitignore_false_rows: 42,
  changed_gitignore_unknown_rows: 0,
} as const satisfies UsageReportConfigChangeFields

function usageReportFixture(
  summary: UsageReportConfigChangeFields
): Record<string, unknown> {
  return {
    metadata: {
      from: '2026-05-20',
      to: '2026-05-21',
      grain: 'day',
      groupBy: ['provider', 'model', 'repository'],
      limit: USAGE_REPORT_DEFAULT_LIMIT,
      generatedAt: '2026-05-21T00:00:00.000Z',
      latestRecordAt: null,
      latestRecordAgeMinutes: null,
      latestRecordStale: false,
      staleRecordThresholdMinutes: 60,
      providerErrorObservationRowLimit: 2000,
      providerErrorObservationCapActive: true,
      providerErrorObservationCapTruncatesRequestedWindow: false,
    },
    summary: {
      traces: 87,
      token_in: 0,
      token_out: 0,
      token_cache_input: 0,
      token_cache_creation: 0,
      token_reasoning_reported: 0,
      token_reasoning_estimated: 0,
      token_total: 0,
      usd_cost: 0,
      cache_miss_usd_cost: 0,
      tool_calls: 0,
      git_commit: 0,
      git_push: 0,
      period_start: '2026-05-20',
      period_end: '2026-05-21',
      latest_record_at: null,
      ...summary,
    },
    trend: [],
    clients: [],
    providerLatencyHealth: [],
    providerErrorObservations: [],
    providerStatusUsage: [],
    rows: [],
  }
}

function dimensionRoot(name: RegExp): HTMLElement {
  const trigger = screen.getByRole('button', { name })
  const root = trigger.closest('.slicer-dimension')
  if (!(root instanceof HTMLElement)) {
    throw new Error(`Missing config-change dimension for ${name.source}`)
  }
  return root
}

test('test_config_change_filters_are_visible_clearable_and_forwarded', async () => {
  let capturedUrl: URL | null = null
  server.use(
    http.get('/api/shell/reports/usage', ({ request }) => {
      capturedUrl = new URL(request.url)
      return HttpResponse.json(
        usageReportFixture({
          ...COVERAGE_SUMMARY,
          changed_env_file_contents: 'sample-env-body-marker',
          source_path: '/home/zepfu/projects/app/.env',
          command_text: 'pre-commit run --all-files',
        } as UsageReportConfigChangeFields)
      )
    })
  )

  const onChange = vi.fn()
  let filters: SlicerFilters = { ...SLICER_EMPTY_FILTERS }
  const view = render(
    <SlicerBar filters={filters} options={OPTIONS} onChange={onChange} />
  )

  const select = (triggerName: RegExp, optionName: string): void => {
    fireEvent.click(screen.getByRole('button', { name: triggerName }))
    fireEvent.click(screen.getByRole('option', { name: optionName }))
    filters = onChange.mock.lastCall?.[0] as SlicerFilters
    view.rerender(
      <SlicerBar filters={filters} options={OPTIONS} onChange={onChange} />
    )
  }

  expect(
    screen.getByRole('group', { name: 'Config change filters' })
  ).toBeInTheDocument()
  select(/pre-commit config dimension/i, 'true')
  select(/pre-commit config dimension/i, 'false')
  select(/env file dimension/i, 'false')
  select(/pyproject dimension/i, 'unknown or unevaluated')
  select(/gitignore dimension/i, 'evaluated')

  expect(filters.changed_pre_commit_config).toEqual(['true', 'false'])
  expect(filters.changed_env_file).toEqual(['false'])
  expect(filters.changed_pyproject_toml).toEqual(['unknown'])
  expect(filters.changed_gitignore).toEqual(['evaluated'])

  const preCommit = dimensionRoot(/pre-commit config dimension/i)
  expect(within(preCommit).getByText('true')).toBeInTheDocument()
  expect(within(preCommit).getByText('false')).toBeInTheDocument()
  expect(
    within(dimensionRoot(/env file dimension/i)).getByText('false')
  ).toBeInTheDocument()
  expect(
    within(dimensionRoot(/pyproject dimension/i)).getByText(
      'unknown or unevaluated'
    )
  ).toBeInTheDocument()
  expect(
    within(dimensionRoot(/gitignore dimension/i)).getByText('evaluated')
  ).toBeInTheDocument()

  const report = await fetchUsageReport({
    from: '2026-05-20',
    to: '2026-05-21',
    grain: 'day',
    ...usageFilterParams(filters),
  })

  expect(capturedUrl?.searchParams.get('changed_pre_commit_config')).toBe(
    'true,false'
  )
  expect(capturedUrl?.searchParams.get('changed_env_file')).toBe('false')
  expect(capturedUrl?.searchParams.get('changed_pyproject_toml')).toBe(
    'unknown'
  )
  expect(capturedUrl?.searchParams.get('changed_gitignore')).toBe('evaluated')
  expect(capturedUrl?.search ?? '').not.toMatch(
    /sample-env-body-marker|\/home\/|\.env/
  )

  render(<ConfigChangeCoverage summary={report.summary} />)
  const coverage = screen.getByTestId('config-change-coverage')
  expect(within(coverage).getByText('Selected scope')).toBeInTheDocument()
  expect(screen.getByTestId('config-change-evaluated')).toHaveTextContent(
    'Evaluated 80'
  )
  expect(screen.getByTestId('config-change-unevaluated')).toHaveTextContent(
    'Unevaluated 7'
  )
  expect(screen.getByTestId('config-change-any-true')).toHaveTextContent(
    'Any true 44'
  )
  expect(
    screen.getByTestId('config-change-changed_pre_commit_config-true')
  ).toHaveTextContent('true 11')
  expect(
    screen.getByTestId('config-change-changed_pre_commit_config-false')
  ).toHaveTextContent('false 12')
  expect(
    screen.getByTestId('config-change-changed_pre_commit_config-unknown')
  ).toHaveTextContent('unknown 13')
  expect(
    screen.getByTestId('config-change-changed_env_file-false')
  ).toHaveTextContent('false 0')
  expect(
    screen.getByTestId('config-change-changed_env_file-unknown')
  ).toHaveTextContent('unknown 23')
  expect(
    screen.getByTestId('config-change-changed_pyproject_toml-true')
  ).toHaveTextContent('true 31')
  expect(
    screen.getByTestId('config-change-changed_pyproject_toml-false')
  ).toHaveTextContent('false 32')
  expect(
    screen.getByTestId('config-change-changed_pyproject_toml-unknown')
  ).toHaveTextContent('unknown 33')
  expect(
    screen.getByTestId('config-change-changed_gitignore-true')
  ).toHaveTextContent('true 41')
  expect(
    screen.getByTestId('config-change-changed_gitignore-false')
  ).toHaveTextContent('false 42')
  expect(
    screen.getByTestId('config-change-changed_gitignore-unknown')
  ).toHaveTextContent('unknown 0')

  const coverageText = coverage.textContent ?? ''
  expect(coverageText).toMatch(/not checked/i)
  expect(coverageText).toMatch(/are not false/i)
  expect(coverageText).not.toMatch(/unevaluated[^.]{0,120}no change/i)
  expect(coverageText).not.toMatch(/unknown[^.]{0,120}no change/i)
  expect(coverageText).not.toMatch(/sample-env-body-marker|\/home\/|\.env/)
  expect(coverageText).not.toMatch(/pre-commit run/i)

  fireEvent.click(
    within(preCommit).getByRole('button', {
      name: /remove false from pre-commit config filter/i,
    })
  )
  filters = onChange.mock.lastCall?.[0] as SlicerFilters
  expect(filters.changed_pre_commit_config).toEqual(['true'])
  view.rerender(
    <SlicerBar filters={filters} options={OPTIONS} onChange={onChange} />
  )
  expect(
    within(dimensionRoot(/pre-commit config dimension/i)).queryByText('false')
  ).toBeNull()
  expect(
    within(dimensionRoot(/pre-commit config dimension/i)).getByText('true')
  ).toBeInTheDocument()

  fireEvent.click(
    screen.getByRole('button', { name: /clear all dimension filters/i })
  )
  filters = onChange.mock.lastCall?.[0] as SlicerFilters
  expect(filters.changed_pre_commit_config).toEqual([])
  expect(filters.changed_env_file).toEqual([])
  expect(filters.changed_pyproject_toml).toEqual([])
  expect(filters.changed_gitignore).toEqual([])
  view.rerender(
    <SlicerBar filters={filters} options={OPTIONS} onChange={onChange} />
  )
  expect(
    screen.queryByRole('button', { name: /clear all dimension filters/i })
  ).toBeNull()
  expect(screen.queryByText('unknown or unevaluated')).toBeNull()
  expect(screen.queryByText('evaluated')).toBeNull()
})

test('test_config_change_coverage_keeps_missing_counts_distinct_from_zero', () => {
  render(<ConfigChangeCoverage summary={undefined} />)

  expect(screen.getByTestId('config-change-evaluated')).toHaveTextContent(
    'Evaluated —'
  )
  expect(screen.getByTestId('config-change-unevaluated')).toHaveTextContent(
    'Unevaluated —'
  )
  expect(screen.getByTestId('config-change-any-true')).toHaveTextContent(
    'Any true —'
  )
  expect(
    screen.getByTestId('config-change-changed_env_file-false')
  ).toHaveTextContent('false —')
  expect(
    screen.getByTestId('config-change-changed_env_file-unknown')
  ).toHaveTextContent('unknown —')
  expect(
    screen.getByTestId('config-change-coverage').textContent ?? ''
  ).not.toMatch(/unevaluated[^.]{0,120}no change/i)
})
