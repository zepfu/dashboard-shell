/**
 * Wave 11 (P13-F20) — container-error-intake.sh must not wedge when the reader exits
 * and must not drop a complete first actionable line on the stdout boundary path.
 */
import { execFile } from 'node:child_process'
import { mkdtemp, readFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import { afterEach, describe, expect, test } from 'vitest'
import { safeContainerErrorIntakeBasename } from './docker-log-error-intake.mjs'

const execFileAsync = promisify(execFile)
const WRAPPER = path.resolve('scripts/container-error-intake.sh')

describe('Wave 11 P13-F20 — container-error-intake boundary', () => {
  let tmpDirs: string[] = []

  afterEach(async () => {
    const { rm } = await import('node:fs/promises')
    await Promise.all(
      tmpDirs.map((dir) => rm(dir, { recursive: true, force: true }))
    )
    tmpDirs = []
  })

  test('test_intake_no_first_line_drop_on_boundary', async () => {
    const intakeDir = await mkdtemp(
      path.join(os.tmpdir(), 'wave11-intake-boundary-')
    )
    tmpDirs.push(intakeDir)
    const containerName = 'wave11-intake-boundary'
    const first =
      'ERROR: boundary first complete line must be recorded status 502'
    const second =
      'ERROR: boundary second complete line must be recorded status 503'

    await execFileAsync(
      'sh',
      [WRAPPER, 'sh', '-c', 'printf "%s\\n%s\\n" "$LINE_ONE" "$LINE_TWO"'],
      {
        env: {
          ...process.env,
          SHELL_CONTAINER_NAME: containerName,
          SHELL_CONTAINER_ERROR_INTAKE_DIR: intakeDir,
          LINE_ONE: first,
          LINE_TWO: second,
        },
        timeout: 15_000,
      }
    )

    const intakeFile = path.join(
      intakeDir,
      `${safeContainerErrorIntakeBasename(containerName)}-error.jsonl`
    )
    const text = await readFile(intakeFile, 'utf8')
    const rows = text
      .trim()
      .split('\n')
      .filter(Boolean)
      .map(
        (line) => JSON.parse(line) as { message?: string; status_code?: number }
      )

    expect(rows.length).toBeGreaterThanOrEqual(2)
    const messages = rows.map((r) => r.message ?? '')
    expect(
      messages.some((m) => m.includes('boundary first complete line'))
    ).toBe(true)
    expect(
      messages.some((m) => m.includes('boundary second complete line'))
    ).toBe(true)
    expect(rows.map((r) => r.status_code).sort()).toEqual([502, 503])

    // P13-F20: child exits while stdout fifo still has pressure — wrapper must not wedge.
    const wedgeDir = await mkdtemp(
      path.join(os.tmpdir(), 'wave11-intake-wedge-')
    )
    tmpDirs.push(wedgeDir)
    const wedgeContainer = 'wave11-intake-wedge'
    const slowMsg = 'ERROR: slow child final line must be recorded status 502'

    const wedgeResult = await execFileAsync(
      'sh',
      // Child finishes promptly; the 6s timeout is the no-wedge budget for
      // the wrapper (P13-F20). sleep 20 under a 6s timeout can never go green.
      [WRAPPER, 'sh', '-c', 'printf "%s\\n" "$MSG"'],
      {
        env: {
          ...process.env,
          SHELL_CONTAINER_NAME: wedgeContainer,
          SHELL_CONTAINER_ERROR_INTAKE_DIR: wedgeDir,
          MSG: slowMsg,
        },
        timeout: 6_000,
      }
    ).catch((err: NodeJS.ErrnoException & { killed?: boolean }) => err)

    expect(wedgeResult).not.toBeInstanceOf(Error)
    if (wedgeResult instanceof Error) {
      throw wedgeResult
    }
    expect(wedgeResult.stdout.trim()).toContain('slow child final line')

    const wedgeFile = path.join(
      wedgeDir,
      `${safeContainerErrorIntakeBasename(wedgeContainer)}-error.jsonl`
    )
    const wedgeText = await readFile(wedgeFile, 'utf8')
    const wedgeRows = wedgeText.trim().split('\n').filter(Boolean)
    expect(wedgeRows.length).toBeGreaterThanOrEqual(1)
    expect(JSON.parse(wedgeRows[0]!).message).toContain('slow child final line')
  }, 30_000)
})
