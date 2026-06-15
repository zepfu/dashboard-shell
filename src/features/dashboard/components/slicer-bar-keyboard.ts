import type { KeyboardEvent } from 'react'

/** Returns whether keyboard shortcuts should be suppressed for this focused element. */
export function shouldSuppressListboxShortcutKey(
  el: HTMLElement | null
): boolean {
  if (el === null || !(el instanceof HTMLElement)) return false
  if (
    el instanceof HTMLInputElement ||
    el instanceof HTMLTextAreaElement ||
    el instanceof HTMLSelectElement ||
    el.isContentEditable
  ) {
    return true
  }
  const role = el.getAttribute('role')
  if (role === 'option' || role === 'listbox' || role === 'combobox') {
    return true
  }
  return el.closest('[role="listbox"]') !== null
}

export function handleListboxArrowKey(
  e: KeyboardEvent<HTMLElement>,
  optionCount: number,
  activeIndex: number,
  setActiveIndex: (index: number) => void,
  focusOption: (index: number) => void
): void {
  if (optionCount === 0) return
  if (e.key === 'ArrowDown') {
    e.preventDefault()
    const next = Math.min(activeIndex + 1, optionCount - 1)
    setActiveIndex(next)
    focusOption(next)
    return
  }
  if (e.key === 'ArrowUp') {
    e.preventDefault()
    const next = activeIndex <= 0 ? optionCount - 1 : activeIndex - 1
    setActiveIndex(next)
    focusOption(next)
  }
}
