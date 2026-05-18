/**
 * Wave 1 — ThemeProvider red-phase tests.
 *
 * These tests assert the simplified Phosphor Atlas dark-only behaviour that the
 * Wave 1 implementation must deliver.  Every test is expected to FAIL against
 * the current implementation, which still retains full light/dark/system logic.
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
 * jsdom does not implement window.matchMedia.  The current ThemeProvider calls
 * it inside a useEffect (to listen for system-theme changes).  We stub it here
 * so the component can mount and reach the assertions; the stub unconditionally
 * reports "not dark" (matches === false) so any system-theme resolution falls
 * back to 'light' — which makes the "always dark" assertions fail against the
 * current implementation for the right reason.
 *
 * Note: the Wave 1 implementation removes the matchMedia call entirely, so
 * this stub becomes a harmless no-op after the feature lands.
 */
const matchMediaStub = (query: string): MediaQueryList => ({
  matches: false, // system theme is NOT dark → current impl resolves 'light'
  media: query,
  onchange: null,
  addListener: () => undefined,
  removeListener: () => undefined,
  addEventListener: () => undefined,
  removeEventListener: () => undefined,
  dispatchEvent: () => false,
})

beforeEach(() => {
  // Install the matchMedia stub before each test.
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    configurable: true,
    value: matchMediaStub,
  })

  // Force a non-dark stored cookie so the current provider resolves to 'light',
  // making the "always dark" / "dark class" assertions cleanly fail.
  document.cookie = `${THEME_COOKIE}=light; path=/; max-age=3600`
  // Start without the dark class so test 3 cannot pass trivially.
  document.documentElement.classList.remove('dark', 'light')
})

afterEach(() => {
  // Clean up the cookie and class after every test.
  document.cookie = `${THEME_COOKIE}=; path=/; max-age=0`
  document.documentElement.classList.remove('dark', 'light')
})

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test('test_theme_provider_always_resolves_dark', () => {
  /**
   * Phosphor Atlas is dark-only.  The simplified ThemeProvider must always
   * return resolvedTheme === 'dark'.
   *
   * RED: the current provider reads the 'light' cookie and resolves to 'light'.
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
   *
   * RED: the current provider mutates state in setTheme, so resolvedTheme
   * becomes 'light' after the call.
   */
  render(
    <ThemeProvider>
      <ThemeToggle />
    </ThemeProvider>
  )

  // Precondition: starts dark
  expect(screen.getByTestId('resolved-theme').textContent).toBe('dark')

  // Attempt to switch to light
  await act(async () => {
    screen.getByTestId('set-light').click()
  })

  // Must remain dark
  expect(screen.getByTestId('resolved-theme').textContent).toBe('dark')
})

test('test_dark_class_applied_to_html_root', () => {
  /**
   * The dark class must be unconditionally present on document.documentElement
   * after the ThemeProvider mounts — even when the stored cookie says 'light'.
   *
   * RED: the current provider applies whatever theme it resolves from the cookie,
   * so with a 'light' cookie it adds the 'light' class but NOT 'dark'.
   */
  render(
    <ThemeProvider>
      <ThemeDisplay />
    </ThemeProvider>
  )

  expect(document.documentElement.classList.contains('dark')).toBe(true)
})
