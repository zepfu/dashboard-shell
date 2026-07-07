/**
 * ReasoningTokenValue — provider card / master ledger reasoning token display.
 */
import { render, screen } from '@testing-library/react'
import { ReasoningTokenValue } from '../primitives/reasoning-token-value'

test('test_reasoning_token_value_double_count_guarded', () => {
  render(<ReasoningTokenValue reported={1000} estimated={500} />)

  const valueEl = document.querySelector('.reasoning-token-value')
  expect(valueEl).not.toBeNull()

  const text = valueEl?.textContent ?? ''
  expect(text).toContain('1.5K')
  expect(text).not.toContain('2K')

  const estMark = valueEl?.querySelector('.est-mark')
  expect(estMark).not.toBeNull()
  expect(estMark?.textContent).toBe('*')
})

test('test_reasoning_token_value_reported_only_no_asterisk', () => {
  render(<ReasoningTokenValue reported={2000} estimated={null} />)

  const valueEl = document.querySelector('.reasoning-token-value')
  expect(valueEl).not.toBeNull()
  expect(valueEl?.textContent).toContain('2.0K')

  const estMark = valueEl?.querySelector('.est-mark')
  expect(estMark).toBeNull()
})

test('test_reasoning_token_negative_estimate_clamped', () => {
  render(<ReasoningTokenValue reported={1000} estimated={-200} />)

  const valueEl = document.querySelector('.reasoning-token-value')
  expect(valueEl).not.toBeNull()

  const text = valueEl?.textContent ?? ''
  expect(text).toContain('1.0K')
  expect(text).not.toContain('800')

  const estMark = valueEl?.querySelector('.est-mark')
  expect(estMark).toBeNull()
})

test('test_negative_reported_clamped_to_zero', () => {
  render(<ReasoningTokenValue reported={-500} estimated={200} />)

  const valueEl = document.querySelector('.reasoning-token-value')
  expect(valueEl).not.toBeNull()

  const text = valueEl?.textContent ?? ''
  // total = max(0, reported) + estimated = 0 + 200 → 200
  expect(text).toContain('200')
  expect(text).not.toContain('-')
})

test('test_reasoning_token_value_both_absent_renders_dash', () => {
  render(<ReasoningTokenValue />)
  expect(screen.getByText('—')).toBeInTheDocument()
})
