/**
 * The outside world, described as narrowly as Charter actually needs it.
 *
 * WHAT THIS FILE IS
 *
 * Every service Charter talks to, written as the smallest possible description of
 * what we want from it. Not what the vendor offers — what we use.
 *
 * WHY THAT NARROWNESS IS DELIBERATE
 *
 * Three reasons, and the third is the one that matters most here.
 *
 * **A vendor can be replaced without touching anything else.** The search
 * description below says "run a query, get back titles and addresses." Two
 * different companies sit behind it, and nothing above this file knows which one
 * answered — including the model.
 *
 * **Tests need no accounts.** Every test in this project passes a stand-in, so the
 * whole suite runs with no keys, no network and no cost. Three of the challenges
 * this project enters require that a stranger can clone it and run it.
 *
 * **The record stays honest about which service was used.** Because the swap
 * happens here rather than inside a tool, the fact that the second service
 * answered is a real fact this file returns, and it goes into the record. Hiding a
 * fallback from the model is sensible; hiding it from the record would not be.
 *
 * WHY THE MODEL IS NEVER TOLD WHICH SERVICE ANSWERED
 *
 * If the model can see that one search service was used and not the other, it can
 * start reasoning about the services instead of about the business — asking to
 * retry with "the other one", or treating results as more or less trustworthy
 * based on where they came from. It has no basis for either judgement. So the
 * result handed back names no vendor, and the vendor's name goes only into the
 * record, where a person can see it.
 */

// ─────────────────────────────────────────────────────────────────────────────
// Searching the live web
// ─────────────────────────────────────────────────────────────────────────────

import type { ReadDocument } from '../identity/fields.js'

export interface SearchHit {
  readonly title: string
  readonly url: string
  /** The short piece of text the search service shows under the title. */
  readonly snippet: string
}

export interface SearchAnswer {
  readonly hits: readonly SearchHit[]
  /**
   * Which service answered.
   *
   * Recorded, never returned to the model. See the note at the top of this file.
   */
  readonly answeredBy: string
}

export interface SearchService {
  /**
   * Run one query and return what came back.
   *
   * Charter's primary search service allows 250 searches a **month**, and one run
   * uses three to six. Forty runs while developing would exhaust a month's
   * allowance before a single repeated test, so results are cached by the exact
   * query text from the very first commit rather than added later.
   */
  search(query: string): Promise<SearchAnswer>
}

// ─────────────────────────────────────────────────────────────────────────────
// The web address registrar
// ─────────────────────────────────────────────────────────────────────────────

export interface AddressQuote {
  readonly domain: string
  readonly available: boolean
  /** The first year's price in whole cents, as text. Absent when it is taken. */
  readonly priceCents?: string
}

export interface AddressRegistration {
  readonly domain: string
  /** What was actually charged, in whole cents, as text. */
  readonly chargedCents: string
  /** True when this went to the registrar's free sandbox and nothing real happened. */
  readonly sandbox: boolean
}

/**
 * One address record, which is how a name is pointed at a machine.
 *
 * `kind` is the record type in the registrar's own vocabulary. `A` points a name
 * at a numbered address. `CNAME` points a name at another name. `TXT` holds text,
 * which is how most services ask you to prove you hold a name.
 */
export interface AddressRecord {
  /** The part in front, or empty for the name itself. `www` gives www.example.com. */
  readonly host: string
  readonly kind: 'A' | 'CNAME' | 'TXT'
  /** Where it points, or the text it holds. */
  readonly answer: string
  /** How long anybody may remember it, in seconds. */
  readonly ttl: string
}

export interface RegistrarService {
  /** Is this address free, and what would it cost? Costs nothing to ask. */
  quote(domain: string): Promise<AddressQuote>
  /**
   * Register the address. Spends money and cannot be undone.
   *
   * Nothing in this project calls this without a recorded human permission
   * covering the price — that check is in `guard.ts` and runs before the tool
   * does. The check is not in here on purpose: a rule enforced inside the thing it
   * governs is a rule that moves when the thing is replaced.
   */
  register(domain: string, priceCents: string): Promise<AddressRegistration>
  /**
   * Write address records, so the name points at the website.
   *
   * Free, and not the same act as registering. A name with no records is a name
   * nobody can reach, so registering without this leaves the owners holding
   * something that does not work.
   */
  setRecords(domain: string, records: readonly AddressRecord[]): Promise<void>
  /**
   * Read the records back from the registrar.
   *
   * WHY READING BACK IS A SEPARATE ACT
   *
   * Writing returns success. Success means the request was accepted, not that
   * anything was stored. Reading back is the only way to find out what the
   * registrar actually holds, and it is the difference between "we sent it" and
   * "they have it".
   *
   * It proves the registrar stored a row. It does NOT prove anything resolves
   * anywhere, and nothing in this project may say otherwise: the registrar's own
   * testing guide states that record changes in their practice environment succeed
   * through the interface but do not become publicly answerable.
   */
  listRecords(domain: string): Promise<readonly AddressRecord[]>
}

// ─────────────────────────────────────────────────────────────────────────────
// Everything together
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Reads the fields off an identity document.
 *
 * It reads. It does not decide anything. Whether a value needs a person is worked
 * out afterwards in plain code, from what came back here and from what the owners
 * already told us, and no model takes part in it.
 */
export interface IdentityReader {
  /**
   * Read one document.
   *
   * `depth` is how hard the service is asked to work, in its own words. It is
   * passed in rather than defaulted, and it comes from a setting that is checked
   * before anything runs, so a run cannot be quietly cheaper in development than
   * in a demonstration and the record says which depth was used.
   *
   * The two cheapest depths return characters and layout and cannot say which
   * marks on the page are the date of birth, so they are refused rather than
   * accepted. The price difference between cheapest and dearest is about three
   * and a half times, which is not the reason for choosing deliberately — the
   * reason is that the cheap ones cannot do the job at all.
   */
  read(owner: string, documentRef: string, depth: string): Promise<ReadDocument>
}

/**
 * Draws a picture for the new business's website from the owners' own words.
 *
 * WHY A BUSINESS FORMED THIS MORNING NEEDS THIS
 *
 * It owns no photographs. It has no shopfront yet, no products photographed, no
 * staff pictures. The one thing it does have is the sentence its owners typed when
 * they described what they were building, and that sentence is already in the
 * record because it started the legal work.
 *
 * WHAT IS DELIBERATELY NOT USED
 *
 * The company behind this also sells face analysis, skin analysis and face
 * swapping. None of them appears in any tool list, none is reachable from
 * anything the model can trigger, and no photograph of any person is ever sent.
 * A business formation tool has no business touching anybody's face.
 */
export interface ImageryService {
  /**
   * Draw one picture from a description.
   *
   * `prompt` is the owners' own words about their business, not something a model
   * wrote about them. What comes back is a picture and the exact words that
   * produced it, so the record can show both.
   */
  draw(prompt: string, shape: string): Promise<DrawnPicture>
}

export interface DrawnPicture {
  /** Where the picture is, once it exists. */
  readonly url: string
  /** How wide and tall, as the service returned it. */
  readonly shape: string
  /** The words that produced it, kept so the record can show them. */
  readonly fromWords: string
  /** Which company drew it. Recorded, never returned to the model. */
  readonly drawnBy: string
}

/** Turns the finished documents into one file, and puts the website online. */
export interface PublishingService {
  /**
   * Merge everything into one file and hand back its bytes.
   *
   * The bytes come back rather than a reference, because the fingerprint has to be
   * taken of exactly what was sealed. A reference to a file somebody else holds
   * could point at different bytes a moment later.
   */
  buildPack(caseId: string, parts: readonly string[]): Promise<Uint8Array>
  /** Put the site online at an address that is already registered. */
  publish(caseId: string, address: string): Promise<{ readonly liveAt: string }>
}

export interface Services {
  readonly search: SearchService
  readonly registrar: RegistrarService
  readonly identity: IdentityReader
  readonly publishing: PublishingService
  readonly imagery: ImageryService
}

// ─────────────────────────────────────────────────────────────────────────────
// Stand-ins
// ─────────────────────────────────────────────────────────────────────────────

export class NoRecordedAnswer extends Error {
  constructor(what: string) {
    super(
      `${what}\n\n` +
        `Nothing was called. This stand-in has no path to the network at all, which ` +
        `is deliberate: a missing recorded answer must be an error, never a quiet ` +
        `real call. A test that silently reaches a live service is a test that ` +
        `spends a limited allowance and passes for the wrong reason.`,
    )
    this.name = 'NoRecordedAnswer'
  }
}

/**
 * A search service that answers only from what it was given.
 *
 * There is no network path in here. A query with no prepared answer is an error,
 * not a fall back to a real call — the same rule the recorded-response cache
 * follows, and for the same reason.
 */
export function preparedSearch(
  answers: Readonly<Record<string, SearchAnswer>>,
): SearchService {
  return {
    async search(query: string): Promise<SearchAnswer> {
      const answer = answers[query]
      if (answer === undefined) {
        throw new NoRecordedAnswer(
          `no recorded answer for the search "${query}". Prepared: ` +
            `${Object.keys(answers).map((q) => `"${q}"`).join(', ') || 'nothing'}.`,
        )
      }
      return answer
    },
  }
}

/**
 * A registrar that answers only from what it was given, and counts what it did.
 *
 * `registered` is what the tests read to prove that a registration did *not*
 * happen when permission was missing. Proving the refusal by checking that nothing
 * was charged is stronger than checking that an error was thrown, because an
 * error thrown after the charge would still be an error.
 */
/**
 * An identity reader that answers only from documents recorded in advance.
 *
 * Nothing is uploaded and no real person's document is involved. A request for
 * something nobody prepared is an error rather than a quiet real call, which is
 * the same rule the rest of this project runs on.
 */
export function preparedIdentity(
  documents: Readonly<Record<string, ReadDocument>>,
): IdentityReader & { readonly readCalls: readonly { readonly owner: string; readonly depth: string }[] } {
  const readCalls: { owner: string; depth: string }[] = []
  return {
    readCalls,
    async read(owner: string, documentRef: string, depth: string): Promise<ReadDocument> {
      const prepared = documents[documentRef]
      if (prepared === undefined) {
        throw new NoRecordedAnswer(
          `no recorded reading for the document "${documentRef}". Prepared: ` +
            `${Object.keys(documents).map((one) => `"${one}"`).join(', ') || 'nothing'}.`,
        )
      }
      readCalls.push({ owner, depth })
      return { ...prepared, owner, depth }
    },
  }
}

/**
 * A publisher that invents nothing and reaches nothing.
 *
 * The pack it builds is made from the names of its parts, so the same parts always
 * produce the same bytes and therefore the same fingerprint. That is what lets a
 * test assert a fingerprint at all.
 */
export function preparedPublishing(): PublishingService & {
  readonly published: readonly { readonly caseId: string; readonly address: string }[]
} {
  const published: { caseId: string; address: string }[] = []
  return {
    published,
    async buildPack(caseId: string, parts: readonly string[]): Promise<Uint8Array> {
      return new TextEncoder().encode(`pack for ${caseId} containing ${parts.join(', ')}`)
    },
    async publish(caseId: string, address: string): Promise<{ readonly liveAt: string }> {
      published.push({ caseId, address })
      return { liveAt: `https://${address}` }
    },
  }
}

/**
 * An imagery service that draws nothing and reaches nothing.
 *
 * It hands back a description of the picture that would have been drawn, together
 * with the exact words that would have produced it. A run therefore shows what was
 * asked for and what it would have cost, without an account and without a request.
 */
export function preparedImagery(): ImageryService & {
  readonly asked: readonly { readonly prompt: string; readonly shape: string }[]
} {
  const asked: { prompt: string; shape: string }[] = []
  return {
    asked,
    async draw(prompt: string, shape: string): Promise<DrawnPicture> {
      asked.push({ prompt, shape })
      return {
        url: 'prepared:storefront',
        shape,
        fromWords: prompt,
        drawnBy: 'a stand-in. No picture was drawn and nothing was sent anywhere',
      }
    },
  }
}

export function preparedRegistrar(
  quotes: Readonly<Record<string, AddressQuote>>,
): RegistrarService & {
  readonly registered: readonly AddressRegistration[]
  /** What the registrar is holding, so a test can read it back the way a person would. */
  readonly held: ReadonlyMap<string, readonly AddressRecord[]>
} {
  const registered: AddressRegistration[] = []
  const held = new Map<string, readonly AddressRecord[]>()
  return {
    registered,
    held,
    async setRecords(domain: string, records: readonly AddressRecord[]): Promise<void> {
      if (!registered.some((one) => one.domain === domain)) {
        throw new NoRecordedAnswer(
          `${domain} has not been registered, so there is nothing to write records ` +
            `against. Pointing a name nobody holds is pointing at somebody else's name.`,
        )
      }
      held.set(domain, records)
    },
    async listRecords(domain: string): Promise<readonly AddressRecord[]> {
      return held.get(domain) ?? []
    },
    async quote(domain: string): Promise<AddressQuote> {
      const quote = quotes[domain]
      if (quote === undefined) {
        throw new NoRecordedAnswer(
          `no recorded answer for the address "${domain}". Prepared: ` +
            `${Object.keys(quotes).map((d) => `"${d}"`).join(', ') || 'nothing'}.`,
        )
      }
      return quote
    },
    async register(domain: string, priceCents: string): Promise<AddressRegistration> {
      const registration: AddressRegistration = { domain, chargedCents: priceCents, sandbox: true }
      registered.push(registration)
      return registration
    },
  }
}
