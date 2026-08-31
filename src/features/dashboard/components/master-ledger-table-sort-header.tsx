/**
 * Sortable ledger header cell — keyboard sort pattern for the master ledger.
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
  const headerClassName =
    ['master-ledger-sort-header', className].filter(Boolean).join(' ') ||
    undefined
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
      className={headerClassName}
      aria-sort={ariaSort}
      data-sortable={isSortable ? 'true' : undefined}
      data-sort-dir={sortDirAttr}
      tabIndex={isSortable ? 0 : undefined}
      onClick={onToggleSort}
      onKeyDown={onKeyDown}
    >
      {children}
    </th>
  )
}
