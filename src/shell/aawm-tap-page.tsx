import { useParams } from '@tanstack/react-router'
import { AawmTapDashboardRoute } from './aawm-tap-dashboard'

export function AawmTapPage() {
  const { page } = useParams({ from: '/_authenticated/aawm-tap/$page' })

  return <AawmTapDashboardRoute routePath={`/${page}`} />
}
