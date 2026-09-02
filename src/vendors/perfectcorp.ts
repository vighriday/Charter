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
 * THE TWO REFUSALS, AND WHERE THEY ARE PUT
 *
 * Every picture is asked for with nobody in it and no lettering anywhere on it.
 * Both are refusals rather than styling.
 *
 *   - A picture of a shop with invented people standing in it is a picture of
 *     staff the business does not employ, on the website of a company formed this
 *     morning.
 *   - A picture with invented lettering on the window is a sign saying something
 *     nobody chose, on a business that has just spent an hour being careful about
 *     every word it puts in writing.
 *
 * Their service takes two separate descriptions: one for what the picture should
 * contain, and one for what it must not. So the refusals go in the second, which
 * is where a refusal belongs. Writing "no people" into the description of what
 * you want is a known way to get people, because the description is read as a
 * list of things to include.
 *
 * WHY THEIR PROMPT REWRITING IS TURNED OFF
 *
 * Their service will, by default, rewrite the description before drawing it, to
 * add detail. It says so, and for most callers it is an improvement.
 *
 * It is turned off here, and this is the one setting in this file that is really
 * a policy. The whole point is that the picture comes from the owners' own
 * sentence. A rewrite makes it a picture of what a model thought they meant, and
 * the record would then hold the owners' words beside a picture of something
 * else. Charter would rather have a plainer picture that is honestly theirs.
 *
 * WHAT WE LEARNED BY ACTUALLY CALLING IT
 *
 * This company has two different services with the same name. The older one signs
 * in by encrypting your key and the current time with a public key they issue.
 * The newer one, which is the one their console now hands out keys for, takes the
 * key straight in a header like everybody else. A client written from the older
 * documentation authenticates against nothing, and the error it gets back names
 * the credential rather than the service, which sends you looking in the wrong
 * place for an afternoon.
 *
 * Same lesson as the rest of this folder, again: a client that has never been
 * called is a guess. Nothing here may be described as working until somebody has
 * run `npm run picture:proof` and seen the address of a real picture.
 */

import { ask, describeReply, type Fetcher, type Reply } from './http.js'
import type { DrawnPicture, ImageryService } from '../tools/services.js'

/** Where their service lives. */
export const IMAGERY_HOST = 'https://yce-api-01.perfectcorp.com'

/** Their name, written once, so every record entry spells it the same way. */
export const DRAWN_BY = 'Perfect Corp'

/** Where a picture is asked for. Waiting on it uses this path plus the task. */
export const DRAW_PATH = '/s2s/v2.0/task/text-to-image/youcam'

/** The only model their newer service accepts on this path. */
export const PICTURE_MODEL = 'youcam-image-v2'

/** How long to wait for one answer. */
const PATIENCE = 60_000

/** How long to keep asking whether the picture is finished. */
const DRAWING_PATIENCE = 180_000

/** How long to wait between asking. */
const BETWEEN_ASKS = 2_000

/** Their limit on the description, in characters. Theirs, not ours. */
export const MOST_WORDS = 800

/**
 * The shapes their service will draw, by the ordinary name for each shape.
 *
 * They are asked for as an exact width and height, and they refuse anything not
 * on this list. Written out so that a caller says "4:3" and never has to know a
 * number, and so that an unknown shape is caught here rather than by them.
 */
export const SIZES: Readonly<Record<string, string>> = {
  '16:9': '1664*928',
  '4:3': '1472*1104',
  '1:1': '1328*1328',
  '3:4': '1104*1472',
  '9:16': '928*1664',
}

/** What a shape means to them, or null if it is not one they draw. */
export function sizeFor(shape: string): string | null {
  const asked = shape.trim().replace(/x/i, '*')
  if (Object.values(SIZES).includes(asked)) return asked
  return SIZES[shape.trim()] ?? null
}

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
  /** The key from their console. It goes straight into a header. */
  readonly apiKey: string
  readonly baseUrl?: string
  readonly fetcher?: Fetcher
  /** The clock, passed in so a test is exact and so the proof is repeatable. */
  readonly now?: () => number
  readonly betweenAsks?: number
  readonly drawingPatience?: number
}

/**
 * What is actually asked for: the owners' own sentence, and nothing else.
 *
 * Trimmed, and cut at their limit if somebody wrote an essay. Nothing is added,
 * because everything Charter wants to add is a refusal, and refusals go in the
 * other description. See `whatToKeepOut`.
 */
export function describeThePicture(ownersWords: string): string {
  const said = ownersWords.trim()
  return said.length <= MOST_WORDS ? said : said.slice(0, MOST_WORDS)
}

/**
 * What must not be in the picture.
 *
 * Two refusals and a plain quality floor. The two refusals are the ones this
 * project actually cares about and they are explained at the top of this file:
 * no invented staff, and no invented signage. The rest is ordinary.
 */
export function whatToKeepOut(): string {
  return (
    'people, faces, crowds, staff, customers, hands, ' +
    'words, letters, text, signage, lettering, logos, watermarks, ' +
    'low resolution, blurry, distorted'
  )
}

export function perfectCorpImagery(options: PerfectCorpOptions): ImageryService {
  const base = (options.baseUrl ?? IMAGERY_HOST).replace(/\/+$/, '')
  const clock = options.now ?? (() => Date.now())
  const betweenAsks = options.betweenAsks ?? BETWEEN_ASKS
  const drawingPatience = options.drawingPatience ?? DRAWING_PATIENCE
  const carrying = { authorization: `Bearer ${options.apiKey}` }

  return {
    async draw(prompt: string, shape: string): Promise<DrawnPicture> {
      const words = describeThePicture(prompt)
      if (words === '') {
        throw new CouldNotDraw('asking for the picture', {
          kind: 'refused',
          status: 0,
          detail: 'the owners have not said what their business is, so there is nothing to draw',
        })
      }

      const size = sizeFor(shape)
      if (size === null) {
        throw new CouldNotDraw('asking for the picture', {
          kind: 'refused',
          status: 0,
          detail:
            `"${shape}" is not a shape they draw. They draw ` +
            `${Object.keys(SIZES).join(', ')}`,
        })
      }

      // ---- ask for the picture ------------------------------------------------
      const started = await ask(`${base}${DRAW_PATH}`, {
        method: 'POST',
        headers: carrying,
        body: {
          model: PICTURE_MODEL,
          prompt: words,
          negative_prompt: whatToKeepOut(),
          size,
          // See the note at the top of this file. This is a policy, not a tuning
          // knob: the picture has to come from the owners' own sentence.
          prompt_extend: false,
        },
        patience: PATIENCE,
        ...(options.fetcher === undefined ? {} : { fetcher: options.fetcher }),
      })
      if (started.kind !== 'ok') throw new CouldNotDraw('asking for the picture', started)

      const taskId = String(
        at(at(started.body, 'data'), 'task_id') ??
          at(at(started.body, 'result'), 'task_id') ??
          at(started.body, 'task_id') ??
          '',
      )
      if (taskId === '') {
        throw new CouldNotDraw('asking for the picture', {
          kind: 'unreadable',
          status: started.status,
          detail: 'the reply carried no task to wait on',
        })
      }

      // ---- wait for it --------------------------------------------------------
      //
      // Their own guidance is explicit that a task nobody asks about can expire
      // and still be charged for, so this keeps asking until it has an answer or
      // its patience runs out, and never stops quietly.
      const startedAt = clock()
      for (;;) {
        await sleep(betweenAsks)

        const reply = await ask(`${base}${DRAW_PATH}/${taskId}`, {
          headers: carrying,
          patience: PATIENCE,
          ...(options.fetcher === undefined ? {} : { fetcher: options.fetcher }),
        })
        if (reply.kind !== 'ok') throw new CouldNotDraw('waiting for the picture', reply)

        const result = at(reply.body, 'data') ?? at(reply.body, 'result') ?? reply.body
        const status = String(at(result, 'status') ?? at(result, 'task_status') ?? '')

        if (status === 'success' || status === 'succeeded') {
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
            detail: `it was still "${status}" after ${Math.round(drawingPatience / 1000)} seconds`,
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
