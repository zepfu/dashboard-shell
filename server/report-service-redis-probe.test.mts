import { EventEmitter } from 'node:events'
import net from 'node:net'
import { afterEach, describe, expect, test, vi } from 'vitest'

const CHECKED_AT = '2026-07-04T12:00:00.000Z'
const PROBE = {
  host: 'langfuse-redis',
  port: 6379,
  category: 'container',
  key: 'test-redis',
  label: 'Test Redis',
}

class MockNetSocket extends EventEmitter {
  write(_chunk: string) {}

  destroy() {}
}

afterEach(() => {
  vi.restoreAllMocks()
  vi.resetModules()
})

describe('classifyRedisPingProbeResponse', () => {
  test('returns null until a complete RESP line terminator is present', async () => {
    const { classifyRedisPingProbeResponse } =
      await import('./report-service.mjs')
    expect(classifyRedisPingProbeResponse('+PO')).toBeNull()
    expect(classifyRedisPingProbeResponse('+PONG')).toBeNull()
    expect(classifyRedisPingProbeResponse('+PO\r')).toBeNull()
  })

  test('treats a complete +PONG line as green', async () => {
    const { classifyRedisPingProbeResponse } =
      await import('./report-service.mjs')
    expect(classifyRedisPingProbeResponse('+PONG\r\n')).toEqual({
      status: 'green',
      detail: '+PONG',
    })
  })

  test('treats other complete RESP simple-string replies as yellow', async () => {
    const { classifyRedisPingProbeResponse } =
      await import('./report-service.mjs')
    expect(
      classifyRedisPingProbeResponse('+LOADING Redis is loading\r\n')
    ).toEqual({
      status: 'yellow',
      detail: '+LOADING Redis is loading',
    })
  })
})

describe('probeRedisHealth', () => {
  test('classifies split +PONG across TCP chunks as green', async () => {
    vi.spyOn(net, 'createConnection').mockImplementation(() => {
      const socket = new MockNetSocket()
      queueMicrotask(() => {
        socket.emit('connect')
        socket.emit('data', Buffer.from('+PO'))
        socket.emit('data', Buffer.from('NG\r\n'))
      })
      return socket as unknown as net.Socket
    })

    const { __localHealthTestHelpers } = await import('./report-service.mjs')
    const { probeRedisHealth } = __localHealthTestHelpers
    const result = await probeRedisHealth(PROBE, CHECKED_AT)

    expect(result.status).toBe('green')
    expect(result.detail).toBe('+PONG')
    expect(result.target).toBe('langfuse-redis:6379')
  })

  test('classifies a complete non-PONG RESP reply as yellow', async () => {
    vi.spyOn(net, 'createConnection').mockImplementation(() => {
      const socket = new MockNetSocket()
      queueMicrotask(() => {
        socket.emit('connect')
        socket.emit('data', Buffer.from('+LOADING Redis is loading\r\n'))
      })
      return socket as unknown as net.Socket
    })

    const { __localHealthTestHelpers } = await import('./report-service.mjs')
    const { probeRedisHealth } = __localHealthTestHelpers
    const result = await probeRedisHealth(PROBE, CHECKED_AT)

    expect(result.status).toBe('yellow')
    expect(result.detail).toBe('+LOADING Redis is loading')
  })

  test('classifies socket errors as red', async () => {
    vi.spyOn(net, 'createConnection').mockImplementation(() => {
      const socket = new MockNetSocket()
      queueMicrotask(() => {
        socket.emit('error', new Error('ECONNREFUSED'))
      })
      return socket as unknown as net.Socket
    })

    const { __localHealthTestHelpers } = await import('./report-service.mjs')
    const { probeRedisHealth } = __localHealthTestHelpers
    const result = await probeRedisHealth(PROBE, CHECKED_AT)

    expect(result.status).toBe('red')
    expect(result.detail).toBe('ECONNREFUSED')
  })
})
