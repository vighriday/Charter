/**
 * The attestation — Charter vouching for its own record.
 *
 * WHY THE WORD MATTERS
 *
 * Three words in this project have fixed meanings and never move:
 *
 *   SEAL         what the machine puts on a document it made
 *   ATTESTATION  what the machine puts over its own record, vouching for its conduct
 *   SIGNATURE    what a PERSON does, with intent, to bind themselves
 *
 * This file produces attestations. It never produces a signature, and the word is
 * not used here for anything a machine does. Anywhere that slips, it is a bug.
 *
 * WHAT AN ATTESTATION IS FOR
 *
 * The chain in `chain.ts` proves nothing was changed, removed from the middle, or
 * reordered. It cannot prove nothing was removed from the END, because a shortened
 * chain is still a valid chain.
 *
 * The attestation is what closes that. It is a statement, cryptographically bound
 * to one key, saying: "at this moment, this run's record ended here, and held this
 * many entries." Remove entries from the end afterwards and the head no longer
 * matches what was attested.
 *
 * WHY THIS IS HONEST RATHER THAN CIRCULAR
 *
 * We are vouching for ourselves, and that is worth exactly as much as our key is
 * trusted. So the public half of the key is committed to the repository, in the
 * open, where it can be compared against what the attestation claims. A checker
 * that read its key out of the file it was checking would prove nothing at all —
 * anyone could sign anything with a key they invented. The key must come from
 * OUTSIDE the thing being checked. That is why `verifyAttestation` demands one and
 * will not fall back to anything.
 *
 * WHY ED25519
 *
 * Built into Node, so no dependency. Small keys, short signatures, fast. And it
 * has no options to get wrong — no key size to choose, no padding mode, no curve
 * to pick badly. For a thing whose whole value is that a stranger can check it,
 * having no wrong way to configure it is the feature.
 */

import {
  generateKeyPairSync,
  sign as cryptoSign,
  verify as cryptoVerify,
  createPublicKey,
  createPrivateKey,
  type KeyObject,
} from 'node:crypto'
import { canonicalText, fingerprint, isFingerprint, isText, describeType } from './canonical.js'

/** What a completed run's record looks like at the moment it is attested. */
export interface RecordHead {
  readonly runId: string
  /** The fingerprint of the final entry, or the run's beginning if there are none. */
  readonly head: string
  /** How many entries, written as text like everything else that counts. */
  readonly count: string
  /** When the attestation was made. ISO 8601, milliseconds, Z. */
  readonly attestedAt: string
}

export interface Attestation extends RecordHead {
  readonly v: '1'
  /**
   * Which key made this — the fingerprint of the public key, not the key itself.
   *
   * Deliberately not the key. Including the key would invite a checker to use it,
   * which would prove nothing. This only lets a checker say "you gave me the wrong
   * key" instead of "the signature failed", which is a far more useful error.
   */
  readonly keyId: string
  /** The signature over the statement, base64. */
  readonly signature: string
}

export class AttestationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'AttestationError'
  }
}

/** The exact bytes that get signed. Anyone can rebuild these and check for themselves. */
function statementBytes(head: RecordHead, keyId: string): Buffer {
  return Buffer.from(
    canonicalText({
      charter: 'record-attestation',
      v: '1',
      runId: head.runId,
      head: head.head,
      count: head.count,
      attestedAt: head.attestedAt,
      keyId,
    }),
    'utf8',
  )
}

/** A short, stable name for a public key: the fingerprint of its standard form. */
export function keyIdOf(publicKey: KeyObject): string {
  return fingerprint({ spki: publicKey.export({ type: 'spki', format: 'der' }).toString('base64') })
}

/** Make a new attestation keypair. Nothing outside, no cost, nothing to renew. */
export function generateKeyPair(): { publicKeyPem: string; privateKeyPem: string; keyId: string } {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519')
  return {
    publicKeyPem: publicKey.export({ type: 'spki', format: 'pem' }).toString(),
    privateKeyPem: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
    keyId: keyIdOf(publicKey),
  }
}

/**
 * Read the private half out of the environment, in whichever form it was stored.
 *
 * A key is several lines of text, and an environment file holds one value per
 * line. So the key is stored with its line breaks spelled out as the two
 * characters `\` and `n`, usually inside quotes. Both are undone here.
 *
 * Doing this in one named place matters more than it looks. The same key stored
 * two slightly different ways — quoted here, unquoted there — produces two
 * different failures, at different times, on different machines, and the error
 * a person actually sees says only "could not be read".
 *
 * Returns `undefined` when the value is absent or blank, so the caller can say
 * what is missing and why it matters. It never guesses, never falls back to a key
 * of its own, and never makes one: a system that quietly invents a key when the
 * real one is missing would still produce attestations, and every one of them
 * would be worthless.
 */
export function privateKeyFromEnv(env: NodeJS.ProcessEnv = process.env): string | undefined {
  const raw = env['ATTESTATION_PRIVATE_KEY']
  if (raw === undefined) return undefined

  let value = raw.trim()
  if (value === '') return undefined

  // Strip one matching pair of surrounding quotes, if present.
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    value = value.slice(1, -1)
  }
  // Turn the spelled-out line breaks back into real ones.
  value = value.replace(/\\n/g, '\n')

  return value.endsWith('\n') ? value : `${value}\n`
}

/**
 * The message to show when the private half is missing.
 *
 * Written out rather than left to each caller, because this is the moment where a
 * system quietly stops proving anything, and the person reading needs to know that
 * rather than see a blank.
 */
export const NO_PRIVATE_KEY =
  'ATTESTATION_PRIVATE_KEY is not set, so the record cannot be vouched for. ' +
  'Run `npm run keys:generate` — it writes the private half into .env and the ' +
  'public half into keys/attestation.pub, which is meant to be published. ' +
  'Without it the chain still detects any entry that was changed, removed from ' +
  'the middle, or reordered; what it cannot detect on its own is entries removed ' +
  'from the end, and closing that is exactly what the attestation is for.'

function loadPrivate(pem: string): KeyObject {
  let key: KeyObject
  try {
    key = createPrivateKey(pem)
  } catch {
    throw new AttestationError(
      'the attestation private key could not be read. It should be a PKCS#8 PEM block, ' +
        'the kind that starts with -----BEGIN PRIVATE KEY-----',
    )
  }
  if (key.asymmetricKeyType !== 'ed25519') {
    throw new AttestationError(
      `the attestation key must be Ed25519, but this one is ${key.asymmetricKeyType ?? 'of unknown type'}`,
    )
  }
  return key
}

function loadPublic(pem: string): KeyObject {
  let key: KeyObject
  try {
    key = createPublicKey(pem)
  } catch {
    throw new AttestationError(
      'the attestation public key could not be read. It should be an SPKI PEM block, ' +
        'the kind that starts with -----BEGIN PUBLIC KEY-----',
    )
  }
  if (key.asymmetricKeyType !== 'ed25519') {
    throw new AttestationError(
      `the attestation key must be Ed25519, but this one is ${key.asymmetricKeyType ?? 'of unknown type'}`,
    )
  }
  return key
}

/**
 * Refuse anything that is not genuinely text.
 *
 * Same guard as the one in chain.ts, for the same reason and against the same
 * mistake — see `isText` in canonical.ts. `count` is the dangerous field here:
 * `/^(0|[1-9]\d*)$/.test(12)` passes, and a numeric count would be signed as
 * `{"count":12}` where every checker rebuilds `{"count":"12"}`.
 */
function mustBeText(value: unknown, field: string): asserts value is string {
  if (!isText(value)) {
    throw new AttestationError(
      `${field} must be text, but it is ${describeType(value)} (${JSON.stringify(value)}). ` +
        `Identifiers, times and counts are always text in an attestation.`,
    )
  }
}

/** Vouch for where a run's record ended. */
export function attest(head: RecordHead, privateKeyPem: string): Attestation {
  mustBeText(head.runId, 'runId')
  mustBeText(head.head, 'head')
  mustBeText(head.count, 'count')
  mustBeText(head.attestedAt, 'attestedAt')

  if (!isFingerprint(head.head)) {
    throw new AttestationError('head must be 64 lowercase hex characters')
  }
  if (!/^(0|[1-9]\d*)$/.test(head.count)) {
    throw new AttestationError('count must be a whole number written as text')
  }
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(head.attestedAt)) {
    throw new AttestationError('attestedAt must look like 2026-08-27T09:15:00.000Z')
  }

  const privateKey = loadPrivate(privateKeyPem)
  const keyId = keyIdOf(createPublicKey(privateKey))
  // Ed25519 hashes internally, so the algorithm argument is null by design.
  const signature = cryptoSign(null, statementBytes(head, keyId), privateKey)

  return { v: '1', ...head, keyId, signature: signature.toString('base64') }
}

export type AttestationCheck =
  | { readonly ok: true; readonly keyId: string }
  | { readonly ok: false; readonly reason: string }

/**
 * Check an attestation against a public key that came from somewhere else.
 *
 * `publicKeyPem` is required and there is no default. That is the whole point: the
 * key must come from outside the thing being checked, or this proves nothing.
 *
 * `expectedHead` is optional but should almost always be supplied — it is what
 * turns "this attestation is genuine" into "this attestation is genuine AND it
 * describes the record I am actually holding". Without it, a real attestation for
 * a different, longer version of the record would still pass.
 */
export function verifyAttestation(
  attestation: Attestation,
  publicKeyPem: string,
  expectedHead?: { head: string; count: string; runId: string },
): AttestationCheck {
  let publicKey: KeyObject
  try {
    publicKey = loadPublic(publicKeyPem)
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : 'the public key is unreadable' }
  }

  const keyId = keyIdOf(publicKey)
  if (attestation.keyId !== keyId) {
    return {
      ok: false,
      reason:
        'this attestation was made with a different key than the one supplied. ' +
        `It names ${attestation.keyId.slice(0, 16)}…, and the key given is ${keyId.slice(0, 16)}…`,
    }
  }

  if (attestation.v !== '1') {
    return { ok: false, reason: `this attestation is version ${attestation.v}, which this checker does not know` }
  }

  let signature: Buffer
  try {
    signature = Buffer.from(attestation.signature, 'base64')
  } catch {
    return { ok: false, reason: 'the signature is not valid base64' }
  }

  const bytes = statementBytes(attestation, keyId)
  if (!cryptoVerify(null, bytes, publicKey, signature)) {
    return { ok: false, reason: 'the signature does not match. This attestation was altered after it was made' }
  }

  if (expectedHead) {
    if (attestation.runId !== expectedHead.runId) {
      return {
        ok: false,
        reason: `this attestation is for run ${attestation.runId}, not ${expectedHead.runId}`,
      }
    }
    if (attestation.head !== expectedHead.head) {
      return {
        ok: false,
        reason:
          'the record does not end where this attestation says it ended. ' +
          'Entries have been added or removed since it was made',
      }
    }
    if (attestation.count !== expectedHead.count) {
      return {
        ok: false,
        reason: `this attestation covers ${attestation.count} entries, but the record holds ${expectedHead.count}`,
      }
    }
  }

  return { ok: true, keyId }
}

/** Plain-words summary, for people rather than programs. */
export function describeAttestation(result: AttestationCheck): string {
  if (result.ok) {
    return (
      `The record is attested by key ${result.keyId.slice(0, 16)}…\n` +
      `This confirms the record ends where it was said to end, and that nothing was\n` +
      `removed from the end after the fact. It is Charter vouching for its own conduct,\n` +
      `and it is worth exactly as much as that key is trusted — which is why the public\n` +
      `half is published, so you can check it came from us and not from someone else.`
    )
  }
  return `The attestation does not hold: ${result.reason}.`
}
