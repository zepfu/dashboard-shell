/**
 * D1-451 Wave 5 (A3): Plugin theme contract must align with shipped `TasksPage`
 * wrapper (`data-plugin="tasks"`), not the test-only `Tasks` stub in index.tsx.
 *
 * jsdom: `getComputedStyle` often cannot read scoped CSS variables — stylesheet scan fallback.
 */
import { render } from '@testing-library/react'
import { describe, expect, test, vi } from 'vitest'
import { TasksProvider } from './components/tasks-provider'
import { TasksPage } from './tasks-page'

vi.mock('./components/tasks-table', () => ({
  TasksTable: () => null,
}))

vi.mock('./components/tasks-dialogs', () => ({
  TasksDialogs: () => null,
}))

function renderTasksPage() {
  return render(
    <TasksProvider>
      <TasksPage />
    </TasksProvider>
  )
}

function findTasksPluginWrapper(container: HTMLElement): HTMLElement | null {
  return container.querySelector('[data-plugin="tasks"]')
}

function scanTasksAccentChromeRule(): boolean {
  for (let i = 0; i < document.styleSheets.length; i++) {
    let rules: CSSRuleList
    try {
      rules = document.styleSheets[i]!.cssRules
    } catch {
      continue
    }
    for (let j = 0; j < rules.length; j++) {
      const rule = rules[j] as CSSStyleRule
      if (
        rule.selectorText?.includes('[data-plugin="tasks"]') &&
        rule.cssText.includes('--accent-chrome') &&
        rule.cssText.includes('#6366f1')
      ) {
        return true
      }
    }
  }
  return false
}

describe('D1-451 A3 — TasksPage plugin boundary', () => {
  test('test_tasks_page_wrapper_has_data_plugin_tasks', () => {
    const { container } = renderTasksPage()
    const wrapper = findTasksPluginWrapper(container)
    expect(wrapper).not.toBeNull()
    expect(wrapper?.getAttribute('data-plugin')).toBe('tasks')
  })

  test('test_tasks_page_defines_scoped_accent_chrome', () => {
    const { container } = renderTasksPage()
    const wrapper = findTasksPluginWrapper(container)
    expect(wrapper).not.toBeNull()

    const computed = getComputedStyle(wrapper!)
      .getPropertyValue('--accent-chrome')
      .trim()
    if (computed !== '') {
      expect(['#6366f1', 'rgb(99, 102, 241)']).toContain(computed)
      return
    }

    // TasksPage does not side-effect-import tasks.module.css — RED until route/index wires it.
    expect(scanTasksAccentChromeRule()).toBe(true)
  })

  test('test_tasks_stub_is_not_the_shipped_contract_target', async () => {
    const tasksIndex = await import('./index')
    expect(typeof tasksIndex.Tasks).toBe('function')
    expect(typeof tasksIndex.TasksRoute).toBe('function')
    // Contract tests above target TasksPage; Tasks remains a lightweight test fixture only.
    expect(tasksIndex.Tasks.name).toBe('Tasks')
  })
})
