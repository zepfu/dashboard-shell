import { useParams } from '@tanstack/react-router'
import { AawmTapDashboardRoute } from '@/shell/aawm-tap-dashboard'

export function AawmTapSplatPage() {
  const { _splat } = useParams({ from: '/_authenticated/aawm-tap/$' })
  const routePath = `/${_splat ?? ''}`

  return <AawmTapDashboardRoute routePath={routePath} />
}
