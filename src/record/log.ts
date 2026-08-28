/**
 * The event log — writing to the record, and reading it back.
 *
 * This is the only way anything is ever written to the record. Everything else in
 * Charter goes through `append`, which is what makes the record complete rather
 * than merely mostly complete.
 *
 * WHAT HAPPENS ON EVERY APPEND
 *
 *   1. Read where this run's chain currently ends.
 *   2. Fingerprint the detail.
 *   3. Seal a new entry onto the end, in our own code, using the canonical text
 *      form so that anyone else can reproduce the fingerprint.
 *   4. Write the entry and its detail, in one transaction.
 *
 * The database independently refuses anything that does not follow on, so a bug in
 * step 3 becomes a loud failure rather than a quietly forked chain. Two mechanisms
 * that must agree, because one alone would just be a hope.
 *
 * THE CLOCK IS PASSED IN
 *
 * Nothing here calls the clock itself. Time arrives as an argument, which makes
 * every test able to produce byte-identical records, and makes it impossible for a
 * machine's local time settings to leak into something that gets fingerprinted.
 */

import { fingerprint, type JsonObject } from './canonical.js'
import {
  sealEvent,
  checkChain,
  genesisHash,
  nextPrevHash,
  nextSeq,
  type Actor,
  type ChainedEvent,
  type ChainCheck,
} from './chain.js'
import type { Database } from '../db/driver.js'

/** Reads the current time. Passed in so that tests are exact and repeatable. */
export type Clock = () => Date

export const systemClock: Clock = () => new Date()

/** A clock that returns a fixed series of times. For tests. */
export function fixedClock(start = '2026-08-27T09:00:00.000Z', stepMs = 1000): Clock {
  let t = Date.parse(start)
  return () => {
    const now = new Date(t)
    t += stepMs
    return now
  }
}

export interface NewEvent {
  readonly runId: string
  readonly kind: string
  readonly actor: Actor
  readonly stage: string | null
  /** The detail. Fingerprinted into the chain; stored where it can be forgotten. */
  readonly payload: JsonObject
}

interface EventRow {
  run_id: string
  seq: string | number
  ts: string
  kind: string
  actor: string
  stage: string | null
  payload_hash: string
  prev_hash: string
  hash: string
}

/**
 * Turn a database row into an entry.
 *
 * `seq` comes back from a BIGINT column, which some drivers hand over as text and
 * others as a number. It is converted to text here, once, because the fingerprint
 * was taken over text and a number would produce a different one — the same
 * mistake that has already been caught twice in this project.
 */
function toEvent(row: EventRow): ChainedEvent {
  return {
    runId: row.run_id,
    seq: String(row.seq),
    ts: row.ts,
    kind: row.kind,
    actor: row.actor as Actor,
    stage: row.stage,
    payloadHash: row.payload_hash,
    prevHash: row.prev_hash,
    hash: row.hash,
  }
}

/** How the moment is written wherever it is fingerprinted. */
export function isoNow(clock: Clock): string {
  return clock().toISOString()
}

/** The last entry of a run, or nothing if the run has none yet. */
export async function lastEvent(db: Database, runId: string): Promise<ChainedEvent | undefined> {
  const result = await db.query<EventRow>(
    'SELECT * FROM events WHERE run_id = $1 ORDER BY seq DESC LIMIT 1',
    [runId],
  )
  const row = result.rows[0]
  return row ? toEvent(row) : undefined
}

/** Add one entry to the end of a run's record. The only way anything is written. */
export async function append(
  db: Database,
  event: NewEvent,
  clock: Clock = systemClock,
): Promise<ChainedEvent> {
  const payloadHash = fingerprint(event.payload)
  const ts = isoNow(clock)

  return db.transaction(async (tx) => {
    const previous = await lastEvent(tx, event.runId)
    const sealed = sealEvent(
      {
        runId: event.runId,
        seq: nextSeq(previous),
        ts,
        kind: event.kind,
        actor: event.actor,
        stage: event.stage,
        payloadHash,
      },
      nextPrevHash(event.runId, previous),
    )

    await tx.query(
      `INSERT INTO events (run_id, seq, ts, kind, actor, stage, payload_hash, prev_hash, hash)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        sealed.runId,
        sealed.seq,
        sealed.ts,
        sealed.kind,
        sealed.actor,
        sealed.stage,
        sealed.payloadHash,
        sealed.prevHash,
        sealed.hash,
      ],
    )
    await tx.query(
      'INSERT INTO event_payloads (run_id, seq, payload) VALUES ($1, $2, $3)',
      [sealed.runId, sealed.seq, JSON.stringify(event.payload)],
    )

    return sealed
  })
}

/** Every entry of a run, in order. */
export async function readEvents(db: Database, runId: string): Promise<ChainedEvent[]> {
  const result = await db.query<EventRow>(
    'SELECT * FROM events WHERE run_id = $1 ORDER BY seq ASC',
    [runId],
  )
  return result.rows.map(toEvent)
}

/** The detail of one entry, or null if it has been forgotten. */
export async function readPayload(
  db: Database,
  runId: string,
  seq: string,
): Promise<JsonObject | null> {
  const result = await db.query<{ payload: JsonObject | null }>(
    'SELECT payload FROM event_payloads WHERE run_id = $1 AND seq = $2',
    [runId, seq],
  )
  return result.rows[0]?.payload ?? null
}

export interface Head {
  readonly runId: string
  readonly head: string
  /** How many entries, written as text like everything else that counts. */
  readonly count: string
}

/** Where a run's record currently ends — the thing an attestation vouches for. */
export async function readHead(db: Database, runId: string): Promise<Head> {
  const result = await db.query<{ count: string; head: string | null }>(
    `SELECT count(*)::text AS count,
            (SELECT hash FROM events WHERE run_id = $1 ORDER BY seq DESC LIMIT 1) AS head
     FROM events WHERE run_id = $1`,
    [runId],
  )
  const row = result.rows[0]
  return {
    runId,
    head: row?.head ?? genesisHash(runId),
    count: row?.count ?? '0',
  }
}

/** Walk a run's record and report the first place it does not hold. */
export async function verifyRun(db: Database, runId: string): Promise<ChainCheck> {
  return checkChain(await readEvents(db, runId), runId)
}

/** Asked to forget something that is not there. */
export class NothingToRedactError extends Error {
  constructor(
    readonly runId: string,
    readonly seq: string,
  ) {
    super(
      `run "${runId}" has no entry ${seq}, so there is nothing to forget. ` +
        `No entry was written: the record must never say a thing was done that was not done.`,
    )
    this.name = 'NothingToRedactError'
  }
}

/**
 * Forget the detail of one entry, without breaking the record.
 *
 * The detail is cleared. Its fingerprint stays in the chain, so every link still
 * holds and the entry itself is still there — you can still see that something
 * happened, when, and who caused it. Only the contents are gone.
 *
 * The clearing is itself recorded as a new entry, because a record that could be
 * quietly emptied would not be a record. So the honest summary is: Charter can
 * forget what a document said, and cannot forget that it read one.
 *
 * WHY THE CLEARING IS PROVED BEFORE IT IS RECORDED
 *
 * The clearing is confirmed by asking the database which row it actually changed,
 * and nothing is written to the record unless a row really was cleared. Without
 * that check, asking to forget an entry that does not exist wrote a permanent
 * entry saying a thing had been forgotten when nothing had — a false statement,
 * in the one place in this system that can never be corrected afterwards.
 *
 * The order matters too, and it is deliberate. The payload is cleared first and
 * recorded second, so the worse of the two possible failures cannot happen. If
 * the recording fails, something has been forgotten without a note of it: the
 * record is incomplete. The reverse order would leave the record claiming a
 * deletion that never took place. An incomplete record is a much smaller wrong
 * than a false one.
 */
export async function redact(
  db: Database,
  runId: string,
  seq: string,
  reason: string,
  clock: Clock = systemClock,
): Promise<ChainedEvent> {
  // No `payload IS NOT NULL` condition here on purpose. A payload that has already
  // been cleared should reach the database rule, which says so in its own words,
  // rather than being reported here as if the entry did not exist.
  const cleared = await db.query<{ seq: string }>(
    'UPDATE event_payloads SET payload = NULL WHERE run_id = $1 AND seq = $2 RETURNING seq',
    [runId, seq],
  )
  if (cleared.rows.length === 0) {
    throw new NothingToRedactError(runId, seq)
  }

  return append(
    db,
    {
      runId,
      kind: 'payload.redacted',
      actor: 'human',
      stage: null,
      payload: { redactedSeq: seq, reason },
    },
    clock,
  )
}

/**
 * Everything needed to check a run from outside, in one object.
 *
 * This is what gets written next to a finished packet as audit-log.jsonl, and what
 * `npx charter-verify` reads. It contains no secret and depends on nothing of ours
 * being online.
 */
export interface ExportedRecord {
  readonly v: '1'
  readonly runId: string
  readonly genesis: string
  readonly events: ChainedEvent[]
}

export async function exportRecord(db: Database, runId: string): Promise<ExportedRecord> {
  return {
    v: '1',
    runId,
    genesis: genesisHash(runId),
    events: await readEvents(db, runId),
  }
}
