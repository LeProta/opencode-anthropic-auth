// Lists upstream commits not yet reviewed for the sources in src/upstream.ts,
// then the Claude Code release on npm next to the version this plugin reports.
// Run by hand: the plugin itself checks nothing.
//   bun run check:upstream               show what changed, with compare links
//   bun run check:upstream -- --accept   record the latest commits as reviewed
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { CLAUDE_CODE_VERSION } from '../src/constants.ts'
import { UPSTREAM_SOURCES } from '../src/upstream.ts'

const upstreamPath = join(import.meta.dir, '..', 'src', 'upstream.ts')
let next = await readFile(upstreamPath, 'utf8')
const headers = {
  'User-Agent': 'leprota-anthropic-auth-check',
  Accept: 'application/vnd.github+json',
}

let pending = 0
for (const source of UPSTREAM_SOURCES) {
  const query = new URLSearchParams({ sha: source.branch, per_page: '30' })
  if (source.path) query.set('path', source.path)
  const res = await fetch(
    `https://api.github.com/repos/${source.repo}/commits?${query}`,
    { headers },
  )
  if (!res.ok) throw new Error(`GitHub API ${res.status}: ${await res.text()}`)
  const commits = (await res.json()) as Array<{
    sha: string
    commit: { committer: { date: string }; message: string }
  }>
  const index = commits.findIndex((c) => c.sha === source.reviewed)
  const fresh = index === -1 ? commits : commits.slice(0, index)
  const label = `${source.repo}@${source.branch}${source.path ? `:${source.path}` : ''}`
  if (!fresh.length) {
    console.log(`ok       ${label}`)
    continue
  }
  pending += fresh.length
  console.log(
    `CHANGED  ${label}  (${fresh.length}${index === -1 ? '+' : ''} new)`,
  )
  for (const c of fresh) {
    console.log(
      `         ${c.commit.committer.date.slice(0, 10)} ${c.sha.slice(0, 7)} ${c.commit.message.split('\n')[0]}`,
    )
  }
  console.log(
    `         diff: https://github.com/${source.repo}/compare/${source.reviewed.slice(0, 12)}...${fresh[0]?.sha.slice(0, 12)}`,
  )
  next = next.replace(
    `reviewed: '${source.reviewed}'`,
    `reviewed: '${fresh[0]?.sha}'`,
  )
}

const npm = await fetch(
  'https://registry.npmjs.org/@anthropic-ai/claude-code/latest',
  { headers },
)
const latest = npm.ok
  ? ((await npm.json()) as { version?: string }).version
  : `unavailable (${npm.status})`
console.log(
  `Claude Code on npm: ${latest}; this plugin reports ${CLAUDE_CODE_VERSION} (src/constants.ts).`,
)

if (process.argv.includes('--accept')) {
  await writeFile(upstreamPath, next)
  console.log(
    pending ? 'Recorded the latest commits as reviewed.' : 'Nothing to record.',
  )
} else if (pending) {
  console.log(
    '\nMerge the fork base / review the wire changes (UPSTREAM.md), run the tests, then rerun with -- --accept.',
  )
}
