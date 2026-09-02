/**
 * Drawing one real picture with the real service.
 *
 * WHAT THIS RUNS
 *
 *   1. asks for one picture, from a sentence somebody typed about their business
 *   2. waits for it
 *   3. prints where it is
 *
 * It also prints both descriptions that were sent, before sending them, so that
 * somebody can see what was asked for rather than only what came back.
 *
 * WHY IT EXISTS
 *
 * Because a client nobody has called is a guess. This one was written against
 * their older service, which signs in by encrypting your key with a public key
 * they issue. Their console now hands out keys for a newer service that takes the
 * key straight in a header. The old client authenticated against nothing, and the
 * error blamed the credential rather than the service.
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
import { describeThePicture, perfectCorpImagery, whatToKeepOut } from './perfectcorp.js'

/** What gets drawn when nobody says otherwise. A made up business. */
const DEFAULT_WORDS = 'A small neighbourhood bakery on a corner in East Austin, open early'

function say(line = ''): void {
  process.stdout.write(`${line}\n`)
}

async function main(): Promise<void> {
  loadEnvFile()

  const apiKey = (process.env['PERFECTCORP_API_KEY'] ?? '').trim()

  if (apiKey === '') {
    say('PERFECTCORP_API_KEY is not set.')
    say()
    say('Redeem a key at yce.perfectcorp.com/api-console, then copy it from the')
    say('API keys page. Nothing was sent anywhere.')
    process.exitCode = 1
    return
  }

  const ownersWords = process.argv.slice(2).join(' ').trim() || DEFAULT_WORDS

  say(`The owners said: ${ownersWords}`)
  say()
  say('What the picture must contain:')
  say(`  ${describeThePicture(ownersWords)}`)
  say()
  say('What the picture must NOT contain:')
  say(`  ${whatToKeepOut()}`)
  say()
  say(
    '  The first two of those are refusals, not styling. Invented people in the ' +
      'picture would be staff the business does not employ. Invented lettering ' +
      'would be a sign saying something nobody chose.',
  )
  say()
  say('  Their prompt rewriting is turned off, so the sentence drawn is the one')
  say('  the owners typed and not a model’s improvement of it.')
  say()

  const service = perfectCorpImagery({ apiKey })
  const drawn = await service.draw(ownersWords, '4:3')

  say(`Drawn by ${drawn.drawnBy}, shape ${drawn.shape}`)
  say(`  ${drawn.url}`)
  say()
  say(
    'No photograph of anybody was sent. That company’s face analysis, skin analysis ' +
      'and face swapping are absent from every tool list in this project and cannot ' +
      'be reached from anything the model can trigger.',
  )
}

await main()
