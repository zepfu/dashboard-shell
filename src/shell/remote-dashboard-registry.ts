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
  'aawm-tap': () => import('aawm-tap-dashboard/module'),
  aegis: () => import('aegis-dashboard/module'),
  sluice: () => import('sluice/module'),
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
