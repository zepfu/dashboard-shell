# Handoff: D1-506 post-stream retry, delivery, and replay-safety read model

- Created: 2026-10-19
- Dashboard repo: `/home/zepfu/projects/dashboard-shell` worktree `work/d1-506-retry-delivery-read-model`
- Dashboard baseline: `0da3ef8eb7ee698cc079013616baeef54608fc79`
- Upstream repo (read-only, not modified): `/home/zepfu/projects/litellm` at `2926b85277306964d51640791a77c187adf8d396`
- Item: D1-506. Dashboard view remains incomplete until this contract is persisted and a later dashboard change reads it.

## Verdict

The producer decisions exist in LiteLLM process memory, exception attributes, in-process route rollups, and `AAWM_TERMINAL_ERROR` log lines. They are not on the session-history metadata allowlist, and ordinary failure callbacks often write no `session_history` row. This document is the dashboard-owned request for the missing durable read model. It does not change LiteLLM.

## Allowlist finding

`_AAWM_SESSION_HISTORY_METADATA_KEYS` is the 340-key tuple in `litellm/integrations/aawm_agent_identity/constants.py` starting at line 56. The stream-tracker keys near line 346 are present. The outcome keys below are absent from that tuple.

Present, and owned by D1-501 rather than this request:

- `aawm_stream_tracker_state`
- `aawm_stream_synthetic_terminal`
- `aawm_stream_terminal_event_type`
- `aawm_stream_incomplete_reason`
- `aawm_stream_recovery_outcome`
- `aawm_stream_recovery_parent_litellm_call_id`
- `aawm_stream_recovery_previous_response_id`

Absent from the allowlist (verified by evaluating the tuple):

- `aawm_failure_origin`
- `aawm_responses_stream_failure_retryable`
- `aawm_delivered_disposition`
- `aawm_delivered_wire_disposition`
- `aawm_passthrough_hidden_retry_count`
- `aawm_openai_retry_logical_count`
- `aawm_stream_replayable`
- `stream_hidden_retry_safe`
- `pre_commit_retry_exhausted`
- `aawm_route_rollup_turn_suppressed`
- `aawm_stream_interrupted`
- `aawm_responses_stream_failed`
- `attempt_count`

`_build_session_history_metadata` (`litellm/integrations/aawm_session_history/record.py:1033`) copies only allowlisted keys and skips `None` (`record.py:1035`). The live history row stores that filtered object at `record.py:1660` and `record.py:1740`.

## Producer trace

| Decision | Where it is written | Where it goes |
|---|---|---|
| Failure origin, responses-stream retryability, delivered disposition | `streaming_handler.py` `_finalize_failed_responses_stream` around 3907–4046. `aawm_failure_origin` is `local_policy`, `local_transport`, `local_missing_terminal`, or `provider`. `aawm_responses_stream_failure_retryable` is the boolean after policy and disposition overrides. `aawm_delivered_disposition` is the normalized snapshot disposition. | Logging metadata, then `async_failure_handler` at `streaming_handler.py:4198`. A recognized non-empty terminal payload is also copied to `aawm_provider_terminal_payload` / `aawm_provider_terminal_error_payload`. Those payload objects are out of this request. |
| Immutable delivery disposition | `get_delivered_wire_disposition` in `openai_delivered_disposition.py:51` returns a snapshot only when `finalized` and `asgi_delivery_complete` are true and `disposition` is `completed`, `failed`, `incomplete`, `cancelled`, or `disconnected`. Completed streams copy it at `streaming_handler.py:2143`. | Same metadata filter. A missing snapshot is not a completed delivery. |
| Hidden-retry attempt count | `_record_passthrough_hidden_retry_metadata` sets `aawm_passthrough_hidden_retry_count` at `pass_through_endpoints.py:3275`. `_copy_openai_retry_progress` copies that same integer to `aawm_openai_retry_logical_count` at `pass_through_endpoints.py:3163`. | Metadata only. Route rollups read the logical count in `_openai_retry_facts_from_metadata` (`aawm_route_logging.py:4162`) and ignore it unless the count is an int greater than 0. Rollups are process-local logs. |
| Suppression after delivery or commitment | Post-first-byte failure context sets `stream_hidden_retry_safe` false (`streaming_handler.py:3180`, clean EOF at 3035, redispatch-after-substantive at 3330, adapter timeout at `codex_candidate_calls.py:9405`). Clean EOF also sets `aawm_stream_replayable` false (`streaming_handler.py:3050`). A non-completed delivered disposition forces `ResponsesStreamPreCommitFailure.retryable` false and `pre_commit_retry_exhausted` true except the cancelled-without-terminal retryable case (`streaming_handler.py:4079`). `aawm_openai_wire_replay_blocked` is an exception attribute that stops another pre-first-byte hidden retry (`pass_through_endpoints.py:2928`). | The exhausted flag and wire-replay flag stay on the exception. `stream_hidden_retry_safe` is merged into metadata and then dropped by the allowlist. `aawm_route_rollup_turn_suppressed` is separate rollup accounting (`streaming_handler.py:3870`, also set for unstarted streams at 2795). |
| Replay-safety label on account failover | `retry_attempt_record["replay_safety"]` is `replay_safe` or `replay_unsafe` at `llm_passthrough_endpoints.py:3605`. | Alias-routing audit metadata. That surface belongs to D1-505. |

Failure persistence stops before a normal history insert for many of these calls. `_handle_session_history_failure_event` (`record.py:2682`) keeps a record only when `_build_failure_observation_only_record` (`record.py:228`) finds a rate-limit observation, provider-error observation, structured-output failure, or watermark-policy failure. Otherwise it returns `None` (`record.py:262`). Provider-error-only records set `_skip_session_history` (`record.py:120`), and `_persist_session_history_record` then inserts no history row (`record.py:2533`). `_build_provider_error_observation` (`provider_errors.py:556`) stores client identity, a truncated error string, and unrelated route fields. It does not copy failure origin, retryability, delivered disposition, hidden-retry count, or replayability. Its `retry_after_seconds` column is the provider retry-after hint, not a proxy attempt count.

`_emit_aawm_terminal_error` (`audit_persist.py:354`) writes one bounded `AAWM_TERMINAL_ERROR` log. Its `attempt_count` is `metadata.get("attempt_count")` when that separate key is an int. The log hashes correlation ids. It is not a queryable history row.

`_build_session_history_record` returns `None` when session id extraction fails (`record.py:1074`). Allowlisting keys does not create that row.

## Requested durable fields

Upstream owner: LiteLLM session-history persistence. Add the scalars to `_AAWM_SESSION_HISTORY_METADATA_KEYS` and copy them through `_build_session_history_metadata`, preserving `0` and `false`. Also persist the same scalars on a failure-only durable row when the failure builder returns `None` or sets `_skip_session_history`, so a missing history insert does not drop the outcome.

No new dashboard column names. No raw payload, attempt list, terminal payload, account hash, or measured-wait field.

Identity, using existing call identity:

- `litellm_call_id`: required join key.
- `session_id`: the same value `_extract_session_id` already uses, or null when that extractor has no session.
- `trace_id`: existing trace id, or null.
- `observed_at`: existing `end_time` when a history row exists; the failure-only row uses the failure callback end time.

Do not join through the terminal-error hash, the transfer registry, or route-rollup origin labels.

| Field | Type and recorded values | Null / absence | Coverage |
|---|---|---|---|
| `aawm_failure_origin` | String already produced: `provider`, `local_policy`, `local_transport`, `local_missing_terminal`. | Null means the failure finalizer did not record an origin. | Failure-only. |
| `aawm_responses_stream_failure_retryable` | Boolean from `_finalize_failed_responses_stream` after the policy and delivered-disposition overrides. `true` means that finalizer recorded the failure as eligible for retry. `false` means it recorded the failure as ineligible. | Null means that eligibility decision did not run. | Failure-only. This is eligibility, not an attempt count. |
| `aawm_passthrough_hidden_retry_count` | Non-negative integer already written by `_record_passthrough_hidden_retry_metadata`. The first logical provider send is not a retry; additional sends increment the count. | Null means the hidden-retry recorder did not write the key. `0` means the recorder ran and counted no retry. | Success and failure rows whenever the recorder ran, including `success_after_retry`. |
| `aawm_post_delivery_retry_suppressed` | New boolean. Upstream sets it only from decisions that already exist. `true` when `pre_commit_retry_exhausted` was set because a non-completed delivered disposition was published (`streaming_handler.py:4079`), or `stream_hidden_retry_safe` was set false on a post-first-byte, clean-EOF, substantive-redispatch, or adapter-timeout path, or `aawm_stream_replayable` was set false. `false` when the delivered-disposition finalizer ran and left the cancelled-without-terminal case retryable (`streaming_handler.py:4001`). | Null means none of those suppressors ran. | Failure and interruption paths that reached one of those producers. A completed delivery leaves this null. |
| `aawm_delivered_disposition` | String already copied from the immutable snapshot: `completed`, `failed`, `incomplete`, `cancelled`, `disconnected`. | Null means no finalized `asgi_delivery_complete` snapshot with a recognized disposition was published. | Success and failure, only where `get_delivered_wire_disposition` returned a snapshot. |
| `aawm_stream_replayable` | Boolean already assigned by the clean-EOF terminalizer, which sets `false`. Persist `true` only if a producer assigns `true`. | Null means replay-safety was not recorded. | Post-stream paths that assign the key. Today the assignment found is `false` at `streaming_handler.py:3050`. |

`aawm_openai_retry_logical_count` is the same integer as `aawm_passthrough_hidden_retry_count` for rollup display. Persist the hidden-retry count once. Do not store the logical-count copy as a second attempt total.

`aawm_post_delivery_retry_suppressed` must be computed from the producer decisions listed above. It must not be copied from `aawm_route_rollup_turn_suppressed`, from chunk or byte counters, from `aawm_upstream_stream_complete_ms` or other measured waits, or from a synthetic terminal event.

## Null semantics the dashboard will use

Omitted and JSON null are the same state: unavailable. They are not zero retries, not ineligible, not unsuppressed, not replayable, and not a successful delivery.

`0` is a recorded count. `false` is a recorded negative decision. `true` is a recorded positive decision. A string is a recorded enum value.

`_build_session_history_metadata` already keeps `0` and `false` and drops `None`. The failure-only row needs the same rule. Do not coerce a missing producer key to `0` or `false` before insert.

## Failure-only coverage

Failure-only fields are `aawm_failure_origin`, `aawm_responses_stream_failure_retryable`, and `aawm_post_delivery_retry_suppressed`. On a successful history row they stay null.

`aawm_delivered_disposition` and `aawm_passthrough_hidden_retry_count` are not failure-only. A completed snapshot and a pre-first-byte retry count can exist on a success row.

`aawm_stream_replayable` is recorded only where the post-stream producer assigns it. Absence on a success row stays unavailable.

The failure-only row is required because `_handle_session_history_failure_event` currently drops ordinary stream failures, and provider-error side rows do not carry these fields. A history row that exists without the scalars still means unavailable for the missing keys. A call with no history row and no failure-only outcome row is absent from this read model; the dashboard cannot reconstruct it.

D1-501 `aawm_stream_incomplete_reason` and synthetic-terminal fields can be present while every field in this request is null. A synthetic `response.incomplete` is not `aawm_delivered_disposition=incomplete` and is not evidence of a timeout. Recovery linkage is not an attempt count.

## Upstream ownership

LiteLLM owns emission and persistence:

- allowlist: `litellm/integrations/aawm_agent_identity/constants.py`
- metadata copy and failure insert decision: `litellm/integrations/aawm_session_history/record.py`
- producers: `litellm/proxy/pass_through_endpoints/streaming_handler.py`, `pass_through_endpoints.py`, and the delivered-disposition helper

Dashboard-shell will read the persisted scalars after that contract is in the running schema. This handoff does not authorize a LiteLLM edit from the dashboard worktree.

These stores are not substitutes:

- `provider_error_observations.retry_after_seconds` and its metadata object
- `AAWM_TERMINAL_ERROR` logs and hashed correlation ids
- in-process route rollups and `aawm_route_rollup_turn_suppressed`
- the short-lived transfer registry (D1-511)
- D1-505 `aawm_alias_routing_audit.metadata` replay, redispatch, and owner evidence, including `replay_safety` values `replay_safe` and `replay_unsafe`

## Dashboard follow-up, still blocked

After the fields above are present on the allowlist and on the failure-only row, a later dashboard change can show, for one call:

- retry eligibility from `aawm_responses_stream_failure_retryable`
- actual attempts from `aawm_passthrough_hidden_retry_count`
- suppression after delivery or commitment from `aawm_post_delivery_retry_suppressed`
- final delivery disposition from `aawm_delivered_disposition`
- replay-safety from `aawm_stream_replayable`
- failure origin from `aawm_failure_origin`

Unavailable stays distinct from `0` and `false`. The view reuses D1-501 tracker and recovery diagnostics and D1-505 owner and audit diagnostics as neighboring evidence. It does not recreate those panels and does not read their unmerged branches. No dashboard query, API, or UI is added in this change, because the contract is not persisted.
