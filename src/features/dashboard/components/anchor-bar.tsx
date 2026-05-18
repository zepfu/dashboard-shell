/**
 * AnchorBar — keyboard-navigable section strip for Phosphor Atlas.
 *
 * Wave 9 changes (v9.7 reference parity):
 * - Bar: background var(--card), border 1px solid var(--border), border-top none.
 * - Link gap: 12px (was 1rem/16px).
 * - Active link: amber bottom underline (border-bottom: 1px solid #f59e0b).
 * - kbd-hint: amber border, padding 0 1px, margin-right 1px.
 *
 * Wave 11 PR1 re-anchor (audit C26):
 * - PR1 moved provider cards to <section id="status"> and removed <section id="health">.
 * - The [H]ealth shortcut now scrolls to #status (which contains provider health summary).
 * - Visible label remains "[H]ealth" per reference mockup.
 */
import { useEffect, type ReactElement } from 'react'

interface AnchorBarProps {
  /** The currently active section slug. */
  activeSection: string
  /** Callback invoked when the user navigates to a new section. */
  onSectionChange: (s: string) => void
}

interface SectionDef {
  key: string
  value: string
  label: string
  hint: string
}

const SECTIONS: SectionDef[] = [
  { key: 's', value: 'status', label: 'Status', hint: '[S]' },
  { key: 't', value: 'tokens', label: 'Tokens', hint: '[T]' },
  { key: 'm', value: 'models', label: 'Models', hint: '[M]' },
  { key: 'r', value: 'repos', label: 'Repos', hint: '[R]' },
  { key: 'c', value: 'clients', label: 'Clients', hint: '[C]' },
  // Wave 11 PR7-lite (audit C26): h key re-anchors to #status (PR1 removed #health).
  // Visible label stays "[H]ealth" per reference mockup.
  { key: 'h', value: 'status', label: 'Health', hint: '[H]' },
]

const KEY_MAP: Record<string, string> = {
  s: 'status',
  t: 'tokens',
  m: 'models',
  r: 'repos',
  c: 'clients',
  // Wave 11 PR7-lite: h now maps to 'status' (provider health summary section).
  h: 'status',
}

/**
 * AnchorBar renders a horizontal navigation strip with keyboard shortcuts.
 */
export default function AnchorBar({
  activeSection,
  onSectionChange,
}: AnchorBarProps): ReactElement {
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent): void => {
      // Skip modifier combos
      if (event.ctrlKey || event.metaKey || event.altKey) return

      // Skip when focus is on interactive text elements (check both the event
      // target and document.activeElement, as jsdom dispatches global events
      // with target=document even when an input has focus).
      const target = event.target as HTMLElement
      const active = document.activeElement as HTMLElement | null
      const focused = active ?? target

      const isInteractive = (el: HTMLElement): boolean =>
        el instanceof HTMLInputElement ||
        el instanceof HTMLTextAreaElement ||
        el.isContentEditable

      if (
        isInteractive(target) ||
        (active !== null && isInteractive(focused))
      ) {
        return
      }

      const section = KEY_MAP[event.key.toLowerCase()]
      if (section !== undefined) {
        onSectionChange(section)
        const el = document.getElementById(section)
        if (el !== null) {
          el.scrollIntoView({ behavior: 'smooth' })
        }
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [onSectionChange])

  return (
    <nav
      className='anchor-bar'
      aria-label='Sections (keyboard shortcuts: bracketed letter)'
      style={{
        background: 'var(--card)',
        border: '1px solid var(--border)',
        borderTop: 'none',
        padding: '6px 10px',
        display: 'flex',
        gap: '12px',
        fontSize: '10px',
        marginBottom: '8px',
        overflowX: 'auto',
      }}
    >
      {SECTIONS.map(({ key, value, label, hint }) => {
        const isActive = activeSection === value
        return (
          <a
            key={key}
            href={`#${value}`}
            onClick={(e) => {
              e.preventDefault()
              onSectionChange(value)
              const el = document.getElementById(value)
              if (el !== null) {
                el.scrollIntoView({ behavior: 'smooth' })
              }
            }}
            className='anchor-link'
            style={{
              color: isActive ? 'var(--accent-chrome)' : 'var(--fg-muted)',
              textDecoration: 'none',
              display: 'inline-flex',
              alignItems: 'center',
              gap: '0.125rem',
              fontFamily: 'var(--font-mono)',
              letterSpacing: '0.02em',
              fontWeight: isActive ? 500 : 400,
              borderBottom: isActive ? '1px solid #f59e0b' : 'none',
              paddingBottom: isActive ? '1px' : '2px',
              whiteSpace: 'nowrap',
              transition: 'all 50ms',
            }}
          >
            <span
              className='kbd-hint'
              style={{
                border: '1px solid #f59e0b',
                borderRadius: 0,
                padding: '0 1px',
                marginRight: '1px',
                color: '#f59e0b',
                fontFamily: 'var(--font-mono)',
                letterSpacing: 0,
                lineHeight: 1,
              }}
            >
              {hint}
            </span>
            {label}
          </a>
        )
      })}
    </nav>
  )
}
