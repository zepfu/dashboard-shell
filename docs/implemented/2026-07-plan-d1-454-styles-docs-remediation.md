# D1-454 Styles, Docs, Contracts & Archive-Integrity Remediation — Implementation Plan

**Date:** 2026-07-07
**Author:** researcher
**Subject:** Remediate the 12 non-deferred `D1-454-styles-docs-*` child TODOs (32 fork-review findings across CSS, contract docs, archive docs, and style tests) from `.analysis/todo.md`.
**Scope:** `src/styles/theme.css`, `src/styles/index.css`, `index.html`, `src/styles/quota-burn-colors.test.ts`, `src/styles/token-layer.test.ts`, `docs/plugins/theme-contract.md`, `docs/runtime-contracts.md`, `docs/remote-dashboard-integration-contract.md`, `docs/implemented/2026-06-plan-adversarial-review-20260612.md`, `docs/implemented/2026-05-plan-phosphor-atlas-implementation.md`, `docs/implemented/2026-05-plan-phosphor-atlas-implementation-closeout.md`, plus bookkeeping to `.analysis/todo.md` and `.analysis/completed-202607.md`. Coordination-only: `src/main.tsx` (code owned by D1-453).
**Status:** PROMOTED (2026-07-07)

---

## Executive Summary

D1-454 is a fork-review parent that was decomposed into **12 source-file-owned child TODOs** covering 32 findings (HIGH 5, MED 13, LOW 14) from `.analysis/fork-review/styles-docs.md`. None of the 12 children are marked _Deferred_ (unlike the sibling D1-488), so all 12 are in scope. This plan remediates them in three dispatched waves plus one orchestrator-inline coordination wave:

- **Wave 1 (CSS + style tests, TDD):** `theme.css`, `index.css`, `index.html`, and the two style test files — the only _code_ surface. Findings I-1, I-2, I-3, I-4, I-5, I-6, C-5, C-6, C-7, G-1..G-6, P-1..P-3, A-1, A-2, E-1(cleanup), E-2, and the confirmed dead-CSS list.
- **Wave 2 (contract docs, doc-only):** `theme-contract.md` (C-1, C-4, I-4-doc), `runtime-contracts.md` (C-2-doc), `remote-dashboard-integration-contract.md` (C-3). Depends on Wave 1 for the finalized token values.
- **Wave 3 (archive-integrity, doc-only, additive):** dated correction notes appended to the two 2026-05/2026-06 plan archives + closeout (D-1..D-7). No original text rewritten.
- **Wave 4 (coordination, no dispatch):** `src/main.tsx` C-2 code fix is reclassified to D1-453 (single code owner); this plan resolves C-2 on the doc side only.

**ABSOLUTE BOOKKEEPING REQUIREMENT (operator-emphasized, see the dedicated section below):** As each child sub-item is remediated and its wave passes QA, the **orchestrator MUST move that child TODO entry from `.analysis/todo.md` to `.analysis/completed-202607.md`** — with date, evidence, commands, and changed paths — **inline as the work progresses, not batched at close-out.** This is mandated by `.analysis/todo.md:5` and the Fork Review Decomposition Protocol (`.analysis/todo.md:47-57`). The count `rg -c '^### D1-454-styles-docs-' .analysis/todo.md` must strictly decrease from **12** toward **0** as waves land.

Three scope decisions surfaced during investigation are flagged for operator approval before execution (see Risks SD-1..SD-4). No database work is in scope.

---

## Bookkeeping Protocol — MANDATORY

> This section exists because the operator explicitly required it. It is a **hard, non-optional** part of every wave's definition of done. Skipping it leaves the durable queue lying about what remains.

**Rule:** The orchestrator (not any dispatched agent) moves each `D1-454-styles-docs-*` child entry out of `.analysis/todo.md` and into `.analysis/completed-202607.md` **the moment that child's remediation lands and its owning wave passes QA** — one child at a time, as the work progresses. Do **not** wait until all waves finish.

**Per-child completion record (paste into `.analysis/completed-202607.md`) must contain:**

- Child durable ID (e.g. `D1-454-styles-docs-src-styles-theme-css`)
- Date (EDT) and the resolving wave
- Evidence: QA verdict + the exact commands run and their result (e.g. `pnpm vitest run src/styles/` PASS; `pnpm lint` PASS; grep proofs for dead-CSS removal)
- Changed paths (source, test, doc)
- Findings covered (label IDs, e.g. I-1, I-5, C-1-theme)
- For reclassified/deferred-to-sibling items (main.tsx): explicit cross-reference to the owning parent (D1-453) and what remains open there

**Child → Wave → move-trigger map:**

| Child TODO                                                                  | Wave | Move to completed when…                                |
| --------------------------------------------------------------------------- | ---- | ------------------------------------------------------ |
| `…-src-styles-theme-css`                                                    | 1    | Wave 1 QA PASS                                         |
| `…-src-styles-index-css`                                                    | 1    | Wave 1 QA PASS                                         |
| `…-index-html`                                                              | 1    | Wave 1 QA PASS                                         |
| `…-src-styles-quota-burn-colors-test-ts`                                    | 1    | Wave 1 QA PASS                                         |
| `…-src-styles-token-layer-test-ts`                                          | 1    | Wave 1 QA PASS                                         |
| `…-docs-plugins-theme-contract-md`                                          | 2    | Wave 2 QA PASS                                         |
| `…-docs-runtime-contracts-md`                                               | 2    | Wave 2 QA PASS                                         |
| `…-docs-remote-dashboard-integration-contract-md`                           | 2    | Wave 2 QA PASS                                         |
| `…-docs-implemented-2026-06-plan-adversarial-review-20260612-md`            | 3    | Wave 3 QA PASS                                         |
| `…-docs-implemented-2026-05-plan-phosphor-atlas-implementation-md`          | 3    | Wave 3 QA PASS                                         |
| `…-docs-implemented-2026-05-plan-phosphor-atlas-implementation-closeout-md` | 3    | Wave 3 QA PASS                                         |
| `…-src-main-tsx`                                                            | 4    | Wave 4 (orchestrator-inline reclassification recorded) |

**Also required at final close-out** (from the decomposition proof `.analysis/fork-review-decomposition-d1-454-styles-docs-20260704.md:84-104`):

- `rg -c '^### D1-454-styles-docs-' .analysis/todo.md` → `0`
- `rg -n 'D1-454' .analysis/completed-202607.md` → all 12 children present
- The parent `### D1-454 —` line already absent from the active queue (decomposition-only closeout was recorded earlier).
- `git status --short` clean of stray `.analysis` error logs.

---

## Rollout Order

<!-- Dependency diagram showing dispatch sequencing. -->

```
Wave 1: CSS + style tests (TDD)
  Tester   — extend/rewrite the 2 style test files + add provider-color consistency test (~65k)
  Engineer — theme.css + index.css + index.html to make tests pass (~105k)
  QA       — review CSS/test changes
  │
  └── orchestrator-inline: move 5 Wave-1 children todo.md → completed-202607.md
  │
Wave 2: Contract docs (doc-only, depends on Wave 1 finalized token values)
  Engineer(docs) — theme-contract.md + runtime-contracts.md + integration-contract.md (~55k)
  QA             — verify doc claims match code
  │
  └── orchestrator-inline: move 3 Wave-2 children todo.md → completed-202607.md
  │
Wave 3: Archive-integrity dated corrections (doc-only, additive; independent of Wave 2)
  Engineer(docs) — 3 archive docs, dated notes only (~50k)
  QA             — verify additive-only, dates present, no silent rewrites
  │
  └── orchestrator-inline: move 3 Wave-3 children todo.md → completed-202607.md
  │
Wave 4: main.tsx C-2 coordination (NO dispatch — orchestrator-inline)
  └── record reclassification to D1-453; move 1 child todo.md → completed-202607.md
```

**This plan involves no database migrations** — the DB Foundation wave is not applicable. See Schema Verification (`N/A`).

**Dispatch sizing:** Each agent dispatch targets ~125k tokens. One tester writes all Wave-1 tests. Engineers are split into a **CSS/test engineer** (Wave 1) and a **docs engineer** (Waves 2+3) because the two surfaces exceed a single ~125k budget _and_ require different tooling (CSS/Vitest vs pure Markdown) — a split explicitly sanctioned by the sizing rules, not an organizational split. One QA reviews each wave.

**Maximum concurrent agents: 1.** This plan is serial — Wave 2 depends on Wave 1's finalized token values, and the docs engineer sequences Waves 2→3. No parallel dispatch.

## Implementation Waves

<!-- SPECIFICATION ONLY — do not modify after operator approval. -->

### Wave 1: CSS + Style Tests — token/stylesheet remediation (TDD)

**Depends on:** (none)
**Scope:** `src/styles/theme.css`, `src/styles/index.css`, `index.html`, `src/styles/quota-burn-colors.test.ts`, `src/styles/token-layer.test.ts`
**Children closed:** `theme-css`, `index-css`, `index-html`, `quota-burn-colors-test-ts`, `token-layer-test-ts`

#### Impact Analysis

**Type:** modification + deletion (CSS cleanup)
**Affected symbols / surfaces:**

- Theme tokens `--accent-warm`, `--font-inter`, `--font-manrope`, `--chart-4` (`theme.css:38,41,62-66,80-81`). Consumers: shadcn `@theme inline` mapping (`theme.css:78-119`), provider chart palettes.
- `index.css` global classes: dead-CSS removal + hardcoded-hex sweep + `.provider-summary` breakpoint ladder (`index.css:2964`) + `font-weight:700` mono rules (18 occurrences).
  **Callers/importers & grep verification (dead-CSS liveness re-confirmed 2026-07-07):**
  - `gutter-hot` → 1 hit in `index.css`, **no emitter** in `src/`; `master-ledger-table.test.tsx` asserts the ledger does NOT emit `gutter-` — safe to delete.
  - `client-section` (2), `repo-table tbody` (3) → components deleted in the documented W9 deletion sprint; no emitter — safe to delete.
  - `over-velocity` (1), `quota-anomaly-sub` (1), `tt-multiselect-option.depth-2` (1), `fleet-pulse*` (9), `attribution-legend`/`legend-cat` (6, `cat-miss` on `.health-strip-cell` stays alive) → no production emitter — safe to delete per §7 of the review.
  - **Alert CSS families (`alerts-panel` 1, `alert-item` 8, `alertPulse` 2):** `alerts-rail.tsx` is still imported by `a11y.test.tsx` and `use-alerts-from-anomalies.ts`. Deletion **DEFERRED to D1-450** (delete-vs-revive decision). See Risk SD-2. These are OUT of Wave 1 deletion scope.
  - Provider brand hexes triplicated: `index.css:3091-3132` ↔ `phosphor-dashboard.tsx` `PROVIDER_SERIES` (`~149-206`) ↔ `usage-report-display.ts`. All currently in sync (I-2); Wave 1 adds a consistency test, does not change values.
    **Grep commands the engineer/QA must re-run:** `grep -rn "gutter-hot\|client-section\|over-velocity\|fleet-pulse\|attribution-legend\|quota-anomaly-sub\|tt-multiselect-option.depth-2" src/` — every remaining hit after Wave 1 must be a live emitter or an intentional-retain with an inline rationale comment.

#### Test Spec (tester's input)

**Test files:**

- `src/styles/token-layer.test.ts` — unit (source-text tripwire, Vitest)
- `src/styles/quota-burn-colors.test.ts` — unit (source-text tripwire, Vitest)
- `src/styles/provider-color-consistency.test.ts` _(new)_ — unit (I-2 guard)
  **Test cases (must fail before implementation):**
- `token-layer::test_font_generic_families_not_quoted` — asserts `theme.css` does NOT contain the literal `'sans-serif'` as a quoted font name for `--font-inter`/`--font-manrope` (I-5); after fix, generic families are unquoted.
- `token-layer::test_no_vestigial_dark_block_machinery` — asserts the test file itself no longer adds a `.dark` block via `beforeAll` and `getCssVar` reads raw source text only (C-6); tripwire semantics documented in names, not faked cascade-awareness.
- `token-layer::test_labeled_assertions_use_message_arg` — the roundabout `toMatchObject` at `token-layer.test.ts:198` is replaced by `expect(isDefined, token).toBe(true)` (E-1 cleanup) while **all existing token-presence assertions remain** (must not weaken).
- `quota-burn-colors::test_iv_threshold_legend_bar_consistency` — asserts the five `iv-*`/`quota-*` threshold tiers (`index.css:86-105` vs `309-327`) render identical hex in both selector families, mirroring the existing `velocity-*` guard (C-5, C-7). Fails today (no such guard).
- `quota-burn-colors::test_assertBurnVarDefined_comment_matches_regex` — asserts the helper comment no longer overclaims top-level scoping OR the regex is tightened to actually enforce it (C-7).
- `provider-color-consistency::test_css_and_provider_series_hex_match` — asserts each `.tt-*` slice hex in `index.css` equals its `PROVIDER_SERIES[].color` counterpart (I-2), the same class of guard the repo already applies to quota-burn tiers.
- `token-layer::test_no_faux_bold_mono_weight` _(I-6)_ — asserts `index.css` contains no `font-weight: 700` rule targeting `--font-mono`/`IBM Plex Mono` contexts once emphasis is standardized on 600 (see SD-3). **Tester must confirm the exact assertion form with the engineer given the post-review font-loading drift.**

**Integration test enforcement:** N/A — this project's style tests are Vitest source-text tripwires, not DB integration tests. There is no database interaction in scope.

#### Source Spec (engineer's input — make the tests above pass)

**Source files:**

- `src/styles/theme.css` — I-5: unquote generic families (`--font-inter: 'Inter', sans-serif`, `--font-manrope: 'Manrope', sans-serif`). I-1/chart: resolve `--accent-warm ≡ --accent-chrome` (`#f59e0b`) making `--chart-1 ≡ --chart-4` — per SD-4 default, **document the intentional divergence with an inline comment and verify no live 5-series chart renders chart-4 distinctly**, or retune `--accent-warm` if product wants distinct series (operator decision). C-1/I-4 theme side: values here are the canonical source that Wave 2's doc table regenerates from — do not silently change the live palette to match stale docs.
- `src/styles/index.css` — Delete the confirmed-dead rule blocks enumerated in Impact Analysis (NOT alert families). G-1: delete the global `.provider-summary` column ladder (incl. the un-capped `min-1920 → 4col` at `2964`) and let `phosphor-dashboard.module.css` own the 2/4/8-col ladder (move only `grid-auto-rows: 1fr`, `justify-items`, `margin-top` if needed). G-3: sweep `rgba(58,130,243,…)` and token-bypassing hexes to `var(--accent-*)` where an exact token exists (keep true one-offs as named tokens). G-4: drop stale slate-palette `var(--fg, #e2e8f0)` fallbacks. G-5/G-6: scope `.health-strip-cell` height + `[data-sortable]::after` under the dashboard root. I-4: move `--quota-burn-*` to a documented component-token block (or leave and let Wave 2 amend the doc — coordinate). I-6: standardize mono emphasis on 600 across the 18 `font-weight:700` rules (SD-3). E-2: remove tombstone/"no CSS needed" comments. P-2/P-3/A-1/A-2: remove inline-defeated redundant rules, note remaining `!important` root cause, delete the vestigial `.is-prior` 20-line comment block. Prefer landing new/moved component rules in `@layer components`.
- `index.html` — I-6 coordination: web-font `<link>` already removed (`index.html:59`, post-review drift). Confirm no re-introduction is needed and that `--font-mono` resolves to the intended same-origin/system stack; align with the D1-446 CSP/self-hosting child before any link change. If IBM Plex Mono is desired at all, this is where self-hosting would land — default is no change beyond a corrected comment.

---

### Wave 2: Contract Docs — theme/runtime/integration (doc-only)

**Depends on:** Wave 1 (finalized `theme.css` token values)
**Scope:** `docs/plugins/theme-contract.md`, `docs/runtime-contracts.md`, `docs/remote-dashboard-integration-contract.md`
**Children closed:** `theme-contract-md`, `runtime-contracts-md`, `remote-dashboard-integration-contract-md`

#### Impact Analysis

**Type:** modification (documentation only — no code symbols touched)
**Affected surfaces / consumers:** plugin authors and remote-dashboard authors who read these contracts. No source importers.
**Grep verification:** N/A — Markdown docs have no code callers. Accuracy is verified against `theme.css` (Wave-1 final), `src/main.tsx:62-66`, and `src/context/theme-provider.tsx`.

#### Test Spec (tester's input)

`N/A — doc-only wave. No new runtime behavior to test. Accuracy is verified in QA by diffing each doc claim against the cited source file (theme.css final, main.tsx:62-66, theme-provider.tsx). The Wave-1 token-layer test transitively guards that theme.css values the doc table mirrors stay pinned.`

#### Source Spec (engineer's input)

**Source files:**

- `docs/plugins/theme-contract.md` — C-1: regenerate the stable-token value table from the finalized `theme.css` (`:root` block), OR drop the value column and state that **names, not values, are the stable API** (recommended — avoids future drift). C-4: rewrite the internal-token paragraph — remove the nonexistent `--iv-*` claim and the self-contradictory `--card-2` entry; list the real internal set (`--card-3`, `--quota-burn-*`, `--font-*`). I-4-doc: reconcile the "all base tokens live in theme.css" claim with `--quota-burn-*` placement (match whatever Wave 1 decided).
- `docs/runtime-contracts.md` — C-2-doc: the "never retry Axios 401/403" claim contradicts `src/main.tsx:62-66` (predicate ignores error status). Per SD-1 default, **rewrite the doc to state the actual current behavior** (PROD retries all errors incl. 401/403 up to 4 attempts) and add an explicit note that a status-aware no-retry policy is the intended target tracked by **D1-453**. Do not claim a guarantee the code doesn't provide.
- `docs/remote-dashboard-integration-contract.md` — C-3: rewrite the Styling Contract section to state **dark-only** operation, the load-bearing `.dark` class permanently applied to `documentElement`, and no-op theme toggles (`theme-provider.tsx` is hard-typed `Theme = 'dark'`; `theme.css` ships a single `:root` palette). Remove light/dark-toggle language. Leave the accurate scaffold/registry/port claims untouched.

---

### Wave 3: Archive-Integrity — dated correction notes (doc-only, additive)

**Depends on:** (none) — independent of Wave 2; sequenced after it only because the same docs engineer owns both.
**Scope:** `docs/implemented/2026-06-plan-adversarial-review-20260612.md`, `docs/implemented/2026-05-plan-phosphor-atlas-implementation.md`, `docs/implemented/2026-05-plan-phosphor-atlas-implementation-closeout.md`
**Children closed:** `2026-06-plan-adversarial-review-20260612-md`, `2026-05-plan-phosphor-atlas-implementation-md`, `2026-05-plan-phosphor-atlas-implementation-closeout-md`

#### Impact Analysis

**Type:** modification — **additive dated notes only**; original archive text is preserved verbatim (Fork Review Decomposition Protocol requires no silent rewrites).
**Affected surfaces:** readers auditing "was this delivered/verified?". No code consumers.
**Grep verification:** N/A — archive Markdown. Each correction cites current grep/importer evidence from HEAD (the review already recorded the evidence for D-1..D-7). QA re-confirms the cited code states still hold at execution time.

#### Test Spec (tester's input)

`N/A — deletion/archive-note wave equivalent. No new behavior to test. These are additive dated correction blocks; QA verifies (a) originals are unmodified, (b) each note carries a date, (c) each cited code state (unwired hook, absent sparkBuckets producer, unmounted AlertsRail, unenforced allowlist, clobbering date-range interval, unconsumed PhosphorTable, PENDING Wave-9 verdict) still matches HEAD.`

#### Source Spec (engineer's input)

**Source files:**

- `docs/implemented/2026-06-plan-adversarial-review-20260612.md` — append dated correction blocks for **D-1..D-6**: `useAlertsFromAnomalies`→`AlertsRail` chain unwired (D-1, D-3); `sparkBuckets` has no producer so S2-1 still runs the original bug (D-2); S6-4 allowlist enforces nothing (D-4); S4-19 date-range interval clobbers user selection (D-5); `PhosphorTable<T>` unconsumed / coverage-table S5-14 path never happened (D-6). Cite current grep evidence; do not edit original verdict tables.
- `docs/implemented/2026-05-plan-phosphor-atlas-implementation.md` — append dated notes for **D-1, D-2, D-5, D-6, D-7**; for shared items cross-reference the 2026-06 corrections. Reconcile Wave-9 "PENDING operator review" verdict vs the file's `Status: PROMOTED` header (D-7). Preserve the candid Hindsight section.
- `docs/implemented/2026-05-plan-phosphor-atlas-implementation-closeout.md` — append the D-7 closeout-side reconciliation: the unchecked close-out checklist vs promoted status; link to the main-archive D-7 note.

---

### Wave 4: `src/main.tsx` C-2 Coordination — orchestrator-inline (NO agent dispatch)

**Depends on:** Wave 2 (runtime-contracts.md updated)
**Scope:** bookkeeping/reclassification only — **no edit to `src/main.tsx`**
**Children closed:** `src-main-tsx`

#### Impact Analysis

**Type:** reclassification (no code change in this plan)
**Affected symbols:** `queryClient` retry predicate (`src/main.tsx:62-66`).
**Grep verification:** `grep -rn "D1-453-mf-shell-routing-src-main-tsx" .analysis/todo.md` confirms D1-453 already owns broader retry/chunk consolidation (M1, L7). This child is styles-docs traceability only.
**Rationale:** The child's own Known Hazard states "prefer single code owner (D1-453); avoid duplicate contradictory fixes." This plan therefore does **not** make a competing edit. C-2's doc side is resolved in Wave 2 (runtime-contracts states actual behavior + points to D1-453 for the intended status-aware fix).

#### Test Spec (tester's input)

`N/A — coordination wave, no code change. The C-2 code fix (status-aware 401/403 no-retry) is owned by D1-453 and will carry its own tests there.`

#### Source Spec (engineer's input)

`N/A — no source edit. Orchestrator records the reclassification in .analysis/completed-202607.md: C-2 doc resolved in Wave 2; code fix tracked under D1-453-mf-shell-routing-src-main-tsx (still open there).`

## Schema Verification

`N/A — no SQL, ORM queries, migrations, or column references are in scope. This plan touches CSS, Markdown docs, and Vitest source-text tests only.`

## Risks and Mitigations

| #    | Risk                                                                                                                                                                                                                                     | Likelihood              | Impact | Mitigation                                                                                                                                                                                             |
| ---- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| SD-1 | **C-2 scope decision:** default resolves the runtime-contracts doc to _actual_ behavior and defers the code fix to D1-453, leaving PROD retrying 401/403.                                                                                | Certain (design choice) | MED    | Flagged for operator. Alternative = fix `main.tsx` here (small change) — rejected to avoid competing edits with D1-453 per the child's own hazard. Operator may override.                              |
| SD-2 | **Alert-CSS deletion coupling:** deleting `alerts-panel`/`alert-item`/`alertPulse` (D-3) would break `a11y.test.tsx` / `alerts-rail.test.tsx`, which still import the unmounted `AlertsRail`.                                            | High if deleted         | HIGH   | Defer alert-family CSS deletion to the D1-450 `use-alerts-from-anomalies` delete-vs-revive decision. Wave 1 deletes only unambiguously-dead CSS.                                                       |
| SD-3 | **I-6 premise drift:** review assumed `index.html` loads mono 400/500/600; the web-font link was removed post-review (`index.html:59`), so IBM Plex Mono is now unloaded and every `font-weight:700` is faux-bold on system `monospace`. | Certain                 | LOW    | Default: standardize mono emphasis on 600 in `index.css`; leave `index.html` fonts as-is and coordinate any self-hosting with the D1-446 CSP child.                                                    |
| SD-4 | **Palette retune blast radius:** changing `--accent-warm` to distinguish `--chart-4` from `--chart-1` (I-1) could shift dashboard provider colors.                                                                                       | Medium                  | MED    | Default: document the intentional amber divergence + verify no live 5-series chart renders chart-4 distinctly (providers use `PROVIDER_SERIES`, not raw `--chart-N`). Retune only on operator request. |
| R-5  | Deleting a rule that grep missed (dynamic template-literal class construction).                                                                                                                                                          | Low                     | MED    | The review already grep-verified template-literal patterns; QA re-runs the enumerated grep set and spot-checks the dashboard at ≥2100px, ≥3840px widths.                                               |
| R-6  | Regenerated theme-contract table drifts again on next palette change.                                                                                                                                                                    | Medium                  | LOW    | Prefer the "names, not values, are the stable API" option (drop the value column).                                                                                                                     |
| R-7  | Bookkeeping skipped/batched, leaving `todo.md` inaccurate mid-flight.                                                                                                                                                                    | Medium                  | MED    | Bookkeeping Protocol section makes per-child movement a wave definition-of-done; `rg -c` count is a close-out gate.                                                                                    |

## Close-Out Checklist

- [x] QA is MANDATORY for every dispatched wave (1, 2, 3). No exceptions.
- [x] QA dispatched and PASS for every wave (inline under h4) — Wave 1 (7/7), Wave 2 (5/5), Wave 3 (PASS after D-4/D-6 fix re-QA)
- [x] **Each remediated child moved `todo.md` → `completed-202607.md` INLINE as its wave passed QA (not batched)** — 12/12
- [x] `grep -c '^### D1-454-styles-docs-' .analysis/todo.md` → `0` (rg unavailable; grep used)
- [x] Eyes tristore update (N/A — no context injection changed)
- [x] Ops validation (`pnpm vitest run src/styles/` ×2 idempotent + `pnpm lint` 0 errors — GATE GREEN)
- [x] Gate check green (lint + tests) — develop `126adbd`
- [x] Smoke test PASS (style-token tripwires 27/27 green)
- [x] Operator nudges captured in retrospective (0 nudges — operator did not intervene)
- [x] Lessons learned (what worked, what didn't, process improvements, metrics)
- [x] Hindsight ("what would you do differently" — 7 items)
- [x] Tool errors documented (infra cooldown, land contention, EROFS, rg-missing, grunt-unavailable)
- [x] Suggested persona/template adjustments (see Lessons + Suggested Persona/Template section)
- [ ] Plan promoted to `docs/implemented/2026-07-d1-454-styles-docs-remediation.md` (CO-7 — via `/promote`)

## Smoke Test Procedure

This is a frontend CSS/docs plan; smoke checks are Vitest source-text tripwires (no Python/pytest, no live DB).

CO-2 executes: `pnpm vitest run src/styles/` and `pnpm lint`.

Required smoke assertions (as Vitest test names with one-line intent):

- `test_font_generic_families_not_quoted()` — `theme.css` no longer quotes `'sans-serif'` as a font name (I-5).
- `test_iv_threshold_legend_bar_consistency()` — iv/quota threshold tiers agree across both selector families (C-5/C-7).
- `test_css_and_provider_series_hex_match()` — provider brand hexes match between `index.css` and `PROVIDER_SERIES` (I-2).
- `test_no_dead_css_selectors_remain()` — grep-style assertion that the enumerated dead selectors are absent from `index.css`.
- `test_token_layer_imports()` — verifies the style test modules load without error.

For assertions requiring live rendering (visual regression at ≥2100px/≥3840px): performed manually by QA in-browser; no `@pytest.mark.integration` (non-Python repo).

## Confidence Notes (Pre-Execution)

| Wave | Pre-Execution | Post-Execution | Notes                                                                                                                                                                                                                                                                    |
| ---- | ------------- | -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1    | MEDIUM        | **HIGH**       | Delivered clean: 27/27 style tests, lint 0, dead-CSS grep = 2 comment-only hits, SD-2 alerts preserved. The feared ultrawide visual regression survives only as an **un-run in-browser G-1 check** (residual manual item), not a detected defect. First-attempt QA PASS. |
| 2    | HIGH          | **HIGH**       | Delivered + surfaced DEV-1: the C-2 "retries 401/403" premise was stale — code already status-aware (D1-453). Docs matched to reality. First-attempt QA PASS.                                                                                                            |
| 3    | HIGH          | **MEDIUM**     | Delivered but needed 1 re-dispatch: D-4/D-6 notes cited files deleted by D1-452/D1-453 — "additive-only" was easy, "still true at HEAD" tripped. Re-QA PASS after fix `9ad1f5e`.                                                                                         |
| 4    | HIGH          | **HIGH**       | Even cleaner than planned: D1-453 had already closed the C-2 code fix, so reclassification was pure traceability. No competing edit.                                                                                                                                     |

## Dispatch Plan

<!-- EXECUTION LOG — update in real-time during execution. -->

### Keepalive Cron

- Job ID: `76a86a2a` (hourly at :13; session-only, auto-expires after 7 days). **Do not cancel** — keeps context warm for operator questions.

### Wave 0: Infrastructure Health Check (Required before first dispatch)

| Check                 | Command                                                        | Expected                               | Actual                                                                                                                                                                               |
| --------------------- | -------------------------------------------------------------- | -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| CWD                   | `pwd` (foreground, alone)                                      | `/home/zepfu/projects/dashboard-shell` | ✅ `/home/zepfu/projects/dashboard-shell`                                                                                                                                            |
| Branch                | `git branch --show-current`                                    | `develop`                              | ✅ `develop`                                                                                                                                                                         |
| Worktrees             | `ls .claude/worktrees/`                                        | empty                                  | ⚠️ 4 PRE-EXISTING (other sessions): `agent-a2d6ae0530b60aa73`, `agent-a77ed948a164585ee`, `agent-a82ecd231fa7b3e67`, `agent-a94c99ca0b212c2ee` — do NOT touch                        |
| Git status            | `git status --short`                                           | clean                                  | ✅ clean                                                                                                                                                                             |
| Gate baseline         | `pnpm vitest run src/styles/ && pnpm lint`                     | style tests + lint PASS                | ⚠️ Cannot run in main repo — `node_modules` is read-only (EROFS on vitest temp write). Baseline = `develop` (shared post-gate integration branch). Tests execute in agent worktrees. |
| Font-loading re-check | `grep -n "googleapis\|@font-face" index.html src/styles/*.css` | no web-font link (confirms SD-3)       | ✅ none found — confirms SD-3                                                                                                                                                        |
| MCP tasks             | `list_tasks`                                                   | no prior-plan tasks                    | ⚠️ Many pending/active tasks from OTHER concurrent sessions (3 active: gate-check, tester, promote). Only my 14 plan tasks are managed here.                                         |

### Infrastructure Prerequisites Checklist

| Capability                           | Required By                      | Exists? | If Not: Add as Wave 0 step |
| ------------------------------------ | -------------------------------- | ------- | -------------------------- |
| Test database accessible             | (none — no DB work)              | N/A     | —                          |
| Migration tool configured            | (none)                           | N/A     | —                          |
| Integration test suite runnable      | (none — Vitest source-text only) | N/A     | —                          |
| `pnpm` + Vitest runnable in worktree | Wave 1 tests                     | Yes     | —                          |

### Total Estimated Effort

| Category                   | Planned Dispatches | Notes                                                                                    |
| -------------------------- | ------------------ | ---------------------------------------------------------------------------------------- |
| Tester                     | 1                  | Wave 1 — all style tests                                                                 |
| Engineer                   | 2                  | CSS/test engineer (Wave 1) + docs engineer (Waves 2+3) — split by token budget & tooling |
| QA                         | 3                  | One per dispatched wave (1, 2, 3)                                                        |
| Orchestrator-inline        | 4 waves            | Bookkeeping movements + Wave 4 reclassification                                          |
| **Total dispatched waves** | **3**              | Wave 4 has no dispatch                                                                   |
| **Max concurrent agents**  | **1**              | Serial plan                                                                              |

### Token Estimate

| Dispatch                  | Target files                                                                                   | Est. tokens | Rationale                                                                                                          |
| ------------------------- | ---------------------------------------------------------------------------------------------- | ----------- | ------------------------------------------------------------------------------------------------------------------ |
| Tester (Wave 1)           | `token-layer.test.ts`, `quota-burn-colors.test.ts`, `provider-color-consistency.test.ts` (new) | ~65k        | 3 test files; must read `theme.css` (120L) + relevant `index.css` ranges + `PROVIDER_SERIES` for hex pairs         |
| Engineer-CSS (Wave 1)     | `theme.css`, `index.css`, `index.html`                                                         | ~105k       | `index.css` is 3,560 lines (~20k to load) + many deletions/edits + dead-CSS grep iteration + in-browser spot-check |
| Engineer-Docs (Waves 2+3) | 3 contract docs + 3 archive docs                                                               | ~55k        | Targeted edits; review supplies exact line refs for D-1..D-7, so full archive re-reads are unnecessary             |
| QA (per wave)             | (read-only)                                                                                    | ~30k each   | Review each wave's diff                                                                                            |

### Wave 1: CSS + Style Tests

#### Dispatch 1: Tester

| Agent  | Target files                                                                                                                    | Task                                                                                                                                                                   |
| ------ | ------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| tester | `src/styles/token-layer.test.ts`, `src/styles/quota-burn-colors.test.ts`, `src/styles/provider-color-consistency.test.ts` (new) | Write failing source-text tripwire tests per Wave 1 Test Spec (I-1/I-5/I-6/C-5/C-6/C-7/I-2 guards). Confirm I-6 assertion form with engineer given font-loading drift. |

#### Dispatch 2: Engineer (CSS)

| Agent    | Target files                                                 | Task                                                                                                                                                                              |
| -------- | ------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| engineer | `src/styles/theme.css`, `src/styles/index.css`, `index.html` | Make Wave 1 tests pass; delete enumerated dead CSS (NOT alert families); G-1 ladder move; hex/fallback sweeps; mono-600 standardization. In-browser spot-check ≥2100px & ≥3840px. |

**Two-Strike Escalation (if Dispatch 2 agent fails twice):**

- Root cause: likely a visual regression from the G-1 `.provider-summary` ladder move or a grep-missed dynamic selector.
- Escalation: researcher to root-cause the cascade/module load-order interaction; re-scope the ladder change if needed.

#### Dispatch 3: QA

| Agent | Target files | Task                                                                                                                                    |
| ----- | ------------ | --------------------------------------------------------------------------------------------------------------------------------------- |
| qa    | (read-only)  | Verify test quality + CSS correctness; re-run dead-CSS grep set; confirm alert families untouched (SD-2); confirm no visual regression. |

_Orchestrator-inline after Dispatch 3 PASS:_ move `theme-css`, `index-css`, `index-html`, `quota-burn-colors-test-ts`, `token-layer-test-ts` from `todo.md` → `completed-202607.md` with evidence.

### Wave 2: Contract Docs

#### Dispatch 1: Tester

_Skipped — doc-only wave (no failing tests; accuracy verified in QA)._

#### Dispatch 2: Engineer (Docs)

| Agent    | Target files                                                                                                   | Task                                                                                                              |
| -------- | -------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| engineer | `docs/plugins/theme-contract.md`, `docs/runtime-contracts.md`, `docs/remote-dashboard-integration-contract.md` | Regenerate/rewrite per Wave 2 Source Spec (C-1, C-4, I-4-doc, C-2-doc→actual behavior+D1-453 ref, C-3 dark-only). |

#### Dispatch 3: QA

| Agent | Target files | Task                                                                                       |
| ----- | ------------ | ------------------------------------------------------------------------------------------ |
| qa    | (read-only)  | Diff each doc claim against finalized `theme.css`, `main.tsx:62-66`, `theme-provider.tsx`. |

_Orchestrator-inline after PASS:_ move `theme-contract-md`, `runtime-contracts-md`, `remote-dashboard-integration-contract-md` → completed.

#### Wave 2-c: QA

**Reviewer:** qa · **Date:** 2026-07-07
**Engineer commit:** `2c6aeda` (merge `a8c4fa6`) — "docs(D1-454): align theme, runtime, and remote styling contracts with code"
**Scope:** doc-only (no tests). Each doc CLAIM verified against CURRENT source, file:line cited.

### Verdict: **PASS** (5/5 checks)

| #   | Check                                     | Verdict | Evidence                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| --- | ----------------------------------------- | ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | C-1 stable-token no drifting value column | PASS    | `theme-contract.md:23-34` table has only **Token \| Purpose** columns — **no value column** (approach taken: names, not values, are the stable API, the recommended option). `theme-contract.md:18-21` explicitly states "These token **names** are the stable public API" and "**Do not depend on documented default hex values**… Read current values from `theme.css` `:root`." No drift risk.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| 2   | C-4 internal-token paragraph correct      | PASS    | No `--iv-*` claim — `theme-contract.md:51-53` explicitly states `iv-*` are **CSS class names** (`.quota-interval.iv-5-10`), "There are no `--iv-*` tokens in the repo" — confirmed: `grep -- '--iv-' src/styles/` returns **0 hits**; `.iv-` classes exist at `index.css:86-102`. No self-contradictory `--card-2` handling in §1.2 (`--card-2` appears only in the §1.1 stable table `theme-contract.md:33`, not the internal set). Internal set listed (`theme-contract.md:41-49`) all exist: `--card-3` → `theme.css:34` ✓; `--quota-burn-slow/steady/fast/hot/peak` → `index.css:112-116` ✓; `--font-inter/manrope/mono/sans/serif` → `theme.css:82-86` ✓. No listed internal token missing; no real internal token omitted.                                                                                                                                                                                                                                                                                                 |
| 3   | I-4-doc split stated accurately           | PASS    | `theme-contract.md:10-14` states base palette in `theme.css` on a single `:root`, **component tokens such as `--quota-burn-*` live in `index.css` inside `@layer components { :root { … } }`**. Verified: `index.css:109-118` is exactly `@layer components { :root { --quota-burn-*: … } }` (line 109 ~matches "~line 109"). §1.2 (`theme-contract.md:43-44`) reiterates quota-burn is in "`index.css` `@layer components`, not `theme.css`". No contradictory "all base tokens live in theme.css" claim remains — doc scopes it to "**base palette**" and carves out component tokens explicitly.                                                                                                                                                                                                                                                                                                                                                                                                                              |
| 4   | C-2-doc matches ACTUAL status-aware code  | PASS    | `runtime-contracts.md:72-79` diffed clause-by-clause against `src/main.tsx:59-75` `shouldRetryQuery(failureCount, error)`: DEV → no retries (doc "Disabled in development… `isShellQueryRetryDevMode`" ↔ `main.tsx:64`); `failureCount > 3` stop / ≤4 attempts (doc "no further retries once `failureCount > 3`… at most four failed attempts" ↔ `main.tsx:65`); status read from `error.status` (doc "`readHttpStatus`, lines ~45–51" ↔ `main.tsx:45-51`); status missing → retry (doc "retry when status is missing" ↔ `main.tsx:68`); **401/403/404 → no retry** (doc "do **not** retry `401`, `403`, or `404`" ↔ `main.tsx:70`); 408/429 → retry (↔ `main.tsx:71`); 5xx → retry (↔ `main.tsx:72`); other 4xx → no retry (doc "do not retry other status codes" ↔ `main.tsx:74` `return false`). **Zero mismatches.** Doc matches the current status-aware code (not the stale "retries 401/403" spec). D1-453 cross-reference present: `runtime-contracts.md:78-79` "tracked in **`D1-453-mf-shell-routing-src-main-tsx`**". |
| 5   | C-3 dark-only styling contract            | PASS    | `remote-dashboard-integration-contract.md:185-191` states dark-only: `theme-provider.tsx` hard-types `Theme`/`ResolvedTheme` as `'dark'` (↔ `theme-provider.tsx:3-4`), `setTheme`/`resetTheme` documented no-ops (↔ `theme-provider.tsx:32-38`), on mount removes `light` + permanently adds `.dark` to `documentElement` (↔ `theme-provider.tsx:26-30`), single `:root` palette (↔ `theme.css:26-79`, one `:root`, no `.dark` fork). Light/dark-toggle language removed: `git show 2c6aeda` shows the old "Runtime CSS variables for light and dark themes" (L28), "shell toggles `.dark`… same light and dark palettes" (L225-228) **replaced** with dark-only text; no toggle language remains in the styling section. Scaffold/registry/port claims unchanged — the diff touches only 3 hunks (both styling-related + one token-family note); Scaffold (`:274-299`), Shell Registration Checklist (`:302-329`), and Verification/port claims (`:331-353`) are untouched.                                                     |

**Tooling note:** doc-only wave — no vitest. Verification is source-diff of each claim against `src/main.tsx`, `src/styles/theme.css`, `src/styles/index.css`, `src/context/theme-provider.tsx` at HEAD.

**Runtime-contracts retry section:** **MATCHES** the current status-aware `shouldRetryQuery` (`src/main.tsx:59-75`) clause-by-clause — this is a PASS (doc correctly describes actual code, not the stale fork-review premise; DEV-1 deviation at plan line 389 corroborated).

**Overall: PASS.** Orchestrator may proceed to move the 3 Wave-2 children (`theme-contract-md`, `runtime-contracts-md`, `remote-dashboard-integration-contract-md`) from `todo.md` → `completed-202607.md` with QA verdict + changed paths + findings.

### Wave 3: Archive-Integrity Corrections

#### Dispatch 1: Tester

_Skipped — additive doc-note wave._

#### Dispatch 2: Engineer (Docs)

| Agent    | Target files                                                        | Task                                                                 |
| -------- | ------------------------------------------------------------------- | -------------------------------------------------------------------- |
| engineer | 2026-06 adversarial-review, 2026-05 phosphor main, 2026-05 closeout | Append dated D-1..D-7 correction notes; preserve originals verbatim. |

#### Dispatch 3: QA

| Agent | Target files | Task                                                                            |
| ----- | ------------ | ------------------------------------------------------------------------------- |
| qa    | (read-only)  | Confirm additive-only, dates present, each cited code state still true at HEAD. |

_Orchestrator-inline after PASS:_ move the 3 archive children → completed.

#### Wave 3-c: QA

**Reviewer:** qa · **Date:** 2026-07-07
**Commit under review:** `38cd12b` (merge `f3032a2`) — "docs(D1-454): append archive-integrity correction notes (Wave 3)"
**Actual develop HEAD at review:** `e9e6dfe` (notes self-cite verification at `5b4ab9c` — develop advanced one merge since; not itself the defect).
**Scope:** 3 archive docs, additive dated notes. Read-only. Each cited code state re-verified independently with `grep`/`git` at HEAD.

### Verdict: **FAIL (checklist item 3 — D-4 and D-6 cite deleted files as present dead/test-only code)**

| #   | Check                                 | Verdict  | Evidence                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| --- | ------------------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Additive-only (CRITICAL)              | **PASS** | `git show 38cd12b --stat` = `+33 −1` across 3 files; all `+` are appended `## Post-Promotion Corrections` blocks at EOF. The lone `−1` in `2026-05-plan-phosphor-atlas-implementation.md` is a **pure Prettier whitespace reflow** of the pre-existing "Cost$" hindsight bullet (line 477). `git show 38cd12b --word-diff-regex='.'` shows the ONLY changes on that line are removed spaces `[- -]` around inline-code spans (e.g. `` `new RegExp('Cost$', 'i')`where JS`$` ``); **zero** word/verdict/content change. No original verdict tables, Hindsight prose, or Wave-QA blocks altered in meaning.                                                                                                                                                                                                                                                                                                           |
| 2   | Every note dated + D1-454 attribution | **PASS** | All appended blocks headed `## Post-Promotion Corrections (2026-07-07 — D1-454 archive integrity)` and each `>` block opens `**Correction (2026-07-07, D1-454) — D-n …**`. 2026-06 doc: 5 blocks (D-1/D-3, D-2, D-4, D-5, D-6). 2026-05 main: 2 blocks (D-1/D-2/D-5/D-6 roll-up, D-7). Closeout: 1 block (D-7).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| 3a  | D-1/D-3 alert path matches HEAD       | **PASS** | `grep useAlertsFromAnomalies src --excl tests` → only its own def+comments (`use-alerts-from-anomalies.ts:2,466,474`), **no prod importers**. `AlertsRail` referenced only by `alerts-rail.tsx` (def), `alerts-rail.test.tsx`, `a11y.test.tsx`, and a comment in the hook — **not mounted** in `index.tsx`/layout. Live path `useDashboardAlertSummary` confirmed at `index.tsx:64` (import) + `:872`. Note is accurate.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| 3b  | D-2 (sparkBuckets) drift framing      | **PASS** | Producer EXISTS: `lib/ledger-rows.ts` sets `sparkBuckets` (`:183-215,270,308-309,449`), consumed via `buildModelRows` in `components/phosphor-dashboard.tsx:85,1143,1333`; `sumSpark` branch reads `row.sparkBuckets` in `components/master-ledger-aggregation.ts:114-153`. Note correctly frames the S2-1 "no producer" claim as **STALE / later-remediated (HEAD drift)**, not a still-live bug ("Do not assert 'no producer' at HEAD — remediated after promotion"). Accurate. _(Minor: note references `master-ledger-aggregation.ts` which now lives under `components/`, not `lib/`; line ref `:116-133` still resolves to the `sumSpark` branch. Non-blocking.)_                                                                                                                                                                                                                                             |
| 3c  | D-4 (S6-4 allowlist) matches HEAD     | **FAIL** | Note (present tense): "**HEAD:** `src/routes/_authenticated/aawm-tap/-allowed-pages.ts` is imported **only** by `src/shell/remote-dashboard.test.tsx`." **That file does not exist at HEAD** — deleted by `92159e3` (D1-453, 2026-07-07 09:15, "delete dead aawm-tap-page and allowed-pages"). `92159e3` is an **ancestor of the note's own cited SHA `5b4ab9c`** (11:32) — so the file was already gone when the note claims to have verified it. `remote-dashboard.test.tsx` contains **no** allowed-pages import (`grep 'allowed\|ALLOWED' remote-dashboard.test.tsx` → 0). No allowlist concept remains anywhere in `src` (`grep -r 'allowlist\|allowed-pages\|allowedPage' src` → NONE). The note's higher-order conclusion ("splat route renders with no allowlist gate") is **still true** (`$.tsx` has no gate), but the **cited evidence is false** — it cites a deleted file as a live test-only fixture. |
| 3d  | D-5 (S4-19 date-range) drift framing  | **PASS** | `index.tsx:310-341` `syncRangeToEasternDay` computes `wasDefaultRange`/`wasPreviousDefaultRange`; advances **only** the default or previous-day-default window, else `return prev`. Note correctly frames the S4-19 "unconditional clobber" as **FIXED / HEAD drift** ("Do not assert unconditional clobber at HEAD… preserves non-default user ranges"). Accurate.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| 3e  | D-6 (PhosphorTable) matches HEAD      | **FAIL** | Note (present tense): "**HEAD:** `…/primitives/phosphor-table.tsx` has **zero** production consumers … no imports outside tests such as `wave-11-phosphor-table.test.tsx` … the primitive is **test-maintained dead code**." **Both the primitive AND that test do not exist at HEAD.** `phosphor-table.tsx` deleted by `1954e37` (D1-452, 09:14, `-151` lines); `wave-11-phosphor-table.test.tsx` also gone (`find src -iname '*phosphor-table*'` → nothing; `grep -r PhosphorTable src` → 0). Both deletions are **ancestors of the note's cited SHA `5b4ab9c`**. The conclusion ("ledger uses `MasterLedgerSortHeader`") is **still true** (`master-ledger-table.tsx:45,529`), but the cited state — a surviving test-only primitive — is **false**; the code is fully deleted, not "test-maintained."                                                                                                           |
| 3f  | D-7 (Wave-9 PENDING vs PROMOTED)      | **PASS** | `2026-05-plan-phosphor-atlas-implementation.md` header `Status: PROMOTED (2026-05-20)`; Wave 9 `**Verdict:** PENDING operator review.` at `:709`; Close-Out Checklist `:713-726` entirely `[ ]`. Both the main-archive note and the closeout note state this discrepancy factually with no rewrite of the Wave-9 body. Accurate.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| 4   | Originals preserved                   | **PASS** | Diff = appended lines + the single whitespace reflow (item 1). Verdict tables, Hindsight §9a, and Wave-QA blocks read as before.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |

### Additive-only / reflow assessment (explicit)

Additive-only is **confirmed**. Exact reflowed line = **line 477** of `2026-05-plan-phosphor-atlas-implementation.md** (the `**Cost header rename ("Cost$" → "Cost"):**` hindsight bullet). Character-level word-diff proves the "deletion" removed only spaces adjacent to inline-code spans (`…'i')`where JS`…`, `…the`$`was…`, `…literal `$`in…`) — the SAME text, Prettier-reflowed, **no content or verdict change**. This "1 deletion" is benign exactly as the engineer reported.

### FAIL detail — D-4 and D-6 are stale at their own cited SHA

The correction notes are present-tense "**HEAD:**" assertions whose stated purpose is archive integrity, yet two of them cite source files that were **already deleted** before the notes were written and before the notes' self-cited verification SHA `5b4ab9c`:

- **D-4:** `src/routes/_authenticated/aawm-tap/-allowed-pages.ts` — deleted by `92159e3` (D1-453). Note claims it exists and is imported by `remote-dashboard.test.tsx`. It is not.
- **D-6:** `src/features/dashboard/components/primitives/phosphor-table.tsx` **and** `wave-11-phosphor-table.test.tsx` — deleted by `1954e37` (D1-452). Note claims the primitive is live-in-tree "test-maintained dead code." It is fully removed.

An auditor following either note would search for the cited files and find nothing — the notes actively mislead on current state. Per Wave-3 Test Spec (line 180), QA must confirm "each cited code state … still matches HEAD"; for D-4/D-6 it does not. The narrative CONCLUSIONS (no allowlist gate; ledger uses the sort header, not PhosphorTable) remain true — indeed the deletions strengthen them — but the **cited evidence is false**, which is a factual defect, not a rationalizable pre-existing condition.

### Failure Routing

Re-dispatch the **docs engineer** to correct only the D-4 and D-6 blocks in `docs/implemented/2026-06-plan-adversarial-review-20260612.md` (and the D-6 cross-reference roll-up in `2026-05-plan-phosphor-atlas-implementation.md`), re-verified against **current** HEAD:

- **D-4:** state that `-allowed-pages.ts` was **deleted** by D1-453 (`92159e3`, 2026-07-07); no allowlist artifact remains in `src`; the splat route `$.tsx` still renders `AawmTapSplatPage` with no gate — conclusion unchanged, evidence corrected.
- **D-6:** state that `primitives/phosphor-table.tsx` (and `wave-11-phosphor-table.test.tsx`) were **deleted** by D1-452 (`1954e37`, 2026-07-07); `PhosphorTable<T>` no longer exists in the tree; the ledger's keyboard-sort a11y is provided by `MasterLedgerSortHeader` (`master-ledger-table.tsx:529`, `master-ledger-table-sort-header.tsx`) — conclusion unchanged, evidence corrected.
- Update the self-cited verification SHA to a real current HEAD (or drop the specific SHA in favor of "re-verified 2026-07-07").
- D-1/D-3, D-2, D-5, D-7 blocks are accurate and require **no** change. Additive-only structure and dating are correct.

**Do NOT move the `2026-06-…-md` child to completed** until the re-dispatch lands and re-passes QA. The `2026-05-…-closeout-md` child (D-7 only) is clean and may proceed independently; the `2026-05-…-implementation-md` child carries the D-6 roll-up defect and is also blocked.

---

**Re-QA (2026-07-07, fix `9ad1f5e`):** **PASS — overall Wave 3 verdict is now PASS.**

Scope: re-checked ONLY the two prior FAIL items (D-4, D-6); all other items retain their earlier PASS.

- **D-4 — PASS.** The D-4 block in `2026-06-plan-adversarial-review-20260612.md` now reads: "`…/-allowed-pages.ts` and `…/remote-dashboard.test.tsx` (its former sole importer) **were deleted** in D1-453 commit `92159e3`… absent at develop HEAD (`ls` → no such file)." Verified independently: `git log --oneline -1 92159e3` = `92159e3 fix(D1-453): Wave 2 MF shell + routing GREEN remediation` (real ancestor); `ls src/routes/_authenticated/aawm-tap/-allowed-pages.ts` → "No such file or directory"; `grep -rl 'allowed-pages\|ALLOWED_PAGES' src/` → **empty**. Still-true conclusion retained: splat route `$.tsx` renders `AawmTapSplatPage` with no allowlist gate. Present-tense "is imported by a live test" falsehood removed.
- **D-6 — PASS.** The D-6 block (2026-06 doc) and its cross-ref one-liner (2026-05 implementation doc) now both read: "`…/primitives/phosphor-table.tsx` and `wave-11-phosphor-table.test.tsx` **were deleted** in D1-452 commit `1954e37`… `grep -rl PhosphorTable src/` → no matches." Verified independently: `git log --oneline -1 1954e37` = `1954e37 fix(dashboard): Wave 1 D1-452 primitives GREEN remediation` (real ancestor); `grep -rl PhosphorTable src/` → **empty**. Conclusion retained: ledger uses `MasterLedgerSortHeader`; `PhosphorTable<T>` never shipped to production and is now removed entirely. "Test-maintained dead code (still in tree)" falsehood removed.
- **Additive/surgical — PASS.** `git show 9ad1f5e --stat` = exactly 2 files, `3 insertions(+), 3 deletions(-)`: `2026-05-plan-phosphor-atlas-implementation.md` (+1/−1, the D-6 roll-up one-liner only) and `2026-06-plan-adversarial-review-20260612.md` (+2/−2, the D-4 and D-6 blocks only). Word-diff confirms only D-4/D-6 sentences changed; no other correction block, archive body, verdict table, or the D-7 closeout doc was touched.

**Disposition:** All three children (`2026-06-…-md`, `2026-05-…-implementation-md`, `2026-05-…-closeout-md`) are now clean and **may be moved to completed**. Wave 3 is fully PASS.

### Wave 4: main.tsx Coordination

_No dispatch._ Orchestrator records C-2 reclassification to D1-453 and moves `src-main-tsx` → completed with cross-reference.

**✅ DONE (2026-07-07):** C-2 closed on BOTH sides — doc (Wave 2 `runtime-contracts.md`) + code (D1-453, already landed; `D1-453-mf-shell-routing-src-main-tsx` is in `completed-202607.md`, `src/main.tsx:59-75` `shouldRetryQuery` is status-aware). Plan SD-1 premise was stale at execution (DEV-1). No competing edit made. `src-main-tsx` child moved `todo.md` → `completed-202607.md`.

**FINAL BOOKKEEPING (all waves):** `grep -c '^### D1-454-styles-docs-' .analysis/todo.md` → **0** (was 12). All **12/12** children in `completed-202607.md`. Parent `### D1-454 —` absent from active queue.

**Rules:**

- Dispatches sized by token budget (~125k) — Wave 1 CSS engineer and Waves 2+3 docs engineer are split by budget + tooling, not by feature.
- Deletion/doc-only waves skip the tester phase (Waves 2, 3).
- This plan is serial; max 1 concurrent agent.
- Bookkeeping movement is orchestrator-inline immediately after each wave's QA PASS.

## Operator Nudges

_Update immediately when operator corrects approach. Do not batch or defer._

1. _(none yet — pre-execution)_

## Execution Deviations (self-recorded)

**DEV-1 (Wave 2, C-2 / SD-1 premise stale):** The plan (and fork review) assumed `src/main.tsx` retry predicate ignores HTTP status → PROD retries 401/403 → code fix deferred to D1-453. **This is no longer true on `develop`.** Current `src/main.tsx:59-75` exports `shouldRetryQuery(failureCount, error)` which IS status-aware: DEV → no retries; `failureCount > 3` → stop; unknown status → retry; **401/403/404 → no retry**; 408/429/5xx → retry; other 4xx → no retry. The C-2 _code_ fix is therefore effectively ALREADY present in the tree (landed by D1-453 or a sibling since the fork review). The Wave 2 docs engineer correctly documented the ACTUAL status-aware behavior in `runtime-contracts.md` rather than the stale "retries 401/403" spec. **Impact on Wave 4:** the C-2 reclassification note must record that the code fix is present/matching, not "open/deferred" — verify D1-453 child status at Wave 4.

## Tool Errors and Infrastructure Failures

_Log as they occur, not reconstructed at close-out._

| Error                                                                    | Frequency                    | Context                                                                                                                                                                                                                                                                                                        | Resolution                                                                                                                                                                                      |
| ------------------------------------------------------------------------ | ---------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `EROFS: read-only file system` on vitest temp write                      | Wave 0 baseline              | Main repo `node_modules` is mounted read-only; orchestrator cannot run `pnpm vitest` directly                                                                                                                                                                                                                  | Expected fleet setup — tests run in agent worktrees (writable node_modules). Baseline taken as `develop` (post-gate branch). Not a blocker.                                                     |
| `aawm_anthropic_auto_agent_in_flight_provider_cooling_down` (rate_limit) | Wave 1-a tester, attempt 1   | Auto-agent alias cooling down; provider switching disabled mid-session. Agent terminated at startup — zero forward progress                                                                                                                                                                                    | Infra, not agent fault. Cleaned orphan worktree `agent-aa202ad1345bcbc37`, redispatched fresh tester per the error's own guidance. Does NOT count toward the two-strike rule (no real attempt). |
| `land` merge refused: "local changes would be overwritten"               | Wave 1-a tester land         | **Cross-session contention** — another session's in-flight `/promote` left `docs/implemented/2026-07-plan-d1-448-449-fork-review-remediation.md` UNCOMMITTED (212+/166−) in the SHARED main-repo working tree. Land merges into develop in the main checkout → git refuses to overwrite their uncommitted file | Tester commit `67b029f` safe on branch `worktree-agent-ad8894cfdc2c57ed3`. NOT stashing/discarding their work. Monitored main-repo tree; landed the moment it cleared (<30s).                   |
| Agent type `grunt` not found                                             | CO-1 gate dispatch           | `grunt` not in this fleet's agent roster                                                                                                                                                                                                                                                                       | Re-dispatched close-out gate as `engineer` (worktree). No impact.                                                                                                                               |
| Model `claude-sonnet-5-[1m]` unavailable                                 | Gate 3 researcher, attempt 1 | Auto-router selected an inaccessible model; agent terminated at startup, 0 progress                                                                                                                                                                                                                            | Infra, not review failure. Redispatched researcher with explicit `model=opus` override.                                                                                                         |

---

<!-- ============================================================= -->
<!-- EXECUTION TEMPLATE SHELLS — appended per plan-template-execution; fill during execution. -->
<!-- ============================================================= -->

## Outcomes

### Wave 1: CSS + Style Tests — token/stylesheet remediation (TDD)

**Status:** DONE
**Test commit(s):** `67b029f` (merge `52429de`) — failing Vitest tripwires (red phase)
**Test agent:** tester (attempt 2; attempt 1 died on infra cooldown, 0 progress)
**Source commit(s):** `3ecc481` (merge `da1c964`) — CSS/test remediation (green phase)
**Source agent:** engineer
**QA verdict:** PASS (7/7)
**Actual changes:** theme.css (I-5 unquote, I-1/SD-4 comment), index.css (I-6 mono-600 ×10, dead-CSS deletion non-alert, G-1 ladder→phosphor-dashboard.module.css, G-3 color-mix, G-4/G-5/G-6, I-4 @layer components, A-2, E-2), 2 test files (C-6/E-1/C-7 cleanup) + new provider-color-consistency.test.ts (I-2). 27/27 tests green, lint 0.
**Deviations:** G-1 ladder moved into phosphor-dashboard.module.css (plan-sanctioned by G-1 spec). SD-2 alert families NOT deleted (deferred to D1-450 as planned).
**Findings:** Residual manual item — in-browser G-1 spot-check at ≥2100px/≥3840px (no browser in fleet). index.test.tsx useMemo failure confirmed pre-existing.
**Bookkeeping:** 5 children moved todo.md → completed-202607.md (theme-css, index-css, index-html, quota-burn-colors-test-ts, token-layer-test-ts).

### Wave 2: Contract Docs — theme/runtime/integration (doc-only)

**Status:** DONE
**Test commit(s):** N/A (doc-only wave, tester skipped)
**Test agent:** —
**Source commit(s):** `2c6aeda` (merge `a8c4fa6`) — 3 contract docs aligned to code
**Source agent:** engineer (docs)
**QA verdict:** PASS (5/5)
**Actual changes:** theme-contract.md (C-1 dropped value column → names are stable API; C-4 removed nonexistent --iv-\*/--card-2, real internal set; I-4-doc split), runtime-contracts.md (C-2-doc → actual status-aware retry + D1-453 ref), remote-dashboard-integration-contract.md (C-3 dark-only).
**Deviations:** DEV-1 — C-2 code already status-aware (`shouldRetryQuery` in main.tsx:59-75, landed by D1-453); doc documents reality, not the stale "retries 401/403" spec.
**Findings:** Confirmed the fork-review C-2 premise was stale at execution time.
**Bookkeeping:** 3 children moved (theme-contract-md, runtime-contracts-md, remote-dashboard-integration-contract-md).

### Wave 3: Archive-Integrity — dated correction notes (doc-only, additive)

**Status:** DONE
**Test commit(s):** N/A (additive doc-note wave)
**Test agent:** —
**Source commit(s):** `38cd12b` (merge `f3032a2`) initial; `9ad1f5e` (merge `126adbd`) D-4/D-6 fix; `b3d2a8a` (merge `1ff7d59`) D-4 accuracy fix (Gate-3 caught)
**Source agent:** engineer (docs)
**QA verdict:** FAIL (D-4/D-6 cited deleted files) → PASS after `9ad1f5e` re-QA → Gate-3 review caught a residual D-4 false-deletion claim → corrected in `b3d2a8a` (verified accurate on develop)
**Actual changes:** Appended dated D-1..D-7 correction blocks to 3 archive docs (additive-only; originals verbatim). D-2/D-5 honestly framed as later-fixed (drift). D-4 (allowlist deleted by D1-453 `92159e3`) / D-6 (`PhosphorTable` deleted by D1-452 `1954e37`) corrected to cite deleting commits.
**Deviations:** 1 re-dispatch — initial notes wrote present-tense claims for deleted evidence files; fix cites the deleting commits, keeps conclusions.
**Findings:** D-2 (`sparkBuckets` producer now exists) and D-5 (date-range clobber fixed) were already remediated by sibling plans — recorded as such.
**Bookkeeping:** 3 children moved (2026-06-adversarial-review, 2026-05-phosphor-atlas-implementation, 2026-05-...-closeout).

### Wave 4: `src/main.tsx` C-2 Coordination — orchestrator-inline (no dispatch)

**Status:** DONE
**Test commit(s):** N/A (coordination wave, no code change)
**Test agent:** —
**Source commit(s):** N/A (no source edit — single code owner is D1-453)
**Source agent:** orchestrator-inline
**QA verdict:** N/A (reclassification only; no code to QA)
**Actual changes:** Recorded C-2 reclassification in completed-202607.md. C-2 closed on both sides — doc (Wave 2) + code (D1-453 already landed status-aware `shouldRetryQuery`).
**Deviations:** Plan SD-1 premise stale (DEV-1) — code fix was already done by D1-453, not "open/deferred". No competing edit made (per child hazard).
**Findings:** `D1-453-mf-shell-routing-src-main-tsx` already in completed-202607.md.
**Bookkeeping:** 1 child moved (src-main-tsx). FINAL: todo.md D1-454 count 12→0; all 12 in completed.

## Dispatch Log

| Wave | Phase    | Agent    | Target files                                                                  | Worktree                | Result                                | Notes                                                                                                                                                                                                                                                                                                                                   |
| ---- | -------- | -------- | ----------------------------------------------------------------------------- | ----------------------- | ------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1    | a (test) | tester   | 3 style test files                                                            | agent-ad8894cfdc2c57ed3 | ✅ commit `67b029f`, landed `52429de` | Attempt 1 died on infra cooldown (orphan cleaned). Attempt 2: 5 tests FAIL (correct red), 2 already-aligned guards kept as regressions (C-5 iv/quota, I-2 provider hex already match). I-6 asserts 10 mono `font-weight:700` rules → 0. Land delayed by cross-session tree contention.                                                  |
| 1    | b (impl) | engineer | theme.css, index.css, index.html, phosphor-dashboard.module.css, 2 test files | agent-a3ec66a07ffc010f6 | ✅ commit `3ecc481`, landed `da1c964` | 27/27 style tests green; lint clean. G-1 ladder → phosphor-dashboard.module.css (plan-sanctioned). I-4 `--quota-burn-*` → `@layer components` `:root` block. G-3 → `color-mix(--accent-cool)`. Alerts untouched (SD-2). **UNVERIFIED: in-browser G-1 spot-check (no dev server); pre-existing index.test.tsx useMemo failure claimed.** |
| 1    | c (qa)   | qa       | (read-only)                                                                   | —                       | ✅ **PASS**                           | All 7 checklist items PASS. Verdict inline below.                                                                                                                                                                                                                                                                                       |

#### Wave 1-c: QA

**Reviewer:** qa · **Date:** 2026-07-07
**Tester commit:** `67b029f` (merge `52429de`) — red-phase tripwires
**Engineer commit:** `3ecc481` (merge `da1c964`; branch tip `6b33355`) — CSS/test remediation

### Verdict: **PASS** (7/7 checklist items)

| #                 | Check                                          | Verdict                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | Evidence                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| ----------------- | ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1                 | Test files + all specified functions exist     | PASS                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | `token-layer.test.ts`: `test_font_generic_families_not_quoted` (L146), `test_no_vestigial_dark_block_machinery` (L156), `test_labeled_assertions_use_message_arg` (L169), `test_no_faux_bold_mono_weight` (L180). `quota-burn-colors.test.ts`: `test_iv_threshold_legend_bar_consistency_%s` ×5 tiers (L135, `test.each(ivThresholdTiers)`), `test_assertBurnVarDefined_comment_matches_regex` (L153). `provider-color-consistency.test.ts` (NEW): `test_css_and_provider_series_hex_match` (L57).                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| 2                 | All tests pass (27 expected)                   | PASS (via inspection)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | `pnpm vitest run src/styles/` → **EROFS** on `node_modules/.vite-temp` (read-only main repo — tooling failure, NOT a wave failure per dispatch note). Verified by source inspection: 27 tests total (token-layer 9; quota-burn 17 = 2×`test.each(burnTiers=5)` + `test.each(ivThresholdTiers=5)` + 2 plain; provider 1). Engineer already ran 27/27 green in worktree `agent-a3ec66a07ffc010f6`. Each assertion traced to real source values below (all satisfied).                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| 3                 | Real, non-vacuous value assertions             | PASS                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | I-2 test parses actual `.tt-slice/.tt-swatch` hexes from `index.css:2934-2974` and real `PROVIDER_SERIES[].color/cssClass` from `phosphor-dashboard.tsx:150-212`; all 10 pairs match (e.g. `tt-anthropic #cc7855`, `tt-nvidia #76b900`, `tt-unknown #64748b`). Would FAIL if either side changed. iv/quota test compares real hex across both selector families: all 5 tiers match (`iv-0-5`/`quota-0-5` `#1e3a5f`, `iv-25-50`/`quota-25-50` `#cc7e0a`, `iv-50-p`/`quota-50-p` `#cc3838`) — would FAIL on one-sided edit.                                                                                                                                                                                                                                                                                                                                                                                                               |
| 4                 | Meta-tests pin behavior (not vacuous)          | PASS                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | `test_no_faux_bold_mono_weight` runs `monoContextRulesWithFauxBold700()` (L72) which iterates real rule blocks, tests each body for mono-context AND `font-weight: 700`, asserts `.toHaveLength(0)` — not `expect(true)`. `test_no_vestigial_dark_block_machinery` greps the test file's own source for `.dark` injection/classList.add. `test_labeled_assertions_use_message_arg` greps for the old `toMatchObject` idiom (L176).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| 5                 | Source matches plan spec                       | PASS                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | **I-5:** `theme.css:83-84` `--font-inter: 'Inter', sans-serif` / `--font-manrope: 'Manrope', sans-serif` — generic UNquoted, real name quoted. **I-6:** all 8 `font-weight:700` rules in `index.css` (L480,497,535,680,1339,1633,2290,2451) are in NON-mono contexts (pgbouncer-card-name, status pills, tip-heads, etc.); no `var(--font-mono)`/`IBM Plex Mono` rule carries 700 — mono emphasis is 600 (e.g. `index.css:472` pgbouncer-panel-head weight 600). **I-1/SD-4:** `theme.css:42` `--accent-warm: #f59e0b` ≡ `--accent-chrome` (L38); inline comment L41 documents the intentional `--chart-4`≡`--chart-1` divergence + PROVIDER_SERIES rationale. **I-4:** `--quota-burn-*` moved to documented `@layer components { :root { … } }` block (`index.css:109-116`). **C-6:** `token-layer.test.ts` `beforeAll` (L29-32) only `readFileSync`s theme.css + index.css — no `.dark` injection; `getCssVar` reads raw source text. |
| 5 (dead-CSS grep) | PASS                                           | `grep -rn "gutter-hot\|client-section\|over-velocity\|fleet-pulse\|attribution-legend\|quota-anomaly-sub\|tt-multiselect-option.depth-2\|repo-table tbody" src/` → **only 2 remaining hits, both benign:** (a) `index.css:2849` — comment-only (`/* …for horizontal fleet-pulse ends */`); (b) `index.tsx:925` — comment-only (`{/* Page header — …fleet-pulse, attribution */}`). No live rule blocks or emitters for any deleted selector remain.                                                                 |
| 5 (SD-2 CRITICAL) | PASS                                           | Alert families STILL PRESENT in `index.css` (deferred to D1-450, NOT deleted): `alerts-panel` ×1, `alert-item` ×8, `alertPulse` ×2 (11 total lines). `.health-strip-cell.cat-miss` retained ×1.                                                                                                                                                                                                                                                                                                                     |
| 5 (G-1)           | PASS                                           | Global `.provider-summary` column ladder + uncapped `min-1920 → 4col` REMOVED from `index.css` (only residual `min-width:1920` hit is a comment at L953). `index.css:391-396` keeps only `grid-auto-rows:1fr; justify-items:stretch; margin-top:12px` + a pointer comment. The 2/4/8-col ladder now lives in `phosphor-dashboard.module.css:13-46` (`.provider-summary-grid`: base 2, 1280-1599→2, 1600-2099→4, ≥2100→8, ≥3840→8). Consumed at `phosphor-dashboard.tsx:1668` via `styles['provider-summary-grid']`. |
| 6                 | No regression introduced by this wave          | PASS                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | `git show da1c964 --stat` / `git diff 1508e1a 6b33355` → touches ONLY 5 files: `phosphor-dashboard.module.css`, `index.css`, `theme.css`, `quota-burn-colors.test.ts`, `token-layer.test.ts`. Neither `index.tsx` NOR `index.test.tsx` touched. The claimed pre-existing `index.test.tsx` useMemo failure (~L1789, `expect(result.current).toBe(atT0)`) was last modified by `ec8c445` (D1-450, 2026-07-07 07:58) — 3+ hours BEFORE this wave merged (11:12). **Confirmed genuinely pre-existing, not introduced by this wave.** (Full-suite re-run blocked by EROFS; scope evidence is conclusive that this wave cannot have caused it.)                                                                                                                                                                                                                                                                                               |
| 7                 | G-1 visual regression (breakpoint consistency) | PASS (code) + RESIDUAL manual                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | The moved ladder breakpoints (module.css 1600→4, 2100→8) are internally consistent with `resolveProviderHealthColumnCount` (`phosphor-dashboard.tsx:126-131`: ≥2100→8, ≥1600→4, else 2) and its `PROVIDER_HEALTH_MASONRY_BREAKPOINTS` (L121-124: cols8=2100, cols4=1600). Prior breakpoints preserved. **RESIDUAL MANUAL ITEM:** in-browser spot-check at ≥2100px / ≥3840px was NOT run (no dev server; cannot drive a browser here). Flagged for operator/manual verification before close-out (also called out in plan R-5 / Confidence Note Wave 1).                                                                                                                                                                                                                                                                                                                                                                                 |

**Tooling note:** `pnpm vitest run src/styles/` returns `EROFS: read-only file system` on `node_modules/.vite-temp` in the main repo (documented Wave 0 baseline condition). Per dispatch instructions this is NOT treated as a wave failure; verification done by source inspection + `git show`.

**Dead-CSS grep hits (explicit):**

1. `src/styles/index.css:2849` — comment only (`fleet-pulse` in a section header comment).
2. `src/features/dashboard/index.tsx:925` — comment only (`fleet-pulse, attribution` in a JSX header comment).
   Both benign; no live rules/emitters remain for any deleted selector.

**SD-2 alert-family confirmation (explicit):** `alerts-panel` (1), `alert-item` (8), `alertPulse` (2) and `.health-strip-cell.cat-miss` (1) are all STILL PRESENT in `index.css` — correctly NOT deleted (deferred to D1-450).

**Residual manual-verification items:** in-browser G-1 layout spot-check at ≥2100px and ≥3840px (checklist item 7) — cannot be automated here; must be performed manually before final close-out.

**Overall: PASS.** Orchestrator may proceed to move the 5 Wave-1 children (`theme-css`, `index-css`, `index-html`, `quota-burn-colors-test-ts`, `token-layer-test-ts`) from `todo.md` → `completed-202607.md`, noting the residual in-browser G-1 check as an open manual item.

**✅ Bookkeeping DONE (orchestrator-inline, 2026-07-07):** All 5 Wave-1 children moved `todo.md` → `completed-202607.md` with QA verdict + commands + changed paths + findings per child. `grep -c '^### D1-454-styles-docs-' .analysis/todo.md` → **7** (was 12). Residual in-browser G-1 spot-check recorded in the completed entry as an open manual item.

## Summary

**Completed:** 2026-07-07
**Total commits:** 5 substantive (`67b029f`, `3ecc481`, `2c6aeda`, `38cd12b`, `9ad1f5e`) + 5 merges
**Agents involved:** tester ×2 (1 infra-fail), engineer ×5 (1 CSS Wave 1, 2 docs Waves 2/3, 1 Wave-3 fix, 1 close-out gate), qa ×4 (Waves 1/2/3 + Wave-3 re-QA)
**QA pass rate:** 2/3 dispatched waves passed QA first attempt (67%); Wave 3 needed 1 re-dispatch
**Plan accuracy:** 4/4 waves implemented; findings-level drift on C-2 (DEV-1), D-2, D-4, D-5, D-6 (stale fork-review inputs — sibling plans had already fixed/deleted them)
**Deviations:** DEV-1 (C-2 code already status-aware via D1-453 — SD-1 premise stale); D-2/D-5 archive findings already remediated (framed as "later fixed"); D-4/D-6 evidence files deleted (QA-caught, corrected). Two deferrals held as planned: alert-family CSS → D1-450 (SD-2); C-2 code owner = D1-453.
**Lessons learned:**

- Fork-review-derived plans decay: 4+ findings were overtaken by sibling waves landing between authoring and execution — needs a HEAD re-verification preflight.
- Archive-integrity dispatches must demand `ls`/`grep` proof of every cited artifact up front (the missing instruction caused the sole avoidable re-dispatch).

## Retrospective — If Starting Over

### Revised Wave Sequencing

<reordered dispatch sequence>

### Revised Prompts or Templates

<dispatch prompt changes>

### What the Gap Analysis Should Have Caught

<blind spots>

### Dispatch Simulation Checklist

1. Orchestrator dispatch → hook gate (worktree required?)
2. Worktree creation → correct base branch?
3. Context injection → persona + instructions loaded?
4. Tool availability → all required tools listed?
5. Stage/land → pre-commit hooks pass?
6. Cleanup → worktree_remove + ls verification?

## Suggested Persona Context Adjustments

### Already-Covered Items (with gap rationale)

- The engineer personas already "verify against live source" — this is why Wave 2/Wave 3 correctly documented reality over the stale brief. No gap; reinforce.

### Suggestion 1: Fork-review remediation plans need a HEAD re-verification preflight

**Record:** `/spec` plan template + researcher persona (fork-review decomposition)
**Change:** Add a mandatory Wave 0.5 step: re-verify each finding's cited code state against current HEAD before dispatch; flag any finding overtaken by sibling plans as `STALE — already remediated by <plan>`.
**Driven by:** DEV-1 + D-2/D-4/D-5/D-6 drift (4+ findings overtaken by D1-448/449, D1-452, D1-453 between authoring 2026-07-04 and execution 2026-07-07).
**Priority:** HIGH

### Suggestion 2: Archive-integrity dispatches must mandate artifact-existence proof upfront

**Record:** engineer persona / archive-integrity dispatch template
**Change:** For any "verify current state" doc wave, require the engineer to `ls`/`grep` each cited artifact and cite the deleting commit when absent — in the FIRST dispatch, not the fix.
**Driven by:** Wave 3 D-4/D-6 QA FAIL (present-tense claims about deleted files) — the sole avoidable re-dispatch.
**Priority:** MEDIUM

### Suggestion 3: Close-out gate for frontend repos runs in a worktree, not the orchestrator main repo

**Record:** `/implement` skill close-out guidance
**Change:** Encode that main-repo `node_modules` is read-only (EROFS) and `rg` may be absent; route `pnpm vitest`/`pnpm lint` gate runs through a worktree agent and use `grep`.
**Driven by:** Wave 0 baseline command was unrunnable in orchestrator context.
**Priority:** LOW

<!-- ============================================================= -->
<!-- CLOSE-OUT TEMPLATE SHELL — appended per plan-template-closeout; complete at promotion. -->
<!-- ============================================================= -->

## Execution Summary

Planned 4 waves (3 dispatched + 1 inline); actual = 4 waves completed with **1 QA-driven re-dispatch** (Wave 3 D-4/D-6) and **1 infra-cooldown re-dispatch** (Wave 1 tester, zero-progress). All 12 children remediated and moved to `completed-202607.md`. Close-out GATE GREEN.

### Gate Check Results

- Develop HEAD `126adbd` — **Lint: PASS** (0 errors, 4 known `react-refresh` warnings), **Tests: 27 passed / 0 failed** (`src/styles/`, run twice — idempotent), `typecheck:tests` exit 0.

### Consolidated Dispatch Log

| Wave | Phase              | Agent               | Target files                                                   | Result                               | Commit(s)             |
| ---- | ------------------ | ------------------- | -------------------------------------------------------------- | ------------------------------------ | --------------------- |
| 1    | tester (attempt 1) | tester              | style tests                                                    | ❌ infra cooldown, 0 progress        | — (orphan cleaned)    |
| 1    | tester (attempt 2) | tester              | 3 style test files                                             | ✅ red phase (5 fail)                | `67b029f` → `52429de` |
| 1    | engineer           | engineer            | theme.css, index.css, phosphor-dashboard.module.css, 2 tests   | ✅ 27/27 green                       | `3ecc481` → `da1c964` |
| 1    | QA                 | qa                  | (read-only)                                                    | ✅ PASS 7/7                          | —                     |
| 2    | engineer           | engineer (docs)     | theme-contract.md, runtime-contracts.md, remote-...contract.md | ✅ (caught DEV-1)                    | `2c6aeda` → `a8c4fa6` |
| 2    | QA                 | qa                  | (read-only)                                                    | ✅ PASS 5/5                          | —                     |
| 3    | engineer           | engineer (docs)     | 3 archive docs                                                 | ⚠️ landed, QA-fail D-4/D-6           | `38cd12b` → `f3032a2` |
| 3    | QA                 | qa                  | (read-only)                                                    | ❌ FAIL (D-4/D-6 cite deleted files) | —                     |
| 3    | engineer (fix)     | engineer (docs)     | 2 archive docs                                                 | ✅ corrected                         | `9ad1f5e` → `126adbd` |
| 3    | QA (re-QA)         | qa                  | (read-only)                                                    | ✅ PASS                              | —                     |
| 4    | coordinate         | orchestrator-inline | (no code)                                                      | ✅ reclassified                      | —                     |
| CO   | gate               | engineer (worktree) | (read-only run)                                                | ✅ GATE GREEN                        | —                     |

### Research Deliverables

- `.analysis/plan-d1-454-styles-docs-remediation.md` — this plan

## Session Retrospective — Operator Nudges

**0 nudges.** The operator invoked `/implement` and did not intervene during execution. No approach corrections were issued — all scope decisions (SD-1..SD-4) were resolved by their documented plan defaults, and one (SD-1/C-2) was overtaken by reality (DEV-1).

## Lessons Learned

### What Worked Well

1. **TDD red/green on style tripwires** (Wave 1) — tester produced 5 correctly-failing tests + 2 already-aligned regression guards; engineer took it to 27/27; QA verified value-assertions, not vacuity. Clean first-attempt pass.
2. **Engineers verifying against live source, not the brief** (Wave 2) — the docs engineer caught that `main.tsx` was already status-aware and documented reality instead of the stale spec (DEV-1). Exactly the right instinct.
3. **QA caught a real archive-integrity defect** (Wave 3) — D-4/D-6 cited deleted files; QA rejected per the plan's "must still hold at HEAD" rule. The re-dispatch loop worked as designed.
4. **Inline bookkeeping held** — children moved `todo.md`→`completed` after each wave's QA PASS; count strictly decreased 12→7→4→1→0, never batched.

### What Didn't Work

1. **Stale fork-review premises** — 4 findings (C-2/DEV-1, D-2, D-5, and the evidence for D-4/D-6) had been overtaken by sibling plans (D1-448/449, D1-452, D1-453) landing between plan authoring (2026-07-04) and execution (2026-07-07). The plan asserted states that no longer held.
2. **Wave 3 dispatch under-specified verification** — the initial archive dispatch didn't demand `ls`/`grep` proof of each cited artifact; the fix dispatch did, and passed. Avoidable re-dispatch.
3. **Orchestrator-context tooling gaps** — read-only `node_modules` (no vitest/lint in main repo) and missing `rg` made the plan's Wave 0 baseline command unrunnable as written; gate had to run in a worktree agent.

### Process Improvements for Next Plan

1. **Add a "re-verify findings against HEAD" preflight** to any fork-review-derived remediation plan — sibling waves close/relocate findings underneath you.
2. **Archive-integrity dispatches must mandate artifact-existence proof** (cite the deleting commit when a referenced file is gone) in the FIRST dispatch prompt, not the fix.
3. **Scope close-out gate to a worktree agent from the start** for frontend repos (main-repo `node_modules` is read-only); use `grep`, not `rg`.

### Metrics

| Metric                            | Value                                                             | Source                          |
| --------------------------------- | ----------------------------------------------------------------- | ------------------------------- |
| Total agent dispatches            | 12 (incl. 1 infra-fail, 1 unavailable-type)                       | Dispatch Log                    |
| Substantive successful dispatches | 10                                                                | Dispatch Log                    |
| QA-driven re-dispatches           | 1 (Wave 3 D-4/D-6)                                                | Dispatch Log                    |
| Infra/tooling re-dispatches       | 1 (Wave 1 tester cooldown) + 1 (`grunt` unavailable → `engineer`) | Tool Errors                     |
| First-attempt wave QA PASS        | 2 of 3 dispatched waves (Waves 1, 2)                              | QA verdicts                     |
| First-attempt QA pass rate        | 67%                                                               | —                               |
| Substantive commits to develop    | 5 (`67b029f`, `3ecc481`, `2c6aeda`, `38cd12b`, `9ad1f5e`)         | `git log`                       |
| Waves completed                   | 4 of 4                                                            | —                               |
| Children moved to completed       | 12 of 12                                                          | `todo.md` count 12→0            |
| Session duration                  | ~2 hours (est.)                                                   | agent durations + orchestration |

### If I Could Start This Plan Over

1. Insert a HEAD re-verification pass before Waves 2–3 so the C-2 (DEV-1) and D-2/D-4/D-5/D-6 drift were caught at plan-refresh time, not mid-execution — would have saved the Wave 3 re-dispatch and pre-written the reclassification correctly.

## Hindsight

Grounded in this session's execution evidence (≥5 items):

1. **The plan's biggest blind spot was time-decay of the fork review.** Authored 2026-07-04, executed 2026-07-07 — in that window D1-448/449, D1-452, and D1-453 landed and closed/relocated findings this plan still treated as open. Evidence: DEV-1 (C-2 already status-aware), D-2 (`sparkBuckets` producer now exists), D-5 (date-range clobber fixed), D-4/D-6 (evidence files deleted). **4 of ~32 findings were stale.** A fork-review remediation plan should carry an explicit "re-verify against HEAD" gate as Wave 0.5.

2. **The Wave 3 QA FAIL was the single avoidable cost.** The archive engineer wrote present-tense "HEAD:" claims for D-4/D-6 without `ls`/`grep`-confirming the cited files still existed. One extra engineer + one extra QA dispatch. The corrective instruction ("cite the deleting commit when a file is absent") should have been in the _original_ archive-integrity dispatch — it was a foreseeable failure mode for a "verify current state" wave.

3. **Cross-session contention is a real, recurring cost in this fleet.** Wave 1's land was blocked because another session's `/promote` left the shared main-repo working tree dirty. It cleared in <30s via monitor-and-wait — the right pattern was to NOT touch their files and wait. Expect this whenever multiple `/implement` or `/promote` sessions run concurrently; the land mechanism serializes on the single shared checkout.

4. **Transient infra failures should not be treated as task failures.** The Wave 1 tester died at startup on an Anthropic provider-affinity cooldown (zero forward progress). A fresh redispatch succeeded immediately. Correctly did NOT count it toward the two-strike rule.

5. **Orchestrator-context assumptions in the plan didn't match reality.** The Wave 0 "gate baseline" was specified as `pnpm vitest run src/styles/ && pnpm lint`, but the orchestrator's main repo has read-only `node_modules` (EROFS) and no `rg`. Frontend gates/tests must run inside a worktree agent. The plan should encode this rather than assuming the orchestrator can run the JS toolchain.

6. **Doc-to-code truth-matching beat spec-following, twice.** In Wave 2 the engineer documented the actual status-aware retry (not the stale "retries 401/403" spec); in Wave 3 the engineer honestly framed D-2/D-5 as "later fixed" rather than repeating dead bug claims. Both were the correct call and are why the docs are now trustworthy — the plan's rigid "state X" instructions would have produced false docs if followed literally.

7. **The structural plan was sound.** Serial sequencing, the CSS-engineer/docs-engineer split by tooling+budget, and inline-per-wave bookkeeping all held with zero token overruns. No structural change needed — only the freshness of the inputs let it down.

8. **The D-4 note failed HEAD-accuracy TWICE, and my own fix prompt caused the second miss.** Round 1 (Wave 3 QA): D-4 cited deleted files as present. Round 2 (my fix dispatch `9ad1f5e`): I asserted in the prompt that `remote-dashboard.test.tsx` "was deleted by `92159e3`" — but that commit only deleted `-allowed-pages.ts` + `aawm-tap-page.tsx`; the test still exists. The engineer trusted my prompt and the targeted re-QA rubber-stamped it (it verified the D-6 half and the allowlist absence, but not the specific `.test.tsx` existence claim I injected). The **pre-promotion reviewer (Gate 3) caught it** and it took a third pass (`b3d2a8a`) to get D-4 factually correct. **Lesson:** when an orchestrator hand-feeds "verified facts" into a fix prompt, those facts must themselves be verified first — I ran `ls -allowed-pages.ts` and `grep PhosphorTable` but never `git cat-file -e ...remote-dashboard.test.tsx`. A re-QA that only re-checks the flagged conclusion (not every atomic factual claim in the correction) can rubber-stamp a newly-introduced error. Targeted re-QAs should re-verify _each cited artifact's existence_, not just "does the conclusion still hold."

**SHA note (non-blocking):** develop landed rebased equivalents of the Wave-1 commits — `67b029f`→`ee7e53f` (tester) and `3ecc481`→`6b33355` (engineer) — content identical, merges `52429de`/`da1c964`. The plan cites the pre-rebase SHAs; both resolve to the same landed changes.

## Tool Errors and Infrastructure Failures

### <Category>

| Error | Frequency | Context | Resolution |
| ----- | --------- | ------- | ---------- |

### Root Causes Identified

1. <title> — <root cause>

## Suggested Persona and Template Adjustments

### Plan Template Updates

1. <what to add and why>

### Dispatch Rules Updates

1. <what to add and why>

### Orchestrator Instructions Updates

1. <what to add and why>

### Researcher Review

**Date:** YYYY-MM-DD
**Reviewer:** researcher (opus)
...

### Eyes: Context Injection Recommendations

**Date:** YYYY-MM-DD
**Author:** eyes

#### Records to UPDATE

...

#### Records to CREATE

...

#### Records to DEPRECATE

...

#### Priority Order

| Priority | Record | Change | Driven by |
| -------- | ------ | ------ | --------- |

## Confidence Notes (Pre → Post Execution)

| Wave | Pre-Execution | Post-Execution | Notes                                                             |
| ---- | ------------- | -------------- | ----------------------------------------------------------------- |
| 1    | MEDIUM        | **HIGH**       | 27/27 tests, lint 0; only residual = manual in-browser G-1 check. |
| 2    | HIGH          | **HIGH**       | Delivered + caught stale C-2 premise (DEV-1).                     |
| 3    | HIGH          | **MEDIUM**     | 1 re-dispatch (D-4/D-6 cited deleted files).                      |
| 4    | HIGH          | **HIGH**       | D1-453 already closed the code side; pure reclassification.       |

## Close-Out Checklist

- [x] QA dispatched and PASS for every wave (inline under h4)
- [x] All 12 children moved `todo.md` → `completed-202607.md` inline
- [x] `grep -c '^### D1-454-styles-docs-' .analysis/todo.md` → 0
- [x] Eyes tristore update (N/A)
- [x] Ops validation (idempotent 2nd run of `pnpm vitest run src/styles/`)
- [x] Gate check green (lint + tests)
- [x] Smoke test PASS
- [x] Operator nudges captured in retrospective (0 nudges)
- [x] Lessons learned
- [x] Hindsight (7 items)
- [x] Tool errors documented
- [x] Suggested persona/template adjustments
- [ ] Researcher plan review (CO-7 — `/promote` Gate 3)
- [ ] Eyes context injection recommendations (CO-7 — `/promote` Gate 4)
- [x] Confidence Notes updated with post-execution actuals
- [ ] Plan promoted to `docs/implemented/2026-07-d1-454-styles-docs-remediation.md` (CO-7)

---

## Phase 3 Validation (spec authoring — not part of execution)

### Coverage Table

| Ask (finding / child)                    | Satisfied by                                                             |
| ---------------------------------------- | ------------------------------------------------------------------------ |
| C-1 (theme-contract palette)             | Wave 2 (doc) + Wave 1 (theme.css canonical values)                       |
| C-2 (401/403 retry)                      | Wave 2 doc (actual behavior + D1-453 ref) + Wave 4 code reclassification |
| C-3 (dark-only contract)                 | Wave 2                                                                   |
| C-4 (internal-token paragraph)           | Wave 2                                                                   |
| C-5 (iv/quota legend↔bar)                | Wave 1 (`quota-burn-colors.test.ts` + `index.css`)                       |
| C-6 (vestigial `.dark` test machinery)   | Wave 1 (`token-layer.test.ts`)                                           |
| C-7 (assertBurnVarDefined overclaim)     | Wave 1 (`quota-burn-colors.test.ts`)                                     |
| P-1..P-3 (CSS weight/redundant rules)    | Wave 1 (`index.css`)                                                     |
| G-1..G-6 (cascade/hardcoded hex/scoping) | Wave 1 (`index.css`)                                                     |
| I-1 (warm≡chrome / chart-4)              | Wave 1 (`theme.css`, SD-4)                                               |
| I-2 (provider color triplication)        | Wave 1 (new consistency test)                                            |
| I-3 (credit/auth panel idiom)            | Wave 1 (`index.css`)                                                     |
| I-4 (token layering split)               | Wave 1 (`index.css`) + Wave 2 (doc)                                      |
| I-5 (font generic quoting)               | Wave 1 (`theme.css`)                                                     |
| I-6 (mono 700 faux-bold)                 | Wave 1 (`index.css` mono-600, SD-3)                                      |
| A-1, A-2 (component-layer / `.is-prior`) | Wave 1 (`index.css`)                                                     |
| E-1 (test assertion cleanup)             | Wave 1 (`token-layer.test.ts`)                                           |
| E-2 (comment archaeology)                | Wave 1 (`index.css`)                                                     |
| Dead CSS §7 (non-alert)                  | Wave 1 (`index.css`)                                                     |
| D-3 alert-family CSS                     | **Deferred to D1-450** (SD-2) — noted, not deleted here                  |
| D-1..D-7 (archive integrity)             | Wave 3                                                                   |
| main.tsx C-2 code                        | **Reclassified to D1-453** (SD-1) — Wave 4 records it                    |
| todo.md → completed.md movement          | Bookkeeping Protocol + per-wave inline steps + Close-Out gate            |

**Not fully closed in this plan (explicit):** the _code_ half of C-2 (deferred to D1-453) and the alert-family dead-CSS deletion (deferred to D1-450). Both are dependency-blocked cross-parent items, documented rather than force-fixed.

### Alternatives Considered

1. **Fix `main.tsx` C-2 code here instead of deferring.** Rejected: the child's own hazard warns against competing edits with D1-453, which already owns broader retry/chunk consolidation; a split fix risks merge conflict and double-remediation. (Operator may override via SD-1.)
2. **Delete alert-family CSS now (full D-3 dead-CSS pass).** Rejected: `AlertsRail` is still imported by `a11y.test.tsx`; deletion would break tests and pre-empt the D1-450 delete-vs-revive product decision.
3. **One combined engineer dispatch for CSS + docs.** Rejected: combined work exceeds ~125k tokens and mixes CSS/Vitest tooling with pure Markdown — the sizing rules sanction a budget/tooling split.

### Self-Critique

- **Weakest part of this spec:** Wave 1's `index.css` scope is broad (dead-CSS deletion + G-1 ladder move + hex sweep + mono-600 in one 3,560-line file). The visual-regression risk from the G-1 `.provider-summary` ladder move at ultrawide widths is real and only guardable by manual in-browser check, not the source-text tests — the automated gate can pass while the layout breaks.
- **Biggest assumption:** that the dead-CSS grep (re-run 2026-07-07) is complete — i.e., no dynamic template-literal constructs re-introduce a "dead" selector at runtime. The review claims it checked template-literal patterns, but I did not independently exhaustively verify every one of the ~15 deletion targets.
- **Most likely to need revision after first execution:** Wave 1 — specifically the I-6 mono-weight remediation (SD-3), because the post-review font-loading drift means the tester and engineer must agree on the exact assertion at execution time; the current test spec hedges on this and may need reshaping once the engineer confirms whether IBM Plex Mono resolves to anything at all in the running app.

---

## Researcher Review

**Date:** 2026-07-07
**Reviewer:** principal (standing in for researcher — researcher model backend unavailable)
**Verdict:** NEEDS_REVISION

### Findings

1. **Implementation wiring is correct and verified (9/10 spot-checks clean).** Read the modified source at develop HEAD and independently confirmed every asserted code state except one:
   - **I-5 PASS:** `theme.css:83-84` — `--font-inter: 'Inter', sans-serif` / `--font-manrope: 'Manrope', sans-serif`; real name quoted, generic family unquoted.
   - **I-6 PASS:** all 8 residual `font-weight: 700` rules in `index.css` (L480/497/535/680/1339/1633/2290/2451) are non-mono selectors (pgbouncer-card-name, status pills, tip-heads, quota-bucket-head, estimator-lane-head); mono-context rules (`var(--font-mono)`) carry weight 600. No faux-bold mono remains.
   - **I-4 PASS:** `--quota-burn-*` sits in `@layer components { :root { … } }` at `index.css:109-116`.
   - **I-1/SD-4 PASS:** `theme.css:42` `--accent-warm: #f59e0b ≡ --accent-chrome` with the SD-4 inline rationale comment (L41); `--chart-4: var(--accent-warm)`.
   - **SD-2 PASS:** alert families retained — `alert-item` ×8, `alerts-panel` ×1, `alertPulse` ×2 (deferred to D1-450 as planned).
   - **D-6 PASS:** `grep -rl PhosphorTable src/` empty; `phosphor-table.tsx` deleted by `1954e37` (real ancestor of develop).
   - **C-2/DEV-1 PASS:** `main.tsx:59-75` `shouldRetryQuery` is status-aware (DEV→no retry; `failureCount>3`→stop; missing status→retry; 401/403/404→no retry; 408/429/5xx→retry; other 4xx→no retry). `runtime-contracts.md:71-79` matches this clause-by-clause and cross-references D1-453. DEV-1 correctly documents the stale SD-1 premise.
   - **Contract docs PASS:** `theme-contract.md` dropped the value column (C-1), corrected the `--iv-*`/`--card-2` claims (C-4), and states the `theme.css`-vs-`index.css` token split (I-4-doc); `remote-dashboard-integration-contract.md:185-191` states dark-only, matching `theme-provider.tsx:3-4,26-40` (hard-typed `Theme='dark'`, no-op `setTheme`/`resetTheme`, `classList.add('dark')`).

2. **Spec-to-outcome consistency: all 4 waves produced their spec'd outcome.** Each `## Outcomes` block has a status, commit(s), QA verdict, and actual-changes list that trace to real diffs. The 5 substantive SHAs (`67b029f`, `3ecc481`, `2c6aeda`, `38cd12b`, `9ad1f5e`) each match their wave spec at file level (`git show --stat` confirms Wave 1 = CSS+tests+module.css; Wave 2 = 3 contract docs; Wave 3 = 3 archive docs then D-4/D-6 fix). `38cd12b` is additive-only bar a single Prettier whitespace reflow (independently confirmed via `--word-diff-regex`). No wave has a missing or mismatched outcome.

3. **Deviation documentation is thorough.** DEV-1 (C-2/SD-1 stale) is recorded in Execution Deviations, both Confidence-Notes tables, Summary, Lessons, and Hindsight. D-2/D-4/D-5/D-6 drift is captured in Summary ("findings-level drift"), Hindsight §1, and the Suggestion-1 preflight recommendation. The G-1 ladder move and SD-2 alert deferral are flagged as plan-sanctioned. Infrastructure readiness confirmed: the entire change surface is `.css` + `.md` + `.test.ts` — **no rebuild, migration, or restart needed**.

4. **Lessons learned are specific and actionable — not platitudes.** They name real waves (Wave 1 tester infra cooldown; Wave 3 D-4/D-6 re-dispatch), real agent types (tester/docs-engineer/qa), concrete failure modes (stale fork-review premises overtaken by D1-448/449/452/453; present-tense claims about deleted files; EROFS read-only `node_modules`; cross-session land contention; `rg`/`grunt` unavailable), and yield executable process changes (HEAD re-verification preflight as Wave 0.5; mandate `ls`/`grep` artifact-existence proof up front; route frontend gates through a worktree). QA verdicts (Wave 1-c 7/7, Wave 2-c 5/5) verify real values (traced provider/iv-quota hex pairs, git-blame attribution of the pre-existing `index.test.tsx` failure to `ec8c445`), not rubber-stamps.

5. **BLOCKING — the D-4 "fix" (`9ad1f5e`) reintroduced the exact false-deletion defect the wave was re-dispatched to correct, and re-QA rubber-stamped it.** The current HEAD text (`2026-06-plan-adversarial-review-20260612.md:1478`) reads: _"`…/-allowed-pages.ts` and `src/shell/remote-dashboard.test.tsx` (its former sole importer) **were deleted** in D1-453 commit `92159e3`… absent at develop HEAD (`ls` → no such file)."_ Verified independently:
   - `git show 92159e3 --diff-filter=D` deleted **exactly two files**: `-allowed-pages.ts` and `src/shell/aawm-tap-page.tsx` — **not** `remote-dashboard.test.tsx`.
   - `git ls-files src/shell/remote-dashboard.test.tsx` → **tracked at HEAD**; `git cat-file -e develop:src/shell/remote-dashboard.test.tsx` → **exists** (7,316 bytes); `git log --all --diff-filter=D -- src/shell/remote-dashboard.test.tsx` → **never deleted**.
   - So the note makes two false assertions about `remote-dashboard.test.tsx` (deleted by `92159e3`; absent at HEAD / "no such file"). Its allowlist _import_ was removed by `b6e700c` (a D1-453 wave commit), but the file itself lives on. This violates the Wave-3 Test Spec (line 180) — "each cited code state still matches HEAD" — the identical criterion that produced the original Wave 3-c FAIL. For an **archive-integrity** correction whose sole deliverable is factual accuracy, a "ls → no such file" claim about a file that exists is a direct integrity failure that would be enshrined on promotion.

6. **GAP — the re-QA and retrospective miss this.** The re-QA (plan line 443) says it "Verified independently" via `git log 92159e3`, `ls -allowed-pages.ts`, and `grep -rl allowed-pages/ALLOWED_PAGES` — none of which touches `remote-dashboard.test.tsx` (the grep can't catch it because the test no longer references allowlist strings). It confirmed the _conclusion_ and the `-allowed-pages.ts` absence but never `ls`-proofed the collateral file it newly asserted was gone. Consequently Confidence Notes ("Wave 3 → MEDIUM, 1 re-dispatch"), the Summary ("D-4/D-6 corrected"), and Hindsight §2 ("passed") all present Wave 3 as fully clean, with no record that the fix carried a fresh factual error. This is a genuine gap between claimed and actual state.

7. **MINOR (non-blocking) — Wave-1 SHA drift in bookkeeping.** The plan cites landed commits `67b029f` (tester) and `3ecc481` (engineer), but develop actually contains rebased equivalents `ee7e53f` / `6b33355` (identical subjects, different trees; the cited SHAs are not in develop's merge lineage though they exist as objects). The _content_ landed correctly (all Wave-1 files present and verified), and Wave 1-c QA already references branch tip `6b33355`, so this is cosmetic rebase-on-land drift, not a missing outcome. Worth reconciling for a clean archive but not blocking.

### Recommendations (if NEEDS_REVISION)

1. **Correct the D-4 block** in `docs/implemented/2026-06-plan-adversarial-review-20260612.md:1478` (and re-check the D-4/D-6 roll-up one-liner in the 2026-05 implementation doc): `92159e3` deleted only `-allowed-pages.ts` (and `aawm-tap-page.tsx`); `src/shell/remote-dashboard.test.tsx` **exists at develop HEAD** — its allowlist _import_ was removed (by `b6e700c`, a D1-453 wave commit), the file was not deleted. State that accurately. The D-4 higher-order conclusion (splat route `$.tsx` renders with no allowlist gate; no allowlist artifact remains in `src`) is still true and should be retained.

2. **Re-run Wave 3-c QA on the D-4 block specifically, with `ls`/`git ls-files` proof of every file named in the note** (not just the primary deleted artifact). This closes the re-QA gap that let the reintroduced false claim through — and is exactly the "mandate artifact-existence proof up front" lesson the plan already recorded (Suggestion 2), now applied to the _fix_ dispatch too.

3. **Record the reintroduced-defect + re-QA miss in the retrospective:** update the Wave 3 Outcomes/Confidence Notes to note that the first D-4/D-6 fix (`9ad1f5e`) itself carried a residual false-deletion claim for `remote-dashboard.test.tsx`, corrected in a follow-up. This keeps the archive honest about the two-pass (not one-pass) correction and strengthens the "verify against HEAD" lesson.

4. **(Optional, non-blocking)** Reconcile the plan's cited Wave-1 SHAs (`67b029f`/`3ecc481`) with the commits actually in develop (`ee7e53f`/`6b33355`) so the promoted archive's SHA references resolve on `git show` against develop.

### Re-Review (2026-07-07, fix `b3d2a8a`)

**Reviewer:** principal (standing in for researcher — researcher model backend unavailable)
**Scope:** re-verify ONLY the D-4 fix (the single blocking reason in the original review). All other findings above stand unchanged.
**Verdict:** **APPROVED**

The one blocking defect — the D-4 correction note falsely claiming `src/shell/remote-dashboard.test.tsx` was deleted by `92159e3` — is now **fixed and factually accurate at develop HEAD** (`01d1179`). Independently re-verified:

1. **The corrected D-4 note (`…20260612.md:1478`) now states the truth.** It reads: _"Deleted by D1-453 commit `92159e3` … `-allowed-pages.ts` and `src/shell/aawm-tap-page.tsx` — both absent at develop HEAD. **Not deleted:** `src/shell/remote-dashboard.test.tsx` still exists at HEAD (7,316 bytes) … `git log --all --diff-filter=D` → no deletions; it no longer references any allowlist …"_ Each atomic claim confirmed:
   - `git show 92159e3 --diff-filter=D --name-only` → **exactly** `src/routes/_authenticated/aawm-tap/-allowed-pages.ts` + `src/shell/aawm-tap-page.tsx` (two files, matching the note verbatim — no longer claims the test file).
   - `git cat-file -e develop:src/shell/remote-dashboard.test.tsx` → exit 0 (**exists**); `git cat-file -s` → **7316 bytes** (matches the note's "7,316 bytes"); `git log --all --diff-filter=D -- src/shell/remote-dashboard.test.tsx` → **empty** (never deleted).
   - `grep -n 'allowed-pages\|ALLOWED_PAGES' src/shell/remote-dashboard.test.tsx` → exit 1, no matches (matches the note's "no matches").
   - `grep -rl 'allowed-pages\|ALLOWED_PAGES' src/` → no matches — the still-true higher-order conclusion (splat route `$.tsx` renders with **no runtime allowlist gate**) holds and is retained.

2. **The fix (`b3d2a8a`, merge `1ff7d59`) is surgical — ONLY the D-4 paragraph.** `git show b3d2a8a --numstat` → `1 1 docs/implemented/2026-06-plan-adversarial-review-20260612.md` (one file, +1/−1). The full diff replaces exactly one blockquote line (the D-4 paragraph); the D-2 and D-5 neighbor blocks appear only as unchanged context, and the 2026-05 implementation/closeout docs are untouched (correctly — the false claim lived only in the 2026-06 D-4 block; the D-6 roll-up was already accurate). No other correction block, verdict table, or archive body altered. `b3d2a8a` is an ancestor of develop.

3. **The retrospective is no longer blind to the error.** Hindsight **item 8** (line 728) now candidly documents the double-miss: _"The D-4 note failed HEAD-accuracy TWICE, and my own fix prompt caused the second miss"_ — naming the `9ad1f5e` fix-prompt error, the targeted re-QA rubber-stamp, the Gate-3 catch, and the third-pass `b3d2a8a` correction, with the concrete lesson (targeted re-QAs must re-verify _each cited artifact's existence_, not just the conclusion). Wave-3 **Outcomes** (lines 521-524) now list `b3d2a8a` (merge `1ff7d59`) as the "D-4 accuracy fix (Gate-3 caught)" with the QA verdict trail updated to reflect the three-pass (not one-pass) correction.

4. **No lingering false claims.** The remaining `remote-dashboard.test.tsx` mentions in the same archive (lines 396, 438, 472) are **original preserved W6 text** that correctly treats the file as an existing test (line 472 confirms its `$page` mentions are comments, not imports) — consistent with the now-corrected D-4 note.

The prior blocking reason is fully resolved and no new issue was introduced. The non-blocking Wave-1 SHA-drift note (original finding 7 / recommendation 4) remains optional and does not gate promotion. **Plan is APPROVED for promotion.**
