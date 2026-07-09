/**
 * Backward-compatible compatibility barrel.
 *
 * `comparison-panel.ts` is retained as a compatibility shim so existing imports
 * that still target the legacy path keep working.
 *
 * Wave 6 source spec canonicalizes production imports to
 * `comparison-panel.index.ts` to avoid barrel vs component ambiguity.
 */
export { ComparisonPanel } from './comparison-panel.index'
export {
  BURN_DAILY_HOT_THRESHOLD_USD,
  buildCurrentStats,
  computeDeltaPct,
  deltaColor,
  formatDeltaPct,
  formatDeltaPctWithPrior,
  type ProviderCurrentStats,
} from './comparison-panel.index'
