/**
 * Carrying the finished pack to the owners and asking them to sign it.
 *
 * THIS IS THE MODULE THE WHOLE PROJECT IS BUILT AROUND NOT REACHING.
 *
 * Charter's promise is that the software never signs on a person's behalf. The
 * strongest form of that promise is not a rule the model is asked to follow. It is
 * that the code which starts a signature cannot be reached from anything the model
 * can trigger — not "we were careful", but no chain of imports leading from any
 * tool handler to this file, of any length. Code that cannot be reached cannot be
 * run, whatever the model asks for.
 *
 * `tests/boundary.test.ts` follows every import in the project and fails the build
 * if that is ever untrue. The rule was written down in `src/boundary/policy.ts`
 * before this file existed, marked as guarding something not yet built, and the
 * test asserted that the folder really was empty — so that the day it appeared,
 * the build would fail until somebody deliberately wrote down who may reach it.
 * That is what happened. This file's arrival is the moment that trip wire fired.
 *
 * WHAT THIS DOES NOT DO
 *
 * It does not sign anything. It cannot. It prepares a request — who has to sign,
 * where on the page, and what they are being asked to sign — and hands it to an
 * outside service that shows the document to those people in their own browsers.
 * They sign it themselves, with their own hands. Nothing here has, or could have,
 * the intent to be bound that a signature requires.
 *
 * THE FOUR THINGS IT REFUSES TO DO
 *
 * Every one of these is a way the promise could be broken while every screen still
 * said the run had succeeded.
 *
 *   1. It refuses without a recorded approval from a person.
 *   2. It refuses if that approval names a different pack than the one in hand.
 *   3. It refuses to send a pack that is not sealed.
 *   4. It refuses to create a request with nowhere to sign.
 *
 * The fourth one is the quietest and the worst. The signing service places the
 * signature by one of two mechanisms, and if neither is switched on the signing
 * screen reports zero required fields and the person can reach "Finish" without
 * ever having signed. A system whose entire argument is that only a person signs,
 * producing an unsigned document while every screen says it worked, is the worst
 * available failure. So it is checked here, before anything is sent.
 */

import { readSeal } from '../seal/seal.js'
import { isFingerprint } from '../record/canonical.js'

/** One person who has to sign, and where. */
export interface Signer {
  readonly fullName: string
  readonly email: string
  /**
   * The order they sign in, from one.
   *
   * Written down rather than left to the service's default, because "both owners
   * signed" and "one owner signed twice" are different documents and only one of
   * them is the deal.
   */
  readonly order: number
}

/** A person's recorded approval that the pack may be sent. */
export interface RecordedApproval {
  readonly approvedBy: string
  /** The fingerprint of the pack they were looking at when they approved. */
  readonly packFingerprint: string
  readonly approvedAt: string
}

/**
 * How the signing service is told where the signature goes.
 *
 * The service supports two, and this project always sets one explicitly. There is
 * deliberately no third option meaning "let the service decide", because that is
 * exactly the setting that produces a document nobody signed.
 */
export type WhereToSign =
  /** Marks embedded in the document text, which the service finds and replaces. */
  | 'text tags in the document'
  /** Form fields already present in the document. */
  | 'form fields already in the document'
  /**
   * Exact places, given by Charter, where it drew the signature lines.
   *
   * The most explicit of the three, and the one this project uses. Charter draws
   * the lines, so Charter is the only thing that knows where they are. The other
   * two ask the service to go looking, and a search that finds nothing produces
   * exactly the failure this file exists to prevent.
   */
  | 'boxes placed where Charter drew the lines'

/**
 * Where one person signs, as the signing service measures it.
 *
 * Repeated here rather than imported from the pack writer, because this module
 * must not depend on how a document happens to be built. Anything that can say
 * "this person, this page, this box" can be sent for signature.
 */
export interface SignatureBox {
  readonly owner: string
  /** Which page, counting from one. */
  readonly page: number
  /** From the left edge. */
  readonly x: number
  /** From the TOP edge, which is how every signing service measures. */
  readonly y: number
  readonly width: number
  readonly height: number
}

/** Everything needed to ask people to sign, once every check has passed. */
export interface SignatureRequest {
  readonly caseId: string
  /** The sealed pack, exactly as it will be sent. */
  readonly pack: Uint8Array
  readonly packFingerprint: string
  readonly signers: readonly Signer[]
  readonly whereToSign: WhereToSign
  /** Where each person signs. Never empty when boxes are the mechanism. */
  readonly boxes: readonly SignatureBox[]
  /**
   * Whether the service should email the signers immediately.
   *
   * Always false here. The moment a person is asked to sign is a moment this
   * project controls and records, rather than a side effect of creating a request.
   */
  readonly sendImmediately: false
}

export class WillNotSend extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'WillNotSend'
  }
}

/**
 * Build the request, or refuse and say exactly why.
 *
 * Nothing is sent from here. This produces the request and the caller does the
 * sending, so that every reason for refusing can be tested without a network, an
 * account, or a key.
 */
export function prepareSignatureRequest(input: {
  readonly caseId: string
  readonly pack: Uint8Array
  readonly packFingerprint: string
  readonly approval: RecordedApproval | undefined
  readonly signers: readonly Signer[]
  readonly whereToSign: WhereToSign
  readonly boxes?: readonly SignatureBox[]
}): SignatureRequest {
  // ---- 1. a person approved -------------------------------------------------
  if (input.approval === undefined) {
    throw new WillNotSend(
      'No person has approved sending this pack. There is no tool that writes that ' +
        'approval and nothing the model can trigger can reach the code that does, ' +
        'so this is not a check that can be argued past — it is the boundary.',
    )
  }

  // ---- 2. the approval is for THIS pack -------------------------------------
  if (!isFingerprint(input.packFingerprint)) {
    throw new WillNotSend(
      `"${input.packFingerprint}" is not a fingerprint. Without one there is nothing ` +
        `to compare the approval against, and an approval attached to no particular ` +
        `document approves whatever turns up.`,
    )
  }

  if (input.approval.packFingerprint !== input.packFingerprint) {
    throw new WillNotSend(
      `The approval was given for a pack whose fingerprint began ` +
        `${input.approval.packFingerprint.slice(0, 12)}, and the pack in hand begins ` +
        `${input.packFingerprint.slice(0, 12)}. An approval belongs to the exact ` +
        `document a person was looking at. Letting it carry across is how somebody ` +
        `ends up having approved a document they never saw.`,
    )
  }

  // ---- 3. the pack is sealed -------------------------------------------------
  const seal = readSeal(input.pack)

  if (!seal.isPdf) {
    throw new WillNotSend('The pack is not a PDF, so there is nothing anybody could sign.')
  }
  if (!seal.hasSeal) {
    throw new WillNotSend(
      'The pack has not been sealed. Sending an unsealed document means the file ' +
        'people sign is not provably the file that was approved.',
    )
  }
  if (!seal.coversWholeFile) {
    throw new WillNotSend(
      'The seal on this pack does not cover the whole file, so part of it could ' +
        'change without the seal breaking. That reads to a person exactly like a ' +
        'document nobody has touched.',
    )
  }

  // ---- 4. there is somewhere to sign ------------------------------------------
  if (input.signers.length === 0) {
    throw new WillNotSend('There is nobody to ask.')
  }

  const orders = input.signers.map((one) => one.order)
  if (new Set(orders).size !== orders.length) {
    throw new WillNotSend(
      'Two signers were given the same position in the signing order. "Both owners ' +
        'signed" and "one owner signed twice" are different documents, and only one ' +
        'of them is the deal.',
    )
  }

  for (const signer of input.signers) {
    if (!signer.email.includes('@') || signer.fullName.trim() === '') {
      throw new WillNotSend(
        `"${signer.fullName || '(no name)'}" has no usable name and address, so the ` +
          `request would go to nobody.`,
      )
    }
  }

  // ---- 5. every person has a box, when boxes are the mechanism ---------------
  //
  // The quietest failure available to this project, checked hardest. A folder
  // with no box, or with a box for one owner and not the other, produces a
  // signing screen a person can finish without signing, and every screen after
  // it says the run worked.
  const boxes = input.boxes ?? []

  if (input.whereToSign === 'boxes placed where Charter drew the lines') {
    if (boxes.length === 0) {
      throw new WillNotSend(
        'The signature boxes were not given, so there would be nowhere to sign. ' +
          'The service would report a completed folder containing an unsigned ' +
          'document, which is the worst outcome this project has.',
      )
    }

    const withoutABox = input.signers.filter(
      (signer) => !boxes.some((box) => box.owner === signer.fullName),
    )
    if (withoutABox.length > 0) {
      throw new WillNotSend(
        `${withoutABox.map((one) => one.fullName).join(' and ')} would be asked to ` +
          `sign a document with no signature box for them. A packet where one owner ` +
          `signs and another cannot is not the deal the packet describes.`,
      )
    }

    const strangers = boxes.filter(
      (box) => !input.signers.some((signer) => signer.fullName === box.owner),
    )
    if (strangers.length > 0) {
      throw new WillNotSend(
        `There is a signature box for ${strangers.map((one) => `"${one.owner}"`).join(' and ')}, ` +
          `who is not being asked to sign. A box belonging to nobody in the list is a ` +
          `box the service may hand to whoever it likes.`,
      )
    }
  }

  return {
    caseId: input.caseId,
    pack: input.pack,
    packFingerprint: input.packFingerprint,
    signers: [...input.signers].sort((a, b) => a.order - b.order),
    whereToSign: input.whereToSign,
    boxes,
    // Never true. The moment a person is asked is a moment this project controls.
    sendImmediately: false,
  }
}

/**
 * The four states a signing request moves through, in the service's own words.
 *
 * Only the last one means finished. Releasing anything at `completed` would hand
 * over a document still missing the service's own closing seal.
 */
export const SIGNING_STATES = ['draft', 'shared', 'completed', 'executed'] as const
export type SigningState = (typeof SIGNING_STATES)[number]

/** The one state that means every person has signed and the service has closed it. */
export const FINISHED: SigningState = 'executed'

/**
 * Whether a reported state means the work is genuinely done.
 *
 * A message arriving from the service saying "signed" is treated as a hint and
 * never as the truth — the caller reads the state back from the service itself
 * before releasing anything. That works whether or not the message can be checked,
 * and removes a whole class of forgery worry rather than arguing about one.
 */
export function isFinished(state: string): boolean {
  return state === FINISHED
}
