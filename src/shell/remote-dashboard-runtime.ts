import {
  normalizeRemoteRoutePath,
  type RemoteDashboardRegistryEntry,
} from './remote-dashboard-registry'
import type { ProjectModule, RemoteRouteProps } from './types'

export class RemoteModuleContractError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'RemoteModuleContractError'
  }
}

export function assertProjectModule(
  module: unknown
): asserts module is ProjectModule {
  if (module === null || module === undefined) {
    throw new RemoteModuleContractError(
      'Module default does not satisfy ProjectModule contract'
    )
  }
  if (typeof module !== 'object') {
    throw new RemoteModuleContractError(
      'Module default does not satisfy ProjectModule contract'
    )
  }
  const candidate = module as Partial<ProjectModule>
  if (
    typeof candidate.basePath !== 'string' ||
    candidate.basePath.length === 0
  ) {
    throw new RemoteModuleContractError(
      'Module default does not satisfy ProjectModule contract: missing basePath'
    )
  }
  if (!Array.isArray(candidate.routes)) {
    throw new RemoteModuleContractError(
      'Module default does not satisfy ProjectModule contract: missing routes'
    )
  }
  if (typeof candidate.icon !== 'function') {
    throw new RemoteModuleContractError(
      'Module default does not satisfy ProjectModule contract: missing icon'
    )
  }
  if (typeof candidate.name !== 'string') {
    throw new RemoteModuleContractError(
      'Module default does not satisfy ProjectModule contract: missing name'
    )
  }
  if (!Array.isArray(candidate.navItems)) {
    throw new RemoteModuleContractError(
      'Module default does not satisfy ProjectModule contract: missing navItems'
    )
  }
}

export function createRetryableImporter<T>(importFn: () => Promise<T>): {
  load: () => Promise<T>
  reset: () => void
} {
  let promise: Promise<T> | undefined
  return {
    load: () => (promise ??= importFn()),
    reset: () => {
      promise = undefined
    },
  }
}

export function matchRoutePath(pattern: string, routePath: string) {
  const normalizedPattern = normalizeRemoteRoutePath(pattern)
  const normalizedRoutePath = normalizeRemoteRoutePath(routePath)

  if (normalizedPattern === normalizedRoutePath) {
    return {}
  }

  if (normalizedPattern === '/' || normalizedRoutePath === '/') {
    return undefined
  }

  const patternSegments = normalizedPattern.split('/').filter(Boolean)
  const routeSegments = normalizedRoutePath.split('/').filter(Boolean)
  if (patternSegments.length !== routeSegments.length) {
    return undefined
  }

  const params: Record<string, string> = {}
  for (const [index, patternSegment] of patternSegments.entries()) {
    const routeSegment = routeSegments[index]
    if (routeSegment === undefined) return undefined

    if (patternSegment.startsWith(':')) {
      const paramName = patternSegment.slice(1)
      params[paramName] = decodePathSegment(routeSegment)
      continue
    }

    if (patternSegment !== routeSegment) {
      return undefined
    }
  }

  return params
}

function decodePathSegment(segment: string) {
  try {
    return decodeURIComponent(segment)
  } catch {
    return segment
  }
}

export function buildRemoteRouteProps(
  config: RemoteDashboardRegistryEntry,
  routePath: string,
  params: Record<string, string>
): RemoteRouteProps {
  return {
    params,
    ...params,
    moduleId: config.moduleId,
    routePath,
    basePath: config.basePath,
    apiBase: config.apiBase,
  }
}
