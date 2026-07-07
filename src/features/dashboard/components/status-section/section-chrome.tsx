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
    <h2
      id={id}
      className='section-title'
      style={{
        fontSize: 'clamp(10px, 0.6vw, 18px)',
        color: 'var(--accent-chrome)',
        textTransform: 'uppercase',
        letterSpacing: '0.05em',
        fontWeight: 600,
        margin: 0,
      }}
    >
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
