import { createFileRoute } from '@tanstack/react-router'
import { AegisDashboardPage } from '@/shell/remote-dashboard-pages'

export const Route = createFileRoute('/_authenticated/aegis/$')({
  validateSearch: () => ({}),
  component: AegisDashboardPage,
})
