/**
 * Wave 10 — users fixture loading (P12-F3)
 */
import { afterEach, describe, expect, test, vi } from 'vitest'

const validRow = {
  id: '550e8400-e29b-41d4-a716-446655440001',
  firstName: 'Alice',
  lastName: 'Johnson',
  username: 'alice.johnson',
  email: 'alice@company.com',
  phoneNumber: '+1 (555) 123-4567',
  status: 'active',
  role: 'superadmin',
  createdAt: '2023-06-15T10:30:00.000Z',
  updatedAt: '2024-01-20T14:45:00.000Z',
}

describe('users fixture loading (Wave 10 — P12-F3)', () => {
  afterEach(() => {
    vi.resetModules()
    vi.restoreAllMocks()
  })

  test('test_users_fixture_bad_row_does_not_crash_import', async () => {
    vi.doMock('./users.json', () => ({
      default: [
        validRow,
        { ...validRow, id: 'bad-2', status: 'not-a-real-status' },
      ],
    }))

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    const { users } = await import('./users')

    expect(users).toHaveLength(1)
    expect(users[0]?.id).toBe(validRow.id)
    expect(warnSpy).toHaveBeenCalled()

    warnSpy.mockRestore()
  })
})
