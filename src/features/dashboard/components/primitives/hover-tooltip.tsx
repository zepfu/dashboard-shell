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
 * - `.v9-tip-head` — heading row (amber, bold, 10px, letter-spacing 0.04em)
 * - `.v9-tip-row`  — data row (4-column grid: 38px label / value / 70px / auto)
 * - `.v9-tip-foot` — footer row (9px, italic, muted, dashed border-top)
 * - `.v9-tip-sub`  — subtitle row inside tip-quota (9px, muted)
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

/**
 * Scoped styles injected once into the document for subclass structure rules.
 * Wave 14-G: updated to match v9.7 mockup lines 2011–2089 verbatim.
 * - .v9-tip-head: font-size 10px, letter-spacing 0.04em, border-bottom dashed
 * - .v9-tip-row: font-size 9px, grid 38px 1fr 70px auto, col-gap 5px
 * - .v9-tip-foot: font-style italic, 3px margin/padding, dashed border-top
 * - .tip-health: right calc(100% + 8px), width 280px
 * - .tip-quota: width 240px, right 0 left auto
 */
const TOOLTIP_STYLES = `
.v9-tip .v9-tip-head {
  display: block;
  font-size: 10px;
  font-weight: 700;
  color: var(--accent-warm, #f59e0b);
  letter-spacing: 0.04em;
  margin-bottom: 4px;
  padding-bottom: 3px;
  border-bottom: 1px dashed rgba(245, 158, 11, 0.4);
}
.v9-tip .v9-tip-row {
  display: grid;
  grid-template-columns: 38px minmax(0, 1fr) 70px auto;
  column-gap: 5px;
  font-size: 9px;
  color: var(--fg, #e2e8f0);
  padding: 1px 0;
  line-height: 1.6;
}
.v9-tip .v9-tip-foot {
  display: block;
  font-size: 9px;
  color: var(--fg-muted, #94a3b8);
  font-style: italic;
  margin-top: 3px;
  padding-top: 3px;
  border-top: 1px dashed rgba(42, 53, 71, 0.6);
}
.v9-tip.tip-health {
  width: 280px;
  right: calc(100% + 8px);
  left: auto;
  top: 50%;
  transform: translateY(-50%);
  max-width: none;
}
.v9-tip.tip-quota {
  width: 240px;
  bottom: calc(100% + 6px);
  top: auto;
  right: 0;
  left: auto;
  max-width: calc(100% + 40px);
}
.v9-tip.tip-quota .v9-tip-sub {
  font-size: 9px;
  color: var(--fg-muted, #94a3b8);
  margin-bottom: 3px;
}
.v9-tip.tip-quota .v9-tip-row {
  grid-template-columns: minmax(0, 1fr) auto;
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
      style={{
        position: 'relative',
        // quota variant wraps a full-width bar — use block so width:100% resolves
        // correctly.
        // health variant: the outer caller (health-strip.tsx) wraps HoverTooltip
        //   in an abs-positioned sizing shell (top:6px/bottom:6px/width:12px).
        //   HoverTooltip then fills that shell via display:block + height:100%.
        //   This lets the internal strip use height:100% without needing an
        //   abs-positioned child, fixing the 0-height collapse. Wave 15-A S11.
        // default: inline-block (unchanged).
        display:
          variant === 'quota' || variant === 'health'
            ? 'block'
            : 'inline-block',
        ...(variant === 'health' ? { height: '100%' } : {}),
      }}
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
          /* Wave 14-G: rgba(11,16,24,0.96) per mockup line 2011 */
          backgroundColor: 'rgba(11, 16, 24, 0.96)',
          border: '1px solid #f59e0b',
          padding: '6px 8px',
          minWidth: '120px',
          fontSize: '10px',
          color: 'var(--fg, #e2e8f0)',
          /* Wave 14-G: blur(2px) per mockup line 2012 */
          backdropFilter: 'blur(2px)',
          WebkitBackdropFilter: 'blur(2px)',
          /* Wave 14-G: box-shadow per mockup line 2013 */
          boxShadow: '0 4px 12px rgba(0, 0, 0, 0.55)',
          lineHeight: 1.3,
          zIndex: 200,
          ...(isOpen
            ? { opacity: 1, pointerEvents: 'auto' }
            : { opacity: 0, pointerEvents: 'none' }),
          ...(variant === 'quota'
            ? {
                width: '240px',
                bottom: 'calc(100% + 6px)',
                top: 'auto',
                right: 0,
                left: 'auto',
                maxWidth: 'calc(100% + 40px)',
              }
            : variant === 'health'
              ? {
                  width: '280px',
                  right: 'calc(100% + 8px)',
                  left: 'auto',
                  top: '50%',
                  transform: 'translateY(-50%)',
                  maxWidth: 'none',
                }
              : { top: 0, left: '100%' }),
        }}
      >
        {content}
      </div>
    </div>
  )
}
