/**
 * Wave 1 — Token layer red-phase tests.
 *
 * These tests assert the Phosphor Atlas CSS token values that Wave 1 must
 * produce in `src/styles/theme.css`.  Every test is expected to FAIL against
 * the current file, which still uses the shadcn oklch-based light/dark split
 * with no IBM Plex Mono font reference.
 *
 * Strategy: jsdom does not execute `@import` or Tailwind's `@theme inline`
 * block at runtime, so we take a two-pronged approach:
 *   a) Inject the raw CSS into the document and query getComputedStyle — this
 *      works for plain custom-property declarations on `:root` / `.dark`.
 *   b) Fall back to regex matching against the raw CSS text when jsdom cannot
 *      surface the computed value (known jsdom limitation for some at-rules).
 *
 * Test coverage:
 *   1. --background is non-empty and NOT the old oklch light value
 *   2. --radius is 0px / 0rem / 0 (Phosphor uses no border-radius)
 *   3. --font-mono contains 'IBM Plex Mono'
 */
import fs from 'node:fs'
import path from 'node:path'

// ---------------------------------------------------------------------------
// Module-scoped CSS injection — scoped to this file only via beforeAll/afterAll
// ---------------------------------------------------------------------------

let injectedStyleEl: HTMLStyleElement | null = null
let rawCss = ''

beforeAll(() => {
  rawCss = fs.readFileSync(path.resolve('src/styles/theme.css'), 'utf8')

  injectedStyleEl = document.createElement('style')
  injectedStyleEl.textContent = rawCss
  document.head.appendChild(injectedStyleEl)

  // Ensure the dark class is present so .dark { } rules are active.
  document.documentElement.classList.add('dark')
})

afterAll(() => {
  if (injectedStyleEl) {
    document.head.removeChild(injectedStyleEl)
    injectedStyleEl = null
  }
  document.documentElement.classList.remove('dark')
})

// ---------------------------------------------------------------------------
// Helper: read a CSS custom-property value from the document or the raw text.
// ---------------------------------------------------------------------------

/**
 * Attempt to read a CSS custom property from the computed style on
 * documentElement; if jsdom returns an empty string, fall back to a regex
 * search over the raw CSS file text.
 *
 * The regex searches for the property inside a `.dark { ... }` block first,
 * then anywhere in the file, to respect cascade order.
 */
function getCssVar(name: string): string {
  const computed = getComputedStyle(document.documentElement)
    .getPropertyValue(name)
    .trim()

  if (computed !== '') {
    return computed
  }

  // jsdom could not surface the value from the injected sheet — parse raw CSS.
  // Prefer the value from the .dark { } block (Phosphor is dark-only).
  const darkBlockMatch = rawCss.match(/\.dark\s*\{([^}]*)\}/s)
  if (darkBlockMatch) {
    const propMatch = darkBlockMatch[1].match(
      new RegExp(`${name}\\s*:\\s*([^;]+);`)
    )
    if (propMatch) return propMatch[1].trim()
  }

  // Fall back to any occurrence in the file.
  const globalMatch = rawCss.match(new RegExp(`${name}\\s*:\\s*([^;]+);`))
  return globalMatch ? globalMatch[1].trim() : ''
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test('test_phosphor_bg_token_defined', () => {
  /**
   * --background must be:
   *   • non-empty (the token exists)
   *   • NOT 'oklch(1 0 0)'  (the old shadcn light-mode value)
   *
   * RED: the current theme.css sets --background to 'oklch(1 0 0)' in :root
   * and 'oklch(0.129 0.042 264.695)' in .dark.  The Phosphor implementation
   * must replace both with a single unconditional dark value.  Until then,
   * depending on which rule jsdom surfaces, the value will either be the old
   * light oklch or a different oklch — neither of which satisfies the
   * Phosphor palette assertion (non-oklch hex/hsl expected).
   */
  const bg = getCssVar('--background')

  expect(bg).not.toBe('')
  // Phosphor replaces oklch tokens with explicit hex/hsl values.
  // The old light value must be gone.
  expect(bg).not.toBe('oklch(1 0 0)')
  // Additionally, the Phosphor background must NOT be any oklch value
  // (the entire oklch-based palette is being replaced).
  expect(bg).not.toMatch(/^oklch\(/)
})

test('test_phosphor_border_radius_zero', () => {
  /**
   * Phosphor Atlas uses sharp corners throughout — --radius must be 0.
   *
   * RED: the current theme.css sets --radius to '0.625rem'.
   */
  const radius = getCssVar('--radius')

  expect(['0px', '0rem', '0']).toContain(radius)
})

test('test_card3_token_defined_and_distinct_from_card2', () => {
  /**
   * --card-3 must be defined and must differ from --card-2.
   *
   * Wave 37 SF-3: the skeleton-block shimmer gradient references var(--card-3)
   * as the midpoint highlight.  When undefined the property resolves to the
   * CSS initial value (empty / transparent), making the shimmer look broken.
   * Adding the token to theme.css fixes the gradient; this test guards against
   * future accidental removal.
   */
  const card2 = getCssVar('--card-2')
  const card3 = getCssVar('--card-3')

  expect(card3).not.toBe('')
  expect(card3).not.toBe(card2)
})

test('test_ibm_plex_mono_in_font_family', () => {
  /**
   * Phosphor Atlas specifies IBM Plex Mono as the monospace typeface.
   * The --font-mono custom property (or equivalent token) must contain
   * the string 'IBM Plex Mono'.
   *
   * RED: the current theme.css defines --font-inter and --font-manrope
   * inside an `@theme inline` block but has no --font-mono at all.
   */
  // Try the standard --font-mono token first.
  const fontMono = getCssVar('--font-mono')

  // If the token is absent in the CSS file altogether, fontMono will be ''.
  // That also satisfies the RED condition — the assertion below will fail.
  expect(fontMono).toContain('IBM Plex Mono')
})
