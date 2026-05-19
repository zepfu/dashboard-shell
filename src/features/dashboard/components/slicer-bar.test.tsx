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
