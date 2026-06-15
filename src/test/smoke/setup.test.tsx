import { render } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { server } from '../setup'

test('react renders without crash', () => {
  const { getByText } = render(<div>hello</div>)
  expect(getByText('hello')).toBeInTheDocument()
})

test('msw handler intercepts', async () => {
  server.use(
    http.get('/api/shell/reports/usage', () =>
      HttpResponse.json({ summary: {} })
    )
  )

  const response = await fetch('/api/shell/reports/usage')
  const data = await response.json()

  expect(data).toEqual({ summary: {} })
})
