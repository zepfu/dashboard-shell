import { EventEmitter } from 'node:events'
import { afterEach, describe, expect, test, vi, type Mock } from 'vitest'

type HeaderMap = Record<string, string>

type MockResponse = EventEmitter & {
  destroyed: boolean
  headers: HeaderMap
  headersSent: boolean
  writableEnded: boolean
  writableFinished: boolean
  statusCode?: number
  body: Array<string | Buffer>
  destroy: (error?: unknown) => void
  end: (chunk?: string | Buffer) => void
  write: (chunk: string | Buffer) => void
  writeHead: (status: number, headers: HeaderMap) => void
}

type MockUpstream = {
  ok: boolean
  status: number
  headers: Headers
  body?: ReadableStream
  arrayBuffer: Mock<() => Promise<ArrayBuffer>>
}

type ProxyRequest = {
  method: string
  url: string
  headers: HeaderMap
}

type ProxyConfig = {
  prefix: string
  displayName: string
  target: string
  apiKey?: string
  accessToken?: string
  adminCapability?: string
}

type FetchImplementation = (
  url: URL,
  init: RequestInit
) => Promise<MockUpstream>

type ProxyCallOptions = {
  request?: ProxyRequest
  timeoutMs?: string
  proxyConfig?: ProxyConfig
  fetchImplementation?: FetchImplementation
}

function createResponse() {
  const res = new EventEmitter() as MockResponse
  res.destroyed = false
  res.headers = {}
  res.headersSent = false
  res.writableEnded = false
  res.writableFinished = false
  res.body = []
  res.destroy = () => {
    res.destroyed = true
    res.emit('close')
  }
  res.writeHead = (status, headers) => {
    res.statusCode = status
    res.headers = headers
    res.headersSent = true
  }
  res.write = (chunk) => {
    res.body.push(chunk)
    res.emit('write')
  }
  res.end = (chunk) => {
    if (chunk != null) res.body.push(chunk)
    res.writableEnded = true
    res.writableFinished = true
    res.emit('finish')
    res.emit('close')
  }
  return res
}

function createRequest({
  method = 'GET',
  url = '/api/test/stream',
  headers = { 'x-dashboard-shell-proxy-secret': 'proxy-secret' },
}: {
  method?: string
  url?: string
  headers?: HeaderMap
} = {}): ProxyRequest {
  return {
    method,
    url,
    headers,
  }
}

function createUpstream(
  chunks: string[] = ['one', 'two', 'three']
): MockUpstream {
  const encoder = new TextEncoder()
  const bytes = encoder.encode(chunks.join(''))
  return {
    ok: true,
    status: 200,
    headers: new Headers({
      'content-type': 'text/event-stream',
      'x-upstream': 'stream',
      authorization: 'upstream-leak',
      'transfer-encoding': 'chunked',
    }),
    body: new ReadableStream({
      start(controller) {
        for (const chunk of chunks) {
          controller.enqueue(encoder.encode(chunk))
        }
        controller.close()
      },
    }),
    arrayBuffer: vi.fn(
      async (): Promise<ArrayBuffer> =>
        bytes.buffer.slice(
          bytes.byteOffset,
          bytes.byteOffset + bytes.byteLength
        )
    ),
  }
}

async function callProxy(
  response: MockResponse,
  upstream = createUpstream(),
  {
    request = createRequest(),
    timeoutMs = '1000',
    proxyConfig = {
      prefix: '/api/test',
      displayName: 'Test API',
      target: 'http://upstream.test/api',
      apiKey: 'server-api-key',
      accessToken: 'server-access-token',
      adminCapability: 'server-admin-cap',
    },
    fetchImplementation = async (_url, _init) => upstream,
  }: ProxyCallOptions = {}
) {
  vi.stubEnv('SHELL_REPORT_PROXY_SHARED_SECRET', 'proxy-secret')
  vi.stubEnv('SHELL_REPORT_UPSTREAM_TIMEOUT_MS', timeoutMs)
  const reportService = await import('./report-service.mjs')
  const fetchFn = vi.fn(fetchImplementation)
  vi.stubGlobal('fetch', fetchFn)
  await reportService.handleUpstreamApiProxy(request, response, proxyConfig)
  expect(fetchFn).toHaveBeenCalledOnce()
  return fetchFn
}

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
  vi.resetModules()
})

describe('report-service upstream proxy transport', () => {
  test('streams successful upstream body without whole-response buffering', async () => {
    const res = createResponse()
    const upstream = createUpstream()
    const fetchFn = await callProxy(res, upstream)

    expect(res.statusCode).toBe(200)
    expect(res.headers['content-type']).toBe('text/event-stream')
    expect(res.headers['x-upstream']).toBe('stream')
    expect(res.headers['transfer-encoding']).toBeUndefined()
    expect(res.body).toEqual(
      ['one', 'two', 'three'].map((chunk) => Buffer.from(chunk))
    )
    expect(upstream.arrayBuffer).not.toHaveBeenCalled()
    expect(fetchFn.mock.calls[0]?.[1]?.signal?.aborted).toBe(false)
  })

  test('preserves rewritten path/query and request header policy', async () => {
    const res = createResponse()
    const fetchFn = await callProxy(res, createUpstream(), {
      request: createRequest({
        url: '/api/test/nested/items?limit=50&lane=type_shape',
        headers: {
          'x-dashboard-shell-proxy-secret': 'proxy-secret',
          authorization: 'Bearer browser-token',
          cookie: 'browser-cookie',
          'x-api-key': 'browser-key',
          'x-admin-capability': 'browser-capability',
          connection: 'keep-alive',
          'content-length': '123',
          'transfer-encoding': 'chunked',
          'x-client': 'dashboard-shell',
        },
      }),
    })

    const [url, requestInit] = fetchFn.mock.calls[0] ?? []
    expect(url?.toString()).toBe(
      'http://upstream.test/api/nested/items?limit=50&lane=type_shape'
    )
    expect(requestInit?.method).toBe('GET')
    const headers = requestInit?.headers as Record<string, string>
    expect(headers['x-client']).toBe('dashboard-shell')
    expect(headers['X-API-Key']).toBe('server-api-key')
    expect(headers.Authorization).toBe('Bearer server-access-token')
    expect(headers['X-Admin-Capability']).toBe('server-admin-cap')
    for (const key of [
      'authorization',
      'cookie',
      'x-api-key',
      'x-admin-capability',
      'x-dashboard-shell-proxy-secret',
      'connection',
      'content-length',
      'transfer-encoding',
    ]) {
      expect(headers[key]).toBeUndefined()
    }
  })

  test('aborts upstream and completes cleanup when client closes', async () => {
    let upstreamAbortReason: unknown
    const upstream = createUpstream([])
    upstream.body = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('first'))
      },
      cancel(reason) {
        upstreamAbortReason = reason
      },
    }) as ReadableStream

    const res = createResponse()
    const firstWrite = new Promise<void>((resolve) => {
      res.once('write', resolve)
    })
    const proxyCompletion = callProxy(res, upstream)
    await firstWrite
    res.destroyed = true
    res.emit('close')

    const fetchFn = await proxyCompletion
    const requestInit = fetchFn.mock.calls[0]?.[1]
    expect(requestInit?.signal?.aborted).toBe(true)
    expect(upstreamAbortReason).toBeInstanceOf(Error)
  })

  test('bounds oversized non-success bodies without arrayBuffer buffering', async () => {
    const res = createResponse()
    const errorBody = Buffer.alloc(1024 * 1024 + 128, 0x61)
    let cancelReason: unknown
    const upstream = {
      ok: false,
      status: 503,
      headers: new Headers({
        'content-type': 'application/json',
        'retry-after': '5',
        'transfer-encoding': 'chunked',
      }),
      body: new ReadableStream({
        start(controller) {
          controller.enqueue(errorBody)
        },
        cancel(reason) {
          cancelReason = reason
        },
      }),
      arrayBuffer: vi.fn(async () => {
        throw new Error('uncapped arrayBuffer() must not be called')
      }),
    }

    await callProxy(res, upstream)

    expect(res.statusCode).toBe(503)
    expect(res.headers['retry-after']).toBe('5')
    expect(res.headers['transfer-encoding']).toBeUndefined()
    expect(res.body).toHaveLength(1)
    const responseBody = res.body[0] as Buffer
    expect(
      Buffer.compare(responseBody, errorBody.subarray(0, 1024 * 1024))
    ).toBe(0)
    expect(responseBody.byteLength).toBeLessThan(errorBody.byteLength)
    expect(upstream.arrayBuffer).not.toHaveBeenCalled()
    expect(cancelReason).toBe('upstream error body size limit exceeded')
  })

  test('aborts a stalled successful body when the transfer deadline expires', async () => {
    let upstreamAbortReason: unknown
    const upstream = {
      ok: true,
      status: 200,
      headers: new Headers({
        'content-type': 'text/event-stream',
      }),
      body: new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode('first'))
        },
        cancel(reason) {
          upstreamAbortReason = reason
        },
      }),
      arrayBuffer: vi.fn(async () => new ArrayBuffer(0)),
    }
    const res = createResponse()
    const proxyCompletion = callProxy(res, upstream, {
      timeoutMs: '25',
    })
    const result = await Promise.race([
      proxyCompletion.then(() => 'completed' as const),
      new Promise<'hung'>((resolve) => {
        setTimeout(() => resolve('hung'), 250)
      }),
    ])

    if (result === 'hung') {
      res.destroyed = true
      res.emit('close')
    }

    expect(result).toBe('completed')
    const fetchFn = await proxyCompletion
    expect(fetchFn.mock.calls[0]?.[1]?.signal?.aborted).toBe(true)
    expect(upstreamAbortReason).toBeInstanceOf(Error)
    expect(res.statusCode).toBe(200)
    expect(res.body).toEqual([Buffer.from('first')])
  })

  test('maps upstream fetch timeout to 504', async () => {
    const res = createResponse()
    const fetchFn = await callProxy(res, createUpstream(), {
      timeoutMs: '5',
      fetchImplementation: (_url, init) =>
        new Promise<MockUpstream>((_resolve, reject) => {
          init.signal?.addEventListener(
            'abort',
            () => {
              const error = new Error('upstream timed out')
              error.name = 'AbortError'
              reject(error)
            },
            { once: true }
          )
        }),
    })

    expect(res.statusCode).toBe(504)
    expect(res.body).toEqual([
      JSON.stringify({
        error: 'Test API upstream timed out after 5ms.',
      }),
    ])
    expect(fetchFn.mock.calls[0]?.[1]?.signal?.aborted).toBe(true)
  })
})
