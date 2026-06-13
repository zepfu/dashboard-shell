/**
 * Wave 15-D — SlicerBar interaction tests.
 *
 * Component path: src/features/dashboard/components/slicer-bar.tsx
 * Exports: SlicerBar (named), SlicerFilters, SlicerOptions, SLICER_EMPTY_FILTERS
 *
 * Tests cover:
 *  - Renders all 5 dimension labels
 *  - Opening a dimension dropdown shows its options
 *  - Selecting a value calls onChange with the updated filter
 *  - Selecting a value shows a chip with the × remove button
 *  - Clicking × on a chip removes that value from the filter
 *  - "Clear" button resets a single dimension
 *  - "Clear all" button is shown only when any filter is active and resets all
 *  - Empty options renders "No options" message
 */
import { render, screen, fireEvent } from '@testing-library/react'
import {
  SlicerBar,
  SLICER_EMPTY_FILTERS,
  type SlicerFilters,
  type SlicerOptions,
} from './slicer-bar'

const OPTIONS: SlicerOptions = {
  providers: ['anthropic', 'openai', 'google'],
  repositories: ['aawm-project', 'dashboard-shell'],
  clients: ['claude-code', 'cursor'],
  environments: ['prod', 'staging'],
  models: ['claude-3-5-sonnet', 'gpt-4o'],
}

const EMPTY_OPTIONS: SlicerOptions = {
  providers: [],
  repositories: [],
  clients: [],
  environments: [],
  models: [],
}

function renderBar(
  filters: SlicerFilters = { ...SLICER_EMPTY_FILTERS },
  options: SlicerOptions = OPTIONS,
  onChange = vi.fn()
) {
  return render(
    <SlicerBar filters={filters} options={options} onChange={onChange} />
  )
}

test('test_slicer_bar_renders_five_dimension_labels', () => {
  renderBar()

  expect(screen.getByText(/provider/i)).toBeInTheDocument()
  expect(screen.getByText(/repository/i)).toBeInTheDocument()
  expect(screen.getByText(/client/i)).toBeInTheDocument()
  expect(screen.getByText(/environment/i)).toBeInTheDocument()
  expect(screen.getByText(/model/i)).toBeInTheDocument()
})

test('test_slicer_bar_opening_dropdown_shows_options', () => {
  renderBar()

  const providerTrigger = screen.getByRole('button', { name: /provider/i })
  fireEvent.click(providerTrigger)

  expect(screen.getByText('anthropic')).toBeInTheDocument()
  expect(screen.getByText('openai')).toBeInTheDocument()
  expect(screen.getByText('google')).toBeInTheDocument()
})

test('test_slicer_bar_selecting_value_calls_onchange', () => {
  const onChange = vi.fn()
  renderBar({ ...SLICER_EMPTY_FILTERS }, OPTIONS, onChange)

  const providerTrigger = screen.getByRole('button', { name: /provider/i })
  fireEvent.click(providerTrigger)

  const anthropicOption = screen.getByText('anthropic')
  fireEvent.click(anthropicOption)

  expect(onChange).toHaveBeenCalledTimes(1)
  const [nextFilters] = onChange.mock.calls[0] as [SlicerFilters]
  expect(nextFilters.providers).toContain('anthropic')
})

test('test_slicer_bar_active_filter_shows_chip', () => {
  renderBar({
    ...SLICER_EMPTY_FILTERS,
    providers: ['anthropic'],
  })

  // Chip shows the selected value text
  const chip = screen.getByText('anthropic')
  expect(chip).toBeInTheDocument()

  // Chip has a remove button
  const removeBtn = screen.getByRole('button', {
    name: /remove anthropic from provider filter/i,
  })
  expect(removeBtn).toBeInTheDocument()
})

test('test_slicer_bar_removing_chip_calls_onchange', () => {
  const onChange = vi.fn()
  renderBar(
    { ...SLICER_EMPTY_FILTERS, providers: ['anthropic'] },
    OPTIONS,
    onChange
  )

  const removeBtn = screen.getByRole('button', {
    name: /remove anthropic from provider filter/i,
  })
  fireEvent.click(removeBtn)

  expect(onChange).toHaveBeenCalledTimes(1)
  const [nextFilters] = onChange.mock.calls[0] as [SlicerFilters]
  expect(nextFilters.providers).not.toContain('anthropic')
})

test('test_slicer_bar_clear_button_resets_dimension', () => {
  const onChange = vi.fn()
  const { container } = renderBar(
    { ...SLICER_EMPTY_FILTERS, providers: ['anthropic'] },
    OPTIONS,
    onChange
  )

  // Open Provider dropdown via the .slicer-trigger button (first match in the
  // first .slicer-dimension, disambiguates from the chip × remove button)
  const providerDimension = container.querySelector('.slicer-dimension')
  const providerTrigger = providerDimension?.querySelector('.slicer-trigger')
  expect(providerTrigger).not.toBeNull()
  fireEvent.click(providerTrigger!)

  const clearBtn = screen.getByRole('button', { name: /^clear$/i })
  fireEvent.click(clearBtn)

  expect(onChange).toHaveBeenCalledTimes(1)
  const [nextFilters] = onChange.mock.calls[0] as [SlicerFilters]
  expect(nextFilters.providers).toHaveLength(0)
})

test('test_slicer_bar_clear_all_not_shown_when_no_filters', () => {
  renderBar()

  const clearAllBtn = screen.queryByRole('button', {
    name: /clear all dimension filters/i,
  })
  expect(clearAllBtn).toBeNull()
})

test('test_slicer_bar_clear_all_shown_and_resets_all_filters', () => {
  const onChange = vi.fn()
  renderBar(
    { ...SLICER_EMPTY_FILTERS, providers: ['anthropic'], models: ['gpt-4o'] },
    OPTIONS,
    onChange
  )

  const clearAllBtn = screen.getByRole('button', {
    name: /clear all dimension filters/i,
  })
  expect(clearAllBtn).toBeInTheDocument()
  fireEvent.click(clearAllBtn)

  expect(onChange).toHaveBeenCalledTimes(1)
  const [nextFilters] = onChange.mock.calls[0] as [SlicerFilters]
  expect(nextFilters.providers).toHaveLength(0)
  expect(nextFilters.models).toHaveLength(0)
  expect(nextFilters.repositories).toHaveLength(0)
})

test('test_slicer_bar_empty_options_shows_no_options_message', () => {
  renderBar({ ...SLICER_EMPTY_FILTERS }, EMPTY_OPTIONS)

  const providerTrigger = screen.getByRole('button', { name: /provider/i })
  fireEvent.click(providerTrigger)

  expect(screen.getByText(/no options/i)).toBeInTheDocument()
})

// ---------------------------------------------------------------------------
// S5-7: Enter key on list option must not double-toggle (preventDefault)
// ---------------------------------------------------------------------------

/**
 * S5-7 — pressing Enter on a slicer option list item followed by its inherent
 * click event must NOT result in a double-toggle. In browsers, Enter on a
 * focusable `<li>` can fire both `onKeyDown` AND the `onClick` handler when
 * `e.preventDefault()` is absent, causing the selection to be immediately
 * reversed.
 *
 * We simulate the double-fire explicitly by dispatching both keyDown(Enter)
 * AND click on the same `<li>`. With proper `e.preventDefault()` in
 * `handleOptionKeyDown`, the click must be suppressed.
 *
 * EXPECTED FAIL: simulating keyDown(Enter) + click on the same option with
 * no intermediate state update results in onChange being called twice —
 * once to add, once to remove. The test asserts onChange is called exactly
 * once and that the result still contains the value.
 *
 * Current implementation: `handleOptionKeyDown` calls `e.preventDefault()`
 * for Enter, which in JSDOM does NOT prevent the subsequent manual click —
 * both events fire independently, so both calls go through.
 */
test('test_slicer_no_double_toggle_on_enter', () => {
  const onChange = vi.fn()
  renderBar({ ...SLICER_EMPTY_FILTERS }, OPTIONS, onChange)

  // Open Provider dropdown
  const providerTrigger = screen.getByRole('button', { name: /provider/i })
  fireEvent.click(providerTrigger)

  // Find the 'anthropic' option list item
  const anthropicOption = screen.getByText('anthropic').closest('li')
  expect(anthropicOption).not.toBeNull()

  // Simulate the double-fire: Enter keyDown + click (browser behaviour)
  fireEvent.keyDown(anthropicOption!, { key: 'Enter', code: 'Enter' })
  fireEvent.click(anthropicOption!)

  // With proper preventDefault, onChange should be called exactly ONCE.
  // The final filter state must contain 'anthropic' (net add, not add+remove).
  // If double-toggle occurs, the second call removes anthropic → net: empty.
  const allCalls = onChange.mock.calls as [SlicerFilters][]
  const lastCall = allCalls[allCalls.length - 1]
  expect(lastCall[0].providers).toContain('anthropic')

  // Total calls must be exactly 1 (the double-fire produces 2 without fix)
  expect(onChange).toHaveBeenCalledTimes(1)
})

// ---------------------------------------------------------------------------
// S5-9: stale (deselected) chip must carry muted style class
// ---------------------------------------------------------------------------

/**
 * S5-9 — a chip that has been deselected (removed from the filter) must
 * transition to a "stale" / muted visual state rather than disappearing
 * instantaneously with no feedback. The chip should carry a `slicer-chip--stale`
 * or `slicer-chip--muted` class before it is removed from the DOM.
 *
 * EXPECTED FAIL: current implementation removes the chip synchronously on
 * toggle (no stale state). The chip simply disappears — no muted class is
 * applied transitionally.
 *
 * Test: render with a pre-selected filter → click the × remove button →
 * before re-render, the chip should have .slicer-chip--stale or equivalent.
 *
 * Note: since this is a synchronous DOM update test, we check immediately
 * after the click for the stale class before the element is unmounted.
 */
test('test_slicer_stale_chip_muted_style', () => {
  const onChange = vi.fn((nextFilters: SlicerFilters) => {
    // onChange is called but we do NOT re-render (no state update in the stub)
    // The chip remains mounted — we verify it gets the stale class.
    return nextFilters
  })

  renderBar(
    { ...SLICER_EMPTY_FILTERS, providers: ['anthropic'] },
    OPTIONS,
    onChange
  )

  // Chip is initially rendered and active
  const chip = screen
    .getByText('anthropic')
    .closest('.slicer-chip') as HTMLElement | null
  expect(chip).not.toBeNull()
  expect(chip?.classList.contains('slicer-chip--stale')).toBe(false)

  // Click × to remove
  const removeBtn = screen.getByRole('button', {
    name: /remove anthropic from provider filter/i,
  })
  fireEvent.click(removeBtn)

  // After clicking ×, the chip should carry a stale/muted class
  // (implementation must add the class before the parent removes it from state)
  // The chip may or may not still be in the DOM depending on re-render timing.
  // In the controlled stub (onChange does not update state), the chip stays mounted.
  const chipAfter = screen
    .queryByText('anthropic')
    ?.closest('.slicer-chip') as HTMLElement | null

  if (chipAfter !== null) {
    // If still mounted, must carry stale class
    const hasStaleClass =
      chipAfter.classList.contains('slicer-chip--stale') ||
      chipAfter.classList.contains('slicer-chip--muted')
    expect(hasStaleClass).toBe(true)
  } else {
    // Chip was removed — stale state was never implemented
    // This is the expected failure path: chip disappears without muted style.
    expect(chipAfter).not.toBeNull() // intentional fail — stale chip must exist
  }
})
