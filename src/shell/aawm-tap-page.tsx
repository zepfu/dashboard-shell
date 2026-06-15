import { useParams } from '@tanstack/react-router'
import { RemoteDashboardRoute } from './remote-dashboard'

export function AawmTapPage() {
  const { page } = useParams({ from: '/_authenticated/aawm-tap/$page' })

  return <RemoteDashboardRoute moduleKey='aawm-tap' routePath={`/${page}`} />
}
