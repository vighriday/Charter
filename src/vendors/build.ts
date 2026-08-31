/**
 * Choosing, for each outside service, between the real company and a stand-in.
 *
 * WHAT THIS DECIDES
 *
 * Charter needs four things from outside: search the live web, check and register a
 * web address, read the fields off an identity document, and put a website online.
 * Each has a real client and a stand-in that answers only from what it was given.
 *
 * This picks one of the two per service, and says in plain words which and why.
 *
 * THE RULE, AND WHY IT IS THIS WAY ROUND
 *
 * A real client is used only when BOTH are true:
 *
 *   1. `REPLAY_MODE=false` — somebody deliberately turned off saved answers.
 *   2. The credential that service needs is actually present.
 *
 * Everything else gets the stand-in. Not because the real one might fail, but
 * because the allowances are small enough to matter: 250 searches a month against
 * eight to twelve per run, and 5,000 credits a month for reading documents. A run
 * that quietly went out to the network because a key happened to be lying around
 * would spend a month's allowance during a rehearsal.
 *
 * A MISSING KEY IS NOT AN ERROR
 *
 * A fresh clone has no keys and is meant to run end to end anyway. So a missing
 * credential produces a sentence saying which service is standing in and why, and
 * nothing else. A program that refused to start because somebody had not signed up
 * to four companies would be a program nobody could evaluate.
 *
 * WHAT IS RECORDED
 *
 * Which of the two answered goes into the record for every call. The model is never
 * told. It has no basis for treating a real answer and a recorded one differently,
 * and a model that could see the difference would start reasoning about the
 * plumbing instead of about the business.
 */

import type { Settings } from '../settings.js'
import type { Services } from '../tools/services.js'
import {
  preparedIdentity,
  preparedImagery,
  preparedPublishing,
  preparedRegistrar,
  preparedSearch,
  type IdentityReader,
  type ImageryService,
  type PublishingService,
  type RegistrarService,
  type SearchService,
} from '../tools/services.js'
import { namecomRegistrar } from './namecom.js'
import { webSearch } from './search.js'
import { nutrientIdentityReader } from './nutrient.js'
import type { Fetcher } from './http.js'
import type { ReadDocument } from '../identity/fields.js'
import type { SearchAnswer, AddressQuote } from '../tools/services.js'

/** One service, and the honest sentence about which thing is behind it. */
export interface Chosen<T> {
  readonly service: T
  /** `real` or `stand-in`. Goes into the record on every call. */
  readonly kind: 'real' | 'stand-in'
  /** Why this one, in plain words. Printed, and safe to print. */
  readonly why: string
}

export interface ChosenServices extends Services {
  /** Which of the five are real, for the record and for the person watching. */
  readonly chosen: Readonly<
    Record<'search' | 'registrar' | 'identity' | 'publishing' | 'imagery', Chosen<unknown>>
  >
}

export interface ChooseOptions {
  readonly settings: Settings
  readonly caseId: string
  /** Where credentials come from. Passed in so a test needs no environment. */
  readonly env?: Record<string, string | undefined>
  readonly fetcher?: Fetcher
  /** What the stand-ins answer with, when a stand-in is chosen. */
  readonly prepared?: {
    readonly searches?: Readonly<Record<string, SearchAnswer>>
    readonly quotes?: Readonly<Record<string, AddressQuote>>
    readonly documents?: Readonly<Record<string, ReadDocument>>
  }
  /** Turns a document reference into something the reader can fetch. */
  readonly documentAt?: (
    documentRef: string,
  ) => Promise<{
    readonly where: { readonly url: string } | { readonly base64: string }
    readonly kind: string
  }>
}

const STANDING_IN =
  'It holds answers recorded in advance and has no path to the network at all, so a ' +
  'missing answer is an error rather than a quiet real call.'

/**
 * Pick the four services, and say which is which.
 *
 * Never throws for a missing credential. That is the normal state of a fresh clone
 * and the intended way to evaluate this project.
 */
export function chooseServices(options: ChooseOptions): ChosenServices {
  const env = options.env ?? process.env
  const settings = options.settings
  const prepared = options.prepared ?? {}

  // One question asked once, so the four answers cannot disagree with each other.
  const replaying = settings.replaying
  const held = (name: string): string => (env[name] ?? '').trim()

  // ---- search --------------------------------------------------------------
  const searchKeys = held('SERPAPI_KEY') !== '' || held('TAVILY_API_KEY') !== ''
  const search: Chosen<SearchService> =
    replaying || !searchKeys
      ? {
          service: preparedSearch(prepared.searches ?? {}),
          kind: 'stand-in',
          why: replaying
            ? `Saved answers, because REPLAY_MODE is true. ${STANDING_IN}`
            : `No SERPAPI_KEY or TAVILY_API_KEY is set. ${STANDING_IN}`,
        }
      : {
          service: webSearch({
            serpapiKey: held('SERPAPI_KEY'),
            tavilyKey: held('TAVILY_API_KEY'),
            // A demonstration is always a real call. Their cache lasts an hour and
            // does not count against the allowance, which is right while building
            // and a lie about freshness in a demonstration.
            freshOnly: true,
            ...(options.fetcher === undefined ? {} : { fetcher: options.fetcher }),
          }),
          kind: 'real',
          why:
            'The live web, through the search service. Two companies answer the same ' +
            'question and the second takes over if the first cannot; which one ' +
            'answered goes into the record and is never shown to the model.',
        }

  // ---- the registrar -------------------------------------------------------
  const registrarUser = held(
    settings.registrarEnv === 'live' ? 'NAMECOM_USERNAME_LIVE' : 'NAMECOM_USERNAME_TEST',
  )
  const registrarToken = held(
    settings.registrarEnv === 'live' ? 'NAMECOM_TOKEN_LIVE' : 'NAMECOM_TOKEN_TEST',
  )
  const registrarKeys = registrarUser !== '' && registrarToken !== ''

  const registrar: Chosen<RegistrarService> =
    replaying || !registrarKeys
      ? {
          service: preparedRegistrar(prepared.quotes ?? {}),
          kind: 'stand-in',
          why: replaying
            ? `Saved answers, because REPLAY_MODE is true. Nothing is registered and ` +
              `nothing is charged. ${STANDING_IN}`
            : `The ${settings.registrarEnv} username and token are not both set. ` +
              `Nothing is registered and nothing is charged. ${STANDING_IN}`,
        }
      : {
          service: namecomRegistrar({
            environment: settings.registrarEnv,
            username: registrarUser,
            token: registrarToken,
            mayspendRealMoney: settings.spendRealMoney,
            caseId: options.caseId,
            ...(env['NAMECOM_BASE_URL_TEST'] !== undefined && settings.registrarEnv === 'test'
              ? { baseUrl: held('NAMECOM_BASE_URL_TEST') }
              : {}),
            ...(options.fetcher === undefined ? {} : { fetcher: options.fetcher }),
          }),
          kind: 'real',
          why:
            settings.registrarEnv === 'test'
              ? 'The registrar’s PRACTICE account, which is a separate account at a ' +
                'separate address. Identical paths and identical validation, and ' +
                'nothing registered there is real.'
              : 'The registrar’s LIVE account. Registering spends real money and ' +
                'cannot be undone, and it needed two settings to get here.',
        }

  // ---- reading identity documents ------------------------------------------
  const identityKey = held('NUTRIENT_EXTRACTION_KEY')
  const canRead = identityKey !== '' && options.documentAt !== undefined

  const identity: Chosen<IdentityReader> =
    replaying || !canRead
      ? {
          service: preparedIdentity(prepared.documents ?? {}),
          kind: 'stand-in',
          why: replaying
            ? `Documents recorded in advance, because REPLAY_MODE is true. No real ` +
              `person’s identity document is involved. ${STANDING_IN}`
            : identityKey === ''
              ? `NUTRIENT_EXTRACTION_KEY is not set. ${STANDING_IN}`
              : `No way to fetch a document was provided, so there is nothing to send. ` +
                `${STANDING_IN}`,
        }
      : {
          service: nutrientIdentityReader({
            extractionKey: identityKey,
            documentAt: options.documentAt as NonNullable<ChooseOptions['documentAt']>,
            ...(options.fetcher === undefined ? {} : { fetcher: options.fetcher }),
          }),
          kind: 'real',
          why:
            'The reading service, at the depth EXTRACTION_DEPTH names. It reads and ' +
            'decides nothing: whether a value needs a person is worked out afterwards ' +
            'in plain code, and no model takes part in it.',
        }

  // ---- assembling and publishing -------------------------------------------
  //
  // Always the stand-in today, and said plainly rather than left to be discovered.
  // The pack itself is assembled and sealed by Charter's own code, so the part
  // that matters is not waiting on anybody.
  const publishing: Chosen<PublishingService> = {
    service: preparedPublishing(),
    kind: 'stand-in',
    why:
      'Publishing the website is not built yet. The pack itself is assembled and ' +
      'sealed by Charter’s own code and does not go through any outside company, ' +
      'so what is standing in here is putting the finished site online.',
  }

  // ---- drawing the storefront ------------------------------------------------
  //
  // Always the stand-in today, and said plainly. The words it would send are the
  // owners' own, read from the record, so what a run shows is exactly what would
  // have been drawn.
  const imagery: Chosen<ImageryService> = {
    service: preparedImagery(),
    kind: 'stand-in',
    why:
      'Drawing the storefront picture is not wired to the real service yet. The ' +
      'words it would send are the owners\' own, read from the record, so a run ' +
      'shows exactly what would have been drawn. No photograph of any person is ' +
      'ever sent, and that company\'s face and skin tools are absent from every ' +
      'stage of this project.',
  }

  return {
    search: search.service,
    registrar: registrar.service,
    identity: identity.service,
    publishing: publishing.service,
    imagery: imagery.service,
    chosen: { search, registrar, identity, publishing, imagery },
  }
}

/** The four lines a person reads before a run starts. */
export function describeChoices(services: ChosenServices): readonly string[] {
  return Object.entries(services.chosen).map(
    ([name, chosen]) => `${name.padEnd(11)}${chosen.kind === 'real' ? 'REAL' : 'stand-in'}  ${chosen.why}`,
  )
}

/** How many of the five are talking to a real company. */
export function howManyAreReal(services: ChosenServices): number {
  return Object.values(services.chosen).filter((one) => one.kind === 'real').length
}
