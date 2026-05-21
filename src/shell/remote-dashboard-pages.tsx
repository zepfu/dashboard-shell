import { useParams } from '@tanstack/react-router'
import { RemoteDashboardRoute } from './remote-dashboard'

export function AegisDashboardPage() {
  const { _splat } = useParams({ from: '/_authenticated/aegis/$' })

  return (
    <RemoteDashboardRoute moduleKey='aegis' routePath={`/${_splat ?? ''}`} />
  )
}

export function SluiceDashboardPage() {
  const { _splat } = useParams({ from: '/_authenticated/sluice/$' })

  return (
    <RemoteDashboardRoute moduleKey='sluice' routePath={`/${_splat ?? ''}`} />
  )
}
