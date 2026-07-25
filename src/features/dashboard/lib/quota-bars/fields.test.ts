/**
 * D1-450 Wave 1 — quota-bars/fields behavioral contract (G3, I1, E1, E2).
 */
import { describe, expect, test } from 'vitest'
import type { UsageReportQuotaRow } from '../../api/usage-report'
import {
  buildQuotaSegments,
  formatQuotaAccountSuffix,
  formatTimeAgo,
  makeQuotaBarGroup,
  matchesKimiCodeQuotaContract,
  normalizeQuotaAccountRef,
  quotaTypeToBarPeriodType,
  resolveQuotaAccountIdentities,
} from './fields'

describe('weekly_special classification (D1-450 I1)', () => {
  test('production quotaTypeToBarPeriodType maps weekly_special to special', () => {
    expect(quotaTypeToBarPeriodType('weekly_special')).toBe('special')
  })
})

describe('formatTimeAgo future timestamps (D1-450 G3)', () => {
  test('timestamps more than one minute in the future use "in …" not "ago"', () => {
    const thirtyMinutesAhead = new Date(Date.now() + 30 * 60_000)
    const label = formatTimeAgo(thirtyMinutesAhead)
    expect(label).toMatch(/^in \d+m$/)
    expect(label).not.toMatch(/ago$/)
  })
})

describe('buildQuotaSegments dead parameter (D1-450 E1)', () => {
  test('velocitySegments is not part of the public segment builder signature', () => {
    expect(buildQuotaSegments.length).toBe(1)
    const segments = buildQuotaSegments(75)
    expect(segments).toHaveLength(100)
    expect(segments[0]).toMatchObject({
      widthPct: 1,
      severityClass: expect.any(String),
    })
  })
})

describe('D1-492 opaque quota account references', () => {
  test('accepts current 12-hex and legacy 8-hex refs', () => {
    expect(normalizeQuotaAccountRef('119F6A46BF29')).toBe('119f6a46bf29')
    expect(normalizeQuotaAccountRef('a1B2c3D4')).toBe('a1b2c3d4')
    expect(formatQuotaAccountSuffix('119f6a46bf29')).toBe('…bf29')
    expect(formatQuotaAccountSuffix('a1b2c3d4')).toBe('…c3d4')
  })

  test('rejects full hashes, unsupported lengths, and arbitrary strings', () => {
    expect(normalizeQuotaAccountRef('a'.repeat(64))).toBeNull()
    expect(normalizeQuotaAccountRef('abc123')).toBeNull()
    expect(normalizeQuotaAccountRef('account-119f6a46bf29')).toBeNull()
    expect(normalizeQuotaAccountRef('not hex at all')).toBeNull()
    expect(formatQuotaAccountSuffix('a'.repeat(64))).toBeNull()
  })

  test('promotes an unambiguous legacy prefix to the current 12-hex ref', () => {
    const identities = resolveQuotaAccountIdentities([
      '119f6a46',
      '119f6a46bf29',
    ])
    expect(identities.map((identity) => identity.accountRef)).toEqual([
      '119f6a46bf29',
      '119f6a46bf29',
    ])
    expect(identities[0].promotedLegacyRef).toBe(true)
  })

  test('keeps ambiguous prefixes and every missing or rejected row distinct', () => {
    const fullHash = 'f'.repeat(64)
    const identities = resolveQuotaAccountIdentities([
      '119f6a46',
      '119f6a46bf29',
      '119f6a46abcd',
      null,
      undefined,
      fullHash,
      fullHash,
    ])
    expect(identities.map((identity) => identity.publicKey)).toEqual([
      'unidentified-1',
      '119f6a46bf29',
      '119f6a46abcd',
      'unidentified-4',
      'unidentified-5',
      'unidentified-6',
      'unidentified-7',
    ])
    expect(JSON.stringify(identities)).not.toContain(fullHash)
  })
})

describe('D1-492 Kimi Code quota contract', () => {
  const valid = {
    quota_key: 'kimi_code_5h:quota_units',
    quota_period: '5h',
    source: 'kimi_code_usage',
    quota_unit: 'quota_units',
    client: 'kimi-code',
  }

  test('infers quota_units identity from a quota key fallback', () => {
    const row = {
      provider: 'kimi_code',
      model: null,
      account_ref: '119f6a46bf29',
      billing_details: {
        short: {
          quota_key: 'kimi_code_5h:quota_units',
          source: 'kimi_code_usage',
          client: 'kimi-code',
        },
      },
      short_remaining_pct: 75,
      short_reset_at: null,
      short_interval_start: null,
      short_interval_end: null,
      short_active: true,
      short_usage_tokens: 0,
      short_usage_breakdown: [],
    } as UsageReportQuotaRow

    const bar = makeQuotaBarGroup('5-hour Quota Units', row, 'short')

    expect(bar?.tipIdentity).toContain('quota_units')
    expect(bar?.tipIdentity).not.toContain('credits')
  })

  test('requires the exact Kimi Code fields including client', () => {
    expect(
      matchesKimiCodeQuotaContract(valid, 'kimi_code_5h:quota_units', '5h')
    ).toBe(true)
    expect(
      matchesKimiCodeQuotaContract(
        { ...valid, client: null },
        'kimi_code_5h:quota_units',
        '5h'
      )
    ).toBe(false)
    expect(
      matchesKimiCodeQuotaContract(
        { ...valid, client: undefined },
        'kimi_code_5h:quota_units',
        '5h'
      )
    ).toBe(false)
  })

  test.each([
    { source: 'alibaba_token_plan_usage' },
    { quota_unit: 'credits' },
    { quota_period: '7d' },
    { client: 'qwen-cloud-console' },
    { quota_key: 'alibaba_token_plan_5h:credits' },
  ])(
    'rejects contract mismatch $source$quota_unit$quota_period$client$quota_key',
    (override) => {
      expect(
        matchesKimiCodeQuotaContract(
          { ...valid, ...override },
          'kimi_code_5h:quota_units',
          '5h'
        )
      ).toBe(false)
    }
  )
})
