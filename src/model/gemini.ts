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

/**
 * What Google's servers accept inside a tool's argument description.
 *
 * WHY THIS LIST EXISTS
 *
 * Google does not take a whole JSON Schema. It takes a small named subset, and it
 * refuses the entire request — with a 400 and no partial success — when it meets a
 * single field it has not heard of. It does not ignore the field. It does not warn.
 * The whole call fails.
 *
 * That is exactly what happened on the first real run of this project. Every tool
 * Charter has is described with `additionalProperties: false`, which is how a
 * schema says "no arguments beyond these ones". Google has no such field, so every
 * request to every Gemini model was refused, on every turn, from the first one. The
 * router did what it is built to do and fell through to the fallback provider, the
 * fallback ran the whole thing on its own, and about five turns later it hit its
 * own limit and the run stopped. Nothing in the output said the word Google.
 *
 * WHAT IS LOST BY DROPPING THOSE FIELDS, AND WHY IT IS NOTHING
 *
 * `additionalProperties: false` is a rule about what the model may send. Charter
 * checks every set of arguments against the full schema itself, before a tool runs,
 * and refuses anything extra. So the rule is kept where it has to be kept — on our
 * side, where a refusal can be recorded — and is simply not repeated to a server
 * that has no word for it.
 *
 * The list is from Google's own published Schema type. Anything not named here is
 * left out of what is sent, and left untouched everywhere else.
 */
const GOOGLE_UNDERSTANDS: ReadonlySet<string> = new Set([
  'type',
  'format',
  'title',
  'description',
  'nullable',
  'enum',
  'items',
  'properties',
  'required',
  'minItems',
  'maxItems',
  'minLength',
  'maxLength',
  'minimum',
  'maximum',
  'pattern',
  'anyOf',
  'default',
  'example',
])

/**
 * The same argument description, with anything Google has no word for left out.
 *
 * Recursive, because a schema nests: the offending field was on the top level of
 * every tool and would also appear inside any nested object.
 */
export function asGoogleSchema(schema: JsonValue): JsonValue {
  if (Array.isArray(schema)) return schema.map((one) => asGoogleSchema(one)) as JsonValue

  if (schema === null || typeof schema !== 'object') return schema

  const kept: Record<string, JsonValue> = {}
  for (const [key, value] of Object.entries(schema as JsonObject)) {
    if (!GOOGLE_UNDERSTANDS.has(key)) continue
    // `properties` is a map of names to schemas, not a schema itself, so its
    // values are converted and its keys are left exactly as they are.
    kept[key] =
      key === 'properties' && value !== null && typeof value === 'object' && !Array.isArray(value)
        ? (Object.fromEntries(
            Object.entries(value as JsonObject).map(([name, one]) => [name, asGoogleSchema(one)]),
          ) as JsonValue)
        : asGoogleSchema(value as JsonValue)
  }
  return kept as JsonValue
}

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
              // Not the schema as written. See asGoogleSchema above: one field
              // Google has never heard of fails the whole request.
              parameters: asGoogleSchema(tool.parameters as JsonValue),
            })),
          },
        ],
        toolConfig: {
          functionCallingConfig: {
            // ANY forces a tool call. AUTO lets the model decline, which only the
            // stage that must be able to say "nothing left to do" ever needs.
            //
            // The list of allowed names is sent ONLY with ANY, because Google
            // refuses the whole request otherwise: "Please set
            // allowed_function_names only when function calling mode is ANY." That
            // is a 400 on every turn of every stage that lets the model decline,
            // and it is how the first real run of this project spent its whole
            // first step on the fallback provider without ever saying why.
            //
            // So on the stages that force a call, their servers enforce the list
            // and the promise is theirs. On the one stage that does not, the
            // promise is ours alone: a tool the stage was never given is refused
            // before it runs, in src/tools/registry.ts, and the refusal is
            // recorded. Worth being exact about which of those two is happening.
            ...(request.toolChoice === 'required'
              ? { mode: 'ANY', allowedFunctionNames: request.tools.map((t) => t.name) }
              : { mode: 'AUTO' }),
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
          // Same subset, same reason. A shape Google cannot read fails the whole
          // request, and this is the call whose entire point is a forced shape.
          responseSchema: asGoogleSchema(request.schema as JsonValue),
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
