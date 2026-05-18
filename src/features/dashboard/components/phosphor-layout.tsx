/**
 * PhosphorLayout — route-scoped 3-column grid shell for Phosphor Atlas.
 *
 * NOTE: This component is intentionally route-scoped and is only used inside
 * the dashboard route. It is NOT a global replacement for AuthenticatedLayout.
 * Wave 2 Maintainability: keep this boundary clean — do not import from
 * app-level layout providers here.
 *
 * Base grid: sidebar 220px | content 1fr | alerts 260px.
 * Breakpoints are handled via the co-located CSS module; the inline `display`
 * style ensures the grid layout is detectable in jsdom tests (which cannot
 * evaluate computed CSS-class styles).
 */
import type { ReactElement, ReactNode } from 'react'

interface PhosphorLayoutProps {
  sidebar: ReactNode
  header: ReactNode
  main: ReactNode
  alerts: ReactNode
}

/**
 * PhosphorLayout renders the full-bleed three-column Phosphor Atlas shell.
 *
 * Breakpoints (handled via CSS module):
 * - 1280px: collapse sidebar
 * - 1600px: expand content gutter
 * - 1920px: standard desktop
 * - 2100px: wide desktop
 * - 2560px: 2K
 * - 3840px: 4K
 * - 5120px: 5K ultrawide
 */
export function PhosphorLayout({
  sidebar,
  header,
  main,
  alerts,
}: PhosphorLayoutProps): ReactElement {
  return (
    <div
      className='phosphor-layout grid'
      style={{
        display: 'grid',
        gridTemplateColumns: '220px 1fr 260px',
        gridTemplateRows: 'auto 1fr',
        minHeight: '100vh',
        background: 'var(--bg)',
        color: 'var(--fg)',
      }}
    >
      <aside style={{ gridRow: '1 / 3', gridColumn: '1' }}>{sidebar}</aside>
      <header style={{ gridRow: '1', gridColumn: '2' }}>{header}</header>
      <main style={{ gridRow: '2', gridColumn: '2' }}>{main}</main>
      <aside style={{ gridRow: '1 / 3', gridColumn: '3' }}>{alerts}</aside>
    </div>
  )
}
