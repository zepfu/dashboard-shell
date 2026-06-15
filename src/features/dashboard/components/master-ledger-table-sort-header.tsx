/**
 * Sortable ledger header cell — keyboard pattern aligned with PhosphorTable (W11).
 */
import { type KeyboardEvent, type ReactElement, type ReactNode } from 'react'

export interface MasterLedgerSortHeaderProps {
  headerId: string
  className?: string | undefined
  ariaSort: 'ascending' | 'descending' | 'none' | undefined
  isSortable: boolean
  sortDirAttr: 'asc' | 'desc' | undefined
  onToggleSort: ((event: unknown) => void) | undefined
  children: ReactNode
}

export function MasterLedgerSortHeader({
  headerId,
  className,
  ariaSort,
  isSortable,
  sortDirAttr,
  onToggleSort,
  children,
}: MasterLedgerSortHeaderProps): ReactElement {
  const onKeyDown = (event: KeyboardEvent<HTMLTableCellElement>): void => {
    if (!isSortable || onToggleSort === undefined) return
    if (event.key !== 'Enter' && event.key !== ' ') return
    event.preventDefault()
    onToggleSort(event)
  }

  return (
    <th
      key={headerId}
      scope='col'
      role='columnheader'
      className={className}
      aria-sort={ariaSort}
      data-sortable={isSortable ? 'true' : undefined}
      data-sort-dir={sortDirAttr}
      tabIndex={isSortable ? 0 : undefined}
      onClick={onToggleSort}
      onKeyDown={onKeyDown}
      style={{
        padding: '6px 8px',
        textAlign: 'left',
        fontWeight: 600,
        color: 'var(--accent-chrome)',
        background: 'var(--card-2)',
        fontSize: '10px',
        textTransform: 'uppercase',
        letterSpacing: '0.04em',
        borderRight: '1px solid var(--border)',
        cursor: isSortable ? 'pointer' : 'default',
        userSelect: 'none',
        whiteSpace: 'nowrap',
      }}
    >
      {children}
    </th>
  )
}
