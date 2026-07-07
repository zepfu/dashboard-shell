import { remoteDashboardMetadata } from '@/shell/remote-dashboard-metadata'

const aawmTapMeta = remoteDashboardMetadata.find((d) => d.key === 'aawm-tap')

/** Allowlist derived from shell metadata (S6-4). */
export const allowedPages = new Set(
  (aawmTapMeta?.navItems ?? []).map((item) => item.path.replace(/^\//, ''))
)
