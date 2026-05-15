import { createFileRoute } from '@tanstack/react-router'
import { AawmTapPage } from '@/shell/aawm-tap-page'

const allowedPages = new Set([
  'overview',
  'processes',
  'watchlist',
  'sources',
  'search',
  'graph',
  'admin',
])

export const Route = createFileRoute('/_authenticated/aawm-tap/$page')({
  params: {
    parse: ({ page }) => ({
      page: allowedPages.has(page) ? page : 'overview',
    }),
    stringify: ({ page }) => ({
      page: allowedPages.has(page) ? page : 'overview',
    }),
  },
  validateSearch: () => ({}),
  component: AawmTapPage,
})
