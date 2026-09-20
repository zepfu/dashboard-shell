# dashboard-shell Repository Rules

## CLI TODO Backend

The operator authorized `aawmdt todo` for this repository. The authoritative
root is `/home/zepfu/projects/dashboard-shell`, using `--config` at `/home/zepfu/projects/dashboard-shell/.aawm-devtools.toml`. Storage is `.analysis`,
with `.analysis/current.jsonl`, `.analysis/todo-manifest.json`,
`.analysis/todo-agent-events.jsonl`, and
`.analysis/archive/{year}/{prefix}-{year}.jsonl`. Prefix routing is
defined by `[todo.prefixes]` in the configuration.

Use `$aawmdt-todo-goal`, `$aawmdt-todo-maintain`, and `$aawmdt-todo-summary`
instead of their Markdown counterparts. Former Markdown queues and completion
ledgers under `.analysis` are historical and non-authoritative; do not
duplicate CLI records there. Supporting worklogs remain evidence, not queue
authority.
