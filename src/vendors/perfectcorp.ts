/**
 * Drawing the first picture for a business that owns no photographs.
 *
 * WHY A BUSINESS FORMED THIS MORNING NEEDS THIS
 *
 * It has no shopfront yet, no products photographed, no staff pictures, and no
 * money to hire anybody to take them. The one thing it does have is the sentence
 * its owners typed when they described what they were building, and that sentence
 * is already in the record, because it is what started the legal work.
 *
 * So the picture is drawn from the owners' own words. Not from words a model wrote
 * about them, which would be a picture of a summary of a business.
 *
 * WHAT THIS COMPANY ALSO SELLS, AND WHY NONE OF IT IS HERE
 *
 * Face analysis. Skin analysis. Face swapping. Virtual try-on that maps a
 * photograph of a person's face.
 *
 * None of it appears in any tool list, none is reachable from anything the model
 * can trigger, and no photograph of any person is ever sent anywhere by this file.
 * A business formation tool has no business touching anybody's face, and the way
 * to make that true is to have no code that could.
 *
 * HOW THEIR SIGN-IN WORKS, WHICH IS UNUSUAL
 *
 * Most services take a key in a header. This one does not. It gives out a key and
 * a public key, and every sign-in has to send proof that the caller holds the
 * matching arrangement: the caller encrypts its own key and the current time with
 * the public key, and sends the result. The service decrypts it, checks the key
 * matches and the time is recent, and hands back a token.
 *
 * The time is why it cannot be done once and written down. An old encrypted block
 * is refused, so a leaked one is worth nothing a few minutes later.
 *
 * WHAT IS NOT TRUE ABOUT THIS FILE YET
 *
 * **It has never been called.** There is no key for it. This is written from their
 * published interface and it has not met their server.
 *
 * That sentence is here because the last client in this project that had never
 * been called was wrong in three separate ways at once — wrong endpoint, wrong
 * request, wrong reply shape — under a test suite that passed, and the first real
 * call found all three in ten minutes. Nothing in this project may describe this
 * as working until somebody has run `npm run picture:proof` and seen a picture.
 * Until then the honest word is "written, not proven", and that is the word the
 * settings file and the website both use.
 */

import forge from 'node-forge'
import { ask, describeReply, type Fetcher, type Reply } from './http.js'
import type { DrawnPicture, ImageryService } from '../tools/services.js'

/** Where their service lives. */
export const IMAGERY_HOST = 'https://yce-api-01.perfectcorp.com'

/** Their name, written once, so every record entry spells it the same way. */
export const DRAWN_BY = 'Perfect Corp'

/** How long to wait for one answer. */
const PATIENCE = 60_000

/** How long to keep asking whether the picture is finished. */
const DRAWING_PATIENCE = 180_000

/** How long to wait between asking. */
const BETWEEN_ASKS = 2_000

export class CouldNotDraw extends Error {
  constructor(what: string, reply: Reply) {
    const detail = 'detail' in reply ? reply.detail : ''
    super(
      `${what}: ${DRAWN_BY} ${describeReply(reply)}` + (detail === '' ? '' : `. It said: ${detail}`),
    )
    this.name = 'CouldNotDraw'
  }
}

export interface PerfectCorpOptions {
  /** The key from their console. */
  readonly apiKey: string
  /** The public key they issue beside it, in the usual text form. */
  readonly publicKeyPem: string
  readonly baseUrl?: string
  readonly fetcher?: Fetcher
  /** The clock, passed in so a test is exact and so the proof is repeatable. */
  readonly now?: () => number
  readonly betweenAsks?: number
  readonly drawingPatience?: number
}

/**
 * Build the proof that this caller holds the arrangement.
 *
 * Their key and the current time, run together and encrypted with the public key
 * they issued. Written out here rather than hidden inside the client, because it
 * is the one part of this file somebody checking it would want to read.
 *
 * The time is in milliseconds and it is why this cannot be worked out once and
 * written down: their service refuses an old block, so one that leaked is worth
 * nothing shortly afterwards.
 */
export function proofOfKey(apiKey: string, publicKeyPem: string, atMilliseconds: number): string {
  const key = forge.pki.publicKeyFromPem(publicKeyPem.trim())
  // RSAES-PKCS1-v1_5, which is what their own examples use. Written out rather
  // than left to a default, because the two common paddings are not compatible
  // and the failure is a refusal that says nothing about which one was wrong.
  const sealed = key.encrypt(`${apiKey};${atMilliseconds}`, 'RSAES-PKCS1-V1_5')
  return forge.util.encode64(sealed)
}

/**
 * What is actually sent as the description of the picture.
 *
 * The owners' own sentence, and two instructions that are about the KIND of
 * picture rather than about its content: no people in it, and no lettering.
 *
 * Both are refusals rather than decoration. A picture of a shop with invented
 * people standing in it is a picture of staff the business does not employ. A
 * picture with invented lettering on the window is a sign saying something nobody
 * chose, on a business that has just spent an hour being careful about what it
 * says in writing.
 */
export function describeThePicture(ownersWords: string): string {
  return (
    `${ownersWords.trim()}. ` +
    'A photograph of the place itself, empty and open, with nobody in the picture ' +
    'and no words, letters or signs anywhere in it.'
  )
}

export function perfectCorpImagery(options: PerfectCorpOptions): ImageryService {
  const base = (options.baseUrl ?? IMAGERY_HOST).replace(/\/+$/, '')
  const clock = options.now ?? (() => Date.now())
  const betweenAsks = options.betweenAsks ?? BETWEEN_ASKS
  const drawingPatience = options.drawingPatience ?? DRAWING_PATIENCE

  const send = (path: string, body: unknown, token: string | null, what: string) =>
    ask(`${base}${path}`, {
      method: 'POST',
      headers: token === null ? {} : { authorization: `Bearer ${token}` },
      body,
      patience: PATIENCE,
      ...(options.fetcher === undefined ? {} : { fetcher: options.fetcher }),
    }).then((reply) => {
      if (reply.kind !== 'ok') throw new CouldNotDraw(what, reply)
      return reply.body
    })

  return {
    async draw(prompt: string, shape: string): Promise<DrawnPicture> {
      const words = describeThePicture(prompt)

      // ---- sign in ------------------------------------------------------------
      const signedIn = await send(
        '/s2s/v1.0/client/auth',
        {
          client_id: options.apiKey,
          id_token: proofOfKey(options.apiKey, options.publicKeyPem, clock()),
        },
        null,
        'signing in',
      )

      const token = String(at(at(signedIn, 'result'), 'access_token') ?? '')
      if (token === '') {
        throw new CouldNotDraw('signing in', {
          kind: 'refused',
          status: 200,
          detail: 'no access_token came back',
        })
      }

      // ---- ask for the picture ------------------------------------------------
      const started = await send(
        '/s2s/v2.0/task/image-generator',
        { request_id: 0, payload: { prompt: words, aspect_ratio: shape, output_count: 1 } },
        token,
        'asking for the picture',
      )

      const taskId = String(at(at(started, 'result'), 'task_id') ?? at(started, 'task_id') ?? '')
      if (taskId === '') {
        throw new CouldNotDraw('asking for the picture', {
          kind: 'unreadable',
          status: 200,
          detail: 'the reply carried no task to wait on',
        })
      }

      // ---- wait for it --------------------------------------------------------
      const startedAt = clock()
      for (;;) {
        await sleep(betweenAsks)

        const reply = await ask(`${base}/s2s/v1.0/task/image-generator?task_id=${taskId}`, {
          headers: { authorization: `Bearer ${token}` },
          patience: PATIENCE,
          ...(options.fetcher === undefined ? {} : { fetcher: options.fetcher }),
        })
        if (reply.kind !== 'ok') throw new CouldNotDraw('waiting for the picture', reply)

        const result = at(reply.body, 'result') ?? reply.body
        const status = String(at(result, 'status') ?? '')

        if (status === 'success') {
          const url = firstUrlIn(result)
          if (url === null) {
            throw new CouldNotDraw('collecting the picture', {
              kind: 'unreadable',
              status: reply.status,
              detail: 'it finished without saying where the picture is',
            })
          }
          return { url, shape, fromWords: words, drawnBy: DRAWN_BY }
        }

        if (status === 'error' || status === 'failed') {
          throw new CouldNotDraw('drawing the picture', {
            kind: 'refused',
            status: reply.status,
            detail: String(at(result, 'error') ?? 'it said the task failed'),
          })
        }

        if (clock() - startedAt > drawingPatience) {
          throw new CouldNotDraw('drawing the picture', {
            kind: 'never-arrived',
            detail:
              `it was still "${status}" after ${Math.round(drawingPatience / 1000)} seconds`,
          })
        }
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

function at(body: unknown, field: string): unknown {
  if (body === null || typeof body !== 'object') return undefined
  return (body as Record<string, unknown>)[field]
}

/**
 * The address of the picture, wherever in the reply they put it.
 *
 * Their finished task carries a list of results, and the address has appeared
 * under more than one name in their own examples. Rather than guess at one and
 * fail silently when it is the other, this looks for the first thing that is
 * plainly a web address, and says so plainly when there is none.
 */
export function firstUrlIn(body: unknown): string | null {
  if (typeof body === 'string') return /^https?:\/\//.test(body) ? body : null
  if (Array.isArray(body)) {
    for (const one of body) {
      const found = firstUrlIn(one)
      if (found !== null) return found
    }
    return null
  }
  if (body === null || typeof body !== 'object') return null

  for (const value of Object.values(body as Record<string, unknown>)) {
    const found = firstUrlIn(value)
    if (found !== null) return found
  }
  return null
}
