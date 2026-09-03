/**
 * The document service that does the reversible work on the pack.
 *
 * WHAT THIS FILE IS
 *
 * Charter writes the formation pack itself, as a PDF, with its own code. This file
 * is what an outside document service does to that pack **before it is sealed**:
 * join separate documents into one, read the finished text back out, and make the
 * file smaller so it can be emailed.
 *
 * Every one of those is reversible. None of them can create a signature, and none
 * of them is trusted with anything after the seal. That split — reversible work
 * goes out to a service, irreversible work stays here — is the whole design.
 *
 * WHY READING THE PACK BACK IS THE IMPORTANT ONE
 *
 * Joining and shrinking are conveniences. Reading back is a check.
 *
 * Charter writes a legal document and then hands it to people to sign. If a page
 * silently lost its text, or a name was written into the file wrongly, every
 * screen would still say the run had worked. So once the pack exists, its text is
 * read back out **by a different program than the one that wrote it**, and the
 * names of the company and of every owner are looked for in what came back. A
 * check performed by the same code that produced the thing being checked is not
 * really a check.
 *
 * If the read-back cannot happen — no key, no network, out of allowance — that is
 * recorded as "not checked" and never as "checked and fine". Those are different
 * facts and only one of them is worth anything.
 *
 * WHAT THIS SERVICE IS NEVER ASKED TO DO
 *
 * Anything at all after the pack is sealed. The service's catalogue contains
 * operations that rewrite the file — flatten, watermark, delete pages, protect —
 * and each of them would leave a sealed pack looking untouched while its seal no
 * longer covered what it claimed to. `src/pack/assemble.ts` refuses them by rule.
 *
 * The service refuses them too, on its own, which we did not arrange and did not
 * expect. Sending it a sealed Charter pack comes back
 *
 *     "May be due to unsupported or invalid document"
 *
 * because the seal marks the file as certified and their reader will not modify a
 * certified file. Two independent programs refusing the same thing for the same
 * reason is worth more than either one of them promising it, so `npm run
 * foxit:proof` performs exactly that and prints what came back.
 *
 * HOW THE SERVICE WORKS, IN ITS OWN SHAPE
 *
 * It is not one call. Every operation is three or four:
 *
 *   1. upload each document, and get an identifier back
 *   2. ask for the operation, and get a **task** identifier back
 *   3. ask about that task until it says finished or failed
 *   4. download the resulting document
 *
 * Step three is why there is a waiting loop in here. The service answers 202 to
 * mean "accepted, not done", and a caller that treated 202 as success would
 * download nothing and carry on.
 *
 * ABOUT THE ALLOWANCE
 *
 * The free account is generous per month and strict per minute. Asking too fast
 * comes back 429 with no detail, and the right response is to wait rather than to
 * treat it as a failure — so a 429 is retried with a growing pause, a fixed number
 * of times, and then given up on honestly.
 */

import { ask, type Fetcher, type Reply, describeReply } from './http.js'
import type {
  DocumentPart,
  DocumentService,
  JoinedDocument,
  ReadBack,
  Shrunk,
} from '../tools/services.js'

/** How long to wait for one answer from this service. */
const PATIENCE = 60_000

/** How long to keep asking whether a task has finished. */
const TASK_PATIENCE = 120_000

/** How long to wait between asking about a task. */
const BETWEEN_ASKS = 1_500

/** How many times to retry when the answer was "you are asking too fast". */
const RETRIES_WHEN_RUSHED = 4

export interface FoxitOptions {
  readonly baseUrl: string
  readonly clientId: string
  readonly clientSecret: string
  readonly fetcher?: Fetcher
  /** Overridable so a test does not really wait. */
  readonly betweenAsks?: number
  readonly taskPatience?: number
  /** The clock, passed in so a test can move it without waiting. */
  readonly now?: () => number
}

/** Their name, written once, so every record entry spells it the same way. */
export const JOINED_BY = 'Foxit PDF Services'

class FoxitTrouble extends Error {
  constructor(what: string, reply: Reply) {
    super(`${what}: ${describeReply(reply)}`)
    this.name = 'FoxitTrouble'
  }
}

/**
 * The service accepted the work, tried it, and would not finish it.
 *
 * Its own separate kind, because it says nothing at all about the credential.
 * A task that fails on the document is the interesting case: it is what happens
 * when a sealed pack is sent to an operation that would rewrite it.
 */
export class TaskFailed extends Error {
  constructor(
    what: string,
    /** The service's own words, kept exactly, so they can be quoted. */
    readonly said: string,
  ) {
    super(`${what}: the service tried and would not finish. It said: ${said}`)
    this.name = 'TaskFailed'
  }
}

/**
 * The client.
 *
 * Every method either does the thing or throws with a sentence saying what the
 * service said. Nothing here decides whether a failure should stop a run — that
 * belongs to the caller, which knows whether the pack can go on without this.
 */
export function foxitDocuments(options: FoxitOptions): DocumentService & {
  /**
   * Ask the service to do something that rewrites a file, expecting a refusal.
   *
   * Not part of any run. It exists so that the claim "an outside service will not
   * modify a sealed Charter pack" can be demonstrated rather than asserted.
   */
  readonly tryToFlatten: (bytes: Uint8Array) => Promise<{
    readonly refused: boolean
    readonly said: string
  }>
} {
  const base = options.baseUrl.replace(/\/+$/, '')
  const betweenAsks = options.betweenAsks ?? BETWEEN_ASKS
  const taskPatience = options.taskPatience ?? TASK_PATIENCE
  const clock = options.now ?? (() => Date.now())

  const credentials = {
    client_id: options.clientId,
    client_secret: options.clientSecret,
  }

  /**
   * Ask, and wait rather than fail when the answer is "too fast".
   *
   * The pause grows each time. Four tries with a growing pause covers a burst; a
   * service that is still saying no after that is genuinely out of allowance, and
   * pretending otherwise by retrying forever would hang a run instead of telling
   * somebody.
   */
  async function askPatiently(url: string, init: Parameters<typeof ask>[1]): Promise<Reply> {
    let waited = 0
    for (let attempt = 0; ; attempt += 1) {
      const reply = await ask(url, init)
      if (reply.kind !== 'out-of-allowance' || attempt >= RETRIES_WHEN_RUSHED) return reply
      waited = (attempt + 1) * betweenAsks
      await sleep(waited)
    }
  }

  /** Send one document up and get the service's name for it back. */
  async function upload(part: DocumentPart): Promise<string> {
    const form = new FormData()
    form.append(
      'file',
      new Blob([new Uint8Array(part.bytes)], { type: 'application/pdf' }),
      fileNameFor(part.name),
    )

    // Not through `ask`, because this one is a form rather than JSON and the
    // content type has to be left for the runtime to set with its own boundary.
    const fetcher = options.fetcher ?? ((target, init) => fetch(target, init))

    let waited = 0
    for (let attempt = 0; ; attempt += 1) {
      let response: Response
      try {
        response = await fetcher(`${base}/pdf-services/api/documents/upload`, {
          method: 'POST',
          headers: credentials,
          body: form,
          signal: AbortSignal.timeout(PATIENCE),
        })
      } catch (error) {
        throw new FoxitTrouble(`sending "${part.name}"`, {
          kind: 'never-arrived',
          detail: error instanceof Error ? error.message : String(error),
        })
      }

      if (response.status === 429 && attempt < RETRIES_WHEN_RUSHED) {
        waited = (attempt + 1) * betweenAsks
        await sleep(waited)
        continue
      }

      const text = await response.text().catch(() => '')
      if (!response.ok) {
        throw new FoxitTrouble(`sending "${part.name}"`, {
          kind: response.status === 429 ? 'out-of-allowance' : 'refused',
          status: response.status,
          detail: text.slice(0, 300),
        })
      }

      const id = readField(text, 'documentId')
      if (id === null) {
        throw new FoxitTrouble(`sending "${part.name}"`, {
          kind: 'unreadable',
          status: response.status,
          detail: `no documentId in ${text.slice(0, 200)}`,
        })
      }
      return id
    }
  }

  /** Start an operation and hand back the task it created. */
  async function startTask(path: string, body: unknown, what: string): Promise<string> {
    const reply = await askPatiently(`${base}${path}`, {
      method: 'POST',
      headers: credentials,
      body,
      patience: PATIENCE,
      ...(options.fetcher === undefined ? {} : { fetcher: options.fetcher }),
    })

    if (reply.kind !== 'ok') throw new FoxitTrouble(what, reply)

    const taskId = fieldOf(reply.body, 'taskId')
    if (typeof taskId !== 'string' || taskId === '') {
      throw new FoxitTrouble(what, {
        kind: 'unreadable',
        status: reply.status,
        detail: 'the reply carried no taskId',
      })
    }
    return taskId
  }

  /**
   * Keep asking about a task until it finishes, fails, or we run out of patience.
   *
   * The service answers 202 for "accepted", which is not the same as done. A
   * caller that treated the first answer as the result would download nothing.
   */
  async function waitForTask(taskId: string, what: string): Promise<string> {
    const startedAt = clock()

    for (;;) {
      await sleep(betweenAsks)

      const reply = await askPatiently(`${base}/pdf-services/api/tasks/${taskId}`, {
        headers: credentials,
        patience: PATIENCE,
        ...(options.fetcher === undefined ? {} : { fetcher: options.fetcher }),
      })
      if (reply.kind !== 'ok') throw new FoxitTrouble(`${what}, while waiting`, reply)

      const status = fieldOf(reply.body, 'status')

      if (status === 'COMPLETED') {
        const resultId = fieldOf(reply.body, 'resultDocumentId')
        if (typeof resultId !== 'string' || resultId === '') {
          throw new FoxitTrouble(what, {
            kind: 'unreadable',
            status: reply.status,
            detail: 'finished without saying which document it produced',
          })
        }
        return resultId
      }

      if (status === 'FAILED' || status === 'ERROR') {
        // Deliberately NOT sent through the credential vocabulary. The request
        // arrived, the credential was accepted, and the service tried and would
        // not finish. Describing that as "refused the credential" would send
        // somebody to check a key that is perfectly fine.
        const error = fieldOf(reply.body, 'error')
        const said =
          typeof error === 'object' && error !== null
            ? String((error as Record<string, unknown>)['message'] ?? '')
            : ''
        throw new TaskFailed(what, said === '' ? 'it did not say why' : said)
      }

      if (clock() - startedAt > taskPatience) {
        throw new FoxitTrouble(what, {
          kind: 'never-arrived',
          detail:
            `the task was still "${String(status)}" after ` +
            `${Math.round(taskPatience / 1000)} seconds`,
        })
      }
    }
  }

  /** Fetch the bytes of a document the service is holding. */
  async function download(documentId: string, what: string): Promise<Uint8Array> {
    const fetcher = options.fetcher ?? ((target, init) => fetch(target, init))

    let response: Response
    try {
      response = await fetcher(`${base}/pdf-services/api/documents/${documentId}/download`, {
        method: 'GET',
        headers: credentials,
        signal: AbortSignal.timeout(PATIENCE),
      })
    } catch (error) {
      throw new FoxitTrouble(`collecting ${what}`, {
        kind: 'never-arrived',
        detail: error instanceof Error ? error.message : String(error),
      })
    }

    if (!response.ok) {
      throw new FoxitTrouble(`collecting ${what}`, {
        kind: 'refused',
        status: response.status,
        detail: (await response.text().catch(() => '')).slice(0, 300),
      })
    }

    return new Uint8Array(await response.arrayBuffer())
  }

  return {
    async join(parts: readonly DocumentPart[]): Promise<JoinedDocument> {
      if (parts.length === 0) {
        throw new Error('There is nothing to join.')
      }
      if (parts.length === 1) {
        // Not an error and not worth a round trip. Said plainly rather than
        // pretending a join happened.
        return {
          bytes: (parts[0] as DocumentPart).bytes,
          partNames: [(parts[0] as DocumentPart).name],
          joinedBy: 'nobody. There was one document, so there was nothing to join',
        }
      }

      const ids: string[] = []
      for (const part of parts) ids.push(await upload(part))

      const taskId = await startTask(
        '/pdf-services/api/documents/enhance/pdf-combine',
        { documentInfos: ids.map((documentId) => ({ documentId })) },
        `joining ${parts.length} documents`,
      )
      const resultId = await waitForTask(taskId, `joining ${parts.length} documents`)
      const bytes = await download(resultId, 'the joined document')

      return {
        bytes,
        partNames: parts.map((one) => one.name),
        joinedBy: JOINED_BY,
      }
    },

    async readBack(bytes: Uint8Array): Promise<ReadBack> {
      // A failure here is never fatal. The pack exists either way, and the honest
      // answer to "was it checked" is no rather than an error somebody has to
      // interpret. Everything below turns a failure into that answer.
      try {
        const documentId = await upload({ name: 'the finished pack', bytes })
        const taskId = await startTask(
          '/pdf-services/api/documents/modify/pdf-extract',
          { documentId, extractType: 'TEXT' },
          'reading the pack back',
        )
        const resultId = await waitForTask(taskId, 'reading the pack back')
        const raw = await download(resultId, 'the text of the pack')
        const text = new TextDecoder().decode(raw)

        return {
          happened: true,
          text,
          readBy: JOINED_BY,
        }
      } catch (error) {
        return {
          happened: false,
          text: '',
          readBy:
            `nobody. The pack was not read back, so nothing here says its text was ` +
            `checked. ${error instanceof Error ? error.message : String(error)}`,
        }
      }
    },

    async shrink(bytes: Uint8Array): Promise<Shrunk> {
      try {
        const documentId = await upload({ name: 'the pack, before shrinking', bytes })
        const taskId = await startTask(
          '/pdf-services/api/documents/modify/pdf-compress',
          { documentId, compressionLevel: 'MEDIUM' },
          'making the pack smaller',
        )
        const resultId = await waitForTask(taskId, 'making the pack smaller')
        const smaller = await download(resultId, 'the smaller pack')

        // Bigger is a real outcome for an already tight file. Keeping the original
        // is the right answer, and saying so is better than quietly returning the
        // larger one and calling it compressed.
        if (smaller.length >= bytes.length) {
          return {
            bytes,
            wasShrunk: false,
            shrunkBy:
              `${JOINED_BY} was asked, and what came back was not smaller, so the ` +
              `original was kept`,
          }
        }

        return { bytes: smaller, wasShrunk: true, shrunkBy: JOINED_BY }
      } catch (error) {
        return {
          bytes,
          wasShrunk: false,
          shrunkBy: `nobody. ${error instanceof Error ? error.message : String(error)}`,
        }
      }
    },

    async tryToFlatten(bytes: Uint8Array): Promise<{ readonly refused: boolean; readonly said: string }> {
      try {
        const documentId = await upload({ name: 'a sealed pack', bytes })
        const taskId = await startTask(
          '/pdf-services/api/documents/modify/pdf-flatten',
          { documentId },
          'flattening a sealed pack',
        )
        await waitForTask(taskId, 'flattening a sealed pack')
        return {
          refused: false,
          said: 'It did it. The sealed pack was rewritten by an outside service.',
        }
      } catch (error) {
        return { refused: true, said: error instanceof Error ? error.message : String(error) }
      }
    },
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Small shared pieces
// ─────────────────────────────────────────────────────────────────────────────

function sleep(milliseconds: number): Promise<void> {
  return new Promise((wake) => setTimeout(wake, milliseconds))
}

/** One field off a parsed reply, without assuming the reply is an object. */
function fieldOf(body: unknown, field: string): unknown {
  if (typeof body !== 'object' || body === null) return undefined
  return (body as Record<string, unknown>)[field]
}

/** One string field out of raw text that is expected to be JSON. */
function readField(text: string, field: string): string | null {
  try {
    const value = fieldOf(JSON.parse(text), field)
    return typeof value === 'string' && value !== '' ? value : null
  } catch {
    return null
  }
}

/**
 * A file name the service will accept, made from what the document is.
 *
 * The name we use internally is a sentence in plain words. Sent as a file name it
 * would arrive with spaces and punctuation in it, and a service that rejects one
 * is a service that fails for a reason nobody would guess.
 */
export function fileNameFor(name: string): string {
  const flattened = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return `${flattened === '' ? 'document' : flattened}.pdf`
}

/**
 * Whether the text read back out of a pack really contains everything it must.
 *
 * WHY THIS IS SEPARATE FROM THE CLIENT
 *
 * It takes text and a list of things to look for, and reaches nothing. So the rule
 * about what a pack has to say is testable on its own, with no key and no network,
 * and it stays true when the service behind the reading changes.
 *
 * HOW THE COMPARISON IS DONE, AND WHY
 *
 * Spaces are collapsed and letters lowercased before comparing. A PDF stores text
 * in pieces, and reading it back can put a space where the page shows none, or run
 * two words together. Comparing the raw strings would report a missing name every
 * time the reader broke a line differently, which trains everybody to ignore it.
 */
export function whatIsMissingFrom(
  text: string,
  mustSay: readonly string[],
): readonly string[] {
  const flat = flatten(text)
  return mustSay.filter((one) => one.trim() !== '' && !flat.includes(flatten(one)))
}

function flatten(text: string): string {
  return text.toLowerCase().replace(/\s+/g, ' ').trim()
}
