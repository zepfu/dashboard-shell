# Phosphor Atlas — Plugin Theme Contract

This document describes how dashboard-shell plugins can scope CSS-variable
overrides to their own route without affecting the rest of the shell.

---

## 1. Global Phosphor tokens

The shell’s **base palette** is defined in `src/styles/theme.css` as CSS custom
properties on a single `:root` block (dark-only fork — there is no `.dark`
palette fork in `theme.css`). **Component tokens** such as `--quota-burn-*` live
in `src/styles/index.css` inside `@layer components { :root { … } }` (see
§1.2). Together, these form what plugins may reference or override.

### 1.1 Stable API tokens (Phosphor base set)

These token **names** are the stable public API for plugin overrides. **Do not
depend on documented default hex values** — palette values may change between
minor Phosphor updates. Read current values from `theme.css` `:root` when you
need to harmonize visually.

| Token             | Purpose                                   |
| ----------------- | ----------------------------------------- |
| `--accent-chrome` | Primary brand accent (nav, active states) |
| `--accent-hot`    | Error / critical severity                 |
| `--accent-warm`   | Warning / degraded severity               |
| `--accent-cool`   | Informational / sparkline colour          |
| `--fg`            | Primary foreground text                   |
| `--fg-muted`      | Secondary / label text                    |
| `--bg`            | Page background                           |
| `--card`          | Card / panel surface                      |
| `--card-2`        | Secondary card / alternate row            |
| `--border`        | Divider and border                        |

### 1.2 Internal tokens (do NOT override)

The following are **shell-internal** and may change without notice. Overriding
them from a plugin is unsupported.

- `--card-3` — skeleton shimmer midpoint (`theme.css`)
- `--quota-burn-slow`, `--quota-burn-steady`, `--quota-burn-fast`,
  `--quota-burn-hot`, `--quota-burn-peak` — quota velocity burn tiers
  (`index.css` `@layer components`, not `theme.css`)
- `--font-inter`, `--font-manrope`, `--font-mono`, `--font-sans`, `--font-serif`
  — font stack tokens (`theme.css` `@theme inline`)
- Any other undocumented custom property (including shadcn semantic aliases such
  as `--primary`, `--muted-foreground`, etc., unless this contract explicitly
  lists them as stable)

Note: `iv-*` names in the stylesheet (for example `.quota-interval.iv-5-10`) are
**CSS class names**, not `--iv-*` custom properties. There are no `--iv-*`
tokens in the repo.

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
      <div data-plugin='tasks'>{/* ... route content ... */}</div>
    </TasksProvider>
  )
}
```

The `data-plugin` attribute must be on the element that contains all of the
plugin's rendered output. It must **not** be placed on the global layout
elements (`<Header>`, `<Main>`, `<SidebarProvider>`) — those are shared shell
chrome and must always use the global tokens.

### Step 2 — Create a scoped CSS module

Create `<feature>/feature.module.css` and use the attribute selector to scope
your token overrides:

```css
/* src/features/tasks/tasks.module.css */
[data-plugin='tasks'] {
  --accent-chrome: #6366f1;
}
```

Override only the stable API tokens listed in §1.1. Multiple token overrides
may appear in a single rule block.

### Step 3 — Import the CSS module as a side-effect

Import the CSS module at the top of your feature's `index.tsx` so that the
rules are injected into the document when the feature loads:

```tsx
// src/features/tasks/index.tsx
import './tasks.module.css'
```

The `import './tasks.module.css'` is a side-effect import (no exported
bindings). Vite/Rollup will bundle the rule into a scoped `<style>` block.

---

## 3. Complete tasks demo

The tasks route ships as the canonical plugin override example.

**File: `src/features/tasks/tasks.module.css`**

```css
[data-plugin='tasks'] {
  --accent-chrome: #6366f1; /* indigo — replaces the default blue accent */
}
```

**File: `src/features/tasks/tasks-page.tsx`** (excerpt)

```tsx
export function TasksPage(): ReactElement {
  return (
    <TasksProvider>
      <div data-plugin='tasks'>
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
// side-effect: injects the [data-plugin] rule
import { TasksPage } from './tasks-page'
import './tasks.module.css'

export { TasksPage as Tasks } // exported for test isolation (no SidebarProvider)

export function TasksRoute(): ReactElement {
  return (
    <>
      <Header fixed>…</Header>
      <Main>
        <TasksPage /> {/* data-plugin="tasks" is on the inner element */}
      </Main>
    </>
  )
}
```

---

## 4. Architecture rationale

### Why split into `TasksPage` and `TasksRoute`?

`TasksRoute` contains `<Header>` and `<Main>`, which are part of the
authenticated shell layout and depend on `SidebarProvider`. `TasksPage`
(the core content) has no such dependency. This split enables:

- **Test isolation**: unit tests can render `<Tasks />` (= `TasksPage`)
  without wrapping in a full `SidebarProvider`.
- **Plugin boundary clarity**: `data-plugin="tasks"` belongs on the
  content, not on shared layout chrome.

### Why import the CSS as a side-effect in `index.tsx`?

Vitest + jsdom processes ES module side-effect imports, which causes the CSS
rule to appear in `document.styleSheets`. This makes plugin override tests
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
