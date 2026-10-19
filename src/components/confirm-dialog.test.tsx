import type { FormEvent } from 'react'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, test, vi } from 'vitest'
import { UsersDeleteDialog } from '@/features/users/components/users-delete-dialog'
import { type User } from '@/features/users/data/schema'
import { ConfirmDialog } from './confirm-dialog'

vi.mock('@/lib/show-submitted-data', () => ({
  showSubmittedData: vi.fn(),
}))

const userRow: User = {
  id: '1',
  firstName: 'Ada',
  lastName: 'Lovelace',
  username: 'ada',
  email: 'ada@example.com',
  phoneNumber: '555',
  status: 'active',
  role: 'admin',
  createdAt: new Date('2026-01-01T00:00:00Z'),
  updatedAt: new Date('2026-01-01T00:00:00Z'),
}

describe('ConfirmDialog', () => {
  test('click callers still confirm through handleConfirm', async () => {
    const user = userEvent.setup()
    const handleConfirm = vi.fn()
    render(
      <ConfirmDialog
        open
        onOpenChange={() => undefined}
        title='Delete this task'
        desc='This action cannot be undone.'
        confirmText='Delete'
        handleConfirm={handleConfirm}
      />
    )

    const confirm = screen.getByRole('button', { name: 'Delete' })
    expect(confirm).toHaveAttribute('type', 'button')
    await user.click(confirm)
    expect(handleConfirm).toHaveBeenCalledOnce()
  })

  test('form confirmation uses a disabled submit button until the caller enables it', async () => {
    const user = userEvent.setup()
    const onSubmit = vi.fn((event: FormEvent<HTMLFormElement>) => {
      event.preventDefault()
    })

    const { rerender } = render(
      <ConfirmDialog
        open
        onOpenChange={() => undefined}
        title='Delete'
        disabled
        form='confirm-form'
        confirmText='Delete'
        desc={
          <form id='confirm-form' onSubmit={onSubmit}>
            <label htmlFor='confirm-word'>Confirm</label>
            <input id='confirm-word' />
          </form>
        }
      />
    )

    const confirm = screen.getByRole('button', { name: 'Delete' })
    expect(confirm).toHaveAttribute('type', 'submit')
    expect(confirm).toHaveAttribute('form', 'confirm-form')
    expect(confirm).toBeDisabled()

    rerender(
      <ConfirmDialog
        open
        onOpenChange={() => undefined}
        title='Delete'
        disabled={false}
        form='confirm-form'
        confirmText='Delete'
        desc={
          <form id='confirm-form' onSubmit={onSubmit}>
            <label htmlFor='confirm-word'>Confirm</label>
            <input id='confirm-word' defaultValue='DELETE' />
          </form>
        }
      />
    )

    await user.click(screen.getByRole('button', { name: 'Delete' }))
    expect(onSubmit).toHaveBeenCalledOnce()
  })
})

describe('UsersDeleteDialog typed confirmation', () => {
  test('keeps deletion disabled until the username matches', async () => {
    const user = userEvent.setup()
    const { showSubmittedData } = await import('@/lib/show-submitted-data')
    render(
      <UsersDeleteDialog
        open
        onOpenChange={() => undefined}
        currentRow={userRow}
      />
    )

    const confirm = screen.getByRole('button', { name: 'Delete' })
    expect(confirm).toBeDisabled()
    await user.type(
      screen.getByPlaceholderText('Enter username to confirm deletion.'),
      'nope{Enter}'
    )
    expect(showSubmittedData).not.toHaveBeenCalled()
    expect(confirm).toBeDisabled()

    await user.clear(
      screen.getByPlaceholderText('Enter username to confirm deletion.')
    )
    await user.type(
      screen.getByPlaceholderText('Enter username to confirm deletion.'),
      'ada{Enter}'
    )
    expect(showSubmittedData).toHaveBeenCalledOnce()
  })
})
