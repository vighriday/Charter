/**
 * Google's Gemini, called through its plain web interface.
 *
 * No software kit is installed. About eighty lines, no hidden state between
 * calls, and swapping providers stays a configuration change. There is also an
 * acknowledged bug in Google's own kit where tools from one call leak into the
 * next and a later request comes back with an unexpected tool call — avoided
 * entirely by not using it.
 *
 * WHAT THIS PROVIDER IS GOOD AT, AND THE ONE THING IT MUST NOT SEE
 *
 * It is the only free option whose servers will enforce, per request, the exact
 * list of tool names the model may call. For a system whose whole design is "only
 * this stage's tools exist right now", that turns a hope into a guarantee made by
 * somebody else's server.
 *
 * But its free tier LEARNS FROM WHAT IT IS SENT, and Google's own terms warn:
 * "Do not submit sensitive, confidential, or personal information to the Unpaid
 * Services." So `trainsOnInput` and `retainsInput` are both true below, which
 * makes the router structurally unable to send it anything marked as carrying a
 * person's details. That is not a note for a reader — it is the mechanism.
 */

import {
  MalformedReply,
  ProviderDown,
  RateLimited,
  type Capabilities,
  type ExtractRequest,
  type LimitScope,
  type ModelProvider,
  type TurnRequest,
  type TurnResult,
} from './types.js'
import type { JsonObject, JsonValue } from '../record/canonical.js'

const BASE = 'https://generativelanguage.googleapis.com/v1beta'

/** How the network is reached. Passed in so tests never touch it. */
export type Fetcher = (url: string, init: RequestInit) => Promise<Response>

export interface GeminiOptions {
  readonly apiKey: string
  readonly model: string
  readonly fetcher?: Fetcher
  readonly baseUrl?: string
}

interface GeminiPart {
  text?: string
  functionCall?: { name?: string; args?: JsonObject }
  [key: string]: unknown
}

interface GeminiReply {
  candidates?: Array<{ content?: { parts?: GeminiPart[] }; finishReason?: string }>
  usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number }
  error?: { code?: number; message?: string; status?: string }
}

/**
 * Which limit was hit.
 *
 * Google does not always say. Reporting `unknown` honestly is better than
 * guessing, because the guess decides how long the provider is set aside for.
 */
function limitScope(message: string): LimitScope {
  const lower = message.toLowerCase()
  if (lower.includes('per day') || lower.includes('perday') || lower.includes('daily')) {
    return 'requests-per-day'
  }
  if (lower.includes('per minute') || lower.includes('perminute')) return 'requests-per-minute'
  if (lower.includes('token')) return 'tokens-per-minute'
  return 'unknown'
}

function retryAfterMs(response: Response, scope: LimitScope): number | undefined {
  const header = response.headers.get('retry-after')
  if (header) {
    const seconds = Number(header)
    if (Number.isFinite(seconds)) return seconds * 1000
  }
  // A spent daily allowance does not return until midnight Pacific, so there is
  // no point trying again in a minute. An hour is a reasonable stand-in when the
  // provider does not say.
  return scope === 'requests-per-day' ? 3_600_000 : undefined
}

export function geminiProvider(options: GeminiOptions): ModelProvider {
  const fetcher = options.fetcher ?? ((url, init) => fetch(url, init))
  const base = options.baseUrl ?? BASE
  const id = `gemini:${options.model}`

  const capabilities: Capabilities = {
    forcedToolChoice: true,
    allowedToolsServerSide: true,
    schemaWithTools: false,
    // Roughly a million. Our own ceiling binds long before this does.
    maxRequestTokens: 1_048_576,
    // Both true, and this is the whole point. See the note at the top of the file.
    retainsInput: true,
    trainsOnInput: true,
  }

  async function post(path: string, body: unknown): Promise<GeminiReply> {
    let response: Response
    try {
      response = await fetcher(`${base}/${path}?key=${encodeURIComponent(options.apiKey)}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      })
    } catch (error) {
      throw new ProviderDown(id, undefined, `could not reach Google: ${(error as Error).message}`)
    }

    if (response.status === 429) {
      const text = await response.text().catch(() => '')
      const scope = limitScope(text)
      throw new RateLimited(id, scope, retryAfterMs(response, scope), `${id} is out of allowance (${scope})`)
    }
    if (response.status >= 500) {
      throw new ProviderDown(id, response.status, `Google returned ${response.status}`)
    }
    if (!response.ok) {
      const text = await response.text().catch(() => '')
      throw new ProviderDown(id, response.status, `Google refused the request (${response.status}): ${text.slice(0, 300)}`)
    }

    const reply = (await response.json().catch(() => null)) as GeminiReply | null
    if (!reply) throw new MalformedReply(id, 'the reply was not valid JSON')
    if (reply.error) {
      throw new ProviderDown(id, reply.error.code, reply.error.message ?? 'Google reported an error')
    }
    return reply
  }

  function usageOf(reply: GeminiReply) {
    return {
      inputTokens: reply.usageMetadata?.promptTokenCount ?? 0,
      outputTokens: reply.usageMetadata?.candidatesTokenCount ?? 0,
    }
  }

  return {
    id,
    capabilities,

    async turn(request: TurnRequest): Promise<TurnResult> {
      const body = {
        contents: [
          ...(request.history as JsonValue[]),
          { role: 'user', parts: [{ text: request.situation }] },
        ],
        tools: [
          {
            functionDeclarations: request.tools.map((tool) => ({
              name: tool.name,
              description: tool.description,
              parameters: tool.parameters,
            })),
          },
        ],
        toolConfig: {
          functionCallingConfig: {
            // ANY forces a tool call. AUTO lets the model decline, which only the
            // stage that must be able to say "nothing left to do" ever needs.
            mode: request.toolChoice === 'required' ? 'ANY' : 'AUTO',
            // Their servers enforce this list, per request. It is what turns
            // "never invent a tool we did not offer" into somebody else's promise
            // rather than our hope.
            allowedFunctionNames: request.tools.map((t) => t.name),
          },
        },
      }

      const reply = await post(`models/${options.model}:generateContent`, body)
      const parts = reply.candidates?.[0]?.content?.parts ?? []
      // Kept exactly as it arrived. Newer models require their private reasoning
      // sections back byte for byte, and our own record wants the original bytes.
      const raw = (reply.candidates?.[0]?.content ?? {}) as JsonValue

      const call = parts.find((part) => part.functionCall)?.functionCall
      if (call?.name) {
        return { kind: 'tool_call', name: call.name, args: call.args ?? {}, raw, usage: usageOf(reply) }
      }

      const text = parts.map((part) => part.text ?? '').join('').trim()
      if (!text && request.toolChoice === 'required') {
        throw new MalformedReply(
          id,
          'a tool call was required, but the reply contained neither a tool call nor any text',
        )
      }
      return { kind: 'text', text, raw, usage: usageOf(reply) }
    },

    async extract(request: ExtractRequest): Promise<JsonValue> {
      const body = {
        contents: [{ role: 'user', parts: [{ text: `${request.instruction}\n\n${request.text}` }] }],
        generationConfig: {
          responseMimeType: 'application/json',
          responseSchema: request.schema,
        },
      }

      const reply = await post(`models/${options.model}:generateContent`, body)
      const text = (reply.candidates?.[0]?.content?.parts ?? []).map((p) => p.text ?? '').join('')

      try {
        return JSON.parse(text) as JsonValue
      } catch {
        throw new MalformedReply(
          id,
          // Worth saying plainly: a forced shape guarantees the answer parses. It
          // does not guarantee the answer is right. Google's own documentation
          // warns of replies that fit the shape and are wrong, which is why
          // nothing important is decided by this alone.
          `the reply was meant to be JSON in a given shape and did not parse: ${text.slice(0, 200)}`,
        )
      }
    },
  }
}
