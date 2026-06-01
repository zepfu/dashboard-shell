# Handoff: xAI OAuth-managed model route metadata (D1-172)

Date: 2026-06-01
Source repo: `/home/zepfu/projects/litellm`
Dashboard-shell initiation: 2026-06-01 15:40:14 America/New_York
Dashboard-shell resumed: 2026-06-01 16:01:55 America/New_York
Dashboard-shell completed: 2026-06-01 16:12:03 America/New_York
Dashboard-shell duration: 31 minutes 49 seconds from initiation; 10 minutes 8 seconds from resume.
Dashboard-shell status: Completed and archived.

## Summary

LiteLLM D1-172 adds an OAuth-managed xAI model namespace for normal LiteLLM
model calls. Clients request public models under `oa_xai/*` with only their
LiteLLM key. LiteLLM resolves the call to the matching upstream `xai/*` model,
loads and refreshes a LiteLLM-owned xAI OAuth credential, and injects the xAI
bearer token server-side.

## Data Contract

Table: `aawm_tristore.public.session_history`

No new columns were added. The existing `metadata` JSON now carries additional
keys for `oa_xai/*` calls:

- `auth_mode`: `oauth`
- `credential_family`: `xai_oauth`
- `passthrough_route_family`: `xai_oauth_api`
- `route_family`: `xai_oauth_api`
- `xai_oauth_managed`: `true`
- `xai_oauth_public_model`: requested public model, for example
  `oa_xai/grok-4.3`
- `xai_oauth_upstream_model`: upstream LiteLLM model, for example
  `xai/grok-4.3`
- `xai_quota_family`: `xai_grok_subscription`
- `shared_quota_family`: `xai_grok_subscription`
- `grok_subscription_quota_shared`: `true`
- `model_group`: public model, for example `oa_xai/grok-4.3`
- `request_tags`: includes `route:xai_oauth_api`, `auth:xai_oauth`,
  `provider:xai`, and `quota:xai_grok_subscription`

Expected top-level attribution:

- `provider`: `xai`
- `model`: public `oa_xai/*` model for reporting continuity
- `model_group`: public `oa_xai/*` model
- `response_cost_usd`: non-null when usage is present and the catalog contains
  the public model entry

Provider-error observations preserve the same route and credential metadata.

## Reporting Guidance

Dashboard grouping should display `oa_xai/*` as xAI provider traffic while
preserving the public `oa_xai/*` model label. Do not merge these rows into
native Grok Build pass-through traffic, which uses
`passthrough_route_family=grok_cli_chat_proxy`.

Quota and rate-limit views should treat rows with
`shared_quota_family=xai_grok_subscription` as drawing from the same Grok
subscription pool as native Grok paths. They should not be interpreted as an
independent `oa_xai/*` capacity pool.

If the UI exposes auth/route filters, `xai_oauth_api` should be a distinct route
family from `grok_cli_chat_proxy`.

## LiteLLM Evidence

Focused verification in LiteLLM passed:

- `./.venv/bin/python -m py_compile litellm/llms/xai/oauth.py litellm/proxy/route_llm_request.py litellm/integrations/aawm_agent_identity.py litellm/proxy_auth/__init__.py tests/test_litellm/proxy/test_route_llm_request.py tests/llm_translation/test_xai.py tests/test_litellm/integrations/test_aawm_agent_identity.py`
- `./.venv/bin/python -m pytest tests/test_litellm/proxy/test_route_llm_request.py tests/llm_translation/test_xai.py tests/test_litellm/integrations/test_aawm_agent_identity.py -q -k 'oa_xai or xai_oauth'`
  returned `9 passed, 327 deselected, 1 warning`.
- JSON validation passed for `model_prices_and_context_window.json` and
  `litellm/bundled_model_prices_and_context_window_fallback.json`.

Dev container inspection found no configured `LITELLM_XAI_OAUTH_AUTH_FILE`, so
no live OAuth smoke was run from dashboard-shell handoff creation.

## Dashboard-shell Disposition

Implemented the dashboard-side compatibility required by this handoff:

- `oa_xai/*` public model identifiers now infer xAI branding instead of falling
  through to OpenRouter just because they contain a slash.
- `canonicalProvider()` and `providerColorFor()` treat `oa_xai` and
  `oa_xai/*` as xAI aliases while preserving the raw public model label for
  display.
- Provider Status quota lanes remain provider-led: a row with `provider: xai`
  and `model: oa_xai/grok-4.3` still renders under the single xAI monthly lane
  labeled `All Models · 30d`.
- Provider-card quota tooltip model rows now have regression coverage proving
  `oa_xai/grok-4.3` uses xAI brand color.

No server SQL changes were needed because the LiteLLM handoff contract states
top-level `session_history.provider` is `xai`; the dashboard quota queries and
quota lane builder already group xAI provider rows into the Grok monthly pool.

Verification:

- `pnpm exec vitest run src/features/dashboard/lib/usage-report-display.test.ts src/features/dashboard/components/provider-card.test.tsx src/features/dashboard/components/phosphor-dashboard.test.tsx`
  passed: 3 files, 207 tests.
- `pnpm exec vitest run` passed: 39 files, 541 tests.
- `pnpm exec tsc -b --pretty false` passed.
- `pnpm exec eslint src/features/dashboard/lib/usage-report-display.ts src/features/dashboard/lib/usage-report-display.test.ts src/features/dashboard/components/provider-card.test.tsx src/features/dashboard/components/phosphor-dashboard.test.tsx`
  passed.
- `git diff --check` passed.
- Read-only live DB probe for `model >= 'oa_xai/' AND model < 'oa_xai0'`
  returned no current rows; a broad `model LIKE 'oa_xai/%'` count exceeded the
  5 second statement timeout, so live row presence is not claimed as proof.
