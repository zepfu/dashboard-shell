import '@testing-library/jest-dom'
import { http, HttpResponse } from 'msw'
import { setupServer } from 'msw/node'

export const server = setupServer(
  http.get('/api/shell/health', () =>
    HttpResponse.json({
      ok: true,
      pgBouncerSidecars: {
        status: 'unknown',
        sidecars: [],
      },
    })
  )
)

beforeAll(() => {
  server.listen({ onUnhandledRequest: 'error' })
})

afterEach(() => {
  server.resetHandlers()
})

afterAll(() => {
  server.close()
})
