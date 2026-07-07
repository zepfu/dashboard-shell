import { createFileRoute, lazyRouteComponent } from '@tanstack/react-router'

export const Route = createFileRoute('/_authenticated/chats/')({
  component: lazyRouteComponent(() => import('@/features/chats'), 'Chats'),
})
