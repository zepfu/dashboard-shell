import type { ConfigEnv, UserConfig } from 'vite'

export declare const resolveTailnetAllowedHostsConfig: (
  config: UserConfig,
  additionalHost: string
) => UserConfig

export declare const loadTailnetAllowedHostsConfig: (
  env: NodeJS.ProcessEnv,
  configRoot: string,
  configEnv?: ConfigEnv
) => Promise<UserConfig>

declare const config: (configEnv: ConfigEnv) => Promise<UserConfig>

export default config
