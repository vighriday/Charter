/**
 * Putting the finished pack together, and the one rule about the order it happens
 * in.
 *
 * WHAT THE PACK IS
 *
 * At the end of a run Charter has produced several documents: the ownership
 * agreement, the record of what was done, copies of the identity documents. They
 * are merged into one file, and that file is what the owners are asked to sign.
 *
 * THE RULE, AND WHY IT IS THE WHOLE OF THIS FILE
 *
 *     Merge. Then seal. Then fingerprint the sealed bytes.
 *     Nothing that rewrites the file may run after the seal.
 *
 * A **seal** here is a machine act on a document: Charter closes the pack and
 * fixes what it contains. It is not a signature. Only a person signs, and nothing
 * in this project signs on anybody's behalf.
 *
 * WHY THE ORDER MATTERS MORE THAN IT LOOKS
 *
 * The document service Charter uses has thirty-two operations and none of them can
 * create a signature. That is the right instinct and it is only half the problem.
 *
 * Several of those operations **rewrite the file**. Flattening turns form fields
 * into flat text and destroys the signature field. Adding a watermark rewrites the
 * page content and invalidates the seal. Deleting or reordering pages can remove
 * the signature page outright. Compressing, protecting and removing a password all
 * rewrite the file too.
 *
 * So a program holding all thirty-two of those operations and no signing operation
 * can still take a **signed** contract and make its signature unverifiable, or
 * delete the signed page entirely.
 *
 *     You can stop an agent making a promise, and still leave it able to unmake one.
 *
 * That is the gap this file closes. Once the pack is sealed, every operation that
 * rewrites the file is refused, the refusal is recorded with its reason, and the
 * refusals are printed in the finished pack under their own heading. A list of
 * what a program may do is ordinary. A list of what it may not, with reasons, is
 * not.
 *
 * WHY REFUSALS ARE RECORDED RATHER THAN JUST PREVENTED
 *
 * A refusal that leaves no trace is indistinguishable from never having been
 * attempted. Somebody reading a run afterwards should be able to see the moment
 * Charter was asked to do something and declined, and why.
 */

import { fingerprintBytes } from '../record/canonical.js'

/** One thing that can be done to a document. */
export interface Operation {
  /** The service's own name for it, so two records can be compared. */
  readonly name: string
  /** What it does, in plain words. */
  readonly does: string
  /**
   * Whether running it rewrites the file.
   *
   * This is the field the rule reads. Everything that rewrites the file is refused
   * after the seal, and nothing else is.
   */
  readonly rewritesTheFile: boolean
  /** Why it may not run after the seal. Printed beside the refusal. */
  readonly afterSealing?: string
}

/**
 * Every operation Charter uses, and what each one would do to a sealed pack.
 *
 * Written down here rather than checked case by case, so the list a judge reads is
 * the list the code enforces. There is no second copy to drift.
 */
export const OPERATIONS: readonly Operation[] = [
  {
    name: 'pdf_merge',
    does: 'joins several documents into one file',
    rewritesTheFile: true,
    afterSealing: 'adding pages after sealing would change what was sealed',
  },
  {
    name: 'pdf_extract_text',
    does: 'reads the text out of a scanned page',
    rewritesTheFile: false,
  },
  {
    name: 'pdf_tag',
    does: 'adds structure so a screen reader can read the document properly',
    rewritesTheFile: true,
    afterSealing: 'rewrites the file, so the fingerprint would no longer match',
  },
  {
    name: 'get_pdf_properties',
    does: 'reports what the file contains, including whether it carries a signature',
    rewritesTheFile: false,
  },
  {
    name: 'pdf_flatten',
    does: 'turns form fields into flat text',
    rewritesTheFile: true,
    afterSealing:
      'destroys the signature field, so the people who have to sign would find ' +
      'nowhere to sign',
  },
  {
    name: 'pdf_watermark',
    does: 'stamps text across every page',
    rewritesTheFile: true,
    afterSealing: 'rewrites the page content, which invalidates the seal',
  },
  {
    name: 'pdf_manipulate',
    does: 'deletes, reorders or rotates pages',
    rewritesTheFile: true,
    afterSealing: 'can remove the signature page outright',
  },
  {
    name: 'pdf_compress',
    does: 'makes the file smaller',
    rewritesTheFile: true,
    afterSealing: 'rewrites the file, so the fingerprint would no longer match',
  },
  {
    name: 'pdf_protect',
    does: 'adds a password',
    rewritesTheFile: true,
    afterSealing: 'rewrites the file, so the fingerprint would no longer match',
  },
  {
    name: 'pdf_remove_password',
    does: 'removes a password',
    rewritesTheFile: true,
    afterSealing: 'rewrites the file, so the fingerprint would no longer match',
  },
]

const BY_NAME = new Map(OPERATIONS.map((operation) => [operation.name, operation]))

/** Look up an operation, or say plainly that Charter does not have one by that name. */
export function operation(name: string): Operation | undefined {
  return BY_NAME.get(name)
}

/**
 * Everything Charter would refuse to do to a pack once it is sealed, and why.
 *
 * WHY THIS IS A LIST AND NOT A SENTENCE
 *
 * The finished pack carries a section headed *what Charter was asked to do and
 * would not*. In an ordinary run nothing asks for any of these, so that section
 * would be empty — a heading over nothing, which reads as though the promise were
 * decorative.
 *
 * The honest content is this: the complete list of what would have been refused,
 * taken from the same declarations the rule itself reads. A reader can then check
 * the claim rather than take it, and the list cannot fall out of step with the
 * rule, because it IS the rule.
 *
 * Anything actually refused during a run is added beside it.
 */
export function refusedAfterSealing(): readonly { readonly operation: string; readonly why: string }[] {
  return OPERATIONS.filter((one) => one.rewritesTheFile).map((one) => ({
    operation: one.name,
    why: `${one.does}. ${one.afterSealing ?? 'That would change what was sealed'}.`,
  }))
}

/** Thrown when the order of work would produce a pack nobody can rely on. */
export class OutOfOrder extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'OutOfOrder'
  }
}

/** One thing that happened while the pack was being put together. */
export interface PackStep {
  readonly operation: string
  /** `ran` or `refused`. */
  readonly outcome: 'ran' | 'refused'
  /** Present on a refusal: why. */
  readonly why?: string
}

/** A pack that has been closed, with the fingerprint of exactly what was closed. */
export interface SealedPack {
  /** The fingerprint of the sealed bytes, which is what anybody checks against. */
  readonly fingerprint: string
  /** How many bytes were sealed. */
  readonly sizeBytes: string
  /** Everything that happened, in order, including everything refused. */
  readonly steps: readonly PackStep[]
  /** The refusals on their own, for the heading in the finished pack. */
  readonly refusals: readonly PackStep[]
}

/**
 * Builds one pack, and enforces the ordering rule.
 *
 * Deliberately a small object with a state rather than a set of loose functions.
 * The rule is about what has already happened, so something has to remember, and
 * the safest place for that memory is the thing whose whole purpose is to hold it.
 */
export class Pack {
  private sealed = false
  private readonly done: PackStep[] = []

  /**
   * Do one thing to the pack, or refuse it and say why.
   *
   * Returns whether it ran. It does not throw on a refusal, because a refusal is
   * an ordinary and expected outcome that gets recorded — not a fault in the
   * program.
   */
  run(name: string): PackStep {
    const known = operation(name)

    if (known === undefined) {
      const step: PackStep = {
        operation: name,
        outcome: 'refused',
        why:
          `Charter has no operation called "${name}". The ones it has are: ` +
          `${OPERATIONS.map((one) => one.name).join(', ')}.`,
      }
      this.done.push(step)
      return step
    }

    if (this.sealed && known.rewritesTheFile) {
      const step: PackStep = {
        operation: name,
        outcome: 'refused',
        why:
          `The pack is sealed, and ${name} ${known.does}, which rewrites the file. ` +
          `${known.afterSealing ?? 'That would change what was sealed'}. Charter ` +
          `will not do this after sealing, whatever asks for it.`,
      }
      this.done.push(step)
      return step
    }

    const step: PackStep = { operation: name, outcome: 'ran' }
    this.done.push(step)
    return step
  }

  /** Whether the pack has been closed. */
  get isSealed(): boolean {
    return this.sealed
  }

  /** Everything that has happened so far, in order. */
  get steps(): readonly PackStep[] {
    return [...this.done]
  }

  /**
   * Close the pack and fingerprint exactly what was closed.
   *
   * The fingerprint is taken of the bytes as they are at this moment, and nothing
   * that rewrites the file runs afterwards. That is what makes the fingerprint
   * mean something: a fingerprint of a file that can still be rewritten proves
   * only what the file used to be.
   */
  seal(bytes: Uint8Array): SealedPack {
    if (this.sealed) {
      throw new OutOfOrder(
        'This pack is already sealed. Sealing twice would produce two different ' +
          'fingerprints for one document, and anybody checking the second against ' +
          'the first would be told the document had been tampered with.',
      )
    }
    if (bytes.length === 0) {
      throw new OutOfOrder(
        'There is nothing to seal. An empty pack with a valid fingerprint is worse ' +
          'than no pack at all, because it looks finished.',
      )
    }

    this.sealed = true
    this.done.push({ operation: 'seal', outcome: 'ran' })

    return {
      fingerprint: fingerprintBytes(bytes),
      sizeBytes: String(bytes.length),
      steps: this.steps,
      refusals: this.done.filter((step) => step.outcome === 'refused'),
    }
  }
}

/**
 * Check a plan before running any of it.
 *
 * Catching a bad order before the first operation is better than catching it in
 * the middle, because half an assembled pack is a thing somebody has to clean up.
 */
export function checkOrder(plan: readonly string[]): void {
  let sealed = false

  for (const name of plan) {
    if (name === 'seal') {
      if (sealed) {
        throw new OutOfOrder('The plan seals the pack twice, which cannot be done.')
      }
      sealed = true
      continue
    }

    const known = operation(name)
    if (known === undefined) {
      throw new OutOfOrder(`The plan uses "${name}", which is not an operation Charter has.`)
    }
    if (sealed && known.rewritesTheFile) {
      throw new OutOfOrder(
        `The plan runs "${name}" after sealing. ${known.afterSealing ?? 'It rewrites the file'}.`,
      )
    }
  }

  if (!sealed) {
    throw new OutOfOrder(
      'The plan never seals the pack. An unsealed pack has no fingerprint, so ' +
        'nobody can check afterwards that the document they were shown is the ' +
        'document that was made.',
    )
  }
}
