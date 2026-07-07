/**
 * ThemeProvider — Phosphor Atlas dark-only behaviour.
 *
 * D1-451 Wave 5 additions (P3, G3, I2):
 *   - P3: context value must be referentially stable across benign parent re-renders.
 *   - G3: ThemeProvider must not spread unknown props onto ThemeContext (narrow surface).
 *   - I2: vestigial light-theme API removed or explicitly documented on the type.
 */
import { useEffect, useRef } from 'react'
import { act, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { ThemeProvider, useTheme } from './theme-provider'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const THEME_COOKIE = 'vite-ui-theme'

/** Tiny consumer component that exposes resolved theme via a data-testid. */
function ThemeDisplay(): React.JSX.Element {
  const { resolvedTheme } = useTheme()
  return <span data-testid='resolved-theme'>{resolvedTheme}</span>
}

/** Consumer that also exposes a button to call setTheme. */
function ThemeToggle(): React.JSX.Element {
  const { resolvedTheme, setTheme } = useTheme()
  return (
    <>
      <span data-testid='resolved-theme'>{resolvedTheme}</span>
      <button
        type='button'
        data-testid='set-light'
        onClick={() => setTheme('light')}
      >
        set light
      </button>
    </>
  )
}

function ThemeContextIdentityProbe({
  onCapture,
}: {
  onCapture: (first: unknown, second: unknown) => void
}): React.JSX.Element {
  const first = useRef<ReturnType<typeof useTheme> | null>(null)
  const ctx = useTheme()
  useEffect(() => {
    if (first.current === null) {
      first.current = ctx
      return
    }
    if (first.current !== ctx) {
      onCapture(first.current, ctx)
    }
  })
  return <span data-testid='probe'>ok</span>
}

// ---------------------------------------------------------------------------
// Setup / teardown — ensure no stale cookie bleeds between tests
// ---------------------------------------------------------------------------

/**
 * jsdom does not implement window.matchMedia. The simplified ThemeProvider
 * no longer calls matchMedia (Wave 1 removed it), but we keep this stub
 * as a harmless guard in case the component is ever reverted.
 */
const matchMediaStub = (query: string): MediaQueryList => ({
  matches: false,
  media: query,
  onchange: null,
  addListener: () => undefined,
  removeListener: () => undefined,
  addEventListener: () => undefined,
  removeEventListener: () => undefined,
  dispatchEvent: () => false,
})

beforeEach(() => {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    configurable: true,
    value: matchMediaStub,
  })

  // Set a non-dark cookie to verify the dark-only ThemeProvider ignores it.
  document.cookie = `${THEME_COOKIE}=light; path=/; max-age=3600`
  document.documentElement.classList.remove('dark', 'light')
})

afterEach(() => {
  document.cookie = `${THEME_COOKIE}=; path=/; max-age=0`
  document.documentElement.classList.remove('dark', 'light')
})

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test('test_theme_provider_always_resolves_dark', () => {
  /**
   * Phosphor Atlas is dark-only. The ThemeProvider must always return
   * resolvedTheme === 'dark', regardless of stored cookie value.
   */
  render(
    <ThemeProvider>
      <ThemeDisplay />
    </ThemeProvider>
  )

  expect(screen.getByTestId('resolved-theme').textContent).toBe('dark')
})

test('test_theme_provider_set_theme_is_noop', async () => {
  /**
   * In the dark-only design, setTheme must be a no-op: calling setTheme('light')
   * must NOT change resolvedTheme away from 'dark'.
   */
  render(
    <ThemeProvider>
      <ThemeToggle />
    </ThemeProvider>
  )

  expect(screen.getByTestId('resolved-theme').textContent).toBe('dark')

  await act(async () => {
    screen.getByTestId('set-light').click()
  })

  expect(screen.getByTestId('resolved-theme').textContent).toBe('dark')
})

test('test_dark_class_applied_to_html_root', () => {
  /**
   * The dark class must be unconditionally present on document.documentElement
   * after the ThemeProvider mounts — even when the stored cookie says 'light'.
   */
  render(
    <ThemeProvider>
      <ThemeDisplay />
    </ThemeProvider>
  )

  expect(document.documentElement.classList.contains('dark')).toBe(true)
})

describe('D1-451 Wave 5 — ThemeProvider internals', () => {
  test('test_theme_context_value_is_memoized_across_parent_rerender', () => {
    let unstable: { first: unknown; second: unknown } | null = null
    const { rerender } = render(
      <ThemeProvider data-testid='should-not-leak'>
        <ThemeContextIdentityProbe
          onCapture={(first, second) => {
            unstable = { first, second }
          }}
        />
      </ThemeProvider>
    )

    rerender(
      <ThemeProvider data-testid='should-not-leak'>
        <ThemeContextIdentityProbe
          onCapture={(first, second) => {
            unstable = { first, second }
          }}
        />
      </ThemeProvider>
    )

    expect(unstable).toBeNull()
  })

  test('test_theme_provider_does_not_forward_arbitrary_props_to_context', () => {
    // G3: {...props} on ThemeContext must be removed — only children wired.
    render(
      <ThemeProvider storageKey='custom-key-should-not-appear-on-context'>
        <ThemeDisplay />
      </ThemeProvider>
    )

    const leaked = document.querySelector('[storagekey]')
    expect(leaked).toBeNull()
  })

  test('test_theme_type_excludes_vestigial_light_theme_literal', () => {
    // I2: document dark-only contract — `light` must not remain on Theme union.
    type ThemeFromHook = ReturnType<typeof useTheme>['theme']
    type ThemeAllowsLight = 'light' extends ThemeFromHook ? true : false
    const allowsLight: ThemeAllowsLight = false
    expect(allowsLight).toBe(false)
  })
})
