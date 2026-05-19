/**
 * SlicerBar — Wave 15-D multi-dimension filter bar.
 *
 * Renders five inline pill multi-select dropdowns, one per API dimension:
 *   Provider · Repository · Client · Environment · Model
 *
 * Design: Phosphor 12px mono aesthetic. Each dimension renders as a label
 * with a caret that opens a checkbox dropdown. Selected values appear as
 * removable chips (amber pills with ×). "Clear" link resets a dimension.
 *
 * API alignment (15-D.1): param names match filterColumns in report-service.mjs
 * (singular: provider, repository, client, environment, model). Values are
 * passed to fetchUsageReport() as comma-separated strings.
 *
 * Accessibility: each dropdown is a <ul role="listbox">, each item is a
 * <li role="option"> with a checkbox, keyboard navigable. Closes on outside
 * click via a document-level listener.
 */
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactElement,
} from 'react'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Active filter selection — empty array means "all" (no filter). */
export interface SlicerFilters {
  /** Filter by provider (empty = all). */
  providers: string[]
  /** Filter by repository/tenant_id (empty = all). */
  repositories: string[]
  /** Filter by client name (empty = all). */
  clients: string[]
  /** Filter by environment (empty = all). */
  environments: string[]
  /** Filter by model (empty = all). */
  models: string[]
}

/** Available values for each dimension, derived from the current API response. */
export interface SlicerOptions {
  providers: string[]
  repositories: string[]
  clients: string[]
  environments: string[]
  models: string[]
}

export interface SlicerBarProps {
  /** Currently active filter values. */
  filters: SlicerFilters
  /** Universe of available values per dimension (from API response). */
  options: SlicerOptions
  /** Called whenever any filter changes. */
  onChange: (next: SlicerFilters) => void
  /** Optional CSS class added to the bar wrapper. */
  className?: string
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const EMPTY_FILTERS: SlicerFilters = {
  providers: [],
  repositories: [],
  clients: [],
  environments: [],
  models: [],
}

interface DimensionConfig {
  key: keyof SlicerFilters
  optionsKey: keyof SlicerOptions
  label: string
}

const DIMENSIONS: DimensionConfig[] = [
  { key: 'providers', optionsKey: 'providers', label: 'Provider' },
  { key: 'repositories', optionsKey: 'repositories', label: 'Repository' },
  { key: 'clients', optionsKey: 'clients', label: 'Client' },
  { key: 'environments', optionsKey: 'environments', label: 'Environment' },
  { key: 'models', optionsKey: 'models', label: 'Model' },
]

// ---------------------------------------------------------------------------
// DimensionDropdown — one pill multi-select control
// ---------------------------------------------------------------------------

interface DimensionDropdownProps {
  label: string
  selected: string[]
  options: string[]
  onToggle: (value: string) => void
  onClear: () => void
}

/**
 * Single-dimension dropdown with checkbox list and chip display.
 *
 * State: `open` — whether the dropdown panel is visible.
 * Closes on Escape, Tab-out, or click-outside via document mousedown listener.
 */
function DimensionDropdown({
  label,
  selected,
  options,
  onToggle,
  onClear,
}: DimensionDropdownProps): ReactElement {
  const [open, setOpen] = useState(false)
  const wrapperRef = useRef<HTMLDivElement>(null)

  // Close on outside click
  useEffect(() => {
    if (!open) return
    const handleOutside = (e: MouseEvent): void => {
      if (
        wrapperRef.current &&
        !wrapperRef.current.contains(e.target as Node)
      ) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handleOutside)
    return () => {
      document.removeEventListener('mousedown', handleOutside)
    }
  }, [open])

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLButtonElement>): void => {
      if (e.key === 'Escape') setOpen(false)
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault()
        setOpen((prev) => !prev)
      }
    },
    []
  )

  const handleOptionKeyDown = useCallback(
    (e: KeyboardEvent<HTMLLIElement>, value: string): void => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault()
        onToggle(value)
      }
      if (e.key === 'Escape') {
        setOpen(false)
      }
    },
    [onToggle]
  )

  const hasSelections = selected.length > 0
  const dropdownId = `slicer-${label.toLowerCase().replace(/\s+/g, '-')}-dropdown`

  return (
    <div className='slicer-dimension' ref={wrapperRef}>
      {/* Trigger button */}
      <button
        type='button'
        className={[
          'slicer-trigger',
          hasSelections ? 'slicer-trigger--active' : '',
        ]
          .filter(Boolean)
          .join(' ')}
        aria-haspopup='listbox'
        aria-expanded={open}
        aria-controls={dropdownId}
        onClick={() => {
          setOpen((prev) => !prev)
        }}
        onKeyDown={handleKeyDown}
      >
        <span className='slicer-label'>{label}</span>
        {hasSelections && (
          <span
            className='slicer-count'
            aria-label={`${selected.length} selected`}
          >
            {selected.length}
          </span>
        )}
        <span className='slicer-caret' aria-hidden='true'>
          {open ? '▴' : '▾'}
        </span>
      </button>

      {/* Chip row — selected values */}
      {hasSelections && (
        <div className='slicer-chips' aria-label={`${label} filter chips`}>
          {selected.map((v) => (
            <span key={v} className='slicer-chip'>
              <span className='slicer-chip-text'>{v}</span>
              <button
                type='button'
                className='slicer-chip-remove'
                aria-label={`Remove ${v} from ${label} filter`}
                onClick={() => {
                  onToggle(v)
                }}
              >
                ×
              </button>
            </span>
          ))}
        </div>
      )}

      {/* Dropdown panel */}
      {open && (
        <div className='slicer-dropdown' role='presentation'>
          {/* Clear all for this dimension */}
          <div className='slicer-dropdown-header'>
            <button
              type='button'
              className='slicer-clear-btn'
              onClick={() => {
                onClear()
                setOpen(false)
              }}
              disabled={!hasSelections}
            >
              Clear
            </button>
          </div>
          {options.length === 0 ? (
            <div className='slicer-empty'>No options</div>
          ) : (
            <ul
              id={dropdownId}
              className='slicer-option-list'
              role='listbox'
              aria-multiselectable='true'
              aria-label={`${label} options`}
            >
              {options.map((opt) => {
                const isSelected = selected.includes(opt)
                return (
                  <li
                    key={opt}
                    role='option'
                    aria-selected={isSelected}
                    className={[
                      'slicer-option',
                      isSelected ? 'slicer-option--selected' : '',
                    ]
                      .filter(Boolean)
                      .join(' ')}
                    tabIndex={0}
                    onClick={() => {
                      onToggle(opt)
                    }}
                    onKeyDown={(e) => {
                      handleOptionKeyDown(e, opt)
                    }}
                  >
                    <span className='slicer-option-check' aria-hidden='true'>
                      {isSelected ? '✓' : ' '}
                    </span>
                    <span className='slicer-option-label'>{opt}</span>
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// SlicerBar
// ---------------------------------------------------------------------------

/**
 * SlicerBar renders five DimensionDropdown controls for Provider, Repository,
 * Client, Environment, and Model. Calls `onChange` with the updated filter
 * state whenever any dimension is modified.
 *
 * When all arrays are empty, no filters are sent to the API (all data shown).
 */
export function SlicerBar({
  filters,
  options,
  onChange,
  className,
}: SlicerBarProps): ReactElement {
  const handleToggle = useCallback(
    (key: keyof SlicerFilters, value: string): void => {
      const current = filters[key]
      const next = current.includes(value)
        ? current.filter((v) => v !== value)
        : [...current, value]
      onChange({ ...filters, [key]: next })
    },
    [filters, onChange]
  )

  const handleClear = useCallback(
    (key: keyof SlicerFilters): void => {
      onChange({ ...filters, [key]: [] })
    },
    [filters, onChange]
  )

  const handleClearAll = useCallback((): void => {
    onChange({ ...EMPTY_FILTERS })
  }, [onChange])

  const hasAnyFilter = DIMENSIONS.some((d) => filters[d.key].length > 0)

  return (
    <div
      className={['slicer-bar', className].filter(Boolean).join(' ')}
      role='group'
      aria-label='Dashboard dimension filters'
    >
      <span className='slicer-bar-label'>Filters</span>

      {DIMENSIONS.map((dim) => (
        <DimensionDropdown
          key={dim.key}
          label={dim.label}
          selected={filters[dim.key]}
          options={options[dim.optionsKey]}
          onToggle={(value) => {
            handleToggle(dim.key, value)
          }}
          onClear={() => {
            handleClear(dim.key)
          }}
        />
      ))}

      {/* Global clear — only visible when any filter is active */}
      {hasAnyFilter && (
        <button
          type='button'
          className='slicer-clear-all-btn'
          onClick={handleClearAll}
          aria-label='Clear all dimension filters'
        >
          Clear all
        </button>
      )}
    </div>
  )
}

export { EMPTY_FILTERS as SLICER_EMPTY_FILTERS }
