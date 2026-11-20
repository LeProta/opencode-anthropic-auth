import { afterEach, describe, expect, mock, spyOn, test } from 'bun:test'
import {
  authorize,
  createCodeExchange,
  exchange,
  isUndeliveredNetworkError,
  refreshToken,
} from '../auth'
import { CLIENT_ID, CODE_CALLBACK_URL, OAUTH_SCOPES } from '../constants'

afterEach(() => {
  mock.restore()
})

describe('sign-in code ownership', () => {
  test('exchanges a code once across concurrent and late submissions', async () => {
    const authorization = await authorize('max')
    const code = `synthetic-code#${authorization.state}`
    const fetchMock = spyOn(globalThis, 'fetch').mockImplementation(
      (async () => {
        return Response.json({
          access_token: 'access',
          refresh_token: 'refresh',
          expires_in: 3600,
        })
      }) as unknown as typeof fetch,
    )
    const exchangeOnce = createCodeExchange(authorization)
    const first = exchangeOnce(code)
    const second = exchangeOnce(code)
    expect(await second).toEqual(await first)
    expect(await exchangeOnce(code)).toEqual(await first)
    expect(
      (await exchangeOnce(`another-code#${authorization.state}`)).type,
    ).toBe('failed')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  test('allows correcting invalid input but never replays after a network failure', async () => {
    const authorization = await authorize('max')
    const exchangeOnce = createCodeExchange(authorization)
    const fetchMock = spyOn(globalThis, 'fetch').mockRejectedValue(
      new TypeError('fetch failed'),
    )
    expect((await exchangeOnce('invalid-input')).type).toBe('failed')
    const code = `synthetic-code#${authorization.state}`
    expect((await exchangeOnce(code)).type).toBe('failed')
    expect((await exchangeOnce(code)).type).toBe('failed')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})

describe('authorize', () => {
  test('returns the hosted callback URL for max mode', async () => {
    const result = await authorize('max')

    expect(result.url).toBeString()
    expect(result.redirectUri).toBe(CODE_CALLBACK_URL)
    expect(result.verifier).toBeString()

    const url = new URL(result.url)
    expect(url.origin).toBe('https://claude.ai')
    expect(url.pathname).toBe('/oauth/authorize')
    expect(url.searchParams.get('redirect_uri')).toBe(CODE_CALLBACK_URL)
  })

  test('returns the hosted callback URL for console mode', async () => {
    const result = await authorize('console')

    const url = new URL(result.url)
    expect(url.origin).toBe('https://platform.claude.com')
    expect(url.pathname).toBe('/oauth/authorize')
    expect(url.searchParams.get('redirect_uri')).toBe(CODE_CALLBACK_URL)
  })

  test('sets required OAuth query params', async () => {
    const result = await authorize('max')
    const url = new URL(result.url)

    expect(url.searchParams.get('code')).toBe('true')
    expect(url.searchParams.get('client_id')).toBe(CLIENT_ID)
    expect(url.searchParams.get('response_type')).toBe('code')
    expect(url.searchParams.get('redirect_uri')).toBe(CODE_CALLBACK_URL)
    expect(url.searchParams.get('scope')).toBe(OAUTH_SCOPES.join(' '))
    expect(url.searchParams.get('code_challenge_method')).toBe('S256')
    expect(url.searchParams.get('state')).toBe(result.state)
  })

  test('does not use localhost', async () => {
    const result = await authorize('max')
    expect(result.redirectUri).not.toContain('localhost')
    expect(result.url).not.toContain('localhost')
  })
})

describe('exchange', () => {
  test('refuses ambiguous callback parameters before sending the code', async () => {
    const request = spyOn(globalThis, 'fetch')
    for (const input of [
      'https://example.test/?code=a&code=b&state=s',
      'code=a&state=s&state=other',
    ]) {
      expect(await exchange(input, 'verifier', CODE_CALLBACK_URL, 's')).toEqual(
        { type: 'failed', reason: 'invalid_input' },
      )
    }
    expect(request).not.toHaveBeenCalled()
  })

  test('accepts code#state format', async () => {
    let capturedBody: string | undefined

    spyOn(globalThis, 'fetch').mockImplementation(((
      _input: string | URL | Request,
      init?: RequestInit,
    ) => {
      capturedBody = init?.body as string
      return Promise.resolve(
        new Response(
          JSON.stringify({
            refresh_token: 'r',
            access_token: 'a',
            expires_in: 3600,
          }),
          { status: 200 },
        ),
      )
    }) as typeof fetch)

    const result = await exchange(
      'mycode#mystate',
      'myverifier',
      CODE_CALLBACK_URL,
      'mystate',
    )

    expect(result.type).toBe('success')
    const body = JSON.parse(capturedBody!)
    expect(body.code).toBe('mycode')
    expect(body.state).toBe('mystate')
    expect(body.redirect_uri).toBe(CODE_CALLBACK_URL)
  })

  test('accepts a full callback URL', async () => {
    let capturedBody: string | undefined

    spyOn(globalThis, 'fetch').mockImplementation(((
      _input: string | URL | Request,
      init?: RequestInit,
    ) => {
      capturedBody = init?.body as string
      return Promise.resolve(
        new Response(
          JSON.stringify({
            refresh_token: 'r',
            access_token: 'a',
            expires_in: 3600,
          }),
          { status: 200 },
        ),
      )
    }) as typeof fetch)

    await exchange(
      'https://platform.claude.com/oauth/code/callback?code=mycode&state=mystate',
      'myverifier',
      CODE_CALLBACK_URL,
      'mystate',
    )

    const body = JSON.parse(capturedBody!)
    expect(body.code).toBe('mycode')
    expect(body.state).toBe('mystate')
  })

  test('returns failed on invalid callback input', async () => {
    const fetchSpy = spyOn(globalThis, 'fetch').mockImplementation((() =>
      Promise.resolve(new Response(null))) as unknown as typeof fetch)

    const result = await exchange(
      'not-a-callback',
      'verifier',
      CODE_CALLBACK_URL,
    )
    expect(result.type).toBe('failed')
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  test('returns failed on state mismatch', async () => {
    const fetchSpy = spyOn(globalThis, 'fetch').mockImplementation((() =>
      Promise.resolve(new Response(null))) as unknown as typeof fetch)

    const result = await exchange(
      'code#wrong',
      'verifier',
      CODE_CALLBACK_URL,
      'expected',
    )
    expect(result.type).toBe('failed')
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  test('rejects oversized OAuth inputs before serializing or fetching', async () => {
    const fetchSpy = spyOn(globalThis, 'fetch').mockImplementation((() =>
      Promise.resolve(new Response(null))) as unknown as typeof fetch)

    expect(
      await exchange(
        `${'x'.repeat(16 * 1024)}#state`,
        'verifier',
        CODE_CALLBACK_URL,
        'state',
      ),
    ).toMatchObject({ type: 'failed' })
    expect(
      await exchange(
        'code#state',
        'v'.repeat(1025),
        CODE_CALLBACK_URL,
        'state',
      ),
    ).toMatchObject({ type: 'failed' })
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  test('rejects malformed UTF-16 OAuth inputs before fetching', async () => {
    const fetchSpy = spyOn(globalThis, 'fetch').mockImplementation((() =>
      Promise.resolve(new Response(null))) as unknown as typeof fetch)

    expect(
      await exchange(
        'code\ud800#state',
        'verifier',
        CODE_CALLBACK_URL,
        'state',
      ),
    ).toMatchObject({ type: 'failed' })
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  test('returns failed for a malformed token response', async () => {
    spyOn(globalThis, 'fetch').mockResolvedValue(
      Response.json({ access_token: 'access' }),
    )

    const result = await exchange(
      'code#state',
      'verifier',
      CODE_CALLBACK_URL,
      'state',
    )

    expect(result.type).toBe('failed')
  })

  test('returns failed when the token response is not JSON', async () => {
    spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('<html>upstream error</html>', { status: 200 }),
    )

    const result = await exchange(
      'code#state',
      'verifier',
      CODE_CALLBACK_URL,
      'state',
    )

    expect(result.type).toBe('failed')
  })

  test('uses a 30-second timeout and fails cleanly when exchange times out', async () => {
    const timeout = new AbortController()
    const timeoutSpy = spyOn(AbortSignal, 'timeout').mockReturnValue(
      timeout.signal,
    )
    spyOn(globalThis, 'fetch').mockImplementation(((_input, init) => {
      expect(init?.signal).toBe(timeout.signal)
      return new Promise((_resolve, reject) => {
        init?.signal?.addEventListener(
          'abort',
          () => reject(init.signal?.reason),
          { once: true },
        )
        timeout.abort(new DOMException('Timed out', 'TimeoutError'))
      })
    }) as typeof fetch)

    const result = await exchange(
      'code#state',
      'verifier',
      CODE_CALLBACK_URL,
      'state',
    )

    expect(result).toMatchObject({ type: 'failed' })
    expect(timeoutSpy).toHaveBeenCalledWith(30_000)
  })

  test('rejects an oversized token response', async () => {
    spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('{}', {
        status: 200,
        headers: { 'content-length': String(64 * 1024 + 1) },
      }),
    )

    const result = await exchange(
      'code#state',
      'verifier',
      CODE_CALLBACK_URL,
      'state',
    )

    expect(result).toMatchObject({ type: 'failed' })
  })

  test('rejects oversized token values', async () => {
    spyOn(globalThis, 'fetch').mockResolvedValue(
      Response.json({
        refresh_token: 'r'.repeat(8 * 1024 + 1),
        access_token: 'access',
        expires_in: 3600,
      }),
    )

    const result = await exchange(
      'code#state',
      'verifier',
      CODE_CALLBACK_URL,
      'state',
    )

    expect(result).toMatchObject({ type: 'failed' })
  })

  test.each([
    'refresh_token',
    'access_token',
  ])('rejects a token value over 8 KiB by UTF-8 bytes: %s', async (field) => {
    spyOn(globalThis, 'fetch').mockResolvedValue(
      Response.json({
        refresh_token:
          field === 'refresh_token' ? '😀'.repeat(3000) : 'refresh',
        access_token: field === 'access_token' ? '😀'.repeat(3000) : 'access',
        expires_in: 3600,
      }),
    )

    expect(
      await exchange('code#state', 'verifier', CODE_CALLBACK_URL, 'state'),
    ).toMatchObject({ type: 'failed' })
  })

  test('rejects malformed UTF-8 in a token response', async () => {
    const fetchSpy = spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(Uint8Array.of(0xc3, 0x28), { status: 200 }),
    )

    const result = await exchange(
      'code#state',
      'verifier',
      CODE_CALLBACK_URL,
      'state',
    )

    expect(result).toMatchObject({ type: 'failed' })
    expect(fetchSpy).toHaveBeenCalledTimes(1)
  })
})

describe('refreshToken', () => {
  test('rejects an oversized refresh token before fetching', async () => {
    const fetchSpy = spyOn(globalThis, 'fetch').mockImplementation((() =>
      Promise.resolve(new Response(null))) as unknown as typeof fetch)

    expect(await refreshToken('r'.repeat(8 * 1024 + 1))).toEqual({
      type: 'failed',
      status: 400,
    })
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  test('rejects a malformed UTF-16 refresh token before fetching', async () => {
    const fetchSpy = spyOn(globalThis, 'fetch').mockImplementation((() =>
      Promise.resolve(new Response(null))) as unknown as typeof fetch)

    expect(await refreshToken('refresh\udc00')).toEqual({
      type: 'failed',
      status: 400,
    })
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  test('reports a refresh token the provider refused for good (RFC 6749 invalid_grant)', async () => {
    const bodies = [
      '{"error":"invalid_grant","error_description":"Refresh token not found or invalid"}',
      '{"type":"error","error":{"type":"invalid_grant","message":"x"}}',
    ]
    for (const body of bodies) {
      spyOn(globalThis, 'fetch').mockImplementation((() =>
        Promise.resolve(
          new Response(body, { status: 400 }),
        )) as unknown as typeof fetch)
      expect(await refreshToken('old-refresh')).toEqual({
        type: 'failed',
        status: 400,
        rejected: true,
      })
    }
  })

  test('keeps any other 400 retryable later', async () => {
    for (const body of ['{"error":"invalid_request"}', 'invalid', '']) {
      spyOn(globalThis, 'fetch').mockImplementation((() =>
        Promise.resolve(
          new Response(body, { status: 400 }),
        )) as unknown as typeof fetch)
      expect(await refreshToken('old-refresh')).toEqual({
        type: 'failed',
        status: 400,
      })
    }
  })

  test('exchanges a refresh token for a new access/refresh token pair', async () => {
    let capturedBody: string | undefined

    spyOn(globalThis, 'fetch').mockImplementation(((
      _input: string | URL | Request,
      init?: RequestInit,
    ) => {
      capturedBody = init?.body as string
      return Promise.resolve(
        new Response(
          JSON.stringify({
            refresh_token: 'new-refresh',
            access_token: 'new-access',
            expires_in: 3600,
          }),
          { status: 200 },
        ),
      )
    }) as typeof fetch)

    const result = await refreshToken('old-refresh')

    expect(result.type).toBe('success')
    if (result.type !== 'success') throw new Error('unreachable')
    expect(result.access).toBe('new-access')
    expect(result.refresh).toBe('new-refresh')
    expect(result.expires).toBeGreaterThan(Date.now())

    const body = JSON.parse(capturedBody!)
    expect(body.grant_type).toBe('refresh_token')
    expect(body.refresh_token).toBe('old-refresh')
    expect(body.client_id).toBe(CLIENT_ID)
  })

  test('does not retry transient 5xx failures', async () => {
    let attempts = 0
    const setTimeoutSpy = spyOn(globalThis, 'setTimeout').mockImplementation(((
      handler: () => unknown,
    ) => {
      handler()
      return 0
    }) as unknown as typeof setTimeout)

    spyOn(globalThis, 'fetch').mockImplementation((() => {
      attempts++
      if (attempts === 1) {
        return Promise.resolve(
          new Response('Temporary failure', { status: 500 }),
        )
      }
      return Promise.resolve(
        new Response(
          JSON.stringify({
            refresh_token: 'new-refresh',
            access_token: 'new-access',
            expires_in: 3600,
          }),
          { status: 200 },
        ),
      )
    }) as unknown as typeof fetch)

    const result = await refreshToken('old-refresh')

    expect(attempts).toBe(1)
    expect(result).toEqual({ type: 'failed', status: 500 })
    expect(setTimeoutSpy).not.toHaveBeenCalled()
  })

  test('returns failed after the first transient server response', async () => {
    let attempts = 0
    const setTimeoutSpy = spyOn(globalThis, 'setTimeout').mockImplementation(((
      handler: () => unknown,
    ) => {
      handler()
      return 0
    }) as unknown as typeof setTimeout)
    spyOn(globalThis, 'fetch').mockImplementation((() => {
      attempts++
      return Promise.resolve(new Response('Temporary failure', { status: 503 }))
    }) as unknown as typeof fetch)

    const result = await refreshToken('old-refresh')

    expect(result).toEqual({ type: 'failed', status: 503 })
    expect(attempts).toBe(1)
    expect(setTimeoutSpy).not.toHaveBeenCalled()
  })

  test('does not mask a 5xx status when response cleanup rejects', async () => {
    let attempts = 0
    const body = new ReadableStream<Uint8Array>({
      cancel() {
        return Promise.reject(new Error('cancel failed'))
      },
    })
    spyOn(globalThis, 'fetch').mockImplementation((() => {
      attempts++
      return Promise.resolve(new Response(body, { status: 502 }))
    }) as unknown as typeof fetch)

    const result = await refreshToken('old-' + 'refresh')

    expect(result).toEqual({ type: 'failed', status: 502 })
    expect(attempts).toBe(1)
  })

  test('does not retry a connection reset', async () => {
    let attempts = 0
    const setTimeoutSpy = spyOn(globalThis, 'setTimeout').mockImplementation(((
      handler: () => unknown,
    ) => {
      handler()
      return 0
    }) as unknown as typeof setTimeout)
    spyOn(globalThis, 'fetch').mockImplementation((() => {
      attempts++
      if (attempts === 1) {
        return Promise.reject(
          Object.assign(new Error('socket reset'), { code: 'ECONNRESET' }),
        )
      }
      return Promise.resolve(
        Response.json({
          refresh_token: 'new-refresh',
          access_token: 'new-access',
          expires_in: 3600,
        }),
      )
    }) as unknown as typeof fetch)

    const result = await refreshToken('old-refresh')

    expect(result).toEqual({ type: 'failed', status: 0 })
    expect(attempts).toBe(1)
    expect(setTimeoutSpy).not.toHaveBeenCalled()
  })

  test('does not retry non-network exceptions', async () => {
    const failure = new Error('unexpected parser failure')
    const fetchSpy = spyOn(globalThis, 'fetch').mockRejectedValue(failure)

    await expect(refreshToken('old-refresh')).rejects.toBe(failure)
    expect(fetchSpy).toHaveBeenCalledTimes(1)
  })

  test('does not recurse or retry a cyclic error cause', async () => {
    const failure = new Error('application failure') as Error & {
      cause?: unknown
    }
    failure.cause = failure
    const fetchSpy = spyOn(globalThis, 'fetch').mockRejectedValue(failure)

    await expect(refreshToken('old-refresh')).rejects.toBe(failure)
    expect(fetchSpy).toHaveBeenCalledTimes(1)
  })

  test('returns failed without retrying non-transient (4xx) failures', async () => {
    let attempts = 0
    const body = new ReadableStream<Uint8Array>({
      cancel() {
        return Promise.reject(new Error('cancel failed'))
      },
    })
    spyOn(globalThis, 'fetch').mockImplementation((() => {
      attempts++
      return Promise.resolve(new Response(body, { status: 403 }))
    }) as unknown as typeof fetch)

    const result = await refreshToken('old-refresh')

    expect(attempts).toBe(1)
    expect(result).toEqual({ type: 'failed', status: 403 })
  })

  test('returns failed for a malformed successful response', async () => {
    const fetchSpy = spyOn(globalThis, 'fetch').mockResolvedValue(
      Response.json({ access_token: 'new-access' }),
    )

    const result = await refreshToken('old-refresh')

    expect(result).toEqual({ type: 'failed', status: 200 })
    expect(fetchSpy).toHaveBeenCalledTimes(1)
  })

  test('returns failed when token expiry exceeds the safe timestamp range', async () => {
    const fetchSpy = spyOn(globalThis, 'fetch').mockResolvedValue(
      Response.json({
        refresh_token: 'new-refresh',
        access_token: 'new-access',
        expires_in: Number.MAX_VALUE,
      }),
    )

    const result = await refreshToken('old-refresh')

    expect(result).toEqual({ type: 'failed', status: 200 })
    expect(fetchSpy).toHaveBeenCalledTimes(1)
  })

  test('returns failed when a successful response is not JSON', async () => {
    const fetchSpy = spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('<html>upstream error</html>', { status: 200 }),
    )

    const result = await refreshToken('old-refresh')

    expect(result).toEqual({ type: 'failed', status: 200 })
    expect(fetchSpy).toHaveBeenCalledTimes(1)
  })

  test('does not retry a timed-out request', async () => {
    let attempts = 0
    const timeout = new AbortController()
    const timeoutSpy = spyOn(AbortSignal, 'timeout').mockReturnValue(
      timeout.signal,
    )
    spyOn(globalThis, 'setTimeout').mockImplementation(((
      handler: () => unknown,
    ) => {
      handler()
      return 0
    }) as unknown as typeof setTimeout)
    spyOn(globalThis, 'fetch').mockImplementation(((_input, init) => {
      attempts++
      if (attempts === 1) {
        expect(init?.signal).toBe(timeout.signal)
        return new Promise((_resolve, reject) => {
          init?.signal?.addEventListener(
            'abort',
            () => reject(init.signal?.reason),
            { once: true },
          )
          timeout.abort(
            new DOMException('The operation timed out', 'TimeoutError'),
          )
        })
      }
      return Promise.resolve(
        Response.json({
          refresh_token: 'new-refresh',
          access_token: 'new-access',
          expires_in: 3600,
        }),
      )
    }) as typeof fetch)

    const result = await refreshToken('old-refresh')

    expect(result).toEqual({ type: 'failed', status: 0 })
    expect(attempts).toBe(1)
    expect(timeoutSpy).toHaveBeenCalledWith(30_000)
  })

  test('does not retry when token response body streaming times out', async () => {
    let attempts = 0
    const timeout = new AbortController()
    spyOn(AbortSignal, 'timeout').mockReturnValue(timeout.signal)
    spyOn(globalThis, 'setTimeout').mockImplementation(((
      handler: () => unknown,
    ) => {
      handler()
      return 0
    }) as unknown as typeof setTimeout)
    spyOn(globalThis, 'fetch').mockImplementation(((_input, init) => {
      attempts++
      if (attempts === 1) {
        const body = new ReadableStream({
          start(controller) {
            init?.signal?.addEventListener(
              'abort',
              () => controller.error(init.signal?.reason),
              { once: true },
            )
            queueMicrotask(() =>
              timeout.abort(
                new DOMException('The operation timed out', 'TimeoutError'),
              ),
            )
          },
        })
        return Promise.resolve(new Response(body, { status: 200 }))
      }
      return Promise.resolve(
        Response.json({
          refresh_token: 'new-refresh',
          access_token: 'new-access',
          expires_in: 3600,
        }),
      )
    }) as typeof fetch)

    const result = await refreshToken('old-refresh')

    expect(result).toEqual({ type: 'failed', status: 0 })
    expect(attempts).toBe(1)
  })

  test('does not retry a terminated token response body', async () => {
    let attempts = 0
    spyOn(globalThis, 'setTimeout').mockImplementation(((
      handler: () => unknown,
    ) => {
      handler()
      return 0
    }) as unknown as typeof setTimeout)
    spyOn(globalThis, 'fetch').mockImplementation((() => {
      attempts++
      if (attempts === 1) {
        return Promise.resolve(
          new Response(
            new ReadableStream({
              start(controller) {
                controller.error(new TypeError('terminated'))
              },
            }),
            { status: 200 },
          ),
        )
      }
      return Promise.resolve(
        Response.json({
          refresh_token: 'new-refresh',
          access_token: 'new-access',
          expires_in: 3600,
        }),
      )
    }) as unknown as typeof fetch)

    const result = await refreshToken('old-refresh')

    expect(result).toEqual({ type: 'failed', status: 0 })
    expect(attempts).toBe(1)
  })
})

describe('isUndeliveredNetworkError', () => {
  const err = (code: string | undefined, cause?: unknown, name = 'Error') =>
    Object.assign(
      new Error(code ?? 'x'),
      { name },
      code ? { code } : {},
      cause ? { cause } : {},
    )

  test('accepts a chain that only says "never sent"', () => {
    expect(isUndeliveredNetworkError(err(undefined, err('ECONNREFUSED')))).toBe(
      true,
    )
    expect(isUndeliveredNetworkError(err('ENOTFOUND'))).toBe(true)
  })

  test('refuses when any level of the chain is ambiguous', () => {
    expect(
      isUndeliveredNetworkError(err('ECONNRESET', err('ECONNREFUSED'))),
    ).toBe(false)
    expect(
      isUndeliveredNetworkError(err('ECONNREFUSED', err('UND_ERR_SOCKET'))),
    ).toBe(false)
    expect(
      isUndeliveredNetworkError(
        err(undefined, err('ECONNREFUSED'), 'TimeoutError'),
      ),
    ).toBe(false)
    expect(isUndeliveredNetworkError(err(undefined))).toBe(false)
  })
})
