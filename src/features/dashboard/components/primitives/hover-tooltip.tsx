/**
 * HoverTooltip — amber-bordered, backdrop-blurred tooltip wrapper for Phosphor Atlas.
 *
 * Uses React state rather than CSS :hover so that jsdom tests can exercise
 * visibility without requiring computed-style support. On real browsers the
 * behaviour is identical to a CSS-hover approach — no additional JS overhead
 * for mouse users.
 *
 * The floating panel is portalled to `document.body` and positioned with
 * `position: fixed` using the trigger's `getBoundingClientRect()`. This
 * ensures the panel is never clipped by ancestor `overflow: hidden/auto`
 * containers (e.g. the master-ledger table scroll pane).
 *
 * ## Positioning variants
 * - `default`: tip appears above-right of children.
 * - `health`: tip appears to the LEFT of children (tip-health class).
 *   Use for health-strip cells at the right edge of a provider card.
 * - `quota`: tip appears ABOVE children (tip-quota class). Wrapper gets
 *   `height:100%` + `flex:1 1 0%` + column-flex layout so trend bars can
 *   resolve percentage heights against this element (token-trend-chart).
 * - `quota-bar`: tip appears ABOVE children (tip-quota class, identical CSS).
 *   Wrapper uses `display:block` only — NO height/flex stretching. Use this
 *   for ProviderCard quota rows where the parent is a block container and the
 *   full-height flex sizing of `quota` would overflow into adjacent rows.
 *
 * ## Structured content subclasses (callers opt-in)
 * - `.v9-tip-head` — heading row (amber, bold, 10px, letter-spacing 0.04em)
 * - `.v9-tip-row`  — data row (4-column grid: 38px label / value / 70px / auto)
 * - `.v9-tip-foot` — footer row (9px, italic, muted, dashed border-top)
 * - `.v9-tip-sub`  — subtitle row inside tip-quota (9px, muted)
 *
 * ## Style source of truth
 * All `.v9-tip*` CSS rules live exclusively in `src/styles/index.css`.
 * Wave 35-✘-2: the `TOOLTIP_STYLES` injected `<style>` tag was removed to
 * eliminate the cascade conflict where the runtime-injected rules (appended
 * after bundled CSS) silently overrode `index.css` rules for equal-specificity
 * selectors. `index.css` is now the single authoritative source.
 */
import {
  useState,
  useRef,
  useLayoutEffect,
  useCallback,
  type ReactElement,
  type ReactNode,
  type CSSProperties,
} from 'react'
import { createPortal } from 'react-dom'

/** Supported tooltip positioning variants. */
type TooltipVariant = 'health' | 'quota' | 'quota-bar' | 'default'

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

/** Computed fixed-position coords for the floating panel. */
interface PanelCoords {
  top: number
  left: number
  /** translateY applied on top of `top` positioning (health variant). */
  translateY?: string
  /** Explicit right alignment: set `right` instead of `left`. */
  right?: number
  useRight: boolean
}

/** Returns the variant-specific CSS class name(s) for positioning. */
function variantClass(variant: TooltipVariant): string {
  if (variant === 'quota' || variant === 'quota-bar')
    return 'tip-above tip-quota'
  if (variant === 'health') return 'tip-health'
  return ''
}

/**
 * Compute `position:fixed` coordinates from the trigger's DOMRect so the
 * floating panel anchors the same way the previous `position:absolute` layout
 * did — but now escaping any ancestor overflow clip.
 *
 * Variant anchor rules (mirrors old absolute layout):
 * - `default`:    panel top-left at (rect.right, rect.top)
 * - `health`:     panel right edge at (rect.left - 8), vertically centred
 * - `quota` / `quota-bar`: panel bottom edge at (rect.top - 6), right-aligned
 *   to rect.right, width 240px
 */
function computeCoords(rect: DOMRect, variant: TooltipVariant): PanelCoords {
  if (variant === 'health') {
    return {
      // right edge of panel sits 8px left of trigger left edge
      top: rect.top + rect.height / 2,
      left: 0, // unused when useRight=true
      right: window.innerWidth - rect.left + 8,
      translateY: '-50%',
      useRight: true,
    }
  }

  if (variant === 'quota' || variant === 'quota-bar') {
    return {
      // bottom edge of panel sits 6px above trigger top
      top: rect.top - 6,
      left: 0, // unused when useRight=true
      right: window.innerWidth - rect.right,
      translateY: '-100%',
      useRight: true,
    }
  }

  // default: panel top-left at (rect.right, rect.top)
  return {
    top: rect.top,
    left: rect.right,
    useRight: false,
  }
}

/**
 * HoverTooltip wraps children and shows a floating, amber-bordered,
 * backdrop-blurred tooltip on pointer hover. The panel is portalled to
 * `document.body` and positioned with `position: fixed` so it escapes any
 * ancestor overflow clip (e.g. the master-ledger table scroll pane).
 */
export function HoverTooltip({
  content,
  variant = 'default',
  children,
  className,
}: HoverTooltipProps): ReactElement {
  const [isOpen, setIsOpen] = useState(false)
  const [coords, setCoords] = useState<PanelCoords | null>(null)
  const wrapperRef = useRef<HTMLDivElement>(null)

  const extraClass = variantClass(variant)

  /** Recompute coords from the wrapper's bounding rect. */
  const updateCoords = useCallback(() => {
    if (!wrapperRef.current) return
    const rect = wrapperRef.current.getBoundingClientRect()
    setCoords(computeCoords(rect, variant))
  }, [variant])

  /**
   * While the tooltip is open, reposition on scroll/resize so it tracks the
   * trigger even if the page scrolls. Clean up on close or unmount.
   */
  useLayoutEffect(() => {
    if (!isOpen) return

    // Compute immediately (synchronous layout read inside useLayoutEffect avoids
    // a one-frame flash at open time).
    updateCoords()

    const handleUpdate = () => {
      requestAnimationFrame(updateCoords)
    }

    window.addEventListener('scroll', handleUpdate, {
      passive: true,
      capture: true,
    })
    window.addEventListener('resize', handleUpdate, { passive: true })

    return () => {
      window.removeEventListener('scroll', handleUpdate, { capture: true })
      window.removeEventListener('resize', handleUpdate)
    }
  }, [isOpen, updateCoords])

  /** Build the `style` object for the portalled panel. */
  function panelStyle(): CSSProperties {
    const base: CSSProperties = {
      position: 'fixed',
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
      // Use 1000 to escape any stacking context created by transformed ancestors.
      zIndex: 1000,
      ...(isOpen
        ? { opacity: 1, pointerEvents: 'auto' }
        : { opacity: 0, pointerEvents: 'none' }),
    }

    // Variant-specific sizing / alignment (matches previous absolute layout).
    // All portalled panels use `width: max-content` so the bordered background
    // grows to enclose content rather than clipping or overflowing it.
    // `maxWidth: min(Xpx, calc(100vw - 16px))` caps growth so the panel never
    // escapes the viewport on small screens. `100%` was dropped because on a
    // portalled `position:fixed` element it resolves to `document.body` width,
    // producing an unexpectedly wide cap.
    if (variant === 'quota' || variant === 'quota-bar') {
      Object.assign(base, {
        minWidth: '240px',
        maxWidth: 'min(360px, calc(100vw - 16px))',
        width: 'max-content',
      } satisfies CSSProperties)
    } else if (variant === 'health') {
      Object.assign(base, {
        minWidth: '280px',
        maxWidth: 'min(360px, calc(100vw - 16px))',
        width: 'max-content',
      } satisfies CSSProperties)
    } else {
      // default variant: grow to content but respect viewport and keep minWidth.
      Object.assign(base, {
        maxWidth: 'min(360px, calc(100vw - 16px))',
        width: 'max-content',
        whiteSpace: 'normal',
      } satisfies CSSProperties)
    }

    // Apply computed fixed-position coords.
    if (coords) {
      if (coords.useRight && coords.right !== undefined) {
        base.right = coords.right
        base.top = coords.top
      } else {
        base.top = coords.top
        base.left = coords.left
      }
      if (coords.translateY) {
        base.transform = `translateY(${coords.translateY})`
      }
    } else {
      // Before first measurement — keep off-screen so it doesn't flash.
      base.top = -9999
      base.left = -9999
    }

    return base
  }

  /**
   * Guard: `createPortal` requires a real DOM. In SSR / jsdom-without-body
   * environments we skip the portal and render inline so existing test queries
   * that target `document.body` still find the panel.
   */
  const canPortal = typeof document !== 'undefined' && document.body != null

  const panel = (
    <div
      className={['v9-tip', extraClass, isOpen ? '' : 'hidden']
        .filter(Boolean)
        .join(' ')}
      data-state={isOpen ? 'open' : 'closed'}
      style={panelStyle()}
    >
      {content}
    </div>
  )

  return (
    <div
      ref={wrapperRef}
      className={className}
      style={{
        position: 'relative',
        // quota variant wraps a full-width trend bar inside a flex container
        //   (token-trend-chart, height:80px, align-items:flex-end). The wrapper
        //   must participate as a flex item (flex:'1 1 0%') AND have a definite
        //   height (height:'100%') so that the inner .trend-bar can resolve its
        //   own percentage height against this element rather than collapsing to
        //   content height (4-7px). Wave 32 fix: mirrors the existing health
        //   treatment. See .analysis/wave32-trend-still-broken.md §5.
        // quota-bar variant: used in ProviderCard QuotaIntervalBar rows where the
        //   parent is a block container (NOT a flex container). The full-height flex
        //   sizing of 'quota' resolves height:100% against the block parent's
        //   auto-height and overflows 11-20px into the next row, hijacking pointer
        //   events. quota-bar keeps display:block only — no height/flex stretching.
        //   See .analysis/wave32-multireset-overlap.md §Secondary finding.
        // health variant: the outer caller (health-strip.tsx) wraps HoverTooltip
        //   in an abs-positioned sizing shell (top:6px/bottom:6px/width:12px).
        //   HoverTooltip then fills that shell via display:block + height:100%.
        //   This lets the internal strip use height:100% without needing an
        //   abs-positioned child, fixing the 0-height collapse. Wave 15-A S11.
        // default: inline-block (unchanged).
        display:
          variant === 'quota' || variant === 'health' || variant === 'quota-bar'
            ? 'block'
            : 'inline-block',
        ...(variant === 'health' || variant === 'quota'
          ? {
              height: '100%',
              flex: '1 1 0%',
              // Override display:'block' above so the inner .trend-bar child
              // is flex-positioned at the BOTTOM of this full-height wrapper.
              // Without this, percentage-height bars grow top→down leaving
              // empty space below (Wave 32-G fix).
              display: 'flex',
              flexDirection: 'column' as const,
              justifyContent: 'flex-end',
            }
          : {}),
      }}
      onPointerEnter={() => {
        setIsOpen(true)
      }}
      onPointerLeave={() => {
        setIsOpen(false)
      }}
    >
      {children}
      {canPortal ? createPortal(panel, document.body) : panel}
    </div>
  )
}
