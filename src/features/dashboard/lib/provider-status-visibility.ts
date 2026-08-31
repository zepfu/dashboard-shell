export const ANTHROPIC_PROVIDER_STATUS_ENV_VAR =
  'VITE_SHOW_ANTHROPIC_PROVIDER_STATUS'

const TRUTHY_ENV_VALUES = new Set(['1', 'true', 'yes', 'on'])

function readAnthropicProviderStatusFlag(): string | undefined {
  const env = import.meta.env as Record<string, unknown>
  const value = env[ANTHROPIC_PROVIDER_STATUS_ENV_VAR]
  return typeof value === 'string' ? value : undefined
}

export function isAnthropicProviderStatusVisible(
  configuredValue: string | undefined = readAnthropicProviderStatusFlag()
): boolean {
  return (
    configuredValue !== undefined &&
    TRUTHY_ENV_VALUES.has(configuredValue.trim().toLowerCase())
  )
}
