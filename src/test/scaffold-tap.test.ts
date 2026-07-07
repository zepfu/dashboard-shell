import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, test } from 'vitest'
import { main, parseArgs } from '../../scripts/scaffold-tap.mjs'

describe('scaffold-tap parseArgs', () => {
  test('keeps values containing "=" intact', () => {
    const args = parseArgs([
      '--description=a=b',
      '--module-id',
      'example-dashboard',
      'generated-dashboard',
    ])

    expect(args).toMatchObject({
      description: 'a=b',
      moduleId: 'example-dashboard',
      _: ['generated-dashboard'],
    })
  })

  test('does not treat a following positional as --help value', () => {
    const args = parseArgs(['--help', 'generated-dashboard'])

    expect(args).toMatchObject({
      help: true,
      _: ['generated-dashboard'],
    })
  })

  test('rejects unknown flags', () => {
    expect(() => parseArgs(['--basepath', 'generated-dashboard'])).toThrow(
      /Unsupported argument: --basepath/
    )
  })

  test('requires values for known non-boolean flags', () => {
    expect(() => parseArgs(['--module-id'])).toThrow(
      /Missing value for --module-id/
    )
  })

  test('keeps existing flag parsing contract', () => {
    const args = parseArgs([
      '--module-id=example-dashboard',
      '--name',
      'Example',
      '--base-path',
      '/example',
      '/tmp/example-dashboard',
    ])

    expect(args).toMatchObject({
      moduleId: 'example-dashboard',
      name: 'Example',
      basePath: '/example',
      _: ['/tmp/example-dashboard'],
    })
  })

  test('generates a scaffold using parsed flags into a temp dir', () => {
    const tempRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), 'dashboard-scaffold-')
    )
    const targetDir = path.join(tempRoot, 'generated-dashboard')

    try {
      const exitCode = main(
        [
          '--module-id=generated-dashboard',
          '--name',
          'Generated Dashboard',
          '--description=Line with=equals',
          '--base-path',
          '/generated',
          '--api-base',
          '/api/generated',
          '--accent-color',
          '#ff00ff',
          targetDir,
        ],
        { cwd: process.cwd() }
      )

      expect(exitCode).toBe(0)
      expect(
        JSON.parse(
          fs.readFileSync(path.join(targetDir, 'package.json'), 'utf8')
        ).name
      ).toBe('generated-dashboard')

      const manifest = fs.readFileSync(
        path.join(targetDir, 'src/module.ts'),
        'utf8'
      )
      expect(manifest).toContain('id: "generated-dashboard"')
      expect(manifest).toContain('basePath: "/generated"')
      expect(manifest).toContain('apiBase: "/api/generated"')
      expect(manifest).toContain('accentColor: "#ff00ff"')
      expect(manifest).toContain('Generated Dashboard')

      const readme = fs.readFileSync(path.join(targetDir, 'README.md'), 'utf8')
      expect(readme).toContain('entry for `generated-dashboard`')

      const indexHtml = fs.readFileSync(
        path.join(targetDir, 'index.html'),
        'utf8'
      )
      expect(indexHtml).toContain('<title>Generated Dashboard</title>')
      expect(
        fs.existsSync(path.join(targetDir, 'src/components/ui'))
      ).toBeTruthy()
      expect(
        fs.existsSync(path.join(targetDir, 'src/lib/utils.ts'))
      ).toBeTruthy()
      expect(
        fs.existsSync(path.join(targetDir, 'components.json'))
      ).toBeTruthy()
    } finally {
      fs.rmSync(tempRoot, { recursive: true, force: true })
    }
  })
})
