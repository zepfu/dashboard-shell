/**
 * PhosphorLayout — route-scoped 3-column grid shell for Phosphor Atlas.
 *
 * NOTE: This component is intentionally route-scoped and is only used inside
 * the dashboard route. It is NOT a global replacement for AuthenticatedLayout.
 * Wave 2 Maintainability: keep this boundary clean — do not import from
 * app-level layout providers here.
 *
 * Wave 14-A: Restored 3-column grid per mockup lines 82-124.
 * - Baseline: 220px 1fr 260px
 * - Breakpoints handled via the co-located CSS module.
 * - sidebar slot wired back: `{ sidebar, header, main, alerts }`.
 * - sidebar placed at grid-column:1, grid-row:1/-1 per mockup line 128-129.
 * Wave 18-Cards: Removed inline `gridTemplateColumns`, `padding`, and `gap`
 * from the root element so that the CSS module `@media` breakpoint rules at
 * 1600/2560/3840/5120px are no longer silently overridden by inline styles.
 * Those CSS module rules now carry `!important` (see phosphor-layout.module.css).
 * `display: grid` is owned by the phosphor-layout CSS module / `.grid` class.
 */
import type { ReactElement, ReactNode } from 'react'
import styles from './phosphor-layout.module.css'

interface PhosphorLayoutProps {
  /** Left sidebar navigation slot (PhosphorSidebar). */
  sidebar: ReactNode
  header: ReactNode
  main: ReactNode
  alerts?: ReactNode
}

/**
 * PhosphorLayout renders the Phosphor Atlas content shell
 * (sidebar + header + main + alerts).
 *
 * Breakpoints (handled via CSS module):
 * - 1600–2559px: 200px 1fr 240px
 * - ≥2560px: 260px 1fr 340px
 * - ≥3840px: 300px 1fr 380px, padding 16px 20px, gap 6px
 * - ≥5120px: 340px 1fr 420px, padding 20px 24px, gap 8px
 */
export function PhosphorLayout({
  sidebar,
  header,
  main,
  alerts,
}: PhosphorLayoutProps): ReactElement {
  const hasAlerts = alerts !== undefined && alerts !== null

  return (
    <div
      className={[
        'phosphor-layout grid',
        styles['phosphor-layout'] ?? '',
        !hasAlerts ? (styles['phosphor-layout-no-alerts'] ?? '') : '',
      ]
        .filter(Boolean)
        .join(' ')}
      style={{
        // gridTemplateColumns, padding, gap, and display:grid are owned by CSS.
        background: 'var(--bg)',
        color: 'var(--fg)',
        alignContent: 'start',
      }}
    >
      <aside
        aria-label='Dashboard navigation'
        className='sidebar'
        style={{ gridColumn: '1', gridRow: '1 / -1' }}
      >
        {sidebar}
      </aside>
      <header style={{ gridRow: '1', gridColumn: '2' }}>{header}</header>
      <main style={{ gridRow: '2', gridColumn: '2' }}>{main}</main>
      {hasAlerts && (
        <aside
          aria-label='Dashboard alerts'
          style={{ gridRow: '1 / -1', gridColumn: '3' }}
        >
          {alerts}
        </aside>
      )}
    </div>
  )
}
