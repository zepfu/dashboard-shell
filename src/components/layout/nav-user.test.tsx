/**
 * D1-451 Wave 5 (A4): `userInitials` must be hoisted to a shared helper used by
 * NavUser and ProfileDropdown (no duplicate local implementations).
 */
import { render, screen } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, test } from 'vitest'
import { SidebarProvider } from '@/components/ui/sidebar'
import { NavUser } from './nav-user'

beforeAll(() => {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    configurable: true,
    value: (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => undefined,
      removeListener: () => undefined,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      dispatchEvent: () => false,
    }),
  })
})

describe('NavUser avatar initials (A4)', () => {
  test('test_nav_user_renders_initials_from_shared_helper', () => {
    render(
      <SidebarProvider>
        <NavUser user={{ name: 'Ada Lovelace', email: 'ada@example.com' }} />
      </SidebarProvider>
    )

    expect(screen.getAllByText('AL').length).toBeGreaterThan(0)
  })

  test('test_nav_user_fallback_initials_ds_for_empty_name', () => {
    render(
      <SidebarProvider>
        <NavUser user={{ name: '   ', email: 'local' }} />
      </SidebarProvider>
    )

    expect(screen.getAllByText('DS').length).toBeGreaterThan(0)
  })
})

describe('D1-451 A4 — shared userInitials module', () => {
  test('test_user_initials_exported_from_shared_module', async () => {
    const shared = await import('@/lib/user-initials').catch(() => null)
    expect(shared).not.toBeNull()
    expect(typeof shared!.userInitials).toBe('function')
    expect(shared!.userInitials('Dashboard Shell')).toBe('DS')
  })

  test('test_nav_user_does_not_define_local_user_initials', () => {
    const text = readFileSync(
      resolve(process.cwd(), 'src/components/layout/nav-user.tsx'),
      'utf8'
    )
    expect(text).not.toMatch(/function userInitials\s*\(/)
    expect(text).toMatch(/user-initials|from ['"]@\/lib\/user-initials['"]/)
  })
})
