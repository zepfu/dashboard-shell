/**
 * D1-451 Wave 4 — quota-history-display (C1, C8 info, A4).
 * RED: fill scale vs legend; formatCompactQuantity shared home.
 */
import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, test } from 'vitest'
import { ivClassForConsumed } from './quota-bars/fields'
import {
  formatCompactQuantity,
  quotaHistoryConsumedPct,
  quotaHistoryFillColor,
} from './quota-history-display'

const css = fs.readFileSync(path.resolve('src/styles/index.css'), 'utf8')

function readRule(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const match = css.match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`, 's'))
  return match?.[1] ?? ''
}

function readBackgroundHex(ruleBody: string): string | null {
  const hex = ruleBody.match(/background:\s*(#[0-9a-fA-F]{6})\s*;/)
  return hex ? hex[1].toLowerCase() : null
}

function ivHexForConsumed(consumedPct: number): string {
  const cls = ivClassForConsumed(consumedPct)
  return readBackgroundHex(readRule(`.quota-interval.${cls}`)) ?? ''
}

describe('D1-451 C1 — quotaHistoryFillColor aligns with iv-* / legend scale', () => {
  test('test_quota_history_fill_60pct_matches_iv_50_plus_not_warm_amber', () => {
    const consumed = 60
    const fill = quotaHistoryFillColor(consumed)
    const ivHex = ivHexForConsumed(consumed)
    const warmAccent = 'var(--accent-warm)'
    const hotAccent = 'var(--accent-hot)'

    expect(quotaHistoryConsumedPct({ min_remaining_pct: 40 } as never)).toBe(60)
    expect(fill).not.toBe(warmAccent)
    expect(fill).toBe(hotAccent)
    expect(ivHex).toBe('#cc3838')
  })

  test.each([
    [4, 'iv-0-5'],
    [7, 'iv-5-10'],
    [15, 'iv-10-25'],
    [30, 'iv-25-50'],
    [55, 'iv-50-p'],
  ] as const)(
    'test_quota_history_fill_tier_%s_uses_same_hex_as_iv_%s',
    (consumed, ivClass) => {
      const fill = quotaHistoryFillColor(consumed)
      const barHex = readBackgroundHex(readRule(`.quota-interval.${ivClass}`))
      expect(barHex).not.toBeNull()
      expect(fill).toMatch(/^#[0-9a-f]{6}$/i)
      expect(fill.toLowerCase()).toBe(barHex)
    }
  )
})

describe('D1-451 A4 — formatCompactQuantity shared module home', () => {
  test('test_format_compact_quantity_re_exported_from_status_formatters', async () => {
    const mod = await import('./status-formatters')
    expect(mod.formatCompactQuantity(12_500)).toBe(
      formatCompactQuantity(12_500)
    )
    expect(mod.formatCompactQuantity).toBe(formatCompactQuantity)
  })

  test('test_format_compact_quantity_pins_en_us_compact', () => {
    expect(formatCompactQuantity(999)).toBe('999')
    expect(formatCompactQuantity(1_200)).toBe('1.2K')
  })
})

describe('D1-451 C8 (info) — merge semantics documented in source', () => {
  test('test_aggregate_quota_usage_breakdown_documents_max_merge', () => {
    const source = fs.readFileSync(
      path.resolve('src/features/dashboard/lib/quota-history-display.ts'),
      'utf8'
    )
    expect(source).toMatch(
      /aggregateQuotaUsageBreakdown|Math\.max.*tokens|cumulative|snapshot/i
    )
  })
})
