// Shared Vite config wrapper for the Vite 5 remote dev containers in
// docker-compose.dev.yml. Vite 5 ignores the Vite 8
// __VITE_ADDITIONAL_SERVER_ALLOWED_HOSTS env hook, so each remote project
// mounts this file read-only into its project root and starts Vite with
// `--config vite-tailnet-allowed-hosts.config.mjs`.
import path from 'node:path'

export const resolveTailnetAllowedHostsConfig = (config, additionalHost) => {
  if (config.server?.allowedHosts === true) {
    return config
  }

  return {
    ...config,
    server: {
      ...config.server,
      allowedHosts: [...(config.server?.allowedHosts ?? []), additionalHost],
    },
  }
}

export const loadTailnetAllowedHostsConfig = async (
  env,
  configRoot,
  configEnv
) => {
  // The wrapper must use the remote project's own installed Vite: it is
  // mounted into the project root, so `import('vite')` resolves to that
  // project's node_modules, not to a dashboard-shell copy.
  const additionalHost = env.__VITE_ADDITIONAL_SERVER_ALLOWED_HOSTS

  if (!additionalHost) {
    throw new Error(
      'vite-tailnet-allowed-hosts.config.mjs requires __VITE_ADDITIONAL_SERVER_ALLOWED_HOSTS to be set to the single allowed-host pattern (for example .tailf1878c.ts.net).'
    )
  }

  const { loadConfigFromFile } = await import('vite')
  const configFile = path.resolve(configRoot, 'vite.config.ts')

  const loaded = await loadConfigFromFile(
    configEnv ?? { command: 'serve', mode: env.NODE_ENV ?? 'development' },
    configFile,
    configRoot
  )

  if (!loaded) {
    throw new Error(
      'vite-tailnet-allowed-hosts.config.mjs could not load the remote project vite config.'
    )
  }

  return resolveTailnetAllowedHostsConfig(loaded.config, additionalHost)
}

// Vite calls this config function only when it loads the file via `--config`,
// so importing the named exports in tests does not trigger a load.
export default (configEnv) =>
  loadTailnetAllowedHostsConfig(process.env, process.cwd(), configEnv)
