/**
 * Wave 7 — plugin-theme-override red-phase test.
 *
 * Component path: src/features/tasks/index.tsx
 * Expected export: Tasks (named)
 *
 * Tests that the tasks route wrapper carries `data-plugin="tasks"` on its
 * outer element and that the scoped CSS variable `--accent-chrome` resolves
 * to `#6366f1` (rgb: 99 102 241).
 *
 * All tests expected to FAIL (red) — the implementation does not exist yet:
 *   - No `data-plugin="tasks"` attribute on the wrapper (Wave 7 will add it)
 *   - No `tasks.module.css` defining `[data-plugin="tasks"] { --accent-chrome: #6366f1; }`
 *
 * jsdom limitation: jsdom does not apply scoped CSS variables from stylesheets,
 * so `getComputedStyle(...).getPropertyValue('--accent-chrome')` will always
 * return an empty string even if the stylesheet is present. The test therefore
 * falls back to scanning `document.styleSheets` for the expected rule.
 */
// @ts-expect-error -- Tasks component does not yet expose data-plugin wrapper (red phase)
import { render } from '@testing-library/react'
import { Tasks } from '@/features/tasks'

test('test_plugin_task_override_var_color', () => {
  const { container } = render(<Tasks />)

  // Step 1: Assert the outer element carries data-plugin="tasks"
  const taskWrapper = container.firstElementChild as HTMLElement
  expect(taskWrapper).not.toBeNull()
  expect(taskWrapper?.getAttribute('data-plugin')).toBe('tasks')

  // Step 2: Try getComputedStyle first (works if jsdom ever gains CSS variable support)
  const computedValue = getComputedStyle(taskWrapper)
    .getPropertyValue('--accent-chrome')
    .trim()

  if (computedValue !== '') {
    // Exact hex or rgb equivalent both acceptable
    expect(['#6366f1', 'rgb(99, 102, 241)']).toContain(computedValue)
    return
  }

  // jsdom limitation: jsdom does not compute scoped CSS custom properties from
  // injected stylesheets — getPropertyValue always returns '' for custom props
  // defined in a selector rule. Fall back to stylesheet scanning.
  let ruleFound = false
  for (let i = 0; i < document.styleSheets.length; i++) {
    let rules: CSSRuleList
    try {
      rules = document.styleSheets[i].cssRules
    } catch {
      // Cross-origin sheet, skip
      continue
    }
    for (let j = 0; j < rules.length; j++) {
      const rule = rules[j] as CSSStyleRule
      if (
        rule.selectorText &&
        rule.selectorText.includes('[data-plugin="tasks"]') &&
        rule.cssText.includes('--accent-chrome') &&
        rule.cssText.includes('#6366f1')
      ) {
        ruleFound = true
        break
      }
    }
    if (ruleFound) break
  }

  // If neither path found the value, the test correctly fails (red state)
  expect(ruleFound).toBe(true)
})
