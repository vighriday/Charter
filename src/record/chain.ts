/**
 * The chained record.
 *
 * WHAT THIS IS
 *
 * Everything Charter does becomes an entry in a list: a question asked, a tool
 * chosen, a document read, a person approving something, a refusal. Entries are
 * only ever added — never changed, never removed.
 *
 * Each entry carries the fingerprint of the entry before it. So the entries form a
 * chain, and altering anything in the middle breaks every link after it. Anybody
 * can walk the chain and find the exact entry that changed, without asking us
 * anything and without trusting us.
 *
 * WHAT THIS PROVES, AND WHAT IT DOES NOT
 *
 * We say the record is APPEND-ONLY and TAMPER-EVIDENT. We never say immutable or
 * tamper-proof, because those would be claims this code cannot back.
 *
 *   Detected — changing any entry. Every link after it stops matching.
 *   Detected — removing an entry from the middle. The link across the gap breaks.
 *   Detected — reordering entries. The links no longer line up.
 *   Detected — moving entries from one run into another. The starting fingerprint
 *              is derived from the run, so entries from a different run do not fit.
 *
 *   NOT detected by the chain alone — removing entries from the END. A shortened
 *              chain is still a perfectly valid chain. Nothing inside the list can
 *              tell you that something used to follow it.
 *
 * That last one is why the head of the chain is signed separately, and why a
 * trusted timestamp is taken over it. The attestation says "this was the end of the
 * record at this moment", which is the part the chain cannot say about itself.
 * `attestation.ts` does that. We state the limitation rather than hiding it,
 * because a verifier that appeared to prove more than it does would be worse than
 * useless.
 */

import { fingerprint, isFingerprint, isText, describeType, type JsonObject } from './canonical.js'

/** Who caused an entry to exist. */
export const ACTORS = ['system', 'model', 'human', 'vendor'] as const
export type Actor = (typeof ACTORS)[number]

/**
 * What an entry records, before it is sealed into the chain.
 *
 * `seq` is a string rather than a number on purpose, and so is `ts`. Anything that
 * identifies, times or counts money goes in as text — see the long explanation in
 * canonical.ts. This is the rule's first real use.
 */
export interface EventContent {
  /** Which formation run this belongs to. */
  readonly runId: string
  /** Position in this run's chain, counting from "1". A decimal string. */
  readonly seq: string
  /** When it happened, as ISO 8601 with milliseconds and a Z. Text, never a Date. */
  readonly ts: string
  /** What happened, in dotted form: `tool.called`, `refusal.recorded`, `run.started`. */
  readonly kind: string
  /** Who caused it. */
  readonly actor: Actor
  /** Which of the eight stages was active, or null outside any stage. */
  readonly stage: string | null
  /**
   * The fingerprint of the entry's detail.
   *
   * The detail itself lives in a separate place. Only its fingerprint is chained.
   * That is what allows a person's details to be deleted later — the detail goes,
   * the fingerprint stays, and every link still holds. A record that could not
   * forget anything would be unusable for a product that handles identity
   * documents.
   */
  readonly payloadHash: string
}

/** An entry once it has been sealed into the chain. */
export interface ChainedEvent extends EventContent {
  /** The fingerprint of the entry before this one. */
  readonly prevHash: string
  /** This entry's own fingerprint. */
  readonly hash: string
}

/**
 * Where a run's chain begins.
 *
 * Derived from the run rather than being a row of zeroes. Two reasons. A row of
 * zeroes is a value anyone can produce, so a chain could be started anywhere. And
 * deriving it from the run means entries belonging to one run cannot be spliced
 * into another — they simply do not fit.
 */
export function genesisHash(runId: string): string {
  return fingerprint({ charter: 'chain-genesis', v: '1', runId })
}

/**
 * What gets fingerprinted for an entry.
 *
 * Written out by hand rather than by copying the object, so that adding a field to
 * `ChainedEvent` cannot silently change what gets fingerprinted. If this list
 * needs to change, the version marker changes with it, and old records stay
 * checkable by the version they were written under.
 */
function headerToHash(content: EventContent, prevHash: string): JsonObject {
  return {
    v: '1',
    runId: content.runId,
    seq: content.seq,
    ts: content.ts,
    kind: content.kind,
    actor: content.actor,
    stage: content.stage,
    payloadHash: content.payloadHash,
    prevHash,
  }
}

/** The fingerprint an entry should carry, given what comes before it. */
export function hashEvent(content: EventContent, prevHash: string): string {
  return fingerprint(headerToHash(content, prevHash))
}

const ISO_8601 = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/
const SEQ = /^[1-9]\d*$/
const KIND = /^[a-z][a-z0-9]*(\.[a-z][a-z0-9]*)+$/

/**
 * Refuse anything that is not genuinely text.
 *
 * The reason a regular expression cannot be trusted to do this is explained in
 * full at `isText` in canonical.ts. Short version: regular expressions coerce, and
 * coercion is what lets a number through a field that must hold text.
 */
function mustBeText(value: unknown, field: string): asserts value is string {
  if (!isText(value)) {
    throw new InvalidEventError(
      `${field} must be text, but it is ${describeType(value)} (${JSON.stringify(value)}). ` +
        `Identifiers, times and amounts are always text in the record.`,
    )
  }
}

/** Thrown when an entry is malformed. Always a bug in our own code. */
export class InvalidEventError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'InvalidEventError'
  }
}

/**
 * Check an entry is well formed before it can ever reach the chain.
 *
 * Strict on purpose. A record is only worth having if everything in it follows the
 * same rules, and the cheapest moment to enforce that is before it is written.
 */
export function assertWellFormed(content: EventContent): void {
  // Every one of these fields must be an actual string, and the type check is not
  // decoration.
  //
  // A regular expression coerces whatever it is given into text before matching.
  // So /^[1-9]\d*$/.test(1) tests the text "1" and passes — letting the NUMBER 1
  // through a field that must hold the TEXT "1". The two are not interchangeable
  // here: they canonicalise to {"seq":1} and {"seq":"1"}, which have different
  // fingerprints. A record written with a numeric position would produce a
  // fingerprint that no independent checker could reproduce, and nothing would
  // look wrong until someone tried.
  //
  // This is the exact mistake the whole write-identifiers-as-text rule exists to
  // prevent, and this validator had it. Hence the explicit check, first, always.
  mustBeText(content.runId, 'runId')
  mustBeText(content.seq, 'seq')
  mustBeText(content.ts, 'ts')
  mustBeText(content.kind, 'kind')
  mustBeText(content.actor, 'actor')
  mustBeText(content.payloadHash, 'payloadHash')
  if (content.stage !== null) mustBeText(content.stage, 'stage')

  if (!content.runId || content.runId.length > 128) {
    throw new InvalidEventError('runId must be present and at most 128 characters')
  }
  if (!SEQ.test(content.seq)) {
    throw new InvalidEventError(
      `seq must be a whole number written as text, counting from "1" — got ${JSON.stringify(content.seq)}`,
    )
  }
  if (!ISO_8601.test(content.ts)) {
    throw new InvalidEventError(
      `ts must look like 2026-08-27T09:15:00.000Z — got ${JSON.stringify(content.ts)}`,
    )
  }
  if (!KIND.test(content.kind)) {
    throw new InvalidEventError(
      `kind must be lowercase dotted words, such as "tool.called" — got ${JSON.stringify(content.kind)}`,
    )
  }
  if (!(ACTORS as readonly string[]).includes(content.actor)) {
    throw new InvalidEventError(`actor must be one of ${ACTORS.join(', ')} — got ${content.actor}`)
  }
  if (content.stage !== null && !/^[a-z][a-z0-9-]*$/.test(content.stage)) {
    throw new InvalidEventError(
      `stage must be lowercase with hyphens, or null — got ${JSON.stringify(content.stage)}`,
    )
  }
  if (!isFingerprint(content.payloadHash)) {
    throw new InvalidEventError('payloadHash must be 64 lowercase hex characters')
  }
}

/** Seal an entry onto the end of a chain. Pure: no clock, no database, no surprises. */
export function sealEvent(content: EventContent, prevHash: string): ChainedEvent {
  assertWellFormed(content)
  if (!isFingerprint(prevHash)) {
    throw new InvalidEventError('prevHash must be 64 lowercase hex characters')
  }
  return { ...content, prevHash, hash: hashEvent(content, prevHash) }
}

/** What the previous fingerprint should be, for the next entry in a run. */
export function nextPrevHash(runId: string, previous: ChainedEvent | undefined): string {
  return previous ? previous.hash : genesisHash(runId)
}

/** What the next position should be. */
export function nextSeq(previous: ChainedEvent | undefined): string {
  return previous ? String(Number(previous.seq) + 1) : '1'
}

export type BreakReason =
  | 'wrong-run'
  | 'out-of-order'
  | 'broken-link'
  | 'fingerprint-mismatch'
  | 'malformed'

export interface ChainBreak {
  /** Which entry is the first one that does not hold up. */
  readonly seq: string
  readonly reason: BreakReason
  /** Plain words a person can act on. */
  readonly detail: string
  readonly expected?: string
  readonly found?: string
}

export type ChainCheck =
  | { readonly ok: true; readonly count: number; readonly head: string; readonly runId: string }
  | { readonly ok: false; readonly count: number; readonly firstBreak: ChainBreak }

/**
 * Walk a run's entries and report the FIRST place the chain does not hold.
 *
 * Only the first, deliberately. Once a link is broken every entry after it fails
 * too, and a list of forty failures hides the one that matters. The first break is
 * the answer.
 */
export function checkChain(events: readonly ChainedEvent[], runId: string): ChainCheck {
  if (events.length === 0) {
    return { ok: true, count: 0, head: genesisHash(runId), runId }
  }

  let expectedPrev = genesisHash(runId)
  let expectedSeq = 1

  for (const event of events) {
    const at = event.seq || '(missing)'

    if (event.runId !== runId) {
      return {
        ok: false,
        count: events.length,
        firstBreak: {
          seq: at,
          reason: 'wrong-run',
          detail: 'this entry belongs to a different run',
          expected: runId,
          found: event.runId,
        },
      }
    }

    try {
      assertWellFormed(event)
    } catch (error) {
      return {
        ok: false,
        count: events.length,
        firstBreak: {
          seq: at,
          reason: 'malformed',
          detail: error instanceof Error ? error.message : 'this entry is malformed',
        },
      }
    }

    if (event.seq !== String(expectedSeq)) {
      return {
        ok: false,
        count: events.length,
        firstBreak: {
          seq: at,
          reason: 'out-of-order',
          detail: 'entries are missing, duplicated, or out of order at this point',
          expected: String(expectedSeq),
          found: event.seq,
        },
      }
    }

    if (event.prevHash !== expectedPrev) {
      return {
        ok: false,
        count: events.length,
        firstBreak: {
          seq: at,
          reason: 'broken-link',
          detail:
            expectedSeq === 1
              ? 'the first entry does not start from this run\'s beginning'
              : 'this entry does not follow on from the one before it',
          expected: expectedPrev,
          found: event.prevHash,
        },
      }
    }

    const shouldBe = hashEvent(event, event.prevHash)
    if (event.hash !== shouldBe) {
      return {
        ok: false,
        count: events.length,
        firstBreak: {
          seq: at,
          reason: 'fingerprint-mismatch',
          detail: 'this entry has been changed since it was written',
          expected: shouldBe,
          found: event.hash,
        },
      }
    }

    expectedPrev = event.hash
    expectedSeq += 1
  }

  return { ok: true, count: events.length, head: expectedPrev, runId }
}

/** Plain-words summary of a check, for people rather than for programs. */
export function describeCheck(result: ChainCheck): string {
  if (result.ok) {
    return result.count === 0
      ? 'The record is empty. Nothing has been written for this run yet.'
      : `The record holds together. ${result.count} ${
          result.count === 1 ? 'entry' : 'entries'
        }, unbroken from the first to the last.`
  }
  const b = result.firstBreak
  const lines = [
    `The record does not hold together.`,
    `Entry ${b.seq} is the first one that fails: ${b.detail}.`,
  ]
  if (b.expected !== undefined && b.found !== undefined) {
    lines.push(`  expected: ${b.expected}`)
    lines.push(`  found:    ${b.found}`)
  }
  lines.push(
    ``,
    `Note: this check proves nothing was changed, removed from the middle, or`,
    `reordered. It cannot tell you whether entries were removed from the END —`,
    `a shortened chain is still a valid chain. That is what the attestation over`,
    `the head of the record is for.`,
  )
  return lines.join('\n')
}
