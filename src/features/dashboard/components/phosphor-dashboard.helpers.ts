/**
 * Re-export barrel for phosphor dashboard pure helpers.
 * Wave 11: implementations live under `../lib/*`.
 */
export {
  HEALTH_CELL_COUNT,
  HEALTH_BUCKET_MS,
  padHealthCells,
  buildAggregateHealthCells,
} from '../lib/health-cells'
export {
  buildProviderMetrics,
  buildAggregateMetrics,
} from '../lib/provider-metrics'
export {
  classifyGeminiModel,
  keyFor,
  pickBestGoogleQuotaRowForClass,
  sumRequestsInLast90mFromNewestBucket,
  formatTipWindow,
  fmtIntervalCompact,
  formatTipVelocity,
  makeQuotaBarGroup,
  tipModelsFromBreakdownGoogleAggregated,
  tipModelsFromBreakdownSingleLabel,
  formatTimeAgo,
  _formatTipWindowForTest,
  _formatTipVelocityForTest,
} from '../lib/quota-bars/fields'
export {
  buildPriorBarFromHistory,
  buildProviderLanes,
} from '../lib/quota-bars/lanes'
export {
  formatCompactQuantity,
  quotaHistoryConsumedPct,
  quotaHistoryFillColor,
  quotaHistoryRequests,
  buildProviderQuotaHistoryTabs,
} from '../lib/quota-history-display'
export { localFallbackRange } from '../lib/dashboard-date-range'
export {
  deriveProviders,
  canonicalRepositoryName,
  buildModelRows,
  buildTopModels,
} from '../lib/ledger-rows'
