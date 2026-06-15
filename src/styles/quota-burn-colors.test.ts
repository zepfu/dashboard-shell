/**
 * S6-T6 — quota-burn-colors: burn tier CSS variables are defined AND applied
 * consistently between the legend swatches and the actual quota bars.
 *
 * Wave 10 cleanup: strengthened from a bare CSS-text-grep to:
 *   1. Assert each `--quota-burn-*` variable is DEFINED in the CSS source
 *      (`:root` / global scope) — not just referenced.
 *   2. Assert each variable is APPLIED in BOTH the legend swatch selector AND
 *      the quota-row-bar selector (consistency guard; prior issue: swatch and
 *      bar using different variables for the same tier).
 *
 * TRIPWIRE note: these are raw-text grep tests against `src/styles/index.css`.
 * They verify definition and consistent referencing in source, not that the
 * computed color renders correctly in a browser. To move beyond tripwires,
 * add a visual regression test or inject the CSS into jsdom and read
 * `getComputedStyle(...).backgroundColor` for an element with the class applied.
 */
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

/**
 * Assert that a CSS custom property is DEFINED (not just referenced) somewhere
 * in the CSS source. Looks for `--quota-burn-X: value;` pattern.
 */
function assertBurnVarDefined(cssVariable: string): void {
  // Match `--quota-burn-x: #hex;` at top level (not inside a selector rule body)
  const defined = new RegExp(
    `${cssVariable.replace(/[-]/g, '\\-')}\\s*:\\s*[^;]+;`
  ).test(css)
  expect({ cssVariable, defined }).toMatchObject({ cssVariable, defined: true })
}

const burnTiers = [
  ['slow', '--quota-burn-slow'],
  ['steady', '--quota-burn-steady'],
  ['fast', '--quota-burn-fast'],
  ['hot', '--quota-burn-hot'],
  ['peak', '--quota-burn-peak'],
] as const

// ---------------------------------------------------------------------------
// 1. Variable DEFINITION tests — each burn variable must be defined in the CSS
// ---------------------------------------------------------------------------

test.each(burnTiers)(
  'test_burn_var_%s_is_defined_in_css_source',
  (_tier, cssVariable) => {
    /**
     * TRIPWIRE: asserts the `--quota-burn-X` variable is defined in the CSS
     * source (e.g. in :root { }). If this fails, the var reference in the
     * selectors below would resolve to an empty string in the browser.
     */
    assertBurnVarDefined(cssVariable)
  }
)

// ---------------------------------------------------------------------------
// 2. Consistency tests — legend swatch AND actual bar must use the same var
// ---------------------------------------------------------------------------

test.each(burnTiers)(
  'test_burn_legend_and_actual_bar_share_%s_color',
  (tier, cssVariable) => {
    /**
     * TRIPWIRE: asserts that BOTH the legend swatch and the quota bar apply
     * the same CSS variable for each tier.
     *
     * Verifies consistency: if a designer changes one selector, this test
     * catches the divergence before it reaches production.
     *
     * To strengthen: render a swatch + bar element in jsdom with the class
     * applied and compare `getComputedStyle(...).backgroundColor` values.
     */
    const legendRule = readRule(`.status-legend-swatch.velocity-${tier}`)
    const barRule = readRule(`.quota-row-bar .quota-interval.velocity-${tier}`)

    // Both selectors must reference the same variable
    expect(legendRule).toContain(`background: var(${cssVariable});`)
    expect(barRule).toContain(`background: var(${cssVariable});`)
  }
)

// ---------------------------------------------------------------------------
// 3. Completeness test — all 5 tiers must be covered in both selectors
// ---------------------------------------------------------------------------

test('test_all_five_burn_tiers_have_both_legend_and_bar_rules', () => {
  /**
   * Guard that no tier is accidentally left without a rule in either
   * the legend or the bar — both must be present for all 5 tiers.
   *
   * TRIPWIRE: raw-text grep; does not verify rendering.
   */
  for (const [tier] of burnTiers) {
    const legendRule = readRule(`.status-legend-swatch.velocity-${tier}`)
    const barRule = readRule(`.quota-row-bar .quota-interval.velocity-${tier}`)

    expect({ tier, legendDefined: legendRule !== '' }).toMatchObject({
      tier,
      legendDefined: true,
    })
    expect({ tier, barDefined: barRule !== '' }).toMatchObject({
      tier,
      barDefined: true,
    })
  }
})
