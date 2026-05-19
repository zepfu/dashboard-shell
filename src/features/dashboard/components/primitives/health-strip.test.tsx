/**
 * Wave 3 — HealthStrip red-phase tests.
 *
 * Component path: src/features/dashboard/components/primitives/health-strip.tsx
 * Expected export: HealthStrip (named)
 * Props: { cells: CellDef[] } — expects 288 cells; pads sparse data.
 *
 * Wave 20 additions: category/intensity → RGBA mapping, cat-miss class,
 * tip-health tooltip structure.
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

test('test_health_strip_normal_category_applies_blue_rgba', () => {
  // 'normal' category should produce rgba(58,130,243,...) background
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

test('test_health_strip_teal_category_applies_teal_rgba', () => {
  // 'teal' category should produce rgba(20,184,166,...) background
  const cells = [
    { color: 'var(--card-2)', category: 'teal' as const, intensity: 0.5 },
    ...Array.from({ length: 287 }, () => ({ color: 'var(--card-2)' })),
  ]
  const { container } = render(<HealthStrip cells={cells} />)

  const cellEls = container.querySelectorAll('.health-strip-cell')
  const firstCell = cellEls[0] as HTMLElement
  const bg = firstCell.style.background || firstCell.style.backgroundColor

  // Teal family: rgb(20, 184, 166) at some alpha
  expect(bg).toMatch(/rgba?\(20,\s*184,\s*166/)
})

test('test_health_strip_warning_category_applies_amber_rgba', () => {
  // 'warning' category should produce rgba(245,158,11,...) background
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
// Wave 24 — percentile-based amber threshold (Bug F9)
// ---------------------------------------------------------------------------

test('test_health_strip_raw_metrics_normal_bucket_is_blue', () => {
  // A bucket with p95 in the middle of the distribution → normal (blue).
  // Distribution: 20 cells spanning 100–2000ms.
  // sorted[10] = p50 = 1100ms; sorted[18] = p90 = 1900ms.
  // Test cell at 1200ms: above p50 (not teal) and below p90 (not amber) → normal.
  const testCell = { color: 'var(--card-2)', rawP95Ms: 1200, rawErrorCount: 0 }
  const others = [
    { color: 'var(--card-2)', rawP95Ms: 100, rawErrorCount: 0 },
    { color: 'var(--card-2)', rawP95Ms: 200, rawErrorCount: 0 },
    { color: 'var(--card-2)', rawP95Ms: 300, rawErrorCount: 0 },
    { color: 'var(--card-2)', rawP95Ms: 400, rawErrorCount: 0 },
    { color: 'var(--card-2)', rawP95Ms: 500, rawErrorCount: 0 },
    { color: 'var(--card-2)', rawP95Ms: 600, rawErrorCount: 0 },
    { color: 'var(--card-2)', rawP95Ms: 700, rawErrorCount: 0 },
    { color: 'var(--card-2)', rawP95Ms: 800, rawErrorCount: 0 },
    { color: 'var(--card-2)', rawP95Ms: 900, rawErrorCount: 0 },
    { color: 'var(--card-2)', rawP95Ms: 1000, rawErrorCount: 0 },
    // testCell 1200ms placed here in sorted order
    { color: 'var(--card-2)', rawP95Ms: 1300, rawErrorCount: 0 },
    { color: 'var(--card-2)', rawP95Ms: 1400, rawErrorCount: 0 },
    { color: 'var(--card-2)', rawP95Ms: 1500, rawErrorCount: 0 },
    { color: 'var(--card-2)', rawP95Ms: 1600, rawErrorCount: 0 },
    { color: 'var(--card-2)', rawP95Ms: 1700, rawErrorCount: 0 },
    { color: 'var(--card-2)', rawP95Ms: 1800, rawErrorCount: 0 },
    { color: 'var(--card-2)', rawP95Ms: 1900, rawErrorCount: 0 }, // p90
    { color: 'var(--card-2)', rawP95Ms: 2000, rawErrorCount: 0 },
    { color: 'var(--card-2)', rawP95Ms: 2100, rawErrorCount: 0 },
  ]
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

  // Should be blue (normal): above p50 so not teal; below p90 so not amber
  expect(bg).toMatch(/rgba?\(58,\s*130,\s*243/)
})

test('test_health_strip_raw_metrics_high_latency_bucket_is_amber', () => {
  // A bucket with p95 strictly exceeding the strip p90 → warning (amber).
  // 11 non-padding cells so p90 index = Math.floor(11*0.9) = 9.
  // Sorted values: [100,200,300,400,500,600,700,800,900,3000,5000]
  //   → p90 = sorted[9] = 3000ms
  // First cell at 5000ms: 5000 > 3000 → amber.
  const cells = [
    { color: 'var(--card-2)', rawP95Ms: 5000, rawErrorCount: 0 }, // >> p90(3000) → amber
    { color: 'var(--card-2)', rawP95Ms: 100, rawErrorCount: 0 },
    { color: 'var(--card-2)', rawP95Ms: 200, rawErrorCount: 0 },
    { color: 'var(--card-2)', rawP95Ms: 300, rawErrorCount: 0 },
    { color: 'var(--card-2)', rawP95Ms: 400, rawErrorCount: 0 },
    { color: 'var(--card-2)', rawP95Ms: 500, rawErrorCount: 0 },
    { color: 'var(--card-2)', rawP95Ms: 600, rawErrorCount: 0 },
    { color: 'var(--card-2)', rawP95Ms: 700, rawErrorCount: 0 },
    { color: 'var(--card-2)', rawP95Ms: 800, rawErrorCount: 0 },
    { color: 'var(--card-2)', rawP95Ms: 900, rawErrorCount: 0 },
    { color: 'var(--card-2)', rawP95Ms: 3000, rawErrorCount: 0 }, // p90 anchor value
    ...Array.from({ length: 277 }, () => ({ color: 'var(--card-2)' })),
  ]

  const { container } = render(<HealthStrip cells={cells} />)
  const cellEls = container.querySelectorAll('.health-strip-cell')
  const firstCell = cellEls[0] as HTMLElement
  const bg = firstCell.style.background || firstCell.style.backgroundColor

  // Should be amber (warning): p95=5000ms strictly exceeds p90=3000ms
  expect(bg).toMatch(/rgba?\(245,\s*158,\s*11/)
})

test('test_health_strip_raw_metrics_error_bucket_is_amber', () => {
  // Any non-zero rawErrorCount triggers amber regardless of latency
  const cells = [
    { color: 'var(--card-2)', rawP95Ms: 200, rawErrorCount: 1 }, // error → amber
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

test('test_health_strip_raw_metrics_low_latency_bucket_is_teal', () => {
  // A bucket with p95 below the strip p50 → teal (cache-hit band)
  // 10 cells; p50 ≈ 500ms; first cell at 50ms is below p50 → teal
  const cells = [
    { color: 'var(--card-2)', rawP95Ms: 50, rawErrorCount: 0 }, // < p50 → teal
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

  // Should be teal (low-latency / cache-hit band)
  expect(bg).toMatch(/rgba?\(20,\s*184,\s*166/)
})

test('test_health_strip_raw_metrics_miss_bucket_gets_cat_miss_class', () => {
  // rawP95Ms: null + rawErrorCount: 0 → attribution gap → cat-miss
  const cells = [
    { color: 'var(--card-2)', rawP95Ms: null, rawErrorCount: 0 },
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

test('test_health_strip_amber_frequency_stays_rare_with_raw_metrics', () => {
  // Simulate 288 cells with realistic latency distribution.
  // Amber should appear in at most ~10% of traffic cells (p90 rule).
  // Build a log-normal-ish distribution: most cells 100-800ms, a few spikes.
  const latencies = Array.from({ length: 288 }, (_, i) => {
    if (i < 258) return 100 + (i % 8) * 100 // 100-800ms → normal
    if (i < 274) return 900 + (i % 4) * 100 // 900-1200ms → near p90
    return 2000 + i * 10 // >2000ms → above p90 → amber
  })

  const cells = latencies.map((p95) => ({
    color: 'var(--card-2)',
    rawP95Ms: p95,
    rawErrorCount: 0,
  }))

  const { container } = render(<HealthStrip cells={cells} />)
  const allCells = container.querySelectorAll('.health-strip-cell')
  let amberCount = 0
  for (const el of allCells) {
    const bg = (el as HTMLElement).style.background
    if (bg.includes('245') && bg.includes('158') && bg.includes('11')) {
      amberCount++
    }
  }

  // At most ~10% amber (p90 rule); target is 2-5% in practice
  expect(amberCount).toBeLessThanOrEqual(Math.ceil(288 * 0.12))
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

test('test_health_strip_tip_health_undefined_events_shows_no_detail', () => {
  // events is undefined → single row with "no event detail"
  const cells = [
    {
      color: 'var(--card-2)',
      bucketStart: new Date(Date.now() - 14 * 3600 * 1000).toISOString(),
      eventCount: 0,
      // events intentionally omitted
    },
    ...Array.from({ length: 287 }, () => ({ color: 'var(--card-2)' })),
  ]

  const { container } = render(
    <HealthStrip cells={cells} orientation='vertical' />
  )

  const rows = container.querySelectorAll('.v9-tip-row')
  expect(rows.length).toBe(1)

  const errSpan = rows[0].querySelector('.t-err')
  expect(errSpan?.textContent).toBe('no event detail')
})
