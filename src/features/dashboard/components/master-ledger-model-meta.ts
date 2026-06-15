import {
  canonicalProvider,
  formatModelDisplayName,
} from '../lib/usage-report-display'

export interface ModelFamilyDefinition {
  key: string
  label: string
  matches: (model: string) => boolean
}

/** Token-boundary match for slug-style model ids (hyphen/underscore/path separators). */
function familyTokenMatches(model: string, token: string): boolean {
  const normalized = model.toLowerCase()
  const needle = token.toLowerCase()
  if (normalized === needle) return true
  const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`(?:^|[-_./])${escaped}(?:$|[-_./])`).test(normalized)
}

/** Multi-token phrase with flexible separators (e.g. auto-review / auto_review). */
function familyPhraseMatches(model: string, phrase: string): boolean {
  const normalized = model.toLowerCase()
  const parts = phrase.toLowerCase().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return false
  const pattern = parts
    .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('[-_./\\s]+')
  return new RegExp(`(?:^|[-_./])${pattern}(?:$|[-_./])`).test(normalized)
}

/** Shared with OpenRouter vendor inference — OpenAI o-series reasoning model ids. */
export function isOpenAiReasoningModelId(normalizedModel: string): boolean {
  return (
    normalizedModel.startsWith('o1') ||
    normalizedModel.startsWith('o3') ||
    normalizedModel.startsWith('o4')
  )
}

// Order matters: longer / more specific family patterns are listed first (S2-14).
const MODEL_FAMILY_DEFINITIONS: Record<string, ModelFamilyDefinition[]> = {
  anthropic: [
    {
      key: 'auto-review',
      label: 'Auto Review',
      matches: (model) =>
        familyPhraseMatches(model, 'auto review') ||
        familyTokenMatches(model, 'auto-review') ||
        familyTokenMatches(model, 'auto_review'),
    },
    {
      key: 'opus',
      label: 'Opus',
      matches: (model) => familyTokenMatches(model, 'opus'),
    },
    {
      key: 'sonnet',
      label: 'Sonnet',
      matches: (model) => familyTokenMatches(model, 'sonnet'),
    },
    {
      key: 'haiku',
      label: 'Haiku',
      matches: (model) => familyTokenMatches(model, 'haiku'),
    },
  ],
  openai: [
    {
      key: 'codex-spark',
      label: 'Codex Spark',
      matches: (model) => familyTokenMatches(model, 'codex-spark'),
    },
    {
      key: 'codex',
      label: 'Codex',
      matches: (model) => familyTokenMatches(model, 'codex'),
    },
    {
      key: 'reasoning',
      label: 'Reasoning',
      matches: (model) => isOpenAiReasoningModelId(model),
    },
    {
      key: 'mini',
      label: 'Mini',
      matches: (model) => familyTokenMatches(model, 'mini'),
    },
    {
      key: 'gpt',
      label: 'GPT',
      matches: (model) => familyTokenMatches(model, 'gpt'),
    },
  ],
  google: [
    {
      key: 'flash-lite',
      label: 'Flash Lite',
      matches: (model) =>
        familyPhraseMatches(model, 'flash lite') ||
        familyTokenMatches(model, 'flash-lite') ||
        familyTokenMatches(model, 'flash_lite'),
    },
    {
      key: 'gemini',
      label: 'Gemini',
      matches: (model) => familyTokenMatches(model, 'gemini'),
    },
    {
      key: 'flash',
      label: 'Flash',
      matches: (model) => familyTokenMatches(model, 'flash'),
    },
    {
      key: 'pro',
      label: 'Pro',
      matches: (model) => familyTokenMatches(model, 'pro'),
    },
  ],
}

export const OTHER_FAMILY_DEFINITION: ModelFamilyDefinition = {
  key: 'other',
  label: 'Other',
  matches: () => true,
}

function formatOpenRouterVendorLabel(vendor: string): string {
  const normalized = vendor.trim().toLowerCase()
  if (normalized === 'openai') return 'OpenAI'
  if (normalized === 'xai') return 'xAI'
  if (normalized === 'qwen') return 'Qwen'
  if (normalized === 'inclusionai') return 'InclusionAI'
  if (normalized === 'deepseek') return 'DeepSeek'
  return formatModelDisplayName(vendor)
}

export function inferOpenRouterVendor(model: string): string {
  const normalized = model
    .toLowerCase()
    .replace(/^openrouter\//, '')
    .replace(/:(free|stealth)$/i, '')
  const parts = normalized.split('/').filter(Boolean)
  const pathVendor =
    parts.length > 1
      ? parts[0] === 'free' && parts[1] !== undefined
        ? parts[1]
        : parts[0]
      : undefined
  if (pathVendor !== undefined) return pathVendor
  if (normalized.startsWith('qwen')) return 'qwen'
  if (normalized.startsWith('gpt') || isOpenAiReasoningModelId(normalized)) {
    return 'openai'
  }
  if (normalized.startsWith('claude')) return 'anthropic'
  if (normalized.startsWith('gemini')) return 'google'
  if (normalized.startsWith('grok')) return 'xai'
  if (normalized.startsWith('llama')) return 'meta'
  if (normalized.startsWith('deepseek')) return 'deepseek'
  if (normalized.startsWith('cohere')) return 'cohere'
  if (normalized.startsWith('mistral')) return 'mistral'
  if (normalized.startsWith('minimax')) return 'minimax'
  if (normalized.startsWith('nvidia')) return 'nvidia'
  if (normalized.startsWith('inclusion')) return 'inclusionai'
  return 'other'
}

function openRouterFamilyForModel(model: string): ModelFamilyDefinition {
  const vendor = inferOpenRouterVendor(model)
  const key = vendor.replace(/[^a-z0-9-]+/g, '-')
  return {
    key,
    label: formatOpenRouterVendorLabel(vendor),
    matches: (candidate) =>
      inferOpenRouterVendor(candidate).replace(/[^a-z0-9-]+/g, '-') === key,
  }
}

export function familyDefinitionsForProvider(
  providerKey: string,
  rows: readonly { model: string }[]
): ModelFamilyDefinition[] | undefined {
  if (providerKey !== 'openrouter') return MODEL_FAMILY_DEFINITIONS[providerKey]

  const definitions = new Map<string, ModelFamilyDefinition>()
  for (const row of rows) {
    const definition = openRouterFamilyForModel(row.model)
    definitions.set(definition.key, definition)
  }
  return [...definitions.values()].sort((left, right) =>
    left.label.localeCompare(right.label, undefined, { sensitivity: 'base' })
  )
}

export function modelFamilyForRow(
  provider: string,
  model: string
): ModelFamilyDefinition | null {
  const providerKey = canonicalProvider(provider)
  if (providerKey === 'openrouter') return openRouterFamilyForModel(model)

  const definitions = MODEL_FAMILY_DEFINITIONS[providerKey]
  if (definitions === undefined) return null
  const normalizedModel = model.toLowerCase()
  return (
    definitions.find((definition) => definition.matches(normalizedModel)) ??
    OTHER_FAMILY_DEFINITION
  )
}

function stripLeadingLedgerSeparators(value: string): string {
  let result = value.trim()
  while (/^[/:\-_]/.test(result)) {
    result = result.slice(1).trim()
  }
  return result
}

function stripProviderModelPrefix(providerKey: string, model: string): string {
  const trimmed = model.trim()
  const prefix = new RegExp(
    `^${providerKey.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[/:_-]+`,
    'i'
  )
  return stripLeadingLedgerSeparators(trimmed.replace(prefix, ''))
}

export function formatLedgerModelDisplayName(
  providerKey: string,
  model: string
): string {
  const withoutProviderPrefix = stripProviderModelPrefix(providerKey, model)
  if (providerKey === 'anthropic') {
    const normalized = withoutProviderPrefix
    const match = normalized.match(
      /^claude[-_\s]+(opus|sonnet|haiku)[-_\s]+(\d+)[-_.\s]+(\d+)(.*)$/i
    )
    if (match) {
      const family = match[1][0].toUpperCase() + match[1].slice(1).toLowerCase()
      const suffix = stripLeadingLedgerSeparators(match[4].trim())
      return `${family} ${match[2]}.${match[3]}${suffix ? ` ${suffix}` : ''}`
    }
    return stripLeadingLedgerSeparators(
      formatModelDisplayName(normalized).replace(/^Claude\s+/i, '')
    )
  }
  return stripLeadingLedgerSeparators(
    formatModelDisplayName(withoutProviderPrefix)
  )
}
