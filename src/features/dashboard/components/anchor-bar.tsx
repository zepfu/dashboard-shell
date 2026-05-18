/**
 * AnchorBar — keyboard-navigable section strip for Phosphor Atlas.
 *
 * Renders six anchor links with kbd-hint spans and attaches a global
 * keydown handler so users can jump between sections via single-letter
 * shortcuts (S/T/M/R/C/H).
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
  { key: 'h', value: 'health', label: 'Health', hint: '[H]' },
]

const KEY_MAP: Record<string, string> = {
  s: 'status',
  t: 'tokens',
  m: 'models',
  r: 'repos',
  c: 'clients',
  h: 'health',
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
    <nav aria-label='Sections (keyboard shortcuts: bracketed letter)'>
      {SECTIONS.map(({ key, value, label, hint }) => (
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
          style={{
            color:
              activeSection === value
                ? 'var(--accent-chrome)'
                : 'var(--fg-muted)',
            marginInlineEnd: '1rem',
            textDecoration: 'none',
            display: 'inline-flex',
            alignItems: 'center',
            gap: '0.125rem',
          }}
        >
          <span
            className='kbd-hint'
            style={{
              border: '1px solid var(--accent-chrome)',
              padding: '0 2px',
              fontSize: '0.75rem',
            }}
          >
            {hint}
          </span>
          {label}
        </a>
      ))}
    </nav>
  )
}
