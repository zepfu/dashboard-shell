export {}

type RecordRow = Record<string, unknown>

export type DockerLogErrorRow = RecordRow & {
  observed_at?: string | null
  container?: string
  stream?: string
  level?: string
  status_code?: number | null
  provider?: string
  message?: string
  source_identity?: string | null
  source_path?: string | null
  fingerprint?: string
}

type IntakeLockFns = {
  mkdirFn?: (path: string) => Promise<void>
  statFn?: (path: string) => Promise<{
    mtimeMs: number
    ctimeMs?: number
    dev?: number
    ino?: number
  }>
  renameFn?: (source: string, target: string) => Promise<void>
  rmFn?: (path: string) => Promise<void>
}

export const DEFAULT_INTAKE_LOCK_MAX_WAIT_MS: number

export function dockerLogErrorIntakeLockDir(filePath: string): string

export function resolveRepoComposeProjectMarkers(
  env?: NodeJS.ProcessEnv
): readonly string[]

export function loadPersistedDockerLogErrorFingerprintsFromJsonl(
  filePath: string,
  readFileFn?: (path: string, encoding: BufferEncoding) => Promise<string>,
  options?: { maxBytes?: number; maxLines?: number }
): Promise<Set<string>>

export function acquireIntakeFileLock(
  filePath: string,
  options?: {
    maxWaitMs?: number
    pollMs?: number
    staleLockMs?: number
  } & IntakeLockFns
): Promise<{ release: () => Promise<void> }>

export function withIntakeFileLock<T>(
  filePath: string,
  fn: () => Promise<T>,
  options?: {
    maxWaitMs?: number
    pollMs?: number
    staleLockMs?: number
  } & IntakeLockFns
): Promise<T>

export const DEFAULT_REPO_OWNED_DOCKER_LOG_CONTAINERS: readonly string[]
export const REPO_OWNED_COMPOSE_SERVICE_NAMES: readonly string[]
export const DEFAULT_REPO_COMPOSE_PROJECT_MARKERS: readonly string[]

export function normalizeDockerContainerName(name: string): string

export function readDockerComposeLabels(
  config: RecordRow
): Record<string, string>

export function isDashboardShellComposeProject(
  config: RecordRow,
  markers?: readonly string[]
): boolean

export function matchDockerJsonLogContainer(
  config: RecordRow,
  resolvedContainerNames: readonly string[],
  options?: {
    env?: NodeJS.ProcessEnv
    repoComposeProjectMarkers?: readonly string[]
  }
): {
  matched: boolean
  container: string | null
  matchKind: string | null
}

export function shouldDiscoverDockerJsonLogSources(
  resolvedContainerNames: readonly string[]
): boolean

export function discoverDockerJsonLogSourcesFromConfigs(
  configs: readonly RecordRow[],
  resolvedContainerNames: readonly string[],
  options?: {
    env?: NodeJS.ProcessEnv
    repoComposeProjectMarkers?: readonly string[]
  }
): Array<{
  container: string
  logPath: string
  matchKind?: string | null
}>

export function parseDockerLogContainerNames(
  value: string | undefined
): string[]

export function parseDockerLogExternalContainerNames(
  value: string | undefined
): string[]

export function resolveDockerLogExternalContainerNames(
  env?: NodeJS.ProcessEnv
): string[]

export function isRepoOwnedDockerLogContainerName(
  containerName: string,
  options?: { env?: NodeJS.ProcessEnv }
): boolean

export function filterDockerLogErrorsForCentralizedIntake(
  rows: readonly DockerLogErrorRow[],
  options?: { env?: NodeJS.ProcessEnv }
): DockerLogErrorRow[]

export function resolveDockerLogContainerNames(
  env?: NodeJS.ProcessEnv
): string[]

export function stripAnsi(value: string): string

export function compactLogMessage(value: string): string

export function inferLogProvider(message: string): string

export function extractHttpStatusCodes(message: string): number[]

export function hasHttpStatusSignal(message: string): boolean

export function inferLogLevel(message: string): string

export function inferLogStatusCode(message: string): number | null

export function isIgnoredContainerLogNoise(message: string): boolean

export function isInformationalErrorMention(message: string): boolean

export function isSuccessfulHttpAccessLog(message: string): boolean

export function isActionableErrorLog(message: string): boolean

export function safeContainerErrorIntakeBasename(containerName: string): string

export function dockerLogErrorIntakePath(
  intakeDir: string,
  containerName: string
): string

export function buildDockerLogErrorFingerprint(row: DockerLogErrorRow): string

export function buildDockerLogErrorRow(
  parsed: { time?: string; stream?: string; log?: string },
  container: string,
  source?: RecordRow
): DockerLogErrorRow | null

export function extractDockerLogErrorsFromTail(options: {
  tailText: string
  container: string
  cutoffMs: number
  source?: RecordRow
}): DockerLogErrorRow[]

export function selectNewDockerLogErrors(
  rows: readonly DockerLogErrorRow[],
  seenFingerprints: Set<string>
): DockerLogErrorRow[]

export function commitDockerLogErrorFingerprints(
  rows: readonly DockerLogErrorRow[],
  seenFingerprints: Set<string>
): void

export function splitDockerLogErrorsForDashboardAndIntake(
  sortedRows: readonly DockerLogErrorRow[],
  maxDashboardRows: number
): {
  forIntake: DockerLogErrorRow[]
  forDashboard: DockerLogErrorRow[]
}

export function capDockerLogErrorsForDashboard(
  rows: readonly DockerLogErrorRow[],
  maxRows: number
): DockerLogErrorRow[]

export function appendDockerLogErrorsToIntake(options: {
  intakeDir: string
  rows: readonly DockerLogErrorRow[]
  seenFingerprints?: Set<string>
  appendFileFn?: typeof import('node:fs/promises').appendFile
  readFileFn?: typeof import('node:fs/promises').readFile
  writeFileFn?: typeof import('node:fs/promises').writeFile
  mkdirFn?: typeof import('node:fs/promises').mkdir
  lockOptions?: Record<string, unknown>
}): Promise<{ appended: number; files: string[]; skipped: number }>
