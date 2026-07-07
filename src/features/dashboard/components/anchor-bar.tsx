/**
 * AnchorBar — keyboard-navigable shortcut strip for the dashboard.
 *
 * The visible shortcuts target the current dashboard surface:
 * Status/Health/Quota, Trend/Version/Request/Tool, Ledger/Model/Repository, plus
 * the first filter and date controls. Tab/focus actions are delegated to the
 * route through `onActivate`; standalone renders fall back to section scrolling.
 *
 * G-3: Bare single-letter shortcuts on `document` are deliberate TUI-style navigation.
 * `shouldSuppressListboxShortcutKey` (shared with the slicer) must list every
 * typeable/focusable surface; modifier keys (Shift/Ctrl/Meta/Alt) are ignored.
 */
import { useCallback, useEffect, useRef, type ReactElement } from 'react'
import { shouldSuppressListboxShortcutKey } from './slicer-bar-keyboard'

interface AnchorBarProps {
  /** The currently active shortcut or section slug. */
  activeSection: string
  /** Callback invoked when the user navigates to a shortcut target. */
  onSectionChange: (s: string) => void
  /** Optional route-level activation handler for tab/focus shortcuts. */
  onActivate?: (s: string) => void
}

interface SectionDef {
  key: string
  value: string
  targetId: string
  beforeHint?: string
  hint: string
  afterHint: string
}

const SECTIONS: SectionDef[] = [
  {
    key: 's',
    value: 'status',
    targetId: 'status',
    hint: '[S]',
    afterHint: 'tatus',
  },
  {
    key: 'h',
    value: 'status-health',
    targetId: 'status',
    hint: '[H]',
    afterHint: 'ealth',
  },
  {
    key: 'q',
    value: 'status-quota',
    targetId: 'status',
    hint: '[Q]',
    afterHint: 'uota',
  },
  {
    key: 't',
    value: 'trend',
    targetId: 'tokens',
    hint: '[T]',
    afterHint: 'rend',
  },
  {
    key: 'v',
    value: 'trend-version',
    targetId: 'tokens',
    hint: '[V]',
    afterHint: 'ersion',
  },
  {
    key: 'r',
    value: 'trend-requests',
    targetId: 'tokens',
    hint: '[R]',
    afterHint: 'equest',
  },
  {
    key: 'o',
    value: 'trend-tools',
    targetId: 'tokens',
    beforeHint: 'T',
    hint: '[O]',
    afterHint: 'ol',
  },
  {
    key: 'l',
    value: 'ledger',
    targetId: 'models',
    hint: '[L]',
    afterHint: 'edger',
  },
  {
    key: 'm',
    value: 'ledger-model',
    targetId: 'models',
    hint: '[M]',
    afterHint: 'odel',
  },
  {
    key: 'e',
    value: 'ledger-repository',
    targetId: 'models',
    beforeHint: 'R',
    hint: '[E]',
    afterHint: 'pository',
  },
  {
    key: 'f',
    value: 'filter',
    targetId: 'dashboard-controls',
    hint: '[F]',
    afterHint: 'ilter',
  },
  {
    key: 'd',
    value: 'date',
    targetId: 'dashboard-controls',
    hint: '[D]',
    afterHint: 'ate',
  },
]

const KEY_MAP = new Map(SECTIONS.map((section) => [section.key, section]))

function scrollTargetIntoView(targetId: string): void {
  const el = document.getElementById(targetId)
  el?.scrollIntoView?.({ behavior: 'smooth' })
}

/**
 * AnchorBar renders a horizontal navigation strip with keyboard shortcuts.
 */
export default function AnchorBar({
  activeSection,
  onSectionChange,
  onActivate,
}: AnchorBarProps): ReactElement {
  const onSectionChangeRef = useRef(onSectionChange)
  const onActivateRef = useRef(onActivate)

  useEffect(() => {
    onSectionChangeRef.current = onSectionChange
    onActivateRef.current = onActivate
  })

  const activate = useCallback((section: SectionDef): void => {
    onSectionChangeRef.current(section.value)
    const onAct = onActivateRef.current
    if (onAct !== undefined) {
      onAct(section.value)
      return
    }
    scrollTargetIntoView(section.targetId)
  }, [])

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent): void => {
      // Skip modifier combos (including Shift+letter shortcuts)
      if (event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) {
        return
      }

      // Skip when focus is on interactive text elements (check both the event
      // target and document.activeElement, as jsdom dispatches global events
      // with target=document even when an input has focus).
      const target = event.target instanceof HTMLElement ? event.target : null
      const active =
        document.activeElement instanceof HTMLElement
          ? document.activeElement
          : null

      if (
        shouldSuppressListboxShortcutKey(target) ||
        shouldSuppressListboxShortcutKey(active)
      ) {
        return
      }

      const section = KEY_MAP.get(event.key.toLowerCase())
      if (section !== undefined) {
        event.preventDefault()
        activate(section)
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [activate])

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
      {SECTIONS.map(({ key, value, targetId, beforeHint, hint, afterHint }) => {
        const isActive = activeSection === value
        return (
          <a
            key={key}
            href={`#${targetId}`}
            aria-current={isActive ? 'page' : undefined}
            aria-keyshortcuts={key}
            onClick={(e) => {
              e.preventDefault()
              const section = KEY_MAP.get(key)
              if (section !== undefined) {
                activate(section)
              }
            }}
            className='anchor-link'
            style={{
              /* 14-H §4 #2,3,4: display default (not flex); no gap (kbd-hint uses margin-right: 1px);
                 no paddingBottom hack — spec accepts the 1px layout shift on border-bottom. */
              color: isActive ? 'var(--accent-chrome)' : 'var(--fg-muted)',
              textDecoration: 'none',
              fontFamily: 'var(--font-mono)',
              letterSpacing: '0.02em',
              fontWeight: isActive ? 500 : 400,
              borderBottom: isActive ? '1px solid #f59e0b' : 'none',
              whiteSpace: 'nowrap',
              transition: 'all 50ms',
            }}
          >
            {beforeHint ?? ''}
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
            {afterHint}
          </a>
        )
      })}
    </nav>
  )
}
