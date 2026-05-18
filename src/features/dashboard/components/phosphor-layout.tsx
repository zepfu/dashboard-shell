/**
 * PhosphorLayout — route-scoped 2-column grid shell for Phosphor Atlas.
 *
 * NOTE: This component is intentionally route-scoped and is only used inside
 * the dashboard route. It is NOT a global replacement for AuthenticatedLayout.
 * Wave 2 Maintainability: keep this boundary clean — do not import from
 * app-level layout providers here.
 *
 * Wave 10 D10: Removed the sidebar slot entirely. The host AuthenticatedLayout
 * already renders AppSidebar; rendering PhosphorSidebar here created a
 * double-sidebar at 1440px+. The layout now only renders header + main + alerts.
 * The host AppSidebar provides the left navigation as it does for all routes.
 *
 * Base grid: content 1fr | alerts 260px.
 * Breakpoints are handled via the co-located CSS module; the inline `display`
 * style ensures the grid layout is detectable in jsdom tests (which cannot
 * evaluate computed CSS-class styles).
 */
import type { ReactElement, ReactNode } from 'react'

interface PhosphorLayoutProps {
  /** @deprecated sidebar slot removed in Wave 10 — host AppSidebar is used instead. */
  sidebar?: ReactNode
  header: ReactNode
  main: ReactNode
  alerts: ReactNode
}

/**
 * PhosphorLayout renders the Phosphor Atlas content shell (header + main + alerts).
 *
 * The host AppSidebar from AuthenticatedLayout provides sidebar navigation;
 * this layout does NOT render a sidebar to avoid duplication.
 *
 * Breakpoints (handled via CSS module):
 * - 1280px: collapse alerts panel on smaller desktops
 * - 1600px: compress alerts to give content room
 * - 2560px: 2K
 * - 3840px: 4K
 * - 5120px: 5K ultrawide
 */
export function PhosphorLayout({
  header,
  main,
  alerts,
}: PhosphorLayoutProps): ReactElement {
  return (
    <div
      className='phosphor-layout grid'
      style={{
        display: 'grid',
        gridTemplateColumns: '1fr 260px',
        gridTemplateRows: 'auto 1fr',
        minHeight: '100vh',
        background: 'var(--bg)',
        color: 'var(--fg)',
        padding: '12px 16px',
        gap: '4px',
      }}
    >
      <header style={{ gridRow: '1', gridColumn: '1' }}>{header}</header>
      <main style={{ gridRow: '2', gridColumn: '1' }}>{main}</main>
      <aside style={{ gridRow: '1 / 3', gridColumn: '2' }}>{alerts}</aside>
    </div>
  )
}
