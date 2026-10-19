# Upstream sync D1-516

## Snapshot

Refreshed on 2026-10-19. Implementation stays on the isolated worktree
`/home/zepfu/projects/dashboard-shell-worktrees/d1-516`, branch
`work/d1-516-upstream-shadcn-admin`. The primary checkout and other worktrees
were not edited. `origin/develop` was not merged.

- Code commits on this branch, oldest first:
  - `6834d354d4a09b79bfa9effa94b07951d322dff0` Clerk v6 migration and shared dependency refresh
  - `34e463aa20557c294b3d3d060db40da57b07de05` confirmation, accessibility, initials, and CSV hint
- Fork branch baseline: `0da3ef8eb7ee698cc079013616baeef54608fc79`
  (`docs: add aawmdt todo backend config`). This was HEAD at the start of the
  sync and is the parent of these commits.
- `origin/develop` at disposition time: `cdc297bc3ffccde3b7e206e875645cd29ce3ba5b`
  (`Integrate the Alibaba Token Plan monthly quota lane.`). It is 11 commits
  ahead of the baseline and was left for the parent integration. Those commits
  do not overlap the files changed here except that a later route-tree
  regeneration may be needed after merge.
- Upstream: `https://github.com/satnaing/shadcn-admin`, default branch `main`.
- Upstream main, confirmed from the GitHub commit API and from
  `/home/zepfu/.workspace/dashboard-shell-upstream-20261018.git` `main` and
  `FETCH_HEAD`: `e16c87f213a5ba5e45964e9b67c792105ec74d26`
  (2026-06-11). No commit on main is newer than this SHA.
- Equal-tree baseline: upstream `a750f776f952997b6488714cdffde4badaa6c3e6`
  and rewritten fork ancestor `ba11a0fd248c0181e8a974bf41a455c75b324033`
  both have tree `6d6b996ae4a47cabe2de2dbd632706533a9cd8b8`.
  `git diff` between those commits is empty. `ba11a0fd` is an ancestor of
  the branch baseline. Histories still have no common ancestor, so this sync
  is a patch reconciliation, not an unrelated-history merge.
- Post-baseline range `a750f77..e16c87f` is 63 commits. All 63 are dispositioned
  below. Unmerged Dependabot branches are not on main and are outside this set.

## Disposition counts

| Disposition | Count |
| --- | ---: |
| applied | 14 |
| already-satisfied | 2 |
| inapplicable | 12 |
| intentionally-divergent | 35 |
| total | 63 |

## Commit dispositions

| Commit | Subject | Disposition | Evidence |
| --- | --- | --- | --- |
| `1c2217fd687d` | fix(confirm-dialog): allow form submission on confirmation (#288) | applied | ConfirmDialog accepts either a form id or handleConfirm. The three typed task/user delete dialogs submit through forms and still return early on a mismatched confirmation word. Ordinary task delete keeps its click caller. |
| `a8b5db056061` | build(vite): switch to @vitejs/plugin-react | intentionally-divergent | Retained @vitejs/plugin-react-swc 4.3.0 and the federation-aware Vite config. Vite 8.3 warns that SWC is optional here; that warning is not a defect and does not authorize the plugin switch. |
| `39b5b97ad74d` | build(deps): upgrade dependencies | applied | Shared dependency ranges were raised to the upstream tip rather than replayed as this intermediate lock snapshot. Downstream-only packages stayed. |
| `b449bb7208d5` | feat(tests): setup Vitest for unit/integration testing | intentionally-divergent | Kept the jsdom frontend project and Node server project. Did not add upstream's browser-test harness. |
| `9b4088d53158` | test: add test for users invite dialog | intentionally-divergent | Invite-dialog behavior is unchanged and already covered by the existing harness. The upstream browser test file was not copied. |
| `8659c6d5e5cd` | test: add tests for users delete dialog | applied | Adapted the distinct typed-confirmation case into confirm-dialog.test.tsx: a mismatched username does not submit, and the matching username does. |
| `7271479b2352` | test: add tests for users multi delete dialog | intentionally-divergent | Users multi-delete uses the same form and DELETE-word guard as the applied confirmation change. The upstream browser file and table mock were not copied. |
| `cfb330e9c065` | test: add tests for users action dialog | intentionally-divergent | No distinct users-action behavior change. Existing dialog behavior remains; the upstream test file was not copied. |
| `58b5228bc2a7` | test: add tests for tasks import dialog | applied | The CSV picker sets accept='text/csv' after the form register spread. The fork validation sentence stays 'Please upload a file'. A jsdom test checks the accept hint. |
| `912018914fe7` | test: add tests for tasks multi delete dialog | intentionally-divergent | Tasks multi-delete uses the applied form confirmation and existing DELETE guard. The upstream browser file was not copied. |
| `cceb44b4a9e9` | test: add tests for tasks mutate drawer | intentionally-divergent | No distinct mutate-drawer behavior change. The upstream browser file was not copied. |
| `dc8989883b73` | test(auth): add tests for otp form | inapplicable | Demo OTP auth was removed. Clerk is the only sign-in path. |
| `718626c62b35` | test(auth): add tests for sign up form | inapplicable | Demo sign-up form tests target removed src/features/auth code. |
| `7e80b2ec56a4` | fix(sign-in): add sign-up links and update layout/validations | inapplicable | Demo sign-in layout, links, and validations were not restored. |
| `038bb4fe27d5` | test(auth): add tests for user auth form | inapplicable | Demo user-auth form tests target removed code. |
| `3798a79dab3f` | fix(auth): update validation messages in forgot password form | inapplicable | Demo forgot-password validation copy was not restored. |
| `50a1d1bbafc0` | test(auth): add tests for forgot password form | inapplicable | Demo forgot-password tests target removed code. |
| `3db9b579a47f` | test(auth): add tests for sign up and otp pages | inapplicable | Demo sign-up and OTP page tests target removed code. |
| `ed93b70876c8` | test(utils): add tests for getPageNumbers | intentionally-divergent | getPageNumbers already exists and its behavior was not changed. No distinct gap required a new test. |
| `7b3db0c88517` | test(hooks): add tests for useTableUrlState | intentionally-divergent | useTableUrlState behavior was not changed. The upstream test file was not copied. |
| `9d990c1c76e2` | fix(password-input): improve accessibility | applied | Password visibility button has an sr-only Show/Hide password name and uses inset-e-1. The toggle and forwarded input behavior remain. |
| `791dd412b685` | test: add tests for password input component | applied | password-input.test.tsx covers the accessible name, password/text toggle, and type=button in jsdom. |
| `e35f45913a10` | test: add tests for sign out dialog | inapplicable | Demo sign-out dialog was not restored. |
| `91231766fde0` | test: add tests for confirm dialog | applied | confirm-dialog.test.tsx covers the click caller with type=button and the form submit button. jsdom still fires submit for Enter while the external submit button is disabled, so that browser case is not claimed. |
| `4e884dabc815` | test: add tests for search provider and command menu | intentionally-divergent | The full command-menu browser suite was not copied. The new shortcut attribute is covered under the search accessibility change. |
| `983d81e68c71` | test: add tests for config drawer | applied | Config drawer footer and section resets use type=button and accessible names for sidebar, layout, and direction. Fixed dark has no theme reset. Theme-selection cases were not restored. |
| `f5cc03a0c917` | test: add tests for handle-server-error | already-satisfied | src/lib/handle-server-error.ts already avoids unconditional logging and extracts a title without requiring AxiosError. The upstream test file was not required. |
| `33629294987e` | test: add tests for cookies utility function | intentionally-divergent | Cookie helper behavior was not changed. The upstream test file was not copied. |
| `755326e13f63` | test: add tests for auth store | inapplicable | The demo auth store was removed. |
| `b59ece4525c8` | chore(test): ignore coverage and vitest artifacts | intentionally-divergent | Did not import upstream coverage and Vitest artifact ignore rules. The fork gitignore and test output policy stay as they are. |
| `c212188bf74f` | refactor(test): add clearCookies helper and refactor cookie tests | intentionally-divergent | clearCookies is an upstream test helper. Its auth-test hunks do not apply, and cookie production behavior was not changed. |
| `a3cdc0ef8417` | test(utils): add test for current page greater than total pages | intentionally-divergent | The extra getPageNumbers case does not describe a fork behavior change. |
| `d03454920364` | fix(errors): align 204 copy and validate axios error titles | intentionally-divergent | Kept the fork handler and the existing 'Content not found.' copy. Upstream's 'No content.' string and AxiosError-only title check were not adopted. |
| `2c8858f9a24f` | test(errors): extend handleServerError tests | intentionally-divergent | No additional handleServerError case was required beyond the handler already retained. |
| `178c292f9881` | refactor(test): drop embedded expect from applyLastSearchFn | intentionally-divergent | Upstream test-helper refactor only. No production search behavior changed. |
| `b212358e0a0a` | test: add test for SignOutDialog Cancel button | inapplicable | Demo sign-out Cancel coverage was not restored. |
| `7c48f43adb63` | refactor(config-drawer.test): seed theme cookie before system theme integration test | inapplicable | System-theme cookie seeding belongs to removed theme selection. The drawer stays fixed dark. |
| `d30e058cf825` | test(search-provider): enhance command palette shortcut and cover Cmd+K | already-satisfied | SearchProvider already toggles on Meta+K and Control+K. No production shortcut change was required. |
| `457ea06c62d6` | refactor(test): add timer cleanup in SignUpForm test | inapplicable | Demo sign-up timer cleanup targets removed code. |
| `75a1999786ce` | refactor(tests): use expect.element for DOM assertions | intentionally-divergent | Did not switch assertions to vitest-browser expect.element. New tests use Testing Library. |
| `64c80a5996d9` | refactor(tests): update fillRequiredProfileFields to accept string | intentionally-divergent | Test helper change for the users action dialog suite, which was not imported. |
| `48b9ef56c310` | refactor(tests): use all() for multiple close buttons in TasksImportDialog | intentionally-divergent | The adapted CSV test checks the accept hint and does not need the upstream all() close-button refactor. |
| `d49dec2c744e` | refactor(test-utils): extract createTableMock for multi-delete dialog tests | intentionally-divergent | createTableMock serves upstream multi-delete browser tests that were not imported. |
| `56b2023bbf17` | test(handle-server-error): add prod logging test | intentionally-divergent | The fork handler does not emit the production console.log this test locks. vite.config.ts test environment was not changed. |
| `db06aeb72573` | refactor(users-invite-dialog): clear mocks before each test | intentionally-divergent | Invite-dialog mock cleanup belongs to a test file that was not imported. |
| `55d862c3e96f` | build(vite.config): update coverage exclusions to include additional files | intentionally-divergent | Coverage exclusions would edit the federation Vite config for an upstream browser harness. vitest.config.ts and vite.config.ts were left unchanged. |
| `8c125e9725db` | ci: run vitest browser tests in github actions | intentionally-divergent | GitHub Actions still runs the jsdom/Node suite. Browser-test CI was not added. |
| `19db077879e4` | refactor: update formatting | intentionally-divergent | Did not replay this upstream-only test formatting pass. Prettier 3.8.5 was applied to files this sync actually changed. |
| `ee82c31f1590` | build(deps): bump dependencies to latest stable versions | applied | Declared shared ranges match the upstream tip. The root lockfile was regenerated with pnpm 10.30.2 on 2026-10-19, so caret ranges resolve to current releases inside those ranges, not the June lock pins. |
| `34e616d16a85` | fix(ci): add playwright dependency and test:browser:install script | intentionally-divergent | Playwright and test:browser:install were not added. |
| `cc4fcdaef444` | refactor: simplify header layout alignment (#293) | applied | Mobile top nav button contains sr-only 'Toggle navigation menu'. Accent classes, the lg:hidden wrapper, header layout, and ThemeSwitch were not rearranged. |
| `2598ea68c61c` | refactor(search): update props type and enhance a11y (#294) | applied | Search spreads button props, sets aria-keyshortcuts='Meta+K Control+K', and uses logical inset classes. Callers still render <Search /> with no extra props. |
| `c2a1e3df45fc` | refactor(tailwind): apply canonical logical inset utilities (#295) | intentionally-divergent | Wholesale logical-inset restyle was not applied. inset-e and inset-s were folded only into the password and search patches. |
| `f35502d1da15` | chore: add workspace settings and extension recommendations (#296) | intentionally-divergent | VS Code workspace settings and extension recommendations were not added. |
| `2fbb6638e144` | chore(github): add refactor & breaking change types to PR template (#297) | intentionally-divergent | The upstream pull-request template types were not added. |
| `b70867e4abb0` | chore(deps): upgrade clerk core 3 (#298) | applied | @clerk/clerk-react was replaced by @clerk/react. Surviving imports use @clerk/react. User management uses <Show when='signed-in'> because SignedIn is absent from 6.17.8. ClerkProvider keeps signInFallbackRedirectUrl, signUpFallbackRedirectUrl, afterSignOutUrl, signInUrl, and signUpUrl. The missing-key development screen remains and names @clerk/react. User-management layout was not replaced with upstream's header. |
| `1d578ca95622` | refactor(showSubmittedData): remove unused comment | intentionally-divergent | The unused comment removal in show-submitted-data is housekeeping with no behavior change. |
| `a487a66fc0c2` | fix(chats): use display name initials for avatar fallback (#299) | applied | getDisplayNameInitials handles an empty name, one word, and the first and last words. Chat list and selected-user avatar fallbacks use the display name. Chat header layout was not changed. |
| `861ffdf2cabe` | chore(prettier): add tailwindFunctions for cn/clsx class sorting | intentionally-divergent | prettier tailwindFunctions for cn/clsx was not enabled. It would reorder class strings across the fork. |
| `1c23282d33d7` | refactor: sort tailwind classes in calendar and users-columns | intentionally-divergent | Calendar and users-column class sorting was not imported. |
| `05ca679fe15f` | chore: remove redundant formatter settings and unused setting | intentionally-divergent | VS Code formatter setting cleanup was not imported. |
| `a6352e7df0de` | refactor: replace classNames with suggested Tailwind canonical classes | intentionally-divergent | Canonical Tailwind replacement across shared UI, tables, calendar, settings, and sidebar was not applied. Sidebar Phosphor behavior stays intact. |
| `e16c87f213a5` | build(deps): bump @clerk/react from 6.4.2 to 6.4.3 (#303) | applied | The @clerk/react range is ^6.4.3. pnpm resolved 6.17.8, which satisfies that range. The package no longer exports SignedIn, so the Show migration in the Core 3 commit is required at this resolution. |

## Dependency resolution

`packageManager` remains `pnpm@10.30.2`. The worktree `node_modules` symlink
was replaced with a worktree-local install. The primary checkout's
`node_modules` was not rewritten. `server/pnpm-lock.yaml` was not regenerated:
a lockfile-only install changed formatting only and made Prettier fail, so it
was restored. Server dependencies were installed with `--frozen-lockfile` into
this worktree only.

Prettier is declared `~3.8.5` and resolved `3.8.5`. Upstream's `^3.8.3` range
resolves to 3.9.10, which reformats unrelated dashboard and server sources.
The 3.8 line still reformats `docs/implemented/2026-07-plan-fork-review-medium-items.md`;
that reformat is included so `pnpm format:check` passes.

| Package | Declared | Resolved | Note |
| --- | --- | --- | --- |
| `@clerk/react` | `^6.4.3` | 6.17.8 | Replaces removed `@clerk/clerk-react` 5.x. Engines `node >=20.9.0`. React peer `^18.0.0 || ~19.0.3 || ~19.1.4 || ~19.2.3 || ~19.3.0-0`. |
| `react` / `react-dom` | `^19.2.5` | 19.3.1 | Satisfies the Clerk 19.3 peer. pnpm reported no Clerk peer warning. |
| `@tanstack/react-query` | `^5.99.0` | 5.104.4 | Federation shared range stays `^5.0.0`. |
| `@tanstack/react-router` | `^1.168.22` | 1.170.45 | Engines `node >=20.19`. Regenerated `src/routeTree.gen.ts` keeps the same 70 route ids and paths. |
| `vite` | `^8.0.8` | 8.3.4 | Engines `^20.19.0 || >=22.12.0`. |
| `typescript` | `~6.0.3` | 6.0.3 | Pre-existing peer warning: `@module-federation/dts-plugin` wants TypeScript 4.9 or 5. |
| `eslint` | `^10.2.1` | 10.13.0 | |
| `eslint-plugin-react-hooks` | `^7.1.1` | 7.1.1 | `react-hooks/static-components` is disabled on the intentional `lazy()` retry in `src/shell/remote-dashboard.tsx`. |
| `prettier` | `~3.8.5` | 3.8.5 | Constrained below 3.9. |
| `vitest` / `@vitest/ui` | `^4.1.6` | 4.1.6 | Newer than upstream `^4.1.4`; not downgraded. |
| `@vitejs/plugin-react-swc` | `^4.3.0` | 4.3.0 | Retained. Peer accepts Vite 8. |
| `@module-federation/vite` | `^1.15.4` | 1.15.4 | Peer accepts Vite 8. Five remotes and singleton sharing were not edited. |
| `cmdk` | `^1.1.1` | 1.1.1 | Caret retained. |
| `react-day-picker` | `^9.14.0` | 9.14.0 | Caret retained. |
| `lucide-react` | `^1.8.0` | 1.59.0 | |
| `react-hook-form` | `^7.72.1` | 7.90.0 | |

Local Node is v24.5.0. Dockerfiles stay on `node:22-alpine`. CI still requests
`node-version: 20` and was not changed. `@clerk/react` requires `>=20.9.0`.
The refreshed router, Vite, SWC plugin, and ESLint require Node `>=20.19` on
the Node 20 line. This worktree was validated on Node v24.5.0.

Downstream-only packages kept include `@module-federation/vite`, `pg`,
`pgsql-parser`, `msw`, Testing Library, and `jsdom`.

## Preserved fork behavior

- Phosphor fixed-dark styling, accents, and sidebar hiding in the config drawer.
- Clerk development fallback when the publishable key is missing.
- ClerkProvider redirect and sign-in URL props listed above.
- Five remote module interfaces, route and deep-link structure, and shared
  React, React DOM, and Query singletons. `vite.config.ts` was not edited.
- Dev and production proxies, server-side credentials, and header stripping.
- Report query, cache identity, fallback, quota, privacy, freshness, and
  unknown or null handling. No server report source was edited.
- Safer `handle-server-error` behavior and `Content not found.`
- SWC/Vite and jsdom/Node tests. Vitest was not downgraded.

## Validation

| Command | Result |
| --- | --- |
| `pnpm format:check` | Pass. |
| `pnpm lint` | Pass. Four existing `react-refresh/only-export-components` warnings in badge, button, form, and sidebar. |
| `pnpm typecheck:tests` | Pass. |
| `pnpm exec tsc -b --pretty false` | Pass. |
| `pnpm exec vite build` | Pass, Vite 8.3.4. Federation chunks, including `remoteEntry`, were emitted. Warnings: future native config loader rejects `__dirname` in `vitest.config.ts`; SWC plugin suggests `@vitejs/plugin-react` because no SWC plugins are configured. |
| `pnpm exec vitest run --project frontend --maxWorkers 4 --testTimeout 15000` | 92 files passed, 1340 tests passed, 1 skipped. |
| `pnpm exec vitest run --project server --maxWorkers 4` | 19 files: 422 passed, 2 failed. See unmet items. |
| Earlier unbounded frontend run | 23 failures were 5-second timeouts and load-induced unhandled rejections. The same files passed alone and in the limited-worker rerun. |

jsdom does not prove module federation or a configured Clerk session. Enter on a
form whose associated submit button is disabled still submits in jsdom, so the
typed-confirmation guards are what the new tests lock.

## Unmet acceptance

- No real shell or remote deep link was opened in a browser.
- No configured Clerk sign-in, sign-out, or protected navigation was run.
  Doing so would require credentials, and those were not placed in client assets.
- `server/container-error-intake-boundary.test.mts` spawns `dash`, which is not
  installed (`command -v dash` is empty). `termProc.pid` stays undefined.
- `server/docker-log-error-intake.test.mts` embeds working directory
  `/home/zepfu/projects/dashboard-shell`. From this worktree, the cwd marker is
  `.../dashboard-shell-worktrees/d1-516`, and the default marker
  `dashboard-shell/docker-compose` is not in that fixture, so discovery returns
  no source. The matcher was not changed.
- `origin/develop` at `cdc297bc` is not contained in this branch.
