export function warnRemoteNavDrift(moduleId: string) {
  if (!import.meta.env.DEV) return
  const sink = globalThis['console'] as Pick<Console, 'warn'>
  sink.warn(
    `[remote-dashboard] Nav item paths drift between shell metadata and ${moduleId} remote module`
  )
}
