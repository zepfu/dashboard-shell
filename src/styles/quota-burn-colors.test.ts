import fs from 'node:fs'
import path from 'node:path'

const css = fs.readFileSync(path.resolve('src/styles/index.css'), 'utf8')

function readRule(selector: string): string {
  const escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const match = css.match(
    new RegExp(`${escapedSelector}\\s*\\{([^}]*)\\}`, 's')
  )
  return match?.[1] ?? ''
}

const burnTiers = [
  ['slow', '--quota-burn-slow'],
  ['steady', '--quota-burn-steady'],
  ['fast', '--quota-burn-fast'],
  ['hot', '--quota-burn-hot'],
  ['peak', '--quota-burn-peak'],
] as const

test.each(burnTiers)(
  'test_burn_legend_and_actual_bar_share_%s_color',
  (tier, cssVariable) => {
    const legendRule = readRule(`.status-legend-swatch.velocity-${tier}`)
    const barRule = readRule(`.quota-row-bar .quota-interval.velocity-${tier}`)

    expect(legendRule).toContain(`background: var(${cssVariable});`)
    expect(barRule).toContain(`background: var(${cssVariable});`)
  }
)
