import { useParams } from '@tanstack/react-router'
import { RemoteDashboardRoute } from '@/shell/remote-dashboard'

export function AawmTapSplatPage() {
  const { _splat } = useParams({ from: '/_authenticated/aawm-tap/$' })
  const routePath = `/${_splat ?? ''}`

  return <RemoteDashboardRoute moduleKey='aawm-tap' routePath={routePath} />
}
