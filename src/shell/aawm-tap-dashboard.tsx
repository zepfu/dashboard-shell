import { RemoteDashboardRoute } from './remote-dashboard'

type AawmTapDashboardRouteProps = {
  routePath: string
}

export function AawmTapDashboardRoute({
  routePath,
}: AawmTapDashboardRouteProps) {
  return <RemoteDashboardRoute moduleKey='aawm-tap' routePath={routePath} />
}
