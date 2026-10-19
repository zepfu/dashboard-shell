import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, test, vi } from 'vitest'
import { Search } from './search'

const setOpen = vi.hoisted(() => vi.fn())

vi.mock('@/context/search-provider', () => ({
  useSearch: () => ({ open: false, setOpen }),
}))

describe('Search shortcut accessibility', () => {
  test('exposes the command shortcut and still opens search', async () => {
    const user = userEvent.setup()
    setOpen.mockClear()
    render(<Search />)

    const button = screen.getByRole('button', { name: /search/i })
    expect(button).toHaveAttribute('aria-keyshortcuts', 'Meta+K Control+K')
    await user.click(button)
    expect(setOpen).toHaveBeenCalledWith(true)
  })
})
