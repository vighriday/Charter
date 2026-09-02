/**
 * Proving, against the real service, the one claim this project makes about it.
 *
 * WHAT THIS RUNS
 *
 * The whole document path, end to end, with nothing recorded in advance:
 *
 *   1. write the two documents a formation packet is made of
 *   2. ask the document service to join them
 *   3. ask it to make the joined file smaller
 *   4. ask it to read the text back out, and check the names are really in there
 *   5. seal the result here, with Charter's own certificate
 *   6. ask the same service to rewrite the sealed file, and expect to be refused
 *
 * WHY STEP SIX IS THE POINT
 *
 * Charter says that once a pack is sealed, nothing may rewrite it. That is a rule
 * in `src/pack/assemble.ts` and a rule is only worth what enforces it.
 *
 * It turns out the document service refuses too, on its own, for its own reasons:
 * the seal marks the file as certified and their reader will not modify a
 * certified file. We did not arrange that and did not expect it. Two independent
 * programs refusing the same operation for the same reason is worth more than
 * either of them promising it, and this is how somebody checks that rather than
 * taking our word.
 *
 * WHAT IT COSTS
 *
 * Six or so calls against a free developer account. Nothing is registered, nothing
 * is charged, no personal information is sent, and the documents are about a made
 * up company with made up owners.
 *
 * Run it with:
 *
 *     npm run foxit:proof
 */

import { randomBytes } from 'node:crypto'

import { buildPackDocument } from '../pack/document.js'
import { buildNextStepsDocument } from '../pack/next-steps.js'
import { makeSealCertificate } from '../seal/certificate.js'
import { PERMISSION_FILL_IN_AND_SIGN_ONLY, sealPack, readSeal } from '../seal/seal.js'
import { fingerprintBytes } from '../record/canonical.js'
import { loadEnvFile } from '../settings.js'
import { foxitDocuments, whatIsMissingFrom } from './foxit.js'
import type { AgreementData } from '../agreement/prepare.js'

/** A made up company. No real person and no real business appears anywhere here. */
const COMPANY = 'Rivera Sisters Baking Co'
const OWNERS = ['Ana Rivera', 'Lucia Rivera']
const STAMPED_AT = new Date(Date.UTC(2026, 7, 28, 9, 0, 0))

function say(line: string): void {
  process.stdout.write(`${line}\n`)
}

async function main(): Promise<void> {
  // Read the same way every other command in this project reads it: the file
  // fills in what the surrounding environment has not already said, and the
  // environment always wins.
  loadEnvFile()

  const baseUrl = (process.env['FOXIT_PDF_BASE_URL'] ?? '').trim()
  const clientId = (process.env['FOXIT_PDF_CLIENT_ID'] ?? '').trim()
  const clientSecret = (process.env['FOXIT_PDF_CLIENT_SECRET'] ?? '').trim()

  if (baseUrl === '' || clientId === '' || clientSecret === '') {
    say('FOXIT_PDF_BASE_URL, FOXIT_PDF_CLIENT_ID and FOXIT_PDF_CLIENT_SECRET must all be set.')
    say('Nothing was sent anywhere.')
    process.exitCode = 1
    return
  }

  const service = foxitDocuments({ baseUrl, clientId, clientSecret })

  // ---- 1. the two documents --------------------------------------------------
  const agreement: AgreementData = sampleAgreement()

  const packBody = await buildPackDocument({
    caseId: 'foxit-proof',
    agreement,
    explanation: ['This packet was built to check the document service, and nothing else.'],
    identity: [],
    refusedInThisRun: [],
    preparedOn: agreement.agreementDate,
    stampedAt: STAMPED_AT,
  })

  const nextSteps = await buildNextStepsDocument({
    companyName: COMPANY,
    state: 'TX',
    owners: OWNERS,
    addressRegistered: undefined,
    stampedAt: STAMPED_AT,
  })

  say(`1. wrote two documents: ${packBody.length} and ${nextSteps.length} bytes`)

  // ---- 2. join ----------------------------------------------------------------
  const joined = await service.join([
    { name: 'the formation pack', bytes: packBody },
    { name: 'what you must still do yourself', bytes: nextSteps },
  ])
  say(`2. joined by ${joined.joinedBy}: ${joined.bytes.length} bytes`)

  // ---- 3. shrink --------------------------------------------------------------
  const smaller = await service.shrink(joined.bytes)
  say(
    `3. ${smaller.wasShrunk ? `made smaller: ${smaller.bytes.length} bytes` : 'not made smaller'} ` +
      `(${smaller.shrunkBy})`,
  )

  // ---- 4. read the text back --------------------------------------------------
  const readBack = await service.readBack(smaller.bytes)
  if (!readBack.happened) {
    say(`4. NOT read back. ${readBack.readBy}`)
  } else {
    const mustSay = [COMPANY, ...OWNERS]
    const missing = whatIsMissingFrom(readBack.text, mustSay)
    say(`4. read back by ${readBack.readBy}: ${readBack.text.length} characters`)
    say(
      missing.length === 0
        ? `   every name the pack must carry was found in it: ${mustSay.join(', ')}`
        : `   MISSING from the pack: ${missing.join(', ')}`,
    )
  }

  // ---- 5. seal ----------------------------------------------------------------
  // Made fresh and thrown away when this exits. The seal certificate is protected
  // by a pass phrase, and this proof needs one that exists for a few seconds and
  // is never written down anywhere, so it is invented here and never kept.
  const certificate = makeSealCertificate({
    notBefore: new Date(Date.UTC(2026, 0, 1)),
    password: randomBytes(24).toString('hex'),
  })
  const stamped = await sealPack(smaller.bytes, certificate, {
    at: STAMPED_AT,
    reason:
      'Sealed by Charter. From this point only filling in and signing are permitted. ' +
      'Nothing here has been signed, and Charter cannot sign it.',
  })
  const seal = readSeal(stamped.bytes)
  say(
    `5. sealed here, permission level ${PERMISSION_FILL_IN_AND_SIGN_ONLY}. ` +
      `Whole file covered: ${seal.coversWholeFile ? 'yes' : 'no'}. ` +
      `Fingerprint ${fingerprintBytes(stamped.bytes).slice(0, 12)}`,
  )

  // ---- 6. ask the same service to rewrite it ---------------------------------
  const attempt = await service.tryToFlatten(stamped.bytes)
  say('')
  if (attempt.refused) {
    say('6. THE SAME SERVICE REFUSED TO REWRITE THE SEALED PACK.')
    say(`   It said: ${attempt.said}`)
    say('')
    say(
      '   Charter refuses this by its own rule, in src/pack/assemble.ts. The service ' +
        'refuses it too, for its own reason: the seal marks the file as certified ' +
        'and their reader will not modify a certified file. Neither of them was ' +
        'told about the other.',
    )
  } else {
    say('6. THE SEALED PACK WAS REWRITTEN BY AN OUTSIDE SERVICE.')
    say(`   ${attempt.said}`)
    say('')
    say(
      '   This is a real finding and it must not be smoothed over. Charter still ' +
        'refuses the operation by its own rule, so no run would ever ask for it, ' +
        'but the second, independent refusal this file was written to demonstrate ' +
        'is not there.',
    )
    process.exitCode = 1
  }
}

/** A small, complete agreement, so the pack has something real to print. */
function sampleAgreement(): AgreementData {
  return {
    companyName: COMPANY,
    state: 'TX',
    agreementDate: '28 August 2026',
    ownerCountInWords: 'two',
    owners: [
      {
        ordinal: 'First',
        fullName: 'Ana Rivera',
        contribution: 'a commercial oven',
        contributionValue: '$12,000.00',
        agreedShare: '60%',
        shareOfContributions: '60%',
        agreedMatchesContribution: true,
      },
      {
        ordinal: 'Second',
        fullName: 'Lucia Rivera',
        contribution: 'cash',
        contributionValue: '$8,000.00',
        agreedShare: '40%',
        shareOfContributions: '40%',
        agreedMatchesContribution: true,
      },
    ],
    totalContributions: '$20,000.00',
    ordinaryVote: 'more than half',
    majorVote: 'all of it',
    deadlockPossible: false,
    articles: [
      {
        fullHeading: 'Article 1 — Who owns what',
        why: 'Without it the statute divides by contribution value and the owners never said so.',
      },
    ],
  } as unknown as AgreementData
}

await main()
