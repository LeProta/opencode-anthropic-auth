import { describe, expect, test } from 'bun:test'
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

  test('cancels its event subscription when disposed', async () => {
    const c = context(oauthCredential)
    const cleanup = (await plugin.setup(c.ctx as any)) as () => void
    expect(c.signal()?.aborted).toBe(false)
    cleanup()
    expect(c.signal()?.aborted).toBe(true)
  })
})
