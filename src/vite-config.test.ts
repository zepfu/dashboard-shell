// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { buildDevRemoteEntryRedirect } from '../vite.config'

describe('buildDevRemoteEntryRedirect', () => {
  it('keeps the browser-selected LAN or Tailscale host for dev remotes', () => {
    expect(
      buildDevRemoteEntryRedirect(
        '192.168.76.220:3006',
        '/modules/aawm/remoteEntry.js'
      )
    ).toBe('http://192.168.76.220:5176/remoteEntry.js')
    expect(
      buildDevRemoteEntryRedirect(
        '100.94.92.87:3006',
        '/modules/aawm-tap/remoteEntry.js'
      )
    ).toBe('http://100.94.92.87:5173/remoteEntry.js')
  })

  it('ignores paths that are not dev remote entries', () => {
    expect(
      buildDevRemoteEntryRedirect('localhost:3006', '/api/shell/health')
    ).toBe(null)
  })
})
