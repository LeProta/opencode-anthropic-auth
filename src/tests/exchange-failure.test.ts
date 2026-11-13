import { afterEach, describe, expect, spyOn, test } from 'bun:test'
import { exchange, exchangeFailureMessage } from '../auth.ts'
import { CODE_CALLBACK_URL } from '../constants.ts'

describe('code exchange failure reasons', () => {
  afterEach(() => {
    ;(
      globalThis.fetch as unknown as { mockRestore?: () => void }
    ).mockRestore?.()
  })

  test('tells apart bad input, another sign-in, a refused code, the network and a bad answer', async () => {
    expect(
      await exchange('not a code', 'v', CODE_CALLBACK_URL, 'state'),
    ).toEqual({ type: 'failed', reason: 'invalid_input' })
    expect(
      await exchange('code#other', 'v', CODE_CALLBACK_URL, 'state'),
    ).toEqual({ type: 'failed', reason: 'state_mismatch' })

    spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('{"error":"invalid_grant"}', { status: 400 }),
    )
    expect(
      await exchange('code#state', 'v', CODE_CALLBACK_URL, 'state'),
    ).toEqual({ type: 'failed', reason: 'rejected' })
    ;(globalThis.fetch as unknown as { mockRestore: () => void }).mockRestore()

    spyOn(globalThis, 'fetch').mockRejectedValue(
      Object.assign(new TypeError('Unable to connect'), {
        code: 'ECONNREFUSED',
      }),
    )
    expect(
      await exchange('code#state', 'v', CODE_CALLBACK_URL, 'state'),
    ).toEqual({ type: 'failed', reason: 'network' })
    ;(globalThis.fetch as unknown as { mockRestore: () => void }).mockRestore()

    spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('{"access_token":"a"}', { status: 200 }),
    )
    expect(
      await exchange('code#state', 'v', CODE_CALLBACK_URL, 'state'),
    ).toEqual({ type: 'failed', reason: 'invalid_response' })
  })

  test('explains each reason without echoing the pasted code', () => {
    for (const reason of [
      'invalid_input',
      'state_mismatch',
      'rejected',
      'network',
      'invalid_response',
    ] as const) {
      const message = exchangeFailureMessage(reason)
      expect(message).toStartWith(
        'Failed to exchange the Claude Pro/Max authorization code: ',
      )
      expect(message.length).toBeGreaterThan(70)
    }
    expect(exchangeFailureMessage('network')).toContain('connection')
  })
})
