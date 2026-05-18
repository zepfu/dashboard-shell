/**
 * ThemeSwitch — Phosphor Atlas dark-only static indicator.
 *
 * Previously a dropdown that toggled light/dark/system.  Now that Phosphor
 * Atlas is permanently dark, this component is a non-interactive visual badge.
 * The default export and named export shape are preserved so all 11 import
 * sites continue to compile without modification.
 */

export function ThemeSwitch() {
  return (
    <span
      className='font-mono text-xs text-muted-foreground select-none'
      aria-label='Theme: dark (fixed)'
    >
      ◑ DARK
    </span>
  )
}
