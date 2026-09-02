/**
 * Choosing, for each outside service, between the real company and a stand-in.
 *
 * WHAT THIS DECIDES
 *
 * Charter needs several things from outside: search the live web, check and
 * register a web address, read the fields off an identity document, join the pack
 * together and read its text back, put a website online, and draw the new
 * business's first picture. Each has a real client and a stand-in.
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
  type DocumentService,
  type IdentityReader,
  type ImageryService,
  type PublishingService,
  type RegistrarService,
  type SearchService,
} from '../tools/services.js'
import { buildSpecimenDocument, SPECIMEN_KIND } from '../identity/specimen.js'
import { foxitDocuments } from './foxit.js'
import { joinHere } from '../pack/join.js'
import { namecomRegistrar } from './namecom.js'
import { webSearch } from './search.js'
import { nutrientIdentityReader, type FoundDocument } from './nutrient.js'
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
  /** Which of them are real, for the record and for the person watching. */
  readonly chosen: Readonly<
    Record<
      'search' | 'registrar' | 'identity' | 'documents' | 'publishing' | 'imagery',
      Chosen<unknown>
    >
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
  /**
   * Where the owners' identity documents come from.
   *
   * Left out by almost everybody. When it is left out, Charter writes a specimen
   * document for the owner by name and reads that. Somebody running this on their
   * own machine, against their own documents, passes their own finder here.
   */
  readonly documentAt?: (asked: {
    readonly owner: string
    readonly documentRef: string
  }) => Promise<FoundDocument>
}

const STANDING_IN =
  'It gives back answers recorded in advance and has no way of reaching the internet ' +
  'at all, so a missing answer stops the run rather than quietly becoming a real call.'

/**
 * Pick each service, and say which is which.
 *
 * Never throws for a missing credential. That is the normal state of a fresh clone
 * and the intended way to evaluate this project.
 */
export function chooseServices(options: ChooseOptions): ChosenServices {
  const env = options.env ?? process.env
  const settings = options.settings
  const prepared = options.prepared ?? {}

  // One question asked once, so the answers cannot disagree with each other.
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
            ? `Answers recorded in advance, because this is a replay. ${STANDING_IN}`
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
            'The real web. Two companies answer the same question and the second ' +
            'takes over if the first cannot. Which one answered is written down, and ' +
            'Charter is never told which.',
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
            ? `Answers recorded in advance, because this is a replay. Nothing is ` +
              `registered and nobody is charged. ${STANDING_IN}`
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
              ? 'The registrar’s practice account, which is a separate account at a ' +
                'separate address. Same steps, same checks, and nothing registered ' +
                'there is real.'
              : 'The registrar’s real account. Registering here spends real money ' +
                'and cannot be undone, and two separate settings had to be turned on ' +
                'to reach it.',
        }

  // ---- reading identity documents ------------------------------------------
  //
  // No caller has to provide a document. Charter writes one, for the owner named
  // in the run, clearly marked a specimen on its face, and that is deliberate
  // rather than a shortcut: this is a demonstration strangers run from a website,
  // and asking a stranger to upload their passport so that a demonstration can
  // read it would be a worse thing than anything this project prevents.
  //
  // The reading is completely real. The person is not, and that fact travels with
  // the result into the record. See src/identity/specimen.ts.
  const identityKey = held('NUTRIENT_EXTRACTION_KEY')

  const identity: Chosen<IdentityReader> =
    replaying || identityKey === ''
      ? {
          service: preparedIdentity(prepared.documents ?? {}),
          kind: 'stand-in',
          why: replaying
            ? `Documents recorded in advance, because this is a replay. No real ` +
              `person’s ID is involved and nothing was sent anywhere. ${STANDING_IN}`
            : `NUTRIENT_EXTRACTION_KEY is not set. ${STANDING_IN}`,
        }
      : {
          service: nutrientIdentityReader({
            extractionKey: identityKey,
            documentAt: options.documentAt ?? specimenFor,
            ...(options.fetcher === undefined ? {} : { fetcher: options.fetcher }),
          }),
          kind: 'real',
          why:
            'The reading service, at the depth EXTRACTION_DEPTH names. The document ' +
            'it reads is one Charter wrote for a made up person and marked a ' +
            'specimen on its face, because nobody should be asked to hand a real ' +
            'identity document to a demonstration. The reading is real: it reads ' +
            'and decides nothing, and whether a value needs a person is worked out ' +
            'afterwards in plain code, with no model taking part.',
        }

  // ---- joining, reading back, and shrinking the pack ------------------------
  //
  // The one service whose stand-in does real work. Joining is genuine either way:
  // with a key it goes out to the document service, and without one it happens
  // here with the same result, because a fresh clone has to produce a real pack.
  //
  // What only the real service can do is read the finished pack back out. That
  // check is worth having precisely because the reader is a different program
  // than the writer, so the stand-in answers "not checked" rather than pretending.
  const foxitId = held('FOXIT_PDF_CLIENT_ID')
  const foxitSecret = held('FOXIT_PDF_CLIENT_SECRET')
  const foxitUrl = held('FOXIT_PDF_BASE_URL')
  const canUseDocumentService = foxitId !== '' && foxitSecret !== '' && foxitUrl !== ''

  const whyNotTheService = replaying
    ? 'This run is replaying answers recorded in advance, so nothing was sent anywhere.'
    : !canUseDocumentService
      ? 'FOXIT_PDF_BASE_URL, FOXIT_PDF_CLIENT_ID and FOXIT_PDF_CLIENT_SECRET are not all set.'
      : ''

  const documents: Chosen<DocumentService> =
    replaying || !canUseDocumentService
      ? {
          service: joinHere({ whyNotTheService }),
          kind: 'stand-in',
          why:
            `The pack is joined here instead, which is a real join and not a ` +
            `pretend one: every page is copied across and the file can be opened ` +
            `and signed. What does not happen is the finished pack being read back ` +
            `by anybody other than the program that wrote it. ${whyNotTheService}`,
        }
      : {
          service: foxitDocuments({
            baseUrl: foxitUrl,
            clientId: foxitId,
            clientSecret: foxitSecret,
            ...(options.fetcher === undefined ? {} : { fetcher: options.fetcher }),
          }),
          kind: 'real',
          why:
            'The document service, for the reversible work only: joining the pack ' +
            'together, reading its text back out so somebody other than the writer ' +
            'says what it says, and making the file small enough to email. It is ' +
            'asked for nothing at all after the pack is sealed, and it refuses ' +
            'those anyway, which is checked by npm run foxit:refusal.',
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
      'Putting the website online is not built yet. The file itself is put ' +
      'together and stamped by Charter’s own code and never goes through anybody ' +
      'else, so the only thing standing in here is the website going live.',
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
      'Drawing the shop picture is not connected to the real service yet. The words ' +
      'it would send are the owners\' own, taken from the diary, so you can see ' +
      'exactly what would have been drawn. No photograph of anybody is ever sent, ' +
      'and that company\'s face and skin tools are not used anywhere in this project.',
  }

  return {
    search: search.service,
    registrar: registrar.service,
    identity: identity.service,
    documents: documents.service,
    publishing: publishing.service,
    imagery: imagery.service,
    chosen: { search, registrar, identity, documents, publishing, imagery },
  }
}

/** The one line per service a person reads before a run starts. */
export function describeChoices(services: ChosenServices): readonly string[] {
  return Object.entries(services.chosen).map(
    ([name, chosen]) => `${name.padEnd(11)}${chosen.kind === 'real' ? 'REAL' : 'stand-in'}  ${chosen.why}`,
  )
}

/** How many of them are talking to a real company. */
export function howManyAreReal(services: ChosenServices): number {
  return Object.values(services.chosen).filter((one) => one.kind === 'real').length
}

/**
 * The document a run reads, when nobody supplied one.
 *
 * Written here for the owner by name, marked a specimen on its face, and the same
 * bytes every time for the same name. Somebody running this on their own machine
 * with their own documents passes their own finder instead, and this is never
 * reached.
 */
async function specimenFor(asked: { readonly owner: string }): Promise<FoundDocument> {
  return {
    bytes: await buildSpecimenDocument(asked.owner),
    kind: SPECIMEN_KIND,
    specimen: true,
  }
}
