/**
 * HoverTooltip — amber-bordered, backdrop-blurred tooltip wrapper for Phosphor Atlas.
 *
 * Uses React state rather than CSS :hover so that jsdom tests can exercise
 * visibility without requiring computed-style support. On real browsers the
 * behaviour is identical to a CSS-hover approach — no additional JS overhead
 * for mouse users.
 *
 * ## Positioning variants
 * - `default`: tip appears above-right of children.
 * - `health`: tip appears to the LEFT of children (tip-health class).
 *   Use for health-strip cells at the right edge of a provider card.
 * - `quota`: tip appears ABOVE children (tip-quota class).
 *
 * ## Structured content subclasses (callers opt-in)
 * - `.v9-tip-head` — heading row (amber, bold, 11px)
 * - `.v9-tip-row`  — data row (three-column grid: label / value / meta)
 * - `.v9-tip-foot` — footer row (small, muted)
 */
import { useState, type ReactElement, type ReactNode } from 'react'

/** Supported tooltip positioning variants. */
type TooltipVariant = 'health' | 'quota' | 'default'

/** Props for {@link HoverTooltip}. */
interface HoverTooltipProps {
  /** Content rendered inside the floating panel. Accepts any ReactNode. */
  content: ReactNode
  /** Controls positioning anchor. Defaults to `'default'`. */
  variant?: TooltipVariant
  /** Trigger element(s) whose hover opens the tooltip. */
  children: ReactNode
  /** Extra class names forwarded to the wrapper div. */
  className?: string
}

/** Scoped styles injected once into the document for subclass structure rules. */
const TOOLTIP_STYLES = `
.v9-tip .v9-tip-head {
  display: block;
  font-size: 11px;
  font-weight: 700;
  color: var(--accent-chrome, #f59e0b);
  margin-bottom: 4px;
}
.v9-tip .v9-tip-row {
  display: grid;
  grid-template-columns: 1fr auto auto;
  gap: 0 6px;
  font-size: 10px;
  color: var(--fg, #e2e8f0);
  line-height: 1.6;
}
.v9-tip .v9-tip-foot {
  display: block;
  font-size: 9px;
  color: var(--fg-muted, #94a3b8);
  margin-top: 4px;
}
.tip-health {
  right: calc(100% + 6px);
  left: auto;
  top: 50%;
  transform: translateY(-50%);
}
.tip-quota {
  bottom: calc(100% + 6px);
  top: auto;
  left: 0;
}
`

/** Returns the variant-specific CSS class name(s) for positioning. */
function variantClass(variant: TooltipVariant): string {
  if (variant === 'quota') return 'tip-above tip-quota'
  if (variant === 'health') return 'tip-health'
  return ''
}

let stylesInjected = false

/** Injects scoped tooltip styles once per document lifecycle. */
function ensureStyles(): void {
  if (stylesInjected) return
  stylesInjected = true
  if (typeof document === 'undefined') return
  const el = document.createElement('style')
  el.setAttribute('data-v9-tooltip', '')
  el.textContent = TOOLTIP_STYLES
  document.head.appendChild(el)
}

/**
 * HoverTooltip wraps children and shows a floating, amber-bordered,
 * backdrop-blurred tooltip on pointer hover.
 */
export function HoverTooltip({
  content,
  variant = 'default',
  children,
  className,
}: HoverTooltipProps): ReactElement {
  ensureStyles()
  const [isOpen, setIsOpen] = useState(false)

  const extraClass = variantClass(variant)

  return (
    <div
      className={className}
      style={{ position: 'relative', display: 'inline-block' }}
      onPointerEnter={() => {
        setIsOpen(true)
      }}
      onPointerLeave={() => {
        setIsOpen(false)
      }}
    >
      {children}
      <div
        className={['v9-tip', extraClass, isOpen ? '' : 'hidden']
          .filter(Boolean)
          .join(' ')}
        data-state={isOpen ? 'open' : 'closed'}
        style={{
          position: 'absolute',
          background: 'rgba(17, 23, 34, 0.95)',
          border: '1px solid var(--accent-chrome, #f59e0b)',
          padding: '6px 8px',
          minWidth: '120px',
          fontSize: '10px',
          color: 'var(--fg, #e2e8f0)',
          backdropFilter: 'blur(8px)',
          WebkitBackdropFilter: 'blur(8px)',
          zIndex: 200,
          ...(isOpen
            ? { opacity: 1, pointerEvents: 'auto' }
            : { opacity: 0, pointerEvents: 'none' }),
          ...(variant === 'quota'
            ? { bottom: 'calc(100% + 6px)', top: 'auto', left: 0 }
            : variant === 'health'
              ? {
                  right: 'calc(100% + 6px)',
                  left: 'auto',
                  top: '50%',
                  transform: 'translateY(-50%)',
                }
              : { top: 0, left: '100%' }),
        }}
      >
        {content}
      </div>
    </div>
  )
}
