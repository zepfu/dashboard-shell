/**
 * Wave 6 — LayoutProvider tests (S6-27)
 *
 * Test cases:
 *  - S6-27: Cookie validation against Collapsible and Variant unions —
 *    reject invalid cookie values instead of casting through.
 *
 * FAILING until the engineer:
 *  - Validates the collapsible cookie against 'offcanvas'|'icon'|'none'
 *  - Validates the variant cookie against 'inset'|'sidebar'|'floating'
 *  - Falls back to defaults when the cookie contains an unrecognised value
 */
import { render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { LayoutProvider, useLayout, type Collapsible } from './layout-provider'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function LayoutDisplay(): React.JSX.Element {
  const { collapsible, variant } = useLayout()
  return (
    <>
      <span data-testid='collapsible-value'>{collapsible}</span>
      <span data-testid='variant-value'>{variant}</span>
    </>
  )
}

const COLLAPSIBLE_COOKIE = 'layout_collapsible'
const VARIANT_COOKIE = 'layout_variant'

function setCookie(name: string, value: string): void {
  document.cookie = `${name}=${value}`
}

function clearCookie(name: string): void {
  document.cookie = `${name}=; max-age=0`
}

const VALID_COLLAPSIBLE_VALUES: Collapsible[] = ['offcanvas', 'icon', 'none']
const VALID_VARIANT_VALUES = ['inset', 'sidebar', 'floating'] as const

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------

beforeEach(() => {
  clearCookie(COLLAPSIBLE_COOKIE)
  clearCookie(VARIANT_COOKIE)
})

afterEach(() => {
  clearCookie(COLLAPSIBLE_COOKIE)
  clearCookie(VARIANT_COOKIE)
})

// ---------------------------------------------------------------------------
// S6-27: Invalid cookie rejection for collapsible
// ---------------------------------------------------------------------------

describe('LayoutProvider — invalid collapsible cookie rejection (S6-27)', () => {
  test('test_direction_layout_providers_reject_invalid_cookie_collapsible', () => {
    // Inject an invalid collapsible value
    setCookie(COLLAPSIBLE_COOKIE, 'always-visible')

    render(
      <LayoutProvider>
        <LayoutDisplay />
      </LayoutProvider>
    )

    // Must fall back to the default 'icon', not pass 'always-visible' through.
    // RED: current implementation does `saved as Collapsible` without validation.
    const displayed = screen.getByTestId('collapsible-value').textContent
    expect(VALID_COLLAPSIBLE_VALUES).toContain(displayed as Collapsible)
    expect(displayed).toBe('icon') // default
  })

  test('test_layout_provider_accepts_valid_offcanvas_collapsible_cookie', () => {
    setCookie(COLLAPSIBLE_COOKIE, 'offcanvas')

    render(
      <LayoutProvider>
        <LayoutDisplay />
      </LayoutProvider>
    )

    expect(screen.getByTestId('collapsible-value').textContent).toBe(
      'offcanvas'
    )
  })

  test('test_layout_provider_accepts_valid_none_collapsible_cookie', () => {
    setCookie(COLLAPSIBLE_COOKIE, 'none')

    render(
      <LayoutProvider>
        <LayoutDisplay />
      </LayoutProvider>
    )

    expect(screen.getByTestId('collapsible-value').textContent).toBe('none')
  })

  test('test_layout_provider_rejects_empty_collapsible_cookie', () => {
    setCookie(COLLAPSIBLE_COOKIE, '')

    render(
      <LayoutProvider>
        <LayoutDisplay />
      </LayoutProvider>
    )

    const displayed = screen.getByTestId('collapsible-value').textContent
    expect(VALID_COLLAPSIBLE_VALUES).toContain(displayed as Collapsible)
  })
})

// ---------------------------------------------------------------------------
// S6-27: Invalid cookie rejection for variant
// ---------------------------------------------------------------------------

describe('LayoutProvider — invalid variant cookie rejection (S6-27)', () => {
  test('test_layout_provider_rejects_invalid_variant_cookie', () => {
    setCookie(VARIANT_COOKIE, 'fullscreen')

    render(
      <LayoutProvider>
        <LayoutDisplay />
      </LayoutProvider>
    )

    const displayed = screen.getByTestId('variant-value').textContent
    expect(VALID_VARIANT_VALUES).toContain(
      displayed as (typeof VALID_VARIANT_VALUES)[number]
    )
    expect(displayed).toBe('inset') // default
  })

  test('test_layout_provider_accepts_valid_sidebar_variant', () => {
    setCookie(VARIANT_COOKIE, 'sidebar')

    render(
      <LayoutProvider>
        <LayoutDisplay />
      </LayoutProvider>
    )

    expect(screen.getByTestId('variant-value').textContent).toBe('sidebar')
  })

  test('test_layout_provider_accepts_valid_floating_variant', () => {
    setCookie(VARIANT_COOKIE, 'floating')

    render(
      <LayoutProvider>
        <LayoutDisplay />
      </LayoutProvider>
    )

    expect(screen.getByTestId('variant-value').textContent).toBe('floating')
  })

  test('test_layout_provider_xss_cookie_rejected', () => {
    setCookie(VARIANT_COOKIE, '"><img src=x onerror=alert(1)>')

    render(
      <LayoutProvider>
        <LayoutDisplay />
      </LayoutProvider>
    )

    const displayed = screen.getByTestId('variant-value').textContent
    expect(displayed).not.toContain('onerror')
    expect(VALID_VARIANT_VALUES).toContain(
      displayed as (typeof VALID_VARIANT_VALUES)[number]
    )
  })
})
