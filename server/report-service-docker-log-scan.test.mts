import { appendFile, mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, test, vi } from 'vitest'

const envSnapshot = { ...process.env }

afterEach(() => {
  vi.useRealTimers()
  process.env = { ...envSnapshot }
  vi.resetModules()
  vi.unstubAllEnvs()
})

describe('D1-445 docker log scan performance helpers', () => {
  test('capDockerJsonLogSourcesForScan limits source count and total tail bytes', async () => {
    const { __dockerLogScanTestHelpers } = await import('./report-service.mjs')
    const { capDockerJsonLogSourcesForScan } = __dockerLogScanTestHelpers

    const sources = Array.from({ length: 10 }, (_, index) => ({
      container: `c-${index}`,
      logPath: `/tmp/c-${index}-json.log`,
    }))

    const capped = capDockerJsonLogSourcesForScan(sources, {
      maxSources: 3,
      maxTotalBytes: 5_000,
      perFileTailBytes: 4_000,
    })

    expect(capped).toHaveLength(2)
    expect(capped[0].tailBytes).toBe(4000)
    expect(capped[1].tailBytes).toBe(1000)
  })

  test('dockerLogErrorIntakeSeenFingerprints stays bounded at configured max', async () => {
    vi.stubEnv('SHELL_REPORT_DOCKER_LOG_INTAKE_FINGERPRINT_MAX', '256')
    const { __dockerLogScanTestHelpers } = await import('./report-service.mjs')
    const {
      resetDockerLogErrorIntakeSeenFingerprintsForTests,
      seedDockerLogErrorIntakeFingerprintsForTests,
      dockerLogErrorIntakeSeenFingerprintsSizeForTests,
      DOCKER_LOG_INTAKE_FINGERPRINT_MAX,
    } = __dockerLogScanTestHelpers

    expect(DOCKER_LOG_INTAKE_FINGERPRINT_MAX).toBe(256)
    resetDockerLogErrorIntakeSeenFingerprintsForTests()
    seedDockerLogErrorIntakeFingerprintsForTests(
      Array.from({ length: 300 }, (_, index) => `fp-${index}`)
    )
    expect(dockerLogErrorIntakeSeenFingerprintsSizeForTests()).toBe(256)
  })

  test('loadDockerLogErrors reuses in-process scan cache within TTL', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'd1-444-docker-'))
    const entryId = 'abc123'
    const containerDir = path.join(root, entryId)
    await mkdir(containerDir, { recursive: true })
    await writeFile(
      path.join(containerDir, 'config.v2.json'),
      JSON.stringify({ Name: '/dashboard-shell-dev' }),
      'utf8'
    )
    const logLine = JSON.stringify({
      time: new Date().toISOString(),
      stream: 'stderr',
      log: 'upstream connection refused while proxying request status 502',
    })
    await writeFile(path.join(containerDir, `${entryId}-json.log`), `${logLine}\n`, 'utf8')

    vi.stubEnv('SHELL_REPORT_DOCKER_LOG_ROOT', root)
    vi.stubEnv('SHELL_REPORT_DOCKER_LOG_CONTAINERS', 'dashboard-shell-dev')
    vi.stubEnv('SHELL_REPORT_DOCKER_LOG_SCAN_CACHE_TTL_MS', '60000')
    vi.stubEnv('SHELL_REPORT_ERROR_INTAKE_DIR', path.join(root, 'intake'))

    const { __dockerLogScanTestHelpers } = await import('./report-service.mjs')
    const {
      loadDockerLogErrors,
      resetDockerLogScanCachesForTests,
      getDockerLogTailReadCountForTests,
    } = __dockerLogScanTestHelpers

    resetDockerLogScanCachesForTests()

    const first = await loadDockerLogErrors()
    const readsAfterFirst = getDockerLogTailReadCountForTests()
    const second = await loadDockerLogErrors()
    const readsAfterSecond = getDockerLogTailReadCountForTests()

    expect(first.length).toBeGreaterThan(0)
    expect(second).toEqual(first)
    expect(readsAfterFirst).toBeGreaterThan(0)
    expect(readsAfterSecond).toBe(readsAfterFirst)
  })

  test('loadDockerLogErrors does not reread unchanged Docker JSON sources after TTL expiry', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'd1-445-docker-unchanged-'))
    const entryId = 'abc123'
    const containerDir = path.join(root, entryId)
    await mkdir(containerDir, { recursive: true })
    await writeFile(
      path.join(containerDir, 'config.v2.json'),
      JSON.stringify({ Name: '/dashboard-shell-dev' }),
      'utf8'
    )
    const logLine = JSON.stringify({
      time: new Date().toISOString(),
      stream: 'stderr',
      log: 'upstream connection refused while proxying request status 502',
    })
    await writeFile(path.join(containerDir, `${entryId}-json.log`), `${logLine}\n`, 'utf8')

    vi.stubEnv('SHELL_REPORT_DOCKER_LOG_ROOT', root)
    vi.stubEnv('SHELL_REPORT_DOCKER_LOG_CONTAINERS', 'dashboard-shell-dev')
    vi.stubEnv('SHELL_REPORT_DOCKER_LOG_SCAN_CACHE_TTL_MS', '5')
    vi.stubEnv('SHELL_REPORT_ERROR_INTAKE_DIR', path.join(root, 'intake'))

    const { __dockerLogScanTestHelpers } = await import('./report-service.mjs')
    const {
      loadDockerLogErrors,
      resetDockerLogScanCachesForTests,
      getDockerLogTailReadCountForTests,
    } = __dockerLogScanTestHelpers

    resetDockerLogScanCachesForTests()

    const first = await loadDockerLogErrors()
    const readsAfterFirst = getDockerLogTailReadCountForTests()
    await new Promise((resolve) => setTimeout(resolve, 10))
    const second = await loadDockerLogErrors()
    const readsAfterSecond = getDockerLogTailReadCountForTests()

    expect(first.length).toBeGreaterThan(0)
    expect(second).toEqual(first)
    expect(readsAfterFirst).toBeGreaterThan(0)
    expect(readsAfterSecond).toBe(readsAfterFirst)
  })

  test('loadDockerLogErrors rereads a Docker JSON source when size/mtime changes after TTL expiry', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'd1-445-docker-changed-'))
    const entryId = 'def456'
    const containerDir = path.join(root, entryId)
    await mkdir(containerDir, { recursive: true })
    await writeFile(
      path.join(containerDir, 'config.v2.json'),
      JSON.stringify({ Name: '/dashboard-shell-dev' }),
      'utf8'
    )
    const logLine = JSON.stringify({
      time: new Date().toISOString(),
      stream: 'stderr',
      log: 'upstream connection refused while proxying request status 502',
    })
    await writeFile(path.join(containerDir, `${entryId}-json.log`), `${logLine}\n`, 'utf8')

    vi.stubEnv('SHELL_REPORT_DOCKER_LOG_ROOT', root)
    vi.stubEnv('SHELL_REPORT_DOCKER_LOG_CONTAINERS', 'dashboard-shell-dev')
    vi.stubEnv('SHELL_REPORT_DOCKER_LOG_SCAN_CACHE_TTL_MS', '5')
    vi.stubEnv('SHELL_REPORT_ERROR_INTAKE_DIR', path.join(root, 'intake'))

    const { __dockerLogScanTestHelpers } = await import('./report-service.mjs')
    const {
      loadDockerLogErrors,
      resetDockerLogScanCachesForTests,
      getDockerLogTailReadCountForTests,
    } = __dockerLogScanTestHelpers

    resetDockerLogScanCachesForTests()

    const first = await loadDockerLogErrors()
    const readsAfterFirst = getDockerLogTailReadCountForTests()
    await new Promise((resolve) => setTimeout(resolve, 10))
    await appendFile(
      path.join(containerDir, `${entryId}-json.log`),
      `${JSON.stringify({
        time: new Date().toISOString(),
        stream: 'stderr',
        log: 'upstream connection refused while proxying request status 503',
      })}\n`,
      'utf8'
    )
    const second = await loadDockerLogErrors()
    const readsAfterSecond = getDockerLogTailReadCountForTests()

    expect(second.length).toBeGreaterThan(first.length)
    expect(readsAfterSecond).toBe(readsAfterFirst + 1)
  })

  test('loadDockerLogErrors drops cached rows after the extraction cutoff even when source is unchanged', async () => {
    vi.useFakeTimers()
    const startedAt = new Date('2026-07-06T18:00:00.000Z')
    vi.setSystemTime(startedAt)
    const root = await mkdtemp(path.join(os.tmpdir(), 'd1-445-docker-stale-cache-'))
    const entryId = 'ghi789'
    const containerDir = path.join(root, entryId)
    await mkdir(containerDir, { recursive: true })
    await writeFile(
      path.join(containerDir, 'config.v2.json'),
      JSON.stringify({ Name: '/dashboard-shell-dev' }),
      'utf8'
    )
    const logLine = JSON.stringify({
      time: startedAt.toISOString(),
      stream: 'stderr',
      log: 'upstream connection refused while proxying request status 502',
    })
    await writeFile(path.join(containerDir, `${entryId}-json.log`), `${logLine}\n`, 'utf8')

    vi.stubEnv('SHELL_REPORT_DOCKER_LOG_ROOT', root)
    vi.stubEnv('SHELL_REPORT_DOCKER_LOG_CONTAINERS', 'dashboard-shell-dev')
    vi.stubEnv('SHELL_REPORT_DOCKER_LOG_SCAN_CACHE_TTL_MS', '5')
    vi.stubEnv('SHELL_REPORT_ERROR_INTAKE_DIR', path.join(root, 'intake'))

    const { __dockerLogScanTestHelpers } = await import('./report-service.mjs')
    const {
      loadDockerLogErrors,
      resetDockerLogScanCachesForTests,
      getDockerLogTailReadCountForTests,
    } = __dockerLogScanTestHelpers

    resetDockerLogScanCachesForTests()

    const first = await loadDockerLogErrors()
    const readsAfterFirst = getDockerLogTailReadCountForTests()
    vi.setSystemTime(new Date(startedAt.getTime() + 91 * 60 * 1000))
    const second = await loadDockerLogErrors()
    const readsAfterSecond = getDockerLogTailReadCountForTests()

    expect(first).toHaveLength(1)
    expect(second).toEqual([])
    expect(readsAfterSecond).toBe(readsAfterFirst)
  })

  test('filterDockerLogErrorsForCentralizedIntake excludes external LiteLLM containers', async () => {
    const { filterDockerLogErrorsForCentralizedIntake } = await import(
      './docker-log-error-intake.mjs'
    )
    const rows = [
      {
        container: 'aawm-litellm',
        observed_at: new Date().toISOString(),
        message: 'upstream status 502',
      },
      {
        container: 'dashboard-shell-dev',
        observed_at: new Date().toISOString(),
        message: 'upstream status 502',
      },
    ]
    const intake = filterDockerLogErrorsForCentralizedIntake(rows)
    expect(intake).toEqual([])
  })
})
