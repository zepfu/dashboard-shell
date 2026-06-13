/**
 * ReasoningTokenValue tests — Wave 5 adversarial review.
 *
 * Component path: src/features/dashboard/components/primitives/reasoning-token-value.tsx
 * Expected export: ReasoningTokenValue (named)
 * Props: { reported?: number | null; estimated?: number | null }
 *
 * Covers:
 *  G-1/G-2: double-count guard when both reported + estimated are present
 *  G-3: negative estimate is clamped to 0 (not shown as negative total)
 */
import { render, screen } from '@testing-library/react'
import { ReasoningTokenValue } from '../primitives/reasoning-token-value'

// ---------------------------------------------------------------------------
// G-1/G-2: double-count guard — both reported and estimated present
// ---------------------------------------------------------------------------

/**
 * G-1 — when both `reported` and `estimated` are provided, the displayed
 * total must be reported + estimated, NOT reported counted twice.
 *
 * A double-count bug would add both values when one is already embedded in
 * the other. The component should sum them directly: total = reported + estimated.
 *
 * Fixture: reported=1000, estimated=500 → correct total = 1500.
 *
 * EXPECTED PASS: current implementation does `total = reportedValue + estimatedValue`
 * which is correct. This guards against regression where double-counting is
 * introduced (e.g., estimated already includes reported).
 */
test('test_reasoning_token_value_double_count_guarded', () => {
  render(<ReasoningTokenValue reported={1000} estimated={500} />)

  // Total should be 1500 (1000 + 500), rendered via fmtCompact
  // fmtCompact(1500) = "1.5K"
  const valueEl = document.querySelector('.reasoning-token-value')
  expect(valueEl).not.toBeNull()

  // The displayed text must contain the compact representation of 1500
  const text = valueEl?.textContent ?? ''
  // fmtCompact(1500) = "1.5K" — must be present in the element's text
  expect(text).toContain('1.5K')

  // Must NOT show double-counted values like "2K" (2000 = 1000+1000)
  // or "1K" (just reported alone)
  expect(text).not.toContain('2K')

  // The estimated asterisk marker must appear when estimated > 0
  const estMark = valueEl?.querySelector('.est-mark')
  expect(estMark).not.toBeNull()
  expect(estMark?.textContent).toBe('*')
})

/**
 * G-2 — when only `reported` is provided (estimated absent/null), the display
 * shows only the reported value without asterisk (no estimation noise).
 *
 * EXPECTED PASS: current component returns `content` (no HoverTooltip) when
 * estimatedValue <= 0. This is a regression guard.
 */
test('test_reasoning_token_value_reported_only_no_asterisk', () => {
  render(<ReasoningTokenValue reported={2000} estimated={null} />)

  const valueEl = document.querySelector('.reasoning-token-value')
  expect(valueEl).not.toBeNull()

  // Should display fmtCompact(2000) = "2.0K"
  expect(valueEl?.textContent).toContain('2.0K')

  // No asterisk when only reported value is present
  const estMark = valueEl?.querySelector('.est-mark')
  expect(estMark).toBeNull()
})

// ---------------------------------------------------------------------------
// G-3: negative estimate clamped to 0
// ---------------------------------------------------------------------------

/**
 * G-3 — a negative `estimated` value (data pipeline bug or rounding artifact)
 * must be clamped to 0, not allowed to reduce the displayed total below
 * `reported`.
 *
 * Example: reported=1000, estimated=-200 → should display 1000 (not 800).
 *
 * EXPECTED FAIL: current implementation does:
 *   const estimatedValue = estimated ?? 0
 *   const total = reportedValue + estimatedValue
 * With estimated=-200: total = 1000 + (-200) = 800. No clamping occurs.
 * The test expects 1000 (reported only, negative estimate clamped to 0).
 */
test('test_reasoning_token_negative_estimate_clamped', () => {
  render(<ReasoningTokenValue reported={1000} estimated={-200} />)

  const valueEl = document.querySelector('.reasoning-token-value')
  expect(valueEl).not.toBeNull()

  const text = valueEl?.textContent ?? ''

  // Should display fmtCompact(1000) = "1.0K" — reported value only
  // (negative estimate clamped to 0, so no subtraction from reported)
  expect(text).toContain('1.0K')

  // Must NOT show reduced value "800" (unclamped subtraction: 1000 + -200 = 800)
  expect(text).not.toContain('800')

  // Negative estimate clamped to 0 → estimatedValue = 0 → no asterisk
  // (because estimatedValue <= 0 after clamping)
  const estMark = valueEl?.querySelector('.est-mark')
  expect(estMark).toBeNull()
})

/**
 * Baseline: both reported and estimated absent → renders em-dash.
 */
test('test_reasoning_token_value_both_absent_renders_dash', () => {
  render(<ReasoningTokenValue />)
  expect(screen.getByText('—')).toBeInTheDocument()
})
