import {
  hostDashboardTeam,
  normalizeRemoteRoutePath,
  remoteDashboardHref,
  remoteDashboardMetadata,
  type RemoteDashboardKey,
  type RemoteDashboardMetadataEntry,
} from './remote-dashboard-metadata'
import type { ProjectModule } from './types'

export {
  hostDashboardTeam,
  normalizeRemoteRoutePath,
  remoteDashboardHref,
  type RemoteDashboardKey,
}

export type RemoteDashboardRegistryEntry = RemoteDashboardMetadataEntry & {
  importModule: () => Promise<{ default: ProjectModule }>
}

const remoteDashboardImporters: Record<
  RemoteDashboardKey,
  () => Promise<{ default: ProjectModule }>
> = {
  aawm: () => import('./remote-modules/aawm'),
  'aawm-tap': () => import('./remote-modules/aawm-tap'),
  'aawm-observe': () => import('./remote-modules/aawm-observe'),
  aegis: () => import('./remote-modules/aegis'),
  sluice: () => import('./remote-modules/sluice'),
}

export const remoteDashboardConfigs = remoteDashboardMetadata.map(
  (dashboard) => ({
    ...dashboard,
    importModule: remoteDashboardImporters[dashboard.key],
  })
) satisfies RemoteDashboardRegistryEntry[]

export const remoteDashboardConfigByKey = remoteDashboardConfigs.reduce(
  (registry, config) => {
    registry[config.key] = config
    return registry
  },
  {} as Record<RemoteDashboardKey, RemoteDashboardRegistryEntry>
)
