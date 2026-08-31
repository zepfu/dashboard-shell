/**
 * Wave 11 (P13-F07) — every compose-consumed SHELL_REPORT_* / VITE_* key must appear in .env.example.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, test } from 'vitest'

const COMPOSE_FILES = ['docker-compose.yml', 'docker-compose.dev.yml'] as const

const COMPOSE_VAR_PATTERN =
  /\$\{((?:SHELL_REPORT_[A-Z0-9_]+|VITE_[A-Z0-9_]+))(?::-[^}]*)?\}/g

function collectComposeConsumedKeys(repoRoot: string): string[] {
  const keys = new Set<string>()
  for (const file of COMPOSE_FILES) {
    const text = readFileSync(resolve(repoRoot, file), 'utf8')
    for (const match of text.matchAll(COMPOSE_VAR_PATTERN)) {
      keys.add(match[1]!)
    }
  }
  return [...keys].sort()
}

function keysDocumentedInEnvExample(envExampleText: string): Set<string> {
  const documented = new Set<string>()
  for (const line of envExampleText.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eq = trimmed.indexOf('=')
    if (eq <= 0) continue
    documented.add(trimmed.slice(0, eq))
  }
  return documented
}

describe('Wave 11 P13-F07 — .env.example covers compose variables', () => {
  test('test_env_example_covers_compose_vars', () => {
    const repoRoot = process.cwd()
    const envExample = readFileSync(resolve(repoRoot, '.env.example'), 'utf8')
    const documented = keysDocumentedInEnvExample(envExample)
    const required = collectComposeConsumedKeys(repoRoot)
    expect(required.length).toBeGreaterThan(0)

    const missing = required.filter((key) => !documented.has(key))
    expect(
      missing,
      `Add missing keys to .env.example (compose references ${required.length} SHELL_REPORT_/VITE_ keys): ${missing.join(', ')}`
    ).toEqual([])
  })
})

describe('D1-499 report pool timeout defaults', () => {
  test('keeps main and dev compose defaults distinct from the health timeout', () => {
    const repoRoot = process.cwd()
    const envExample = readFileSync(resolve(repoRoot, '.env.example'), 'utf8')

    expect(envExample).toContain('SHELL_REPORT_DB_CONNECTION_TIMEOUT_MS=30000')
    expect(envExample).toContain(
      'SHELL_REPORT_HEALTH_DB_CONNECTION_TIMEOUT_MS=1000'
    )

    for (const file of COMPOSE_FILES) {
      const compose = readFileSync(resolve(repoRoot, file), 'utf8')
      expect(compose).toContain(
        "SHELL_REPORT_DB_CONNECTION_TIMEOUT_MS: '${SHELL_REPORT_DB_CONNECTION_TIMEOUT_MS:-30000}'"
      )
      expect(compose).toContain(
        "SHELL_REPORT_HEALTH_DB_CONNECTION_TIMEOUT_MS: '${SHELL_REPORT_HEALTH_DB_CONNECTION_TIMEOUT_MS:-1000}'"
      )
    }
  })
})
