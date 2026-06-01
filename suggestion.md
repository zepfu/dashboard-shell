# Work Suggestions

## 2026-06-01 - D1-103 TREND Health/Score signal data

- Add a small `pnpm smoke:trend-summary` wrapper that restarts the report service
  if needed, fetches the token-trend summary with a cache-bust key, prints row
  counts for `tokenTrendHours`, `tokenTrendHealth`, `tokenTrendScores`,
  `tokenTrendVersions`, and `tokenTrendModelFirstSeen`, and writes artifacts
  under an ignored `tmp/smoke/` path.
- Benefit: saves time and token churn by replacing repeated manual `curl` +
  ad-hoc `node -e` probes with one stable proof command, and reduces worktree
  churn from root-level smoke JSON/PNG/HTML artifacts.

## 2026-06-01 - D1-104 TREND signal cold-cache latency

- Split the token-trend summary cache-miss path so Health/Score signal data can
  refresh independently from the heavier token/version/model-first-seen payload,
  or preaggregate hourly `session_history` score buckets into a small
  dashboard-facing read model.
- Benefit: keeps the now-denser Health/Score graph responsive on cache misses
  without changing the visual contract or hiding slow query-plan work behind
  Redis.
