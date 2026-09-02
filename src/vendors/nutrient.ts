/**
 * Reading the fields off an owner's identity document.
 *
 * WHAT THIS DOES AND WHAT IT DELIBERATELY DOES NOT
 *
 * It reads. It returns the values it found, a label per field saying whether that
 * value can actually be located in the source document, and the reader's own
 * confidence score.
 *
 * **It decides nothing.** Whether a value needs a person is worked out afterwards,
 * in plain code, from what came back here and from what the owners already told
 * us. No model takes any part in it, and neither does this file.
 *
 * The vendor says plainly that they are an extraction layer and not identity
 * verification. So neither is Charter. Nothing built on this may say a document was
 * verified, or that a person's identity was confirmed. What it can say is: these
 * values were read off this document, here is where each one was found, and here is
 * the list a person has to look at.
 *
 * TWO PRODUCTS AND TWO KEYS
 *
 * Reading named fields is a separate product from the general document processor,
 * with its own key and its own account. The processor key used against this service
 * comes back 403 — "I know you, but not here" — which is what makes
 * `npm run keys:classify` able to tell one from the other without processing
 * anything.
 *
 * The prefix does not tell you which product a key is. Ours begins "pdf_live_",
 * which reads like the processor, and is the extraction key.
 *
 * THE LABEL IS TESTED BEFORE THE SCORE, AND THAT IS THE POINT
 *
 * Their own guide states the confidence score "is relative and uncalibrated; it
 * isn't a probability or percentage", and their own routing recommendation puts the
 * match label first and the score last. Charter does the same. Routing on the
 * number would have been the obvious thing to build, and for a project whose whole
 * argument is *check it yourself*, routing on the one signal nobody can check would
 * have been the wrong choice made loudly.
 */

import { describeReply, readAnswer, type Fetcher, type Reply } from './http.js'
import type { IdentityReader } from '../tools/services.js'
import {
  MATCH_LABELS,
  REQUIRED_FIELDS,
  type ExtractedField,
  type MatchLabel,
  type ReadDocument,
} from '../identity/fields.js'

/**
 * How long to wait for one reading, in milliseconds.
 *
 * Longer than the shared default. Reading a document is real work on their side —
 * a page of a scanned licence took a little over a second in testing, and a
 * multi-page document takes several. A limit tuned for a quick question turns a
 * service that was about to answer into a run that says nothing was learned.
 */
export const READING_PATIENCE = 60_000

export const EXTRACTION_HOST = 'https://api.nutrient.io'

/**
 * The endpoint that reads named fields, and the three ways this file used to get
 * it wrong.
 *
 * WHY THIS NOTE IS HERE
 *
 * Every one of these was written from the documentation, was covered by tests that
 * passed, and was wrong. They were wrong because nothing ever called the service:
 * the tests handed this file a written-out reply of the shape the code expected,
 * so they proved the code agreed with itself. The first real call found all three
 * in ten minutes.
 *
 *   1. **The wrong endpoint.** `/extraction/parse` reads a document's layout and
 *      never returns named fields, whatever it is asked for. `/extraction/extract`
 *      is the one that takes a list of fields and returns them.
 *
 *   2. **The wrong request.** The document goes up as a file, in a form, and the
 *      options travel beside it in a part called `instructions`. Sent as JSON with
 *      the document inside it, the service answers "a file upload or url is
 *      required" — and it answers that for a request that named the fields
 *      perfectly well.
 *
 *   3. **The wrong reply.** The values arrive under `output.data`, one name to one
 *      string. The label and the score for each of them arrive separately, under
 *      `output.metadata`. Code that looked for a value and its label together
 *      found neither and reported a document with nothing in it.
 *
 * The third is the dangerous one. A document read perfectly, misread here as
 * empty, is a run that reports no values needing a person — which reads exactly
 * like a clean document.
 */
export const EXTRACTION_PATH = '/extraction/extract'

export class CouldNotRead extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'CouldNotRead'
  }
}

export interface NutrientOptions {
  /** The EXTRACTION key. The processor key is refused here with a 403. */
  readonly extractionKey: string
  /**
   * Finds the document to send.
   *
   * Given the owner as well as the reference, because the document Charter reads
   * in a demonstration is one it writes for that owner by name. See
   * `src/identity/specimen.ts` for why it is never a real person's.
   */
  readonly documentAt: (asked: {
    readonly owner: string
    readonly documentRef: string
  }) => Promise<FoundDocument>
  readonly baseUrl?: string
  readonly fetcher?: Fetcher
}

/** A document that was found, and is about to be sent. */
export interface FoundDocument {
  /**
   * The document itself.
   *
   * The bytes, not a web address. The service will fetch an address if given one,
   * and Charter deliberately does not use that: it would mean the owners' identity
   * document had to sit at an address somebody else could reach, for as long as
   * the reading took. Sending the bytes means the document exists in this process
   * and in their request, and nowhere in between.
   */
  readonly bytes: Uint8Array
  /** What kind of document the owner said it is. Recorded, never guessed. */
  readonly kind: string
  /**
   * Whether this is a specimen rather than a real person's document.
   *
   * Carried all the way through to the record. A run that read a made up
   * document must never look like a run that read somebody's passport.
   */
  readonly specimen: boolean
}

/** The shape one field comes back in, as far as Charter uses it. */
interface RawField {
  readonly value?: unknown
  readonly confidence?: unknown
  readonly match?: unknown
  readonly match_type?: unknown
  readonly label?: unknown
}

/**
 * Turn whatever label came back into one of the five Charter knows.
 *
 * Anything unrecognised becomes `not_found`, which is the answer that sends the
 * value to a person. That direction is deliberate and it is the only safe one: a
 * label nobody recognised is not evidence that a value is fine, and treating it as
 * fine would let a vendor add a new label and quietly reduce our oversight.
 */
export function readLabel(raw: RawField): MatchLabel {
  for (const candidate of [raw.match, raw.match_type, raw.label]) {
    if (typeof candidate !== 'string') continue
    const cleaned = candidate.trim().toLowerCase()
    if ((MATCH_LABELS as readonly string[]).includes(cleaned)) return cleaned as MatchLabel
  }
  return 'not_found'
}

/**
 * Read a confidence score, or say there was not one.
 *
 * Absent means unavailable, not low. Those are different things and the review
 * treats them differently, so a missing score must never become a zero — a zero
 * would read as "the reader was certain this was wrong".
 */
export function readConfidence(raw: RawField): number | undefined {
  const value = raw.confidence
  if (typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1) {
    return value
  }
  // Some replies give it as a percentage. 0 to 100 turned into 0 to 1, and
  // anything outside both ranges treated as no score at all rather than guessed.
  if (typeof value === 'number' && Number.isFinite(value) && value > 1 && value <= 100) {
    return value / 100
  }
  return undefined
}

/**
 * Pull the named fields out of their reply.
 *
 * THE SHAPE, AND WHY IT IS TWO PLACES AND NOT ONE
 *
 * The values arrive under `output.data`, as one name to one string. What is known
 * *about* each of those values — whether it was found exactly or only
 * approximately, and how sure the reader was — arrives separately under
 * `output.metadata`, keyed by the same names.
 *
 *     "output": {
 *       "data":     { "full_name": "ANA RIVERA" },
 *       "metadata": { "full_name": { "match": "id_match", "confidence": 0.95 } }
 *     }
 *
 * So reading a field means reading two places and joining them by name. A value
 * with no entry in the second place is not an error and is not fine either: it
 * comes back with the label `not_found`, which is the answer that sends it to a
 * person. That direction is the only safe one — a value nobody said anything
 * about is not evidence that the value is right.
 */
export function fieldsFrom(body: unknown): readonly ExtractedField[] {
  const output = at(body, 'output')
  const values = at(output, 'data')
  const about = at(output, 'metadata')

  if (values === null || typeof values !== 'object') return []

  const out: ExtractedField[] = []
  for (const [name, value] of Object.entries(values as Record<string, unknown>)) {
    // A value that is not text is not usable in a document, so it is dropped here
    // and shows up as a missing required field — which sends it to a person,
    // rather than putting something unprintable into a legal document.
    if (typeof value !== 'string' || value.trim() === '') continue

    const raw = (at(about, name) ?? {}) as RawField
    const confidence = readConfidence(raw)
    out.push({
      name,
      value: value.trim(),
      label: readLabel(raw),
      ...(confidence === undefined ? {} : { confidence }),
    })
  }

  return out
}

/** One field off something that might not be an object at all. */
function at(body: unknown, field: string): unknown {
  if (body === null || typeof body !== 'object') return undefined
  return (body as Record<string, unknown>)[field]
}

export function nutrientIdentityReader(options: NutrientOptions): IdentityReader {
  const base = options.baseUrl ?? EXTRACTION_HOST

  return {
    async read(owner: string, documentRef: string, depth: string): Promise<ReadDocument> {
      const document = await options.documentAt({ owner, documentRef })

      // Sent as a form rather than as JSON, because that is what the service
      // accepts: the document is a file part, and everything else travels beside
      // it in a part called `instructions`. Sent any other way it answers "a file
      // upload or url is required", however well the rest of the request is
      // written. See the note on EXTRACTION_PATH.
      const form = new FormData()
      form.append(
        'file',
        new Blob([new Uint8Array(document.bytes)], { type: 'application/pdf' }),
        'document.pdf',
      )
      form.append(
        'instructions',
        JSON.stringify({
          // Their own names for how hard to work. Passed straight through and
          // recorded with the result, so a run cannot be quietly cheaper in
          // development than in a demonstration.
          mode: depth,
          // Exactly the fields a formation packet needs, and no more. Asking for
          // everything a passport carries would mean holding a person's details
          // Charter has no use for, which is a thing to avoid rather than a
          // thing to tidy up later.
          schema: {
            type: 'object',
            properties: Object.fromEntries(
              REQUIRED_FIELDS.map((name) => [name, { type: 'string' }]),
            ),
            required: [...REQUIRED_FIELDS],
          },
        }),
      )

      const reply = await askWithForm(`${base}${EXTRACTION_PATH}`, form, {
        authorization: `Bearer ${options.extractionKey}`,
      }, options.fetcher)

      if (reply.kind === 'not-allowed-here') {
        throw new CouldNotRead(
          `Nutrient knows this key and will not accept it for reading fields (403). ` +
            `That is what the DOCUMENT PROCESSOR key looks like against this service: ` +
            `they are two separate products with two separate accounts. Run ` +
            `"npm run keys:classify", which asks both directly and costs nothing.`,
        )
      }

      if (reply.kind !== 'ok') {
        throw new CouldNotRead(
          `${owner}'s document was not read: Nutrient ${describeReply(reply)}. Nothing ` +
            `was returned, and nothing is assumed about the document.`,
        )
      }

      const fields = fieldsFrom(reply.body)

      // An empty reading is an error, not an empty document. A service that
      // answered with no fields at all has told us nothing, and a run that carried
      // on would show "no values needed checking" — which reads exactly like a
      // clean document.
      if (fields.length === 0) {
        throw new CouldNotRead(
          `Nutrient answered about ${owner}'s document and named no fields at all. ` +
            `That is not a document with nothing in it; it is an answer that says ` +
            `nothing. Carrying on would show "no values needed checking", which reads ` +
            `exactly like a clean document.`,
        )
      }

      return { owner, kind: document.kind, depth, fields, specimen: document.specimen }
    },
  }
}

/**
 * Ask, with a form rather than with JSON, and turn the answer into the same thing
 * `ask` would have.
 *
 * WHY THIS IS NOT JUST `ask`
 *
 * `ask` builds the request itself and writes a content type on it. A form must be
 * given to the runtime without one, so that the runtime can write its own with the
 * separator it invented for that particular form. Setting it by hand produces a
 * request the other end cannot take apart, and the error it gives back is about
 * the contents rather than about the separator, which is a long afternoon.
 *
 * Everything after the sending is the same, so the grouping of statuses by what a
 * caller would do about them lives in one place and not two.
 */
async function askWithForm(
  url: string,
  form: FormData,
  headers: Readonly<Record<string, string>>,
  fetcher: Fetcher | undefined,
): Promise<Reply> {
  const send = fetcher ?? ((target: string, init: RequestInit) => fetch(target, init))

  let response: Response
  try {
    response = await send(url, {
      method: 'POST',
      headers: { accept: 'application/json', ...headers },
      body: form,
      signal: AbortSignal.timeout(READING_PATIENCE),
    })
  } catch (error) {
    return {
      kind: 'never-arrived',
      detail: error instanceof Error ? error.message : String(error),
    }
  }

  const text = await response.text().catch(() => '')
  return readAnswer(response.status, text)
}
