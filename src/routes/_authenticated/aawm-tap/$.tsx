import { createFileRoute } from '@tanstack/react-router'
import { AawmTapSplatPage } from './-aawm-tap-splat-page'

export const Route = createFileRoute('/_authenticated/aawm-tap/$')({
  validateSearch: () => ({}),
  component: AawmTapSplatPage,
})
