#!/usr/bin/env node
import { execFile } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

const DEFAULT_HEALTH_URL = 'http://127.0.0.1:3006/api/shell/health'
const DEFAULT_CONTAINERS = ['aawm-litellm', 'litellm-dev']
const DEFAULT_SINCE = '15m'
const DEFAULT_TAIL = 1000
const DEFAULT_GAP_WARN_SECONDS = 300
const SUCCESS_STATUS_PATTERN =
  /"(?<method>POST|GET|PUT|PATCH|DELETE) (?<path>[^"]+) HTTP\/[0-9.]+"\s+(?<status>\d{3})\b/
const TIMESTAMP_PREFIX_PATTERN =
  /^(?<timestamp>\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z)\s+(?<message>[\s\S]*)$/

function parseArgs(argv) {
  const options = {
    healthUrl: DEFAULT_HEALTH_URL,
    healthFile: null,
    containers: [...DEFAULT_CONTAINERS],
    since: DEFAULT_SINCE,
    tail: DEFAULT_TAIL,
    gapWarnSeconds: DEFAULT_GAP_WARN_SECONDS,
    json: false,
    includeHealthChecks: false,
  }

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--') continue
    const nextValue = () => {
      index += 1
      if (index >= argv.length) {
        throw new Error(`Missing value for ${arg}`)
      }
      return argv[index]
    }

    if (arg === '--health-url') {
      options.healthUrl = nextValue()
    } else if (arg === '--health-file') {
      options.healthFile = nextValue()
    } else if (arg === '--containers') {
      options.containers = nextValue()
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean)
    } else if (arg === '--since') {
      options.since = nextValue()
    } else if (arg === '--tail') {
      const value = Number(nextValue())
      if (!Number.isFinite(value) || value < 1) {
        throw new Error('--tail must be a positive number')
      }
      options.tail = Math.floor(value)
    } else if (arg === '--gap-warn-seconds') {
      const value = Number(nextValue())
      if (!Number.isFinite(value) || value < 0) {
        throw new Error('--gap-warn-seconds must be a non-negative number')
      }
      options.gapWarnSeconds = value
    } else if (arg === '--json') {
      options.json = true
    } else if (arg === '--include-health-checks') {
      options.includeHealthChecks = true
    } else if (arg === '--help' || arg === '-h') {
      options.help = true
    } else {
      throw new Error(`Unsupported argument: ${arg}`)
    }
  }

  return options
}

function usage() {
  return `Usage: node scripts/probe-ingestion-durability.mjs [options]

Read-only D1-175 probe. Compares bounded LiteLLM success-log evidence with
/api/shell/health source-table freshness for public.session_history and
public.rate_limit_observations. It does not query source tables directly.

Options:
  --health-url URL            Shell health endpoint. Default: ${DEFAULT_HEALTH_URL}
  --health-file PATH          Read health JSON from a file instead of fetching.
  --containers LIST           Comma-separated Docker containers. Default: ${DEFAULT_CONTAINERS.join(',')}
  --since DURATION            Docker log window passed to docker logs. Default: ${DEFAULT_SINCE}
  --tail N                    Docker log tail per container. Default: ${DEFAULT_TAIL}
  --gap-warn-seconds N        Warn when success traffic is newer than source by N seconds. Default: ${DEFAULT_GAP_WARN_SECONDS}
  --include-health-checks     Include health-check requests in success counts.
  --json                      Emit JSON only.
`
}

async function loadHealth(options, fetchImpl = globalThis.fetch) {
  if (options.healthFile) {
    return JSON.parse(await readFile(options.healthFile, 'utf8'))
  }

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 10_000)
  try {
    const response = await fetchImpl(options.healthUrl, {
      signal: controller.signal,
      cache: 'no-store',
    })
    if (!response.ok) {
      throw new Error(`Health request failed with HTTP ${response.status}`)
    }
    return await response.json()
  } finally {
    clearTimeout(timeout)
  }
}

async function loadDockerLogs(options) {
  const logs = []
  for (const container of options.containers) {
    try {
      const { stdout, stderr } = await execFileAsync(
        'docker',
        [
          'logs',
          '--since',
          options.since,
          '--tail',
          String(options.tail),
          '--timestamps',
          container,
        ],
        {
          maxBuffer: 16 * 1024 * 1024,
        }
      )
      logs.push({
        container,
        ok: true,
        text: [stdout, stderr].filter(Boolean).join('\n'),
        error: null,
      })
    } catch (error) {
      logs.push({
        container,
        ok: false,
        text: error.stdout ?? '',
        error: error.message,
      })
    }
  }
  return logs
}

function parseLogTimestampedLine(rawLine) {
  const match = rawLine.match(TIMESTAMP_PREFIX_PATTERN)
  if (!match?.groups) {
    return { observedAt: null, message: rawLine }
  }
  return {
    observedAt: match.groups.timestamp,
    message: match.groups.message,
  }
}

function isHealthCheckPath(path) {
  return /\/health\/(?:liveliness|readiness)|\/health\b/i.test(path)
}

function parseLiteLlmLogText(text, container, options = {}) {
  const rows = []
  const lines = text.split('\n')
  for (const rawLine of lines) {
    if (!rawLine.trim()) continue
    const { observedAt, message } = parseLogTimestampedLine(rawLine)
    const statusMatch = message.match(SUCCESS_STATUS_PATTERN)
    if (statusMatch?.groups) {
      const status = Number(statusMatch.groups.status)
      const path = statusMatch.groups.path
      let type = 'http_error'
      if (status >= 200 && status < 300) {
        type = 'success'
      } else if (status >= 300 && status < 400) {
        type = 'http_redirect'
      }
      if (options.includeHealthChecks || !isHealthCheckPath(path)) {
        rows.push({
          type,
          container,
          observedAt,
          method: statusMatch.groups.method,
          path,
          status,
          message: compactMessage(message),
        })
      }
      continue
    }

    const lower = message.toLowerCase()
    if (
      lower.includes('session_history queue full') &&
      lower.includes('dropping overflow record')
    ) {
      rows.push({
        type: 'session_history_drop',
        container,
        observedAt,
        message: compactMessage(message),
      })
      continue
    }
    if (lower.includes('session_history queue full')) {
      rows.push({
        type: 'session_history_queue_full',
        container,
        observedAt,
        message: compactMessage(message),
      })
      continue
    }
    if (
      lower.includes('langfuse event near/exceeds size limit') ||
      lower.includes('item exceeds size limit')
    ) {
      rows.push({
        type: 'large_observability_payload',
        container,
        observedAt,
        message: compactMessage(message),
      })
      continue
    }
  }
  return rows
}

function compactMessage(value) {
  return String(value)
    .replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 320)
}

function latestTimestamp(rows, predicate) {
  let latest = null
  for (const row of rows) {
    if (!predicate(row) || !row.observedAt) continue
    const time = Date.parse(row.observedAt)
    if (!Number.isFinite(time)) continue
    if (latest === null || time > latest.time) {
      latest = { time, iso: new Date(time).toISOString(), row }
    }
  }
  return latest
}

function findSourceTable(health, tableName) {
  const sourceTables = health?.sourceTables
  if (!sourceTables) return null

  const candidates = []
  if (Array.isArray(sourceTables.tables)) {
    candidates.push(...sourceTables.tables)
  }
  if (Array.isArray(sourceTables)) {
    candidates.push(...sourceTables)
  }
  if (sourceTables.byName?.[tableName]) {
    candidates.push(sourceTables.byName[tableName])
  }
  if (sourceTables[tableName]) {
    candidates.push(sourceTables[tableName])
  }

  const expected = normalizeTableName(tableName)
  return (
    candidates.find((table) => {
      const candidateName =
        table?.tableName ?? table?.table_name ?? table?.name ?? null
      return normalizeTableName(candidateName) === expected
    }) ?? null
  )
}

function normalizeTableName(value) {
  return String(value ?? '')
    .trim()
    .replace(/^public\./, '')
}

function compareLatestSuccessToSource(latestSuccess, sourceTable) {
  const sourceAt =
    sourceTable?.latestEventAt ??
    sourceTable?.latestPersistedAt ??
    sourceTable?.latestDataAt ??
    null

  if (!latestSuccess || !sourceAt) {
    return {
      status: 'unknown',
      lagSeconds: null,
      sourceAt,
      successAt: latestSuccess?.iso ?? null,
    }
  }

  const sourceTime = Date.parse(sourceAt)
  if (!Number.isFinite(sourceTime)) {
    return {
      status: 'unknown',
      lagSeconds: null,
      sourceAt,
      successAt: latestSuccess.iso,
    }
  }

  const lagSeconds = Math.round((latestSuccess.time - sourceTime) / 1000)
  return {
    status: lagSeconds > 0 ? 'behind_success_traffic' : 'caught_up',
    lagSeconds,
    sourceAt: new Date(sourceTime).toISOString(),
    successAt: latestSuccess.iso,
  }
}

function countByType(rows, type) {
  return rows.filter((row) => row.type === type).length
}

function summarizeIngestionDurability(health, parsedLogRows, options = {}) {
  const gapWarnSeconds =
    options.gapWarnSeconds ?? DEFAULT_GAP_WARN_SECONDS
  const sessionHistory = findSourceTable(health, 'session_history')
  const rateLimitObservations = findSourceTable(
    health,
    'rate_limit_observations'
  )
  const latestSuccess = latestTimestamp(
    parsedLogRows,
    (row) => row.type === 'success'
  )
  const latestSessionDrop = latestTimestamp(
    parsedLogRows,
    (row) => row.type === 'session_history_drop'
  )
  const latestLargePayload = latestTimestamp(
    parsedLogRows,
    (row) => row.type === 'large_observability_payload'
  )
  const sessionComparison = compareLatestSuccessToSource(
    latestSuccess,
    sessionHistory
  )
  const quotaComparison = compareLatestSuccessToSource(
    latestSuccess,
    rateLimitObservations
  )
  const successCount = countByType(parsedLogRows, 'success')
  const httpErrorCount = countByType(parsedLogRows, 'http_error')
  const sessionDropCount = countByType(parsedLogRows, 'session_history_drop')
  const queueFullCount =
    sessionDropCount + countByType(parsedLogRows, 'session_history_queue_full')
  const largePayloadCount = countByType(
    parsedLogRows,
    'large_observability_payload'
  )

  const findings = []
  if (!sessionHistory) {
    findings.push({
      severity: 'red',
      code: 'session_history_source_freshness_missing',
      message:
        'Shell health did not expose public.session_history source-table freshness for comparison.',
    })
  }
  if (!rateLimitObservations) {
    findings.push({
      severity: 'red',
      code: 'rate_limit_observations_source_freshness_missing',
      message:
        'Shell health did not expose public.rate_limit_observations source-table freshness for comparison.',
    })
  }
  if (sessionDropCount > 0) {
    findings.push({
      severity: 'red',
      code: 'session_history_drops_observed',
      message:
        'LiteLLM logged dropped session_history overflow records in the sampled window.',
    })
  }
  if (
    sessionComparison.lagSeconds !== null &&
    sessionComparison.lagSeconds > gapWarnSeconds
  ) {
    findings.push({
      severity: 'red',
      code: 'session_history_behind_success_traffic',
      message:
        'Latest LiteLLM success traffic is newer than public.session_history by more than the configured threshold.',
    })
  }
  if (
    quotaComparison.lagSeconds !== null &&
    quotaComparison.lagSeconds > gapWarnSeconds
  ) {
    findings.push({
      severity: 'yellow',
      code: 'rate_limit_observations_behind_success_traffic',
      message:
        'Latest LiteLLM success traffic is newer than public.rate_limit_observations by more than the configured threshold.',
    })
  }
  if (largePayloadCount > 0) {
    findings.push({
      severity: 'yellow',
      code: 'large_observability_payloads_observed',
      message:
        'LiteLLM logged near/exceeds-size-limit observability payloads in the sampled window.',
    })
  }
  if (successCount === 0) {
    findings.push({
      severity: 'unknown',
      code: 'no_success_traffic_observed',
      message:
        'No successful LiteLLM request logs were found in the sampled window.',
    })
  }

  const status = findings.some((finding) => finding.severity === 'red')
    ? 'red'
    : findings.some((finding) => finding.severity === 'yellow')
      ? 'yellow'
      : findings.some((finding) => finding.severity === 'unknown')
        ? 'unknown'
        : 'green'

  return {
    status,
    checkedAt: new Date().toISOString(),
    gapWarnSeconds,
    databaseEndpoint: health?.databaseEndpoint ?? null,
    sourceTables: {
      sessionHistory,
      rateLimitObservations,
    },
    traffic: {
      successCount,
      httpErrorCount,
      latestSuccessAt: latestSuccess?.iso ?? null,
      latestSuccess: latestSuccess?.row ?? null,
    },
    persistenceComparison: {
      sessionHistory: sessionComparison,
      rateLimitObservations: quotaComparison,
    },
    durabilitySignals: {
      sessionDropCount,
      queueFullCount,
      latestSessionDropAt: latestSessionDrop?.iso ?? null,
      largePayloadCount,
      latestLargePayloadAt: latestLargePayload?.iso ?? null,
    },
    findings,
  }
}

function renderTextSummary(summary, dockerLogs) {
  const lines = []
  lines.push(`D1-175 ingestion durability probe: ${summary.status}`)
  lines.push(`Checked at: ${summary.checkedAt}`)
  if (summary.databaseEndpoint) {
    lines.push(
      `Database endpoint: ${summary.databaseEndpoint.host}:${summary.databaseEndpoint.port} / ${summary.databaseEndpoint.database}`
    )
  }
  lines.push(
    `LiteLLM successes: ${summary.traffic.successCount}, latest: ${summary.traffic.latestSuccessAt ?? 'none'}`
  )
  lines.push(
    `session_history latest: ${summary.persistenceComparison.sessionHistory.sourceAt ?? 'unknown'} (${summary.persistenceComparison.sessionHistory.lagSeconds ?? 'unknown'}s behind latest success)`
  )
  lines.push(
    `rate_limit_observations latest: ${summary.persistenceComparison.rateLimitObservations.sourceAt ?? 'unknown'} (${summary.persistenceComparison.rateLimitObservations.lagSeconds ?? 'unknown'}s behind latest success)`
  )
  lines.push(
    `Queue drops: ${summary.durabilitySignals.sessionDropCount}; queue-full signals: ${summary.durabilitySignals.queueFullCount}; large payload warnings: ${summary.durabilitySignals.largePayloadCount}`
  )
  for (const log of dockerLogs) {
    if (!log.ok) {
      lines.push(`Docker log read failed for ${log.container}: ${log.error}`)
    }
  }
  if (summary.findings.length) {
    lines.push('Findings:')
    for (const finding of summary.findings) {
      lines.push(`- [${finding.severity}] ${finding.code}: ${finding.message}`)
    }
  } else {
    lines.push('Findings: none')
  }
  return lines.join('\n')
}

async function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv)
  if (options.help) {
    console.log(usage())
    return 0
  }

  const health = await loadHealth(options)
  const dockerLogs = await loadDockerLogs(options)
  const parsedRows = dockerLogs.flatMap((log) =>
    parseLiteLlmLogText(log.text, log.container, options)
  )
  const summary = summarizeIngestionDurability(health, parsedRows, options)
  const payload = {
    probe: 'd1-175-ingestion-durability',
    options: {
      healthUrl: options.healthFile ? null : options.healthUrl,
      healthFile: options.healthFile,
      containers: options.containers,
      since: options.since,
      tail: options.tail,
      gapWarnSeconds: options.gapWarnSeconds,
    },
    dockerLogs: dockerLogs.map(({ container, ok, error }) => ({
      container,
      ok,
      error,
    })),
    summary,
  }

  if (options.json) {
    console.log(JSON.stringify(payload, null, 2))
  } else {
    console.log(renderTextSummary(summary, dockerLogs))
  }
  return summary.status === 'red' ? 2 : 0
}

const isDirectRun =
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href

if (isDirectRun) {
  main().then(
    (code) => {
      process.exitCode = code
    },
    (error) => {
      console.error(error instanceof Error ? error.message : String(error))
      process.exitCode = 1
    }
  )
}

export {
  compareLatestSuccessToSource,
  parseArgs,
  parseLiteLlmLogText,
  summarizeIngestionDurability,
}
