/**
 * Wave 6 — Header tests (S6-20)
 *
 * Test cases:
 *  - S6-20: Header scroll listener is attached to the actual scrollable container,
 *    NOT to `document` (which is not the scrolling element in a sidebar layout).
 *
 * FAILING until the engineer:
 *  - Attaches the scroll listener to the container element via a ref, or
 *  - Removes the scroll effect entirely (no `fixed` prop → shadow logic is dead code)
 *
 * The current bug: `document.addEventListener('scroll', ...)` is used, but in a
 * sidebar/inset layout the document body does not scroll — the scroll container
 * is a specific inner div. The shadow never appears when `fixed` is set.
 */
import { render, screen } from '@testing-library/react'
import { afterEach, beforeAll, describe, expect, test, vi } from 'vitest'
import { SidebarProvider } from '@/components/ui/sidebar'
import { Header } from './header'

// jsdom does not implement window.matchMedia; SidebarProvider uses useMobile which calls it.
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

// Wrap in SidebarProvider since Header renders SidebarTrigger
function renderHeader(props: Parameters<typeof Header>[0] = {}) {
  return render(
    <SidebarProvider>
      <Header {...props} />
    </SidebarProvider>
  )
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('Header scroll behaviour (S6-20)', () => {
  test('test_header_scroll_uses_container_not_document', () => {
    // The header must attach its scroll listener to a container element ref,
    // not to `document`. We verify this by checking that `document.addEventListener`
    // is NOT called with 'scroll' when the Header mounts.
    //
    // RED: current implementation calls document.addEventListener('scroll', ...).

    const documentAddEventSpy = vi.spyOn(document, 'addEventListener')

    renderHeader({ fixed: true })

    const scrollListeners = documentAddEventSpy.mock.calls.filter(
      ([event]) => event === 'scroll'
    )

    // The fix: either use a ref-based container listener (scrollListeners.length === 0)
    // or document is acceptable if it can be shown to scroll in the real layout.
    // Per S6-20: the fix is to attach to the actual container element.
    // RED assertion: document scroll listener should NOT be used.
    expect(scrollListeners).toHaveLength(0)
  })

  test('test_header_without_fixed_renders_no_shadow', () => {
    // Non-fixed header should not apply shadow regardless of scroll.
    renderHeader({ children: <span data-testid='child'>Header</span> })

    const header = screen.getByRole('banner')
    // Without `fixed`, the shadow elevation class should not be 'shadow' (just shadow-none).
    const classes = header.className.split(/\s+/)
    expect(classes).not.toContain('shadow')
    // The content is rendered.
    expect(screen.getByTestId('child').textContent).toBe('Header')
  })

  test('test_header_fixed_mounts_and_renders_children', () => {
    renderHeader({
      fixed: true,
      children: <span data-testid='nav-content'>Navigation</span>,
    })

    const header = screen.getByRole('banner')
    expect(header).toBeDefined()
    expect(screen.getByTestId('nav-content').textContent).toBe('Navigation')
  })
})
