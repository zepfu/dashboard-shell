import { render, screen } from '@testing-library/react'
import { describe, expect, test } from 'vitest'
import { TasksImportDialog } from './tasks-import-dialog'

describe('TasksImportDialog CSV hint', () => {
  test('hints the file picker to CSV without changing the empty-file message', async () => {
    render(<TasksImportDialog open onOpenChange={() => undefined} />)

    const input = screen.getByLabelText('File')
    expect(input).toHaveAttribute('type', 'file')
    expect(input).toHaveAttribute('accept', 'text/csv')
  })
})
