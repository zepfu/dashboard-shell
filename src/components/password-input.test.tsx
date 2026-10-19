import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, test } from 'vitest'
import { PasswordInput } from './password-input'

describe('PasswordInput visibility label', () => {
  test('names the toggle Show password and Hide password', async () => {
    const user = userEvent.setup()
    render(<PasswordInput aria-label='Password' />)

    const input = screen.getByLabelText('Password')
    expect(input).toHaveAttribute('type', 'password')

    const show = screen.getByRole('button', { name: 'Show password' })
    expect(show).toHaveAttribute('type', 'button')
    await user.click(show)

    expect(input).toHaveAttribute('type', 'text')
    expect(
      screen.getByRole('button', { name: 'Hide password' })
    ).toBeInTheDocument()
  })
})
