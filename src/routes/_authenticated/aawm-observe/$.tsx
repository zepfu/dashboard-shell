import { createFileRoute } from '@tanstack/react-router'
import { AawmObserveDashboardPage } from '@/shell/remote-dashboard-pages'

export const Route = createFileRoute('/_authenticated/aawm-observe/$')({
  validateSearch: () => ({}),
  component: AawmObserveDashboardPage,
})
