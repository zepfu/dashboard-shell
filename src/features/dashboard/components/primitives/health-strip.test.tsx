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
import { HealthStrip } from '../primitives/health-strip'

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

  const { container } = render(
    <HealthStrip
      cells={cells}
      orientation='vertical'
      tooltipContent={tooltipContent}
    />
  )

  // Tip panel should be present (hidden initially via opacity)
  const tip = container.querySelector('.v9-tip')
  expect(tip).not.toBeNull()

  // Head and row structure
  const head = container.querySelector('.v9-tip-head')
  expect(head).not.toBeNull()
  expect(head?.textContent).toContain('event')

  const row = container.querySelector('.v9-tip-row')
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

  const tip = container.querySelector('.v9-tip')
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

  const { container } = render(
    <HealthStrip cells={cells} orientation='vertical' />
  )

  const rows = container.querySelectorAll('.v9-tip-row')
  expect(rows.length).toBe(2)

  const firstRow = rows[0]
  expect(firstRow.querySelector('.t-time')?.textContent).toBe('13:42')
  expect(firstRow.querySelector('.t-model')?.textContent).toBe('gpt-4o')
  expect(firstRow.querySelector('.t-err')?.textContent).toBe('503 capacity')
  expect(firstRow.querySelector('.t-count')?.textContent).toBe('x1')
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

  const { container } = render(
    <HealthStrip cells={cells} orientation='vertical' />
  )

  const rows = container.querySelectorAll('.v9-tip-row')
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

  const { container } = render(
    <HealthStrip cells={cells} orientation='vertical' />
  )

  // Head should be present
  const head = container.querySelector('.v9-tip-head')
  expect(head).not.toBeNull()

  // No body rows — bucket is error-free, nothing to enumerate
  const rows = container.querySelectorAll('.v9-tip-row')
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

  const { container } = render(
    <HealthStrip cells={cells} orientation='vertical' />
  )

  // Should have one row per non-zero field (4 non-zero: provider_error, 5xx, rate_limit, capacity)
  const rows = container.querySelectorAll('.v9-tip-row')
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

  const { container } = render(
    <HealthStrip cells={cells} orientation='vertical' />
  )

  const head = container.querySelector('.v9-tip-head')
  expect(head).not.toBeNull()
  expect(head?.textContent).toContain('0 events')

  const rows = container.querySelectorAll('.v9-tip-row')
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

  const { container } = render(
    <HealthStrip cells={cells} orientation='vertical' />
  )

  const rows = container.querySelectorAll('.v9-tip-row')
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
