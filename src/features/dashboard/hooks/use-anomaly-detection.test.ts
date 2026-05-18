/**
 * Wave 4 — useAnomalyDetection hook red-phase tests.
 *
 * Hook path: src/features/dashboard/hooks/use-anomaly-detection.ts
 * Expected export: useAnomalyDetection (named)
 * Signature: useAnomalyDetection(healthRows, metadata) => { earlyReset: Map<string, {prior: string, current: string}>, cacheStale: boolean }
 *
 * All tests expected to FAIL (red) — source file does not exist yet.
 */
import { renderHook } from '@testing-library/react'
import { useAnomalyDetection } from './use-anomaly-detection'

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

interface HealthRow {
  provider: string
  model: string
  bucket_start: string
  next_expected_reset_at: string
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test('test_detects_early_reset_non_monotonic', () => {
  // Row 1: bucket 08:00, reset 12:00 (later)
  // Row 2: bucket 09:00, reset 10:00 (earlier than row 1's reset — early reset!)
  const healthRows: HealthRow[] = [
    {
      provider: 'anthropic',
      model: 'claude',
      bucket_start: '2024-01-15T08:00:00Z',
      next_expected_reset_at: '2024-01-15T12:00:00Z',
    },
    {
      provider: 'anthropic',
      model: 'claude',
      bucket_start: '2024-01-15T09:00:00Z',
      next_expected_reset_at: '2024-01-15T10:00:00Z',
    },
  ]

  const { result } = renderHook(() =>
    useAnomalyDetection(healthRows, { latestRecordStale: false })
  )

  expect(result.current.earlyReset.has('anthropic')).toBe(true)

  const entry = result.current.earlyReset.get('anthropic')
  expect(entry).toBeDefined()
  expect(entry!.prior).toContain('12:00')
  expect(entry!.current).toContain('10:00')
})

test('test_no_early_reset_when_monotonic', () => {
  // Three rows with non-decreasing next_expected_reset_at
  const healthRows: HealthRow[] = [
    {
      provider: 'openai',
      model: 'gpt-4',
      bucket_start: '2024-01-15T08:00:00Z',
      next_expected_reset_at: '2024-01-15T12:00:00Z',
    },
    {
      provider: 'openai',
      model: 'gpt-4',
      bucket_start: '2024-01-15T09:00:00Z',
      next_expected_reset_at: '2024-01-15T12:00:00Z',
    },
    {
      provider: 'openai',
      model: 'gpt-4',
      bucket_start: '2024-01-15T10:00:00Z',
      next_expected_reset_at: '2024-01-15T13:00:00Z',
    },
  ]

  const { result } = renderHook(() =>
    useAnomalyDetection(healthRows, { latestRecordStale: false })
  )

  expect(result.current.earlyReset.size).toBe(0)
})

test('test_detects_cache_stale', () => {
  const { result } = renderHook(() =>
    useAnomalyDetection([], { latestRecordStale: true })
  )

  expect(result.current.cacheStale).toBe(true)
})

test('test_no_cache_stale_when_false', () => {
  const { result } = renderHook(() =>
    useAnomalyDetection([], { latestRecordStale: false })
  )

  expect(result.current.cacheStale).toBe(false)
})

test('test_sorts_rows_by_bucket_start_before_scanning', () => {
  // Rows OUT OF ORDER: row1 bucket 10:00, row2 bucket 08:00
  // If sorted correctly: 08:00 reset stays same or increases (08:00→10:00 is fine)
  // Without sorting: hook might see 10:00→11:00 as monotonic, or 08:00→09:00 out of order
  // These rows are monotonic WHEN SORTED — no false positive early reset
  const healthRows: HealthRow[] = [
    {
      provider: 'google',
      model: 'gemini',
      bucket_start: '2024-01-15T10:00:00Z',
      next_expected_reset_at: '2024-01-15T14:00:00Z',
    },
    {
      provider: 'google',
      model: 'gemini',
      bucket_start: '2024-01-15T08:00:00Z',
      next_expected_reset_at: '2024-01-15T12:00:00Z',
    },
  ]

  const { result } = renderHook(() =>
    useAnomalyDetection(healthRows, { latestRecordStale: false })
  )

  // After sorting by bucket_start: 08:00→reset12:00, 10:00→reset14:00
  // That is monotonic → no early reset
  expect(result.current.earlyReset.size).toBe(0)
})
