# D1-512 handoff: sanitized prompt-replacement read model

Status: the sanitized summary contract is absent from current litellm session-history persistence. This dashboard queue entry stops at the request below. It does not authorize implementation in the litellm repository, and the dashboard does not render an outcome until that contract is present and verified.

Read-only evidence revision: litellm `2926b85277306964d51640791a77c187adf8d396`.
Dashboard baseline: `0da3ef8eb7ee698cc079013616baeef54608fc79` on `work/d1-512-prompt-replacement-read-model`.

## Persistence prerequisite

`public.session_history.metadata` is written by `_build_session_history_metadata` (`litellm/integrations/aawm_session_history/record.py`, near line 1013). That function stores `request_tags`, `tenant_id`, `canonical_thread_id`, `parent_thread_id`, and values whose keys are in `_AAWM_SESSION_HISTORY_METADATA_KEYS` (`litellm/integrations/aawm_agent_identity/constants.py`, the tuple beginning near line 56).

The shared hook records an internal object that this allowlist does not copy:

- `build_replacement_metadata` (`prompt_replacement_engine.py`, near line 863) returns `matched_rule_ids`, `total_replacements`, `failure_count`, `failures`, and `manifest_paths`.
- `_merge_replacement_metadata` (`prompt_replacement_hooks.py`, near line 209) places that object at `litellm_metadata.prompt_replacement` and adds tags `prompt-replacement`, `prompt-replacement-rule:<id>`, and, when failures exist, `prompt-replacement-rule-failed`.
- The merge runs only when `result.matched` or `result.failures` is non-empty. A completed evaluation with no match returns the original body and writes nothing.
- Manifest-load failures call the same merge with `failures[].error` and no safe version.
- Call-site exceptions in the OpenAI, Anthropic, and Gemini passthrough handlers log and leave the body unchanged, so they also write nothing.
- The standard hook runs after `add_litellm_data_to_request` (`common_request_processing.py`). New `litellm_metadata` keys are therefore not copied back onto the metadata dict that session history reads.
- `StandardLoggingMetadata` (`litellm/types/utils.py`, near line 2684) also has no prompt-replacement field. Standard logging keeps only `_STANDARD_LOGGING_METADATA_KEYS`.

The Claude facade writes a parallel unsanitized surface (`claude_prompt_patch_*`, `claude_system_prompt_override_*`, event lists, manifest and template paths, and Langfuse span descriptors in `claude_prompt_replacement.py`). Those keys are also absent from `_AAWM_SESSION_HISTORY_METADATA_KEYS`. Langfuse spans and payload-capture bodies are not this read model.

`request_tags` can carry the hook tags when those tags are already on the metadata object that standard logging or session history reads. That is not the contract. Tags omit replacement counts, failure counts, failure identifiers, a rule-set version, and an explicit no-match or unavailable status. A missing tag is equally consistent with no match, an uninstrumented route, a swallowed hook exception, and a tag list that preferred another metadata object (`litellm_logging.py` `_get_request_tags`, which uses `metadata.tags` whenever that list is non-empty). The dashboard must not classify outcomes from `request_tags`, selected route, provider, model, or final output.

The current `prompt_replacement` object must not be allowlisted as-is. It contains `manifest_paths` and `failures` (`id`, `status`, and `error`, including exception class names from `apply_rules_to_text`).

## Requested object

Persist one JSON object on the session-history metadata dict under the new key `aawm_prompt_replacement_outcome`, and add that exact key to `_AAWM_SESSION_HISTORY_METADATA_KEYS`. The writer must place it on `litellm_params.metadata` before `_build_session_history_metadata` runs, for both the standard hook and passthrough hooks.

```json
{
  "schema_version": 1,
  "status": "applied",
  "rule_set_version": "opaque-version-or-null",
  "matched_rule_ids": ["rule-id"],
  "failure_rule_ids": [],
  "matched_count": 1,
  "replacement_count": 2,
  "failure_count": 0
}
```

`schema_version` is the integer `1`.

`status` is one of:

| status | Meaning | Counts |
| --- | --- | --- |
| `applied` | Evaluation finished, at least one replacement was applied, and no rule failed. This is matched-and-applied. | `replacement_count >= 1`, `failure_count == 0`, `matched_count >= 1` |
| `no_match` | Evaluation finished, no rule matched, and no rule failed. Includes an empty rule set after a successful load. | all three counts are `0` |
| `failed` | Evaluation finished and at least one rule failed. Partial replacements stay in the counts; the status stays `failed`. | `failure_count >= 1` |
| `unavailable` | The hook was responsible for the request and could not evaluate it: manifest load failure, unsupported adapter after entry, or a caught hook exception. | all three counts are JSON `null`; both id lists are JSON `null` |

A missing `aawm_prompt_replacement_outcome` key means missing telemetry. Routes outside the replacement surface leave the key absent. The dashboard treats a missing key, a `schema_version` other than `1`, or a status outside the four values as missing telemetry. It does not treat those rows as no-match.

`rule_set_version` is either JSON `null` or an opaque sanitized version token (`^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$`). It identifies the evaluated rule set. It is not a filesystem path, package path, manifest path, or template path.

`matched_rule_ids` and `failure_rule_ids` contain unique sanitized rule identifiers in stable order, at most 32 each, each matching `^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$`. Identifiers outside that pattern are omitted. Counts stay the true totals when the lists are truncated or identifiers are omitted; the list length is then a lower bound, and the writer sets `matched_rule_ids_truncated` or `failure_rule_ids_truncated` to `true`. Those booleans are absent when the corresponding list is complete.

Completed evaluations (`applied`, `no_match`, `failed`) always include numeric counts and arrays. `no_match` must be stored. Omitting the key on no match collides with missing telemetry.

The object contains only the fields above. It does not contain prompt text, replacement bodies, match excerpts, raw exception messages, tracebacks, exception class names, `failures` objects, filesystem paths, manifest paths, or template paths.

## Correlation

The object describes the replacement decision for the body associated with that `session_history` row. Correlation is the row itself:

- `litellm_call_id`
- `trace_id`
- `session_id`
- `provider`
- `model`
- `call_type`
- `start_time`

No second store and no duplicated provider field are required. When one inbound request produces multiple session-history rows, each row carries the outcome of the body submitted for that row, or `unavailable` when that body was not evaluated. The dashboard does not copy one row's outcome onto another and does not infer success from the selected route or the model output.

## Verification the upstream change must supply

A session-history writer test on the litellm side must show a stored `metadata.aawm_prompt_replacement_outcome` for `applied`, `no_match`, `failed`, and `unavailable`, and must show that the stored JSON has no prompt text, replacement body, exception payload, or path. Until that test matches the object above, the contract is not delivered.

## Dashboard follow-up after verification

After the key is verified in persisted `session_history.metadata`, the dashboard may project `aawm_prompt_replacement_outcome` from the metadata already selected by `buildSessionDiagnosticsQuery` in `server/report-service.mjs` and show, per row and as coverage counts:

- matched-and-applied (`status == applied`)
- no match
- failure
- missing telemetry (key absent, `unavailable`, or an unrecognized schema/status)

Display `rule_set_version`, the three counts, and the bounded identifier lists. Coverage uses those persisted statuses only.

This queue entry does not authorize the litellm writer, allowlist edit, or writer test.
