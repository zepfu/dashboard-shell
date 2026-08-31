/**
 * D1-493 — token-trend provider colors have one rendering owner.
 *
 * The chart resolver supplies inline slice and swatch colors. Provider CSS
 * classes remain structural hooks and must not define a competing palette.
 */
import fs from 'node:fs'
import path from 'node:path'

const css = fs.readFileSync(path.resolve('src/styles/index.css'), 'utf8')
const dashboardSource = fs.readFileSync(
  path.resolve('src/features/dashboard/components/phosphor-dashboard.tsx'),
  'utf8'
)

function parseProviderSeries(): string[] {
  const blockMatch = dashboardSource.match(
    /const PROVIDER_SERIES[^=]*=\s*\[([\s\S]*?)\n\]/
  )
  if (!blockMatch) return []

  const entries: string[] = []
  const objectRe = /\{[^{}]*\}/g
  let obj: RegExpExecArray | null
  while ((obj = objectRe.exec(blockMatch[1])) !== null) {
    const cssClass = obj[0].match(/cssClass:\s*'([^']+)'/)?.[1]
    if (cssClass) entries.push(cssClass)
  }
  return entries
}

const providerSeries = parseProviderSeries()

test('test_provider_series_colors_are_not_duplicated_in_css', () => {
  expect(providerSeries.length).toBeGreaterThan(0)

  for (const cssClass of providerSeries) {
    const escaped = cssClass.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    expect(css).not.toMatch(
      new RegExp(`\\.tt-(?:slice|swatch)\\.${escaped}\\b`)
    )
  }
})

test('test_token_trend_source_uses_resolved_inline_slice_and_swatch_colors', () => {
  const chartSource = fs.readFileSync(
    path.resolve('src/features/dashboard/components/token-trend-chart.tsx'),
    'utf8'
  )

  expect(chartSource).toContain('function resolveSliceColor')
  expect(chartSource).toContain('background: resolveSliceColor(s.key, s.color)')
  expect(chartSource).toContain('resolveColor={resolveSliceColor}')
})
