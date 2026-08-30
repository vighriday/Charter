/**
 * The ordinary code that carries an approved pack to the owners to sign.
 *
 * WHY THIS FILE IS NOT PART OF THE AGENT
 *
 * This is the only thing in the project that reaches the module which asks a person
 * to sign. It runs after a person has approved, it is called by ordinary code
 * rather than by the agent, and nothing the model can trigger can reach it — that
 * is checked by following every import in the project, not by anybody remembering.
 *
 * The agent has no tool that starts a signature, in any stage, and stage seven —
 * the stage where this happens — has no tools at all. So there are three separate
 * things standing between a model and a signature request: the tool does not exist,
 * the stage is empty, and the code is out of reach. Any one of them would do. All
 * three are there because the promise is the product.
 *
 * WHAT IT READS, AND WHY IT READS IT FROM THE RECORD
 *
 * The approval comes out of the append-only record rather than being passed in.
 * Anything passed in is something a caller could invent. The record is written by
 * one path, is checked by a chain of fingerprints, and the database itself refuses
 * to change what is already in it. Reading the permission from there means the
 * check cannot be satisfied by a caller that simply says it has permission.
 *
 * That is the same reasoning as the spending rule, and for the same reason: the
 * obvious way to break a guard is to hand it its own answer.
 */

import type { Database } from '../db/driver.js'
import { append, readEvents, readPayload, type Clock } from '../record/log.js'
import { fingerprintBytes } from '../record/canonical.js'
import {
  prepareSignatureRequest,
  WillNotSend,
  type RecordedApproval,
  type Signer,
  type WhereToSign,
} from '../sign/request.js'

/** Where the pack actually goes, kept behind a small interface so tests need none of it. */
export interface SigningService {
  /**
   * Create the signing folder and return its identifier and state.
   *
   * Nothing is emailed at this point. The moment a person is asked to sign is a
   * moment this project controls and records.
   */
  create(request: {
    readonly caseId: string
    readonly pack: Uint8Array
    readonly signers: readonly Signer[]
    readonly whereToSign: WhereToSign
  }): Promise<{ readonly folderId: string; readonly state: string }>
}

/** What happened. */
export interface SentForSignature {
  readonly folderId: string
  readonly state: string
  readonly packFingerprint: string
  readonly signers: readonly string[]
}

/**
 * Read the approval a person recorded for this case, if there is one.
 *
 * Returns the LAST one, because a person may approve, the pack may be rebuilt, and
 * they may approve again. An earlier approval naming an older pack must not be the
 * one that counts.
 */
export async function approvalOnRecord(
  db: Database,
  caseId: string,
): Promise<RecordedApproval | undefined> {
  const events = await readEvents(db, caseId)
  let found: RecordedApproval | undefined

  for (const event of events) {
    if (event.kind !== 'signature.approved') continue

    // A forgotten payload is a real state in this project: personal details can be
    // cleared while the entry itself stays, so the chain still checks out. An
    // approval whose detail is gone cannot be relied on, so it is passed over
    // rather than treated as permission.
    const payload = await readPayload(db, caseId, event.seq)
    if (payload === null) continue

    const approvedBy = payload['approvedBy']
    const packFingerprint = payload['packFingerprint']
    const approvedAt = payload['approvedAt']

    if (
      typeof approvedBy !== 'string' ||
      typeof packFingerprint !== 'string' ||
      typeof approvedAt !== 'string'
    ) {
      continue
    }

    found = { approvedBy, packFingerprint, approvedAt }
  }

  return found
}

/**
 * Send the pack for signature, or refuse and record the refusal.
 *
 * The refusal is written into the record rather than only returned. Somebody
 * reading a run afterwards should be able to see the moment Charter was asked to
 * send something out and declined, and why. A refusal that leaves no trace cannot
 * be told apart from never having been attempted.
 */
export async function sendForSignature(options: {
  readonly db: Database
  readonly caseId: string
  readonly clock: Clock
  readonly service: SigningService
  readonly pack: Uint8Array
  readonly signers: readonly Signer[]
  readonly whereToSign: WhereToSign
}): Promise<SentForSignature> {
  const { db, caseId, clock } = options
  const packFingerprint = fingerprintBytes(options.pack)
  const approval = await approvalOnRecord(db, caseId)

  let request
  try {
    request = prepareSignatureRequest({
      caseId,
      pack: options.pack,
      packFingerprint,
      approval,
      signers: options.signers,
      whereToSign: options.whereToSign,
    })
  } catch (error) {
    const why = error instanceof WillNotSend ? error.message : String(error)
    await append(
      db,
      {
        runId: caseId,
        kind: 'signature.request.refused',
        actor: 'system',
        stage: null,
        payload: { why, packFingerprint },
      },
      clock,
    )
    throw error
  }

  const created = await options.service.create({
    caseId,
    pack: request.pack,
    signers: request.signers,
    whereToSign: request.whereToSign,
  })

  await append(
    db,
    {
      runId: caseId,
      kind: 'signature.requested',
      actor: 'system',
      stage: null,
      payload: {
        folderId: created.folderId,
        state: created.state,
        packFingerprint,
        signers: request.signers.map((one) => one.fullName) as unknown as never,
        // Recorded because getting this wrong produces a signing screen where a
        // person can finish without signing anything.
        whereToSign: request.whereToSign,
      },
    },
    clock,
  )

  return {
    folderId: created.folderId,
    state: created.state,
    packFingerprint,
    signers: request.signers.map((one) => one.fullName),
  }
}
