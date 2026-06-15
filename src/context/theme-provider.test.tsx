/**
 * ThemeProvider — Phosphor Atlas dark-only behaviour.
 *
 * Wave 1 implementation delivered a simplified dark-only ThemeProvider.
 * These tests are permanent regression guards; stale "red-phase" scaffolding
 * has been removed (S6-T3, Wave 10 cleanup).
 *
 * Test coverage:
 *   1. resolvedTheme is always 'dark' regardless of stored cookie
 *   2. setTheme('light') is a no-op — resolvedTheme remains 'dark'
 *   3. The 'dark' class is always applied to document.documentElement on mount
 */
import { act, render, screen } from '@testing-library/react'
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
