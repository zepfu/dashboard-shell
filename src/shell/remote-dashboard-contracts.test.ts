import { readFileSync } from 'node:fs'
import { describe, expect, test } from 'vitest'

function readProjectFile(path: string): string {
  return readFileSync(path, 'utf8')
}

describe('remote dashboard contracts', () => {
  test('test_tap_handoff_contract_topics_are_documented', () => {
    const integration = readProjectFile(
      'docs/remote-dashboard-integration-contract.md'
    )
    const runtime = readProjectFile('docs/runtime-contracts.md')

    expect(integration).toContain('Use the vendor-and-sync model')
    expect(integration).toContain('`accentColor`')
    expect(integration).toContain('The shell toggles `.dark`')
    expect(integration).toContain(
      'tabs, tables, buttons, dialogs, forms, cards'
    )
    expect(integration).toContain('jsx-a11y')
    expect(runtime).toContain('`staleTime`: `10_000` ms')
    expect(runtime).toContain('`refetchOnWindowFocus`')
    expect(runtime).toContain('no browser-public source maps by default')
    expect(runtime).toContain('`/modules/<base>/remoteEntry.js` paths')
    expect(runtime).toContain('`/api/<dashboard>/*` paths')
  })

  test('test_static_nginx_csp_allows_same_origin_remote_and_api_loading', () => {
    const nginx = readProjectFile('nginx.conf')

    expect(nginx).toContain('add_header Content-Security-Policy')
    expect(nginx).toContain("script-src 'self'")
    expect(nginx).toContain("connect-src 'self'")
    expect(nginx).toContain("style-src 'self' 'unsafe-inline'")
    expect(nginx).toContain(
      'add_header Content-Security-Policy $dashboard_shell_csp always;'
    )
  })
})
