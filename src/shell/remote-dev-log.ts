export function warnRemoteNavDrift(moduleId: string) {
  if (!import.meta.env.DEV) return
  // eslint-disable-next-line no-console -- dev-only nav drift signal
  console.warn(
    `[remote-dashboard] Nav item paths drift between shell metadata and ${moduleId} remote module`
  )
}
