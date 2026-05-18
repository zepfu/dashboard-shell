/**
 * useAnomalyDetection — React hook detecting quota anomalies in health data.
 *
 * Scans provider health rows for non-monotonic reset timestamps (early reset
 * events) and flags stale cache metadata. Results are memoised to avoid
 * re-computation on unrelated renders.
 */
import { useMemo } from 'react'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** A single health observation row from the usage report API. */
export interface HealthRow {
  provider: string
  model?: string
  bucket_start: string
  next_expected_reset_at?: string | null
}

/** Anomaly flags produced by the hook. */
export interface AnomalyFlags {
  /**
   * Map from provider name → {prior, current} reset timestamps.
   * A provider appears here when its next_expected_reset_at decreased
   * compared to the prior bucket (indicating an unexpected early reset).
   */
  earlyReset: Map<string, { prior: string; current: string }>
  /** True when the metadata indicates the latest cache record is stale. */
  cacheStale: boolean
}

/** Optional metadata from the usage report response. */
export interface AnomalyMetadata {
  latestRecordStale?: boolean
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

/**
 * useAnomalyDetection analyses provider health rows for quota anomalies.
 *
 * @param healthRows - Raw health rows from the usage report API.
 * @param metadata - Optional response metadata carrying staleness flags.
 * @returns Memoised AnomalyFlags object.
 */
export function useAnomalyDetection(
  healthRows: HealthRow[],
  metadata?: AnomalyMetadata
): AnomalyFlags {
  return useMemo<AnomalyFlags>(() => {
    // 1. Group rows by provider
    const byProvider = new Map<string, HealthRow[]>()
    for (const row of healthRows) {
      const existing = byProvider.get(row.provider)
      if (existing !== undefined) {
        existing.push(row)
      } else {
        byProvider.set(row.provider, [row])
      }
    }

    // 2. Detect early resets per provider
    const earlyReset = new Map<string, { prior: string; current: string }>()

    for (const [provider, rows] of byProvider) {
      // Sort rows by bucket_start ascending
      const sorted = [...rows].sort(
        (a, b) =>
          new Date(a.bucket_start).getTime() -
          new Date(b.bucket_start).getTime()
      )

      // 3. Scan consecutive pairs for non-monotonic reset timestamps
      for (let i = 1; i < sorted.length; i++) {
        const prior = sorted[i - 1]
        const current = sorted[i]

        const priorReset = prior.next_expected_reset_at
        const currentReset = current.next_expected_reset_at

        if (
          priorReset != null &&
          priorReset !== '' &&
          currentReset != null &&
          currentReset !== ''
        ) {
          const priorTime = new Date(priorReset).getTime()
          const currentTime = new Date(currentReset).getTime()

          // Strict decrease → early reset detected
          if (currentTime < priorTime) {
            earlyReset.set(provider, {
              prior: priorReset,
              current: currentReset,
            })
            break // One flag per provider is sufficient
          }
        }
      }
    }

    // 4. cacheStale from metadata
    const cacheStale = metadata?.latestRecordStale === true

    return { earlyReset, cacheStale }
  }, [healthRows, metadata])
}
