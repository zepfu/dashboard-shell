import type { ReactElement, ReactNode } from 'react'
import { RefreshCw } from 'lucide-react'

/** Returns a consistent section-title <h2> element matching v9.7 spec. */
export function SectionTitle({
  id,
  children,
  accessory,
  tabs,
}: {
  id: string
  children: string
  accessory?: ReactNode
  tabs?: ReactNode
}): ReactElement {
  const title = (
    <h2 id={id} className='section-title'>
      {children}
    </h2>
  )

  return (
    <div className='section-title-row'>
      <div className='section-title-main'>
        {title}
        {tabs}
      </div>
      {accessory === undefined ? null : (
        <div className='section-title-accessory'>{accessory}</div>
      )}
    </div>
  )
}

export function SectionRefreshButton({
  label,
  updating,
  onRefresh,
}: {
  label: string
  updating: boolean
  onRefresh?: () => Promise<unknown> | unknown
}): ReactElement {
  return (
    <button
      type='button'
      className='section-refresh-button'
      aria-label={label}
      title={label}
      onClick={() => {
        void onRefresh?.()
      }}
      disabled={onRefresh === undefined || updating}
    >
      <RefreshCw
        aria-hidden='true'
        className={
          updating ? 'section-refresh-icon is-updating' : 'section-refresh-icon'
        }
        size={13}
        strokeWidth={1.8}
      />
      <span className='section-refresh-status'>
        {updating ? 'Updating' : 'Refresh'}
      </span>
    </button>
  )
}

export interface SectionTabIndicator {
  label: string
  className?: string
  title?: string
}

interface SectionTabOption<T extends string> {
  value: T
  label: string
  indicator?: SectionTabIndicator
}

export function SectionTabs<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string
  value: T
  options: readonly SectionTabOption<T>[]
  onChange: (value: T) => void
}): ReactElement {
  return (
    <div role='tablist' aria-label={label} className='section-tabs'>
      {options.map((option) => {
        const selected = value === option.value
        return (
          <button
            key={option.value}
            type='button'
            role='tab'
            aria-selected={selected}
            className={selected ? 'is-active' : undefined}
            onClick={() => {
              onChange(option.value)
            }}
          >
            <span className='section-tab-label'>{option.label}</span>
            {option.indicator ? (
              <span
                className={['section-tab-indicator', option.indicator.className]
                  .filter(Boolean)
                  .join(' ')}
                title={option.indicator.title ?? option.indicator.label}
              >
                <span
                  className='section-tab-indicator-dot'
                  aria-hidden='true'
                />
                <span className='sr-only'>{option.indicator.label}</span>
              </span>
            ) : null}
          </button>
        )
      })}
    </div>
  )
}

interface SectionSkeletonProps {
  height?: number
}

/** A simple skeleton block used while data is loading. */
export function SectionSkeleton({
  height = 80,
}: SectionSkeletonProps): ReactElement {
  return (
    <div
      aria-hidden='true'
      className='skeleton-block'
      style={{ height, borderRadius: 0 }}
    />
  )
}

type StatusPillMap<T extends string> = Readonly<
  Record<T, { label: string; className: string }>
>

// eslint-disable-next-line react-refresh/only-export-components
export const STATUS_PILL_FALLBACK = {
  label: 'unknown',
  className: 'is-unknown',
} as const

// eslint-disable-next-line react-refresh/only-export-components
export function statusPill<T extends string>(
  map: StatusPillMap<T>,
  value: T | string | null | undefined,
  fallback: { label: string; className: string }
): { label: string; className: string } {
  if (value == null || value === '') return fallback
  const key = String(value) as T
  return map[key] ?? fallback
}

export function StatusPanel({
  title,
  subLabel,
  loading,
  emptyMessage,
  headPill,
  children,
  className,
  ariaLabel,
}: {
  title: string
  subLabel?: string
  loading?: boolean
  emptyMessage?: string
  headPill?: { label: string; className: string }
  children?: ReactNode
  className?: string
  ariaLabel?: string
}): ReactElement {
  const showEmpty =
    !loading && emptyMessage !== undefined && children === undefined

  return (
    <section className={className} aria-label={ariaLabel ?? title}>
      <div className='status-panel-head'>
        <div className='status-panel-head-main'>
          <span className='status-panel-title'>{title}</span>
          {subLabel !== undefined ? (
            <span className='status-panel-sub'>{subLabel}</span>
          ) : null}
        </div>
        {loading ? (
          <span className='status-panel-loading' role='status'>
            updating
          </span>
        ) : headPill !== undefined ? (
          <span className={`status-pill ${headPill.className}`}>
            {headPill.label}
          </span>
        ) : null}
      </div>
      {showEmpty ? (
        <div className='status-panel-empty' role='status'>
          {emptyMessage}
        </div>
      ) : (
        children
      )}
    </section>
  )
}
