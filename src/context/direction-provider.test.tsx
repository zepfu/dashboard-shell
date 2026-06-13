/**
 * Wave 6 — DirectionProvider tests (S6-27)
 *
 * Test cases:
 *  - S6-27: Cookie validation against Direction union — reject invalid cookie values
 *
 * FAILING until the engineer:
 *  - Validates the cookie value against the Direction union {'ltr'|'rtl'} before
 *    using it as state. Currently: getCookie() returns any string, and it's
 *    cast directly to Direction without a validity check.
 *    An attacker who can set document.cookie can inject arbitrary values.
 */
import { render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { DirectionProvider, useDirection } from './direction-provider'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function DirectionDisplay(): React.JSX.Element {
  const { dir } = useDirection()
  return <span data-testid='dir-value'>{dir}</span>
}

const DIRECTION_COOKIE = 'dir'

function setCookie(name: string, value: string): void {
  document.cookie = `${name}=${value}`
}

function clearCookie(name: string): void {
  document.cookie = `${name}=; max-age=0`
}

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------

beforeEach(() => {
  clearCookie(DIRECTION_COOKIE)
})

afterEach(() => {
  clearCookie(DIRECTION_COOKIE)
  document.documentElement.removeAttribute('dir')
})

// ---------------------------------------------------------------------------
// S6-27: Invalid cookie rejection
// ---------------------------------------------------------------------------

describe('DirectionProvider — invalid cookie rejection (S6-27)', () => {
  test('test_direction_provider_rejects_invalid_cookie_value', () => {
    // Arrange: inject an invalid direction value via cookie
    setCookie(DIRECTION_COOKIE, 'sideways')

    render(
      <DirectionProvider>
        <DirectionDisplay />
      </DirectionProvider>
    )

    // The provider MUST default to 'ltr' when the cookie contains an invalid value.
    // RED: current implementation does `getCookie(name) as Direction` which
    // allows any string through.
    const displayed = screen.getByTestId('dir-value').textContent
    expect(displayed).toBe('ltr')
  })

  test('test_direction_provider_rejects_empty_cookie_defaults_to_ltr', () => {
    // Empty string is not a valid Direction
    setCookie(DIRECTION_COOKIE, '')

    render(
      <DirectionProvider>
        <DirectionDisplay />
      </DirectionProvider>
    )

    expect(screen.getByTestId('dir-value').textContent).toBe('ltr')
  })

  test('test_direction_provider_accepts_valid_ltr_cookie', () => {
    setCookie(DIRECTION_COOKIE, 'ltr')

    render(
      <DirectionProvider>
        <DirectionDisplay />
      </DirectionProvider>
    )

    expect(screen.getByTestId('dir-value').textContent).toBe('ltr')
  })

  test('test_direction_provider_accepts_valid_rtl_cookie', () => {
    setCookie(DIRECTION_COOKIE, 'rtl')

    render(
      <DirectionProvider>
        <DirectionDisplay />
      </DirectionProvider>
    )

    expect(screen.getByTestId('dir-value').textContent).toBe('rtl')
  })

  test('test_direction_provider_rejects_xss_cookie_value', () => {
    // XSS-style injection in cookie — must be rejected
    setCookie(DIRECTION_COOKIE, '<script>alert(1)</script>')

    render(
      <DirectionProvider>
        <DirectionDisplay />
      </DirectionProvider>
    )

    const displayed = screen.getByTestId('dir-value').textContent
    // Must not pass through the injected value
    expect(displayed).not.toContain('<script>')
    expect(displayed).toBe('ltr')
  })

  test('test_direction_provider_sets_html_dir_attribute_to_valid_value_only', () => {
    // Even if HTML dir attribute is set, it must only be 'ltr' or 'rtl'.
    setCookie(DIRECTION_COOKIE, 'invalid-dir')

    render(
      <DirectionProvider>
        <DirectionDisplay />
      </DirectionProvider>
    )

    const htmlDir = document.documentElement.getAttribute('dir')
    // The dir attribute should be 'ltr' (the fallback), not the invalid cookie value.
    expect(htmlDir).toBe('ltr')
    expect(htmlDir).not.toBe('invalid-dir')
  })
})
