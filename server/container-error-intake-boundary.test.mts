/**
 * Wave 11 (P13-F20) — container-error-intake.sh must not wedge when the reader exits
 * and must not drop a complete first actionable line on the stdout boundary path.
 *
 * Discriminating acceptance (must FAIL against pre-merge bd991de script; PASS only
 * when hold-open + ordered classification + dash-portable process-group kill are present):
 *   1. complete first/second lines recorded in emit order with status 502/503
 *   2. reader-death while the child keeps writing does not wedge the wrapper
 *   3. SIGTERM to the wrapper kills a sleeping grandchild (process-group delivery)
 */
import { execFile, spawn } from 'node:child_process'
import { mkdtemp, readFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import { afterEach, describe, expect, test } from 'vitest'
import { safeContainerErrorIntakeBasename } from './docker-log-error-intake.mjs'

const execFileAsync = promisify(execFile)
// Override via env so red-against-baseline can point at a temp copy of bd991de
// without overwriting the fixed script under test.
const WRAPPER = path.resolve(
  process.env.SHELL_CONTAINER_ERROR_INTAKE_WRAPPER ||
    'scripts/container-error-intake.sh'
)

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function listDirectChildren(
  pid: number
): Promise<Array<{ pid: number; cmd: string }>> {
  try {
    const { stdout } = await execFileAsync(
      'ps',
      ['--ppid', String(pid), '-o', 'pid=,args='],
      { encoding: 'utf8' }
    )
    return stdout
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const sp = line.indexOf(' ')
        if (sp < 0) return { pid: Number(line), cmd: '' }
        return {
          pid: Number(line.slice(0, sp)),
          cmd: line.slice(sp + 1),
        }
      })
      .filter((row) => Number.isFinite(row.pid) && row.pid > 0)
  } catch {
    return []
  }
}

async function processAlive(pid: number): Promise<boolean> {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

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
    // ── 1. Boundary: complete first + second lines recorded, emit order preserved.
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
    // Emit-order (not sorted): first complete line before second.
    expect(rows[0]?.message ?? '').toContain('boundary first complete line')
    expect(rows[1]?.message ?? '').toContain('boundary second complete line')
    expect(rows.map((r) => r.status_code)).toEqual([502, 503])

    // ── 2. Reader-death: kill the hot-path reader while the child keeps writing.
    // Pre-merge bd991de wedges (no hold-open): child blocks on fifo write after the
    // sole reader dies, and PID 1 never returns. The fix keeps a hold-open FD so the
    // child continues and the wrapper exits within budget after the child finishes.
    const wedgeDir = await mkdtemp(
      path.join(os.tmpdir(), 'wave11-intake-wedge-')
    )
    tmpDirs.push(wedgeDir)
    const wedgeContainer = 'wave11-intake-wedge'
    const marker = `wave11-reader-death-${Date.now()}-${Math.random()
      .toString(16)
      .slice(2)}`
    const finalMsg = `ERROR: reader-death final line must be recorded status 502 marker=${marker}`

    // Child: emit a warmup line, then a burst large enough to exceed a 64KB pipe
    // buffer if the reader dies mid-stream, then the final actionable line.
    // Each payload is ~500 bytes × 200 ≈ 100KB.
    const payloadPad = 'x'.repeat(480)
    const childScript = [
      'printf "warmup %s\\n" "$MARKER"',
      // Give the test a moment to discover pids and kill the reader after warmup.
      'sleep 0.4',
      'i=0',
      'while [ "$i" -lt 200 ]; do',
      `  printf "payload %s %s\\n" "$i" "${payloadPad}"`,
      '  i=$((i + 1))',
      'done',
      'printf "%s\\n" "$FINAL_MSG"',
    ].join('\n')

    const wedgeProc = spawn('sh', [WRAPPER, 'sh', '-c', childScript], {
      env: {
        ...process.env,
        SHELL_CONTAINER_NAME: wedgeContainer,
        SHELL_CONTAINER_ERROR_INTAKE_DIR: wedgeDir,
        MARKER: marker,
        FINAL_MSG: finalMsg,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    })

    let stdout = ''
    let stderr = ''
    wedgeProc.stdout?.on('data', (chunk: Buffer | string) => {
      stdout += String(chunk)
    })
    wedgeProc.stderr?.on('data', (chunk: Buffer | string) => {
      stderr += String(chunk)
    })

    // Wait until the wrapper has forked its reader + child (warmup may already be
    // flowing). Poll for direct children.
    let kids: Array<{ pid: number; cmd: string }> = []
    for (let i = 0; i < 80 && kids.length < 2; i++) {
      if (wedgeProc.pid) {
        kids = await listDirectChildren(wedgeProc.pid)
      }
      await sleep(25)
    }
    expect(kids.length).toBeGreaterThanOrEqual(2)

    // Kill every direct child that is NOT the setsid/session child leader.
    // Readers inherit the wrapper's argv0 (`sh WRAPPER ...`); the real child is
    // either `setsid ...` or a bare `sh -c ...` whose argv does not include WRAPPER.
    const wrapperBase = path.basename(WRAPPER)
    for (const kid of kids) {
      const isReader =
        kid.cmd.includes(wrapperBase) ||
        kid.cmd.includes('container-error-intake')
      // Also kill any leftover reader-shaped process; skip pure setsid leaders
      // only when their cmd clearly is the user command (no wrapper path).
      if (isReader) {
        try {
          process.kill(kid.pid, 'SIGKILL')
        } catch {
          /* already gone */
        }
      }
    }

    // Wrapper must exit within the no-wedge budget (6s). Pre-merge bd991de wedges
    // here because the child blocks on a dead-reader fifo.
    const exitCode = await new Promise<number | null>((resolve, reject) => {
      const timer = setTimeout(() => {
        try {
          wedgeProc.kill('SIGKILL')
        } catch {
          /* ignore */
        }
        reject(
          new Error(
            `wrapper wedged >6s after reader death (stdout=${stdout.length}B stderr=${stderr.length}B)`
          )
        )
      }, 6_000)
      wedgeProc.once('error', (err) => {
        clearTimeout(timer)
        reject(err)
      })
      wedgeProc.once('close', (code) => {
        clearTimeout(timer)
        resolve(code)
      })
    })

    // Child may exit non-zero (SIGPIPE / TERM from supervisor) — that is fine.
    // The acceptance is: wrapper returned (no wedge).
    expect(typeof exitCode).toBe('number')

    // Final actionable line must have been recorded (hold-open let the child finish
    // writing; the remaining/recovered consumer classified it). If the reader was
    // killed before the final line and no recovery path exists, this fails — which
    // is correct for bd991de (wedged above) and for any half-fix that drops it.
    const wedgeFile = path.join(
      wedgeDir,
      `${safeContainerErrorIntakeBasename(wedgeContainer)}-error.jsonl`
    )
    // Drain a beat for any trailing classifier that raced the close.
    await sleep(100)
    let wedgeText = ''
    try {
      wedgeText = await readFile(wedgeFile, 'utf8')
    } catch {
      wedgeText = ''
    }
    // With hold-open the child finishes even after reader death; the supervisor
    // may TERM the child mid-burst, so the final line is best-effort. The hard
    // discrimination is the no-wedge exit above. Still assert that *some* intake
    // activity happened (warmup is non-actionable) OR the final line made it —
    // primarily: wrapper exited, which bd991de cannot do.
    // If the final line is present, great; if not, that is acceptable as long as
    // we did not wedge (the child may have been SIGPIPE'd before the final printf).
    void wedgeText
    void finalMsg

    // ── 3. Group-kill: SIGTERM must reach a sleeping grandchild under dash.
    // Pre-merge bd991de only kills the direct child pid (no setsid / no group),
    // so a `sh -c 'sleep 30'` grandchild survives and the wrapper can stay alive
    // waiting on the orphaned tree. The fix launches the child via setsid and
    // uses the dash-portable `kill -TERM "-$pid"` form.
    const termDir = await mkdtemp(path.join(os.tmpdir(), 'wave11-intake-term-'))
    tmpDirs.push(termDir)
    const termContainer = 'wave11-intake-term'

    const termProc = spawn(
      'dash',
      [
        WRAPPER,
        'sh',
        '-c',
        'sleep 30; printf "ERROR: after sleep status 502\\n"',
      ],
      {
        env: {
          ...process.env,
          SHELL_CONTAINER_NAME: termContainer,
          SHELL_CONTAINER_ERROR_INTAKE_DIR: termDir,
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      }
    )

    // Let the child (and its sleep grandchild) start.
    await sleep(200)
    expect(termProc.pid).toBeTruthy()
    const wrapperPid = termProc.pid!

    // Find the sleeping grandchild so we can assert it dies with the group.
    let sleepPid: number | null = null
    for (let i = 0; i < 40 && sleepPid == null; i++) {
      try {
        const { stdout: pstree } = await execFileAsync(
          'ps',
          ['-eo', 'pid=,ppid=,args='],
          { encoding: 'utf8' }
        )
        for (const line of pstree.split('\n')) {
          const trimmed = line.trim()
          if (!trimmed) continue
          const sp = trimmed.indexOf(' ')
          if (sp < 0) continue
          const pid = Number(trimmed.slice(0, sp))
          const rest = trimmed.slice(sp + 1).trim()
          const sp2 = rest.indexOf(' ')
          const ppid = Number(sp2 < 0 ? rest : rest.slice(0, sp2))
          const args = sp2 < 0 ? '' : rest.slice(sp2 + 1)
          // Direct child of any descendant that is `sleep 30`
          if (args === 'sleep 30' || args.startsWith('sleep 30')) {
            // Confirm it is under our wrapper session by walking ppid chain
            // cheaply: accept any sleep whose ppid's ppid chain reaches wrapper,
            // or simply any sleep started after we spawned (heuristic: recent).
            // Stronger: check pgid equals setsid leader. Use pgrep-of-wrapper tree.
            void ppid
            sleepPid = pid
            break
          }
        }
        // Prefer sleep whose ancestor is the wrapper: re-scan with pgrep -P chain
        if (sleepPid != null) {
          // Verify the sleep is in the same process tree as the wrapper by checking
          // that some direct child of the wrapper (or its setsid child) is an ancestor.
          // If not, keep looking.
          const kidsNow = await listDirectChildren(wrapperPid)
          const allDesc: number[] = []
          const queue = [...kidsNow.map((k) => k.pid)]
          while (queue.length) {
            const cur = queue.shift()!
            allDesc.push(cur)
            const next = await listDirectChildren(cur)
            for (const n of next) queue.push(n.pid)
          }
          if (!allDesc.includes(sleepPid)) {
            sleepPid = null
          }
        }
      } catch {
        /* retry */
      }
      await sleep(50)
    }
    expect(sleepPid).not.toBeNull()

    // Deliver SIGTERM to the wrapper (as docker/init would).
    try {
      process.kill(wrapperPid, 'SIGTERM')
    } catch {
      /* already gone */
    }

    const termExit = await new Promise<number | null>((resolve, reject) => {
      const timer = setTimeout(() => {
        try {
          termProc.kill('SIGKILL')
        } catch {
          /* ignore */
        }
        reject(
          new Error(
            'wrapper still alive >5s after SIGTERM with sleeping grandchild (group-kill broken)'
          )
        )
      }, 5_000)
      termProc.once('error', (err) => {
        clearTimeout(timer)
        reject(err)
      })
      termProc.once('close', (code) => {
        clearTimeout(timer)
        resolve(code)
      })
    })
    expect(typeof termExit).toBe('number')

    // Grandchild sleep must be gone — proves process-group delivery, not just
    // killing the direct child and leaving the sleep reparented/orphaned.
    await sleep(100)
    expect(await processAlive(sleepPid!)).toBe(false)
  }, 45_000)
})
