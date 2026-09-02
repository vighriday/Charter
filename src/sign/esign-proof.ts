/**
 * Carrying a real sealed packet to a real signing service, end to end.
 *
 * WHAT THIS RUNS
 *
 *   1. write the formation packet and the page saying what Charter did not do
 *   2. join them, seal the result, and take the fingerprint of the sealed bytes
 *   3. exchange the eSign credentials for a token
 *   4. create the signing folder as a DRAFT, with a signature box for each owner
 *      exactly where Charter drew their line
 *   5. read the folder's state back from the service
 *
 * WHAT IT DELIBERATELY DOES NOT DO
 *
 * It does not send. Creating and sending are two separate acts in this project,
 * because the moment a person is asked to sign is a moment worth controlling, and
 * a proof that emailed two made up addresses every time somebody ran it would be a
 * poor thing to leave lying around.
 *
 * It does not sign, and it cannot. Nothing in this project can.
 *
 * WHY IT EXISTS
 *
 * Because a client nobody has called is a guess. The last one in this project that
 * had never been called was wrong in three separate ways at once, under a test
 * suite that passed, and the first real call found all three in ten minutes.
 *
 * Until this prints a folder identifier, the honest description of the eSign
 * integration is "written, not proven", and that is what the settings file and the
 * website both say.
 *
 *     npm run esign:proof
 */

import { randomBytes } from 'node:crypto'

import { loadEnvFile } from '../settings.js'
import { buildPackDocument } from '../pack/document.js'
import { buildNextStepsDocument } from '../pack/next-steps.js'
import { joinHere } from '../pack/join.js'
import { makeSealCertificate } from '../seal/certificate.js'
import { sealPack } from '../seal/seal.js'
import { fingerprintBytes } from '../record/canonical.js'
import { prepareSignatureRequest, type Signer } from './request.js'
import { foxitESign, type SignatureBox } from './foxit-esign.js'
import type { AgreementData } from '../agreement/prepare.js'

const COMPANY = 'Rivera Sisters Baking Co'
const STAMPED_AT = new Date(Date.UTC(2026, 7, 28, 9, 0, 0))

/** Made up people, at an address nobody can receive mail at. */
const SIGNERS: readonly Signer[] = [
  { fullName: 'Ana Rivera', email: 'ana@example.invalid', order: 1 },
  { fullName: 'Lucia Rivera', email: 'lucia@example.invalid', order: 2 },
]

function say(line: string): void {
  process.stdout.write(`${line}\n`)
}

async function main(): Promise<void> {
  loadEnvFile()

  const baseUrl = (process.env['FOXIT_ESIGN_BASE_URL'] ?? '').trim()
  const clientId = (process.env['FOXIT_ESIGN_CLIENT_ID'] ?? '').trim()
  const clientSecret = (process.env['FOXIT_ESIGN_CLIENT_SECRET'] ?? '').trim()

  if (baseUrl === '' || clientId === '' || clientSecret === '') {
    say('FOXIT_ESIGN_BASE_URL, FOXIT_ESIGN_CLIENT_ID and FOXIT_ESIGN_CLIENT_SECRET')
    say('must all be set. Nothing was sent anywhere.')
    process.exitCode = 1
    return
  }

  // ---- 1 and 2. a real, sealed packet ----------------------------------------
  const written = await buildPackDocument({
    caseId: 'esign-proof',
    agreement: sampleAgreement(),
    explanation: ['This packet was built to check the signing service, and nothing else.'],
    identity: [],
    refusedInThisRun: [],
    preparedOn: '28 August 2026',
    stampedAt: STAMPED_AT,
  })

  const nextSteps = await buildNextStepsDocument({
    companyName: COMPANY,
    state: 'TX',
    owners: SIGNERS.map((one) => one.fullName),
    addressRegistered: undefined,
    stampedAt: STAMPED_AT,
  })

  const joined = await joinHere({
    whyNotTheService: 'This proof is about the signing service, not the document service.',
  }).join([
    { name: 'the formation pack', bytes: written.bytes },
    { name: 'what you must still do yourself', bytes: nextSteps },
  ])

  const stamped = await sealPack(
    joined.bytes,
    makeSealCertificate({
      notBefore: new Date(Date.UTC(2026, 0, 1)),
      // Invented here and thrown away when this exits.
      password: randomBytes(24).toString('hex'),
    }),
    {
      at: STAMPED_AT,
      reason:
        'Sealed by Charter. From this point only filling in and signing are permitted. ' +
        'Nothing here has been signed, and Charter cannot sign it.',
    },
  )

  const packFingerprint = fingerprintBytes(stamped.bytes)
  say(`1. sealed packet: ${stamped.bytes.length} bytes, ${packFingerprint.slice(0, 12)}`)
  say(
    `2. ${written.signWhere.length} signature lines, on page ${written.signWhere[0]?.page ?? 0} ` +
      `of ${written.pages}`,
  )

  // ---- the request, with every refusal already applied ------------------------
  const boxes: readonly SignatureBox[] = written.signWhere.map((spot) => ({
    owner: spot.owner,
    page: spot.page,
    x: spot.x,
    y: spot.y,
    width: spot.width,
    height: spot.height,
  }))

  const request = prepareSignatureRequest({
    caseId: 'esign-proof',
    pack: stamped.bytes,
    packFingerprint,
    // Stands in for what a person recorded. In a run this comes out of the
    // append-only record and cannot be handed in by a caller.
    approval: {
      approvedBy: 'a person running npm run esign:proof',
      packFingerprint,
      approvedAt: STAMPED_AT.toISOString(),
    },
    signers: SIGNERS,
    whereToSign: 'boxes placed where Charter drew the lines',
    boxes,
  })
  say(`3. request prepared: ${request.signers.length} people, ${request.boxes.length} boxes`)

  // ---- the service -------------------------------------------------------------
  const service = foxitESign({ baseUrl, clientId, clientSecret })

  const token = await service.signIn()
  say(`4. signed in: a token ${token.length} characters long`)

  const folder = await service.createDraft(token, request, boxes)
  say(`5. draft folder ${folder.folderId} created by ${folder.carriedBy}. NOT sent.`)

  const state = await service.stateOf(token, folder.folderId)
  say(`6. the service says: "${state.said}" — finished: ${state.finished ? 'yes' : 'no'}`)

  say('')
  say(
    'Nothing was emailed to anybody and nothing was signed. Sending is a separate ' +
      'act, done at a moment this project controls and records, and signing is an ' +
      'act only a person can perform.',
  )
}

/** A small, complete agreement, so the packet has something real in it. */
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
