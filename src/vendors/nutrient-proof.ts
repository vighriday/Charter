/**
 * Reading a real document with the real reading service, end to end.
 *
 * WHAT THIS RUNS
 *
 *   1. write a specimen identity document for each owner, by name
 *   2. send each one to the reading service and get its fields back
 *   3. run the rule that decides which values a person has to look at
 *   4. print what came back, what a person must check, and why
 *
 * WHY IT EXISTS
 *
 * Because for a long time this client had never been called. It was written from
 * the documentation, it was covered by tests that passed, and it was wrong in
 * three separate ways at once: wrong endpoint, wrong request, wrong reply shape.
 * Every one of those was invisible to a green test suite, because the tests handed
 * the client a written-out reply of the shape the client already expected.
 *
 * So this exists to be run by a person, against the real service, and to print
 * enough that somebody can tell whether it really worked.
 *
 * WHOSE DOCUMENT IS BEING READ
 *
 * Nobody's. Charter writes the document, for a made up person, and it says
 * SPECIMEN twice on its face. Asking a stranger to hand a real identity document
 * to a demonstration would be a worse thing than anything this project prevents.
 * The reading is completely real; the person is not, and that fact is printed
 * beside every result.
 *
 * WHAT IT COSTS
 *
 * One reading per owner, from a monthly allowance of several thousand.
 *
 *     npm run nutrient:proof
 */

import { loadEnvFile, readSettings } from '../settings.js'
import { buildSpecimenDocument, detailsFor, SPECIMEN_KIND } from '../identity/specimen.js'
import { LABEL_MEANING } from '../identity/fields.js'
import { reviewDocument, explain } from '../identity/review.js'
import { nutrientIdentityReader } from './nutrient.js'

const OWNERS = ['Ana Rivera', 'Lucia Rivera']

function say(line: string): void {
  process.stdout.write(`${line}\n`)
}

async function main(): Promise<void> {
  loadEnvFile()

  const key = (process.env['NUTRIENT_EXTRACTION_KEY'] ?? '').trim()
  if (key === '') {
    say('NUTRIENT_EXTRACTION_KEY is not set. Nothing was sent anywhere.')
    process.exitCode = 1
    return
  }

  const settings = readSettings(process.env)
  const depth = settings.extractionDepth

  const reader = nutrientIdentityReader({
    extractionKey: key,
    documentAt: async (asked) => ({
      bytes: await buildSpecimenDocument(asked.owner),
      kind: SPECIMEN_KIND,
      specimen: true,
    }),
  })

  say(`Depth asked for: ${depth}`)
  say('')

  for (const owner of OWNERS) {
    const written = detailsFor(owner)
    const document = await reader.read(owner, `${owner} specimen`, depth)

    say(`${owner}`)
    say(`  document: ${document.kind}`)
    say(`  specimen: ${document.specimen === true ? 'yes' : 'NO'}`)
    say(`  written on the page:  ${written.fullName} · ${written.dateOfBirth} · ` +
      `${written.documentNumber} · ${written.expiryDate}`)
    say(`  read back off it:`)

    for (const field of document.fields) {
      const score = field.confidence === undefined ? 'no score' : field.confidence.toFixed(2)
      say(
        `    ${field.name.padEnd(16)} ${field.value.padEnd(24)} ` +
          `${field.label} (${LABEL_MEANING[field.label]}), score ${score}`,
      )
    }

    // The rule that decides who has to look. It runs on what actually came back,
    // and no model takes any part in it.
    const review = reviewDocument(document, {
      givenName: owner,
      today: '2026-09-02',
      scoreFloor: settings.reviewConfidenceFloor,
      caseId: 'nutrient-proof',
      // Turned off here on purpose. The sample sends a share of perfectly clean
      // readings to a person anyway, which is the right thing in a run and would
      // make this proof say something different every time it was run.
      auditSampleRate: 0,
    })

    if (review.toReview.length === 0) {
      say('  nothing on this document needed a person to look at it')
    } else {
      say(`  a person has to look at ${review.toReview.length}:`)
      for (const field of review.fields.filter((one) => one.needsAPerson)) {
        say(`    ${field.field}: ${field.reasons.map(explain).join('; ')}`)
      }
    }
    say('')
  }

  say(
    'Nothing above says anybody’s identity was confirmed, and nothing in this ' +
      'project may. The service reads; it does not verify. The people are made up.',
  )
}

await main()
