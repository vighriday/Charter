import { describe, it, expect, vi } from 'vitest'
import { geminiProvider, type Fetcher } from '../src/model/gemini.js'
import { RateLimited, ProviderDown, MalformedReply, type TurnRequest } from '../src/model/types.js'

/** A stand-in for the network. Nothing in this file ever reaches Google. */
function reply(body: unknown, status = 200, headers: Record<string, string> = {}): Fetcher {
  return async () =>
    new Response(typeof body === 'string' ? body : JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json', ...headers },
    })
}

const provider = (fetcher: Fetcher) =>
  geminiProvider({ apiKey: 'not-a-real-key', model: 'gemini-3.5-flash-lite', fetcher })

const request: TurnRequest = {
  stage: 'understand',
  sensitivity: 'public',
  situation: 'Two sisters run a bakery.',
  history: [],
  tools: [
    { name: 'ask_question', description: 'ask one thing', parameters: { type: 'object' } },
    { name: 'report_missing_fields', description: 'list what is missing', parameters: { type: 'object' } },
  ],
  toolChoice: 'required',
}

describe('what it declares about itself', () => {
  it('says it learns from what it is sent, which is what keeps personal data away', () => {
    // Not documentation. This is the mechanism: the router reads these two and
    // refuses to send anything personal to a provider where either is true.
    const p = provider(reply({}))
    expect(p.capabilities.trainsOnInput).toBe(true)
    expect(p.capabilities.retainsInput).toBe(true)
  })

  it('says its servers can enforce the tool list', () => {
    expect(provider(reply({})).capabilities.allowedToolsServerSide).toBe(true)
  })

  it('names itself so a route can point at it', () => {
    expect(provider(reply({})).id).toBe('gemini:gemini-3.5-flash-lite')
  })
})

describe('asking for a turn', () => {
  it('reads back a tool call', async () => {
    const p = provider(
      reply({
        candidates: [
          {
            content: {
              role: 'model',
              parts: [{ functionCall: { name: 'ask_question', args: { question: 'who owns it?' } } }],
            },
          },
        ],
        usageMetadata: { promptTokenCount: 120, candidatesTokenCount: 18 },
      }),
    )

    const result = await p.turn(request)
    expect(result.kind).toBe('tool_call')
    if (result.kind === 'tool_call') {
      expect(result.name).toBe('ask_question')
      expect(result.args).toEqual({ question: 'who owns it?' })
      expect(result.usage).toEqual({ inputTokens: 120, outputTokens: 18 })
    }
  })

  it('keeps the reply exactly as it arrived', async () => {
    // Newer models require their private reasoning back byte for byte on the next
    // request. Summarising a turn into our own shape destroys that silently, and
    // the model appears to get worse for no reason anyone can find.
    const content = {
      role: 'model',
      parts: [
        { thoughtSignature: 'opaque-value-we-must-not-touch' },
        { functionCall: { name: 'ask_question', args: {} } },
      ],
    }
    const p = provider(reply({ candidates: [{ content }] }))

    const result = await p.turn(request)
    expect(result.raw).toEqual(content)
  })

  it('sends only this stage\'s tools, and asks their servers to enforce the list', async () => {
    const fetcher = vi.fn<Fetcher>(async () =>
      new Response(JSON.stringify({ candidates: [{ content: { parts: [{ functionCall: { name: 'ask_question' } }] } }] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    )

    await provider(fetcher).turn(request)

    const body = JSON.parse(String(fetcher.mock.calls[0]![1].body))
    expect(body.tools[0].functionDeclarations.map((d: { name: string }) => d.name)).toEqual([
      'ask_question',
      'report_missing_fields',
    ])
    expect(body.toolConfig.functionCallingConfig.allowedFunctionNames).toEqual([
      'ask_question',
      'report_missing_fields',
    ])
  })

  it('forces a choice when the stage must act, and allows declining when it may not', async () => {
    const fetcher = vi.fn<Fetcher>(async () =>
      new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: 'nothing left' }] } }] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    )

    await provider(fetcher).turn(request)
    expect(JSON.parse(String(fetcher.mock.calls[0]![1].body)).toolConfig.functionCallingConfig.mode).toBe('ANY')

    await provider(fetcher).turn({ ...request, toolChoice: 'auto' })
    expect(JSON.parse(String(fetcher.mock.calls[1]![1].body)).toolConfig.functionCallingConfig.mode).toBe('AUTO')
  })

  it('accepts plain text when the stage was allowed to decline', async () => {
    const p = provider(reply({ candidates: [{ content: { parts: [{ text: 'there is nothing left to ask' }] } }] }))
    const result = await p.turn({ ...request, toolChoice: 'auto' })
    expect(result.kind).toBe('text')
    if (result.kind === 'text') expect(result.text).toBe('there is nothing left to ask')
  })

  it('complains when a tool call was required and nothing came back', async () => {
    const p = provider(reply({ candidates: [{ content: { parts: [] } }] }))
    await expect(p.turn(request)).rejects.toBeInstanceOf(MalformedReply)
  })
})

describe('when things go wrong', () => {
  it('turns a spent allowance into something the router understands', async () => {
    const p = provider(reply('{"error":{"message":"Quota exceeded per day"}}', 429))
    await expect(p.turn(request)).rejects.toBeInstanceOf(RateLimited)
  })

  it('works out which limit was hit, so it knows how long to wait', async () => {
    const daily = provider(reply('quota exceeded: requests per day', 429))
    await expect(daily.turn(request)).rejects.toMatchObject({
      scope: 'requests-per-day',
      // A spent daily allowance does not return for hours. Retrying in a minute
      // would just waste the minute.
      retryAfterMs: 3_600_000,
    })

    const minute = provider(reply('quota exceeded: requests per minute', 429))
    await expect(minute.turn(request)).rejects.toMatchObject({ scope: 'requests-per-minute' })
  })

  it('says unknown rather than guessing, when the limit is not named', async () => {
    const p = provider(reply('too many requests', 429))
    await expect(p.turn(request)).rejects.toMatchObject({ scope: 'unknown' })
  })

  it('prefers what the provider actually says about waiting', async () => {
    const p = provider(reply('slow down', 429, { 'retry-after': '17' }))
    await expect(p.turn(request)).rejects.toMatchObject({ retryAfterMs: 17_000 })
  })

  it('treats a server fault as the provider being unavailable', async () => {
    await expect(provider(reply({}, 503)).turn(request)).rejects.toBeInstanceOf(ProviderDown)
  })

  it('treats a refused request as unavailable, and keeps the reason', async () => {
    const p = provider(reply('{"error":{"message":"API key not valid"}}', 400))
    await expect(p.turn(request)).rejects.toThrow(/API key not valid/)
  })

  it('turns an unreachable network into something the router can move past', async () => {
    const p = provider(async () => {
      throw new Error('getaddrinfo ENOTFOUND')
    })
    await expect(p.turn(request)).rejects.toBeInstanceOf(ProviderDown)
  })

  it('complains rather than crashing when the reply is not JSON', async () => {
    const p = provider(async () => new Response('<html>gateway</html>', { status: 200 }))
    await expect(p.turn(request)).rejects.toBeInstanceOf(MalformedReply)
  })
})

describe('asking for data in a given shape', () => {
  it('parses the answer', async () => {
    const p = provider(reply({ candidates: [{ content: { parts: [{ text: '{"members":2}' }] } }] }))
    const value = await p.extract({
      sensitivity: 'public',
      text: 'two sisters',
      schema: { type: 'object' },
      instruction: 'how many owners?',
    })
    expect(value).toEqual({ members: 2 })
  })

  it('complains when the answer does not parse', async () => {
    const p = provider(reply({ candidates: [{ content: { parts: [{ text: 'not json at all' }] } }] }))
    await expect(
      p.extract({ sensitivity: 'public', text: 'x', schema: { type: 'object' }, instruction: 'y' }),
    ).rejects.toBeInstanceOf(MalformedReply)
  })
})
