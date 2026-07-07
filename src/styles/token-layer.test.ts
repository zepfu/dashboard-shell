/**
 * S6-T5 — Token layer: Phosphor Atlas CSS token assertions for `src/styles/theme.css`.
 *
 * Wave 10 cleanup: stale "red-phase" scaffolding removed; tests are permanent
 * regression guards. CSS-text-grep tests strengthened to document tripwire
 * semantics and assert vars are DEFINED (not just referenced).
 *
 * Strategy: jsdom does not execute `@import` or Tailwind's `@theme inline`
 * block at runtime, so we take a two-pronged approach:
 *   a) Inject the raw CSS into the document and query getComputedStyle — this
 *      works for plain custom-property declarations on `:root` / `.dark`.
 *   b) Fall back to regex matching against the raw CSS file text when jsdom
 *      cannot surface the computed value (known jsdom limitation for at-rules).
 *
 * TRIPWIRE note: tests that fall back to raw-text grep are tripwires — they
 * verify the token is DEFINED IN SOURCE, not that it's correctly applied in
 * a live browser. Any consumer that references the var and relies on it being
 * applied at runtime should also have a visual regression test.
 *
 * Test coverage:
 *   1. --background is non-empty and NOT the old oklch light value (defined + migrated)
 *   2. --radius is 0px / 0rem / 0 (Phosphor uses no border-radius)
 *   3. --card-3 is defined and distinct from --card-2 (skeleton shimmer guard)
 *   4. --font-mono contains 'IBM Plex Mono' (monospace typeface token)
 *   5. Key Phosphor tokens are defined in the dark context (existence guard)
 */
import fs from 'node:fs'
import path from 'node:path'

// ---------------------------------------------------------------------------
// Module-scoped CSS injection
// ---------------------------------------------------------------------------

let injectedStyleEl: HTMLStyleElement | null = null
let rawCss = ''
const indexCssPath = path.resolve('src/styles/index.css')
let indexCss = ''

beforeAll(() => {
  rawCss = fs.readFileSync(path.resolve('src/styles/theme.css'), 'utf8')
  indexCss = fs.readFileSync(indexCssPath, 'utf8')

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
 *
 * TRIPWIRE: the raw-text fallback verifies the token is DEFINED IN SOURCE.
 * It does NOT verify runtime application. Tests that rely solely on this
 * fallback are tripwires: they catch deletion but not mis-application.
 */
function getCssVar(name: string): string {
  const computed = getComputedStyle(document.documentElement)
    .getPropertyValue(name)
    .trim()

  if (computed !== '') {
    return computed
  }

  // jsdom could not surface the value — parse raw CSS.
  // Prefer the value from the .dark { } block (Phosphor is dark-only).
  const darkBlockMatch = rawCss.match(/\.dark\s*\{([^}]*)\}/s)
  if (darkBlockMatch) {
    const propMatch = darkBlockMatch[1].match(
      new RegExp(`${name.replace(/--/g, '--')}\\s*:\\s*([^;]+);`)
    )
    if (propMatch) return propMatch[1].trim()
  }

  // Fall back to any occurrence in the file.
  const globalMatch = rawCss.match(new RegExp(`${name}\\s*:\\s*([^;]+);`))
  return globalMatch ? globalMatch[1].trim() : ''
}

/**
 * Assert that a CSS custom property name is defined ANYWHERE in the raw CSS.
 * This is a tripwire: it verifies definition, not correct application.
 */
function assertVarDefined(name: string): void {
  const defined = rawCss.includes(`${name}:`) || rawCss.includes(`${name} :`)
  expect(defined).toBe(true)
}

/** Rule bodies where `font-family` references monospace token and weight is 700. */
function monoContextRulesWithFauxBold700(css: string): string[] {
  const ruleRegex = /([^{}]+)\{([^}]*)\}/gs
  const hits: string[] = []
  let match: RegExpExecArray | null
  while ((match = ruleRegex.exec(css)) !== null) {
    const selector = match[1].trim()
    const body = match[2]
    const isMonoContext =
      /font-family:\s*var\(--font-mono\)/.test(body) ||
      /IBM Plex Mono/.test(body) ||
      /--font-mono/.test(selector)
    if (!isMonoContext) continue
    if (/font-weight:\s*700\b/.test(body)) {
      hits.push(`${selector} { … font-weight: 700 … }`)
    }
  }
  return hits
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test('test_phosphor_bg_token_defined', () => {
  /**
   * --background must be:
   *   • non-empty (the token exists)
   *   • NOT 'oklch(1 0 0)' (the old shadcn light-mode value)
   *   • NOT any oklch() value (Phosphor replaces the oklch palette with hex/hsl)
   *
   * TRIPWIRE: raw-text fallback; verifies definition + migration from oklch.
   */
  const bg = getCssVar('--background')

  expect(bg).not.toBe('')
  expect(bg).not.toBe('oklch(1 0 0)')
  expect(bg).not.toMatch(/^oklch\(/)
})

test('test_phosphor_border_radius_zero', () => {
  /**
   * Phosphor Atlas uses sharp corners throughout — --radius must be 0.
   *
   * TRIPWIRE: raw-text fallback; verifies definition + zero value.
   */
  const radius = getCssVar('--radius')

  expect(['0px', '0rem', '0']).toContain(radius)
})

test('test_card3_token_defined_and_distinct_from_card2', () => {
  /**
   * --card-3 must be defined and must differ from --card-2.
   *
   * Wave 37 SF-3: the skeleton-block shimmer gradient references var(--card-3).
   * When undefined, it resolves to the CSS initial value (empty/transparent),
   * making the shimmer look broken.
   *
   * TRIPWIRE: verifies --card-3 is defined in source AND has a distinct value
   * from --card-2. Does NOT verify the gradient renders correctly in a browser.
   */
  const card2 = getCssVar('--card-2')
  const card3 = getCssVar('--card-3')

  // --card-3 must be defined in the CSS source
  assertVarDefined('--card-3')
  expect(card3).not.toBe('')
  // --card-3 must be distinct from --card-2 (not a duplicate)
  expect(card3).not.toBe(card2)
})

test('test_ibm_plex_mono_in_font_family', () => {
  /**
   * Phosphor Atlas specifies IBM Plex Mono as the monospace typeface.
   * The --font-mono custom property must contain 'IBM Plex Mono'.
   *
   * TRIPWIRE: verifies the font token is DEFINED in source. Does NOT verify
   * that it is applied to any element's font-family property at runtime.
   * To strengthen this beyond a tripwire, add a test that checks
   * `getComputedStyle(someMonoElement).fontFamily` in a full browser context.
   */
  // --font-mono must be defined somewhere in the CSS
  assertVarDefined('--font-mono')

  const fontMono = getCssVar('--font-mono')
  expect(fontMono).toContain('IBM Plex Mono')
})

test('test_phosphor_key_tokens_all_defined', () => {
  /**
   * Guard that key Phosphor Atlas tokens are ALL present in the CSS source.
   * These are the tokens most likely to be accidentally removed during
   * refactoring. Each is a tripwire — definition only, not application.
   */
  const requiredTokens = [
    '--background',
    '--foreground',
    '--card',
    '--card-2',
    '--card-3',
    '--border',
    '--accent-chrome',
    '--accent-teal',
    '--accent-hot',
    '--radius',
  ]

  for (const token of requiredTokens) {
    // Must appear in the CSS file as a property definition
    const isDefined =
      rawCss.includes(`${token}:`) || rawCss.includes(`${token} :`)
    // Assert with a descriptive message pattern (vitest shows the expect call)
    expect({ token, isDefined }).toMatchObject({ token, isDefined: true })
  }
})

test('test_font_generic_families_not_quoted', () => {
  /**
   * I-5: CSS generic families (sans-serif) must not be quoted in @theme font
   * stacks — e.g. `--font-inter: 'Inter', sans-serif` not `'sans-serif'`.
   */
  const fontInterLine = rawCss.match(/--font-inter:\s*[^;]+;/)?.[0] ?? ''
  const fontManropeLine = rawCss.match(/--font-manrope:\s*[^;]+;/)?.[0] ?? ''

  expect(fontInterLine, '--font-inter declaration').not.toMatch(/'sans-serif'/)
  expect(fontManropeLine, '--font-manrope declaration').not.toMatch(
    /'sans-serif'/
  )
})

test('test_no_vestigial_dark_block_machinery', () => {
  /**
   * C-6: token-layer tests must not fake cascade via injected `.dark` or
   * `.dark { }` parsing inside getCssVar — read plain source tokens only.
   */
  const selfSource = fs.readFileSync(
    path.resolve('src/styles/token-layer.test.ts'),
    'utf8'
  )

  expect(selfSource).not.toMatch(
    /document\.documentElement\.classList\.add\(['"]dark['"]\)/
  )
  expect(selfSource).not.toMatch(/\.dark\s*\\\{/)
  expect(selfSource).not.toMatch(/Prefer the value from the \.dark/)
})

test('test_labeled_assertions_use_message_arg', () => {
  /**
   * E-1: token presence loop must use labeled expect(isDefined, token).toBe(true)
   * instead of roundabout toMatchObject on { token, isDefined }.
   */
  const selfSource = fs.readFileSync(
    path.resolve('src/styles/token-layer.test.ts'),
    'utf8'
  )

  expect(selfSource).not.toMatch(
    /expect\(\{\s*token,\s*isDefined\s*\}\)\.toMatchObject/
  )
})

test('test_no_faux_bold_mono_weight', () => {
  /**
   * I-6 / SD-3: IBM Plex Mono webfont is not loaded from index.html (system
   * monospace fallback), so font-weight: 700 in mono contexts is faux-bold.
   * Emphasis in mono UI must standardize on 600 — assert zero 700 rules in
   * mono-context selectors in index.css (CSS rule text tripwire).
   */
  const fauxBoldRules = monoContextRulesWithFauxBold700(indexCss)
  expect(
    fauxBoldRules,
    `mono contexts must not use font-weight: 700 (faux-bold without loaded Plex Mono): ${fauxBoldRules.join('; ')}`
  ).toHaveLength(0)
})
