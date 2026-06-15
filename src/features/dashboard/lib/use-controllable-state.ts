/**
 * useControllableState — controlled/uncontrolled value with a single update path.
 *
 * Wave 7 (S1-17): reduces dual-state churn when a parent may optionally control
 * tab/view state while the component keeps internal fallback state.
 */
import { useCallback, useState } from 'react'

export function useControllableState<T>(
  controlledValue: T | undefined,
  defaultValue: T,
  onChange?: (next: T) => void
): [T, (next: T) => void] {
  const [internalValue, setInternalValue] = useState<T>(defaultValue)
  const isControlled = controlledValue !== undefined
  const value = isControlled ? controlledValue : internalValue

  const setValue = useCallback(
    (next: T): void => {
      if (!isControlled) {
        setInternalValue(next)
      }
      onChange?.(next)
    },
    [isControlled, onChange]
  )

  return [value, setValue]
}
