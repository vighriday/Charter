/**
 * Ask two outside companies which of their products our credentials actually open.
 *
 *     npm run keys:classify
 *
 * WHY THIS EXISTS
 *
 * A credential is a long string of characters that proves to an outside company
 * that we are allowed to use their service. Two of Charter's are a guess.
 *
 *   1. We hold one key from Nutrient, the company that reads text out of scanned
 *      documents. Nutrient sells two separate products, each with its OWN key: a
 *      general document processor, and a service that pulls named fields out of a
 *      document. We do not know which of the two ours opens. Their own client
 *      documentation says the processor key used against the field-reading service
 *      is refused with the code 403, which means "I know you, but not here" - so
 *      the two really are separate accounts, not two doors to one thing.
 *
 *   2. We hold a username and a token for name.com, the company that registers web
 *      addresses. Their practice area for safe testing is a SEPARATE account whose
 *      username ends in `-test`. Ours does not, and it looks like an email address
 *      rather than an account name, so it is probably wrong twice.
 *
 * WHY GUESSING IS NOT GOOD ENOUGH
 *
 * Both guesses fail late and expensively. A Nutrient key that turns out to be the
 * wrong product fails on the first day we try to read an identity document, which
 * is close to the deadline. A wrong name.com username fails every call, and a
 * person under time pressure who "fixes" that by pointing at the real service
 * instead of the practice one has just spent real money on a real web address.
 *
 * HOW IT ASKS WITHOUT SPENDING ANYTHING
 *
 * Every request is deliberately empty. It carries no document, no personal detail,
 * and nothing to process. A service checks WHO you are before it looks at WHAT you
 * sent, so an empty request still gets a truthful answer about the credential.
 * A complaint about the request itself proves the credential passed, and costs
 * nothing, because nothing was done. `credentials.ts` holds that reading rule, on
 * its own, so it can be tested without a key.
 *
 * WHAT IT REFUSES TO DO
 *
 * It never prints a credential - only the first few characters and the length,
 * which is enough to tell two apart and not enough to use one.
 *
 * It never contacts the live name.com service, only the practice one. The live
 * service is where money is spent, and no diagnostic needs to touch it.
 *
 * It never writes to `.env`. It says what to change and leaves the change to a
 * person, because a wrong automatic edit to a file of real credentials is worse
 * than the problem it would be fixing.
 */

import { readFile } from 'node:fs/promises'
import { readEnvValue } from '../record/env-file.js'
import {
  NAMECOM_TEST_HOST,
  NUTRIENT_EXTRACTION_PROBE,
  NUTRIENT_PROCESSOR_PROBE,
  PATIENCE,
  fingerprint,
  firstFilled,
  place,
  receive,
  say,
  usernameCandidates,
  type Found,
  type Reception,
} from './credentials.js'

/** Ask one service one question, and never throw. A failed probe is a result. */
async function ask(url: string, init: RequestInit): Promise<Reception> {
  try {
    const reply = await fetch(url, { ...init, signal: AbortSignal.timeout(PATIENCE) })
    const body = await reply.text().catch(() => '')
    return receive(reply.status, body)
  } catch (error) {
    return { kind: 'could not ask', why: error instanceof Error ? error.message : String(error) }
  }
}

// ---------------------------------------------------------------------------
// Nutrient
// ---------------------------------------------------------------------------

async function classifyNutrient(found: Found): Promise<void> {
  const key = found.value
  console.log('\nNUTRIENT - which product does this key open?')
  console.log(`  the key      ${fingerprint(key)}`)
  console.log('  sending      an empty request to each of their two products')
  console.log('  carrying     no document, no personal detail, nothing to process')

  const headers = { authorization: `Bearer ${key}`, 'content-type': 'application/json' }

  const [processor, extraction] = await Promise.all([
    ask(NUTRIENT_PROCESSOR_PROBE, { method: 'POST', headers, body: '{}' }),
    ask(NUTRIENT_EXTRACTION_PROBE, { method: 'POST', headers, body: '{}' }),
  ])

  console.log(`\n  document processor   ${NUTRIENT_PROCESSOR_PROBE}`)
  console.log(`                       ${say(processor)}`)
  console.log(`  field reading        ${NUTRIENT_EXTRACTION_PROBE}`)
  console.log(`                       ${say(extraction)}`)

  const opensProcessor = processor.kind === 'accepted'
  const opensExtraction = extraction.kind === 'accepted'

  console.log('')

  // Nothing was reached, so nothing is known about the key.
  //
  // This came before every other verdict on purpose. Until 30 August 2026 a
  // machine with no network fell through to the last branch and printed "neither
  // product recognised this key... check it in the dashboard", which is a
  // confident statement about a credential that was never shown to anybody. A
  // diagnostic that blames the thing it is diagnosing when it could not run is
  // worse than one that says nothing, because somebody acts on it — and the action
  // here is going to a vendor dashboard to replace a key that was fine.
  if (processor.kind === 'could not ask' && extraction.kind === 'could not ask') {
    console.log('  VERDICT  Neither request reached Nutrient, so NOTHING was learned about')
    console.log('           this key. It was never shown to anybody. This says something')
    console.log('           about the network between here and them, and nothing at all')
    console.log('           about the credential.')
    console.log(`           ${say(processor)}`)
    return
  }

  if (opensProcessor && opensExtraction) {
    console.log('  VERDICT  This one key opens both. Their documentation says that')
    console.log('           happens once an account moves to a single shared key.')
    console.log('           Put the same value in BOTH names in .env and say so in a')
    console.log('           comment, so nobody later assumes we are missing one.')
  } else if (opensProcessor) {
    console.log('  VERDICT  This is the DOCUMENT PROCESSOR key.')
    console.log(`           ${place(found, 'NUTRIENT_PROCESSOR_KEY')}`)
    console.log('           STILL NEEDED: a Data Extraction key, which is the one that')
    console.log('           reads fields off an identity document. Charter cannot do')
    console.log('           stage 5 without it.')
  } else if (opensExtraction) {
    console.log('  VERDICT  This is the DATA EXTRACTION key - the one stage 5 needs.')
    console.log(`           ${place(found, 'NUTRIENT_EXTRACTION_KEY')}`)
    console.log('           The processor key is only for assembling PDF files, and its')
    console.log('           free output is watermarked, so we may not want it at all.')
  } else if (processor.kind === 'could not ask' || extraction.kind === 'could not ask') {
    // One reached and one did not. Half an answer, said as half an answer.
    console.log('  VERDICT  One of the two requests never arrived, so this is half an')
    console.log('           answer. What did arrive is above. Run it again before')
    console.log('           changing anything: a product that was not reached is not a')
    console.log('           product that refused you.')
  } else {
    console.log('  VERDICT  Both products were reached and neither recognised this key.')
    console.log('           Either it has expired, it was copied incompletely, or it')
    console.log('           belongs to a third thing. Check it in the dashboard.')
  }
}

// ---------------------------------------------------------------------------
// name.com
// ---------------------------------------------------------------------------

async function classifyNameCom(username: string, token: string, baseUrl: string): Promise<void> {
  console.log('\nNAME.COM - is the practice username right?')
  console.log(`  username     ${username}`)
  console.log(`  token        ${fingerprint(token)}`)

  if (!baseUrl.startsWith(NAMECOM_TEST_HOST)) {
    console.log(`\n  REFUSED. NAMECOM_BASE_URL_TEST is "${baseUrl}", which is not the`)
    console.log(`  practice service at ${NAMECOM_TEST_HOST}. This check never contacts`)
    console.log('  the live service, because that is where money is spent.')
    return
  }

  const url = `${NAMECOM_TEST_HOST}/core/v1/hello`
  console.log(`  asking       GET ${url}  (their own connection test, free)`)

  const candidates = usernameCandidates(username)
  let worked: string | undefined

  for (const candidate of candidates) {
    const credential = Buffer.from(`${candidate}:${token}`).toString('base64')
    const reception = await ask(url, {
      method: 'GET',
      headers: { authorization: `Basic ${credential}` },
    })
    console.log(`    ${candidate.padEnd(28)} ${say(reception)}`)
    if (reception.kind === 'accepted' && worked === undefined) worked = candidate
  }

  console.log('')
  if (worked === undefined) {
    console.log('  VERDICT  No username worked with this token. Two likely reasons, and')
    console.log('           they need different fixes:')
    console.log('             - The token was made on the LIVE account, not the practice')
    console.log('               one. They are separate accounts with separate tokens.')
    console.log('             - A brand new practice token can take up to fifteen minutes')
    console.log('               to start working. If it was just made, wait and rerun.')
    console.log('           The practice username and token come from the signed-in')
    console.log('           developer area, under the sandbox or test section.')
  } else if (worked === username) {
    console.log('  VERDICT  The username in .env is already correct. Nothing to change.')
  } else {
    console.log('  VERDICT  The username in .env is wrong. The one that works is:')
    console.log(`             ${worked}`)
    console.log('           Set NAMECOM_USERNAME_TEST to that.')
  }
}

// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const env = await readFile('.env', 'utf8').catch(() => {
    throw new Error('No .env file found. Run this from the project root.')
  })

  const rule = '-'.repeat(78)
  console.log(rule)
  console.log('CLASSIFYING CREDENTIALS')
  console.log('')
  console.log('This makes real calls to two outside companies, using credentials you')
  console.log('already hold. Every request is empty on purpose, so nothing is processed')
  console.log('and nothing is charged. No document and no personal detail is sent.')
  console.log('No credential is printed. The live name.com service is not contacted.')
  console.log(rule)

  // Try every name a Nutrient key has ever been parked under in this project, so
  // the check keeps working for somebody who cloned it before the names settled.
  const nutrient = firstFilled(env, [
    'NUTRIENT_EXTRACTION_KEY',
    'NUTRIENT_PROCESSOR_KEY',
    'NUTRIENT_API_KEY_UNCLASSIFIED',
  ])

  if (nutrient === undefined) {
    console.log('\nNUTRIENT - no key set in .env. Skipped.')
  } else {
    await classifyNutrient(nutrient)
  }

  // NAMECOM_USERNAME was one shared name for both the practice and live accounts.
  // It is now split, because those two accounts have different usernames and
  // pairing one with the other's token is the mistake that spends money.
  const found = firstFilled(env, ['NAMECOM_USERNAME_TEST', 'NAMECOM_USERNAME'])
  const username = found?.value
  const token = readEnvValue(env, 'NAMECOM_TOKEN_TEST')
  const baseUrl = readEnvValue(env, 'NAMECOM_BASE_URL_TEST') ?? NAMECOM_TEST_HOST

  if (username === undefined || token === undefined || token.length === 0) {
    console.log('\nNAME.COM - username or practice token missing from .env. Skipped.')
  } else {
    await classifyNameCom(username, token, baseUrl)
  }

  console.log(`\n${rule}`)
  console.log('Nothing was written. Make the changes to .env yourself, deliberately.')
  console.log(rule)
}

main().catch((error: unknown) => {
  console.error(error)
  process.exitCode = 1
})
