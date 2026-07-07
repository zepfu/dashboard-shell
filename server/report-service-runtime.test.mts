import { afterEach, describe, expect, test, vi } from 'vitest'

const envSnapshot = { ...process.env }

afterEach(() => {
  process.env = { ...envSnapshot }
  vi.resetModules()
  vi.unstubAllEnvs()
})

describe('report-service generic unhandled error response', () => {
  test('respondWithGenericServerError does not expose internal error message', async () => {
    vi.stubEnv('VITEST', 'true')
    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
    const { __serverRuntimeTestHelpers } = await import('./report-service.mjs')
    const { respondWithGenericServerError, GENERIC_INTERNAL_SERVER_ERROR_BODY } =
      __serverRuntimeTestHelpers

    const writeHead = vi.fn()
    const end = vi.fn()
    const res = {
      headersSent: false,
      writableEnded: false,
      destroyed: false,
      writeHead,
      end,
    }
    const req = { headers: {} }

    await respondWithGenericServerError(req, res, new Error('secret-db-password-leak'))

    expect(writeHead).toHaveBeenCalledWith(
      500,
      expect.objectContaining({
        'content-type': 'application/json; charset=utf-8',
      })
    )
    const payload = JSON.parse(String(end.mock.calls[0]?.[0]))
    expect(payload).toEqual(GENERIC_INTERNAL_SERVER_ERROR_BODY)
    expect(JSON.stringify(payload)).not.toContain('secret-db-password-leak')
    expect(stderrSpy).toHaveBeenCalled()
    expect(String(stderrSpy.mock.calls[0]?.[0])).toContain('secret-db-password-leak')
    stderrSpy.mockRestore()
  })

  test('respondWithGenericServerError skips JSON when response is already committed', async () => {
    vi.stubEnv('VITEST', 'true')
    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
    const { __serverRuntimeTestHelpers } = await import('./report-service.mjs')
    const { respondWithGenericServerError } = __serverRuntimeTestHelpers

    const writeHead = vi.fn()
    const end = vi.fn()
    const res = {
      headersSent: true,
      writableEnded: false,
      destroyed: false,
      writeHead,
      end,
    }

    await respondWithGenericServerError({}, res, new Error('already started'))

    expect(writeHead).not.toHaveBeenCalled()
    expect(end).not.toHaveBeenCalled()
    stderrSpy.mockRestore()
  })

  test('isHttpResponseCommitted treats headersSent, writableEnded, and destroyed', async () => {
    vi.stubEnv('VITEST', 'true')
    const { __serverRuntimeTestHelpers } = await import('./report-service.mjs')
    const { isHttpResponseCommitted } = __serverRuntimeTestHelpers

    expect(isHttpResponseCommitted({ headersSent: true })).toBe(true)
    expect(isHttpResponseCommitted({ writableEnded: true })).toBe(true)
    expect(isHttpResponseCommitted({ destroyed: true })).toBe(true)
    expect(
      isHttpResponseCommitted({
        headersSent: false,
        writableEnded: false,
        destroyed: false,
      })
    ).toBe(false)
  })
})

describe('report-service bounded shutdown', () => {
  test('resolveBoundedShutdownGraceMs clamps non-finite and out-of-range values', async () => {
    vi.stubEnv('VITEST', 'true')
    const { __serverRuntimeTestHelpers } = await import('./report-service.mjs')
    const { resolveBoundedShutdownGraceMs } = __serverRuntimeTestHelpers

    expect(resolveBoundedShutdownGraceMs(Number.NaN)).toBe(30_000)
    expect(resolveBoundedShutdownGraceMs(500)).toBe(1_000)
    expect(resolveBoundedShutdownGraceMs(999_999)).toBe(300_000)
    expect(resolveBoundedShutdownGraceMs(12_345)).toBe(12_345)
  })

  test('scheduleShutdownForceExit unrefs timer and closes all connections on timeout', async () => {
    vi.stubEnv('VITEST', 'true')
    const { __serverRuntimeTestHelpers } = await import('./report-service.mjs')
    const { scheduleShutdownForceExit } = __serverRuntimeTestHelpers

    const closeAllConnections = vi.fn()
    const exitFn = vi.fn()
    const unref = vi.fn()
    const setTimeoutFn = vi.fn((handler, ms) => {
      expect(ms).toBe(5_000)
      handler()
      return { unref }
    })

    const server = { closeAllConnections }
    scheduleShutdownForceExit(server, 5_000, { setTimeoutFn, exitFn })

    expect(setTimeoutFn).toHaveBeenCalledTimes(1)
    expect(unref).toHaveBeenCalledTimes(1)
    expect(closeAllConnections).toHaveBeenCalledTimes(1)
    expect(exitFn).toHaveBeenCalledWith(1)
  })

  test('beginHttpServerShutdown stops accepting and closes idle connections', async () => {
    vi.stubEnv('VITEST', 'true')
    const { __serverRuntimeTestHelpers } = await import('./report-service.mjs')
    const { beginHttpServerShutdown } = __serverRuntimeTestHelpers

    const close = vi.fn()
    const closeIdleConnections = vi.fn()
    const onClosed = vi.fn()
    const server = { close, closeIdleConnections }

    beginHttpServerShutdown(server, onClosed)

    expect(close).toHaveBeenCalledWith(onClosed)
    expect(closeIdleConnections).toHaveBeenCalledTimes(1)
  })

  test('closeHttpServer resolves after server close callback', async () => {
    vi.stubEnv('VITEST', 'true')
    const { __serverRuntimeTestHelpers } = await import('./report-service.mjs')
    const { closeHttpServer } = __serverRuntimeTestHelpers

    const closeIdleConnections = vi.fn()
    let closeCallback
    const close = vi.fn((cb) => {
      closeCallback = cb
    })
    const server = { close, closeIdleConnections }

    const closePromise = closeHttpServer(server)
    expect(close).toHaveBeenCalledTimes(1)
    expect(closeIdleConnections).toHaveBeenCalledTimes(1)

    closeCallback()
    await expect(closePromise).resolves.toBeUndefined()
  })

  test('runBoundedShutdownSequence exits only after HTTP close and cleanup', async () => {
    vi.stubEnv('VITEST', 'true')
    const { __serverRuntimeTestHelpers } = await import('./report-service.mjs')
    const { runBoundedShutdownSequence } = __serverRuntimeTestHelpers

    const events: string[] = []
    const closeIdleConnections = vi.fn()
    let closeCallback: (() => void) | undefined
    const close = vi.fn((cb: () => void) => {
      closeCallback = cb
    })
    const server = { close, closeIdleConnections, closeAllConnections: vi.fn() }

    const exitFn = vi.fn((code: number) => {
      events.push(`exit:${code}`)
    })
    const setTimeoutFn = vi.fn(() => ({ unref: vi.fn() }))

    const sequencePromise = runBoundedShutdownSequence(server, {
      graceMs: 30_000,
      exitFn,
      setTimeoutFn,
      setForceExitTimer: () => {},
      clearForceExitTimer: () => {},
      async runCleanup() {
        events.push('cleanup:start')
        await Promise.resolve()
        events.push('cleanup:end')
      },
    })

    expect(events).toEqual([])
    expect(close).toHaveBeenCalledTimes(1)

    closeCallback?.()
    await sequencePromise

    expect(events).toEqual(['cleanup:start', 'cleanup:end', 'exit:0'])
    expect(exitFn).toHaveBeenCalledTimes(1)
    expect(exitFn).toHaveBeenCalledWith(0)
  })

  test('runBoundedShutdownSequence clears force-exit timer before successful exit', async () => {
    vi.stubEnv('VITEST', 'true')
    const { __serverRuntimeTestHelpers } = await import('./report-service.mjs')
    const { runBoundedShutdownSequence } = __serverRuntimeTestHelpers

    const closeIdleConnections = vi.fn()
    const close = vi.fn((cb: () => void) => {
      cb()
    })
    const server = { close, closeIdleConnections, closeAllConnections: vi.fn() }
    const exitFn = vi.fn()
    const clearForceExitTimer = vi.fn()

    await runBoundedShutdownSequence(server, {
      graceMs: 30_000,
      exitFn,
      setTimeoutFn: vi.fn(() => ({ unref: vi.fn() })),
      setForceExitTimer: () => {},
      clearForceExitTimer,
      async runCleanup() {},
    })

    expect(clearForceExitTimer).toHaveBeenCalledTimes(1)
    expect(exitFn).toHaveBeenCalledWith(0)
  })

  test('runBoundedShutdownSequence rethrows cleanup errors without calling exitFn(0)', async () => {
    vi.stubEnv('VITEST', 'true')
    const { __serverRuntimeTestHelpers } = await import('./report-service.mjs')
    const { runBoundedShutdownSequence } = __serverRuntimeTestHelpers

    const closeIdleConnections = vi.fn()
    const close = vi.fn((cb: () => void) => {
      cb()
    })
    const server = { close, closeIdleConnections, closeAllConnections: vi.fn() }
    const exitFn = vi.fn()
    const clearForceExitTimer = vi.fn()
    const cleanupError = new Error('cleanup blew up')

    await expect(
      runBoundedShutdownSequence(server, {
        graceMs: 30_000,
        exitFn,
        setTimeoutFn: vi.fn(() => ({ unref: vi.fn() })),
        setForceExitTimer: () => {},
        clearForceExitTimer,
        async runCleanup() {
          throw cleanupError
        },
      })
    ).rejects.toThrow('cleanup blew up')

    expect(clearForceExitTimer).toHaveBeenCalledTimes(1)
    expect(exitFn).not.toHaveBeenCalled()
  })
})

describe('D1-444 PgBouncer admin pool shutdown cleanup', () => {
  test('cleanupPgBouncerAdminPools is idempotent and drains cached pools', async () => {
    vi.stubEnv('VITEST', 'true')

    const connect = vi.fn(async () => ({
      query: vi.fn(async () => ({ rows: [] })),
      release: vi.fn(),
    }))
    const on = vi.fn()
    const end = vi.fn(async () => {})
    const Pool = vi.fn(function Pool(this: { connect: typeof connect; on: typeof on; end: typeof end }, _opts: unknown) {
      this.connect = connect
      this.on = on
      this.end = end
    })

    vi.doMock('pg', () => ({ default: { Pool }, Pool }))

    const { __pgBouncerAdminTestHelpers } = await import('./report-service.mjs')
    const {
      cleanupPgBouncerAdminPools,
      getOrCreatePgBouncerAdminPool,
      getPgBouncerAdminPoolCacheSize,
    } = __pgBouncerAdminTestHelpers

    const sidecar = {
      key: 'aawm-pgbouncer',
      adminDatabaseUrl: 'postgresql://admin:secret@127.0.0.1:6432/pgbouncer',
    }

    const first = getOrCreatePgBouncerAdminPool(sidecar)
    const second = getOrCreatePgBouncerAdminPool(sidecar)
    expect(first).toBe(second)
    expect(Pool).toHaveBeenCalledTimes(1)
    expect(getPgBouncerAdminPoolCacheSize()).toBe(1)

    await cleanupPgBouncerAdminPools()
    expect(end).toHaveBeenCalledTimes(1)
    expect(getPgBouncerAdminPoolCacheSize()).toBe(0)

    await cleanupPgBouncerAdminPools()
    expect(end).toHaveBeenCalledTimes(1)
  })
})
