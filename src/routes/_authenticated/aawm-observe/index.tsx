import { createFileRoute } from '@tanstack/react-router'
import { RemoteDashboardRoute } from '@/shell/remote-dashboard'
import { remoteDashboardConfigByKey } from '@/shell/remote-dashboard-registry'

export const Route = createFileRoute('/_authenticated/aawm-observe/')({
  component: () => (
    <RemoteDashboardRoute
      moduleKey='aawm-observe'
      routePath={remoteDashboardConfigByKey['aawm-observe'].defaultRoutePath}
    />
  ),
})
