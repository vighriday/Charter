import { describe, it, expect, vi } from 'vitest'
import { groqProvider, parseDuration, limitScope, retryAfterMs, type Fetcher } from '../src/model/groq.js'
import { Router, mayReceive } from '../src/model/router.js'
import {
  ContextTooLarge,
  MalformedReply,
  ProviderDown,
  RateLimited,
  type TurnRequest,
} from '../src/model/types.js'

/** A stand-in for the network. Nothing in this file ever reaches Groq. */
function reply(body: unknown, status = 200, headers: Record<string, string> = {}): Fetcher {
  return async () =>
    new Response(typeof body === 'string' ? body : JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json', ...headers },
    })
}

const provider = (fetcher: Fetcher) =>
  groqProvider({ apiKey: 'not-a-real-key', model: 'qwen/qwen3.8-27b', fetcher })

/** A reply holding one tool call, in the shape this service actually returns. */
const calls = (name: string, args: string) => ({
  choices: [
    {
      message: { role: 'assistant', content: null, tool_calls: [{ id: 'c1', type: 'function', function: { name, arguments: args } }] },
      finish_reason: 'tool_calls',
    },
  ],
  usage: { prompt_tokens: 90, completion_tokens: 12 },
})

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
  it('keeps nothing and learns nothing, which is the only reason it may see a person\'s details', () => {
    // Not documentation. These two lines are the whole eligibility rule, and the
    // test below proves the router acts on them.
    const p = provider(reply({}))
    expect(p.capabilities.retainsInput).toBe(false)
    expect(p.capabilities.trainsOnInput).toBe(false)
  })

  it('is actually allowed a request carrying a person\'s details', () => {
    expect(mayReceive(provider(reply({})), 'personal').allowed).toBe(true)
  })

  it('admits its servers will NOT enforce the tool list', () => {
    // The honest false. The compensation is tested further down.
    expect(provider(reply({})).capabilities.allowedToolsServerSide).toBe(false)
  })

  it('reports the limit that actually binds, not the model\'s context window', () => {
    // Eight thousand tokens a minute on the free plan. A request larger than that
    // does not become slow, it becomes impossible.
    expect(provider(reply({})).capabilities.maxRequestTokens).toBe(8000)
  })

  it('names itself so a route can point at it', () => {
    expect(provider(reply({})).id).toBe('groq:qwen/qwen3.8-27b')
  })
})

describe('the tool list, enforced here because nobody else will', () => {
  it('refuses a tool that was never offered', async () => {
    // The reason this check exists: another free model on this same service is
    // known to call tools that were not in the request. Google's servers block
    // that; this one does not, so we do.
    const p = provider(reply(calls('sign_document', '{}')))
    await expect(p.turn(request)).rejects.toBeInstanceOf(MalformedReply)
    await expect(p.turn(request)).rejects.toThrow(/was not offered in this request/)
  })

  it('names what WAS offered, so the failure is diagnosable', async () => {
    const p = provider(reply(calls('sign_document', '{}')))
    await expect(p.turn(request)).rejects.toThrow(/ask_question, report_missing_fields/)
  })

  it('accepts a tool that was offered', async () => {
    const p = provider(reply(calls('ask_question', '{"question":"who owns it?"}')))
    const result = await p.turn(request)
    expect(result.kind).toBe('tool_call')
    if (result.kind === 'tool_call') expect(result.name).toBe('ask_question')
  })

  it('sends only this stage\'s tools', async () => {
    const fetcher = vi.fn<Fetcher>(reply(calls('ask_question', '{}')))
    await provider(fetcher).turn(request)

    const body = JSON.parse(String(fetcher.mock.calls[0]![1].body))
    expect(body.tools.map((t: { function: { name: string } }) => t.function.name)).toEqual([
      'ask_question',
      'report_missing_fields',
    ])
    expect(body.model).toBe('qwen/qwen3.8-27b')
  })

  it('forces a choice when the stage must act, and allows declining when it may not', async () => {
    const fetcher = vi.fn<Fetcher>(reply(calls('ask_question', '{}')))

    await provider(fetcher).turn(request)
    expect(JSON.parse(String(fetcher.mock.calls[0]![1].body)).tool_choice).toBe('required')

    await provider(fetcher).turn({ ...request, toolChoice: 'auto' })
    expect(JSON.parse(String(fetcher.mock.calls[1]![1].body)).tool_choice).toBe('auto')
  })

  it('sends no tool fields at all when the stage offers nothing', async () => {
    // An empty list is refused outright by this service, and an empty list is not
    // the same thing as no list. The stage with no tools sends neither field.
    const fetcher = vi.fn<Fetcher>(reply({ choices: [{ message: { content: 'nothing to do' }, finish_reason: 'stop' }] }))
    await provider(fetcher).turn({ ...request, tools: [], toolChoice: 'auto' })

    const body = JSON.parse(String(fetcher.mock.calls[0]![1].body))
    expect(body).not.toHaveProperty('tools')
    expect(body).not.toHaveProperty('tool_choice')
  })

  it('sends the key as a bearer token rather than in the address', async () => {
    // Addresses end up in logs and proxies. Keys should not.
    const fetcher = vi.fn<Fetcher>(reply(calls('ask_question', '{}')))
    await provider(fetcher).turn(request)

    expect(fetcher.mock.calls[0]![0]).not.toContain('not-a-real-key')
    expect((fetcher.mock.calls[0]![1].headers as Record<string, string>)['authorization']).toBe(
      'Bearer not-a-real-key',
    )
  })
})

describe('reading the arguments, which arrive as text rather than as data', () => {
  it('parses the arguments into real values', async () => {
    // The one shape difference from the other provider that would quietly corrupt
    // the record if it were missed: the fingerprint of the TEXT {"a":1} is not the
    // fingerprint of the DATA it describes.
    const p = provider(reply(calls('ask_question', '{"question":"who owns it?","urgent":true}')))
    const result = await p.turn(request)
    if (result.kind !== 'tool_call') throw new Error('expected a tool call')
    expect(result.args).toEqual({ question: 'who owns it?', urgent: true })
    expect(typeof result.args['urgent']).toBe('boolean')
  })

  it('treats missing and empty arguments as no arguments', async () => {
    for (const args of ['', '{}']) {
      const result = await provider(reply(calls('ask_question', args))).turn(request)
      if (result.kind !== 'tool_call') throw new Error('expected a tool call')
      expect(result.args).toEqual({})
    }
  })

  it('complains when the arguments are not valid JSON', async () => {
    const p = provider(reply(calls('ask_question', '{"question": ')))
    await expect(p.turn(request)).rejects.toBeInstanceOf(MalformedReply)
    await expect(p.turn(request)).rejects.toThrow(/did not parse/)
  })

  it('complains when the arguments parse but are not a set of named values', async () => {
    // A list or a number would pass a naive JSON.parse and then be recorded as if
    // it were a filled-in tool call.
    await expect(provider(reply(calls('ask_question', '[1,2]'))).turn(request)).rejects.toThrow(/a list/)
    await expect(provider(reply(calls('ask_question', '7'))).turn(request)).rejects.toThrow(/number/)
    await expect(provider(reply(calls('ask_question', 'null'))).turn(request)).rejects.toBeInstanceOf(
      MalformedReply,
    )
  })

  it('complains about a tool call with no name', async () => {
    const p = provider(
      reply({ choices: [{ message: { tool_calls: [{ function: { arguments: '{}' } }] }, finish_reason: 'tool_calls' }] }),
    )
    await expect(p.turn(request)).rejects.toThrow(/no name/)
  })

  it('reports what the turn cost', async () => {
    const result = await provider(reply(calls('ask_question', '{}'))).turn(request)
    expect(result.usage).toEqual({ inputTokens: 90, outputTokens: 12 })
  })
})

describe('keeping the reply exactly as it arrived', () => {
  it('keeps the whole message, including anything this adapter does not read', async () => {
    // Some models return their private reasoning alongside the answer. Summarising
    // a turn into our own shape destroys it silently.
    const message = {
      role: 'assistant',
      content: null,
      reasoning: 'private working we must not touch',
      tool_calls: [{ id: 'c1', type: 'function', function: { name: 'ask_question', arguments: '{}' } }],
    }
    const result = await provider(reply({ choices: [{ message, finish_reason: 'tool_calls' }] })).turn(request)
    expect(result.raw).toEqual(message)
  })

  it('keeps a second tool call in the record even though only the first is acted on', async () => {
    const message = {
      role: 'assistant',
      tool_calls: [
        { function: { name: 'ask_question', arguments: '{"n":1}' } },
        { function: { name: 'report_missing_fields', arguments: '{"n":2}' } },
      ],
    }
    const result = await provider(reply({ choices: [{ message, finish_reason: 'tool_calls' }] })).turn(request)
    if (result.kind !== 'tool_call') throw new Error('expected a tool call')
    expect(result.name).toBe('ask_question')
    expect(JSON.stringify(result.raw)).toContain('report_missing_fields')
  })
})

describe('answers that are text, or that stop early', () => {
  it('accepts plain text when the stage was allowed to decline', async () => {
    const p = provider(reply({ choices: [{ message: { content: 'there is nothing left to ask' }, finish_reason: 'stop' }] }))
    const result = await p.turn({ ...request, toolChoice: 'auto' })
    expect(result.kind).toBe('text')
    if (result.kind === 'text') expect(result.text).toBe('there is nothing left to ask')
  })

  it('complains when a tool call was required and nothing came back', async () => {
    const p = provider(reply({ choices: [{ message: { content: '' }, finish_reason: 'stop' }] }))
    await expect(p.turn(request)).rejects.toBeInstanceOf(MalformedReply)
  })

  it('complains when the answer was cut off, rather than reading the fragment', async () => {
    // A half-written answer parses as far as it goes and is wrong past that point.
    // Silently keeping the fragment is the worst available outcome.
    const p = provider(reply({ choices: [{ message: { content: 'the owners are Ma' }, finish_reason: 'length' }] }))
    await expect(p.turn({ ...request, toolChoice: 'auto' })).rejects.toThrow(/cut off/)
  })
})

describe('when things go wrong', () => {
  it('turns a spent allowance into something the router understands', async () => {
    const p = provider(reply('{"error":{"message":"Rate limit reached"}}', 429))
    await expect(p.turn(request)).rejects.toBeInstanceOf(RateLimited)
  })

  it('reads which limit was hit from the words this service actually uses', () => {
    const body = (what: string) =>
      `Rate limit reached for model \`qwen/qwen3.8-27b\` in organization \`org_x\` on ${what}: Limit 8000, Used 8000, Requested 200.`

    expect(limitScope(body('tokens per minute (TPM)'))).toBe('tokens-per-minute')
    expect(limitScope(body('tokens per day (TPD)'))).toBe('tokens-per-day')
    expect(limitScope(body('requests per day (RPD)'))).toBe('requests-per-day')
    expect(limitScope(body('requests per minute (RPM)'))).toBe('requests-per-minute')
    expect(limitScope('too many requests')).toBe('unknown')
  })

  it('prefers what the service actually asks for', async () => {
    const p = provider(reply('slow down', 429, { 'retry-after': '17' }))
    await expect(p.turn(request)).rejects.toMatchObject({ retryAfterMs: 17_000 })
  })

  it('falls back to the reset header for the limit that was hit', async () => {
    const tokens = provider(
      reply('on tokens per minute (TPM)', 429, {
        'x-ratelimit-reset-tokens': '7.66s',
        'x-ratelimit-reset-requests': '2m59.56s',
      }),
    )
    await expect(tokens.turn(request)).rejects.toMatchObject({ retryAfterMs: 7_660 })

    const requests = provider(
      reply('on requests per minute (RPM)', 429, {
        'x-ratelimit-reset-tokens': '7.66s',
        'x-ratelimit-reset-requests': '2m59.56s',
      }),
    )
    await expect(requests.turn(request)).rejects.toMatchObject({ retryAfterMs: 179_560 })
  })

  it('falls back to the wait named in the words', async () => {
    const p = provider(reply('on tokens per minute (TPM): Limit 8000. Please try again in 7.66s. Visit console.', 429))
    await expect(p.turn(request)).rejects.toMatchObject({ retryAfterMs: 7_660 })
  })

  it('does not retry a spent daily allowance in a minute', async () => {
    const p = provider(reply('on requests per day (RPD): Limit 1000, Used 1000.', 429))
    await expect(p.turn(request)).rejects.toMatchObject({
      scope: 'requests-per-day',
      retryAfterMs: 3_600_000,
    })
  })

  it('says nothing rather than guessing when no wait can be worked out', async () => {
    const p = provider(reply('on tokens per minute (TPM)', 429))
    await expect(p.turn(request)).rejects.toMatchObject({ retryAfterMs: undefined })
  })

  it('treats a server fault as the provider being unavailable', async () => {
    await expect(provider(reply({}, 503)).turn(request)).rejects.toBeInstanceOf(ProviderDown)
  })

  it('treats a refused request as unavailable, and keeps the reason', async () => {
    const p = provider(reply('{"error":{"message":"Invalid API Key"}}', 401))
    await expect(p.turn(request)).rejects.toThrow(/Invalid API Key/)
  })

  it('calls a request that is simply too big what it is, rather than blaming the service', async () => {
    // Different failures need different answers. "Unavailable" would send the same
    // doomed request round every other provider in the list.
    const p = provider(reply('{"error":{"code":"context_length_exceeded","message":"Please reduce the length"}}', 400))
    await expect(p.turn(request)).rejects.toBeInstanceOf(ContextTooLarge)
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

describe('reading a length of time the way this service writes it', () => {
  it('understands each unit', () => {
    expect(parseDuration('500ms')).toBe(500)
    expect(parseDuration('7.66s')).toBe(7_660)
    expect(parseDuration('3m')).toBe(180_000)
    expect(parseDuration('1h')).toBe(3_600_000)
  })

  it('adds the units up rather than reading only the first', () => {
    // The bug this prevents: reading "2m59.56s" as the number 2 and setting a
    // spent provider aside for two milliseconds.
    expect(parseDuration('2m59.56s')).toBe(179_560)
    expect(parseDuration('1h2m3s')).toBe(3_723_000)
  })

  it('tolerates spaces between the parts', () => {
    expect(parseDuration('2m 59.56s')).toBe(179_560)
  })

  it('says nothing rather than guessing at text that is not a length of time', () => {
    expect(parseDuration('soon')).toBeUndefined()
    expect(parseDuration('')).toBeUndefined()
    expect(parseDuration('soon-ish 5s')).toBeUndefined()
  })

  it('reads a plain number of seconds in retry-after, which is what that header means', () => {
    const headers = new Headers({ 'retry-after': '2' })
    expect(retryAfterMs(headers, 'tokens-per-minute', '')).toBe(2000)
  })
})

describe('asking for data in a given shape', () => {
  const ask = { sensitivity: 'public' as const, text: 'two sisters', schema: { type: 'object' }, instruction: 'how many owners?' }

  it('parses the answer', async () => {
    const p = provider(reply({ choices: [{ message: { content: '{"members":2}' }, finish_reason: 'stop' }] }))
    expect(await p.extract(ask)).toEqual({ members: 2 })
  })

  it('asks for the strict shape first', async () => {
    const fetcher = vi.fn<Fetcher>(reply({ choices: [{ message: { content: '{"members":2}' } }] }))
    await provider(fetcher).extract(ask)

    const body = JSON.parse(String(fetcher.mock.calls[0]![1].body))
    expect(body.response_format.type).toBe('json_schema')
    expect(body.response_format.json_schema.strict).toBe(true)
  })

  it('falls back to putting the shape in the words when the strict way is refused', async () => {
    // Support for the strict way varies by model on this service. Falling back
    // beats failing, and the answer is still checked by parsing it.
    let call = 0
    const fetcher = vi.fn<Fetcher>(async () => {
      call++
      if (call === 1) {
        return new Response('{"error":{"message":"response_format json_schema is not supported for this model"}}', {
          status: 400,
          headers: { 'content-type': 'application/json' },
        })
      }
      return new Response(JSON.stringify({ choices: [{ message: { content: '{"members":2}' } }] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    })

    expect(await provider(fetcher).extract(ask)).toEqual({ members: 2 })
    expect(fetcher).toHaveBeenCalledTimes(2)

    const second = JSON.parse(String(fetcher.mock.calls[1]![1].body))
    expect(second.response_format).toEqual({ type: 'json_object' })
    // The shape has to travel somewhere, so it travels in the words.
    expect(second.messages[0].content).toContain('"type":"object"')
  })

  it('does NOT spend a second request when the first failed for any other reason', async () => {
    // A spent allowance is not a refusal of the way we asked. Retrying it would
    // buy the same answer for twice the cost.
    const fetcher = vi.fn<Fetcher>(reply('on requests per day (RPD)', 429))
    await expect(provider(fetcher).extract(ask)).rejects.toBeInstanceOf(RateLimited)
    expect(fetcher).toHaveBeenCalledTimes(1)
  })

  it('complains when the answer does not parse', async () => {
    const p = provider(reply({ choices: [{ message: { content: 'not json at all' }, finish_reason: 'stop' }] }))
    await expect(p.extract(ask)).rejects.toBeInstanceOf(MalformedReply)
  })

  it('complains when the answer was cut off', async () => {
    const p = provider(reply({ choices: [{ message: { content: '{"members":' }, finish_reason: 'length' }] }))
    await expect(p.extract(ask)).rejects.toThrow(/cut off/)
  })
})

describe('standing in for the primary provider', () => {
  it('answers when the one that learns from its input is not allowed to', async () => {
    // The two providers together, doing the thing the routing table exists for:
    // a request carrying a person's details skips the ineligible model entirely
    // and is answered by this one.
    const learns = {
      id: 'gemini:free',
      capabilities: {
        forcedToolChoice: true,
        allowedToolsServerSide: true,
        schemaWithTools: false,
        maxRequestTokens: 1_000_000,
        retainsInput: true,
        trainsOnInput: true,
      },
      turn: async () => {
        throw new Error('should never be called')
      },
      extract: async () => ({}),
    }

    const attempts: string[] = []
    const router = new Router({
      providers: [learns, provider(reply(calls('ask_question', '{"question":"is this your passport?"}')))],
      routes: { verify: ['gemini:free', 'groq:qwen/qwen3.8-27b'] },
      fallback: [],
      onAttempt: (a) => attempts.push(`${a.providerId}:${a.outcome}`),
    })

    const result = await router.turn({ ...request, stage: 'verify', sensitivity: 'personal' })
    expect(result.providerId).toBe('groq:qwen/qwen3.8-27b')
    expect(attempts).toEqual(['gemini:free:skipped-sensitivity', 'groq:qwen/qwen3.8-27b:answered'])
  })
})
