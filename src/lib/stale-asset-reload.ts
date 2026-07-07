const staleAssetReloadKey = 'dashboard-shell:stale-asset-reload-at'
const staleAssetReloadWindowMs = 60_000

const staleAssetErrorPatterns = [
  /failed to fetch dynamically imported module/i,
  /importing a module script failed/i,
  /error loading dynamically imported module/i,
  /chunkloaderror/i,
  /loading chunk .+ failed/i,
]

const MAX_ERROR_TEXT_DEPTH = 32

export function errorText(value: unknown): string {
  const visited = new WeakSet<object>()

  function walk(current: unknown, depth: number): string {
    if (depth > MAX_ERROR_TEXT_DEPTH) return ''

    if (current instanceof Error) {
      return `${current.name} ${current.message} ${current.stack ?? ''}`
    }

    if (typeof current === 'string') return current

    if (current && typeof current === 'object') {
      if (visited.has(current)) return '(nested error)'
      visited.add(current)

      const details = current as {
        message?: unknown
        reason?: unknown
        error?: unknown
      }

      return [details.message, details.reason, details.error]
        .map((part) => walk(part, depth + 1))
        .filter(Boolean)
        .join(' ')
    }

    return ''
  }

  return walk(value, 0)
}

export function isStaleAssetError(value: unknown) {
  if (value instanceof Error && value.name === 'ChunkLoadError') {
    return true
  }

  const text = errorText(value)
  return staleAssetErrorPatterns.some((pattern) => pattern.test(text))
}

export function reloadForStaleAsset() {
  try {
    const lastReloadAt = Number(
      window.sessionStorage.getItem(staleAssetReloadKey)
    )

    if (
      Number.isFinite(lastReloadAt) &&
      Date.now() - lastReloadAt < staleAssetReloadWindowMs
    ) {
      return false
    }

    window.sessionStorage.setItem(staleAssetReloadKey, String(Date.now()))
  } catch {
    // If sessionStorage is unavailable, still attempt a normal reload.
  }

  window.location.reload()
  return true
}
