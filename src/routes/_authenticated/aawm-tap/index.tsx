import { createFileRoute, Navigate } from '@tanstack/react-router'

export const Route = createFileRoute('/_authenticated/aawm-tap/')({
  component: () => (
    <Navigate to='/aawm-tap/$page' params={{ page: 'overview' }} replace />
  ),
})
