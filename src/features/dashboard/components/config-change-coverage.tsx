/**
 * Selected-scope config-change coverage from usage-report summary counts.
 *
 * Category labels and true / false / unknown counts only. Unevaluated rows are
 * rows that were not checked; this panel does not treat them as false.
 */
import type { ReactElement } from 'react'
import type { UsageReportConfigChangeFields } from '../api/usage-report'
import {
  buildConfigChangeCoverage,
  formatConfigChangeCount,
} from '../lib/config-change-reporting'

export interface ConfigChangeCoverageProps {
  summary?: UsageReportConfigChangeFields | null
}

export function ConfigChangeCoverage({
  summary,
}: ConfigChangeCoverageProps): ReactElement {
  const coverage = buildConfigChangeCoverage(summary)

  return (
    <section
      className='config-change-coverage'
      aria-label='Config change coverage'
      data-testid='config-change-coverage'
    >
      <div className='config-change-coverage-title'>Config change coverage</div>
      <p className='config-change-coverage-scope-label'>Selected scope</p>
      <ul className='config-change-coverage-scope'>
        <li data-testid='config-change-evaluated'>
          Evaluated {formatConfigChangeCount(coverage.evaluatedRows)}
        </li>
        <li data-testid='config-change-unevaluated'>
          Unevaluated {formatConfigChangeCount(coverage.unevaluatedRows)}
        </li>
        <li data-testid='config-change-any-true'>
          Any true {formatConfigChangeCount(coverage.anyTrueRows)}
        </li>
      </ul>
      <ul className='config-change-coverage-categories'>
        {coverage.categories.map((category) => (
          <li key={category.key} data-testid={`config-change-${category.key}`}>
            <span className='config-change-coverage-category'>
              {category.label}
            </span>
            <span data-testid={`config-change-${category.key}-true`}>
              true {formatConfigChangeCount(category.trueRows)}
            </span>
            <span data-testid={`config-change-${category.key}-false`}>
              false {formatConfigChangeCount(category.falseRows)}
            </span>
            <span data-testid={`config-change-${category.key}-unknown`}>
              unknown {formatConfigChangeCount(category.unknownRows)}
            </span>
          </li>
        ))}
      </ul>
      <p className='config-change-coverage-note'>
        Evaluated rows were checked for at least one category. Unevaluated rows
        were not checked and are not false. False is a checked false flag.
        Unknown means that category was not checked.
      </p>
    </section>
  )
}
