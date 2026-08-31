/**
 * Contract test for scripts/vite-tailnet-allowed-hosts.config.mjs, the shared
 * wrapper mounted into each Vite 5 remote dev container.
 *
 * loadTailnetAllowedHostsConfig resolves `vite` through Node's module cache,
 * so the suite imports it exactly once and points configRoot at per-case
 * fixture projects under scripts/__fixtures__/.
 */
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, test } from 'vitest'
import {
  loadTailnetAllowedHostsConfig,
  resolveTailnetAllowedHostsConfig,
} from '../scripts/vite-tailnet-allowed-hosts.config.mjs'

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..'
)
const fixtureRoot = (name: string) =>
  path.join(repoRoot, 'scripts', '__fixtures__', name)

const envWithPattern = {
  __VITE_ADDITIONAL_SERVER_ALLOWED_HOSTS: '.tailf1878c.ts.net',
}

describe('vite-tailnet-allowed-hosts.config.mjs', () => {
  test('fails clearly when __VITE_ADDITIONAL_SERVER_ALLOWED_HOSTS is absent', async () => {
    await expect(
      loadTailnetAllowedHostsConfig({}, fixtureRoot('plain'))
    ).rejects.toThrowError(/__VITE_ADDITIONAL_SERVER_ALLOWED_HOSTS/)
  })

  test('loads the project config and appends the pattern to allowedHosts', async () => {
    const config = await loadTailnetAllowedHostsConfig(
      envWithPattern,
      fixtureRoot('plain')
    )

    expect(
      (config.plugins ?? []).map((plugin) => (plugin as { name: string }).name)
    ).toContain('fixture-marker-plugin')
    expect(config.define).toEqual({ __FIXTURE__: '"kept"' })
    expect(config.server?.allowedHosts).toEqual([
      'existing.example.internal',
      '.tailf1878c.ts.net',
    ])
  })

  test('preserves allowedHosts: true untouched', async () => {
    const config = await loadTailnetAllowedHostsConfig(
      envWithPattern,
      fixtureRoot('allowed-true')
    )

    expect(config.server?.allowedHosts).toBe(true)
  })

  test('propagates the original config load failure', async () => {
    await expect(
      loadTailnetAllowedHostsConfig(envWithPattern, fixtureRoot('broken'))
    ).rejects.toThrowError(/fixture config load failure/)
  })

  test('keeps the returned object unchanged when allowedHosts is true', () => {
    const original = { server: { allowedHosts: true as const } }
    expect(resolveTailnetAllowedHostsConfig(original, '.example.net')).toBe(
      original
    )
  })
})
