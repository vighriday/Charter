/**
 * Drawing one real picture with the real service.
 *
 * WHAT THIS RUNS
 *
 *   1. builds the proof that this caller holds the arrangement, from the key and
 *      the current time
 *   2. signs in with it
 *   3. asks for one picture, from a sentence somebody typed about their business
 *   4. waits for it, and prints where it is
 *
 * It also prints the exact words that were sent, before sending them, so that
 * somebody can see what was asked for rather than only what came back.
 *
 * WHY IT EXISTS
 *
 * Because a client nobody has called is a guess. The last one in this project that
 * had never been called was wrong three separate ways at once, under a test suite
 * that passed, and the first real call found all three in ten minutes.
 *
 * WHAT IS NEVER SENT
 *
 * No photograph of anybody, here or anywhere else in this project. This company
 * also sells face analysis, skin analysis and face swapping, and none of it
 * appears in any tool list or is reachable from anything the model can trigger.
 *
 *     npm run picture:proof
 *     npm run picture:proof "a neighbourhood bakery in East Austin, open early"
 */

import { loadEnvFile } from '../settings.js'
import { describeThePicture, perfectCorpImagery } from './perfectcorp.js'

/** What gets drawn when nobody says otherwise. A made up business. */
const DEFAULT_WORDS = 'A small neighbourhood bakery on a corner in East Austin, open early'

function say(line: string): void {
  process.stdout.write(`${line}\n`)
}

async function main(): Promise<void> {
  loadEnvFile()

  const apiKey = (process.env['PERFECTCORP_API_KEY'] ?? '').trim()
  // Line breaks spelled out, put back before the key is read. See the note in
  // src/vendors/build.ts: a settings file usually cannot hold real ones.
  const publicKeyPem = (process.env['PERFECTCORP_PUBLIC_KEY'] ?? '').trim().replace(/\\n/g, '\n')

  if (apiKey === '' || publicKeyPem === '') {
    say('PERFECTCORP_API_KEY and PERFECTCORP_PUBLIC_KEY must both be set.')
    say('')
    say('Redeem a key at yce.perfectcorp.com/api-console/en/redeem-code/ and copy the')
    say('public key they issue beside it. Nothing was sent anywhere.')
    process.exitCode = 1
    return
  }

  const ownersWords = process.argv.slice(2).join(' ').trim() || DEFAULT_WORDS

  say(`The owners said: ${ownersWords}`)
  say('')
  say('What is actually sent:')
  say(`  ${describeThePicture(ownersWords)}`)
  say('')
  say(
    '  The two additions are refusals, not styling. Invented people in the picture ' +
      'would be staff the business does not employ. Invented lettering would be a ' +
      'sign saying something nobody chose.',
  )
  say('')

  const service = perfectCorpImagery({ apiKey, publicKeyPem })
  const drawn = await service.draw(ownersWords, '4:3')

  say(`Drawn by ${drawn.drawnBy}, shape ${drawn.shape}`)
  say(`  ${drawn.url}`)
  say('')
  say(
    'No photograph of anybody was sent. That company’s face analysis, skin analysis ' +
      'and face swapping are absent from every tool list in this project and cannot ' +
      'be reached from anything the model can trigger.',
  )
}

await main()
