const staleAssetReloadKey = 'dashboard-shell:stale-asset-reload-at'
const staleAssetReloadWindowMs = 60_000

const staleAssetErrorPatterns = [
  /failed to fetch dynamically imported module/i,
  /importing a module script failed/i,
  /error loading dynamically imported module/i,
  /chunkloaderror/i,
  /loading chunk .+ failed/i,
  /node_modules\/\.vite\/deps/i,
]

export function errorText(value: unknown): string {
  if (value instanceof Error) {
    return `${value.name} ${value.message} ${value.stack ?? ''}`
  }

  if (typeof value === 'string') return value
  if (value && typeof value === 'object') {
    const details = value as {
      message?: unknown
      reason?: unknown
      error?: unknown
    }

    return [details.message, details.reason, details.error]
      .map(errorText)
      .filter(Boolean)
      .join(' ')
  }

  return ''
}

export function isStaleAssetError(value: unknown) {
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

export function reloadForStaleAssetError(value: unknown) {
  if (!isStaleAssetError(value)) return false
  return reloadForStaleAsset()
}
