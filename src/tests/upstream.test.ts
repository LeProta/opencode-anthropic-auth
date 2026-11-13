import { beforeEach, describe, expect, test } from 'bun:test'
import {
  checkUpstreamUpdate,
  resetUpstreamCheckForTests,
  UPSTREAM_SOURCES,
  upstreamNotices,
} from '../upstream.ts'

const reviewedHeads = () =>
  Object.fromEntries(
    UPSTREAM_SOURCES.map((s) => [
      `${s.repo}@${s.branch}:${s.path}`,
      s.reviewed,
    ]),
  )

describe('upstream notices', () => {
  test('stays quiet while every source is at its reviewed commit', () => {
    expect(
      upstreamNotices(
        { checkedAt: 0, heads: reviewedHeads(), npmLatest: '2.1.290' },
        '2.1.280',
      ),
    ).toEqual([])
  })

  test('names a fork-base change, a wire change and a far-behind version', () => {
    const heads = reviewedHeads()
    const fork = UPSTREAM_SOURCES[0]!
    const wire = UPSTREAM_SOURCES[1]!
    heads[`${fork.repo}@${fork.branch}:${fork.path}`] = 'a'.repeat(40)
    heads[`${wire.repo}@${wire.branch}:${wire.path}`] = 'b'.repeat(40)
    const notices = upstreamNotices(
      { checkedAt: 0, heads, npmLatest: '2.1.323' },
      '2.1.280',
    )
    expect(notices).toHaveLength(3)
    expect(notices[0]).toContain('ex-machina published new commits')
    expect(notices[1]).toContain('claude_signing.go')
    expect(notices[2]).toContain('Claude Code 2.1.323 is out')
  })
})

describe('checkUpstreamUpdate', () => {
  beforeEach(() => resetUpstreamCheckForTests())

  test('is off with OPENCODE_ANTHROPIC_UPDATE_CHECK=0', async () => {
    let calls = 0
    await checkUpstreamUpdate('2.1.280', () => {}, {
      env: { OPENCODE_ANTHROPIC_UPDATE_CHECK: '0' },
      fetch: (async () => {
        calls++
        return new Response('[]')
      }) as unknown as typeof fetch,
    })
    expect(calls).toBe(0)
  })

  test('fetches once a day, refuses redirects and reuses the stored result', async () => {
    const store = new Map<string, unknown>()
    const storage = {
      get: async (key: string) => store.get(key),
      set: async (key: string, value: never) => {
        store.set(key, value)
      },
    }
    const inits: RequestInit[] = []
    const fetchFn = (async (
      input: string | URL | Request,
      init?: RequestInit,
    ) => {
      inits.push(init ?? {})
      const url = String(input)
      if (url.includes('registry.npmjs.org')) {
        return new Response(JSON.stringify({ version: '2.1.323' }))
      }
      const source = UPSTREAM_SOURCES.find(
        (s) =>
          url.includes(`/repos/${s.repo}/`) &&
          (s.path
            ? url.includes(encodeURIComponent(s.path))
            : !url.includes('path=')),
      )
      return new Response(JSON.stringify([{ sha: source?.reviewed }]))
    }) as unknown as typeof fetch
    const notices: string[] = []
    await checkUpstreamUpdate('2.1.280', (m) => notices.push(m), {
      env: {},
      fetch: fetchFn,
      storage,
      now: 1_000,
    })
    expect(inits).toHaveLength(UPSTREAM_SOURCES.length + 1)
    expect(inits.every((init) => init.redirect === 'error')).toBe(true)
    expect(notices).toEqual([expect.stringContaining('Claude Code 2.1.323')])

    resetUpstreamCheckForTests()
    await checkUpstreamUpdate('2.1.280', () => {}, {
      env: {},
      fetch: fetchFn,
      storage,
      now: 2_000,
    })
    expect(inits).toHaveLength(UPSTREAM_SOURCES.length + 1)
  })
})
