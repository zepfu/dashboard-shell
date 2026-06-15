import { useParams } from '@tanstack/react-router'
import { RemoteDashboardRoute } from './remote-dashboard'

export function AawmTapPage() {
  const { _splat } = useParams({ from: '/_authenticated/aawm-tap/$' })

  return (
    <RemoteDashboardRoute moduleKey='aawm-tap' routePath={`/${_splat ?? ''}`} />
  )
}
