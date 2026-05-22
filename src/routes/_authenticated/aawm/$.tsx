import { createFileRoute } from '@tanstack/react-router'
import { AawmDashboardPage } from '@/shell/remote-dashboard-pages'

export const Route = createFileRoute('/_authenticated/aawm/$')({
  validateSearch: () => ({}),
  component: AawmDashboardPage,
})
