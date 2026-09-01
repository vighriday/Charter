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
import { anchorCovers, type Anchor } from '../record/anchor.js'

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
  /**
   * An outside timestamp over the end of the record, if the pack came with one.
   *
   * This is the answer to the fairest criticism of everything above it. Charter
   * holds the record AND the key that attests over it, so in principle we could
   * produce a different record and attest over that instead. Nothing inside the
   * record would show it.
   *
   * A timestamp authority is somebody who is not us. They are shown a fingerprint
   * — never the record — and they say they were shown it at a moment. That does
   * not stop the record being rewritten. It means a rewritten record produces a
   * different ending, while an outside statement about the old ending still
   * exists. The past can still be rewritten; it can no longer be rewritten
   * quietly.
   */
  readonly anchor?: Anchor
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
    question: 'Is the file a real PDF with a stamp on it?',
    answer: seal.isPdf && seal.hasSeal ? 'yes' : 'no',
    detail: !seal.isPdf
      ? 'The file is not a PDF at all.'
      : seal.hasSeal
        ? 'It carries a seal.'
        : 'It is a PDF, but nothing has sealed it. Anything in it could have been changed with nothing to show for it.',
  })

  findings.push({
    question: 'Does the stamp allow only filling in and signing?',
    answer: seal.permissionLevel === PERMISSION_FILL_IN_AND_SIGN_ONLY ? 'yes' : 'no',
    detail:
      seal.permissionLevel === undefined
        ? 'The file carries no permission setting, so it does not restrict what may be done to it.'
        : seal.permissionLevel === PERMISSION_FILL_IN_AND_SIGN_ONLY
          ? 'Permission level 2. Filling in and signing, and nothing else.'
          : `Permission level ${seal.permissionLevel}. Level 1 would stop the owners signing at all; level 3 would additionally allow content to be added to the page.`,
  })

  findings.push({
    question: 'Does the stamp cover the whole file?',
    answer: seal.coversWholeFile ? 'yes' : 'no',
    detail: seal.coversWholeFile
      ? `All ${seal.sizeBytes} bytes are inside the sealed range.`
      : 'Part of this file sits outside the seal, so it could be changed without the seal breaking. That reads exactly like a document nobody has touched.',
  })

  // ---- 2. is this the pack the record is about? ------------------------------
  const actual = fingerprintBytes(input.pack)

  findings.push({
    question: 'Is this the same file the diary describes?',
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
    question: 'Does every step in the diary match the one before it?',
    answer: chain.ok ? 'yes' : 'no',
    detail: chain.ok
      ? `${input.events.length} entries, each carrying the fingerprint of the one before it.`
      : describeBreak(chain),
  })

  // ---- 4. does the attestation vouch for the end of it? ----------------------
  if (input.attestation === undefined) {
    findings.push({
      question: 'Is there a sealed note saying how the diary ended?',
      answer: 'cannot say',
      detail:
        'No attestation came with this pack. Without one, entries removed from the END of the record cannot be detected, because a shortened chain is still a valid chain.',
    })
  } else {
    const publicKey = createPublicKey(input.publicKeyPem)
    const check = verifyAttestation(input.attestation, input.publicKeyPem)

    findings.push({
      question: 'Does that note check out, using a key from outside the file?',
      answer: check.ok ? 'yes' : 'no',
      detail: check.ok
        ? `Made with key ${keyIdOf(publicKey).slice(0, 16)}…, which is the key this check was given. This is what catches entries removed from the end.`
        : `It does not: ${check.reason}`,
    })

    findings.push({
      question: 'Does that note describe the diary that was handed over?',
      answer: coversTheseEvents(input) ? 'yes' : 'no',
      detail: coversTheseEvents(input)
        ? `The note says there were ${input.attestation.count} steps, and ${input.events.length} were handed over.`
        : `The note says there were ${input.attestation.count} steps and ${input.events.length} were handed over. Steps have been added or taken away since it was stamped.`,
    })
  }

  // ---- 5. has anybody outside Charter said this record existed? --------------
  const last = input.events[input.events.length - 1]

  if (input.anchor === undefined) {
    findings.push({
      question: 'Has anybody outside Charter confirmed this diary existed?',
      answer: 'cannot say',
      detail:
        'No outside timestamp came with this file. Charter holds both the diary and ' +
        'the key that stamps it, so everything above is checked using things Charter ' +
        'made itself. Without somebody outside, nothing here rules out the whole ' +
        'diary having been written later than it says.',
    })
  } else {
    const covers = anchorCovers(input.anchor, last?.hash ?? '')
    findings.push({
      question: 'Has anybody outside Charter confirmed this diary existed?',
      answer: covers.ok ? 'yes' : 'no',
      detail: covers.ok
        ? `${covers.reason} They were shown a fingerprint and nothing else, never the diary itself. This does not stop the diary being rewritten. It means a rewritten diary would end differently, while their statement about the old ending would still be out there.`
        : covers.reason,
    })
  }

  const answered = findings.filter((one) => one.answer !== 'cannot say')

  return {
    findings,
    ok: answered.length > 0 && answered.every((one) => one.answer === 'yes'),
    cannotProve: [
      ...(input.anchor === undefined
        ? [
            'That this diary is as old as it says. Charter holds both the diary and the key that stamps it, so a diary written later, all in one go, would look exactly like this one. A timestamp from an outside authority would settle it, and this file did not come with one.',
          ]
        : [
            "Whether the outside authority's own signature on their timestamp is valid. Checking that properly means testing their certificate against the list of authorities your computer already trusts, which your computer does better than we could. Run: openssl ts -reply -in <the token> -text. What is checked here is that their timestamp is about this diary's ending and no other, which is the part that would otherwise slip by.",
          ]),
      'Who stamped this. The certificate is Charter vouching for Charter, so nobody outside has checked that Charter is who it says it is. Any PDF reader will tell you the same. What is proved above is that the file has not changed since it was finished, which is about the file and not about identity.',
      'That nothing was left out in the first place. It proves nothing was changed or removed afterwards, which is a smaller thing.',
      'Whether this contract is right for these two people. Nobody here has reviewed it, and nothing here is legal advice.',
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
