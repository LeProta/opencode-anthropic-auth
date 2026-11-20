import { describe, expect, test } from 'bun:test'
import {
  buildBillingHeaderValue,
  computeCCH,
  computeVersionSuffix,
  extractFirstUserMessageText,
  signRequestBody,
} from '../cch'
import vectors from './fixtures/cch-vectors.json'

// CLIProxyAPI 1aaf56b, claude_signing_test.go: independent native compatibility vectors.
test.each(vectors)('final-body signature: $name', ({ body, hash }) => {
  const signed = signRequestBody(body)
  expect(JSON.parse(signed).system[0].text).toContain(`cch=${hash};`)
  expect(signRequestBody(signed)).toBe(signed)
})

test('signs the transformed tools and messages while ignoring dispatch-only changes', () => {
  const body = {
    model: 'claude-model',
    system: [{ type: 'text', text: 'x-anthropic-billing-header: cch=00000;' }],
    messages: [{ role: 'user', content: 'hello' }],
    tools: [{ name: 'mcp_Texample' }],
    max_tokens: 100,
  }
  const signature = (input: unknown) =>
    JSON.parse(signRequestBody(JSON.stringify(input))).system[0].text
  expect(signature({ ...body, model: 'another-model', max_tokens: 200 })).toBe(
    signature(body),
  )
  expect(signature({ ...body, tools: [{ name: 'mcp_Tanother' }] })).not.toBe(
    signature(body),
  )
  expect(
    signature({ ...body, messages: [{ role: 'user', content: 'changed' }] }),
  ).not.toBe(signature(body))
})

describe('billing header helpers', () => {
  test('extracts text from the first user message', () => {
    expect(
      extractFirstUserMessageText([
        { role: 'assistant', content: 'ignore me' },
        {
          role: 'user',
          content: [
            { type: 'image', text: 'ignored' },
            { type: 'text', text: 'hello world test message' },
          ],
        },
      ]),
    ).toBe('hello world test message')
  })

  test('computes the 5-character cch hash', () => {
    expect(computeCCH('hello world test message')).toBe('4ffc3')
  })

  test('computes the 3-character version suffix', () => {
    expect(computeVersionSuffix('hello world test message', '2.1.87')).toBe(
      '6ff',
    )
  })

  test('builds the full billing header value', () => {
    expect(
      buildBillingHeaderValue(
        [{ role: 'user', content: 'hello world test message' }],
        '2.1.87',
        'sdk-cli',
      ),
    ).toBe(
      'x-anthropic-billing-header: cc_version=2.1.87.6ff; cc_entrypoint=sdk-cli; cch=4ffc3;',
    )
  })
})
