import { describe, expect, test } from 'bun:test'
import {
  BodyLimitError,
  contentLength,
  InvalidUtf8Error,
  readBoundedText,
} from '../bounded'

const encoder = new TextEncoder()

function body(chunks: Uint8Array[]): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(chunk)
      controller.close()
    },
  })
}

describe('contentLength', () => {
  test('accepts safe decimal lengths only', () => {
    expect(contentLength(new Headers({ 'content-length': '42' }))).toBe(42)
    expect(
      contentLength(new Headers({ 'content-length': '-1' })),
    ).toBeUndefined()
    expect(
      contentLength(new Headers({ 'content-length': '1.5' })),
    ).toBeUndefined()
    expect(contentLength(new Headers())).toBeUndefined()
  })
})

describe('readBoundedText', () => {
  test('decodes UTF-8 split across chunks', async () => {
    const bytes = encoder.encode('Привет 🚀')
    expect(
      await readBoundedText(
        body([bytes.slice(0, 3), bytes.slice(3, 11), bytes.slice(11)]),
        bytes.byteLength,
        'test body',
      ),
    ).toBe('Привет 🚀')
  })

  test('rejects a chunked body above the byte limit', async () => {
    await expect(
      readBoundedText(
        body([encoder.encode('123'), encoder.encode('45')]),
        4,
        'test body',
      ),
    ).rejects.toEqual(new BodyLimitError('test body', 4))
  })

  test('rejects malformed UTF-8', async () => {
    await expect(
      readBoundedText(body([Uint8Array.of(0xc3, 0x28)]), 10, 'test body'),
    ).rejects.toEqual(new InvalidUtf8Error('test body'))
  })

  test('cancels the source after malformed UTF-8', async () => {
    let cancelled = false
    const malformed = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(Uint8Array.of(0xc3, 0x28))
      },
      cancel() {
        cancelled = true
      },
    })

    await expect(readBoundedText(malformed, 10, 'test body')).rejects.toEqual(
      new InvalidUtf8Error('test body'),
    )
    expect(cancelled).toBe(true)
  })

  // A cloned body is one branch of a tee: its cancel() settles only once the
  // other branch is cancelled or the source ends, so it must never be awaited.
  describe('on a cloned body whose other branch is not being read', () => {
    function pulled(chunks: Uint8Array[]): ReadableStream<Uint8Array> {
      let index = 0
      return new ReadableStream({
        pull(controller) {
          const chunk = chunks[index++]
          if (chunk) controller.enqueue(chunk)
          else controller.close()
        },
      })
    }
    const settled = <T>(read: Promise<T>) =>
      Promise.race([
        read.then(
          () => 'resolved',
          (error: unknown) => error,
        ),
        new Promise((resolve) => setTimeout(() => resolve('hung'), 1000)),
      ])

    test('rejects an oversized body instead of hanging', async () => {
      const response = new Response(
        pulled([encoder.encode('123'), encoder.encode('45'), encoder.encode('6')]),
      )
      expect(
        await settled(readBoundedText(response.clone().body, 4, 'test body')),
      ).toEqual(new BodyLimitError('test body', 4))
      // The original is untouched and still readable.
      expect(await response.text()).toBe('123456')
    })

    test('rejects malformed UTF-8 instead of hanging', async () => {
      const response = new Response(
        pulled([Uint8Array.of(0xc3, 0x28), encoder.encode('rest')]),
      )
      expect(
        await settled(readBoundedText(response.clone().body, 10, 'test body')),
      ).toEqual(new InvalidUtf8Error('test body'))
    })
  })
})
