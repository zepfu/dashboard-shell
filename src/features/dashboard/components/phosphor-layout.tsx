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
 * - The inline `display`/`gridTemplateColumns` styles ensure the layout is
 *   detectable in jsdom tests (which cannot evaluate computed CSS-class styles).
 *
 * Wave 18-Cards: Removed inline `gridTemplateColumns`, `padding`, and `gap`
 * from the root element so that the CSS module `@media` breakpoint rules at
 * 1600/2560/3840/5120px are no longer silently overridden by inline styles.
 * Those CSS module rules now carry `!important` (see phosphor-layout.module.css).
 * `display: 'grid'` is retained inline so jsdom tests remain detectable.
 */
import type { ReactElement, ReactNode } from 'react'
import styles from './phosphor-layout.module.css'

interface PhosphorLayoutProps {
  /** Left sidebar navigation slot (PhosphorSidebar). */
  sidebar: ReactNode
  header: ReactNode
  main: ReactNode
  alerts: ReactNode
}

/**
 * PhosphorLayout renders the Phosphor Atlas content shell
 * (sidebar + header + main + alerts).
 *
 * The host AppSidebar is suppressed on the dashboard route so that only the
 * route-scoped PhosphorSidebar renders in the left column.
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
  return (
    <div
      className={`phosphor-layout grid ${styles['phosphor-layout'] ?? ''}`}
      style={{
        // display:'grid' kept inline so jsdom tests can detect the grid container
        // without evaluating CSS module class rules.
        display: 'grid',
        gridTemplateRows: 'auto auto',
        // gridTemplateColumns, padding, and gap are intentionally omitted here —
        // they are owned by phosphor-layout.module.css (with !important) so that
        // the 1600/2560/3840/5120px breakpoint overrides take effect in real browsers.
        /* 14-H: drop minHeight:100vh per mockup §1 #2 — alignContent:start handles packing */
        background: 'var(--bg)',
        color: 'var(--fg)',
        alignContent: 'start',
      }}
    >
      <aside className='sidebar' style={{ gridColumn: '1', gridRow: '1 / -1' }}>
        {sidebar}
      </aside>
      <header style={{ gridRow: '1', gridColumn: '2' }}>{header}</header>
      <main style={{ gridRow: '2', gridColumn: '2' }}>{main}</main>
      <aside style={{ gridRow: '1 / -1', gridColumn: '3' }}>{alerts}</aside>
    </div>
  )
}
