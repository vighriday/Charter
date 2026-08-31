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

import { ask, describeReply, type Fetcher } from './http.js'
import type { IdentityReader } from '../tools/services.js'
import {
  MATCH_LABELS,
  REQUIRED_FIELDS,
  type ExtractedField,
  type MatchLabel,
  type ReadDocument,
} from '../identity/fields.js'

export const EXTRACTION_HOST = 'https://api.nutrient.io'
export const EXTRACTION_PATH = '/extraction/parse'

export class CouldNotRead extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'CouldNotRead'
  }
}

export interface NutrientOptions {
  /** The EXTRACTION key. The processor key is refused here with a 403. */
  readonly extractionKey: string
  /** Turns an owner's document reference into the bytes to send. */
  readonly documentAt: (
    documentRef: string,
  ) => Promise<{
    /** Where the document is, or the document itself. Never both. */
    readonly where: { readonly url: string } | { readonly base64: string }
    /** What kind of document the owner said it is. Recorded, never guessed. */
    readonly kind: string
  }>
  readonly baseUrl?: string
  readonly fetcher?: Fetcher
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

/** Pull the named fields out of their reply, whichever shape it used. */
export function fieldsFrom(body: unknown): readonly ExtractedField[] {
  if (body === null || typeof body !== 'object') return []
  const bag = body as Record<string, unknown>

  const holder =
    (bag['data'] as Record<string, RawField> | undefined) ??
    (bag['fields'] as Record<string, RawField> | undefined) ??
    (bag['result'] as Record<string, RawField> | undefined)

  if (holder === null || typeof holder !== 'object') return []

  const out: ExtractedField[] = []
  for (const [name, raw] of Object.entries(holder)) {
    if (raw === null || typeof raw !== 'object') continue

    // A value that is not text is not usable in a document, so it is dropped here
    // and shows up as a missing required field — which sends it to a person,
    // rather than putting something unprintable into a legal document.
    const value = (raw as RawField).value
    if (typeof value !== 'string') continue

    const confidence = readConfidence(raw as RawField)
    out.push({
      name,
      value: value.trim(),
      label: readLabel(raw as RawField),
      ...(confidence === undefined ? {} : { confidence }),
    })
  }

  return out
}

export function nutrientIdentityReader(options: NutrientOptions): IdentityReader {
  const base = options.baseUrl ?? EXTRACTION_HOST

  return {
    async read(owner: string, documentRef: string, depth: string): Promise<ReadDocument> {
      const document = await options.documentAt(documentRef)

      const reply = await ask(`${base}${EXTRACTION_PATH}`, {
        method: 'POST',
        headers: { authorization: `Bearer ${options.extractionKey}` },
        body: {
          // Their own four names for how hard to work. Passed straight through and
          // recorded with the result, so a run cannot be quietly cheaper in
          // development than in a demonstration.
          mode: depth,
          // Exactly the fields a formation packet needs, and no more. Asking for
          // everything a passport carries would mean holding a person's details
          // Charter has no use for, which is a thing to avoid rather than a
          // thing to tidy up later.
          schema: Object.fromEntries(REQUIRED_FIELDS.map((name) => [name, { type: 'string' }])),
          document: document.where,
        },
        ...(options.fetcher === undefined ? {} : { fetcher: options.fetcher }),
      })

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

      return { owner, kind: document.kind, depth, fields }
    },
  }
}
