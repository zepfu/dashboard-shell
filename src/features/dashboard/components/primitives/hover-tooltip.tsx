/**
 * HoverTooltip — pointer-driven tooltip wrapper for Phosphor Atlas.
 *
 * Uses React state rather than CSS :hover so that jsdom tests can exercise
 * visibility without requiring computed-style support. On real browsers the
 * behaviour is identical to a CSS-hover approach — no additional JS overhead
 * for mouse users.
 */
import { useState, type ReactElement, type ReactNode } from 'react'

type TooltipVariant = 'health' | 'quota' | 'default'

interface HoverTooltipProps {
  content: ReactNode
  variant?: TooltipVariant
  children: ReactNode
}

/** Returns extra class names based on the tooltip positioning variant. */
function variantClass(variant: TooltipVariant): string {
  if (variant === 'quota') return 'tip-above'
  if (variant === 'health') return 'tip-left'
  return ''
}

/**
 * HoverTooltip wraps children and shows a floating tooltip on pointer hover.
 */
export function HoverTooltip({
  content,
  variant = 'default',
  children,
}: HoverTooltipProps): ReactElement {
  const [isOpen, setIsOpen] = useState(false)

  const extraClass = variantClass(variant)

  return (
    <div
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
          zIndex: 50,
          padding: '0.25rem 0.5rem',
          background: 'var(--card-2)',
          color: 'var(--fg)',
          border: '1px solid var(--border)',
          fontSize: '0.75rem',
          whiteSpace: 'nowrap',
          ...(isOpen
            ? { opacity: 1, pointerEvents: 'auto' }
            : { opacity: 0, pointerEvents: 'none' }),
        }}
      >
        {content}
      </div>
    </div>
  )
}
