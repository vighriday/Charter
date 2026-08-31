/**
 * Checking a finished pack and the record that goes with it, without trusting us.
 *
 * WHAT THIS IS FOR
 *
 * Somebody is handed two files: a Formation Pack, and the record of everything
 * Charter did to produce it. This works out whether they can believe either one.
 *
 * It is the whole argument reduced to something a stranger runs in a few seconds
 * on their own machine. Nothing here asks Charter for anything, contacts anything,
 * or reads any setting. Everything it needs is either in the two files or in this
 * public repository.
 *
 * WHY THE KEY COMES FROM OUTSIDE THE PACK
 *
 * The attestation over the end of the record is checked against a public key
 * committed to this repository, never against a key found inside the pack. A
 * checker that read its key out of the thing it was checking would prove nothing
 * at all — anybody could make up a key, vouch for anything with it, and ship both
 * together.
 *
 * WHAT IT DELIBERATELY DOES NOT CLAIM
 *
 * The certificate that seals the pack is issued by us, to us. No outside authority
 * has checked who we are, and a PDF reader will say so. This reports that plainly
 * rather than hiding it behind a finding that looks more convincing than it is.
 *
 * The claim actually made is narrower and completely checkable:
 *
 *     This file has not changed by one byte since it was sealed, and this record
 *     has not been altered or shortened since it was attested.
 *
 * Being honest about the limit is the stronger position, because the limit is
 * something a careful reader would find anyway.
 */

import { createPublicKey } from 'node:crypto'
import { checkChain, type ChainedEvent } from '../record/chain.js'
import { fingerprintBytes } from '../record/canonical.js'
import { keyIdOf, verifyAttestation, type Attestation } from '../record/attestation.js'
import { PERMISSION_FILL_IN_AND_SIGN_ONLY, readSeal } from '../seal/seal.js'

/** One thing that was checked, and what came of it. */
export interface Finding {
  /** What was being asked, in plain words. */
  readonly question: string
  readonly answer: 'yes' | 'no' | 'cannot say'
  /** The detail somebody would want if it said no. */
  readonly detail: string
}

export interface VerificationResult {
  readonly findings: readonly Finding[]
  /** True only when every question that could be answered was answered yes. */
  readonly ok: boolean
  /** What this check is not able to establish, said out loud. */
  readonly cannotProve: readonly string[]
}

/** Everything a person hands the checker. */
export interface WhatToCheck {
  /** The pack, exactly as it was received. */
  readonly pack: Uint8Array
  /** Every entry of the record, in order. */
  readonly events: readonly ChainedEvent[]
  /** The run the record belongs to. */
  readonly runId: string
  /** The attestation over the end of the record, if the pack came with one. */
  readonly attestation: Attestation | undefined
  /** The published public key, read from this repository. */
  readonly publicKeyPem: string
  /**
   * The fingerprint the record says the pack had when it was sealed.
   *
   * Worked out from the record rather than passed in, so that a caller cannot
   * simply assert the answer.
   */
  readonly recordedPackFingerprint: string | undefined
}

/**
 * Find what the record says the pack's fingerprint was.
 *
 * Reads the record rather than trusting anybody. If the record does not say, the
 * checker reports that it cannot say rather than guessing.
 */
export function packFingerprintFromRecord(
  events: readonly ChainedEvent[],
  payloadOf: (event: ChainedEvent) => Record<string, unknown> | null,
): string | undefined {
  let found: string | undefined

  for (const event of events) {
    if (event.kind !== 'pack.sealed') continue
    const payload = payloadOf(event)
    const fingerprint = payload?.['fingerprint']
    if (typeof fingerprint === 'string') found = fingerprint
  }

  return found
}

/** Check everything, and say what could not be checked. */
export function verifyEverything(input: WhatToCheck): VerificationResult {
  const findings: Finding[] = []

  // ---- 1. is the pack sealed, and at the right level? -----------------------
  const seal = readSeal(input.pack)

  findings.push({
    question: 'Is the pack a PDF that carries a seal?',
    answer: seal.isPdf && seal.hasSeal ? 'yes' : 'no',
    detail: !seal.isPdf
      ? 'The file is not a PDF at all.'
      : seal.hasSeal
        ? 'It carries a seal.'
        : 'It is a PDF, but nothing has sealed it. Anything in it could have been changed with nothing to show for it.',
  })

  findings.push({
    question: 'Does the seal say only filling in and signing are allowed?',
    answer: seal.permissionLevel === PERMISSION_FILL_IN_AND_SIGN_ONLY ? 'yes' : 'no',
    detail:
      seal.permissionLevel === undefined
        ? 'The file carries no permission setting, so it does not restrict what may be done to it.'
        : seal.permissionLevel === PERMISSION_FILL_IN_AND_SIGN_ONLY
          ? 'Permission level 2. Filling in and signing, and nothing else.'
          : `Permission level ${seal.permissionLevel}. Level 1 would stop the owners signing at all; level 3 would additionally allow content to be added to the page.`,
  })

  findings.push({
    question: 'Does the seal cover the whole file?',
    answer: seal.coversWholeFile ? 'yes' : 'no',
    detail: seal.coversWholeFile
      ? `All ${seal.sizeBytes} bytes are inside the sealed range.`
      : 'Part of this file sits outside the seal, so it could be changed without the seal breaking. That reads exactly like a document nobody has touched.',
  })

  // ---- 2. is this the pack the record is about? ------------------------------
  const actual = fingerprintBytes(input.pack)

  findings.push({
    question: 'Is this the same pack the record describes?',
    answer:
      input.recordedPackFingerprint === undefined
        ? 'cannot say'
        : input.recordedPackFingerprint === actual
          ? 'yes'
          : 'no',
    detail:
      input.recordedPackFingerprint === undefined
        ? 'The record does not say what the pack’s fingerprint was, so there is nothing to compare against.'
        : input.recordedPackFingerprint === actual
          ? `Both are ${actual.slice(0, 16)}…`
          : `The record says ${input.recordedPackFingerprint.slice(0, 16)}… and this file is ${actual.slice(0, 16)}…. These are different files.`,
  })

  // ---- 3. is the record unbroken? --------------------------------------------
  const chain = checkChain(input.events, input.runId)

  findings.push({
    question: 'Is the record unbroken from the first entry to the last?',
    answer: chain.ok ? 'yes' : 'no',
    detail: chain.ok
      ? `${input.events.length} entries, each carrying the fingerprint of the one before it.`
      : describeBreak(chain),
  })

  // ---- 4. does the attestation vouch for the end of it? ----------------------
  if (input.attestation === undefined) {
    findings.push({
      question: 'Does an attestation vouch for the end of the record?',
      answer: 'cannot say',
      detail:
        'No attestation came with this pack. Without one, entries removed from the END of the record cannot be detected, because a shortened chain is still a valid chain.',
    })
  } else {
    const publicKey = createPublicKey(input.publicKeyPem)
    const check = verifyAttestation(input.attestation, input.publicKeyPem)

    findings.push({
      question: 'Does the attestation match, against the key that came from outside the pack?',
      answer: check.ok ? 'yes' : 'no',
      detail: check.ok
        ? `Made with key ${keyIdOf(publicKey).slice(0, 16)}…, which is the key this check was given. This is what catches entries removed from the end.`
        : `It does not: ${check.reason}`,
    })

    findings.push({
      question: 'Does the attestation cover the record that was handed over?',
      answer: coversTheseEvents(input) ? 'yes' : 'no',
      detail: coversTheseEvents(input)
        ? `It vouches for ${input.attestation.count} entries, and ${input.events.length} were handed over.`
        : `It vouches for ${input.attestation.count} entries and ${input.events.length} were handed over. Entries have been added or removed since it was made.`,
    })
  }

  const answered = findings.filter((one) => one.answer !== 'cannot say')

  return {
    findings,
    ok: answered.length > 0 && answered.every((one) => one.answer === 'yes'),
    cannotProve: [
      'Who sealed this. The certificate is issued by Charter to Charter, so no outside authority has checked that Charter is who it says it is. A PDF reader will report the same thing. What is proved above is that the file has not changed since it was sealed, which is a claim about the bytes rather than about identity.',
      'That the record is complete in the sense of nothing having been left out at the time of writing. It proves nothing was altered or removed afterwards, which is a different and smaller claim.',
      'Anything about whether the agreement is right for these people. This is not a review of the document, and nothing here is a legal opinion.',
    ],
  }
}

/** Whether the attestation is about the entries actually handed over. */
function coversTheseEvents(input: WhatToCheck): boolean {
  const attestation = input.attestation
  if (attestation === undefined) return false

  const last = input.events[input.events.length - 1]
  return (
    String(attestation.count) === String(input.events.length) &&
    (last === undefined || attestation.head === last.hash)
  )
}

function describeBreak(chain: ReturnType<typeof checkChain>): string {
  if (chain.ok) return ''
  const at = chain.firstBreak
  return (
    `The record breaks at entry ${at.seq}: ${at.detail} ` +
    `Everything before it is intact; everything from there on cannot be relied on.`
  )
}

/** The findings written out for a person to read. */
export function describeVerification(result: VerificationResult): string {
  const lines: string[] = []

  for (const finding of result.findings) {
    const mark = finding.answer === 'yes' ? 'yes' : finding.answer === 'no' ? 'NO ' : ' ? '
    lines.push(`  [${mark}] ${finding.question}`)
    lines.push(`        ${finding.detail}`)
    lines.push('')
  }

  lines.push('  What this check cannot prove:')
  for (const limit of result.cannotProve) lines.push(`    - ${limit}`)

  return lines.join('\n')
}
