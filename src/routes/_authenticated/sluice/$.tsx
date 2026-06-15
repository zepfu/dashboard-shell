import { createFileRoute } from '@tanstack/react-router'
import { SluiceDashboardPage } from '@/shell/remote-dashboard-pages'

export const Route = createFileRoute('/_authenticated/sluice/$')({
  validateSearch: () => ({}),
  component: SluiceDashboardPage,
})
