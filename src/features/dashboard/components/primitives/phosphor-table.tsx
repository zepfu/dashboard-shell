import {
  useMemo,
  useState,
  useCallback,
  type KeyboardEvent,
  type ReactElement,
  type ReactNode,
} from 'react'

export interface PhosphorTableColumnMeta {
  align?: 'left' | 'right'
}

export interface PhosphorTableColumnDef<T> {
  key: keyof T & string
  header: string
  sortable?: boolean
  meta?: PhosphorTableColumnMeta
  cell?: (row: T) => ReactNode
}

export interface PhosphorTableProps<T> {
  columns: readonly PhosphorTableColumnDef<T>[]
  rows: readonly T[]
}

function compareValues(a: unknown, b: unknown): number {
  if (typeof a === 'number' && typeof b === 'number') {
    return a - b
  }
  return String(a ?? '').localeCompare(String(b ?? ''), undefined, {
    sensitivity: 'base',
  })
}

function alignmentClass(align: 'left' | 'right' | undefined): string {
  if (align === 'right') return 'text-right'
  return ''
}

export function PhosphorTable<T extends Record<string, unknown>>({
  columns,
  rows,
}: PhosphorTableProps<T>): ReactElement {
  const [sortKey, setSortKey] = useState<string | null>(null)
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc')

  const toggleSort = useCallback(
    (key: string, sortable: boolean | undefined) => {
      if (sortable !== true) return
      if (sortKey !== key) {
        setSortKey(key)
        setSortDir('asc')
        return
      }
      if (sortDir === 'asc') {
        setSortDir('desc')
        return
      }
      setSortKey(null)
      setSortDir('asc')
    },
    [sortKey, sortDir]
  )

  const sortedRows = useMemo(() => {
    if (sortKey === null) return [...rows]
    const copy = [...rows]
    copy.sort((left, right) => {
      const cmp = compareValues(left[sortKey], right[sortKey])
      return sortDir === 'asc' ? cmp : -cmp
    })
    return copy
  }, [rows, sortKey, sortDir])

  const onHeaderKeyDown = (
    event: KeyboardEvent<HTMLTableCellElement>,
    key: string,
    sortable: boolean | undefined
  ): void => {
    if (sortable !== true) return
    if (event.key !== 'Enter' && event.key !== ' ') return
    event.preventDefault()
    toggleSort(key, sortable)
  }

  return (
    <table>
      <thead>
        <tr>
          {columns.map((col) => {
            const sortable = col.sortable === true
            const isActive = sortKey === col.key
            const ariaSort: 'ascending' | 'descending' | 'none' = !sortable
              ? 'none'
              : !isActive
                ? 'none'
                : sortDir === 'asc'
                  ? 'ascending'
                  : 'descending'
            const align = col.meta?.align
            const alignCls = alignmentClass(align)
            return (
              <th
                key={col.key}
                scope='col'
                role='columnheader'
                tabIndex={sortable ? 0 : undefined}
                aria-sort={sortable ? ariaSort : undefined}
                data-align={align === 'right' ? 'right' : undefined}
                className={alignCls || undefined}
                onClick={() => {
                  toggleSort(col.key, col.sortable)
                }}
                onKeyDown={(event) => {
                  onHeaderKeyDown(event, col.key, col.sortable)
                }}
              >
                {col.header}
              </th>
            )
          })}
        </tr>
      </thead>
      <tbody>
        {sortedRows.map((row, rowIndex) => (
          <tr key={rowIndex}>
            {columns.map((col) => {
              const align = col.meta?.align
              const alignCls = alignmentClass(align)
              const raw = row[col.key]
              const cellContent =
                col.cell !== undefined ? col.cell(row) : String(raw ?? '')
              return (
                <td
                  key={col.key}
                  data-col={col.key}
                  data-align={align === 'right' ? 'right' : undefined}
                  className={alignCls || undefined}
                  style={align === 'right' ? { textAlign: 'right' } : undefined}
                >
                  {cellContent}
                </td>
              )
            })}
          </tr>
        ))}
      </tbody>
    </table>
  )
}
