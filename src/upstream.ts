import { readBoundedText } from './bounded.ts'
import { compareClaudeCodeVersions } from './config.ts'

/**
 * Upstream sources this fork follows, same mechanism as the Google plugin's
 * src/upstream.ts. Notice only: the plugin never downloads or runs code.
 *
 * - ex-machina v2/main is the fork base: new commits there should be merged.
 * - CLIProxyAPI's Claude executor is the reference wire format: changes there
 *   are reviewed against constants.ts / cch.ts / transform.ts, never copied
 *   automatically (see UPSTREAM.md).
 *
 * Updated by `bun run check:upstream -- --accept`; do not edit by hand.
 */
export const UPSTREAM_SOURCES: readonly {
  readonly repo: string
  readonly branch: string
  readonly path: string
  readonly reviewed: string
}[] = [
  {
    repo: 'ex-machina-co/opencode-anthropic-auth',
    branch: 'v2/main',
    path: '',
    reviewed: '59a09c8ce61fddc8c84c59c2271fd3b62d01be19',
  },
  {
    repo: 'router-for-me/CLIProxyAPI',
    branch: 'main',
    path: 'internal/runtime/executor/claude_signing.go',
    reviewed: '65de937cf19b88436ee8519caa42f0fcb66e2307',
  },
  {
    repo: 'router-for-me/CLIProxyAPI',
    branch: 'main',
    path: 'internal/runtime/executor/claude_executor_request.go',
    reviewed: '02ec93d004edb830d65fa24d699322abd291e03f',
  },
  {
    repo: 'router-for-me/CLIProxyAPI',
    branch: 'main',
    path: 'internal/runtime/executor/claude_executor_cloaking.go',
    reviewed: 'fa11a573b252b30256bef4de952a95feee3c8c9d',
  },
  {
    repo: 'router-for-me/CLIProxyAPI',
    branch: 'main',
    path: 'internal/runtime/executor/helps/claude_device_profile.go',
    reviewed: 'b4e7dbd2c984ec4a74d829ee0425430a20146c77',
  },
  {
    repo: 'router-for-me/CLIProxyAPI',
    branch: 'main',
    path: 'internal/auth/claude/anthropic.go',
    reviewed: 'f3e25ab2bae6e7d533637d3ef1b64722525435d4',
  },
]

export const UPDATE_CHECK_ENV_VAR = 'OPENCODE_ANTHROPIC_UPDATE_CHECK'
const CHECK_TTL_MS = 24 * 60 * 60 * 1000
const FETCH_TIMEOUT_MS = 5_000
const MAX_JSON_BYTES = 256 * 1024
/**
 * Claude Code ships several releases a week; warn only once the reported
 * version is clearly behind, not after every release.
 */
const VERSION_DRIFT_PATCHES = 25
const STORAGE_KEY = 'upstream-check'
const NPM_LATEST_URL =
  'https://registry.npmjs.org/@anthropic-ai/claude-code/latest'

export interface UpstreamCheckState {
  checkedAt: number
  heads: Record<string, string>
  npmLatest?: string
}

export interface UpstreamCheckDeps {
  fetch?: typeof fetch
  storage?: {
    get(key: string): Promise<unknown>
    set(key: string, value: never): Promise<void>
  }
  now?: number
  env?: Record<string, string | undefined>
}

const sourceKey = (source: (typeof UPSTREAM_SOURCES)[number]) =>
  `${source.repo}@${source.branch}:${source.path}`

async function getJson(
  fetchFn: typeof fetch,
  url: string,
): Promise<unknown | undefined> {
  const response = await fetchFn(url, {
    headers: {
      Accept: 'application/vnd.github+json, application/json',
      'User-Agent': 'leprota-anthropic-auth-update-check',
    },
    redirect: 'error',
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  })
  if (!response.ok) {
    await response.body?.cancel().catch(() => {})
    return undefined
  }
  // Bounded while reading: response.text() would buffer whatever the server sends.
  return JSON.parse(
    await readBoundedText(response.body, MAX_JSON_BYTES, 'Upstream check'),
  )
}

async function fetchState(
  fetchFn: typeof fetch,
  now: number,
): Promise<UpstreamCheckState> {
  const heads: Record<string, string> = {}
  await Promise.all(
    UPSTREAM_SOURCES.map(async (source) => {
      const query = new URLSearchParams({ sha: source.branch, per_page: '1' })
      if (source.path) query.set('path', source.path)
      const commits = await getJson(
        fetchFn,
        `https://api.github.com/repos/${source.repo}/commits?${query}`,
      ).catch(() => undefined)
      const sha = Array.isArray(commits) ? commits[0]?.sha : undefined
      if (typeof sha === 'string' && /^[0-9a-f]{40}$/.test(sha)) {
        heads[sourceKey(source)] = sha
      }
    }),
  )
  const latest = (await getJson(fetchFn, NPM_LATEST_URL).catch(
    () => undefined,
  )) as { version?: unknown } | undefined
  return {
    checkedAt: now,
    heads,
    npmLatest: typeof latest?.version === 'string' ? latest.version : undefined,
  }
}

/** What changed upstream since the recorded review, as one-line notices. */
export function upstreamNotices(
  state: UpstreamCheckState,
  reportedVersion: string,
): string[] {
  const notices: string[] = []
  const changedFork = UPSTREAM_SOURCES.filter(
    (source) =>
      source.repo.startsWith('ex-machina-co/') &&
      state.heads[sourceKey(source)] &&
      state.heads[sourceKey(source)] !== source.reviewed,
  )
  if (changedFork.length) {
    notices.push(
      'ex-machina published new commits on v2/main: merge them into the fork, run the tests, then `bun run check:upstream -- --accept`.',
    )
  }
  const changedWire = UPSTREAM_SOURCES.filter(
    (source) =>
      source.repo === 'router-for-me/CLIProxyAPI' &&
      state.heads[sourceKey(source)] &&
      state.heads[sourceKey(source)] !== source.reviewed,
  ).map((source) => source.path.split('/').pop())
  if (changedWire.length) {
    notices.push(
      `CLIProxyAPI changed its Claude wire files (${changedWire.join(', ')}): review them against UPSTREAM.md.`,
    )
  }
  if (state.npmLatest && isFarBehind(reportedVersion, state.npmLatest)) {
    notices.push(
      `Claude Code ${state.npmLatest} is out and this plugin reports ${reportedVersion}. Update the plugin, or set ANTHROPIC_CLAUDE_CODE_VERSION if a model starts asking for a newer client.`,
    )
  }
  return notices
}

function isFarBehind(reported: string, latest: string): boolean {
  if (compareClaudeCodeVersions(latest, reported) !== 1) return false
  const [rMajor, rMinor, rPatch] = reported.split('.').map(Number)
  const [lMajor, lMinor, lPatch] = latest.split('.').map(Number)
  if (rMajor !== lMajor || rMinor !== lMinor) return true
  return (lPatch ?? 0) - (rPatch ?? 0) >= VERSION_DRIFT_PATCHES
}

let checkedThisProcess = false

/** At most once per process and once a day (cached in plugin storage). */
export async function checkUpstreamUpdate(
  reportedVersion: string,
  notify: (message: string) => void,
  deps: UpstreamCheckDeps = {},
): Promise<void> {
  const env = deps.env ?? process.env
  if (env[UPDATE_CHECK_ENV_VAR] === '0' || checkedThisProcess) return
  checkedThisProcess = true
  const now = deps.now ?? Date.now()
  let state: UpstreamCheckState | undefined
  try {
    const cached = (await deps.storage?.get(STORAGE_KEY)) as
      | UpstreamCheckState
      | undefined
    if (cached && now - cached.checkedAt < CHECK_TTL_MS) state = cached
  } catch {}
  if (!state) {
    state = await fetchState(deps.fetch ?? fetch, now)
    await deps.storage?.set(STORAGE_KEY, state as never).catch(() => {})
  }
  for (const notice of upstreamNotices(state, reportedVersion)) notify(notice)
}

/** Test hook: lets a test run the once-per-process check again. */
export function resetUpstreamCheckForTests(): void {
  checkedThisProcess = false
}
