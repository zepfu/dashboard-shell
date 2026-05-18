# Phosphor Atlas — Plugin Theme Contract

This document describes how dashboard-shell plugins can scope CSS-variable
overrides to their own route without affecting the rest of the shell.

---

## 1. Global Phosphor tokens

All base design tokens are defined in `src/styles/theme.css` as CSS custom
properties on `:root`.  These tokens form the **stable public API** that
plugins may reference or override.

### Stable API tokens (Phosphor base set)

| Token | Default value | Purpose |
|---|---|---|
| `--accent-chrome` | `#3b82f6` | Primary brand accent (nav, active states) |
| `--accent-hot` | `#ef4444` | Error / critical severity |
| `--accent-warm` | `#f97316` | Warning / degraded severity |
| `--accent-cool` | `#06b6d4` | Informational / sparkline colour |
| `--fg` | `#e2e8f0` | Primary foreground text |
| `--fg-muted` | `#94a3b8` | Secondary / label text |
| `--bg` | `#0f172a` | Page background |
| `--card` | `#1e293b` | Card / panel surface |
| `--card-2` | `#334155` | Secondary card / alternate row |
| `--border` | `#334155` | Divider and border |

### Internal tokens (do NOT override)

Tokens prefixed with `--card-2`, `--iv-`, or any undocumented token are
internal and subject to change between minor versions.  Overriding them
from a plugin is unsupported and may break with future Phosphor updates.

---

## 2. Scoping plugin overrides

### Step 1 — Add a `data-plugin` attribute

Wrap your route's outermost content element with a `data-plugin="<name>"`
attribute so that CSS selectors can target your plugin's subtree exclusively.

```tsx
// src/features/tasks/tasks-page.tsx
export function TasksPage(): ReactElement {
  return (
    <TasksProvider>
      <div data-plugin="tasks">
        {/* ... route content ... */}
      </div>
    </TasksProvider>
  )
}
```

The `data-plugin` attribute must be on the element that contains all of the
plugin's rendered output.  It must **not** be placed on the global layout
elements (`<Header>`, `<Main>`, `<SidebarProvider>`) — those are shared shell
chrome and must always use the global tokens.

### Step 2 — Create a scoped CSS module

Create `<feature>/feature.module.css` and use the attribute selector to scope
your token overrides:

```css
/* src/features/tasks/tasks.module.css */
[data-plugin="tasks"] {
  --accent-chrome: #6366f1;
}
```

Override only the stable API tokens listed in §1.  Multiple token overrides
may appear in a single rule block.

### Step 3 — Import the CSS module as a side-effect

Import the CSS module at the top of your feature's `index.tsx` so that the
rules are injected into the document when the feature loads:

```tsx
// src/features/tasks/index.tsx
import './tasks.module.css'
```

The `import './tasks.module.css'` is a side-effect import (no exported
bindings).  Vite/Rollup will bundle the rule into a scoped `<style>` block.

---

## 3. Complete tasks demo

The tasks route ships as the canonical plugin override example.

**File: `src/features/tasks/tasks.module.css`**
```css
[data-plugin="tasks"] {
  --accent-chrome: #6366f1;   /* indigo — replaces the default blue accent */
}
```

**File: `src/features/tasks/tasks-page.tsx`** (excerpt)
```tsx
export function TasksPage(): ReactElement {
  return (
    <TasksProvider>
      <div data-plugin="tasks">
        {/* All tasks content here — uses --accent-chrome: #6366f1 */}
        <TasksTable data={tasks} />
        <TasksDialogs />
      </div>
    </TasksProvider>
  )
}
```

**File: `src/features/tasks/index.tsx`** (excerpt)
```tsx
import './tasks.module.css'   // side-effect: injects the [data-plugin] rule
import { TasksPage } from './tasks-page'

export { TasksPage as Tasks }  // exported for test isolation (no SidebarProvider)

export function TasksRoute(): ReactElement {
  return (
    <>
      <Header fixed>…</Header>
      <Main>
        <TasksPage />   {/* data-plugin="tasks" is on the inner element */}
      </Main>
    </>
  )
}
```

---

## 4. Architecture rationale

### Why split into `TasksPage` and `TasksRoute`?

`TasksRoute` contains `<Header>` and `<Main>`, which are part of the
authenticated shell layout and depend on `SidebarProvider`.  `TasksPage`
(the core content) has no such dependency.  This split enables:

- **Test isolation**: unit tests can render `<Tasks />` (= `TasksPage`)
  without wrapping in a full `SidebarProvider`.
- **Plugin boundary clarity**: `data-plugin="tasks"` belongs on the
  content, not on shared layout chrome.

### Why import the CSS as a side-effect in `index.tsx`?

Vitest + jsdom processes ES module side-effect imports, which causes the CSS
rule to appear in `document.styleSheets`.  This makes plugin override tests
reliable without requiring a full browser environment.

---

## 5. Testing plugin overrides

Use `document.styleSheets` to assert that the expected rule was injected:

```ts
let ruleFound = false
for (let i = 0; i < document.styleSheets.length; i++) {
  const rules = document.styleSheets[i].cssRules
  for (let j = 0; j < rules.length; j++) {
    const rule = rules[j] as CSSStyleRule
    if (
      rule.selectorText?.includes('[data-plugin="tasks"]') &&
      rule.cssText.includes('--accent-chrome') &&
      rule.cssText.includes('#6366f1')
    ) {
      ruleFound = true
    }
  }
}
expect(ruleFound).toBe(true)
```

See `src/features/tasks/plugin-theme-override.test.tsx` for the full test.
