/**
 * HealthStrip — 288-cell health status visualisation.
 *
 * Supports two orientations:
 * - horizontal (default): 288-cell grid across a full-width band, 6px tall.
 *   Used in AggregateCard and as the fleet-pulse strip.
 * - vertical: absolutely positioned at the right edge of a provider card,
 *   12px wide × full card height. v9w1 change — ProviderCard uses this.
 *
 * Each cell represents a 5-minute bucket within a 24-hour window
 * (24 × 12 = 288). Sparse input is padded to 288 cells using
 * `var(--card-2)` as the neutral background.
 *
 * Accessibility: the strip is decorative and is hidden from the a11y tree
 * via `aria-hidden="true"`. A sibling text element should convey the same
 * information for screen reader users.
 *
 * ## Cell colour model (Wave 20 / Wave 24)
 * Each cell may carry an optional `category` and `intensity` (0–1). When
 * present, `deriveCellStyle` maps them to the mockup-correct RGBA palette:
 *
 * | category  | RGB base          | alpha range |
 * |-----------|-------------------|-------------|
 * | 'normal'  | 58, 130, 243      | 0.75–0.90   |
 * | 'teal'    | 20, 184, 166      | 0.60–0.75   |
 * | 'warning' | 245, 158, 11      | 0.50–0.70   |
 * | 'miss'    | cat-miss CSS cls  | —           |
 *
 * When `category` is absent but `rawP95Ms` / `rawErrorCount` raw metrics are
 * provided, `deriveCellStyle` derives the category automatically using a
 * strip-wide p90 latency baseline (see Wave 24 amber threshold rule below).
 *
 * When neither `category` nor raw metrics are present, the `color` string is
 * used unchanged (backward compat with callers that pre-compute the color).
 *
 * ## Wave 24 amber threshold rule
 * Amber (warning) should appear RARELY — targeting ~2-5% of cells:
 *
 *   warning = errorCount > 0 || rawP95Ms > p90_of_strip
 *
 * where `p90_of_strip` is computed across all non-null rawP95Ms values in the
 * rendered strip. Because the 90th-percentile cutoff is used, at most ~10% of
 * cells can be amber from latency alone — and in practice far fewer (most
 * providers have normal latency the vast majority of buckets). Error-triggered
 * amber is equally rare since errors should be infrequent.
 *
 * Teal (cache-hit / low-latency band) applies when the bucket's p95 is strictly
 * below the strip's p50 latency baseline, indicating a bucket with
 * unusually fast responses (cache-hit characteristic).
 *
 * ## Tooltip (vertical mode) — Wave 20 tip-health structure
 * Pass `tooltipContent` to show a `HoverTooltip` (variant `health`) around
 * the entire vertical strip. If cells carry `bucketStart` / `eventCount`
 * metadata and `tooltipContent` is omitted, the strip will build a minimal
 * `tip-health` tooltip itself.
 *
 * The legacy `tooltipContent` prop is still accepted and takes precedence so
 * existing callers are unaffected. Per-event rows (`HealthStripEvent`) can
 * optionally be attached to a cell for richer tooltip content.
 */
import {
  memo,
  type CSSProperties,
  type ReactElement,
  type ReactNode,
} from 'react'
import { HoverTooltip } from './hover-tooltip'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * A single per-event record that may be attached to a health cell.
 * Used to populate per-row entries in the `tip-health` hover tooltip.
 */
export interface HealthStripEvent {
  /** HH:MM timestamp of the individual event within the 5-min bucket. */
  time: string
  /** Model name (e.g. "gpt-4o"). */
  model: string
  /** Human-readable error description (e.g. "503 capacity"). */
  errorType: string
  /** Occurrence count for this event/model pair in the bucket. */
  count: number
}

/**
 * Cell data passed to {@link HealthStrip}.
 *
 * Priority for color determination (highest to lowest):
 * 1. Explicit `category` field — use as-is (Wave 20 semantic palette).
 * 2. Raw metric fields `rawP95Ms` + `rawErrorCount` — derive category using
 *    the strip-wide p90 latency baseline (Wave 24 percentile threshold).
 * 3. `color` string — used unchanged (backward-compatible with earlier waves).
 */
export interface CellDef {
  /**
   * CSS color string — used when `category` is not provided and raw metrics
   * are absent. Keeps backward compatibility with callers that pre-compute the
   * color value.
   *
   * @default 'var(--card-2)'
   */
  color: string

  /**
   * Semantic category controlling the RGB base of the rendered cell.
   *
   * - `'normal'`  — healthy / expected traffic (blue family)
   * - `'teal'`    — low-traffic or cache-hit band (teal family)
   * - `'warning'` — elevated latency or error rate (amber family)
   * - `'miss'`    — attribution gap / no upstream data (CSS `cat-miss`)
   *
   * When set, takes precedence over `rawP95Ms` / `rawErrorCount`.
   */
  category?: 'normal' | 'teal' | 'warning' | 'miss'

  /**
   * Relative intensity within the bucket (0–1).
   * Drives the alpha channel: higher intensity → more opaque.
   * Ignored when `category` is `'miss'` or absent.
   */
  intensity?: number

  // -- Raw metrics for Wave 24 percentile-based category derivation -----------

  /**
   * Upstream P95 latency for the bucket in milliseconds.
   *
   * When provided (alongside `rawErrorCount`), the strip computes a p90
   * baseline across all cells and uses it to derive the `warning` category
   * only for buckets that genuinely exceed the 90th-percentile latency.
   * See the Wave 24 amber threshold rule in the module doc-comment.
   *
   * Set to `null` to indicate no latency data for the bucket (treated as no
   * traffic / neutral).
   */
  rawP95Ms?: number | null

  /**
   * Total error/event count for the bucket (provider + 5xx + timeout +
   * network errors combined). A non-zero value unconditionally triggers
   * the `warning` category regardless of latency.
   *
   * @default 0
   */
  rawErrorCount?: number

  // -- Tooltip metadata -------------------------------------------------------

  /**
   * ISO-8601 timestamp for the bucket start (e.g. "2024-01-15T13:40:00Z").
   * Used to compute the relative-time header in the hover tooltip.
   */
  bucketStart?: string

  /**
   * Total event or error count for the bucket.
   * Shown in the tooltip head as "· N events".
   */
  eventCount?: number

  /**
   * Per-event rows rendered in the hover tooltip body.
   * When absent, a summary-only tooltip is shown.
   */
  events?: HealthStripEvent[]
}

export interface HealthStripProps {
  cells: CellDef[]
  /**
   * Orientation of the strip.
   * - 'horizontal' (default): row strip, 6px tall.
   * - 'vertical': column strip, 12px wide, absolutely positioned right edge.
   */
  orientation?: 'horizontal' | 'vertical'
  /**
   * Optional tooltip content for the entire strip.
   * Only applied when `orientation === 'vertical'`.
   * When provided, wraps the strip in a {@link HoverTooltip} with
   * `variant="health"` so the tip appears to the left of the strip.
   *
   * When omitted but cells carry `bucketStart`/`eventCount` metadata, the
   * strip generates a `tip-health` tooltip automatically.
   */
  tooltipContent?: ReactNode
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const TOTAL_CELLS = 288
const PADDING_COLOR = 'var(--card-2)'

// ---------------------------------------------------------------------------
// Wave 24 — percentile threshold helpers
// ---------------------------------------------------------------------------

/**
 * Computes the p90 latency threshold across all cells that have a non-null
 * `rawP95Ms` value.
 *
 * ## Wave 24 amber threshold rule
 * We use the actual 90th percentile of the strip's own latency distribution
 * rather than a fixed absolute threshold. This guarantees at most ~10% of
 * cells could be amber from latency alone, matching the mockup frequency
 * target of 2-5% (errors further constrain the count in practice).
 *
 * Returns `null` when no cells carry raw latency data (falls back to legacy
 * `category` / `color` paths).
 */
function computeP90Threshold(cells: CellDef[]): number | null {
  const values = cells
    .map((c) => c.rawP95Ms)
    .filter((v): v is number => v != null && v > 0)

  if (values.length === 0) return null

  const sorted = [...values].sort((a, b) => a - b)
  // p90 index: take the value at the 90th percentile position.
  const idx = Math.floor(sorted.length * 0.9)
  return sorted[Math.min(idx, sorted.length - 1)]
}

/**
 * Computes the p50 (median) latency threshold across all cells that have a
 * non-null `rawP95Ms` value. Used to identify unusually fast (teal) buckets.
 *
 * Returns `null` when no cells carry raw latency data.
 */
function computeP50Threshold(cells: CellDef[]): number | null {
  const values = cells
    .map((c) => c.rawP95Ms)
    .filter((v): v is number => v != null && v > 0)

  if (values.length === 0) return null

  const sorted = [...values].sort((a, b) => a - b)
  const idx = Math.floor(sorted.length * 0.5)
  return sorted[Math.min(idx, sorted.length - 1)]
}

// ---------------------------------------------------------------------------
// Color derivation (Wave 20 — mockup-correct RGBA palette)
// ---------------------------------------------------------------------------

/**
 * Linearly interpolates `t` (clamped 0–1) between `lo` and `hi`.
 *
 * Used to map cell intensity to the alpha channel of each palette family.
 */
function lerp(lo: number, hi: number, t: number): number {
  const clamped = Math.max(0, Math.min(1, t))
  return lo + (hi - lo) * clamped
}

/**
 * Formats an rgba() string to two decimal places, dropping trailing zeros.
 */
function rgba(r: number, g: number, b: number, a: number): string {
  const alpha = Math.round(a * 100) / 100
  return `rgba(${r.toString()},${g.toString()},${b.toString()},${alpha.toString()})`
}

/**
 * Derives the CSS `background` value and optional extra class name for a cell.
 *
 * ## Category resolution order (Wave 24)
 *
 * 1. **Explicit `category`** — used verbatim (highest priority, Wave 20).
 * 2. **Raw metrics** (`rawP95Ms` / `rawErrorCount`) — derive category using
 *    the percentile-based threshold rule (Wave 24):
 *
 *    ```
 *    warning  = rawErrorCount > 0
 *               || rawP95Ms > p90Threshold     // ≈ 2-5% of cells
 *    teal     = rawP95Ms != null
 *               && rawP95Ms > 0
 *               && rawP95Ms < p50Threshold     // unusually fast bucket
 *    normal   = everything else with traffic
 *    miss     = rawP95Ms == null && rawErrorCount == 0  // no data
 *    ```
 *
 * 3. **Fallback `color`** — returned unchanged for backward compatibility.
 *
 * Wave 20 mockup palette:
 * - `normal`  → blue  rgb(58, 130, 243)  α ∈ [0.75, 0.90]
 * - `teal`    → teal  rgb(20, 184, 166)  α ∈ [0.60, 0.75]
 * - `warning` → amber rgb(245, 158, 11)  α ∈ [0.50, 0.70]
 * - `miss`    → cat-miss CSS class (no inline background; CSS owns the color)
 * - (none)    → `cell.color` string unchanged (backward compat)
 *
 * @param cell - The cell definition.
 * @param p90Threshold - Strip-wide p90 latency (ms). `null` when no raw data.
 * @param p50Threshold - Strip-wide p50 latency (ms). `null` when no raw data.
 */
function deriveCellStyle(
  cell: CellDef,
  p90Threshold: number | null,
  p50Threshold: number | null
): {
  background: string | undefined
  extraClass: string
} {
  const intensity = cell.intensity ?? 0.5

  // 1. Explicit category — highest priority (Wave 20 callers).
  if (cell.category !== undefined) {
    switch (cell.category) {
      case 'normal':
        return {
          background: rgba(58, 130, 243, lerp(0.75, 0.9, intensity)),
          extraClass: '',
        }
      case 'teal':
        return {
          background: rgba(20, 184, 166, lerp(0.6, 0.75, intensity)),
          extraClass: '',
        }
      case 'warning':
        return {
          background: rgba(245, 158, 11, lerp(0.5, 0.7, intensity)),
          extraClass: '',
        }
      case 'miss':
        // CSS class `cat-miss` owns the background — no inline style needed.
        return { background: undefined, extraClass: 'cat-miss' }
    }
  }

  // 2. Raw metric path — Wave 24 percentile-based category derivation.
  //    Only engaged when at least rawP95Ms is present on the cell.
  if (cell.rawP95Ms !== undefined && p90Threshold !== null) {
    const p95 = cell.rawP95Ms
    const errCount = cell.rawErrorCount ?? 0

    // Miss: no latency data and no errors → attribution gap.
    if (p95 === null && errCount === 0) {
      return { background: undefined, extraClass: 'cat-miss' }
    }

    // Warning (amber — RARE, ~2-5% target):
    //   - Any error in the bucket, OR
    //   - P95 latency exceeds the strip-wide p90 threshold.
    // Using p90 as the cut-point means at most ~10% of cells trigger from
    // latency alone; in practice errors are also rare, keeping amber ≤5%.
    if (errCount > 0 || (p95 !== null && p95 > p90Threshold)) {
      return {
        background: rgba(245, 158, 11, lerp(0.5, 0.7, intensity)),
        extraClass: '',
      }
    }

    // Teal (cache-hit / low-latency band — occasional, ~5-10%):
    //   P95 is non-null, non-zero, and strictly below the strip p50.
    //   Buckets where responses were unusually fast are likely cache-hit.
    if (
      p95 !== null &&
      p95 > 0 &&
      p50Threshold !== null &&
      p95 < p50Threshold
    ) {
      return {
        background: rgba(20, 184, 166, lerp(0.6, 0.75, intensity)),
        extraClass: '',
      }
    }

    // Normal (blue — dominant, ~80-90%): traffic present, latency in range.
    if (p95 !== null && p95 > 0) {
      return {
        background: rgba(58, 130, 243, lerp(0.75, 0.9, intensity)),
        extraClass: '',
      }
    }

    // No data (null p95, errCount 0 already handled above, but guard anyway).
    return { background: PADDING_COLOR, extraClass: '' }
  }

  // 3. Backward compat: use the pre-computed color string.
  return { background: cell.color, extraClass: '' }
}

// ---------------------------------------------------------------------------
// Tooltip helpers (Wave 20 — tip-health structure)
// ---------------------------------------------------------------------------

/**
 * Formats a relative time offset (seconds from now, negative = past) as
 * a human-readable string like `−14h` or `−13h 55m`.
 *
 * Produces strings matching the mockup format:
 * `−14h → −13h 55m · 1 event`
 */
function formatRelTime(offsetSec: number): string {
  const abs = Math.abs(offsetSec)
  const h = Math.floor(abs / 3600)
  const m = Math.floor((abs % 3600) / 60)
  const sign = offsetSec <= 0 ? '−' : '+'
  if (m === 0) return `${sign}${h.toString()}h`
  return `${sign}${h.toString()}h ${m.toString()}m`
}

/**
 * Builds the `tip-health` tooltip ReactNode for a given cell, following the
 * Wave 20 mockup structure:
 *
 * ```
 * <div class="v9-tip-head">{windowStart} → {windowEnd} · {N} events</div>
 * <div class="v9-tip-row">
 *   <span class="t-time">HH:MM</span>
 *   <span class="t-model">model</span>
 *   <span class="t-err">error</span>
 *   <span class="t-count">xN</span>
 * </div>
 * ```
 *
 * Rendering rules (Wave 24):
 * - `events` array with ≥1 entries: one `v9-tip-row` per event (fully wired).
 * - `events` array with 0 entries but `eventCount > 0`: head + placeholder row
 *   showing the aggregate count (upstream sent count but no detail rows yet).
 * - `events` undefined: head + single row with "no event detail" message.
 * - `bucketStart` absent: head falls back to `—` time display.
 */
function buildCellTooltip(cell: CellDef, now: Date): ReactNode {
  // --- Head: relative time window -----------------------------------------
  let headText: string

  if (cell.bucketStart != null) {
    const bucketMs = new Date(cell.bucketStart).getTime()
    const nowMs = now.getTime()
    // Bucket window: [bucketStart, bucketStart + 5 min)
    const startOffsetSec = (bucketMs - nowMs) / 1000
    const endOffsetSec = startOffsetSec + 5 * 60

    const windowStart = formatRelTime(startOffsetSec)
    const windowEnd = formatRelTime(endOffsetSec)
    const n = cell.eventCount ?? 0
    const noun = n === 1 ? 'event' : 'events'
    headText = `${windowStart} → ${windowEnd} · ${n.toString()} ${noun}`
  } else {
    const n = cell.eventCount ?? 0
    const noun = n === 1 ? 'event' : 'events'
    headText = n > 0 ? `— · ${n.toString()} ${noun}` : '— no data'
  }

  // --- Rows: per-event entries ---------------------------------------------
  let rows: ReactNode

  if (cell.events != null && cell.events.length > 0) {
    // Fully wired: one row per event (Wave 24 — bucketStart/events wired by
    // W24-PhosphorDash upstream).
    rows = cell.events.map((ev, idx) => (
      <div key={idx} className='v9-tip-row'>
        <span className='t-time'>{ev.time}</span>
        <span className='t-model'>{ev.model}</span>
        <span className='t-err'>{ev.errorType}</span>
        <span className='t-count'>x{ev.count.toString()}</span>
      </div>
    ))
  } else if (cell.events != null && cell.events.length === 0) {
    // Upstream provided an empty events array but eventCount > 0 — show a
    // placeholder row with the aggregate count while detail is unavailable.
    const count = cell.eventCount ?? 0
    rows = (
      <div className='v9-tip-row'>
        <span className='t-time'>—</span>
        <span className='t-model'>—</span>
        <span className='t-err'>
          {count > 0 ? `${count.toString()} events` : 'ok'}
        </span>
        <span className='t-count' />
      </div>
    )
  } else {
    // events is undefined — no per-event detail available from upstream.
    rows = (
      <div className='v9-tip-row'>
        <span className='t-time'>—</span>
        <span className='t-model'>—</span>
        <span className='t-err'>no event detail</span>
        <span className='t-count' />
      </div>
    )
  }

  return (
    <>
      <div className='v9-tip-head'>{headText}</div>
      {rows}
    </>
  )
}

/**
 * Chooses the tooltip content to show for the strip.
 *
 * Priority:
 * 1. Explicit `tooltipContent` prop (legacy, takes precedence).
 * 2. Internally-generated `tip-health` content derived from cell metadata.
 * 3. `undefined` — no tooltip.
 *
 * For the internal generation, the "most interesting" non-padding cell is
 * selected (first cell with eventCount > 0, or the first non-miss cell).
 */
function resolveTooltipContent(
  tooltipContent: ReactNode | undefined,
  cells: CellDef[],
  now: Date
): ReactNode | undefined {
  if (tooltipContent !== undefined) return tooltipContent

  // Find the most interesting cell — prefer one with events/eventCount.
  const interesting =
    cells.find((c) => (c.eventCount ?? 0) > 0 && c.category !== 'miss') ??
    cells.find((c) => c.bucketStart != null)

  if (interesting == null) return undefined

  return buildCellTooltip(interesting, now)
}

// ---------------------------------------------------------------------------
// HealthCell — memoised single cell
// ---------------------------------------------------------------------------

interface HealthCellProps {
  /** Pre-computed CSS background value (undefined for cat-miss cells). */
  background: string | undefined
  /** Extra CSS class to append (e.g. 'cat-miss'). */
  extraClass: string
  vertical: boolean
}

/**
 * HealthCell is a memoised single strip cell to avoid unnecessary re-renders
 * when only a subset of cells changes (plan Risk: 288-element rerender cost).
 */
const HealthCell = memo(function HealthCell({
  background,
  extraClass,
  vertical,
}: HealthCellProps): ReactElement {
  const style: CSSProperties = {
    ...(background !== undefined ? { background } : {}),
    width: vertical ? '12px' : '100%',
    height: vertical ? undefined : '6px',
    flex: vertical ? '1 1 0' : undefined,
    minHeight: vertical ? 0 : undefined,
  }

  const className = ['health-strip-cell', extraClass].filter(Boolean).join(' ')

  return <div className={className} style={style} />
})

// ---------------------------------------------------------------------------
// HealthStrip — main component
// ---------------------------------------------------------------------------

/**
 * HealthStrip renders a 288-cell health visualisation in horizontal or
 * vertical orientation.
 *
 * Vertical mode positions the strip absolutely at the right edge of a
 * relatively-positioned parent (the provider card). The card must reserve
 * padding-right: 22px to avoid content overlap.
 *
 * Wave 20: cells now support `category` + `intensity` for mockup-correct
 * RGBA colors and `bucketStart` / `eventCount` / `events` for rich
 * `tip-health` hover tooltips.
 *
 * Wave 24: cells may now carry `rawP95Ms` + `rawErrorCount` raw metrics.
 * When present, the strip computes a percentile-based p90 latency threshold
 * across all cells and uses it to derive the `warning` (amber) category only
 * for genuinely elevated buckets — keeping amber at the mockup target of
 * ~2-5% frequency. See the module doc-comment for the full threshold rule.
 */
export function HealthStrip({
  cells,
  orientation = 'horizontal',
  tooltipContent,
}: HealthStripProps): ReactElement {
  const isVertical = orientation === 'vertical'
  const now = new Date()

  const clipped = cells.slice(0, TOTAL_CELLS)
  const padded: CellDef[] =
    clipped.length < TOTAL_CELLS
      ? [
          ...clipped,
          ...Array.from<CellDef>({ length: TOTAL_CELLS - clipped.length }).fill(
            { color: PADDING_COLOR }
          ),
        ]
      : clipped

  // Wave 24: compute strip-wide latency percentiles for the amber threshold
  // rule. These are null when no cells carry rawP95Ms (legacy callers).
  const p90Threshold = computeP90Threshold(padded)
  const p50Threshold = computeP50Threshold(padded)

  if (isVertical) {
    /* 14-H §11 fixes:
       - Add health-strip-wrapper class + borderRight (§11 #1 from 14-G CSS rule)
       - overflow: visible so tooltip can escape (§11 #10)
       - vbar-label CSS classes with corrected letterSpacing 0.06em, opacity 0.7 (§11 #3,4,5)
       - accent-warm (not accent-chrome) for top "24H" label per mockup line 2003 (§11 #3)

       Wave 15-A S11 fix: when tooltipContent is provided the strip is wrapped in
       HoverTooltip. Previously HoverTooltip used display:inline-block which has
       no intrinsic height when its only child is position:absolute — causing the
       entire strip to render at 0×0. Fix: place HoverTooltip inside an explicit
       abs-positioned sizing shell (same inset as the old stripEl). HoverTooltip
       fills that shell (display:block; height:100%) so the inner strip can use
       height:100% instead of position:absolute. This preserves tooltip anchoring
       (`right: calc(100% + 8px)`) relative to the 12px-wide shell.

       Wave 20: resolveTooltipContent() picks the explicit tooltipContent prop
       first (backward compat), then auto-generates tip-health JSX from cell
       metadata (bucketStart / eventCount / events).

       Wave 24: deriveCellStyle now receives p90Threshold / p50Threshold for
       the percentile-based amber threshold rule.
    */

    const resolvedTooltip = resolveTooltipContent(tooltipContent, padded, now)

    /** Inner strip content — shared by both branches. */
    const stripInner = (
      <>
        {/* "24H" label at top — .vbar-label.top per mockup lines 1989-2003 */}
        <div className='vbar-label top'>24H</div>
        <div
          style={{
            flex: 1,
            display: 'flex',
            flexDirection: 'column',
            overflow: 'visible',
            gap: 0,
          }}
        >
          {padded.map((cell, i) => {
            const { background, extraClass } = deriveCellStyle(
              cell,
              p90Threshold,
              p50Threshold
            )
            return (
              <HealthCell
                key={i}
                background={background}
                extraClass={extraClass}
                vertical
              />
            )
          })}
        </div>
        {/* "NOW" label at bottom — .vbar-label.bottom per mockup lines 2005-2007 */}
        <div className='vbar-label bottom'>NOW</div>
      </>
    )

    /** Shared strip-wrapper style — no positioning; sizing comes from parent. */
    const stripWrapperStyle: CSSProperties = {
      display: 'flex',
      flexDirection: 'column',
      borderLeft: '1px solid rgba(245,158,11,0.25)',
      borderRight: '1px solid var(--border)',
      overflow: 'visible',
      height: '100%',
    }

    /** Shared positioning shell — anchors to the provider card (position:relative). */
    const shellStyle: CSSProperties = {
      position: 'absolute',
      top: '6px',
      right: '6px',
      bottom: '6px',
      width: '12px',
    }

    if (resolvedTooltip !== undefined) {
      /*
       * Wave 15-A S11: positioning shell sits between the card and HoverTooltip.
       * HoverTooltip (display:block; height:100%) fills the shell.
       * The inner .health-strip-wrapper uses height:100% (not position:absolute).
       * The tooltip panel uses `right: calc(100% + 8px)` relative to the 12px shell.
       *
       * Wave 20: resolvedTooltip may be a legacy ReactNode from the caller OR
       * an auto-generated tip-health structure from cell metadata.
       */
      return (
        <div aria-hidden='true' style={shellStyle}>
          <HoverTooltip content={resolvedTooltip} variant='health'>
            <div className='health-strip-wrapper' style={stripWrapperStyle}>
              {stripInner}
            </div>
          </HoverTooltip>
        </div>
      )
    }

    // No tooltip — plain abs-positioned strip (original behavior).
    return (
      <div
        aria-hidden='true'
        className='health-strip-wrapper'
        style={{
          position: 'absolute',
          top: '6px',
          right: '6px',
          bottom: '6px',
          width: '12px',
          display: 'flex',
          flexDirection: 'column',
          borderLeft: '1px solid rgba(245,158,11,0.25)',
          borderRight: '1px solid var(--border)',
          overflow: 'visible',
        }}
      >
        {stripInner}
      </div>
    )
  }

  // Horizontal (default) — 288-cell grid row wrapped in .health-strip-wrapper
  // 14-H §11 #6: horizontal mode includes .health-strip-axis showing -24h / now endpoints
  return (
    <div aria-hidden='true'>
      <div
        aria-hidden='true'
        className='health-strip-wrapper'
        style={{
          borderRight: '1px solid var(--border)',
        }}
      >
        <div
          aria-hidden='true'
          className='health-strip'
          style={{
            display: 'grid',
            gridTemplateColumns: `repeat(${TOTAL_CELLS.toString()}, 1fr)`,
            height: '6px',
            gap: 0,
            width: '100%',
            overflow: 'hidden',
          }}
        >
          {padded.map((cell, i) => {
            const { background, extraClass } = deriveCellStyle(
              cell,
              p90Threshold,
              p50Threshold
            )
            return (
              <HealthCell
                key={i}
                background={background}
                extraClass={extraClass}
                vertical={false}
              />
            )
          })}
        </div>
      </div>
      <div className='health-strip-axis'>
        <span>-24h</span>
        <span>now</span>
      </div>
    </div>
  )
}
