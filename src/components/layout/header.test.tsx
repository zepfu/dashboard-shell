/**
 * Wave 6 — Header tests (S6-20)
 *
 * D1-451 Wave 5 (E1): Scroll listener was removed from Header — do not spy on
 * deleted `document.addEventListener('scroll')` behaviour. Keep render contracts.
 */
import { render, screen } from '@testing-library/react'
import { beforeAll, describe, expect, test } from 'vitest'
import { SidebarProvider } from '@/components/ui/sidebar'
import { Header } from './header'

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

function renderHeader(props: Parameters<typeof Header>[0] = {}) {
  return render(
    <SidebarProvider>
      <Header {...props} />
    </SidebarProvider>
  )
}

describe('Header (S6-20 / D1-451 E1)', () => {
  test('test_header_without_fixed_renders_no_shadow', () => {
    renderHeader({ children: <span data-testid='child'>Header</span> })

    const header = screen.getByRole('banner')
    const classes = header.className.split(/\s+/)
    expect(classes).not.toContain('shadow')
    expect(screen.getByTestId('child').textContent).toBe('Header')
  })

  test('test_header_fixed_mounts_and_renders_children', () => {
    renderHeader({
      fixed: true,
      children: <span data-testid='nav-content'>Navigation</span>,
    })

    expect(screen.getByRole('banner')).toBeDefined()
    expect(screen.getByTestId('nav-content').textContent).toBe('Navigation')
  })
})
