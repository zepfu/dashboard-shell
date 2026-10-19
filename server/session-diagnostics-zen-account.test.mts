import { describe, expect, test } from 'vitest'
import {
  buildQuotaQuery,
  buildSessionDiagnosticsQuery,
  __usageReportTestHelpers,
} from './report-service.mjs'
import {
  EMPTY_QUOTA_ACCOUNT_REF,
  projectVerifiedZenAccountRef,
  quotaAccountRefFromAccountHash,
  quotaAccountRefSql,
  resolveSessionDiagnosticsZenAccountRef,
  sessionDiagnosticsZenAccountSql,
} from './session-diagnostics-zen-account.mjs'

const DIGEST_A = `sha256:${'ab'.repeat(32)}`
const DIGEST_B = `sha256:${'cd'.repeat(32)}`
const REF_A = '36f6769913c7'
const REF_B = '27b7269c6ae2'

function zenAccountSql() {
  return sessionDiagnosticsZenAccountSql({
    metadataExpression: 'metadata',
    providerExpression: 'provider',
  })
}

function sqlObjectProjection(sql: string, alias: string): string {
  const aliasAt = sql.indexOf(`AS ${alias}`)
  const start = sql.lastIndexOf(
    'jsonb_strip_nulls(jsonb_build_object(',
    aliasAt
  )
  return sql.slice(start, aliasAt)
}

describe('D1-504 verified Zen account refs', () => {
  test('projects two distinct Zen digests with the quota md5 ref', () => {
    expect(EMPTY_QUOTA_ACCOUNT_REF).toBe('d41d8cd98f00')
    expect(quotaAccountRefFromAccountHash(DIGEST_A)).toBe(REF_A)
    expect(quotaAccountRefFromAccountHash(DIGEST_B)).toBe(REF_B)
    expect(REF_A).not.toBe(REF_B)
    expect(REF_A).not.toBe(DIGEST_A.slice(7, 19))
    expect(REF_B).not.toBe(DIGEST_B.slice(7, 19))

    expect(
      projectVerifiedZenAccountRef({
        provider_account_hash: `  ${DIGEST_A}  `,
        credential_family: 'OpenCode_Zen',
      })
    ).toBe(REF_A)
    expect(
      projectVerifiedZenAccountRef({
        provider_account_hash: DIGEST_B,
        provider: 'opencode_zen',
      })
    ).toBe(REF_B)
    expect(
      projectVerifiedZenAccountRef({
        metadata: {
          provider_account_hash: DIGEST_A,
          passthrough_route_family: 'opencode_zen',
        },
      })
    ).toBe(REF_A)
    expect(
      projectVerifiedZenAccountRef({
        provider_account_hash: DIGEST_B,
        route_family: 'opencode-zen',
      })
    ).toBe(REF_B)
  })

  test('keeps missing and unverified account sources unknown', () => {
    expect(
      projectVerifiedZenAccountRef({
        credential_family: 'opencode_zen',
      })
    ).toBeNull()
    expect(
      projectVerifiedZenAccountRef({
        provider_account_hash: 'raw-account-label',
        credential_family: 'opencode_zen',
        agent_id: DIGEST_A,
        caller_identity_hash: DIGEST_B,
      })
    ).toBeNull()
    expect(
      projectVerifiedZenAccountRef({
        provider_account_hash: DIGEST_A.toUpperCase(),
        credential_family: 'opencode_zen',
      })
    ).toBeNull()
    expect(
      projectVerifiedZenAccountRef({
        provider_account_hash: DIGEST_A,
        credential_family: 'opencode_go',
        provider: 'opencode_go',
        passthrough_route_family: 'opencode_go',
      })
    ).toBeNull()
    expect(
      projectVerifiedZenAccountRef({
        provider_account_hash: DIGEST_A,
        credential_family: 'xai_grok_oidc',
        provider: 'xai',
        account_hash: DIGEST_B,
        agent_id: 'agent-a',
        caller_identity_hash: 'caller-a',
        client: 'opencode-zen',
        client_name: 'opencode-zen',
      })
    ).toBeNull()
    expect(
      resolveSessionDiagnosticsZenAccountRef({
        zen_account_ref: DIGEST_A,
      })
    ).toBeNull()
    expect(
      resolveSessionDiagnosticsZenAccountRef({
        zen_account_ref: 'raw-account-label',
      })
    ).toBeNull()
    expect(
      resolveSessionDiagnosticsZenAccountRef({
        zen_account_ref: EMPTY_QUOTA_ACCOUNT_REF,
      })
    ).toBeNull()
    expect(
      resolveSessionDiagnosticsZenAccountRef({
        zen_account_ref: REF_A.slice(0, 8),
      })
    ).toBeNull()
    expect(
      resolveSessionDiagnosticsZenAccountRef({
        provider_account_hash: DIGEST_A,
        credential_family: 'opencode_zen',
        zen_account_ref: REF_B,
      })
    ).toBe(REF_A)
  })

  test('query uses the quota ref formula and admits account-only rows within existing bounds', async () => {
    const zen = zenAccountSql()
    const query = buildSessionDiagnosticsQuery(
      new URLSearchParams({
        from: '2026-05-01',
        to: '2026-05-08',
        limit: '1',
      })
    )

    expect(buildQuotaQuery().sql).toContain(
      quotaAccountRefSql('s.account_hash')
    )
    expect(zen.projectionSql).toContain(
      quotaAccountRefSql(`btrim(metadata->>'provider_account_hash')`)
    )
    expect(query.metadata).toEqual({
      from: '2026-05-01',
      to: '2026-05-08',
      limit: 1,
      candidateLimit: 5000,
    })
    expect((query.values ?? []).slice(-2)).toEqual([5000, 1])

    const recentStart = query.sql.indexOf('recent_sessions AS MATERIALIZED')
    const recentEnd = query.sql.indexOf('diagnostic_rows AS')
    expect(query.sql.slice(recentStart, recentEnd)).toContain(zen.admissionSql)
    expect(query.sql).toContain(`${zen.projectionSql} AS zen_account_ref`)
    expect(query.sql).toContain("'zen_account'::text")
    expect(query.sql).toContain("'account_identity'::text")
    expect(query.sql).not.toContain('AS provider_account_hash')
    expect(query.sql).not.toContain('caller_identity_hash')
    expect(query.sql).not.toContain('user_api_key')
    expect(zen.admissionSql).not.toContain('agent_id')
    expect(zen.admissionSql).not.toContain('caller_identity')
    expect(zen.admissionSql).not.toContain('client_name')
    expect(zen.admissionSql).not.toContain('IS NOT NULL')
    expect(zen.projectionSql).toContain(
      "btrim(metadata->>'provider_account_hash') ~ '^sha256:[0-9a-f]{64}$'"
    )
    expect(zen.projectionSql).toContain("= 'opencode_zen'")
    expect(zen.projectionSql).toContain("position('opencode_zen'")
    expect(zen.projectionSql).toContain("position('opencode-zen'")

    const grokOauthSql = sqlObjectProjection(query.sql, 'grok_oauth')
    expect(grokOauthSql).toContain("'credential_family'")
    expect(grokOauthSql).toContain("'auth_mode'")
    expect(grokOauthSql).toContain("'route_family'")
    expect(grokOauthSql).toContain("'passthrough_route_family'")
    expect(grokOauthSql).not.toContain('provider_account_hash')
    expect(grokOauthSql).not.toContain('md5(')

    const { parse } = await import('pgsql-parser')
    const parsed = await parse(query.sql)
    expect(parsed.stmts.length).toBeGreaterThan(0)
  })

  test('normalizer keeps route fields and drops unverified account material', () => {
    const { normalizeSessionDiagnosticsRow } = __usageReportTestHelpers
    const verified = normalizeSessionDiagnosticsRow({
      session_id: 'sess-zen-a',
      trace_id: 'trace-zen-a',
      litellm_call_id: 'call-zen-a',
      provider: 'opencode_zen',
      provider_account_hash: DIGEST_A,
      agent_id: 'agent-a',
      caller_identity_hash: 'caller-a',
      grok_oauth: {
        credential_family: 'opencode_zen',
        passthrough_route_family: 'opencode_zen',
        route_family: 'opencode_zen',
        auth_mode: 'api_key',
        provider_account_hash: DIGEST_A,
      },
    })
    const other = normalizeSessionDiagnosticsRow({
      session_id: 'sess-zen-b',
      litellm_call_id: 'call-zen-b',
      zen_account_ref: REF_B,
    })
    const invalid = normalizeSessionDiagnosticsRow({
      session_id: 'sess-invalid',
      provider_account_hash: 'raw-account-label',
      account_hash: DIGEST_B,
      agent_id: 'agent-invalid',
      caller_identity_hash: 'caller-invalid',
      zen_account_ref: DIGEST_A,
      grok_oauth: {
        credential_family: 'xai_grok_oidc',
        passthrough_route_family: 'grok_cli_chat_proxy',
        route_family: 'grok',
        auth_mode: 'oidc',
        provider_account_hash: DIGEST_B,
      },
    })

    expect(verified.zen_account_ref).toBe(REF_A)
    expect(other.zen_account_ref).toBe(REF_B)
    expect(verified.zen_account_ref).not.toBe(other.zen_account_ref)
    expect(verified.grok_oauth).toMatchObject({
      credential_family: 'opencode_zen',
      passthrough_route_family: 'opencode_zen',
      route_family: 'opencode_zen',
      auth_mode: 'api_key',
    })
    expect(verified.grok_oauth).not.toHaveProperty('provider_account_hash')
    expect(verified).not.toHaveProperty('provider_account_hash')
    expect(verified).not.toHaveProperty('caller_identity_hash')
    expect(verified.agent_id).toBe('agent-a')
    expect(verified.zen_account_ref).not.toBe(verified.agent_id)
    expect(JSON.stringify(verified)).not.toContain(DIGEST_A)

    expect(invalid.zen_account_ref).toBeNull()
    expect(invalid.grok_oauth).toMatchObject({
      credential_family: 'xai_grok_oidc',
      passthrough_route_family: 'grok_cli_chat_proxy',
      route_family: 'grok',
      auth_mode: 'oidc',
    })
    expect(invalid.grok_oauth).not.toHaveProperty('provider_account_hash')
    expect(JSON.stringify(invalid)).not.toContain(DIGEST_A)
    expect(JSON.stringify(invalid)).not.toContain(DIGEST_B)
    expect(JSON.stringify(invalid)).not.toContain('raw-account-label')
    expect(invalid.agent_id).toBe('agent-invalid')
    expect(invalid.zen_account_ref).not.toBe(invalid.agent_id)
  })
})
