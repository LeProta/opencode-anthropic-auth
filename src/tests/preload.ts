// Tests mock fetch and count calls: keep the plugin's daily upstream check out of them.
process.env.OPENCODE_ANTHROPIC_UPDATE_CHECK = '0'
// A developer's own endpoint settings must not decide which origin the tests trust.
delete process.env.ANTHROPIC_BASE_URL
delete process.env.ANTHROPIC_INSECURE

// The plugin keeps settled refreshes for the whole process (see REFRESH_STATE in index.ts):
// tests that reuse a refresh token must not see another test's rotation.
const { beforeEach } = await import('bun:test')
beforeEach(() => {
  const state = (
    globalThis as Record<
      symbol,
      | {
          cache: Map<string, unknown>
          cacheTimers: Map<string, unknown>
          superseded: Set<string>
        }
      | undefined
    >
  )[Symbol.for('leprota.anthropic-auth/refresh-state/v1')]
  state?.cache.clear()
  state?.cacheTimers.clear()
  state?.superseded.clear()
})
