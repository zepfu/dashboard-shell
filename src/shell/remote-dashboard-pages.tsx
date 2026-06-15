import { useParams } from '@tanstack/react-router'
import { RemoteDashboardRoute } from './remote-dashboard'

export function AawmDashboardPage() {
  const { _splat } = useParams({ from: '/_authenticated/aawm/$' })

  return (
    <RemoteDashboardRoute moduleKey='aawm' routePath={`/${_splat ?? ''}`} />
  )
}

export function AawmObserveDashboardPage() {
  const { _splat } = useParams({ from: '/_authenticated/aawm-observe/$' })

  return (
    <RemoteDashboardRoute
      moduleKey='aawm-observe'
      routePath={`/${_splat ?? ''}`}
    />
  )
}

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
