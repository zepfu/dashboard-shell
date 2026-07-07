import { createFileRoute, redirect } from '@tanstack/react-router'
import { remoteDashboardConfigByKey } from '@/shell/remote-dashboard-registry'

const defaultSplat = remoteDashboardConfigByKey[
  'aawm-tap'
].defaultRoutePath.replace(/^\//, '')

export const Route = createFileRoute('/_authenticated/aawm-tap/')({
  beforeLoad: () => {
    throw redirect({
      to: '/aawm-tap/$',
      params: { _splat: defaultSplat },
      replace: true,
    })
  },
})
