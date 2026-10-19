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
  makeQuotaBarGroupAlways,
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

  test('accepts the native monthly quota-units contract', () => {
    expect(
      matchesKimiCodeQuotaContract(
        {
          quota_key: 'kimi_code_monthly:quota_units',
          quota_period: 'monthly',
          source: 'kimi_code_usage',
          quota_unit: 'quota_units',
          client: 'kimi-code',
        },
        'kimi_code_monthly:quota_units',
        'monthly'
      )
    ).toBe(true)
    expect(
      matchesKimiCodeQuotaContract(
        {
          quota_key: 'kimi_code_monthly:tokens',
          quota_period: 'monthly',
          source: 'kimi_code_usage',
          quota_unit: 'tokens',
          client: 'kimi-code',
        },
        'kimi_code_monthly:tokens',
        'monthly'
      )
    ).toBe(false)
  })
})

describe('D1-502 billing period bounds on current quota bars', () => {
  function quotaRow(
    overrides: Partial<UsageReportQuotaRow> = {}
  ): UsageReportQuotaRow {
    return {
      provider: 'kimi_code',
      model: null,
      account_ref: '119f6a46bf29',
      weekly_remaining_pct: 99.87,
      weekly_reset_at: '2026-07-29T16:26:00.000Z',
      weekly_interval_start: '2026-07-22T16:26:00.000Z',
      weekly_interval_end: '2026-07-29T16:26:00.000Z',
      weekly_active: true,
      weekly_overage_included_remaining_pct: null,
      weekly_overage_included_reset_at: null,
      weekly_overage_included_interval_start: null,
      weekly_overage_included_interval_end: null,
      weekly_overage_included_active: false,
      short_remaining_pct: 99.96,
      short_reset_at: '2026-07-24T17:22:00.000Z',
      short_interval_start: '2026-07-24T12:22:00.000Z',
      short_interval_end: '2026-07-24T17:22:00.000Z',
      short_active: true,
      special_remaining_pct: null,
      special_reset_at: null,
      special_interval_start: null,
      special_interval_end: null,
      special_active: false,
      short_special_remaining_pct: null,
      short_special_reset_at: null,
      short_special_interval_start: null,
      short_special_interval_end: null,
      short_special_active: false,
      monthly_remaining_pct: null,
      monthly_reset_at: null,
      monthly_interval_start: null,
      monthly_interval_end: null,
      monthly_active: false,
      ...overrides,
    }
  }

  test('copies explicit billing bounds and leaves reset windows unchanged', () => {
    const row = quotaRow({
      billing_details: {
        short: {
          quota_unit: 'quota_units',
          quota_limit: 100,
          quota_used: 0.04,
          quota_remaining: 99.96,
          billing_observed_at: '2026-07-24T12:00:00.000Z',
          billing_period_start_at: '2026-07-01T04:00:00.000Z',
          billing_period_end_at: '2026-07-01T09:00:00.000Z',
        },
        weekly: {
          quota_unit: 'quota_units',
          quota_limit: 100,
          quota_used: 0.13,
          quota_remaining: 99.87,
          billing_observed_at: '2026-07-24T12:00:00.000Z',
          billing_period_start_at: '2026-07-01T04:00:00.000Z',
          billing_period_end_at: '2026-07-08T04:00:00.000Z',
        },
      },
    })

    const shortBar = makeQuotaBarGroup('5-hour Quota Units', row, 'short')
    const weeklyBar = makeQuotaBarGroup('7-day Quota Units', row, 'weekly')

    expect(shortBar).toMatchObject({
      resetAt: '2026-07-24T17:22:00.000Z',
      tipQuotaLimit: 100,
      tipQuotaUsed: 0.04,
      tipQuotaRemaining: 99.96,
      tipQuotaUnit: 'quota_units',
      tipObservedAt: '2026-07-24T12:00:00.000Z',
      tipBillingPeriodStartAt: '2026-07-01T04:00:00.000Z',
      tipBillingPeriodEndAt: '2026-07-01T09:00:00.000Z',
    })
    expect(shortBar?.tipBillingPeriodUnavailable).toBeUndefined()
    expect(shortBar?.tipBillingPeriodStartAt).not.toBe(row.short_interval_start)
    expect(shortBar?.tipBillingPeriodEndAt).not.toBe(row.short_reset_at)
    expect(shortBar?.tipWindow).not.toContain('2026-07-01')
    expect(weeklyBar).toMatchObject({
      resetAt: '2026-07-29T16:26:00.000Z',
      tipQuotaUnit: 'quota_units',
      tipBillingPeriodStartAt: '2026-07-01T04:00:00.000Z',
      tipBillingPeriodEndAt: '2026-07-08T04:00:00.000Z',
    })
    expect(weeklyBar?.tipBillingPeriodEndAt).not.toBe(
      shortBar?.tipBillingPeriodEndAt
    )
    expect(weeklyBar?.tipBillingPeriodEndAt).not.toBe(row.weekly_reset_at)
  })

  test('marks missing or unusable billing bounds unavailable without borrowing reset', () => {
    const row = quotaRow({
      billing_details: {
        short: {
          quota_unit: 'credits',
          quota_limit: null,
          quota_used: null,
          quota_remaining: null,
          billing_observed_at: '2026-07-24T12:00:00.000Z',
          billing_period_start_at: '2026-07-01T04:15:00.000Z',
          billing_period_end_at: null,
        },
        weekly: {
          quota_unit: 'credits',
          quota_limit: null,
          quota_used: null,
          quota_remaining: null,
          billing_observed_at: '2026-07-24T12:00:00.000Z',
          billing_period_start_at: 'not-a-date',
          billing_period_end_at: '   ',
        },
      },
    })

    const shortBar = makeQuotaBarGroup('5-hour Credits', row, 'short')
    const weeklyBar = makeQuotaBarGroup('7-day Credits', row, 'weekly')

    expect(shortBar).toMatchObject({
      tipAbsolutesUnavailable: true,
      tipQuotaUnit: 'credits',
      tipQuotaLimit: null,
      tipObservedAt: '2026-07-24T12:00:00.000Z',
      tipBillingPeriodStartAt: '2026-07-01T04:15:00.000Z',
      tipBillingPeriodUnavailable: true,
      resetAt: '2026-07-24T17:22:00.000Z',
    })
    expect(shortBar?.tipBillingPeriodEndAt).toBeUndefined()
    expect(shortBar?.tipBillingPeriodStartAt).not.toBe(row.short_reset_at)
    expect(weeklyBar).toMatchObject({
      tipAbsolutesUnavailable: true,
      tipQuotaUnit: 'credits',
      tipBillingPeriodUnavailable: true,
      resetAt: '2026-07-29T16:26:00.000Z',
    })
    expect(weeklyBar?.tipBillingPeriodStartAt).toBeUndefined()
    expect(weeklyBar?.tipBillingPeriodEndAt).toBeUndefined()
  })

  test('omits billing bounds when the quota row has no billing detail', () => {
    const bar = makeQuotaBarGroup('Short', quotaRow(), 'short')

    expect(bar?.resetAt).toBe('2026-07-24T17:22:00.000Z')
    expect(bar?.tipBillingPeriodStartAt).toBeUndefined()
    expect(bar?.tipBillingPeriodEndAt).toBeUndefined()
    expect(bar?.tipBillingPeriodUnavailable).toBeUndefined()
    expect(bar?.tipAbsolutesUnavailable).toBeUndefined()
  })

  test('inactive placeholder bars keep explicit billing bounds separate from the interval', () => {
    const row = quotaRow({
      short_active: false,
      short_remaining_pct: null,
      billing_details: {
        short: {
          quota_unit: 'count',
          quota_limit: 40,
          quota_used: 10,
          quota_remaining: 30,
          billing_observed_at: '2026-07-24T12:00:00.000Z',
          billing_period_start_at: '2026-07-01T04:00:00.000Z',
          billing_period_end_at: '9999-12-31T00:00:00.000Z',
        },
      },
    })

    expect(makeQuotaBarGroup('Count', row, 'short')).toBeNull()
    const bar = makeQuotaBarGroupAlways('Count', row, 'short')

    expect(bar).toMatchObject({
      tipQuotaLimit: 40,
      tipQuotaUsed: 10,
      tipQuotaRemaining: 30,
      tipQuotaUnit: 'count',
      tipObservedAt: '2026-07-24T12:00:00.000Z',
      tipBillingPeriodStartAt: '2026-07-01T04:00:00.000Z',
      tipBillingPeriodEndAt: '9999-12-31T00:00:00.000Z',
    })
    expect(bar.tipBillingPeriodUnavailable).toBeUndefined()
    expect(bar.resetAt).toBeUndefined()
    expect(bar.tipBillingPeriodEndAt).not.toBe(row.short_interval_end)
    expect(bar.tipWindow).not.toContain('9999')
  })
})
