/**
 * S6-T5 — Token layer: Phosphor Atlas CSS token assertions for `src/styles/theme.css`.
 *
 * Wave 10 cleanup: stale "red-phase" scaffolding removed; tests are permanent
 * regression guards. CSS-text-grep tests strengthened to document tripwire
 * semantics and assert vars are DEFINED (not just referenced).
 *
 * Strategy: jsdom does not execute `@import` or Tailwind's `@theme inline`
 * block at runtime, so we read token values from the raw `theme.css` source
 * (`:root` and `@theme inline` declarations).
 *
 * TRIPWIRE note: source-text parsing verifies the token is DEFINED IN SOURCE,
 * not that it's correctly applied in a live browser.
 *
 * Test coverage:
 *   1. --background is non-empty and NOT the old oklch light value (defined + migrated)
 *   2. --radius is 0px / 0rem / 0 (Phosphor uses no border-radius)
 *   3. --card-3 is defined and distinct from --card-2 (skeleton shimmer guard)
 *   4. --font-mono contains 'IBM Plex Mono' (monospace typeface token)
 *   5. Key Phosphor tokens are defined (existence guard)
 */
import fs from 'node:fs'
import path from 'node:path'

const indexCssPath = path.resolve('src/styles/index.css')
let rawCss = ''
let indexCss = ''

beforeAll(() => {
  rawCss = fs.readFileSync(path.resolve('src/styles/theme.css'), 'utf8')
  indexCss = fs.readFileSync(indexCssPath, 'utf8')
})

/**
 * Read a CSS custom property from raw theme.css source (`:root` first, then file-wide).
 *
 * TRIPWIRE: verifies the token is DEFINED IN SOURCE, not runtime cascade.
 */
function getCssVar(name: string): string {
  const rootBlockMatch = rawCss.match(/:root\s*\{([^}]*)\}/s)
  if (rootBlockMatch) {
    const propMatch = rootBlockMatch[1].match(
      new RegExp(`${name.replace(/[-]/g, '\\-')}\\s*:\\s*([^;]+);`)
    )
    if (propMatch) return propMatch[1].trim()
  }

  const themeBlockMatch = rawCss.match(/@theme inline\s*\{([^}]*)\}/s)
  if (themeBlockMatch) {
    const propMatch = themeBlockMatch[1].match(
      new RegExp(`${name.replace(/[-]/g, '\\-')}\\s*:\\s*([^;]+);`)
    )
    if (propMatch) return propMatch[1].trim()
  }

  const globalMatch = rawCss.match(
    new RegExp(`${name.replace(/[-]/g, '\\-')}\\s*:\\s*([^;]+);`)
  )
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
  const bg = getCssVar('--background')

  expect(bg).not.toBe('')
  expect(bg).not.toBe('oklch(1 0 0)')
  expect(bg).not.toMatch(/^oklch\(/)
})

test('test_phosphor_border_radius_zero', () => {
  const radius = getCssVar('--radius')

  expect(['0px', '0rem', '0']).toContain(radius)
})

test('test_card3_token_defined_and_distinct_from_card2', () => {
  const card2 = getCssVar('--card-2')
  const card3 = getCssVar('--card-3')

  assertVarDefined('--card-3')
  expect(card3).not.toBe('')
  expect(card3).not.toBe(card2)
})

test('test_ibm_plex_mono_in_font_family', () => {
  assertVarDefined('--font-mono')

  const fontMono = getCssVar('--font-mono')
  expect(fontMono).toContain('IBM Plex Mono')
})

test('test_phosphor_key_tokens_all_defined', () => {
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
    const isDefined =
      rawCss.includes(`${token}:`) || rawCss.includes(`${token} :`)
    expect(isDefined, token).toBe(true)
  }
})

test('test_font_generic_families_not_quoted', () => {
  const fontInterLine = rawCss.match(/--font-inter:\s*[^;]+;/)?.[0] ?? ''
  const fontManropeLine = rawCss.match(/--font-manrope:\s*[^;]+;/)?.[0] ?? ''

  expect(fontInterLine, '--font-inter declaration').not.toMatch(/'sans-serif'/)
  expect(fontManropeLine, '--font-manrope declaration').not.toMatch(
    /'sans-serif'/
  )
})

test('test_no_vestigial_dark_block_machinery', () => {
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
  const selfSource = fs.readFileSync(
    path.resolve('src/styles/token-layer.test.ts'),
    'utf8'
  )

  expect(selfSource).not.toMatch(
    /expect\(\{\s*token,\s*isDefined\s*\}\)\.toMatchObject/
  )
})

test('test_no_faux_bold_mono_weight', () => {
  const fauxBoldRules = monoContextRulesWithFauxBold700(indexCss)
  expect(
    fauxBoldRules,
    `mono contexts must not use font-weight: 700 (faux-bold without loaded Plex Mono): ${fauxBoldRules.join('; ')}`
  ).toHaveLength(0)
})
