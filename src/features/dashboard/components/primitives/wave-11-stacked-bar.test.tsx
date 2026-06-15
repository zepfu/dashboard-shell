/**
 * Wave 11 — StackedBar primitive structural-parity test (S3-12).
 *
 * ENGINEER: C
 *
 * The W11 decomposition extracts the stacked-bar rendering pattern (currently
 * inline in `token-trend-chart.tsx` ~lines 2585-2636) into a standalone
 * `primitives/stacked-bar.tsx` component.
 *
 * WHAT THIS TESTS:
 *   Structural parity — the new `<StackedBar>` primitive must produce the same
 *   DOM structure as the former inline call sites:
 *     - A container div with class `trend-bar`
 *     - One slice div per series with tokens > 0, with class `tt-slice <cssClass>`
 *     - Each slice carries an inline `background` style (from the series color)
 *     - Each slice carries `flexBasis` proportional to the token fraction
 *     - Empty series (tokens === 0) are NOT rendered
 *     - Container uses `flex-direction: column-reverse` (bottom-up stacking)
 *
 * The former call sites are:
 *   (a) 24-bucket hourly bars (~lines 2294-2341 in token-trend-chart.tsx)
 *   (b) The outer daily/weekly bars (~lines 2585-2636)
 *
 * Both produce structurally identical DOM (same class names, same style patterns).
 * The StackedBar primitive must reproduce this structure exactly so that existing
 * CSS rules (`.tt-slice`, `.trend-bar`, `.tt-anthropic`, etc.) continue to apply.
 *
 * RED until Engineer C creates `primitives/stacked-bar.tsx`.
 */
import { render } from '@testing-library/react'
import { describe, expect, test } from 'vitest'
// RED: module does not exist yet — import fails until Engineer C creates it.
// @ts-expect-error — module created by Engineer C in W11
import { StackedBar } from './stacked-bar'

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const SERIES_WITH_TOKENS = [
  {
    key: 'anthropic',
    label: 'Anthropic',
    color: '#d97757',
    cssClass: 'tt-anthropic',
    tokens: 600,
  },
  {
    key: 'openai',
    label: 'OpenAI',
    color: '#10a37f',
    cssClass: 'tt-openai',
    tokens: 300,
  },
  {
    key: 'google',
    label: 'Google',
    color: '#4285f4',
    cssClass: 'tt-google',
    tokens: 100,
  },
  // Zero-token entry — must NOT render a slice.
  {
    key: 'xai',
    label: 'xAI',
    color: '#475569',
    cssClass: 'tt-xai',
    tokens: 0,
  },
]

const TOTAL_TOKENS = 1000 // 600 + 300 + 100 + 0

// ---------------------------------------------------------------------------
// Structural parity tests (S3-12)
// ---------------------------------------------------------------------------

describe('StackedBar primitive structural parity (S3-12)', () => {
  test('test_stacked_bar_renders_trend_bar_container', () => {
    const { container } = render(
      <StackedBar
        series={SERIES_WITH_TOKENS}
        total={TOTAL_TOKENS}
        heightPct={85}
      />
    )

    // Container must have class `trend-bar` — same class as the former inline div.
    const bar = container.querySelector('.trend-bar')
    expect(bar).not.toBeNull()
  })

  test('test_stacked_bar_column_reverse_flex_direction', () => {
    const { container } = render(
      <StackedBar
        series={SERIES_WITH_TOKENS}
        total={TOTAL_TOKENS}
        heightPct={85}
      />
    )

    const bar = container.querySelector('.trend-bar') as HTMLElement | null
    expect(bar).not.toBeNull()
    // Bottom-up stacking (bars grow from bottom): must use column-reverse.
    expect(bar?.style.flexDirection).toBe('column-reverse')
  })

  test('test_stacked_bar_height_pct_applied', () => {
    const { container } = render(
      <StackedBar
        series={SERIES_WITH_TOKENS}
        total={TOTAL_TOKENS}
        heightPct={42.7}
      />
    )

    const bar = container.querySelector('.trend-bar') as HTMLElement | null
    expect(bar).not.toBeNull()
    // Height is set via inline style as a percentage string.
    expect(bar?.style.height).toMatch(/42\.\d+%/)
  })

  test('test_stacked_bar_renders_slice_per_nonzero_series', () => {
    const { container } = render(
      <StackedBar
        series={SERIES_WITH_TOKENS}
        total={TOTAL_TOKENS}
        heightPct={100}
      />
    )

    // 3 series have tokens > 0, 1 has tokens === 0.
    const slices = container.querySelectorAll('.tt-slice')
    expect(slices.length).toBe(3)
  })

  test('test_stacked_bar_zero_token_series_not_rendered', () => {
    const { container } = render(
      <StackedBar
        series={SERIES_WITH_TOKENS}
        total={TOTAL_TOKENS}
        heightPct={100}
      />
    )

    // The xai series has 0 tokens — its cssClass must not appear.
    const xaiSlice = container.querySelector('.tt-xai')
    expect(xaiSlice).toBeNull()
  })

  test('test_stacked_bar_slice_has_provider_css_class', () => {
    const { container } = render(
      <StackedBar
        series={SERIES_WITH_TOKENS}
        total={TOTAL_TOKENS}
        heightPct={100}
      />
    )

    // Each non-zero slice must have both tt-slice AND its provider cssClass.
    expect(container.querySelector('.tt-slice.tt-anthropic')).not.toBeNull()
    expect(container.querySelector('.tt-slice.tt-openai')).not.toBeNull()
    expect(container.querySelector('.tt-slice.tt-google')).not.toBeNull()
  })

  test('test_stacked_bar_slice_inline_background_color', () => {
    const { container } = render(
      <StackedBar
        series={SERIES_WITH_TOKENS}
        total={TOTAL_TOKENS}
        heightPct={100}
      />
    )

    const anthropicSlice = container.querySelector(
      '.tt-slice.tt-anthropic'
    ) as HTMLElement | null
    expect(anthropicSlice).not.toBeNull()
    // Inline background must be set (parity with F8a color resolution).
    // Accept any non-empty background that includes the color value.
    expect(anthropicSlice?.style.background).toBeTruthy()
  })

  test('test_stacked_bar_slice_flex_basis_proportional', () => {
    const { container } = render(
      <StackedBar
        series={SERIES_WITH_TOKENS}
        total={TOTAL_TOKENS}
        heightPct={100}
      />
    )

    // anthropic = 600/1000 = 60%; openai = 300/1000 = 30%; google = 100/1000 = 10%
    const anthropicSlice = container.querySelector(
      '.tt-slice.tt-anthropic'
    ) as HTMLElement | null
    const openaiSlice = container.querySelector(
      '.tt-slice.tt-openai'
    ) as HTMLElement | null
    const googleSlice = container.querySelector(
      '.tt-slice.tt-google'
    ) as HTMLElement | null

    expect(anthropicSlice).not.toBeNull()
    expect(openaiSlice).not.toBeNull()
    expect(googleSlice).not.toBeNull()

    // flexBasis should reflect proportional token share.
    const anthropicBasis = parseFloat(anthropicSlice?.style.flexBasis ?? '0')
    const openaiBasis = parseFloat(openaiSlice?.style.flexBasis ?? '0')
    const googleBasis = parseFloat(googleSlice?.style.flexBasis ?? '0')

    expect(anthropicBasis).toBeCloseTo(60, 0)
    expect(openaiBasis).toBeCloseTo(30, 0)
    expect(googleBasis).toBeCloseTo(10, 0)
  })

  test('test_stacked_bar_slice_min_height_1px', () => {
    /**
     * Each slice must have minHeight: '1px' so that very small slices remain
     * visible — same requirement as the former inline implementation.
     */
    const { container } = render(
      <StackedBar
        series={SERIES_WITH_TOKENS}
        total={TOTAL_TOKENS}
        heightPct={100}
      />
    )

    const anthropicSlice = container.querySelector(
      '.tt-slice.tt-anthropic'
    ) as HTMLElement | null
    expect(anthropicSlice).not.toBeNull()
    expect(anthropicSlice?.style.minHeight).toBe('1px')
  })

  test('test_stacked_bar_overflow_hidden_on_container', () => {
    /**
     * The container must have overflow: hidden to clip slices that would
     * overflow due to rounding errors — parity with the inline implementation.
     */
    const { container } = render(
      <StackedBar
        series={SERIES_WITH_TOKENS}
        total={TOTAL_TOKENS}
        heightPct={50}
      />
    )

    const bar = container.querySelector('.trend-bar') as HTMLElement | null
    expect(bar).not.toBeNull()
    expect(bar?.style.overflow).toBe('hidden')
  })
})

// ---------------------------------------------------------------------------
// Edge cases
// ---------------------------------------------------------------------------

describe('StackedBar primitive edge cases', () => {
  test('test_stacked_bar_all_zero_tokens_renders_empty_bar', () => {
    const allZeroSeries = SERIES_WITH_TOKENS.map((s) => ({ ...s, tokens: 0 }))

    const { container } = render(
      <StackedBar series={allZeroSeries} total={0} heightPct={100} />
    )

    // Container still present but no slices.
    const bar = container.querySelector('.trend-bar')
    expect(bar).not.toBeNull()
    const slices = container.querySelectorAll('.tt-slice')
    expect(slices.length).toBe(0)
  })

  test('test_stacked_bar_single_provider_full_width', () => {
    const singleSeries = [
      {
        key: 'anthropic',
        label: 'Anthropic',
        color: '#d97757',
        cssClass: 'tt-anthropic',
        tokens: 1000,
      },
    ]

    const { container } = render(
      <StackedBar series={singleSeries} total={1000} heightPct={100} />
    )

    const slice = container.querySelector(
      '.tt-slice.tt-anthropic'
    ) as HTMLElement | null
    expect(slice).not.toBeNull()
    // 1000/1000 = 100%
    const basis = parseFloat(slice?.style.flexBasis ?? '0')
    expect(basis).toBeCloseTo(100, 0)
  })

  test('test_stacked_bar_opacity_set_on_container', () => {
    /**
     * The former inline bars used opacity: 0.85 (outer bars) and opacity: 0.66
     * (hourly bars).  The StackedBar primitive must accept an opacity prop or
     * apply a default — this prevents the bars from being fully opaque (which
     * would break the CSS .trend-bar:hover → opacity:1 transition effect).
     */
    const { container } = render(
      <StackedBar
        series={SERIES_WITH_TOKENS}
        total={TOTAL_TOKENS}
        heightPct={85}
        opacity={0.85}
      />
    )

    const bar = container.querySelector('.trend-bar') as HTMLElement | null
    expect(bar).not.toBeNull()
    // Accept any opacity value < 1 — the exact value depends on call site.
    const opacity = parseFloat(bar?.style.opacity ?? '1')
    expect(opacity).toBeLessThan(1)
    expect(opacity).toBeGreaterThan(0)
  })
})

// ---------------------------------------------------------------------------
// Parity with former token-trend-chart call sites
// ---------------------------------------------------------------------------

describe('StackedBar parity with TokenTrendChart call sites', () => {
  test('test_stacked_bar_matches_expected_structure_for_outer_bar', () => {
    /**
     * The outer daily/weekly bar (former call site b) renders:
     *   <div className="trend-bar" style={{ flex: '0 0 auto', width: '100%', height: '85.0%', ... }}>
     *     <div className="tt-slice tt-anthropic" style={{ flexBasis: '60.0000%', ... }} />
     *     ...
     *   </div>
     *
     * Assert the StackedBar primitive produces equivalent structure.
     */
    const { container } = render(
      <StackedBar
        series={SERIES_WITH_TOKENS}
        total={TOTAL_TOKENS}
        heightPct={85}
        flex='0 0 auto'
      />
    )

    const bar = container.querySelector('.trend-bar') as HTMLElement | null
    expect(bar).not.toBeNull()
    expect(bar?.style.flex).toBe('0 0 auto')
    expect(bar?.style.width).toBe('100%')
    expect(bar?.style.flexDirection).toBe('column-reverse')

    // Three non-zero slices.
    expect(container.querySelectorAll('.tt-slice').length).toBe(3)
  })
})
