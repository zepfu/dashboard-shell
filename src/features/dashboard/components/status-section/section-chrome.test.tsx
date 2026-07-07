/**
 * Wave 4 (D1-451) — section-chrome: I1, A1, A6, W1.
 *
 * RED: StatusPanel + statusPill shared chrome; SectionTitle styles in CSS;
 * skeleton view list generated from ProviderSectionView union.
 */
import { render, screen } from '@testing-library/react'
import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, test } from 'vitest'
import { SectionSkeleton, SectionTabs, SectionTitle } from './section-chrome'

describe('section-chrome — A1 StatusPanel / statusPill exports', () => {
  test('test_status_panel_and_status_pill_exported_from_section_chrome', async () => {
    const mod = await import('./section-chrome')
    expect(mod.StatusPanel).toBeDefined()
    expect(mod.statusPill).toBeDefined()
    expect(typeof mod.statusPill).toBe('function')
  })
})

describe('section-chrome — A6 SectionTitle styles in CSS not inline', () => {
  test('test_section_title_tsx_does_not_inline_font_size_color', () => {
    const source = fs.readFileSync(
      path.resolve(
        'src/features/dashboard/components/status-section/section-chrome.tsx'
      ),
      'utf8'
    )
    expect(source).not.toMatch(/fontSize:\s*['"]clamp/)
    expect(source).not.toMatch(/color:\s*['"]var\(--accent-chrome\)/)
  })

  test('test_section_title_renders_with_css_class_only', () => {
    render(<SectionTitle id='status-title'>Status</SectionTitle>)
    const h2 = screen.getByRole('heading', { name: 'Status' })
    expect(h2).toHaveClass('section-title')
    expect(h2.getAttribute('style')).toBeNull()
  })
})

describe('section-chrome — W1 skeleton view list not hand-enumerated', () => {
  test('test_phosphor_dashboard_skeleton_views_derived_from_union_not_literal_list', () => {
    const source = fs.readFileSync(
      path.resolve('src/features/dashboard/components/phosphor-dashboard.tsx'),
      'utf8'
    )
    const handList =
      /providerSectionView\s*===\s*'health'[\s\S]*providerSectionView\s*===\s*'alias-routing'/
    expect(handList.test(source)).toBe(true)
    // RED: engineer should replace the 4-way OR with a generated REPORT_LOADING_VIEWS set.
    expect(source).toMatch(
      /REPORT_LOADING_VIEWS|reportLoadingViews|skeletonViewKeys/
    )
  })
})

describe('section-chrome — I1 StatusPanel wrapper behavior', () => {
  test('test_status_panel_renders_head_sub_and_loading_slot', async () => {
    const { StatusPanel } = await import('./section-chrome')
    render(
      <StatusPanel
        title='Provider auth'
        subLabel='fresh'
        loading={true}
        emptyMessage='not observed'
      >
        <div>child</div>
      </StatusPanel>
    )
    expect(screen.getByText('Provider auth')).toBeInTheDocument()
    expect(screen.getByText('fresh')).toBeInTheDocument()
    expect(screen.getByText('child')).toBeInTheDocument()
  })
})

describe('section-chrome — SectionTabs baseline', () => {
  test('test_section_tabs_renders_tablist', () => {
    render(
      <SectionTabs
        label='Views'
        value='health'
        options={[
          { value: 'health', label: 'Health' },
          { value: 'quota', label: 'Quota' },
        ]}
        onChange={() => undefined}
      />
    )
    expect(screen.getByRole('tablist', { name: 'Views' })).toBeInTheDocument()
  })
})

describe('section-chrome — SectionSkeleton', () => {
  test('test_section_skeleton_renders_block', () => {
    const { container } = render(<SectionSkeleton height={42} />)
    const block = container.querySelector('.skeleton-block')
    expect(block).toBeTruthy()
    expect((block as HTMLElement).style.height).toBe('42px')
  })
})
