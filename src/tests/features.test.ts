import { describe, expect, spyOn, test } from 'bun:test'
import plugin from '../index.ts'

const oauthCredential = {
  type: 'oauth',
  methodID: 'claude-max',
  refresh: 'refresh-token',
  access: 'access-token',
  expires: Date.now() + 3600_000,
}

/** A context with the domains the Google plugin also uses. */
function context(credential: unknown) {
  const hooks = new Map<string, (event: any) => Promise<void> | void>()
  const tools: any[] = []
  const commands: any[] = []
  let providerTransform: ((draft: any) => void) | undefined
  let subscribeSignal: AbortSignal | undefined
  let reloads = 0
  const ctx = {
    integration: {
      transform: async (cb: (draft: any) => void) => {
        cb({ method: { update: () => {} } })
      },
      connection: {
        active: async () =>
          credential ? { id: 'c1', type: 'credential' } : undefined,
        resolve: async () => credential,
      },
    },
    session: {
      hook: async (name: string, cb: (event: any) => Promise<void> | void) => {
        hooks.set(name, cb)
      },
      synthetic: async () => ({ id: 's' }),
    },
    provider: {
      transform: async (cb: (draft: any) => void) => {
        providerTransform = cb
      },
      reload: async () => {
        reloads += 1
      },
    },
    tool: {
      transform: async (cb: (draft: any) => void) => {
        cb({ add: (tool: any) => tools.push(tool) })
      },
    },
    command: {
      transform: async (cb: (draft: any) => void) => {
        cb({ add: (command: any) => commands.push(command) })
      },
    },
    event: {
      subscribe: ({ signal }: { signal: AbortSignal }) => {
        subscribeSignal = signal
        return {
          async *[Symbol.asyncIterator]() {
            await new Promise<void>((resolve) =>
              signal.addEventListener('abort', () => resolve(), { once: true }),
            )
          },
        }
      },
    },
  }
  const anthropicDraft = () => {
    const models = new Map([
      ['claude-sonnet-5-5', { id: 'claude-sonnet-5-5', cost: [{ input: 3 }] }],
    ])
    return {
      models,
      draft: {
        get: (id: string) => (id === 'anthropic' ? { models } : undefined),
        models: {
          update: (_p: string, id: string, fn: (model: any) => void) =>
            fn(models.get(id)),
        },
      },
    }
  }
  return {
    ctx,
    hooks,
    tools,
    commands,
    anthropicDraft,
    transform: () => providerTransform,
    signal: () => subscribeSignal,
    reloads: () => reloads,
  }
}

describe('features shared with the Google plugin', () => {
  test('zeroes prices only while the Claude Pro/Max login is active', async () => {
    const withOAuth = context(oauthCredential)
    await plugin.setup(withOAuth.ctx as any)
    const a = withOAuth.anthropicDraft()
    withOAuth.transform()!(a.draft)
    expect(a.models.get('claude-sonnet-5-5')!.cost).toEqual([])

    const withKey = context({ type: 'api', key: 'k' })
    await plugin.setup(withKey.ctx as any)
    const b = withKey.anthropicDraft()
    withKey.transform()!(b.draft)
    expect(b.models.get('claude-sonnet-5-5')!.cost).toEqual([{ input: 3 }])
  })

  test('registers claude_quota and /cquota', async () => {
    const c = context(oauthCredential)
    await plugin.setup(c.ctx as any)
    expect(c.tools.map((t) => t.name)).toEqual(['claude_quota'])
    expect(c.commands.map((t) => t.name)).toEqual(['cquota'])
    const result = await c.tools[0].execute({})
    expect(result.content).toContain('Claude subscription quota')
  })

  test('shows a quota snapshot only to the login that received it', async () => {
    const headers = {
      'anthropic-ratelimit-unified-status': 'allowed',
      'anthropic-ratelimit-unified-5h-utilization': '0.4',
    }
    const snapshot = (account: string) => ({
      capturedAt: Date.now(),
      status: 200,
      headers,
      account,
    })
    const run = async (stored: unknown) => {
      const c = context(oauthCredential)
      ;(c.ctx as any).storage = {
        get: async (key: string) =>
          key === 'ratelimit-snapshot' ? stored : undefined,
        set: async () => {},
      }
      await plugin.setup(c.ctx as any)
      return c.tools[0].execute({})
    }
    const { describeConnection } = await import('../rate-limit')
    const mine = describeConnection({ id: 'c1', type: 'credential' })

    const same = await run(snapshot(mine))
    expect(same.metadata.ok).toBe(true)
    expect(same.content).toContain('40% used')

    const other = await run(
      snapshot(describeConnection({ id: 'c2', type: 'credential' })),
    )
    expect(other.metadata.ok).toBe(false)
    expect(other.content).not.toContain('40% used')

    // Snapshots saved before this fix carry no account: not shown either.
    const legacy = await run({ capturedAt: Date.now(), status: 200, headers })
    expect(legacy.metadata.ok).toBe(false)
  })

  test('says once that a login made by another plugin is left alone', async () => {
    const c = context({ ...oauthCredential, methodID: 'claude-code' })
    await plugin.setup(c.ctx as any)
    const warn = spyOn(console, 'warn').mockImplementation(() => {})
    try {
      const request = new Request('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        body: '{}',
      })
      const event = {
        model: { providerID: 'anthropic', id: 'claude-haiku-5-5' },
        request,
      }
      await c.hooks.get('http.request')!(event)
      await c.hooks.get('http.request')!({ ...event })
      expect(event.request).toBe(request)
      const messages = warn.mock.calls.map((call) => String(call[0]))
      const foreign = messages.filter((m) => m.includes('another plugin'))
      expect(foreign).toHaveLength(1)
      expect(foreign[0]).toContain('"claude-code"')
      expect(foreign[0]).toContain('opencode auth login anthropic')
    } finally {
      warn.mockRestore()
    }
  })

  test('cancels its event subscription when disposed', async () => {
    const c = context(oauthCredential)
    const cleanup = (await plugin.setup(c.ctx as any)) as () => void
    expect(c.signal()?.aborted).toBe(false)
    cleanup()
    expect(c.signal()?.aborted).toBe(true)
  })
})
