import { execFile } from 'node:child_process'
import { appendFile, mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import { afterEach, describe, expect, test, vi } from 'vitest'
import {
  appendDockerLogErrorsToIntake,
  loadPersistedDockerLogErrorFingerprintsFromJsonl,
  discoverDockerJsonLogSourcesFromConfigs,
  acquireIntakeFileLock,
  matchDockerJsonLogContainer,
  shouldDiscoverDockerJsonLogSources,
  splitDockerLogErrorsForDashboardAndIntake,
  buildDockerLogErrorFingerprint,
  capDockerLogErrorsForDashboard,
  extractDockerLogErrorsFromTail,
  selectNewDockerLogErrors,
  inferLogLevel,
  isActionableErrorLog,
  isInformationalErrorMention,
  buildDockerLogErrorRow,
  safeContainerErrorIntakeBasename,
  filterDockerLogErrorsForCentralizedIntake,
  isRepoOwnedDockerLogContainerName,
  inferLogProvider,
  resolveRepoComposeProjectMarkers,
} from './docker-log-error-intake.mjs'

const execFileAsync = promisify(execFile)

describe('docker-log-error-intake', () => {
  let tmpDirs = []

  afterEach(async () => {
    await Promise.all(
      tmpDirs.map((dir) => rm(dir, { recursive: true, force: true }))
    )
    tmpDirs = []
  })

  test('report-service INFO docker log error row append message is not actionable', () => {
    const msg =
      '[report-service] INFO: appended 11 docker log error row(s) to /workspace/dashboard-shell/.analysis'
    expect(isInformationalErrorMention(msg)).toBe(true)
    expect(isActionableErrorLog(msg)).toBe(false)
  })

  test('INFO lines that only mention error in non-failure context are not extracted from Docker JSON tail', () => {
    const msg =
      '[report-service] INFO: appended 3 docker log error rows to /workspace/dashboard-shell/.analysis'
    const tail = `${JSON.stringify({
      time: new Date().toISOString(),
      stream: 'stdout',
      log: msg,
    })}\n`
    const rows = extractDockerLogErrorsFromTail({
      tailText: tail,
      container: 'dashboard-shell-reports-dev',
      cutoffMs: Date.now() - 60_000,
      source: { sourceIdentity: 'docker-json-log' },
    })
    expect(rows).toHaveLength(0)
    expect(
      buildDockerLogErrorRow(
        JSON.parse(tail.trim()),
        'dashboard-shell-reports-dev'
      )
    ).toBeNull()
  })

  test('successful HTTP 200 nginx asset access logs with error-like filenames are not actionable', () => {
    const msg =
      '172.24.0.1 - - [30/Jun/2026:13:14:18 +0000] "GET /assets/general-error-IdO0Kgsj.js HTTP/1.1" 200 1989 "-" "-" "-"'
    expect(isActionableErrorLog(msg)).toBe(false)
    expect(
      buildDockerLogErrorRow(
        { time: '2026-06-30T13:14:18.000Z', stream: 'stdout', log: msg },
        'dashboard-shell'
      )
    ).toBeNull()
  })

  test('500 nginx asset access logs remain actionable with extracted status code', () => {
    const msg =
      '172.24.0.1 - - [30/Jun/2026:13:14:18 +0000] "GET /assets/not-found-error-nSd2gCZ4.js HTTP/1.1" 500 1989 "-" "-" "-"'
    expect(isActionableErrorLog(msg)).toBe(true)
    const row = buildDockerLogErrorRow(
      { time: '2026-06-30T13:14:18.000Z', stream: 'stdout', log: msg },
      'dashboard-shell'
    )
    expect(row?.status_code).toBe(500)
  })

  test('real failures stay actionable including 5xx connection refused timeout and exception', () => {
    const cases = [
      'upstream connection refused while proxying request status 502',
      'request failed: ETIMEDOUT after 30000ms',
      'ERROR: database query failed with exception',
      'Traceback (most recent call last): ValueError',
      'CRITICAL: worker crashed',
    ]
    for (const msg of cases) {
      expect(isActionableErrorLog(msg), msg).toBe(true)
    }
  })

  test('classifies connection failures and 5xx as error severity', () => {
    const msg = 'upstream connection refused while proxying request status 502'
    expect(isActionableErrorLog(msg)).toBe(true)
    expect(inferLogLevel(msg)).toBe('error')
  })

  test('redis cache wait fallback warning is not an actionable error', () => {
    const msg =
      '[report-service] WARN: timed out waiting for Redis cache refresh for usage-quota-range-history:abc123; falling back to SQL.'
    expect(isActionableErrorLog(msg)).toBe(false)
    expect(
      buildDockerLogErrorRow(
        { time: '2026-06-30T02:42:03.000Z', stream: 'stderr', log: msg },
        'dashboard-shell-reports-dev'
      )
    ).toBeNull()
  })

  test('inferLogProvider avoids substring false positives and keeps expected provider hits', () => {
    expect(inferLogProvider('OpenAI GPT-4 request failed')).toBe('openai')
    expect(inferLogProvider('Anthropic Claude fallback for tool')).toBe(
      'anthropic'
    )
    expect(inferLogProvider('OpenRouter model route')).toBe('openrouter')
    expect(inferLogProvider('Google Gemini returned code')).toBe('google')
    expect(inferLogProvider('xAI/Grok quota exceeded')).toBe('xai')
    expect(inferLogProvider('NVIDIA NIM service returned error')).toBe(
      'nvidia_nim'
    )
    expect(inferLogProvider('local model serving failure')).toBe('local')
    expect(
      inferLogProvider('local model failed at http://localhost:11434/v1')
    ).toBe('local')
    expect(inferLogProvider('minimum latency threshold reached')).toBe(
      'unknown'
    )
    expect(inferLogProvider('http://localhost:11434/v1')).toBe('unknown')
  })

  test('container wrapper skips redis cache wait fallback warning', async () => {
    const intakeDir = await mkdtemp(path.join(os.tmpdir(), 'd1-437-wrapper-'))
    tmpDirs.push(intakeDir)
    const msg =
      '[report-service] WARN: timed out waiting for Redis cache refresh for usage-v2:abc123; falling back to SQL.'

    await execFileAsync(
      'sh',
      [
        path.resolve('scripts/container-error-intake.sh'),
        'sh',
        '-c',
        `printf '%s\\n' "${msg}" >&2`,
      ],
      {
        env: {
          ...process.env,
          SHELL_CONTAINER_NAME: 'dashboard-shell-reports-dev',
          SHELL_CONTAINER_ERROR_INTAKE_DIR: intakeDir,
        },
      }
    )

    await expect(readdir(intakeDir)).resolves.toEqual([])
  })

  test('container wrapper records an actionable stdout line with required JSONL fields', async () => {
    const intakeDir = await mkdtemp(
      path.join(os.tmpdir(), 'd1-445-wrapper-actionable-')
    )
    tmpDirs.push(intakeDir)
    const containerName = 'dashboard-shell-reports-dev'
    const msg =
      'ERROR: upstream gateway returned status 502 for deterministic wrapper smoke check'

    await execFileAsync(
      'sh',
      [
        path.resolve('scripts/container-error-intake.sh'),
        'sh',
        '-c',
        'printf "%s\\n" "$WRAPPER_MESSAGE"',
      ],
      {
        env: {
          ...process.env,
          SHELL_CONTAINER_NAME: containerName,
          SHELL_CONTAINER_ERROR_INTAKE_DIR: intakeDir,
          WRAPPER_MESSAGE: msg,
        },
      }
    )

    const filePath = path.join(
      intakeDir,
      `${safeContainerErrorIntakeBasename(containerName)}-error.jsonl`
    )
    const text = await readFile(filePath, 'utf8')
    const rowLines = text.trim().split('\n').filter(Boolean)
    expect(rowLines).toHaveLength(1)
    const row = JSON.parse(rowLines[0])

    expect(row.fingerprint).toEqual(expect.any(String))
    expect(row.fingerprint).toBeTruthy()
    expect(row.status_code).toBe(502)
    expect(row.level).toBe('error')
    expect(row.container).toBe(containerName)
    expect(row.stream).toBe('stdout')
    expect(row.message).toContain('upstream gateway returned status 502')
  })

  test('container wrapper records actionable stderr with JSON-escaped fields', async () => {
    const intakeDir = await mkdtemp(
      path.join(os.tmpdir(), 'd1-445-wrapper-json-')
    )
    tmpDirs.push(intakeDir)
    const containerName = 'dashboard-shell-reports-"weird"-wrapper\\test'
    const msg = `ERROR: \u001b[31mupstream provider failure status 502\u001b[0m with "quoted" payload at path C:\\tmp\\app, tab\t bell\u0007 and end marker`

    await execFileAsync(
      'sh',
      [
        path.resolve('scripts/container-error-intake.sh'),
        'sh',
        '-c',
        'printf "%s" "$WRAPPER_MESSAGE" >&2',
      ],
      {
        env: {
          ...process.env,
          SHELL_CONTAINER_NAME: containerName,
          SHELL_CONTAINER_ERROR_INTAKE_DIR: intakeDir,
          WRAPPER_MESSAGE: msg,
        },
      }
    )

    const filePath = path.join(
      intakeDir,
      `${safeContainerErrorIntakeBasename(containerName)}-error.jsonl`
    )
    const text = await readFile(filePath, 'utf8')
    const rows = text.trim().split('\n')
    expect(rows).toHaveLength(1)
    const row = JSON.parse(rows[0])

    expect(row.container).toBe(containerName)
    expect(row.stream).toBe('stderr')
    expect(row.level).toBe('error')
    expect(row.status_code).toBe(502)
    expect(row.provider).toBe('unknown')
    expect(row.source_identity).toBe('container-self-log')
    expect(row.source_path).toBe(null)
    expect(row.message).toContain('ERROR: upstream provider failure status 502')
    expect(row.message).toContain('"quoted"')
    expect(row.message).toContain('C:\\tmp\\app')
    expect(row.message).not.toContain('\t')
    expect(row.message).not.toContain('\u001b')
    expect(row.message).not.toContain('\u0007')
    expect(row.message).toContain('tab bell and end marker')
    expect(typeof row.fingerprint).toBe('string')
    expect(row.fingerprint).toBeTruthy()
    expect(row.observed_at).toMatch(/\d{4}-\d{2}-\d{2}T/)
    expect(row.ingested_at).toMatch(/\d{4}-\d{2}-\d{2}T/)
    expect(row.ingested_at).toBe(row.observed_at)
  })

  test('container wrapper ignores adjacent status-like digits while preserving contextual 502', async () => {
    const intakeDir = await mkdtemp(
      path.join(os.tmpdir(), 'd1-445-wrapper-status-')
    )
    tmpDirs.push(intakeDir)
    const msgNoStatusOne =
      'ERROR: response 4123 bytes from D1-424 while listening on http://127.0.0.1:5020/api'
    const msgNoStatusTwo = 'ERROR: upstream returned 5023 bytes'
    const msgStatus = 'ERROR: upstream gateway failure 502'

    await execFileAsync(
      'sh',
      [
        path.resolve('scripts/container-error-intake.sh'),
        'sh',
        '-c',
        'printf "%s\\n%s\\n%s\\n" "$WRAPPER_MSG_NO_STATUS_ONE" "$WRAPPER_MSG_NO_STATUS_TWO" "$WRAPPER_MSG_STATUS" >&2',
      ],
      {
        env: {
          ...process.env,
          SHELL_CONTAINER_NAME: 'dashboard-shell-reports-dev',
          SHELL_CONTAINER_ERROR_INTAKE_DIR: intakeDir,
          WRAPPER_MSG_NO_STATUS_ONE: msgNoStatusOne,
          WRAPPER_MSG_NO_STATUS_TWO: msgNoStatusTwo,
          WRAPPER_MSG_STATUS: msgStatus,
        },
      }
    )

    const filePath = path.join(
      intakeDir,
      'dashboard-shell-reports-dev-error.jsonl'
    )
    const text = await readFile(filePath, 'utf8')
    const rows = text
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line))
    expect(rows).toHaveLength(3)
    expect(rows[0].status_code).toBe(null)
    expect(rows[0].message).toContain(msgNoStatusOne)
    expect(rows[1].status_code).toBe(null)
    expect(rows[1].message).toContain(msgNoStatusTwo)
    expect(rows[2].status_code).toBe(502)
    expect(rows[2].message).toContain(msgStatus)
  })

  test('container wrapper dedupes duplicate actionable lines in the bounded local tail', async () => {
    const intakeDir = await mkdtemp(
      path.join(os.tmpdir(), 'd1-445-wrapper-duplicates-')
    )
    tmpDirs.push(intakeDir)
    const msg = 'ERROR: repeated actionable status 502 test line'

    const runWrapper = () =>
      execFileAsync(
        'sh',
        [
          path.resolve('scripts/container-error-intake.sh'),
          'sh',
          '-c',
          'printf "%s\\n%s\\n" "$WRAPPER_MSG" "$WRAPPER_MSG" >&2',
        ],
        {
          env: {
            ...process.env,
            SHELL_CONTAINER_NAME: 'dashboard-shell-reports-dev',
            SHELL_CONTAINER_ERROR_INTAKE_DIR: intakeDir,
            WRAPPER_MSG: msg,
          },
        }
      )

    await runWrapper()
    await new Promise((resolve) => setTimeout(resolve, 1100))
    await runWrapper()

    const filePath = path.join(
      intakeDir,
      'dashboard-shell-reports-dev-error.jsonl'
    )
    const text = await readFile(filePath, 'utf8')
    const rows = text.trim().split('\n')
    expect(rows).toHaveLength(1)
    const parsedRows = rows.map((row) => JSON.parse(row))
    expect(parsedRows[0].message).toContain(msg)
  })

  test('acquireIntakeFileLock uses stale-lock rename cleanup instead of removing lock path', async () => {
    const filePath = '/tmp/d1-445-stale-lock.jsonl'
    const lockDir = `${filePath}.intake.lock`
    let lockExists = true
    let staleTarget = null
    let staleExists = false
    const mkdirCalls = []
    const rmCalls = []
    const renameCalls = []

    const mkdirFn = vi.fn(async (dir) => {
      mkdirCalls.push(dir)
      if (dir !== lockDir) return
      if (!lockExists) {
        lockExists = true
        return
      }
      const error = new Error('lock exists')
      error.code = 'EEXIST'
      throw error
    })

    const statFn = vi.fn(async () => ({ mtimeMs: 1 }))

    const renameFn = vi.fn(async (source, target) => {
      renameCalls.push([source, target])
      if (!lockExists || source !== lockDir) {
        const error = new Error('missing lock')
        error.code = 'ENOENT'
        throw error
      }
      lockExists = false
      staleTarget = target
      staleExists = true
    })

    const rmFn = vi.fn(async (target) => {
      rmCalls.push(target)
      if (target === staleTarget && staleExists) {
        staleExists = false
        return
      }
      if (target === lockDir && lockExists) {
        const error = new Error('fresh lock removed during cleanup')
        error.code = 'EWOULDBLOCK'
        throw error
      }
    })

    const { release } = await acquireIntakeFileLock(filePath, {
      maxWaitMs: 1_000,
      pollMs: 1,
      staleLockMs: 0,
      mkdirFn,
      statFn,
      renameFn,
      rmFn,
    })

    await release()

    expect(renameCalls).toHaveLength(1)
    expect(rmCalls[0]).toBe(staleTarget)
    expect(rmCalls).toContain(lockDir)
    expect(staleTarget).not.toBeNull()
    expect(staleTarget).toContain('.stale.')
    expect(mkdirCalls).toContain(lockDir)
    expect(
      rmCalls.filter((target) => target.startsWith(`${lockDir}.stale.`)).length
    ).toBe(1)
  })

  test('acquireIntakeFileLock does not rename a fresh lock after stale stat changes', async () => {
    const filePath = '/tmp/d1-445-fresh-lock.jsonl'
    const lockDir = `${filePath}.intake.lock`
    let mkdirAttempts = 0
    const oldStat = { mtimeMs: 1, ctimeMs: 1, dev: 1, ino: 10 }
    const freshStat = {
      mtimeMs: Date.now(),
      ctimeMs: Date.now(),
      dev: 1,
      ino: 11,
    }
    const renameFn = vi.fn()
    const rmFn = vi.fn()
    const statFn = vi
      .fn()
      .mockResolvedValueOnce(oldStat)
      .mockResolvedValueOnce(freshStat)

    const mkdirFn = vi.fn(async (dir) => {
      expect(dir).toBe(lockDir)
      mkdirAttempts += 1
      if (mkdirAttempts === 1) {
        const error = new Error('lock exists')
        error.code = 'EEXIST'
        throw error
      }
    })

    const { release } = await acquireIntakeFileLock(filePath, {
      maxWaitMs: 1_000,
      pollMs: 1,
      staleLockMs: 0,
      mkdirFn,
      statFn,
      renameFn,
      rmFn,
    })

    await release()

    expect(statFn).toHaveBeenCalledTimes(2)
    expect(renameFn).not.toHaveBeenCalled()
    expect(rmFn).toHaveBeenCalledWith(lockDir, { recursive: true, force: true })
  })

  test('status extraction ignores decimal timestamps package counts and bare port numbers', () => {
    const falsePositives = [
      '2026-06-28 21:31:54.557 upstream healthy',
      'added 537 packages in 12s',
      'audited 538 packages in 2s',
      'listening on http://127.0.0.1:5020/api',
      'connected to postgres://db:5432/main',
      'D1-424 reopened for per-container intake',
      'ERROR: D1-424 reopened without an HTTP status',
    ]
    for (const msg of falsePositives) {
      const row = buildDockerLogErrorRow(
        { time: '2026-06-28T21:31:54.000Z', stream: 'stdout', log: msg },
        'dashboard-shell-dev'
      )
      expect(row?.status_code ?? null, msg).toBeNull()
    }
  })

  test('status extraction keeps actionable HTTP and token-delimited error codes', () => {
    const cases = [
      ['upstream returned status 502 while proxying', 502],
      ['HTTP 503 from provider', 503],
      ['ERROR: D1-424 per-container smoke status 502', 502],
      ['request failed with HTTP/1.1 404 and status 502', 502],
      ['ERROR upstream gateway failure 502', 502],
    ]
    for (const [msg, expected] of cases) {
      const row = buildDockerLogErrorRow(
        { time: '2026-06-28T21:26:28.000Z', stream: 'stderr', log: msg },
        'dashboard-shell-dev'
      )
      expect(row?.status_code, msg).toBe(expected)
    }
  })

  test('status extraction prefers real 5xx when issue ids contain 4xx-looking tokens', () => {
    const msg = 'ERROR: D1-424 per-container smoke status 502'
    const row = buildDockerLogErrorRow(
      {
        time: '2026-06-28T21:26:28.000Z',
        stream: 'stderr',
        log: msg,
      },
      'dashboard-shell-dev'
    )
    expect(row?.status_code).toBe(502)
  })

  test('dependency audit summaries and routine shutdown logs are not actionable errors', () => {
    const falsePositives = [
      'added 537 packages, and audited 538 packages in 20s',
      '27 vulnerabilities (5 low, 13 moderate, 7 high, 2 critical)',
      '14:M 28 Jun 2026 21:31:54.557 * User requested shutdown...',
      '14:M 28 Jun 2026 21:31:54.557 # Redis is now ready to exit, bye bye...',
    ]

    for (const msg of falsePositives) {
      expect(isActionableErrorLog(msg), msg).toBe(false)
      expect(
        buildDockerLogErrorRow(
          { time: '2026-06-28T21:31:54.000Z', stream: 'stdout', log: msg },
          'dashboard-shell-dev'
        ),
        msg
      ).toBeNull()
    }
  })

  test('selects unseen rows without mutating seen until append commits', () => {
    const tail = `${JSON.stringify({
      time: new Date().toISOString(),
      stream: 'stderr',
      log: 'ERROR: database query failed with exception',
    })}\n`
    const cutoff = Date.now() - 60_000
    const first = extractDockerLogErrorsFromTail({
      tailText: tail,
      container: 'dashboard-shell-reports-dev',
      cutoffMs: cutoff,
      source: { sourceIdentity: 'docker-json-log' },
    })
    expect(first).toHaveLength(1)

    const seen = new Set()
    const freshOnce = selectNewDockerLogErrors(first, seen)
    const freshTwice = selectNewDockerLogErrors(first, seen)
    expect(freshOnce).toHaveLength(1)
    expect(freshTwice).toHaveLength(1)
    expect(seen.size).toBe(0)
    expect(buildDockerLogErrorFingerprint(first[0])).toBe(first[0].fingerprint)
  })

  test('appends one jsonl row per container and commits fingerprints after success', async () => {
    const intakeDir = await mkdtemp(path.join(os.tmpdir(), 'd1-424-intake-'))
    tmpDirs.push(intakeDir)
    const row = {
      observed_at: '2026-06-28T18:41:00.000Z',
      container: 'dashboard-shell-reports-dev',
      stream: 'stderr',
      provider: 'unknown',
      status_code: 500,
      level: 'error',
      message: 'synthetic container failure for intake test',
      source_identity: 'test',
      source_path: null,
      fingerprint: 'abc123',
    }

    const seen = new Set()
    await appendDockerLogErrorsToIntake({
      intakeDir,
      rows: selectNewDockerLogErrors([row], seen),
      seenFingerprints: seen,
    })
    await appendDockerLogErrorsToIntake({
      intakeDir,
      rows: selectNewDockerLogErrors([row], seen),
      seenFingerprints: seen,
    })

    const filePath = path.join(
      intakeDir,
      `${safeContainerErrorIntakeBasename(row.container)}-error.jsonl`
    )
    const text = await readFile(filePath, 'utf8')
    expect(text.trim().split('\n')).toHaveLength(1)
    const parsed = JSON.parse(text.trim())
    expect(parsed.container).toBe(row.container)
    expect(parsed.fingerprint).toBeTruthy()
    expect(parsed.level).toBe('error')
    expect(seen.has(row.fingerprint)).toBe(true)
  })

  test('dashboard cap slices payload without dropping extra intake candidates', () => {
    const rows = Array.from({ length: 5 }, (_, index) => ({
      observed_at: `2026-06-28T18:4${index}:00.000Z`,
      container: 'dashboard-shell-reports-dev',
      stream: 'stderr',
      level: 'error',
      message: `failure ${index}`,
      fingerprint: `fp-${index}`,
    }))

    const capped = capDockerLogErrorsForDashboard(rows, 2)
    expect(capped).toHaveLength(2)
    expect(capped.map((row) => row.fingerprint)).toEqual(['fp-0', 'fp-1'])
    expect(rows).toHaveLength(5)
  })

  test('matches dev containers by exact Docker Name', () => {
    const config = {
      Name: '/dashboard-shell-reports-dev',
      Config: {
        Labels: { 'com.docker.compose.service': 'dashboard-shell-reports-dev' },
      },
    }
    const result = matchDockerJsonLogContainer(config, [
      'dashboard-shell-reports-dev',
    ])
    expect(result).toEqual({
      matched: true,
      container: 'dashboard-shell-reports-dev',
      matchKind: 'exact',
    })
  })

  test('matches prod-style compose containers via service and repo project markers', () => {
    const config = {
      Name: '/dashboard-shell-dashboard-shell-reports-1',
      Config: {
        Labels: {
          'com.docker.compose.service': 'dashboard-shell-reports',
          'com.docker.compose.project': 'dashboard-shell',
          'com.docker.compose.project.working_dir':
            '/home/zepfu/projects/dashboard-shell',
          'com.docker.compose.project.config_files':
            '/home/zepfu/projects/dashboard-shell/docker-compose.yml',
        },
      },
    }
    const result = matchDockerJsonLogContainer(config, [
      'dashboard-shell-reports',
    ])
    expect(result.matched).toBe(true)
    expect(result.matchKind).toBe('compose')
    expect(result.container).toBe('dashboard-shell-dashboard-shell-reports-1')
  })

  test('compose project matching supports override markers for renamed checkouts', () => {
    const config = {
      Name: '/dashboard-shell-aawm-dashboard-1',
      Config: {
        Labels: {
          'com.docker.compose.service': 'aawm-dashboard',
          'com.docker.compose.project': 'renamed-dashboard-shell',
          'com.docker.compose.project.working_dir':
            '/srv/renamed-dashboard-shell',
          'com.docker.compose.project.config_files':
            '/srv/renamed-dashboard-shell/docker-compose.yml',
        },
      },
    }
    const defaultMatch = matchDockerJsonLogContainer(
      config,
      ['aawm-dashboard'],
      {
        repoComposeProjectMarkers: resolveRepoComposeProjectMarkers({
          SHELL_REPORT_DOCKER_COMPOSE_PROJECT_MARKERS:
            'dashboard-shell/docker-compose',
        }),
      }
    )
    expect(defaultMatch).toEqual({
      matched: false,
      container: null,
      matchKind: null,
    })

    const overrideMatch = matchDockerJsonLogContainer(
      config,
      ['aawm-dashboard'],
      {
        repoComposeProjectMarkers: resolveRepoComposeProjectMarkers({
          SHELL_REPORT_DOCKER_COMPOSE_PROJECT_MARKERS:
            '/srv/renamed-dashboard-shell',
        }),
      }
    )
    expect(overrideMatch).toMatchObject({
      matched: true,
      matchKind: 'compose',
      container: 'dashboard-shell-aawm-dashboard-1',
    })
  })

  test('rejects same compose service from a different project path', () => {
    const config = {
      Name: '/otherproj-dashboard-shell-reports-1',
      Config: {
        Labels: {
          'com.docker.compose.service': 'dashboard-shell-reports',
          'com.docker.compose.project': 'otherproj',
          'com.docker.compose.project.working_dir':
            '/home/zepfu/projects/other-repo',
          'com.docker.compose.project.config_files':
            '/home/zepfu/projects/other-repo/docker-compose.yml',
        },
      },
    }
    const result = matchDockerJsonLogContainer(config, [
      'dashboard-shell-reports',
    ])
    expect(result).toEqual({ matched: false, container: null, matchKind: null })
  })

  test('discover helper finds prod compose label match and builds json log path', () => {
    const sources = discoverDockerJsonLogSourcesFromConfigs(
      [
        {
          containerDir: '/host/docker/containers/abc123',
          entryId: 'abc123',
          config: {
            Name: '/dashboard-shell-aawm-dashboard-1',
            Config: {
              Labels: {
                'com.docker.compose.service': 'aawm-dashboard',
                'com.docker.compose.project.working_dir':
                  '/home/zepfu/projects/dashboard-shell',
              },
            },
          },
        },
      ],
      ['aawm-dashboard']
    )
    expect(sources).toHaveLength(1)
    expect(sources[0].container).toBe('dashboard-shell-aawm-dashboard-1')
    expect(sources[0].logPath).toBe(
      '/host/docker/containers/abc123/abc123-json.log'
    )
    expect(sources[0].matchKind).toBe('compose')
  })

  test('dashboard row cap zero still leaves full sorted set for intake selection', () => {
    const rows = Array.from({ length: 3 }, (_, index) => ({
      observed_at: `2026-06-28T18:4${index}:00.000Z`,
      container: 'dashboard-shell-reports',
      stream: 'stderr',
      level: 'error',
      message: `failure ${index}`,
      fingerprint: `cap0-${index}`,
    }))
    const split = splitDockerLogErrorsForDashboardAndIntake(rows, 0)
    expect(split.forDashboard).toEqual([])
    expect(split.forIntake).toHaveLength(3)

    const seen = new Set()
    const fresh = selectNewDockerLogErrors(split.forIntake, seen)
    expect(fresh).toHaveLength(3)
    expect(
      shouldDiscoverDockerJsonLogSources(['dashboard-shell-reports'])
    ).toBe(true)
  })

  test('existing JSONL fingerprint suppresses append and marks seen', async () => {
    const intakeDir = await mkdtemp(path.join(os.tmpdir(), 'd1-424-persist-'))
    tmpDirs.push(intakeDir)
    const row = {
      observed_at: '2026-06-28T18:41:00.000Z',
      container: 'unknown-upstream',
      stream: 'stderr',
      provider: 'openai',
      status_code: 500,
      level: 'error',
      message: 'duplicate smoke failure line',
      source_identity: 'test',
      source_path: null,
    }
    row.fingerprint = buildDockerLogErrorFingerprint(row)

    const filePath = path.join(
      intakeDir,
      `${safeContainerErrorIntakeBasename(row.container)}-error.jsonl`
    )
    await appendFile(
      filePath,
      `${JSON.stringify({ ...row, ingested_at: '2026-06-28T18:00:00.000Z' })}\n`,
      'utf8'
    )

    const seen = new Set()
    const result = await appendDockerLogErrorsToIntake({
      intakeDir,
      rows: [row],
      seenFingerprints: seen,
    })

    expect(result.appended).toBe(0)
    expect(result.skipped).toBe(1)
    expect(seen.has(row.fingerprint)).toBe(true)
    const text = await readFile(filePath, 'utf8')
    expect(text.trim().split('\n')).toHaveLength(1)
  })

  test('mixed existing and new rows appends only the new row once', async () => {
    const intakeDir = await mkdtemp(path.join(os.tmpdir(), 'd1-424-mixed-'))
    tmpDirs.push(intakeDir)
    const existing = {
      observed_at: '2026-06-28T18:41:00.000Z',
      container: 'unknown-upstream',
      stream: 'stderr',
      provider: 'openai',
      status_code: 502,
      level: 'error',
      message: 'already on disk',
      source_identity: 'test',
      source_path: null,
    }
    existing.fingerprint = buildDockerLogErrorFingerprint(existing)

    const fresh = {
      observed_at: '2026-06-28T18:42:00.000Z',
      container: 'unknown-upstream',
      stream: 'stderr',
      provider: 'openai',
      status_code: 503,
      level: 'error',
      message: 'brand new failure',
      source_identity: 'test',
      source_path: null,
    }
    fresh.fingerprint = buildDockerLogErrorFingerprint(fresh)

    const filePath = path.join(
      intakeDir,
      `${safeContainerErrorIntakeBasename(existing.container)}-error.jsonl`
    )
    await appendFile(
      filePath,
      `${JSON.stringify({ ...existing, ingested_at: '2026-06-28T18:00:00.000Z' })}\n`,
      'utf8'
    )

    const seen = new Set()
    const result = await appendDockerLogErrorsToIntake({
      intakeDir,
      rows: [existing, fresh],
      seenFingerprints: seen,
    })

    expect(result.appended).toBe(1)
    expect(result.skipped).toBe(1)
    expect(seen.has(existing.fingerprint)).toBe(true)
    expect(seen.has(fresh.fingerprint)).toBe(true)

    const lines = (await readFile(filePath, 'utf8')).trim().split('\n')
    expect(lines).toHaveLength(2)
    const fps = lines.map((line) => JSON.parse(line).fingerprint)
    expect(fps).toContain(existing.fingerprint)
    expect(fps).toContain(fresh.fingerprint)
  })

  test('loadPersistedDockerLogErrorFingerprintsFromJsonl reads stored fingerprints', async () => {
    const intakeDir = await mkdtemp(path.join(os.tmpdir(), 'd1-424-load-'))
    tmpDirs.push(intakeDir)
    const filePath = path.join(intakeDir, 'unknown-upstream-error.jsonl')
    await appendFile(
      filePath,
      `${JSON.stringify({
        fingerprint: 'stored-fp-1',
        message: 'x',
        container: 'unknown-upstream',
      })}\n`,
      'utf8'
    )
    const set = await loadPersistedDockerLogErrorFingerprintsFromJsonl(filePath)
    expect(set.has('stored-fp-1')).toBe(true)
  })

  test('loadPersistedDockerLogErrorFingerprintsFromJsonl uses tail-size and line caps', async () => {
    const intakeDir = await mkdtemp(
      path.join(os.tmpdir(), 'd1-445-load-bounded-')
    )
    tmpDirs.push(intakeDir)
    const filePath = path.join(intakeDir, 'unknown-upstream-error.jsonl')

    const old = {
      observed_at: '2026-06-28T18:00:00.000Z',
      container: 'unknown-upstream',
      stream: 'stderr',
      level: 'error',
      status_code: 500,
      provider: 'openai',
      message: `legacy-${'x'.repeat(1_200)}`,
    }
    const firstRecent = {
      observed_at: '2026-06-28T18:01:00.000Z',
      container: 'unknown-upstream',
      stream: 'stderr',
      level: 'error',
      status_code: 502,
      provider: 'openai',
      message: 'recent-a',
    }
    const secondRecent = {
      observed_at: '2026-06-28T18:02:00.000Z',
      container: 'unknown-upstream',
      stream: 'stderr',
      level: 'error',
      status_code: 503,
      provider: 'openai',
      message: 'recent-b',
    }
    old.fingerprint = buildDockerLogErrorFingerprint(old)
    firstRecent.fingerprint = buildDockerLogErrorFingerprint(firstRecent)
    secondRecent.fingerprint = buildDockerLogErrorFingerprint(secondRecent)

    const oldLine = `${JSON.stringify({
      ...old,
      ingested_at: '2026-06-28T18:00:00.000Z',
    })}\n`
    const firstRecentLine = `${JSON.stringify({
      ...firstRecent,
      ingested_at: '2026-06-28T18:01:00.000Z',
    })}\n`
    const secondRecentLine = `${JSON.stringify({
      ...secondRecent,
      ingested_at: '2026-06-28T18:02:00.000Z',
    })}\n`
    const readWindowBytes = Buffer.byteLength(
      firstRecentLine + secondRecentLine
    )

    await appendFile(
      filePath,
      `${oldLine}${firstRecentLine}${secondRecentLine}`,
      'utf8'
    )
    const set = await loadPersistedDockerLogErrorFingerprintsFromJsonl(
      filePath,
      {
        maxBytes: readWindowBytes,
        maxLines: 2,
      }
    )

    expect(set.has(old.fingerprint)).toBe(false)
    expect(set.has(firstRecent.fingerprint)).toBe(true)
    expect(set.has(secondRecent.fingerprint)).toBe(true)
    expect(set.size).toBe(2)
  })

  test('append failure does not poison dedupe so retry can succeed', async () => {
    const intakeDir = await mkdtemp(
      path.join(os.tmpdir(), 'd1-424-intake-retry-')
    )
    tmpDirs.push(intakeDir)
    const row = {
      observed_at: '2026-06-28T18:41:00.000Z',
      container: 'dashboard-shell-reports-dev',
      stream: 'stderr',
      provider: 'unknown',
      status_code: 500,
      level: 'error',
      message: 'transient append failure should remain retryable',
      source_identity: 'test',
      source_path: null,
      fingerprint: 'retry-fp',
    }

    const seen = new Set()
    let appendAttempts = 0
    const failingAppend = async (...args) => {
      appendAttempts += 1
      if (appendAttempts === 1) {
        throw new Error('disk full')
      }
      return appendFile(...args)
    }

    await expect(
      appendDockerLogErrorsToIntake({
        intakeDir,
        rows: selectNewDockerLogErrors([row], seen),
        seenFingerprints: seen,
        appendFileFn: failingAppend,
      })
    ).rejects.toThrow('disk full')

    expect(seen.size).toBe(0)

    await appendDockerLogErrorsToIntake({
      intakeDir,
      rows: selectNewDockerLogErrors([row], seen),
      seenFingerprints: seen,
      appendFileFn: failingAppend,
    })

    expect(seen.has(row.fingerprint)).toBe(true)
    const filePath = path.join(
      intakeDir,
      `${safeContainerErrorIntakeBasename(row.container)}-error.jsonl`
    )
    const text = await readFile(filePath, 'utf8')
    expect(text.trim().split('\n')).toHaveLength(1)
  })

  test('repo-owned helper matches generated compose container names', () => {
    expect(
      isRepoOwnedDockerLogContainerName(
        'dashboard-shell-dashboard-shell-reports-1'
      )
    ).toBe(true)
    expect(
      isRepoOwnedDockerLogContainerName('dashboard-shell-aawm-dashboard-1')
    ).toBe(true)
    expect(
      isRepoOwnedDockerLogContainerName('dashboard-shell-aawm-litellm-1')
    ).toBe(false)
    expect(
      isRepoOwnedDockerLogContainerName('otherproj-aawm-dashboard-1')
    ).toBe(false)
  })

  test('repo-owned and external container rows are excluded from centralized report-service intake', () => {
    const rows = [
      {
        container: 'dashboard-shell-reports-dev',
        message: 'ERROR: synthetic',
        fingerprint: 'repo-1',
      },
      {
        container: 'dashboard-shell-dashboard-shell-reports-1',
        message: 'ERROR: prod report service',
        fingerprint: 'repo-prod-1',
      },
      {
        container: 'dashboard-shell-aawm-dashboard-1',
        message: 'ERROR: prod remote',
        fingerprint: 'repo-prod-2',
      },
      {
        container: 'aawm-litellm',
        message: 'ERROR: external',
        fingerprint: 'ext-1',
      },
      {
        container: 'litellm-dev',
        message: 'ERROR: external dev',
        fingerprint: 'ext-2',
      },
      {
        container: 'other-thing',
        message: 'ERROR: other',
        fingerprint: 'oth-1',
      },
    ]
    const filtered = filterDockerLogErrorsForCentralizedIntake(rows, {
      env: {
        SHELL_REPORT_DOCKER_LOG_EXTERNAL_CONTAINERS: 'aawm-litellm,litellm-dev',
      },
    })
    expect(filtered.map((r) => r.container)).toEqual(['other-thing'])
    expect(isRepoOwnedDockerLogContainerName('dashboard-shell-redis')).toBe(
      true
    )
    expect(isRepoOwnedDockerLogContainerName('aawm-litellm')).toBe(false)
  })

  test('external container rows remain eligible for dashboard payload but not JSONL intake', async () => {
    const intakeDir = await mkdtemp(path.join(os.tmpdir(), 'd1-443-external-'))
    tmpDirs.push(intakeDir)
    const externalRow = {
      observed_at: '2026-06-28T18:41:00.000Z',
      container: 'aawm-litellm',
      stream: 'stderr',
      provider: 'openai',
      status_code: 500,
      level: 'error',
      message: 'upstream provider failure',
      source_identity: 'docker-json-log',
      source_path: '/host/docker/containers/abc/abc-json.log',
      fingerprint: 'ext-alert-only',
    }
    const unknownRow = {
      observed_at: '2026-06-28T18:42:00.000Z',
      container: 'mystery-service',
      stream: 'stderr',
      provider: 'unknown',
      status_code: 502,
      level: 'error',
      message: 'unknown container failure',
      source_identity: 'docker-json-log',
      source_path: '/host/docker/containers/def/def-json.log',
      fingerprint: 'unknown-intake',
    }
    const sorted = [externalRow, unknownRow].sort((a, b) =>
      String(b.observed_at).localeCompare(String(a.observed_at))
    )
    const split = splitDockerLogErrorsForDashboardAndIntake(sorted, 10)
    expect(split.forDashboard.map((r) => r.container)).toEqual([
      'mystery-service',
      'aawm-litellm',
    ])
    const forIntake = filterDockerLogErrorsForCentralizedIntake(
      split.forIntake,
      {
        env: {
          SHELL_REPORT_DOCKER_LOG_EXTERNAL_CONTAINERS:
            'aawm-litellm,litellm-dev',
        },
      }
    )
    expect(forIntake.map((r) => r.container)).toEqual(['mystery-service'])

    const seen = new Set()
    const result = await appendDockerLogErrorsToIntake({
      intakeDir,
      rows: selectNewDockerLogErrors(forIntake, seen),
      seenFingerprints: seen,
    })
    expect(result.appended).toBe(1)
    await expect(readdir(intakeDir)).resolves.toEqual([
      'mystery-service-error.jsonl',
    ])
    await expect(
      readFile(path.join(intakeDir, 'aawm-litellm-error.jsonl'), 'utf8')
    ).rejects.toMatchObject({ code: 'ENOENT' })
  })
})
