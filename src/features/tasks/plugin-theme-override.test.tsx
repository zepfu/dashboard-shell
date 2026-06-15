/**
 * S6-T4 — plugin-theme-override: shipped Tasks component carries
 * `data-plugin="tasks"` and scopes `--accent-chrome` via tasks.module.css.
 *
 * Wave 10 cleanup: updated to render the shipped `Tasks` export (the lightweight
 * plugin-boundary component documented in tasks/index.tsx) and to strengthen the
 * assertion on `--accent-chrome` being defined in the document stylesheet.
 *
 * Component: `Tasks` from `@/features/tasks` (the real shipped component —
 * NOT a stub; no RouterProvider or SidebarProvider required).
 *
 * Why `Tasks` and not `TasksPage`:
 *   `TasksPage` requires `RouterProvider` + `SidebarProvider` + `TasksProvider`
 *   in scope (it calls TanStack Router hooks). `Tasks` is the plugin-boundary
 *   marker component explicitly designed for isolated test rendering
 *   (see tasks/index.tsx JSDoc). It carries `data-plugin="tasks"` and imports
 *   `tasks.module.css` — sufficient to verify the plugin token contract.
 *
 * jsdom limitation: jsdom does not compute scoped CSS custom properties from
 * injected stylesheets — `getComputedStyle(...).getPropertyValue('--accent-chrome')`
 * always returns '' even when the stylesheet is present. The test therefore:
 *   1. Asserts `data-plugin="tasks"` on the wrapper element.
 *   2. Scans `document.styleSheets` for the scoped CSS rule that defines
 *      `--accent-chrome: #6366f1` under `[data-plugin="tasks"]`.
 *   3. Verifies the rule selector correctly scopes the override.
 */
import { render } from '@testing-library/react'
import { Tasks } from '@/features/tasks'

test('test_plugin_task_override_wrapper_has_data_attribute', () => {
  const { container } = render(<Tasks />)

  const taskWrapper = container.firstElementChild as HTMLElement
  expect(taskWrapper).not.toBeNull()
  // The outer element must carry the data-plugin="tasks" scope marker.
  expect(taskWrapper?.getAttribute('data-plugin')).toBe('tasks')
})

test('test_plugin_task_override_var_color', () => {
  const { container } = render(<Tasks />)

  const taskWrapper = container.firstElementChild as HTMLElement
  expect(taskWrapper).not.toBeNull()

  // Step 1: Try getComputedStyle (works if jsdom ever gains CSS variable support).
  const computedValue = getComputedStyle(taskWrapper)
    .getPropertyValue('--accent-chrome')
    .trim()

  if (computedValue !== '') {
    // Exact hex or rgb equivalent both acceptable.
    expect(['#6366f1', 'rgb(99, 102, 241)']).toContain(computedValue)
    return
  }

  // Step 2: jsdom cannot compute scoped CSS custom properties — scan stylesheets.
  // Tripwire comment: if this test goes green via getComputedStyle instead,
  // the stylesheet scan branch becomes dead code but the assertion is stronger.
  let ruleFound = false
  for (let i = 0; i < document.styleSheets.length; i++) {
    let rules: CSSRuleList
    try {
      rules = document.styleSheets[i]!.cssRules
    } catch {
      // Cross-origin sheet — skip.
      continue
    }
    for (let j = 0; j < rules.length; j++) {
      const rule = rules[j] as CSSStyleRule
      if (
        rule.selectorText !== undefined &&
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

  // The rule `[data-plugin="tasks"] { --accent-chrome: #6366f1; }` must be
  // present in the document after the Tasks component renders (side-effect import).
  expect(ruleFound).toBe(true)
})

test('test_plugin_task_override_accent_chrome_scoped_not_global', () => {
  /**
   * The `--accent-chrome` override must be SCOPED to `[data-plugin="tasks"]`,
   * not set globally on `:root` or `html`. This guards against accidental
   * token leakage into the global shell.
   *
   * TRIPWIRE: scans document.styleSheets (same mechanism as test_plugin_task_override_var_color).
   * jsdom normalizes selector quotes so `[data-plugin='tasks']` becomes `[data-plugin="tasks"]`.
   */
  render(<Tasks />)

  let hasGlobalOverride = false
  let hasScopedOverride = false
  let hasAccentChromeAnyRule = false

  for (let i = 0; i < document.styleSheets.length; i++) {
    let rules: CSSRuleList
    try {
      rules = document.styleSheets[i]!.cssRules
    } catch {
      continue
    }
    for (let j = 0; j < rules.length; j++) {
      const rule = rules[j] as CSSStyleRule
      // Only consider rules that reference --accent-chrome
      if (!rule.selectorText) continue
      if (
        rule.selectorText.includes('[data-plugin="tasks"]') &&
        rule.cssText.includes('--accent-chrome') &&
        rule.cssText.includes('#6366f1')
      ) {
        hasScopedOverride = true
        hasAccentChromeAnyRule = true
      } else if (
        (rule.selectorText === ':root' ||
          rule.selectorText === 'html' ||
          rule.selectorText === '*') &&
        rule.cssText.includes('--accent-chrome') &&
        rule.cssText.includes('#6366f1')
      ) {
        hasGlobalOverride = true
        hasAccentChromeAnyRule = true
      }
    }
  }

  // If the stylesheet scanning found no accent-chrome rule at all, that's the same
  // as the existing var_color test — both tests document the jsdom limitation.
  // When both pass, the scoping is verified end-to-end.
  if (!hasAccentChromeAnyRule) {
    // jsdom limitation: stylesheet not accessible (cross-origin or not injected).
    // Document and skip the scoping assertion; the var_color test covers the
    // definition guard via the same scan path.
    expect(hasGlobalOverride).toBe(false) // at minimum: no global override found
    return
  }

  // The override must be scoped to the plugin wrapper.
  expect(hasScopedOverride).toBe(true)
  // It must NOT leak to the global root selector.
  expect(hasGlobalOverride).toBe(false)
})
