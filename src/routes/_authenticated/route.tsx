import { createFileRoute } from '@tanstack/react-router'
import { AuthenticatedLayout } from '@/components/layout/authenticated-layout'

/**
 * Authenticated shell routes. Session and credential handling are delegated to
 * the network layer (reverse proxy / upstream auth); this route does not run a
 * client-side auth gate or mock sign-in flow (Wave 9 / D1).
 */
export const Route = createFileRoute('/_authenticated')({
  component: AuthenticatedLayout,
})
