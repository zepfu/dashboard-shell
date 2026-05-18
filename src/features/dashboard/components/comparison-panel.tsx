/**
 * ComparisonPanel — provider-vs-provider comparison table at ≥3840px.
 *
 * Operator decision 7: renders side-by-side provider comparison stats in the
 * data-tab="comparison" section, visible only at ≥3840px via CSS class.
 *
 * Structure per v9.7 reference HTML — data-tab="comparison" section,
 * grid-column: 14/21, grid-row: 7 at 4K. Display: none below 3840px.
 */
import type { ReactElement } from 'react'
import type { ModelRow } from './master-ledger-table'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ComparisonPanelProps {
  providers: string[]
  modelRows: ModelRow[]
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function fmtCompact(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`
  return String(n)
}

interface ProviderStat {
  provider: string
  tokensIn: number
  tokensOut: number
  cost: number
  requests: number
  avgP95: number
  errorPct: number
}

function buildProviderStats(
  providers: string[],
  modelRows: ModelRow[]
): ProviderStat[] {
  return providers.map((provider) => {
    const rows = modelRows.filter(
      (r) => r.provider.toLowerCase() === provider.toLowerCase()
    )
    const tokensIn = rows.reduce((s, r) => s + r.tokens_in, 0)
    const tokensOut = rows.reduce((s, r) => s + r.tokens_out, 0)
    const cost = rows.reduce((s, r) => s + r.cost_usd, 0)
    const requests = rows.reduce((s, r) => s + r.requests, 0)
    const p95Values = rows.map((r) => r.p95_ms).filter((v) => v > 0)
    const avgP95 =
      p95Values.length > 0
        ? p95Values.reduce((s, v) => s + v, 0) / p95Values.length
        : 0
    const errPcts = rows.map((r) => r.error_pct).filter((v) => v > 0)
    const errorPct =
      errPcts.length > 0
        ? errPcts.reduce((s, v) => s + v, 0) / errPcts.length
        : 0

    return { provider, tokensIn, tokensOut, cost, requests, avgP95, errorPct }
  })
}

// ---------------------------------------------------------------------------
// ComparisonPanel
// ---------------------------------------------------------------------------

/**
 * ComparisonPanel renders a side-by-side provider comparison table.
 * Only shown at ≥3840px via CSS (parent section has display:none below 4K).
 */
export function ComparisonPanel({
  providers,
  modelRows,
}: ComparisonPanelProps): ReactElement {
  const stats = buildProviderStats(providers, modelRows)

  return (
    <div
      className='comparison-wrapper'
      style={{
        background: 'var(--card)',
        border: '1px solid var(--border)',
        padding: '10px',
        overflowX: 'auto',
      }}
    >
      <table
        className='comparison-table'
        aria-label='Provider comparison'
        style={{
          width: '100%',
          borderCollapse: 'collapse',
          fontFamily: 'var(--font-mono)',
          fontSize: 'clamp(11px, 0.55vw, 14px)',
        }}
      >
        <thead>
          <tr>
            {[
              'Provider',
              'Toks In',
              'Toks Out',
              'Cost',
              'Requests',
              'Avg P95',
              'Err%',
            ].map((col) => (
              <th
                key={col}
                style={{
                  padding: '5px 6px',
                  textAlign: col === 'Provider' ? 'left' : 'right',
                  borderRight: '1px solid var(--border)',
                  color: 'var(--accent-chrome)',
                  fontWeight: 600,
                  fontSize: 'clamp(9px, 0.5vw, 12px)',
                  textTransform: 'uppercase',
                  letterSpacing: '0.04em',
                  whiteSpace: 'nowrap',
                }}
              >
                {col}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {stats.map((stat) => (
            <tr
              key={stat.provider}
              style={{ borderBottom: '1px solid var(--border)' }}
            >
              <td
                style={{
                  padding: '5px 6px',
                  textAlign: 'left',
                  fontWeight: 600,
                  borderRight: '1px solid var(--border)',
                  color: 'var(--fg)',
                  whiteSpace: 'nowrap',
                }}
              >
                {stat.provider.toUpperCase()}
              </td>
              <td
                style={{
                  padding: '5px 6px',
                  textAlign: 'right',
                  borderRight: '1px solid var(--border)',
                  color: 'var(--accent-cool)',
                  whiteSpace: 'nowrap',
                }}
              >
                {fmtCompact(stat.tokensIn)}
              </td>
              <td
                style={{
                  padding: '5px 6px',
                  textAlign: 'right',
                  borderRight: '1px solid var(--border)',
                  color: 'var(--accent-cool)',
                  whiteSpace: 'nowrap',
                }}
              >
                {fmtCompact(stat.tokensOut)}
              </td>
              <td
                style={{
                  padding: '5px 6px',
                  textAlign: 'right',
                  borderRight: '1px solid var(--border)',
                  color: 'var(--accent-warm)',
                  whiteSpace: 'nowrap',
                }}
              >
                ${stat.cost.toFixed(2)}
              </td>
              <td
                style={{
                  padding: '5px 6px',
                  textAlign: 'right',
                  borderRight: '1px solid var(--border)',
                  color: 'var(--fg)',
                  whiteSpace: 'nowrap',
                }}
              >
                {stat.requests.toLocaleString()}
              </td>
              <td
                style={{
                  padding: '5px 6px',
                  textAlign: 'right',
                  borderRight: '1px solid var(--border)',
                  color: stat.avgP95 > 5000 ? 'var(--accent-hot)' : 'var(--fg)',
                  whiteSpace: 'nowrap',
                }}
              >
                {stat.avgP95.toFixed(0)}ms
              </td>
              <td
                style={{
                  padding: '5px 6px',
                  textAlign: 'right',
                  borderRight: '1px solid var(--border)',
                  color: stat.errorPct > 1 ? 'var(--accent-hot)' : 'var(--fg)',
                  whiteSpace: 'nowrap',
                }}
              >
                {stat.errorPct.toFixed(1)}%
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div
        className='comparison-footer'
        style={{
          marginTop: '6px',
          paddingTop: '4px',
          borderTop: '1px solid var(--border)',
          fontSize: 'clamp(9px, 0.45vw, 11px)',
          color: 'var(--fg-muted)',
        }}
      >
        Comparison data aggregated from master ledger ·{' '}
        {new Date().toLocaleString()}
      </div>
    </div>
  )
}
