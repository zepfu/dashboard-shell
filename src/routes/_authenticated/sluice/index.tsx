import { createFileRoute } from '@tanstack/react-router'
import { RemoteDashboardRoute } from '@/shell/remote-dashboard'
import { remoteDashboardConfigByKey } from '@/shell/remote-dashboard-registry'

export const Route = createFileRoute('/_authenticated/sluice/')({
  component: () => (
    <RemoteDashboardRoute
      moduleKey='sluice'
      routePath={remoteDashboardConfigByKey.sluice.defaultRoutePath}
    />
  ),
})
