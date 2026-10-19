const RATIONALE_MAX_CHARS = 512
const ANSI_ESCAPE_RE = new RegExp(
  `${String.fromCharCode(0x1b)}(?:[@-Z\\\\-_]|\\[[0-?]*[ -/]*[@-~])`,
  'g'
)
const BEARER_RE = /\bbearer\s+[A-Za-z0-9._~+/=-]{6,}/gi
const TOKEN_PREFIX_RE =
  /\b(?:sk|pk|xai)-[A-Za-z0-9._~+/=-]{6,}|\bya29\.[A-Za-z0-9._~+/=-]{6,}/gi
const NAMED_SECRET_RE =
  /\b(authorization|api[ _-]?key|access[ _-]?token|password|secret|token)\s*[:=]\s*([^\s,;]+)/gi
const POSTGRES_URL_RE = /\bpostgres(?:ql)?:\/\/\S+/gi

function isDisallowedChar(char: string): boolean {
  const code = char.codePointAt(0)
  if (code === undefined || code <= 0x1f || code === 0x7f) return true
  return /\p{C}/u.test(char)
}

export function sanitizeCodexReviewDecisionRationale(value: unknown): {
  text: string | null
  truncated: boolean
} {
  if (typeof value !== 'string') return { text: null, truncated: false }
  const withoutAnsi = value
    .split(String.fromCharCode(0))
    .join('')
    .replace(ANSI_ESCAPE_RE, '')
  let printable = ''
  for (const char of withoutAnsi) {
    printable += isDisallowedChar(char) ? ' ' : char
  }
  const cleaned = printable
    .split(/\s+/)
    .filter(Boolean)
    .join(' ')
    .replace(BEARER_RE, 'Bearer [REDACTED]')
    .replace(TOKEN_PREFIX_RE, '[REDACTED]')
    .replace(NAMED_SECRET_RE, '$1=[REDACTED]')
    .replace(POSTGRES_URL_RE, '[REDACTED]')
    .split(/\s+/)
    .filter(Boolean)
    .join(' ')
  if (!cleaned) return { text: null, truncated: false }
  if (cleaned.length > RATIONALE_MAX_CHARS) {
    return {
      text: cleaned.slice(0, RATIONALE_MAX_CHARS),
      truncated: true,
    }
  }
  return { text: cleaned, truncated: false }
}
