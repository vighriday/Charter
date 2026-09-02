/**
 * Ask every outside company, right now, whether it will actually answer us.
 *
 *     npm run services:live
 *
 * WHY THIS EXISTS
 *
 * Everywhere else in this project, "does this work" is answered from a file: the
 * settings file says which credentials are set, the website says which clients are
 * written, and the tests say the code agrees with itself. Not one of those is the
 * same question as *will this company answer us in the next thirty seconds*.
 *
 * That distinction has already cost this project. One client sat here for weeks,
 * written from the documentation, covered by tests that passed, and wrong in three
 * separate ways at once. Every file said it was finished. The first real call
 * found all three faults in ten minutes.
 *
 * So there is one command that goes and asks. It is the command to run before a
 * demonstration, and the command to run the moment a new key is pasted in.
 *
 * WHAT IT COSTS, WHICH IS ALMOST NOTHING
 *
 * The cheapest question that still proves the credential works, per company.
 * Signing in where a sign-in exists, because a sign-in is free and it is the step
 * that fails when a key is wrong. Asking the price of a web address, which costs
 * nothing and registers nothing. One search and one document reading, which are
 * one apiece from monthly allowances of 250 and several thousand.
 *
 * Nothing is registered, nothing is charged, nothing is signed, and no document
 * belonging to any person is sent anywhere.
 *
 * WHAT IT REFUSES TO DO
 *
 * Guess. A company with no key set is reported as having no key, not as failing.
 * A company whose client does not exist is reported as not built. Only a company
 * that was really asked and really answered is reported as answering, and the
 * reason is printed beside every other outcome.
 */

import { loadEnvFile, readSettings } from '../settings.js'
import { OUTSIDE_COMPANIES, type OutsideCompany } from './who-does-what.js'
import { buildSpecimenDocument, SPECIMEN_KIND } from '../identity/specimen.js'
import { nutrientIdentityReader } from './nutrient.js'
import { namecomRegistrar } from './namecom.js'
import { webSearch } from './search.js'
import { foxitDocuments } from './foxit.js'
import { proofOfKey } from './perfectcorp.js'
import { ask, describeReply } from './http.js'

const GREEN = '\x1b[32m'
const RED = '\x1b[31m'
const YELLOW = '\x1b[33m'
const DIM = '\x1b[2m'
const BOLD = '\x1b[1m'
const OFF = '\x1b[0m'

/** What happened when we asked. */
type Outcome =
  | { readonly kind: 'answered'; readonly saying: string }
  | { readonly kind: 'refused'; readonly saying: string }
  | { readonly kind: 'no key'; readonly saying: string }
  | { readonly kind: 'not built'; readonly saying: string }

function say(line = ''): void {
  process.stdout.write(`${line}\n`)
}

const held = (name: string): string => (process.env[name] ?? '').trim()

/** Run one check and turn anything it throws into an outcome rather than a crash. */
async function attempt(what: () => Promise<string>): Promise<Outcome> {
  try {
    return { kind: 'answered', saying: await what() }
  } catch (error) {
    return { kind: 'refused', saying: error instanceof Error ? error.message : String(error) }
  }
}

const NO_KEY = (names: string): Outcome => ({
  kind: 'no key',
  saying: `${names} not set. Nothing was sent anywhere.`,
})

// ─────────────────────────────────────────────────────────────────────────────
// One check per company. Each is the cheapest question that still proves the
// credential works against the real service.
// ─────────────────────────────────────────────────────────────────────────────

const CHECKS: Readonly<Record<string, () => Promise<Outcome>>> = {
  async SerpApi() {
    const key = held('SERPAPI_KEY')
    const other = held('TAVILY_API_KEY')
    if (key === '' && other === '') return NO_KEY('SERPAPI_KEY and TAVILY_API_KEY')

    return attempt(async () => {
      const answer = await webSearch({
        serpapiKey: key,
        tavilyKey: other,
        // A cached answer proves the key is known and proves nothing about the
        // service being reachable now. This is the one command where that
        // distinction is the entire point.
        freshOnly: true,
      }).search('Rivera Sisters Baking Co')

      return `${answer.answeredBy} returned ${answer.hits.length} results`
    })
  },

  async 'Name.com'() {
    const settings = readSettings(process.env)
    const which = settings.registrarEnv === 'live' ? 'LIVE' : 'TEST'
    const user = held(`NAMECOM_USERNAME_${which}`)
    const token = held(`NAMECOM_TOKEN_${which}`)
    if (user === '' || token === '') return NO_KEY(`NAMECOM_USERNAME_${which} and NAMECOM_TOKEN_${which}`)

    return attempt(async () => {
      // Asking the price costs nothing and registers nothing.
      const quote = await namecomRegistrar({
        environment: settings.registrarEnv,
        username: user,
        token,
        mayspendRealMoney: false,
        caseId: 'roll-call',
        ...(held('NAMECOM_BASE_URL_TEST') !== '' && settings.registrarEnv === 'test'
          ? { baseUrl: held('NAMECOM_BASE_URL_TEST') }
          : {}),
      }).quote('charter-roll-call-example.com')

      return `the ${settings.registrarEnv} account answered: ${
        quote.available ? 'free' : 'taken'
      }. Nothing was registered`
    })
  },

  async Nutrient() {
    const key = held('NUTRIENT_EXTRACTION_KEY')
    if (key === '') return NO_KEY('NUTRIENT_EXTRACTION_KEY')

    return attempt(async () => {
      const settings = readSettings(process.env)
      const document = await nutrientIdentityReader({
        extractionKey: key,
        documentAt: async (asked) => ({
          bytes: await buildSpecimenDocument(asked.owner),
          kind: SPECIMEN_KIND,
          specimen: true,
        }),
      }).read('Ana Rivera', 'roll-call specimen', settings.extractionDepth)

      const exact = document.fields.filter((one) => one.label === 'id_match').length
      return `read ${document.fields.length} fields off a specimen, ${exact} found exactly`
    })
  },

  async 'Foxit, document services'() {
    const id = held('FOXIT_PDF_CLIENT_ID')
    const secret = held('FOXIT_PDF_CLIENT_SECRET')
    const base = held('FOXIT_PDF_BASE_URL')
    if (id === '' || secret === '' || base === '') {
      return NO_KEY('FOXIT_PDF_BASE_URL, FOXIT_PDF_CLIENT_ID and FOXIT_PDF_CLIENT_SECRET')
    }

    return attempt(async () => {
      // Reading a document back proves the credential and the whole task path:
      // upload, start, wait, download. Nothing is stored and nothing is changed.
      const read = await foxitDocuments({ baseUrl: base, clientId: id, clientSecret: secret }).readBack(
        await buildSpecimenDocument('Ana Rivera'),
      )
      if (!read.happened) throw new Error(read.readBy)
      return `read ${read.text.length} characters back out of a document`
    })
  },

  async 'Foxit, eSign'() {
    const id = held('FOXIT_ESIGN_CLIENT_ID')
    const secret = held('FOXIT_ESIGN_CLIENT_SECRET')
    const base = held('FOXIT_ESIGN_BASE_URL')
    if (id === '' || secret === '' || base === '') {
      return NO_KEY('FOXIT_ESIGN_BASE_URL, FOXIT_ESIGN_CLIENT_ID and FOXIT_ESIGN_CLIENT_SECRET')
    }

    // Imported here rather than at the top of the file on purpose. Everything in
    // src/sign/ is behind a wall that nothing the model can trigger may cross,
    // and this file is an ordinary command a person runs. Keeping the import
    // where it is used keeps that visible to somebody reading it.
    const { foxitESign } = await import('../sign/foxit-esign.js')

    return attempt(async () => {
      const token = await foxitESign({ baseUrl: base, clientId: id, clientSecret: secret }).signIn()
      return `signed in. Nothing was created and nothing was sent to anybody. Token ${token.length} characters`
    })
  },

  async Doctavian() {
    const key = held('DOCTAVIAN_API_KEY')
    const token = held('DOCTAVIAN_REFRESH_TOKEN')
    const base = held('DOCTAVIAN_BASE_URL')
    if (key === '' || base === '') return NO_KEY('DOCTAVIAN_API_KEY and DOCTAVIAN_BASE_URL')
    if (token === '') {
      return {
        kind: 'no key',
        saying:
          'DOCTAVIAN_REFRESH_TOKEN is empty. Their demonstration environment needs a ' +
          'token obtained through a sign-in a person does in a browser.',
      }
    }

    return attempt(async () => {
      const reply = await ask(`${base.replace(/\/+$/, '')}/api/templates`, {
        headers: { 'x-api-key': key, authorization: `Bearer ${token}` },
      })
      if (reply.kind !== 'ok') throw new Error(describeReply(reply))
      return 'answered'
    })
  },

  async 'Perfect Corp'() {
    const key = held('PERFECTCORP_API_KEY')
    const publicKey = held('PERFECTCORP_PUBLIC_KEY').replace(/\\n/g, '\n')
    if (key === '' || publicKey === '') return NO_KEY('PERFECTCORP_API_KEY and PERFECTCORP_PUBLIC_KEY')

    return attempt(async () => {
      // The sign-in only. Drawing a picture costs credits and takes a minute, and
      // the sign-in is the step that fails when a key is wrong.
      const proof = proofOfKey(key, publicKey, Date.now())
      const reply = await ask('https://yce-api-01.perfectcorp.com/s2s/v1.0/client/auth', {
        method: 'POST',
        body: { client_id: key, id_token: proof },
      })
      if (reply.kind !== 'ok') throw new Error(describeReply(reply))
      return 'signed in. No picture was drawn'
    })
  },

  async 'Google, Gemini'() {
    const key = held('GEMINI_API_KEY')
    if (key === '') return NO_KEY('GEMINI_API_KEY')

    return attempt(async () => {
      // Listing the models proves the key without spending anything on tokens.
      const reply = await ask(`https://generativelanguage.googleapis.com/v1beta/models?key=${key}`)
      if (reply.kind !== 'ok') throw new Error(describeReply(reply))
      const models = (reply.body as { models?: unknown[] })?.models ?? []
      return `answered, offering ${models.length} models`
    })
  },

  async Groq() {
    const key = held('GROQ_API_KEY')
    if (key === '') return NO_KEY('GROQ_API_KEY')

    return attempt(async () => {
      const reply = await ask('https://api.groq.com/openai/v1/models', {
        headers: { authorization: `Bearer ${key}` },
      })
      if (reply.kind !== 'ok') throw new Error(describeReply(reply))
      const models = (reply.body as { data?: unknown[] })?.data ?? []
      return `answered, offering ${models.length} models`
    })
  },
}

function paint(outcome: Outcome): string {
  switch (outcome.kind) {
    case 'answered':
      return `${GREEN}ANSWERED${OFF}`
    case 'refused':
      return `${RED}REFUSED ${OFF}`
    case 'no key':
      return `${YELLOW}NO KEY  ${OFF}`
    case 'not built':
      return `${DIM}NOT BUILT${OFF}`
  }
}

async function main(): Promise<void> {
  loadEnvFile()

  say()
  say(`${BOLD}Charter, who actually answers right now${OFF}`)
  say(`${DIM}${'─'.repeat(74)}${OFF}`)
  say(
    `${DIM}  Nothing is registered, nothing is charged, nothing is signed, and no${OFF}`,
  )
  say(`${DIM}  document belonging to any person is sent anywhere.${OFF}`)
  say()

  let answered = 0
  let refused = 0

  for (const company of OUTSIDE_COMPANIES as readonly OutsideCompany[]) {
    const check = CHECKS[company.company]
    const outcome: Outcome =
      check === undefined
        ? { kind: 'not built', saying: 'there is no way to ask this one yet' }
        : await check()

    if (outcome.kind === 'answered') answered += 1
    if (outcome.kind === 'refused') refused += 1

    say(`  ${paint(outcome)}  ${company.company.padEnd(26)} ${DIM}${company.host}${OFF}`)
    for (const line of wrap(outcome.saying, 68)) say(`              ${DIM}${line}${OFF}`)
    say()
  }

  say(`${DIM}${'─'.repeat(74)}${OFF}`)
  say(
    `  ${answered} of ${OUTSIDE_COMPANIES.length} answered. ` +
      `${refused} refused. The rest have no key set.`,
  )
  say()
  say(`${DIM}  This is the only thing in the project that answers the question by asking.${OFF}`)
  say(`${DIM}  Everything else answers it from a file, and a file cannot know.${OFF}`)
  say()

  // A refusal is a real finding and the exit code says so, because this is the
  // command somebody runs before a demonstration.
  if (refused > 0) process.exitCode = 1
}

/** Break a sentence into lines of about this width, without cutting a word. */
function wrap(text: string, width: number): readonly string[] {
  const lines: string[] = []
  let current = ''

  for (const word of text.split(/\s+/).filter(Boolean)) {
    const candidate = current === '' ? word : `${current} ${word}`
    if (candidate.length <= width) {
      current = candidate
      continue
    }
    if (current !== '') lines.push(current)
    current = word
  }

  if (current !== '') lines.push(current)
  return lines
}

await main()
