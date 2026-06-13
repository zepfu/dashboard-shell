/**
 * Wave 3 / Wave 26 — HealthStrip tests.
 *
 * Component path: src/features/dashboard/components/primitives/health-strip.tsx
 * Expected export: HealthStrip (named)
 * Props: { cells: CellDef[] } — expects 288 cells; pads sparse data.
 *
 * Wave 20 additions: category/intensity → RGBA mapping, cat-miss class,
 * tip-health tooltip structure.
 *
 * Wave 26 (operator F#7): 4-state color semantics.
 * - blue  (58,130,243) = absence of data (no rawP95Ms, no errors)
 * - green (16,185,129) = everything good
 * - orange(245,158,11) = intermittent errors (rawErrorCount > 0, has p95)
 * - red   (239,68,68)  = service down (rawErrorCount > 0 AND rawP95Ms null)
 *
 * Legacy category aliases ('normal'→blue, 'teal'→green, 'warning'→orange)
 * remain for backward compat.
 */
import { fireEvent, render } from '@testing-library/react'
import { HealthStrip, type CellDef } from '../primitives/health-strip'

const CELL_COUNT = 288 // 24h * 12 (5-min buckets)

test('test_health_strip_renders_288_cells', () => {
  const cells = Array.from({ length: CELL_COUNT }, () => ({
    color: 'var(--card-2)',
  }))
  const { container } = render(<HealthStrip cells={cells} />)

  const cellEls =
    container.querySelectorAll('.health-strip-cell').length > 0
      ? container.querySelectorAll('.health-strip-cell')
      : container.querySelectorAll('[data-testid="health-strip-cell"]')

  expect(cellEls.length).toBe(288)
})

test('test_health_strip_cell_bg_color_applied', () => {
  const cells = [
    { color: '#f59e0b' },
    ...Array.from({ length: 287 }, () => ({ color: 'var(--card-2)' })),
  ]
  const { container } = render(<HealthStrip cells={cells} />)

  const cellEls =
    container.querySelectorAll('.health-strip-cell').length > 0
      ? container.querySelectorAll('.health-strip-cell')
      : container.querySelectorAll('[data-testid="health-strip-cell"]')

  const firstCell = cellEls[0] as HTMLElement
  // jsdom normalizes hex to rgb: #f59e0b → rgb(245, 158, 11)
  const bg = firstCell.style.background || firstCell.style.backgroundColor
  expect(bg === '#f59e0b' || bg === 'rgb(245, 158, 11)').toBe(true)
})

test('test_health_strip_pads_sparse_data', () => {
  // Only 2 cells provided — component must pad to 288
  const cells = [{ color: '#f00' }, { color: '#0f0' }]
  const { container } = render(<HealthStrip cells={cells} />)

  const cellEls =
    container.querySelectorAll('.health-strip-cell').length > 0
      ? container.querySelectorAll('.health-strip-cell')
      : container.querySelectorAll('[data-testid="health-strip-cell"]')

  // Total rendered cells must be 288 (padded)
  expect(cellEls.length).toBe(288)

  // Trailing 286 cells should have the padding background
  const paddingCell = cellEls[2] as HTMLElement
  const paddingBg =
    paddingCell.style.background || paddingCell.style.backgroundColor
  // Accept either CSS variable literal or transparent
  expect(
    paddingBg === 'var(--card-2)' ||
      paddingBg === 'transparent' ||
      paddingBg === ''
  ).toBe(true)
})

test('test_health_strip_vertical_merges_identical_visual_runs', () => {
  const cells = Array.from({ length: CELL_COUNT }, () => ({
    color: 'var(--card-2)',
  }))
  const { container } = render(
    <HealthStrip cells={cells} orientation='vertical' />
  )

  const cellEls = container.querySelectorAll('.health-strip-cell')
  expect(cellEls.length).toBe(1)
  expect((cellEls[0] as HTMLElement).style.flexGrow).toBe('288')
  expect((cellEls[0] as HTMLElement).style.flexBasis).toBe('0px')
})

test('test_health_strip_vertical_preserves_run_boundaries_and_padding_span', () => {
  const cells = [{ color: '#f00' }, { color: '#0f0' }]
  const { container } = render(
    <HealthStrip cells={cells} orientation='vertical' />
  )

  const cellEls = Array.from(
    container.querySelectorAll('.health-strip-cell')
  ) as HTMLElement[]

  expect(cellEls.length).toBe(3)
  expect(cellEls.map((el) => el.style.flexGrow)).toEqual(['1', '1', '286'])
  expect(cellEls.map((el) => el.style.flexBasis)).toEqual(['0px', '0px', '0px'])
})

test('test_health_strip_vertical_preserves_miss_hatch_run_without_inline_bg', () => {
  const cells = [
    { color: 'var(--card-2)', category: 'miss' as const },
    { color: 'var(--card-2)', category: 'miss' as const },
    ...Array.from({ length: CELL_COUNT - 2 }, () => ({
      color: 'var(--card-2)',
    })),
  ]
  const { container } = render(
    <HealthStrip cells={cells} orientation='vertical' />
  )

  const missCells = container.querySelectorAll('.health-strip-cell.cat-miss')
  expect(missCells.length).toBe(1)
  expect((missCells[0] as HTMLElement).style.flexGrow).toBe('2')
  expect((missCells[0] as HTMLElement).style.flexBasis).toBe('0px')
  const bg =
    (missCells[0] as HTMLElement).style.background ||
    (missCells[0] as HTMLElement).style.backgroundColor
  expect(bg === '' || bg === 'transparent').toBe(true)
})

// ---------------------------------------------------------------------------
// Wave 20 — category/intensity color mapping
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Wave 26 — canonical 4-state category names
// ---------------------------------------------------------------------------

test('test_health_strip_blue_category_applies_blue_rgba', () => {
  // 'blue' category (Wave 26 canonical) = no data → rgba(58,130,243,...)
  const cells = [
    { color: 'var(--card-2)', category: 'blue' as const, intensity: 0.5 },
    ...Array.from({ length: 287 }, () => ({ color: 'var(--card-2)' })),
  ]
  const { container } = render(<HealthStrip cells={cells} />)
  const firstCell = container.querySelectorAll(
    '.health-strip-cell'
  )[0] as HTMLElement
  const bg = firstCell.style.background || firstCell.style.backgroundColor
  expect(bg).toMatch(/rgba?\(58,\s*130,\s*243/)
})

test('test_health_strip_green_category_applies_green_rgba', () => {
  // 'green' category (Wave 26 canonical) = good → rgba(16,185,129,...)
  const cells = [
    { color: 'var(--card-2)', category: 'green' as const, intensity: 0.5 },
    ...Array.from({ length: 287 }, () => ({ color: 'var(--card-2)' })),
  ]
  const { container } = render(<HealthStrip cells={cells} />)
  const firstCell = container.querySelectorAll(
    '.health-strip-cell'
  )[0] as HTMLElement
  const bg = firstCell.style.background || firstCell.style.backgroundColor
  expect(bg).toMatch(/rgba?\(16,\s*185,\s*129/)
})

test('test_health_strip_orange_category_applies_amber_rgba', () => {
  // 'orange' category (Wave 26 canonical) = intermittent → rgba(245,158,11,...)
  const cells = [
    { color: 'var(--card-2)', category: 'orange' as const, intensity: 0.5 },
    ...Array.from({ length: 287 }, () => ({ color: 'var(--card-2)' })),
  ]
  const { container } = render(<HealthStrip cells={cells} />)
  const firstCell = container.querySelectorAll(
    '.health-strip-cell'
  )[0] as HTMLElement
  const bg = firstCell.style.background || firstCell.style.backgroundColor
  expect(bg).toMatch(/rgba?\(245,\s*158,\s*11/)
})

test('test_health_strip_red_category_applies_red_rgba', () => {
  // 'red' category (Wave 26 canonical) = service down → rgba(239,68,68,...)
  const cells = [
    { color: 'var(--card-2)', category: 'red' as const, intensity: 0.5 },
    ...Array.from({ length: 287 }, () => ({ color: 'var(--card-2)' })),
  ]
  const { container } = render(<HealthStrip cells={cells} />)
  const firstCell = container.querySelectorAll(
    '.health-strip-cell'
  )[0] as HTMLElement
  const bg = firstCell.style.background || firstCell.style.backgroundColor
  expect(bg).toMatch(/rgba?\(239,\s*68,\s*68/)
})

// ---------------------------------------------------------------------------
// Wave 20 legacy alias categories (backward compat)
// ---------------------------------------------------------------------------

test('test_health_strip_normal_category_applies_blue_rgba', () => {
  // 'normal' legacy alias → blue family rgba(58,130,243,...)
  const cells = [
    {
      color: 'var(--accent-cool)',
      category: 'normal' as const,
      intensity: 0.5,
    },
    ...Array.from({ length: 287 }, () => ({ color: 'var(--card-2)' })),
  ]
  const { container } = render(<HealthStrip cells={cells} />)

  const cellEls = container.querySelectorAll('.health-strip-cell')
  const firstCell = cellEls[0] as HTMLElement
  const bg = firstCell.style.background || firstCell.style.backgroundColor

  // Blue family: rgb(58, 130, 243) at some alpha
  expect(bg).toMatch(/rgba?\(58,\s*130,\s*243/)
})

test('test_health_strip_teal_category_applies_green_rgba', () => {
  // 'teal' legacy alias → green family rgba(16,185,129,...) in Wave 26
  const cells = [
    { color: 'var(--card-2)', category: 'teal' as const, intensity: 0.5 },
    ...Array.from({ length: 287 }, () => ({ color: 'var(--card-2)' })),
  ]
  const { container } = render(<HealthStrip cells={cells} />)

  const cellEls = container.querySelectorAll('.health-strip-cell')
  const firstCell = cellEls[0] as HTMLElement
  const bg = firstCell.style.background || firstCell.style.backgroundColor

  // Green family (Wave 26 teal alias): rgb(16, 185, 129) at some alpha
  expect(bg).toMatch(/rgba?\(16,\s*185,\s*129/)
})

test('test_health_strip_warning_category_applies_amber_rgba', () => {
  // 'warning' legacy alias → orange/amber rgba(245,158,11,...) — unchanged
  const cells = [
    { color: 'var(--card-2)', category: 'warning' as const, intensity: 0.5 },
    ...Array.from({ length: 287 }, () => ({ color: 'var(--card-2)' })),
  ]
  const { container } = render(<HealthStrip cells={cells} />)

  const cellEls = container.querySelectorAll('.health-strip-cell')
  const firstCell = cellEls[0] as HTMLElement
  const bg = firstCell.style.background || firstCell.style.backgroundColor

  // Amber family: rgb(245, 158, 11) at some alpha
  expect(bg).toMatch(/rgba?\(245,\s*158,\s*11/)
})

test('test_health_strip_miss_category_applies_cat_miss_class_no_inline_bg', () => {
  // 'miss' category should add class 'cat-miss' and NOT set inline background
  const cells = [
    { color: 'var(--card-2)', category: 'miss' as const },
    ...Array.from({ length: 287 }, () => ({ color: 'var(--card-2)' })),
  ]
  const { container } = render(<HealthStrip cells={cells} />)

  const missCells = container.querySelectorAll('.health-strip-cell.cat-miss')
  expect(missCells.length).toBeGreaterThanOrEqual(1)

  const firstMiss = missCells[0] as HTMLElement
  const bg = firstMiss.style.background || firstMiss.style.backgroundColor
  // No inline background color — CSS class owns it
  expect(bg === '' || bg === 'transparent').toBe(true)
})

test('test_health_strip_intensity_affects_alpha', () => {
  // Higher intensity should produce a higher alpha value
  const lowCell = [
    { color: 'var(--card-2)', category: 'normal' as const, intensity: 0 },
    ...Array.from({ length: 287 }, () => ({ color: 'var(--card-2)' })),
  ]
  const highCell = [
    { color: 'var(--card-2)', category: 'normal' as const, intensity: 1 },
    ...Array.from({ length: 287 }, () => ({ color: 'var(--card-2)' })),
  ]

  const { container: lowContainer } = render(<HealthStrip cells={lowCell} />)
  const { container: highContainer } = render(<HealthStrip cells={highCell} />)

  const lowBg = (
    lowContainer.querySelectorAll('.health-strip-cell')[0] as HTMLElement
  ).style.background
  const highBg = (
    highContainer.querySelectorAll('.health-strip-cell')[0] as HTMLElement
  ).style.background

  // Both should be blue family
  expect(lowBg).toMatch(/rgba?\(58,\s*130,\s*243/)
  expect(highBg).toMatch(/rgba?\(58,\s*130,\s*243/)
  // They should differ (different alpha)
  expect(lowBg).not.toBe(highBg)
})

// ---------------------------------------------------------------------------
// Wave 20 — tip-health hover tooltip structure
// ---------------------------------------------------------------------------

test('test_health_strip_vertical_shows_tip_health_on_hover', () => {
  // Vertical strip with tooltipContent should render the v9-tip panel
  const cells = Array.from({ length: 288 }, () => ({ color: 'var(--card-2)' }))
  const tooltipContent = (
    <>
      <div className='v9-tip-head'>−14h → −13h 55m · 1 event</div>
      <div className='v9-tip-row'>
        <span className='t-time'>13:42</span>
        <span className='t-model'>gpt-4o</span>
        <span className='t-err'>503 capacity</span>
        <span className='t-count'>x1</span>
      </div>
    </>
  )

  render(
    <HealthStrip
      cells={cells}
      orientation='vertical'
      tooltipContent={tooltipContent}
    />
  )

  // Tip panel should be present (hidden initially via opacity)
  const tip = document.body.querySelector('.v9-tip')
  expect(tip).not.toBeNull()

  // Head and row structure
  const head = document.body.querySelector('.v9-tip-head')
  expect(head).not.toBeNull()
  expect(head?.textContent).toContain('event')

  const row = document.body.querySelector('.v9-tip-row')
  expect(row).not.toBeNull()
  expect(row?.querySelector('.t-time')).not.toBeNull()
  expect(row?.querySelector('.t-model')).not.toBeNull()
  expect(row?.querySelector('.t-err')).not.toBeNull()
  expect(row?.querySelector('.t-count')).not.toBeNull()
})

test('test_health_strip_vertical_tip_health_opens_on_pointer_enter', () => {
  // Verify the tooltip transitions to visible state on hover.
  // HoverTooltip renders a div with onPointerEnter wrapping .health-strip-wrapper.
  // Firing pointerEnter on the inner .health-strip-wrapper bubbles up to the
  // HoverTooltip listener.
  const cells = Array.from({ length: 288 }, () => ({ color: 'var(--card-2)' }))
  const tooltipContent = <div className='v9-tip-head'>Test head</div>

  const { container } = render(
    <HealthStrip
      cells={cells}
      orientation='vertical'
      tooltipContent={tooltipContent}
    />
  )

  // .health-strip-wrapper is a child of HoverTooltip's tracking div.
  // Pointer events bubble so firing on the wrapper triggers HoverTooltip.
  const wrapper = container.querySelector(
    '.health-strip-wrapper'
  ) as HTMLElement
  expect(wrapper).not.toBeNull()

  fireEvent.pointerEnter(wrapper)

  const tip = document.body.querySelector('.v9-tip')
  expect(tip?.getAttribute('data-state')).toBe('open')
})

// ---------------------------------------------------------------------------
// Wave 26 — 4-state raw metrics semantics (operator F#7)
// ---------------------------------------------------------------------------

test('test_health_strip_raw_metrics_no_errors_has_data_is_green', () => {
  // Wave 26: bucket with p95 data and no errors → green (good).
  // All cells have latency data and 0 errors → green.
  const testCell = { color: 'var(--card-2)', rawP95Ms: 1200, rawErrorCount: 0 }
  const others = Array.from({ length: 19 }, (_, i) => ({
    color: 'var(--card-2)',
    rawP95Ms: 100 + i * 100,
    rawErrorCount: 0,
  }))
  const cells = [
    testCell,
    ...others,
    ...Array.from({ length: 288 - 1 - others.length }, () => ({
      color: 'var(--card-2)',
    })),
  ]

  const { container } = render(<HealthStrip cells={cells} />)
  const cellEls = container.querySelectorAll('.health-strip-cell')
  const firstCell = cellEls[0] as HTMLElement
  const bg = firstCell.style.background || firstCell.style.backgroundColor

  // Wave 26: no errors + has p95 data → green rgb(16,185,129)
  expect(bg).toMatch(/rgba?\(16,\s*185,\s*129/)
})

test('test_health_strip_raw_metrics_high_latency_no_errors_is_orange', () => {
  // Secondary latency path: p95 exceeds strip p90 with no errors → orange.
  // 11 non-padding cells; p90 = sorted[9] = 3000ms. First cell at 5000ms > 3000ms.
  const cells = [
    { color: 'var(--card-2)', rawP95Ms: 5000, rawErrorCount: 0 }, // >> p90(3000) → orange
    { color: 'var(--card-2)', rawP95Ms: 100, rawErrorCount: 0 },
    { color: 'var(--card-2)', rawP95Ms: 200, rawErrorCount: 0 },
    { color: 'var(--card-2)', rawP95Ms: 300, rawErrorCount: 0 },
    { color: 'var(--card-2)', rawP95Ms: 400, rawErrorCount: 0 },
    { color: 'var(--card-2)', rawP95Ms: 500, rawErrorCount: 0 },
    { color: 'var(--card-2)', rawP95Ms: 600, rawErrorCount: 0 },
    { color: 'var(--card-2)', rawP95Ms: 700, rawErrorCount: 0 },
    { color: 'var(--card-2)', rawP95Ms: 800, rawErrorCount: 0 },
    { color: 'var(--card-2)', rawP95Ms: 900, rawErrorCount: 0 },
    { color: 'var(--card-2)', rawP95Ms: 3000, rawErrorCount: 0 }, // p90 anchor
    ...Array.from({ length: 277 }, () => ({ color: 'var(--card-2)' })),
  ]

  const { container } = render(<HealthStrip cells={cells} />)
  const cellEls = container.querySelectorAll('.health-strip-cell')
  const firstCell = cellEls[0] as HTMLElement
  const bg = firstCell.style.background || firstCell.style.backgroundColor

  // Orange (secondary latency path): p95=5000ms > p90=3000ms
  expect(bg).toMatch(/rgba?\(245,\s*158,\s*11/)
})

test('test_health_strip_raw_metrics_error_with_latency_is_orange', () => {
  // Wave 26: rawErrorCount > 0 AND p95 is present → orange (intermittent)
  const cells = [
    { color: 'var(--card-2)', rawP95Ms: 200, rawErrorCount: 1 }, // error + p95 → orange
    { color: 'var(--card-2)', rawP95Ms: 100, rawErrorCount: 0 },
    { color: 'var(--card-2)', rawP95Ms: 300, rawErrorCount: 0 },
    ...Array.from({ length: 285 }, () => ({ color: 'var(--card-2)' })),
  ]

  const { container } = render(<HealthStrip cells={cells} />)
  const cellEls = container.querySelectorAll('.health-strip-cell')
  const firstCell = cellEls[0] as HTMLElement
  const bg = firstCell.style.background || firstCell.style.backgroundColor

  expect(bg).toMatch(/rgba?\(245,\s*158,\s*11/)
})

test('test_health_strip_raw_metrics_error_no_latency_is_red', () => {
  // Wave 26: rawErrorCount > 0 AND rawP95Ms === null → red (service down)
  const cells = [
    { color: 'var(--card-2)', rawP95Ms: null, rawErrorCount: 3 }, // down → red
    { color: 'var(--card-2)', rawP95Ms: 100, rawErrorCount: 0 },
    { color: 'var(--card-2)', rawP95Ms: 300, rawErrorCount: 0 },
    ...Array.from({ length: 285 }, () => ({ color: 'var(--card-2)' })),
  ]

  const { container } = render(<HealthStrip cells={cells} />)
  const cellEls = container.querySelectorAll('.health-strip-cell')
  const firstCell = cellEls[0] as HTMLElement
  const bg = firstCell.style.background || firstCell.style.backgroundColor

  // Red: service unavailable rgb(239,68,68)
  expect(bg).toMatch(/rgba?\(239,\s*68,\s*68/)
})

test('test_health_strip_raw_metrics_no_data_no_errors_is_blue', () => {
  // Wave 26: rawP95Ms === null AND rawErrorCount === 0 → blue (absence of data)
  const cells = [
    { color: 'var(--card-2)', rawP95Ms: null, rawErrorCount: 0 }, // no data → blue
    { color: 'var(--card-2)', rawP95Ms: 500, rawErrorCount: 0 },
    { color: 'var(--card-2)', rawP95Ms: 600, rawErrorCount: 0 },
    ...Array.from({ length: 285 }, () => ({ color: 'var(--card-2)' })),
  ]

  const { container } = render(<HealthStrip cells={cells} />)
  const cellEls = container.querySelectorAll('.health-strip-cell')
  const firstCell = cellEls[0] as HTMLElement
  const bg = firstCell.style.background || firstCell.style.backgroundColor

  // Blue: absence of data rgb(58,130,243)
  expect(bg).toMatch(/rgba?\(58,\s*130,\s*243/)
})

test('test_health_strip_raw_metrics_low_latency_no_errors_is_green', () => {
  // Wave 26: low p95 (no errors) → green (good). Teal semantics dropped.
  const cells = [
    { color: 'var(--card-2)', rawP95Ms: 50, rawErrorCount: 0 }, // low latency, no errors → green
    { color: 'var(--card-2)', rawP95Ms: 200, rawErrorCount: 0 },
    { color: 'var(--card-2)', rawP95Ms: 300, rawErrorCount: 0 },
    { color: 'var(--card-2)', rawP95Ms: 400, rawErrorCount: 0 },
    { color: 'var(--card-2)', rawP95Ms: 500, rawErrorCount: 0 },
    { color: 'var(--card-2)', rawP95Ms: 600, rawErrorCount: 0 },
    { color: 'var(--card-2)', rawP95Ms: 700, rawErrorCount: 0 },
    { color: 'var(--card-2)', rawP95Ms: 800, rawErrorCount: 0 },
    { color: 'var(--card-2)', rawP95Ms: 900, rawErrorCount: 0 },
    { color: 'var(--card-2)', rawP95Ms: 1000, rawErrorCount: 0 },
    ...Array.from({ length: 278 }, () => ({ color: 'var(--card-2)' })),
  ]

  const { container } = render(<HealthStrip cells={cells} />)
  const cellEls = container.querySelectorAll('.health-strip-cell')
  const firstCell = cellEls[0] as HTMLElement
  const bg = firstCell.style.background || firstCell.style.backgroundColor

  // Wave 26: no errors + has p95 data → green (not teal)
  expect(bg).toMatch(/rgba?\(16,\s*185,\s*129/)
})

test('test_health_strip_raw_metrics_miss_bucket_category_explicit', () => {
  // Explicit 'miss' category → cat-miss CSS class (unchanged from Wave 20)
  const cells = [
    { color: 'var(--card-2)', category: 'miss' as const },
    { color: 'var(--card-2)', rawP95Ms: 500, rawErrorCount: 0 },
    { color: 'var(--card-2)', rawP95Ms: 600, rawErrorCount: 0 },
    ...Array.from({ length: 285 }, () => ({ color: 'var(--card-2)' })),
  ]

  const { container } = render(<HealthStrip cells={cells} />)
  const missCells = container.querySelectorAll('.health-strip-cell.cat-miss')
  expect(missCells.length).toBeGreaterThanOrEqual(1)

  const firstMiss = missCells[0] as HTMLElement
  const bg = firstMiss.style.background || firstMiss.style.backgroundColor
  expect(bg === '' || bg === 'transparent').toBe(true)
})

test('test_health_strip_green_dominant_when_all_traffic_no_errors', () => {
  // Wave 26: 288 cells all with latency data and 0 errors → all green.
  // The dominant colour when everything is healthy should be green, not blue.
  const latencies = Array.from({ length: 288 }, (_, i) => 100 + (i % 8) * 100)

  const cells = latencies.map((p95) => ({
    color: 'var(--card-2)',
    rawP95Ms: p95,
    rawErrorCount: 0,
  }))

  const { container } = render(<HealthStrip cells={cells} />)
  const allCells = container.querySelectorAll('.health-strip-cell')
  let greenCount = 0
  for (const el of allCells) {
    const bg = (el as HTMLElement).style.background
    if (bg.includes('16') && bg.includes('185') && bg.includes('129')) {
      greenCount++
    }
  }

  // All 288 cells should be green (no errors, all have p95 data)
  expect(greenCount).toBe(288)
})

// ---------------------------------------------------------------------------
// Wave 24 — tip-health event rendering edge cases (Bug F1a)
// ---------------------------------------------------------------------------

test('test_health_strip_tip_health_renders_one_row_per_event', () => {
  // When events array has entries, one v9-tip-row per event
  const events = [
    { time: '13:42', model: 'gpt-4o', errorType: '503 capacity', count: 1 },
    { time: '13:44', model: 'claude-3', errorType: 'timeout', count: 2 },
  ]
  const cells = [
    {
      color: 'var(--card-2)',
      bucketStart: new Date(Date.now() - 14 * 3600 * 1000).toISOString(),
      eventCount: 3,
      events,
    },
    ...Array.from({ length: 287 }, () => ({ color: 'var(--card-2)' })),
  ]

  render(<HealthStrip cells={cells} orientation='vertical' />)

  const rows = document.body.querySelectorAll('.v9-tip-row')
  expect(rows.length).toBe(2)

  const firstRow = rows[0]
  expect(firstRow.querySelector('.t-time')?.textContent).toBe('13:42')
  expect(firstRow.querySelector('.t-model')?.textContent).toBe('gpt-4o')
  expect(firstRow.querySelector('.t-err')?.textContent).toBe('503 capacity')
  expect(firstRow.querySelector('.t-count')?.textContent).toBe('')
  expect(rows[1].querySelector('.t-count')?.textContent).toBe('x2')
})

test('test_health_strip_tip_health_empty_events_shows_placeholder', () => {
  // events array is empty but eventCount > 0 → placeholder row
  const cells = [
    {
      color: 'var(--card-2)',
      bucketStart: new Date(Date.now() - 14 * 3600 * 1000).toISOString(),
      eventCount: 5,
      events: [] as {
        time: string
        model: string
        errorType: string
        count: number
      }[],
    },
    ...Array.from({ length: 287 }, () => ({ color: 'var(--card-2)' })),
  ]

  render(<HealthStrip cells={cells} orientation='vertical' />)

  const rows = document.body.querySelectorAll('.v9-tip-row')
  expect(rows.length).toBe(1)

  const errSpan = rows[0].querySelector('.t-err')
  expect(errSpan?.textContent).toContain('5 events')
})

test('test_health_strip_tip_health_undefined_events_no_breakdown_shows_head_only', () => {
  // Wave 29-E2: events is undefined AND no rawErrorBreakdown → head only.
  // The old "no event detail" placeholder is dropped to avoid misleading users
  // on error-free buckets.
  const cells = [
    {
      color: 'var(--card-2)',
      bucketStart: new Date(Date.now() - 14 * 3600 * 1000).toISOString(),
      eventCount: 0,
      // events intentionally omitted; rawErrorBreakdown intentionally omitted
    },
    ...Array.from({ length: 287 }, () => ({ color: 'var(--card-2)' })),
  ]

  render(<HealthStrip cells={cells} orientation='vertical' />)

  // Head should be present
  const head = document.body.querySelector('.v9-tip-head')
  expect(head).not.toBeNull()

  // No body rows — bucket is error-free, nothing to enumerate
  const rows = document.body.querySelectorAll('.v9-tip-row')
  expect(rows.length).toBe(0)
})

// ---------------------------------------------------------------------------
// Wave 29-E2 — rawErrorBreakdown tooltip rows (Track 6)
// ---------------------------------------------------------------------------

test('test_health_strip_tip_health_raw_error_breakdown_renders_nonzero_rows', () => {
  // rawErrorBreakdown with some non-zero fields → one v9-tip-row per non-zero type
  const cells = [
    {
      color: 'var(--card-2)',
      bucketStart: new Date(Date.now() - 14 * 3600 * 1000).toISOString(),
      eventCount: 7,
      rawErrorBreakdown: {
        provider_error_events: 2,
        provider_5xx_events: 3,
        provider_timeout_events: 0,
        network_error_events: 0,
        rate_limit_events: 1,
        capacity_events: 1,
      },
    },
    ...Array.from({ length: 287 }, () => ({ color: 'var(--card-2)' })),
  ]

  render(<HealthStrip cells={cells} orientation='vertical' />)

  // Should have one row per non-zero field (4 non-zero: provider_error, 5xx, rate_limit, capacity)
  const rows = document.body.querySelectorAll('.v9-tip-row')
  expect(rows.length).toBe(4)

  // Verify labels and counts
  const errSpans = Array.from(rows).map(
    (r) => r.querySelector('.t-err')?.textContent
  )
  expect(errSpans).toContain('Provider errors')
  expect(errSpans).toContain('5xx errors')
  expect(errSpans).toContain('Rate limits')
  expect(errSpans).toContain('Capacity limits')
  // Zero-count types must be absent
  expect(errSpans).not.toContain('Timeouts')
  expect(errSpans).not.toContain('Network errors')

  const countSpans = Array.from(rows).map(
    (r) => r.querySelector('.t-count')?.textContent
  )
  expect(countSpans).toContain('2')
  expect(countSpans).toContain('3')
  expect(countSpans).toContain('1')
})

test('test_health_strip_tip_health_raw_error_breakdown_all_zero_shows_head_only', () => {
  // rawErrorBreakdown present but all zero → error-free bucket → head only
  const cells = [
    {
      color: 'var(--card-2)',
      bucketStart: new Date(Date.now() - 14 * 3600 * 1000).toISOString(),
      eventCount: 0,
      rawErrorBreakdown: {
        provider_error_events: 0,
        provider_5xx_events: 0,
        provider_timeout_events: 0,
        network_error_events: 0,
        rate_limit_events: 0,
        capacity_events: 0,
      },
    },
    ...Array.from({ length: 287 }, () => ({ color: 'var(--card-2)' })),
  ]

  render(<HealthStrip cells={cells} orientation='vertical' />)

  const head = document.body.querySelector('.v9-tip-head')
  expect(head).not.toBeNull()
  expect(head?.textContent).toContain('0 events')

  const rows = document.body.querySelectorAll('.v9-tip-row')
  expect(rows.length).toBe(0)
})

test('test_health_strip_tip_health_raw_error_breakdown_display_order', () => {
  // Error types must appear in canonical display order:
  // Provider errors → 5xx → Timeouts → Network → Rate limits → Capacity
  const cells = [
    {
      color: 'var(--card-2)',
      bucketStart: new Date(Date.now() - 1 * 3600 * 1000).toISOString(),
      eventCount: 6,
      rawErrorBreakdown: {
        provider_error_events: 1,
        provider_5xx_events: 1,
        provider_timeout_events: 1,
        network_error_events: 1,
        rate_limit_events: 1,
        capacity_events: 1,
      },
    },
    ...Array.from({ length: 287 }, () => ({ color: 'var(--card-2)' })),
  ]

  render(<HealthStrip cells={cells} orientation='vertical' />)

  const rows = document.body.querySelectorAll('.v9-tip-row')
  expect(rows.length).toBe(6)

  const labels = Array.from(rows).map(
    (r) => r.querySelector('.t-err')?.textContent
  )
  expect(labels).toEqual([
    'Provider errors',
    '5xx errors',
    'Timeouts',
    'Network errors',
    'Rate limits',
    'Capacity limits',
  ])
})

test('test_health_strip_tip_health_degraded_breakdown_renders_signal_rows', () => {
  const cells = [
    {
      color: 'var(--card-2)',
      bucketStart: new Date(Date.now() - 30 * 60 * 1000).toISOString(),
      degradedCount: 2,
      rawDegradedBreakdown: {
        probe_failures: 0,
        provider_probe_degraded: 1,
        control_probe_degraded: 0,
        provider_packet_loss: 1,
        control_packet_loss: 0,
        provider_latency_delta: 0,
      },
    },
    ...Array.from({ length: 287 }, () => ({ color: 'var(--card-2)' })),
  ]

  render(<HealthStrip cells={cells} orientation='vertical' />)

  const head = document.body.querySelector('.v9-tip-head')
  expect(head?.textContent).toContain('2 signals')

  const rows = document.body.querySelectorAll('.v9-tip-row')
  expect(rows.length).toBe(2)
  const labels = Array.from(rows).map(
    (r) => r.querySelector('.t-err')?.textContent
  )
  expect(labels).toContain('Provider probe degraded')
  expect(labels).toContain('Provider packet loss')
})

test('test_health_strip_auto_tooltip_prefers_newest_error_or_degraded_bucket', () => {
  const cells: CellDef[] = Array.from({ length: 288 }, () => ({
    color: 'var(--card-2)',
  }))
  cells[40] = {
    color: 'var(--card-2)',
    bucketStart: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
    degradedCount: 1,
    rawDegradedBreakdown: {
      probe_failures: 0,
      provider_probe_degraded: 1,
      control_probe_degraded: 0,
      provider_packet_loss: 0,
      control_packet_loss: 0,
      provider_latency_delta: 0,
    },
  }
  cells[287] = {
    color: 'var(--card-2)',
    bucketStart: new Date(Date.now() - 5 * 60 * 1000).toISOString(),
    eventCount: 3,
    rawErrorBreakdown: {
      provider_error_events: 3,
      provider_5xx_events: 0,
      provider_timeout_events: 0,
      network_error_events: 0,
      rate_limit_events: 0,
      capacity_events: 0,
    },
  }

  render(<HealthStrip cells={cells} orientation='vertical' />)

  const head = document.body.querySelector('.v9-tip-head')
  expect(head?.textContent).toContain('3 events')
  expect(head?.textContent).toContain('−0h 5m')
  expect(document.body.textContent).toContain('Provider errors')
  expect(document.body.textContent).not.toContain('Provider probe degraded')
})

test('test_health_strip_vertical_shell_has_pointer_events_none', () => {
  // Wave 35 S2: the absolutely-positioned shell div must have pointer-events:none
  // to prevent it from intercepting hover events on quota bars that sit at the same
  // vertical position as the strip (the strip is only 12px wide but spans the card
  // height and can capture events outside its visible area in certain browsers).
  const cells = Array.from({ length: 288 }, () => ({ color: 'var(--card-2)' }))
  const { container } = render(
    <HealthStrip
      cells={cells}
      orientation='vertical'
      tooltipContent={<span>tip</span>}
    />
  )

  // The shell is the outermost element — aria-hidden, position:absolute.
  const shell = container.firstChild as HTMLElement | null
  expect(shell).not.toBeNull()
  expect(shell?.style.pointerEvents).toBe('none')
})

test('test_health_strip_vertical_hover_zone_restores_pointer_events', () => {
  // Wave 35 S2: the inner wrapper that contains HoverTooltip must have
  // pointer-events:auto so the health tooltip itself is still reachable.
  const cells = Array.from({ length: 288 }, () => ({ color: 'var(--card-2)' }))
  const { container } = render(
    <HealthStrip
      cells={cells}
      orientation='vertical'
      tooltipContent={<span>tip</span>}
    />
  )

  const shell = container.firstChild as HTMLElement | null
  expect(shell).not.toBeNull()

  // The first child of the shell is the pointer-events:auto restore div.
  const hoverZone = shell?.firstChild as HTMLElement | null
  expect(hoverZone).not.toBeNull()
  expect(hoverZone?.style.pointerEvents).toBe('auto')
})

// ---------------------------------------------------------------------------
// Wave 3 (adversarial-review-20260612) — FAILING tests, W3 engineer to fix
// ---------------------------------------------------------------------------

/**
 * S3-15 — Health-strip pad/clip direction: sparse input must be FRONT-padded
 * and oversized input must be sliced from the END (keeps newest).
 *
 * Current behavior: `clipped = cells.slice(0, TOTAL_CELLS)` keeps oldest 288
 * and then appends neutral padding at the TAIL. This is backwards for a
 * "−24h → NOW" axis where the newest cells (tail) should always be present.
 *
 * After fix:
 *   - Sparse input: neutral cells prepended at the front (oldest end).
 *   - Oversized input: `slice(-TOTAL_CELLS)` keeps the newest 288.
 */
test('test_health_strip_pad_clip_direction', () => {
  const TOTAL = 288
  // Sparse input: 2 real cells (represent the most-recent buckets).
  // After fix: these 2 cells are at the TAIL (NOW end); front is padded neutral.
  const sparseColor = '#ef4444' // red — unmistakable sentinel
  const sparseCells: CellDef[] = [
    { color: sparseColor },
    { color: sparseColor },
  ]

  const { container: sparseContainer } = render(
    <HealthStrip cells={sparseCells} />
  )
  const sparseEls = Array.from(
    sparseContainer.querySelectorAll('.health-strip-cell').length > 0
      ? sparseContainer.querySelectorAll('.health-strip-cell')
      : sparseContainer.querySelectorAll('[data-testid="health-strip-cell"]')
  ) as HTMLElement[]

  expect(sparseEls.length).toBe(TOTAL)

  // After fix: the LAST 2 cells should be red (the real data, at NOW end).
  const lastCell = sparseEls[TOTAL - 1]!
  const secondLastCell = sparseEls[TOTAL - 2]!
  const lastBg = lastCell.style.background || lastCell.style.backgroundColor
  const secondLastBg =
    secondLastCell.style.background || secondLastCell.style.backgroundColor
  expect(lastBg === sparseColor || lastBg === 'rgb(239, 68, 68)').toBe(true) // FAILS before fix (currently data is at FRONT)
  expect(
    secondLastBg === sparseColor || secondLastBg === 'rgb(239, 68, 68)'
  ).toBe(true)

  // Oversized input: 290 cells (2 extra); newest 288 should be kept (last 288).
  const sentinel = '#10b981' // green sentinel for the last 288
  const oversizedCells: CellDef[] = [
    { color: '#000000' }, // oldest — should be DROPPED after fix
    { color: '#000000' }, // oldest — should be DROPPED after fix
    ...Array.from({ length: TOTAL }, () => ({ color: sentinel })),
  ]

  const { container: oversizedContainer } = render(
    <HealthStrip cells={oversizedCells} />
  )
  const oversizedEls = Array.from(
    oversizedContainer.querySelectorAll('.health-strip-cell').length > 0
      ? oversizedContainer.querySelectorAll('.health-strip-cell')
      : oversizedContainer.querySelectorAll('[data-testid="health-strip-cell"]')
  ) as HTMLElement[]

  expect(oversizedEls.length).toBe(TOTAL)

  // After fix (slice(-288)): all 288 rendered cells should be green (sentinel), not black.
  const firstRenderedBg =
    oversizedEls[0]!.style.background || oversizedEls[0]!.style.backgroundColor
  expect(
    firstRenderedBg === sentinel || firstRenderedBg === 'rgb(16, 185, 129)'
  ).toBe(true) // FAILS before fix (currently slice(0,288) keeps the 2 black cells)
})

/**
 * S3-16 — Health-strip time axis: a 2-hour data gap must render as blue no-data
 * cells at the correct wall-clock position, not right-shifted.
 *
 * Currently `padHealthCellsFromRows` (caller side) groups cells by bucket_start
 * without filling wall-clock gaps. A 2-hour outage causes those bucket positions
 * to be absent, shifting all cells that follow toward the NOW end.
 *
 * The fix (in health-strip.tsx): index cells by
 * `Math.floor((bucket_ms - (now_ms - 24h_ms)) / 5_min_ms)` so a gap at a
 * specific wall-clock position renders as blue no-data at that position, not
 * shifted. `now` must be passed as a prop (S3-20).
 *
 * PROPS NEEDED on HealthStrip:
 *   - `now?: Date`  (engineer adds per S3-20; used to compute wall-clock index)
 *   - `rows?: HealthStripRow[]` (OR caller pre-computes indexed cells; see plan)
 *
 * This test drives the PRIMITIVE's indexing contract via the `cells` prop
 * enriched with `bucketStart` fields and verifies that a gap position is blue.
 *
 * EXPORTS NEEDED: `CellDef` (already exported).
 */
test('test_health_strip_time_axis_indexed_by_wallclock', () => {
  // S3-16 bug scenario: the CALLER provides 264 cells (no gap-filler cells).
  // Without wall-clock indexing, the 264 cells pack into array positions 0–263
  // and 24 padding cells appear at the tail. Slot 120 in the DOM is NOT the gap
  // — it is the post-gap cell, right-shifted. The 2h gap is invisible.
  //
  // After fix: HealthStrip accepts a  prop and indexes each cell by
  //  so the gap
  // at wall-clock positions 120–143 is rendered as blue no-data at those slots.
  //
  // The test proves the bug by: passing sparse cells (no gap cells), then
  // asserting that DOM slot 120 is NOT green (it should be a gap/blue slot).
  // Before fix: DOM slot 120 IS green (the next data cell fills it) → FAILS.
  const TOTAL = 288
  const BUCKET_MS = 5 * 60 * 1000
  const now = new Date('2026-05-20T12:00:00.000Z')
  const startMs = now.getTime() - TOTAL * BUCKET_MS
  const gapStart = 120
  const gapEnd = 143 // 24 slots = 2 hours

  // Build sparse cells: all non-gap slots have green data; gap slots are ABSENT.
  // This simulates the caller (padHealthCellsFromRows) not filling wall-clock gaps.
  const sparseCells: CellDef[] = []
  for (let i = 0; i < TOTAL; i++) {
    if (i >= gapStart && i <= gapEnd) continue // omit the gap
    const bucketMs = startMs + i * BUCKET_MS
    sparseCells.push({
      color: '#10b981',
      category: 'green' as const,
      bucketStart: new Date(bucketMs).toISOString(),
      rawP95Ms: 100,
    })
  }
  // sparseCells.length === 264

  // Render with  prop (engineer adds this for wall-clock indexing, S3-20).
  // @ts-expect-error --  prop added by engineer; absent until fix lands.
  const { container } = render(
    <HealthStrip cells={sparseCells} orientation='horizontal' now={now} />
  )

  const cellEls = Array.from(
    container.querySelectorAll('.health-strip-cell').length > 0
      ? container.querySelectorAll('.health-strip-cell')
      : container.querySelectorAll('[data-testid="health-strip-cell"]')
  ) as HTMLElement[]

  expect(cellEls.length).toBe(TOTAL)

  const isGreenColor = (bg: string) =>
    bg === '#10b981' || bg === 'rgb(16, 185, 129)'

  // Slot just before the gap must be green (real data present).
  const preGapBg =
    (cellEls[gapStart - 1] as HTMLElement).style.background ||
    (cellEls[gapStart - 1] as HTMLElement).style.backgroundColor
  expect(isGreenColor(preGapBg)).toBe(true)

  // Slot at the gap start must NOT be green after fix.
  // Before fix: the next real-data cell fills this slot (array-shift) → green → FAILS.
  const gapSlotBg =
    (cellEls[gapStart] as HTMLElement).style.background ||
    (cellEls[gapStart] as HTMLElement).style.backgroundColor
  expect(isGreenColor(gapSlotBg)).toBe(false)
})

/**
 * S3-17 — `rawErrorCount` without `rawP95Ms` must engage the raw-metric path.
 *
 * The raw-metric path currently checks `if (cell.rawP95Ms !== undefined)`.
 * A cell with `rawErrorCount: 5` but no `rawP95Ms` key at all silently falls
 * through to the legacy color path — errors invisible.
 *
 * After fix: the path engages when EITHER `rawP95Ms` or `rawErrorCount` is present.
 */
test('test_health_strip_rawErrorCount_only_engages', () => {
  // Cell with only rawErrorCount set (no rawP95Ms key at all).
  const errorOnlyCell: CellDef = {
    color: 'var(--card-2)', // neutral fallback
    rawErrorCount: 5, // non-zero errors, NO rawP95Ms
    // rawP95Ms is intentionally absent (not even undefined)
  }

  const cells: CellDef[] = [
    errorOnlyCell,
    ...Array.from({ length: 287 }, () => ({ color: 'var(--card-2)' })),
  ]

  const { container } = render(<HealthStrip cells={cells} />)

  const cellEls = Array.from(
    container.querySelectorAll('.health-strip-cell').length > 0
      ? container.querySelectorAll('.health-strip-cell')
      : container.querySelectorAll('[data-testid="health-strip-cell"]')
  ) as HTMLElement[]

  const firstCellBg =
    cellEls[0]!.style.background || cellEls[0]!.style.backgroundColor

  // After fix: rawErrorCount > 0 with no latency data → red (service down) or
  // orange (intermittent errors); must NOT be the neutral color.
  // Before fix: falls through to `color: 'var(--card-2)'` → looks like no-data.
  const isNeutral =
    firstCellBg === 'var(--card-2)' ||
    firstCellBg === '' ||
    firstCellBg === 'transparent'

  // This assertion FAILS before the fix.
  expect(isNeutral).toBe(false)
})

/**
 * S3-18 — Auto-tooltip head must sum event `count` fields (not count log lines)
 * and the overflow label must say "+N more events".
 *
 * Current: `eventCount: eventLog.filter(ev => ev.count !== 0).length` counts
 * displayed log LINES (capped at 14), so an event with count:5 contributes 1
 * to the head — severely undercounting. Also, events beyond the 14-row cap are
 * labelled "+N earlier events" even when their time is simply unknown (no observedAt).
 *
 * After fix:
 *   - Head shows sum of `count` across all events (not line count).
 *   - Overflow row: "+N more events" (not "earlier").
 *
 * NOTE: This test relies on the auto-generated tip-health path (cells with
 * bucketStart + rawErrorCount + events). The HoverTooltip must be fired via
 * `fireEvent.pointerEnter` on the vertical strip.
 */
test('test_health_strip_event_count_sums_occurrences', () => {
  // 16 events (> 14-row cap), each with count:3 → total occurrences = 48.
  const events = Array.from({ length: 16 }, (_, i) => ({
    time: `${(i % 12).toString().padStart(2, '0')}:00`,
    model: `model-${i.toString()}`,
    errorType: 'timeout',
    count: 3,
    observedAt: `2026-05-20T${(i % 24).toString().padStart(2, '0')}:00:00.000Z`,
  }))

  const singleErrorCell: CellDef = {
    color: '#ef4444',
    category: 'red' as const,
    rawErrorCount: 16, // total error rows
    rawP95Ms: null,
    bucketStart: '2026-05-20T10:00:00.000Z',
    eventCount: 16,
    events,
  }

  const cells: CellDef[] = [
    singleErrorCell,
    ...Array.from({ length: 287 }, () => ({ color: 'var(--card-2)' })),
  ]

  const { container } = render(
    <HealthStrip cells={cells} orientation='vertical' />
  )

  // Trigger the tooltip by hovering the strip.
  const strip = container.firstChild as HTMLElement
  fireEvent.pointerEnter(strip)

  const tip = document.body.querySelector(
    '.v9-tip[data-state="open"]'
  ) as HTMLElement | null
  if (tip === null) {
    // The tooltip may not be auto-generated until the fix is applied.
    // Mark the test as having no open tip → FAIL.
    expect(tip).not.toBeNull()
    return
  }

  const tipText = tip.textContent ?? ''

  // After fix: head must show sum of counts = 48, not 14 (the cap for log lines).
  // "48 events" (or similar) must appear.
  expect(tipText).toMatch(/48\s*events?/i)

  // After fix: overflow row must say "+2 more events" (not "earlier").
  // (16 events − 14 cap = 2 overflow)
  expect(tipText).toMatch(/\+2\s*more\s*events?/i)
})
