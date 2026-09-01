/**
 * Doctavian, the document service that turns a Word template into a finished file.
 *
 * WHAT THIS IS FOR
 *
 * Charter writes an ownership agreement — the document that says who owns what
 * share of a business, who decides things, and what happens when somebody wants
 * out. Charter can already produce that document itself, and does. This is the
 * other way of producing it: send a Word template and a block of data, and get
 * back a finished document.
 *
 * WHY BOTH EXIST, AND WHY THAT IS NOT INDECISION
 *
 * The template is an ordinary Word file, committed to this repository, that
 * anybody can download and read. That is worth having: a judge can open the
 * template, see every branch and every condition in it, and check that the
 * finished document matches. Our own writer produces the same document from the
 * same data and needs nothing from anybody.
 *
 * The data handed to each is identical, on purpose, so which one produced a given
 * document is a setting rather than a rewrite.
 *
 * THE ONE ENDPOINT THIS WILL NEVER CALL
 *
 * They also have a signing service. It is not called here, it is not in any tool
 * list, and no stage offers it. That is not caution about their service, which is
 * fine. It is that signing is the act of a person, so it sits outside every tool
 * list by design.
 *
 * WHAT THEIR TEAM TOLD US, AND WHY IT IS WRITTEN DOWN HERE
 *
 * Their reference documentation and their own shipped example disagree in several
 * places, and getting any of them wrong fails quietly — a repeater with the wrong
 * closing tag renders nothing at all, and nothing says so. We asked, and Kanwal
 * Roshi answered on 27 August 2026:
 *
 *   - The demo environment DOES need the bearer token, as well as the API key.
 *     Their reply is explicit about this, and it settles a question our own notes
 *     had guessed the other way.
 *   - A repeater must carry a name, so the closing tag is
 *     `</mdoc:repeater name="rptr">` and not `</mdoc:repeater>`.
 *   - A repeater's value is written `value="{!Customer.Items}"`, not
 *     `value="Invoice[0].Items"`.
 *   - An absolute path CAN be read from inside a repeater, so a per-owner share
 *     may divide by a total computed across all owners.
 *
 * Those four are what the constants below encode.
 *
 * WHAT IS HASHED BEFORE ANYTHING IS SENT
 *
 * They delete the uploaded data after generating. If we want to be able to show,
 * later, exactly what data produced exactly which document, we have to fingerprint
 * it ourselves first. So the exact bytes are fingerprinted before the request goes
 * out, and that fingerprint goes into our own record.
 */

import { createHash } from 'node:crypto'

import { ask, describeReply, type Fetcher, type Reply } from './http.js'

/** Where the demonstration environment lives, when nothing says otherwise. */
export const DEMO_HOST = 'https://demo.api.doctavian.com'

/**
 * The template syntax, in the forms their team confirmed.
 *
 * Written here rather than only inside a Word file, because the template is
 * generated and because a build check compares what we generate against these.
 * Getting any of them wrong renders nothing and says nothing.
 */
export const TEMPLATE_SYNTAX = {
  /** A repeater must be named, and the closing tag repeats the name. */
  closeRepeater: (name: string): string => `</mdoc:repeater name="${name}">`,
  /** The collection a repeater walks, in the form the parser accepts. */
  repeaterValue: (path: string): string => `{!${path}}`,
  /** The loop variable takes hashes on BOTH sides. One missing fails silently. */
  loopField: (variable: string, field: string): string => `{!#${variable}#.${field}}`,
  /** An expression, as opposed to a plain field: the dollar is what makes it one. */
  expression: (body: string): string => `{!$${body}}`,
} as const

export class DoctavianRefused extends Error {
  constructor(what: string, detail: string) {
    super(`${what}: ${detail}`)
    this.name = 'DoctavianRefused'
  }
}

export interface DoctavianOptions {
  readonly apiKey: string
  /**
   * The bearer token.
   *
   * Their team confirmed the demo environment needs this as well as the key, and
   * it is obtained through a Microsoft sign-in rather than issued with the key. So
   * it can be absent even when everything else is set up, and this says so plainly
   * rather than sending a request that will be refused.
   */
  readonly bearerToken?: string
  readonly baseUrl?: string
  readonly fetcher?: Fetcher
}

/** What is missing, in plain words, or null when nothing is. */
export function whatIsMissing(options: DoctavianOptions): string | null {
  if (options.apiKey.trim() === '') {
    return (
      'DOCTAVIAN_API_KEY is not set, so there is no key to send. The document is ' +
      "written by Charter's own code instead, which needs nothing from anybody."
    )
  }
  if ((options.bearerToken ?? '').trim() === '') {
    return (
      'DOCTAVIAN_REFRESH_TOKEN is not set. Their team confirmed on 27 August 2026 ' +
      'that the demonstration environment needs a bearer token as well as the API ' +
      'key, and that token comes from a Microsoft sign-in rather than with the key. ' +
      "Until there is one, the document is written by Charter's own code, which " +
      'produces the same document from the same data and needs nothing from anybody.'
    )
  }
  return null
}

/** The fingerprint of exactly what we are about to send. */
export function fingerprintOf(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex')
}

export interface Generated {
  /** The finished document. */
  readonly bytes: Uint8Array
  /** The fingerprint of the data we sent, taken before sending it. */
  readonly dataFingerprint: string
  /** The fingerprint of the template we sent. */
  readonly templateFingerprint: string
  /** Their own reference for the generated document. */
  readonly reference: string
}

export interface DoctavianClient {
  /** Is the service there at all. Needs no credential. */
  readonly reachable: () => Promise<boolean>
  /** Do our credentials work. Answers in plain words either way. */
  readonly credentialsWork: () => Promise<{ readonly ok: boolean; readonly why: string }>
  /** Template in, data in, finished document out. */
  readonly generate: (input: {
    readonly template: Uint8Array
    readonly templateName: string
    readonly data: unknown
  }) => Promise<Generated>
}

export function doctavian(options: DoctavianOptions): DoctavianClient {
  const base = options.baseUrl ?? DEMO_HOST

  /**
   * Both headers on every call.
   *
   * The key says which product, version and environment. The bearer token says who
   * is calling. Our own notes guessed for a while that the demo environment took
   * the key alone; their team says otherwise, and their answer is the one that
   * counts.
   */
  const headers = (): Record<string, string> => ({
    'x-api-key': options.apiKey,
    authorization: `Bearer ${options.bearerToken ?? ''}`,
  })

  const call = async (path: string, more: Parameters<typeof ask>[1] = {}): Promise<Reply> =>
    await ask(`${base}${path}`, {
      ...more,
      headers: { ...headers(), ...(more.headers ?? {}) },
      ...(options.fetcher === undefined ? {} : { fetcher: options.fetcher }),
    })

  return {
    async reachable(): Promise<boolean> {
      // The one endpoint that needs no credential at all, so "is it there" and
      // "do our credentials work" are separate questions with separate answers.
      const reply = await ask(`${base}/v1/common/status`, {
        ...(options.fetcher === undefined ? {} : { fetcher: options.fetcher }),
      })
      return reply.kind === 'ok'
    },

    async credentialsWork(): Promise<{ readonly ok: boolean; readonly why: string }> {
      const missing = whatIsMissing(options)
      if (missing !== null) return { ok: false, why: missing }

      const reply = await call('/v1/documents/document/list')
      return reply.kind === 'ok'
        ? { ok: true, why: 'the key and the bearer token were both accepted' }
        : { ok: false, why: `they ${describeReply(reply)}` }
    },

    async generate(input): Promise<Generated> {
      const missing = whatIsMissing(options)
      if (missing !== null) throw new DoctavianRefused('nothing was sent', missing)

      // Fingerprinted BEFORE sending, both of them. They delete the uploaded data
      // once the document is made, so this is the only moment at which we can say
      // what produced what.
      const dataBytes = new TextEncoder().encode(JSON.stringify(input.data))
      const dataFingerprint = fingerprintOf(dataBytes)
      const templateFingerprint = fingerprintOf(input.template)

      const templateReply = await call('/v1/documents/template/upload', {
        method: 'POST',
        body: {
          name: input.templateName,
          content: Buffer.from(input.template).toString('base64'),
        },
      })
      if (templateReply.kind !== 'ok') {
        throw new DoctavianRefused('the template was not accepted', describeReply(templateReply))
      }
      const templateId = referenceIn(templateReply.body)
      if (templateId === null) {
        throw new DoctavianRefused(
          'the template was accepted and no reference came back',
          'nothing can be generated without one, so this stops rather than guessing',
        )
      }

      const dataReply = await call('/v1/documents/data/upload', {
        method: 'POST',
        body: { content: Buffer.from(dataBytes).toString('base64') },
      })
      if (dataReply.kind !== 'ok') {
        throw new DoctavianRefused('the data was not accepted', describeReply(dataReply))
      }
      const dataId = referenceIn(dataReply.body)
      if (dataId === null) {
        throw new DoctavianRefused(
          'the data was accepted and no reference came back',
          'nothing can be generated without one, so this stops rather than guessing',
        )
      }

      // Synchronous: their own documentation says the document comes back in the
      // same response, with nothing to poll for.
      const madeReply = await call('/v1/documents/document/generate', {
        method: 'POST',
        body: { templateId, dataId, document: { name: input.templateName, format: 'pdf' } },
      })
      if (madeReply.kind !== 'ok') {
        throw new DoctavianRefused('the document was not generated', describeReply(madeReply))
      }
      const reference = referenceIn(madeReply.body)
      if (reference === null) {
        throw new DoctavianRefused(
          'a document was generated and no reference came back',
          'there is nothing to download, so this stops rather than guessing',
        )
      }

      const downloaded = await call(
        `/v1/documents/document/${encodeURIComponent(reference)}/download`,
      )
      if (downloaded.kind !== 'ok') {
        throw new DoctavianRefused('the document was not downloaded', describeReply(downloaded))
      }

      const bytes = bytesIn(downloaded.body)
      if (bytes === null) {
        throw new DoctavianRefused(
          'the download came back in a shape this does not recognise',
          'a document that cannot be read is not a document, so this stops',
        )
      }

      return { bytes, dataFingerprint, templateFingerprint, reference }
    },
  }
}

/**
 * Their reference for a thing, whatever they chose to call the field.
 *
 * Written this way on purpose. Their documentation names it four different ways
 * across four endpoints, and no real call has been made to settle which is true.
 * Guessing one and failing on the others would be worse than looking for any of
 * them: this cannot be wrong in a way that silently returns nothing.
 */
export function referenceIn(body: unknown): string | null {
  if (body === null || typeof body !== 'object') return null
  const looking = body as Record<string, unknown>
  for (const name of ['urn', 'id', 'identifier', 'reference', 'documentId', 'templateId']) {
    const found = looking[name]
    if (typeof found === 'string' && found.trim() !== '') return found
  }
  // One level down, because several of their replies wrap the useful part.
  for (const name of ['data', 'result', 'document', 'template']) {
    const inner = looking[name]
    if (inner !== undefined && inner !== null && typeof inner === 'object') {
      const found = referenceIn(inner)
      if (found !== null) return found
    }
  }
  return null
}

/** The document itself, out of whichever shape it came back in. */
export function bytesIn(body: unknown): Uint8Array | null {
  if (typeof body === 'string') return new Uint8Array(Buffer.from(body, 'base64'))
  if (body === null || typeof body !== 'object') return null

  const looking = body as Record<string, unknown>
  for (const name of ['content', 'bytes', 'file', 'document']) {
    const found = looking[name]
    if (typeof found === 'string' && found.trim() !== '') {
      return new Uint8Array(Buffer.from(found, 'base64'))
    }
  }
  return null
}

/**
 * The client, built from the settings, or a plain sentence about what is missing.
 *
 * The three settings it reads are named here rather than passed in from somewhere
 * else, so that a person searching for where DOCTAVIAN_API_KEY is used finds the
 * file that uses it. A build check enforces exactly that.
 */
export function doctavianFromEnv(
  env: Record<string, string | undefined> = process.env,
  fetcher?: Fetcher,
): { readonly client: DoctavianClient | null; readonly why: string } {
  const apiKey = (env['DOCTAVIAN_API_KEY'] ?? '').trim()
  const bearerToken = (env['DOCTAVIAN_REFRESH_TOKEN'] ?? '').trim()
  const baseUrl = (env['DOCTAVIAN_BASE_URL'] ?? '').trim()

  const options: DoctavianOptions = {
    apiKey,
    bearerToken,
    ...(baseUrl === '' ? {} : { baseUrl }),
    ...(fetcher === undefined ? {} : { fetcher }),
  }

  const missing = whatIsMissing(options)
  if (missing !== null) return { client: null, why: missing }

  return {
    client: doctavian(options),
    why: `The document service at ${baseUrl === '' ? DEMO_HOST : baseUrl}, with both headers.`,
  }
}
