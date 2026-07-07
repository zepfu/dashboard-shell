import { EventEmitter } from 'node:events'
import { gunzipSync } from 'node:zlib'
import { afterEach, describe, expect, test, vi } from 'vitest'

type MockResponse = EventEmitter & {
  statusCode?: number
  headers: Record<string, string | number | string[] | undefined>
  body?: Buffer | string
  writeHead: (status: number, headers: Record<string, string>) => void
  end: (chunk?: Buffer | string) => void
}

function createMockResponse(): MockResponse {
  const res = new EventEmitter() as MockResponse
  res.headers = {}
  res.writeHead = (status, headers) => {
    res.statusCode = status
    res.headers = { ...headers }
  }
  res.end = (chunk) => {
    res.body = chunk
    res.emit('finish')
  }
  return res
}

function createMockRequest(
  headers: Record<string, string | string[] | undefined> = {}
) {
  return { headers }
}

afterEach(() => {
  vi.resetModules()
})

describe('report-service JSON response compression', () => {
  test('acceptsGzipEncoding matches gzip token case-insensitively with quality params', async () => {
    const { __responseTestHelpers } = await import('./report-service.mjs')
    const { acceptsGzipEncoding } = __responseTestHelpers

    expect(acceptsGzipEncoding(createMockRequest())).toBe(false)
    expect(
      acceptsGzipEncoding(
        createMockRequest({ 'accept-encoding': 'deflate, br' })
      )
    ).toBe(false)
    expect(
      acceptsGzipEncoding(
        createMockRequest({ 'accept-encoding': 'deflate, gzip;q=0.8' })
      )
    ).toBe(true)
    expect(
      acceptsGzipEncoding(
        createMockRequest({ 'accept-encoding': 'GZIP, deflate' })
      )
    ).toBe(true)
    expect(
      acceptsGzipEncoding(createMockRequest({ 'accept-encoding': 'gzip;q=0' }))
    ).toBe(false)
    expect(
      acceptsGzipEncoding(
        createMockRequest({ 'accept-encoding': 'gzip; q=0.0' })
      )
    ).toBe(false)
    expect(
      acceptsGzipEncoding(
        createMockRequest({ 'accept-encoding': 'deflate, gzip;q=0, br' })
      )
    ).toBe(false)
  })

  test('sendJson gzip path sets headers and body decompresses to JSON', async () => {
    const { __responseTestHelpers } = await import('./report-service.mjs')
    const { sendJson } = __responseTestHelpers

    const req = createMockRequest({ 'accept-encoding': 'gzip' })
    const res = createMockResponse()
    const body = { ok: true, nested: { count: 3 }, label: 'report' }

    await sendJson(req, res, 200, body)

    expect(res.statusCode).toBe(200)
    expect(res.headers['content-type']).toBe('application/json; charset=utf-8')
    expect(res.headers['cache-control']).toBe('no-store')
    expect(res.headers['content-encoding']).toBe('gzip')
    expect(res.headers['vary']).toBe('Accept-Encoding')

    const raw = Buffer.isBuffer(res.body)
      ? res.body
      : Buffer.from(String(res.body))
    const parsed = JSON.parse(gunzipSync(raw).toString('utf8'))
    expect(parsed).toEqual(body)
  })

  test('sendJson without gzip omits content-encoding', async () => {
    const { __responseTestHelpers } = await import('./report-service.mjs')
    const { sendJson } = __responseTestHelpers

    const req = createMockRequest({ 'accept-encoding': 'identity' })
    const res = createMockResponse()
    const body = { error: 'Not found' }

    await sendJson(req, res, 404, body)

    expect(res.statusCode).toBe(404)
    expect(res.headers['content-type']).toBe('application/json; charset=utf-8')
    expect(res.headers['cache-control']).toBe('no-store')
    expect(res.headers['content-encoding']).toBeUndefined()
    expect(res.headers['vary']).toBeUndefined()
    expect(res.body).toBe(JSON.stringify(body))
  })
})
