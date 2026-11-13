import { describe, expect, test } from 'bun:test'
import {
  captureRateLimitHeaders,
  formatQuota,
  isDebugEnabled,
} from '../quota.ts'

describe('subscription quota from response headers', () => {
  test('keeps only bounded anthropic-ratelimit-* headers', () => {
    const response = new Response('{}', {
      status: 200,
      headers: {
        'anthropic-ratelimit-unified-status': 'allowed',
        'anthropic-ratelimit-unified-5h-utilization': '0.42',
        'anthropic-ratelimit-unified-5h-reset': '1794540000',
        'anthropic-ratelimit-unified-7d-utilization': '0.1',
        'anthropic-ratelimit-weird': 'x'.repeat(500),
        authorization: 'Bearer secret',
        'set-cookie': 'session=secret',
      },
    })
    const snapshot = captureRateLimitHeaders(response, 1_000)
    expect(snapshot?.headers).toEqual({
      'anthropic-ratelimit-unified-status': 'allowed',
      'anthropic-ratelimit-unified-5h-utilization': '0.42',
      'anthropic-ratelimit-unified-5h-reset': '1794540000',
      'anthropic-ratelimit-unified-7d-utilization': '0.1',
    })
    expect(captureRateLimitHeaders(new Response('{}'))).toBeUndefined()
  })

  test('formats the windows with relative resets', () => {
    const now = 1_794_530_000_000
    const text = formatQuota(
      {
        capturedAt: now - 120_000,
        status: 429,
        headers: {
          'anthropic-ratelimit-unified-status': 'rejected',
          'anthropic-ratelimit-unified-5h-utilization': '1',
          'anthropic-ratelimit-unified-5h-reset': String(now / 1000 + 3600),
          'anthropic-ratelimit-unified-7d-utilization': '0.37',
        },
      },
      now,
    )
    expect(text).toContain('2 min ago, HTTP 429')
    expect(text).toContain('- status: rejected')
    expect(text).toContain('- 5-hour window: 100% used, resets in 1 h 0 min')
    expect(text).toContain('- weekly window: 37% used')
    expect(formatQuota(undefined)).toContain('no Anthropic response seen yet')
  })

  test('debug is opt-in', () => {
    expect(isDebugEnabled({})).toBe(false)
    expect(isDebugEnabled({ OPENCODE_ANTHROPIC_DEBUG: '1' })).toBe(true)
  })
})
