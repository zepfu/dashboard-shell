import crypto from 'node:crypto'
import { appendFile, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'

export const DEFAULT_INTAKE_LOCK_MAX_WAIT_MS = 5_000
const DEFAULT_INTAKE_LOCK_STALE_MS = 120_000
const DEFAULT_INTAKE_LOCK_POLL_MS = 25

/** Per intake file: serialize lock acquisition within one process. */
const intakeFileLockChains = new Map()

export function dockerLogErrorIntakeLockDir(filePath) {
  return `${filePath}.intake.lock`
}

/**
 * Read fingerprints already stored in an intake JSONL file (cross-process / post-restart dedupe).
 */
export async function loadPersistedDockerLogErrorFingerprintsFromJsonl(
  filePath,
  readFileFn = readFile
) {
  const persisted = new Set()
  let text
  try {
    text = await readFileFn(filePath, 'utf8')
  } catch (error) {
    if (error?.code === 'ENOENT') return persisted
    throw error
  }
  for (const line of text.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed) continue
    let parsed
    try {
      parsed = JSON.parse(trimmed)
    } catch {
      continue
    }
    const fp =
      parsed?.fingerprint ??
      (parsed?.message != null
        ? buildDockerLogErrorFingerprint({
            container: parsed.container,
            stream: parsed.stream,
            observed_at: parsed.observed_at,
            level: parsed.level,
            status_code: parsed.status_code,
            message: parsed.message,
          })
        : null)
    if (fp) persisted.add(fp)
  }
  return persisted
}

/**
 * Acquire a simple directory lock beside the intake file (bounded wait, stale lock cleanup).
 */
export async function acquireIntakeFileLock(filePath, options = {}) {
  const lockDir = dockerLogErrorIntakeLockDir(filePath)
  const maxWaitMs = options.maxWaitMs ?? DEFAULT_INTAKE_LOCK_MAX_WAIT_MS
  const pollMs = options.pollMs ?? DEFAULT_INTAKE_LOCK_POLL_MS
  const staleMs = options.staleLockMs ?? DEFAULT_INTAKE_LOCK_STALE_MS
  const mkdirFn = options.mkdirFn ?? mkdir
  const statFn = options.statFn ?? stat
  const rmFn = options.rmFn ?? rm
  const deadline = Date.now() + maxWaitMs

  while (true) {
    try {
      await mkdirFn(lockDir)
      return {
        lockDir,
        release: async () => {
          try {
            await rmFn(lockDir, { recursive: true, force: true })
          } catch {
            /* ignore */
          }
        },
      }
    } catch (error) {
      if (error?.code !== 'EEXIST') throw error
      try {
        const st = await statFn(lockDir)
        if (Date.now() - st.mtimeMs > staleMs) {
          await rmFn(lockDir, { recursive: true, force: true })
        }
      } catch (statErr) {
        if (statErr?.code === 'ENOENT') continue
        throw statErr
      }
      if (Date.now() >= deadline) {
        throw new Error(`Timed out waiting for intake lock: ${lockDir}`)
      }
      await new Promise((resolve) => setTimeout(resolve, pollMs))
    }
  }
}

export async function withIntakeFileLock(filePath, fn, options = {}) {
  const prev = intakeFileLockChains.get(filePath) ?? Promise.resolve()
  const run = prev.then(async () => {
    const { release } = await acquireIntakeFileLock(filePath, options)
    try {
      return await fn()
    } finally {
      await release()
    }
  })
  intakeFileLockChains.set(
    filePath,
    run.catch(() => {
      /* keep chain alive after failures */
    })
  )
  return run
}


/** Containers defined by dashboard-shell compose (prod + dev explicit names). */
export const DEFAULT_REPO_OWNED_DOCKER_LOG_CONTAINERS = [
  'dashboard-shell',
  'dashboard-shell-reports',
  'dashboard-shell-redis',
  'aawm-dashboard',
  'aawm-observe-dashboard',
  'aawm-tap-dashboard',
  'aegis-dashboard',
  'sluice-dashboard',
  'dashboard-shell-dev',
  'dashboard-shell-reports-dev',
  'dashboard-shell-aawm-dashboard-dev',
  'dashboard-shell-aawm-observe-dashboard-dev',
  'dashboard-shell-aawm-tap-dashboard-dev',
  'dashboard-shell-aegis-dashboard-dev',
  'dashboard-shell-sluice-dashboard-dev',
]

export const REPO_OWNED_COMPOSE_SERVICE_NAMES = [
  'dashboard-shell',
  'dashboard-shell-reports',
  'dashboard-shell-redis',
  'aawm-dashboard',
  'aawm-observe-dashboard',
  'aawm-tap-dashboard',
  'aegis-dashboard',
  'sluice-dashboard',
]

/** Default path markers that tie a compose project to this repo (case-insensitive substring match). */
export const DEFAULT_REPO_COMPOSE_PROJECT_MARKERS = [
  'dashboard-shell/docker-compose',
  '/projects/dashboard-shell',
]

export function normalizeDockerContainerName(name) {
  return String(name ?? '').replace(/^\//, '').trim()
}

export function readDockerComposeLabels(config) {
  return config?.Config?.Labels ?? config?.Labels ?? {}
}

export function isDashboardShellComposeProject(labels, markers = DEFAULT_REPO_COMPOSE_PROJECT_MARKERS) {
  const project = String(labels['com.docker.compose.project'] ?? '')
  const workingDir = String(labels['com.docker.compose.project.working_dir'] ?? '')
  const configFiles = String(labels['com.docker.compose.project.config_files'] ?? '')
  const haystack = `${project}\n${workingDir}\n${configFiles}`.toLowerCase()
  return markers.some((marker) => haystack.includes(String(marker).toLowerCase()))
}

/**
 * Match a Docker config.v2.json container against configured log tail names.
 * Dev containers use explicit container_name (exact Name match). Prod compose services
 * without container_name match via compose service + dashboard-shell project markers.
 */
export function matchDockerJsonLogContainer(config, wantedContainerNames, options = {}) {
  const wanted = new Set(
    (wantedContainerNames ?? []).map((item) => String(item).trim()).filter(Boolean)
  )
  if (!wanted.size) {
    return { matched: false, container: null, matchKind: null }
  }

  const containerName = normalizeDockerContainerName(config?.Name)
  if (containerName && wanted.has(containerName)) {
    return { matched: true, container: containerName, matchKind: 'exact' }
  }

  const labels = readDockerComposeLabels(config)
  const service = String(labels['com.docker.compose.service'] ?? '').trim()
  if (!service || !wanted.has(service)) {
    return { matched: false, container: null, matchKind: null }
  }

  if (!REPO_OWNED_COMPOSE_SERVICE_NAMES.includes(service)) {
    return { matched: false, container: null, matchKind: null }
  }

  const markers = options.repoComposeProjectMarkers ?? DEFAULT_REPO_COMPOSE_PROJECT_MARKERS
  if (!isDashboardShellComposeProject(labels, markers)) {
    return { matched: false, container: null, matchKind: null }
  }

  const resolvedContainer = containerName || service
  return { matched: true, container: resolvedContainer, matchKind: 'compose' }
}

/** Discovery/tailing is enabled when at least one container name is configured (not by dashboard row cap). */
export function shouldDiscoverDockerJsonLogSources(resolvedContainerNames) {
  return Array.isArray(resolvedContainerNames) && resolvedContainerNames.length > 0
}

export function discoverDockerJsonLogSourcesFromConfigs(entries, wantedContainerNames, options = {}) {
  const sources = []
  for (const { containerDir, entryId, config } of entries) {
    if (!containerDir || !entryId || !config) continue
    const match = matchDockerJsonLogContainer(config, wantedContainerNames, options)
    if (!match.matched) continue
    sources.push({
      container: match.container,
      logPath: path.join(containerDir, `${entryId}-json.log`),
      matchKind: match.matchKind,
    })
  }
  return sources
}


export function parseDockerLogContainerNames(value, fallback = DEFAULT_REPO_OWNED_DOCKER_LOG_CONTAINERS) {
  if (!value || !String(value).trim()) {
    return [...fallback]
  }
  return String(value)
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
}




export function parseDockerLogExternalContainerNames(
  value,
  fallback = ['aawm-litellm', 'litellm-dev']
) {
  if (!value || !String(value).trim()) {
    return [...fallback]
  }
  return String(value)
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
}

export function resolveDockerLogExternalContainerNames(env = process.env) {
  return [
    ...new Set(
      parseDockerLogExternalContainerNames(
        env.SHELL_REPORT_DOCKER_LOG_EXTERNAL_CONTAINERS ?? 'aawm-litellm,litellm-dev',
        []
      )
    ),
  ]
}

export function isRepoOwnedDockerLogContainerName(
  containerName,
  repoOwned = DEFAULT_REPO_OWNED_DOCKER_LOG_CONTAINERS
) {
  const normalized = normalizeDockerContainerName(containerName)
  if (!normalized) return false
  const owned = new Set((repoOwned ?? []).map((item) => String(item).trim()).filter(Boolean))
  if (owned.has(normalized)) return true

  const composeGenerated = /^dashboard-shell-(.+)-(\d+)$/.exec(normalized)
  if (!composeGenerated) return false
  const serviceName = composeGenerated[1]
  if (!REPO_OWNED_COMPOSE_SERVICE_NAMES.includes(serviceName)) return false
  return owned.has(serviceName)
}

export function filterDockerLogErrorsForCentralizedIntake(
  rows,
  options = {}
) {
  const repoOwned =
    options.repoOwnedContainerNames ?? DEFAULT_REPO_OWNED_DOCKER_LOG_CONTAINERS
  const external =
    options.externalContainerNames ??
    resolveDockerLogExternalContainerNames(options.env ?? process.env)
  const externalSet = new Set(external.map((item) => String(item).trim()).filter(Boolean))
  const list = Array.isArray(rows) ? rows : []
  return list.filter((row) => {
    const container = normalizeDockerContainerName(row?.container)
    if (!container) return false
    // External containers stay in dockerLogErrors for dashboard alerts only.
    if (externalSet.has(container)) return false
    return !isRepoOwnedDockerLogContainerName(container, repoOwned)
  })
}


export function resolveDockerLogContainerNames(env = process.env) {
  const explicit = String(env.SHELL_REPORT_DOCKER_LOG_CONTAINERS ?? '').trim()
  if (explicit) {
    return [...new Set(parseDockerLogContainerNames(explicit, []))]
  }
  const owned = parseDockerLogContainerNames('', DEFAULT_REPO_OWNED_DOCKER_LOG_CONTAINERS)
  const external = parseDockerLogContainerNames(
    env.SHELL_REPORT_DOCKER_LOG_EXTERNAL_CONTAINERS ?? 'aawm-litellm,litellm-dev',
    []
  )
  return [...new Set([...owned, ...external])]
}

export function stripAnsi(value) {
  return String(value ?? '').replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, '')
}

export function compactLogMessage(value) {
  return stripAnsi(value).replace(/\s+/g, ' ').trim().slice(0, 280)
}

export function inferLogProvider(message) {
  const lower = message.toLowerCase()
  if (lower.includes('anthropic') || lower.includes('claude')) return 'anthropic'
  if (lower.includes('openrouter')) return 'openrouter'
  if (lower.includes('openai') || lower.includes('gpt-')) return 'openai'
  if (lower.includes('google') || lower.includes('gemini')) return 'google'
  if (lower.includes('xai') || lower.includes('grok')) return 'xai'
  if (lower.includes('nvidia') || lower.includes('nim')) return 'nvidia_nim'
  if (lower.includes('local')) return 'local'
  return 'unknown'
}

export function extractHttpStatusCodes(message) {
  const text = String(message ?? '')
  const lowerText = text.toLowerCase()
  const codes = []
  const seen = new Set()

  const add = (code) => {
    const normalized = String(code ?? '')
    if (!/^(?:4\d{2}|5\d{2})$/.test(normalized)) return
    const numeric = Number(normalized)
    if (numeric < 400 || numeric > 599) return
    if (seen.has(normalized)) return
    seen.add(normalized)
    codes.push(normalized)
  }

  const hasStatusContext = (codeIndex) => {
    const before = lowerText.slice(Math.max(0, codeIndex - 56), codeIndex)
    const after = lowerText.slice(codeIndex + 3, codeIndex + 56)
    if (
      /\b(?:status|statuscode|status_code|http|https|response|returned|code|upstream|gateway|error|failed|failure|fatal|critical)\b[\s:="'()[\]{},./\\-]{0,48}$/.test(
        before
      )
    ) {
      return true
    }
    return /^\s*(?:bad gateway|gateway timeout|service unavailable|internal server error|not found|too many requests)\b/.test(
      after
    )
  }

  for (const match of text.matchAll(/4\d{2}|5\d{2}/g)) {
    const code = match[0]
    const codeIndex = match.index
    const before = codeIndex > 0 ? text[codeIndex - 1] : ''
    const afterChar = text[codeIndex + code.length] ?? ''
    if (/[0-9.]/.test(before) || /[0-9.]/.test(afterChar)) continue
    if (before === '-') continue

    const after = text.slice(codeIndex + code.length, codeIndex + code.length + 24).toLowerCase()
    const beforeWindow = text.slice(Math.max(0, codeIndex - 16), codeIndex).toLowerCase()
    if (/^\s*packages\b/.test(after)) continue
    if (/\baudited\s*$/.test(beforeWindow)) continue
    if (/\badded\s*$/.test(beforeWindow)) continue
    if (/:\d{2}:\d{2}\.$/.test(text.slice(Math.max(0, codeIndex - 12), codeIndex + 1))) continue
    if (!hasStatusContext(codeIndex)) continue

    add(code)
  }

  for (const match of lowerText.matchAll(/"[a-z]+ [^"]+ http\/[0-9.]+"\s+(4\d{2}|5\d{2})\s+/g)) {
    add(match[1])
  }

  return codes
}

export function hasHttpStatusSignal(message) {
  return extractHttpStatusCodes(message).length > 0
}

export function inferLogLevel(message) {
  const lower = message.toLowerCase()
  if (/\bcritical\b|\bfatal\b/.test(lower)) return 'critical'
  if (
    /\berror\b|\bexception\b|\btraceback\b|\bfailed\b|\bconnection refused\b|\betimed out\b|\btimeout\b/.test(
      lower
    )
  ) {
    return 'error'
  }
  if (hasHttpStatusSignal(message)) return 'error'
  if (/\bwarn(?:ing)?\b/.test(lower)) return 'warning'
  return 'error'
}

export function inferLogStatusCode(message) {
  const codes = extractHttpStatusCodes(message)
  if (!codes.length) return null
  const serverError = codes.find((code) => code.startsWith('5'))
  return Number(serverError ?? codes[0])
}

export function isIgnoredContainerLogNoise(message) {
  const lower = String(message ?? '').toLowerCase()
  if (!lower) return false
  if (/\buser requested shutdown\b|\bready to exit, bye bye\b/.test(lower)) return true
  if (/\b(?:added|audited)\s+\d+\s+packages\b/.test(lower)) return true
  return /^\s*\d+\s+vulnerabilities\b/.test(lower)
}

export function isInformationalErrorMention(message) {
  const lower = String(message ?? '').toLowerCase()
  if (!lower) return false

  if (
    /appended\s+\d+\s+docker\s+log\s+error\s+row(?:\(s\))?\b/.test(lower) ||
    /\bdocker\s+log\s+error\s+row(?:\(s\))?\b/.test(lower)
  ) {
    return true
  }

  const hasInfoOrDebugLevel =
    /\b(?:info|debug)\s*:/.test(lower) || /\]\s*(?:info|debug)\s*:/.test(lower)
  if (!hasInfoOrDebugLevel) return false

  if (
    /\b(?:exception|traceback|connection refused|timed out|timeout|critical|fatal)\b/.test(
      lower
    )
  ) {
    return false
  }
  if (hasHttpStatusSignal(message)) return false

  return /\berror\b/.test(lower)
}

export function isSuccessfulHttpAccessLog(message) {
  const lower = String(message ?? '').toLowerCase()
  return /^[^\s]+\s+[^\s]+\s+[^\s]+\s+\[[^\]]+\]\s+"[a-z]+ [^"]+ http\/[0-9.]+"\s+[23][0-9]{2}\s+[0-9-]+/.test(
    lower
  )
}

function isSuccessfulCacheWaitFallbackWarning(message) {
  const lower = String(message ?? '').toLowerCase()
  return (
    lower.includes('warn: timed out waiting for redis cache refresh') &&
    lower.includes('falling back to sql')
  )
}

export function isActionableErrorLog(message) {
  const lower = message.toLowerCase()
  if (/health\/(?:liveliness|readiness)|"get \/health\b/.test(lower)) {
    return false
  }
  if (isIgnoredContainerLogNoise(lower)) return false
  if (isSuccessfulCacheWaitFallbackWarning(lower)) return false
  if (hasHttpStatusSignal(message)) return true
  if (/\bconnection refused\b|\betimed out\b|\btimeout\b/.test(lower)) return true
  if (/\b(?:critical|fatal|exception|traceback)\b/.test(lower)) return true
  if (isInformationalErrorMention(lower)) return false
  if (isSuccessfulHttpAccessLog(message)) return false
  return /\b(?:critical|fatal|error|exception|traceback|failed|rate limit|overloaded)\b/.test(
    lower
  )
}

export function safeContainerErrorIntakeBasename(containerName) {
  const normalized = String(containerName ?? 'unknown')
    .trim()
    .replace(/^\//, '')
    .replace(/[^a-zA-Z0-9._-]+/g, '_')
    .replace(/^_+|_+$/g, '')
  return normalized || 'unknown'
}

export function dockerLogErrorIntakePath(intakeDir, containerName) {
  const base = safeContainerErrorIntakeBasename(containerName)
  return path.join(intakeDir, `${base}-error.jsonl`)
}

export function buildDockerLogErrorFingerprint(row) {
  const payload = [
    row.container ?? '',
    row.stream ?? '',
    row.observed_at ?? '',
    row.level ?? '',
    String(row.status_code ?? ''),
    row.message ?? '',
  ].join('|')
  return crypto.createHash('sha256').update(payload).digest('hex').slice(0, 24)
}

export function buildDockerLogErrorRow(parsed, container, source = {}) {
  const observedAtRaw = Date.parse(parsed?.time ?? '')
  if (!Number.isFinite(observedAtRaw)) return null

  const message = compactLogMessage(String(parsed?.log ?? ''))
  if (!message || !isActionableErrorLog(message)) return null

  const level = inferLogLevel(message)
  const row = {
    observed_at: new Date(observedAtRaw).toISOString(),
    container,
    stream: String(parsed?.stream ?? 'unknown'),
    provider: inferLogProvider(message),
    status_code: inferLogStatusCode(message),
    level: level === 'warning' && isActionableErrorLog(message) ? 'error' : level,
    message,
    source_identity: source.sourceIdentity ?? null,
    source_path: source.sourcePath ?? null,
  }
  row.fingerprint = buildDockerLogErrorFingerprint(row)
  return row
}

export function extractDockerLogErrorsFromTail({
  tailText,
  truncated = false,
  container,
  cutoffMs = 0,
  source = {},
}) {
  const lines = String(tailText ?? '').split('\n')
  if (truncated && lines.length) lines.shift()

  const rows = []
  for (const line of lines) {
    if (!line.trim()) continue
    let parsed
    try {
      parsed = JSON.parse(line)
    } catch {
      continue
    }

    const observedAt = Date.parse(parsed?.time ?? '')
    if (!Number.isFinite(observedAt) || observedAt < cutoffMs) continue

    const row = buildDockerLogErrorRow(parsed, container, source)
    if (row) rows.push(row)
  }
  return rows
}

export function selectNewDockerLogErrors(rows, seenFingerprints) {
  const fresh = []
  for (const row of rows) {
    const key = row.fingerprint ?? buildDockerLogErrorFingerprint(row)
    if (seenFingerprints.has(key)) continue
    fresh.push(row)
  }
  return fresh
}

/** @deprecated Use selectNewDockerLogErrors; this no longer mutates seenFingerprints. */
export function filterNewDockerLogErrors(rows, seenFingerprints) {
  return selectNewDockerLogErrors(rows, seenFingerprints)
}

export function commitDockerLogErrorFingerprints(rows, seenFingerprints) {
  for (const row of rows) {
    const key = row.fingerprint ?? buildDockerLogErrorFingerprint(row)
    seenFingerprints.add(key)
  }
}

export function splitDockerLogErrorsForDashboardAndIntake(sortedRows, maxDashboardRows) {
  const sorted = Array.isArray(sortedRows) ? sortedRows : []
  return {
    forIntake: sorted,
    forDashboard: capDockerLogErrorsForDashboard(sorted, maxDashboardRows),
  }
}

export function capDockerLogErrorsForDashboard(rows, maxRows) {
  const limit = Number(maxRows)
  if (!Number.isFinite(limit) || limit <= 0) return []
  return rows.slice(0, limit)
}

export function normalizeDockerLogErrorIntakeRecord(row) {
  return {
    observed_at: row.observed_at ?? null,
    container: row.container ?? 'unknown',
    stream: row.stream ?? 'unknown',
    level: row.level ?? 'error',
    status_code: row.status_code ?? null,
    provider: row.provider ?? 'unknown',
    message: row.message ?? '',
    source_identity: row.source_identity ?? null,
    source_path: row.source_path ?? null,
    fingerprint: row.fingerprint ?? buildDockerLogErrorFingerprint(row),
    ingested_at: new Date().toISOString(),
  }
}

export async function appendDockerLogErrorsToIntake({
  intakeDir,
  rows,
  seenFingerprints,
  appendFileFn = appendFile,
  readFileFn = readFile,
  writeFileFn = writeFile,
  mkdirFn = mkdir,
  lockOptions = {},
}) {
  if (!rows?.length) return { appended: 0, files: [], skipped: 0 }

  await mkdirFn(intakeDir, { recursive: true })
  const byFile = new Map()
  for (const row of rows) {
    const filePath = dockerLogErrorIntakePath(intakeDir, row.container)
    if (!byFile.has(filePath)) byFile.set(filePath, [])
    byFile.get(filePath).push(row)
  }

  let appended = 0
  let skipped = 0
  const files = []
  for (const [filePath, records] of byFile.entries()) {
    const batch = await withIntakeFileLock(
      filePath,
      async () => {
        const persisted = await loadPersistedDockerLogErrorFingerprintsFromJsonl(
          filePath,
          readFileFn
        )
        if (seenFingerprints) {
          for (const fp of persisted) seenFingerprints.add(fp)
        }

        const toWrite = []
        let skippedLocal = 0
        for (const row of records) {
          const record = normalizeDockerLogErrorIntakeRecord(row)
          const key = record.fingerprint
          if (persisted.has(key)) {
            skippedLocal += 1
            if (seenFingerprints) seenFingerprints.add(key)
            continue
          }
          persisted.add(key)
          toWrite.push(record)
        }

        if (!toWrite.length) {
          return { appendedLocal: 0, skippedLocal, wrote: false }
        }

        const payload = toWrite.map((record) => `${JSON.stringify(record)}\n`).join('')
        try {
          await appendFileFn(filePath, payload, 'utf8')
        } catch (error) {
          if (error?.code === 'ENOENT') {
            await writeFileFn(filePath, payload, 'utf8')
          } else {
            throw error
          }
        }

        if (seenFingerprints) {
          commitDockerLogErrorFingerprints(toWrite, seenFingerprints)
        }

        return { appendedLocal: toWrite.length, skippedLocal, wrote: true }
      },
      lockOptions
    )
    skipped += batch.skippedLocal
    appended += batch.appendedLocal
    if (batch.wrote) files.push(filePath)
  }

  return { appended, files, skipped }
}
