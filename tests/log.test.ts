import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { openBuiltIn, isRuleViolation, type Database } from '../src/db/driver.js'
import { migrate } from '../src/db/migrate.js'
import {
  append,
  readEvents,
  readHead,
  readPayload,
  verifyRun,
  redact,
  exportRecord,
  fixedClock,
  NothingToRedactError,
  lastEvent,
} from '../src/record/log.js'
import { genesisHash, hashEvent } from '../src/record/chain.js'

let db: Database

/**
 * One database for the whole file, and a fresh run identifier per test.
 *
 * Starting a database per test cost about a second each, which is minutes once
 * there are a few hundred tests — and a slow suite is one people stop running,
 * which costs far more than it saves.
 *
 * Sharing is safe here because runs are independent by construction: each has its
 * own chain, beginning at a value derived from its own identifier. Two tests
 * cannot interfere even in principle.
 *
 * The usual alternative, clearing tables between tests, is not available — DELETE
 * on the record is refused by the database, which is the whole point of it.
 */
let counter = 0
const newRun = (label = 'run') => `${label}-${String(++counter).padStart(4, '0')}`

let RUN: string

beforeAll(async () => {
  db = await openBuiltIn()
  await migrate(db)
})

afterAll(async () => {
  await db.close()
})

const clock = () => fixedClock('2026-08-27T09:00:00.000Z', 1000)

describe('writing to the record', () => {
  it('writes the first entry starting from the run\'s own beginning', async () => {
    RUN = newRun()
    const at = clock()
    const event = await append(
      db,
      { runId: RUN, kind: 'run.started', actor: 'system', stage: null, payload: { state: 'TX' } },
      at,
    )

    expect(event.seq).toBe('1')
    expect(event.prevHash).toBe(genesisHash(RUN))
    expect(event.ts).toBe('2026-08-27T09:00:00.000Z')
    expect(event.hash).toBe(hashEvent(event, event.prevHash))
  })

  it('chains each entry onto the one before it', async () => {
    RUN = newRun()
    const at = clock()
    const a = await append(db, { runId: RUN, kind: 'stage.entered', actor: 'system', stage: 'understand', payload: {} }, at)
    const b = await append(db, { runId: RUN, kind: 'question.asked', actor: 'model', stage: 'understand', payload: { q: 'who owns it?' } }, at)
    const c = await append(db, { runId: RUN, kind: 'answer.received', actor: 'human', stage: 'understand', payload: { a: 'my sister and I' } }, at)

    expect(b.prevHash).toBe(a.hash)
    expect(c.prevHash).toBe(b.hash)
    expect([a.seq, b.seq, c.seq]).toEqual(['1', '2', '3'])
  })

  it('keeps separate runs on separate chains', async () => {
    RUN = newRun()
    const at = clock()
    const runA = newRun('a'); const runB = newRun('b')
    await append(db, { runId: runA, kind: 'run.started', actor: 'system', stage: null, payload: {} }, at)
    await append(db, { runId: runB, kind: 'run.started', actor: 'system', stage: null, payload: {} }, at)

    const a = await readEvents(db, runA)
    const b = await readEvents(db, runB)
    expect(a).toHaveLength(1)
    expect(b).toHaveLength(1)
    expect(a[0]!.prevHash).toBe(genesisHash(runA))
    expect(b[0]!.prevHash).toBe(genesisHash(runB))
    expect(a[0]!.hash).not.toBe(b[0]!.hash)
  })

  it('reads back exactly what was written, so the chain still checks out', async () => {
    RUN = newRun()
    const at = clock()
    for (let i = 0; i < 12; i++) {
      await append(db, { runId: RUN, kind: 'tool.called', actor: 'model', stage: 'research', payload: { i } }, at)
    }
    const result = await verifyRun(db, RUN)
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.count).toBe(12)
  })

  it('reports where the record currently ends', async () => {
    RUN = newRun()
    const at = clock()
    expect(await readHead(db, RUN)).toEqual({ runId: RUN, head: genesisHash(RUN), count: '0' })

    const a = await append(db, { runId: RUN, kind: 'run.started', actor: 'system', stage: null, payload: {} }, at)
    expect(await readHead(db, RUN)).toEqual({ runId: RUN, head: a.hash, count: '1' })
  })

  it('stores the detail separately from the chain', async () => {
    RUN = newRun()
    const at = clock()
    const event = await append(
      db,
      { runId: RUN, kind: 'answer.received', actor: 'human', stage: 'understand', payload: { oven: 'worth 9000' } },
      at,
    )
    expect(await readPayload(db, RUN, event.seq)).toEqual({ oven: 'worth 9000' })
  })
})

describe('the rules the database enforces, not our code', () => {
  // Every one of these bypasses the application entirely and goes straight at the
  // database, which is the only version of this test that means anything.

  it('refuses to change a past entry', async () => {
    RUN = newRun()
    const at = clock()
    await append(db, { runId: RUN, kind: 'run.started', actor: 'system', stage: null, payload: {} }, at)

    await expect(
      db.query("UPDATE events SET kind = 'run.finished' WHERE run_id = $1", [RUN]),
    ).rejects.toSatisfy(isRuleViolation)
  })

  it('refuses to remove an entry', async () => {
    RUN = newRun()
    const at = clock()
    await append(db, { runId: RUN, kind: 'run.started', actor: 'system', stage: null, payload: {} }, at)

    await expect(db.query('DELETE FROM events WHERE run_id = $1', [RUN])).rejects.toSatisfy(
      isRuleViolation,
    )
  })

  it('refuses an entry that does not follow on from the last one', async () => {
    RUN = newRun()
    const at = clock()
    const first = await append(db, { runId: RUN, kind: 'run.started', actor: 'system', stage: null, payload: {} }, at)

    await expect(
      db.query(
        `INSERT INTO events (run_id, seq, ts, kind, actor, stage, payload_hash, prev_hash, hash)
         VALUES ($1, 2, '2026-08-27T10:00:00.000Z', 'forged.entry', 'system', null, $2, $2, $3)`,
        [RUN, 'a'.repeat(64), 'b'.repeat(64)],
      ),
    ).rejects.toSatisfy(isRuleViolation)

    expect(first.seq).toBe('1')
  })

  it('refuses an entry that skips a position', async () => {
    RUN = newRun()
    const at = clock()
    const first = await append(db, { runId: RUN, kind: 'run.started', actor: 'system', stage: null, payload: {} }, at)

    await expect(
      db.query(
        `INSERT INTO events (run_id, seq, ts, kind, actor, stage, payload_hash, prev_hash, hash)
         VALUES ($1, 5, '2026-08-27T10:00:00.000Z', 'skipped.ahead', 'system', null, $2, $3, $4)`,
        [RUN, 'a'.repeat(64), first.hash, 'c'.repeat(64)],
      ),
    ).rejects.toSatisfy(isRuleViolation)
  })

  it('refuses a run that does not start at entry 1', async () => {
    RUN = newRun()
    await expect(
      db.query(
        `INSERT INTO events (run_id, seq, ts, kind, actor, stage, payload_hash, prev_hash, hash)
         VALUES ('run-new-start', 2, '2026-08-27T10:00:00.000Z', 'starts.late', 'system', null, $1, $1, $2)`,
        ['a'.repeat(64), 'd'.repeat(64)],
      ),
    ).rejects.toSatisfy(isRuleViolation)
  })

  it('refuses an actor it does not recognise', async () => {
    RUN = newRun()
    await expect(
      db.query(
        `INSERT INTO events (run_id, seq, ts, kind, actor, stage, payload_hash, prev_hash, hash)
         VALUES ('run-x', 1, '2026-08-27T10:00:00.000Z', 'bad.actor', 'agent', null, $1, $1, $2)`,
        ['a'.repeat(64), 'e'.repeat(64)],
      ),
    ).rejects.toThrow()
  })

  it('refuses a fingerprint that is not the right shape', async () => {
    RUN = newRun()
    await expect(
      db.query(
        `INSERT INTO events (run_id, seq, ts, kind, actor, stage, payload_hash, prev_hash, hash)
         VALUES ('run-y', 1, '2026-08-27T10:00:00.000Z', 'bad.hash', 'system', null, 'nope', $1, $2)`,
        ['a'.repeat(64), 'f'.repeat(64)],
      ),
    ).rejects.toThrow()
  })

  it('refuses two entries sharing a fingerprint', async () => {
    RUN = newRun()
    const at = clock()
    const first = await append(db, { runId: RUN, kind: 'run.started', actor: 'system', stage: null, payload: {} }, at)

    await expect(
      db.query(
        `INSERT INTO events (run_id, seq, ts, kind, actor, stage, payload_hash, prev_hash, hash)
         VALUES ($1, 2, '2026-08-27T10:00:00.000Z', 'copy.of.first', 'system', null, $2, $3, $4)`,
        [RUN, 'a'.repeat(64), first.hash, first.hash],
      ),
    ).rejects.toThrow()
  })
})

describe('forgetting a person\'s details without breaking the record', () => {
  it('clears the detail, keeps the entry, and the chain still holds', async () => {
    RUN = newRun()
    const at = clock()
    await append(db, { runId: RUN, kind: 'run.started', actor: 'system', stage: null, payload: {} }, at)
    const idDoc = await append(
      db,
      {
        runId: RUN,
        kind: 'document.read',
        actor: 'vendor',
        stage: 'verify',
        payload: { name: 'A Person', licence: 'X1234567' },
      },
      at,
    )
    await append(db, { runId: RUN, kind: 'stage.completed', actor: 'system', stage: 'verify', payload: {} }, at)

    expect(await readPayload(db, RUN, idDoc.seq)).not.toBeNull()

    await redact(db, RUN, idDoc.seq, 'the owner asked for their details to be removed', at)

    // The details are gone.
    expect(await readPayload(db, RUN, idDoc.seq)).toBeNull()

    // The entry is still there — you can still see that a document was read.
    const events = await readEvents(db, RUN)
    const stillThere = events.find((e) => e.seq === idDoc.seq)
    expect(stillThere).toBeDefined()
    expect(stillThere!.kind).toBe('document.read')
    expect(stillThere!.payloadHash).toBe(idDoc.payloadHash)

    // And every link still holds.
    const result = await verifyRun(db, RUN)
    expect(result.ok).toBe(true)
  })

  it('records the forgetting as an entry of its own', async () => {
    RUN = newRun()
    const at = clock()
    const first = await append(db, { runId: RUN, kind: 'document.read', actor: 'vendor', stage: 'verify', payload: { x: 1 } }, at)
    await redact(db, RUN, first.seq, 'requested', at)

    const events = await readEvents(db, RUN)
    const redaction = events.find((e) => e.kind === 'payload.redacted')
    expect(redaction).toBeDefined()
    expect(await readPayload(db, RUN, redaction!.seq)).toEqual({
      redactedSeq: '1',
      reason: 'requested',
    })
  })

  it('will not record a forgetting that did not happen', async () => {
    // The defect this prevents: asking to forget an entry that does not exist
    // cleared nothing, and then wrote a permanent entry saying something had been
    // forgotten. A false statement, in the one place in this system that can never
    // be corrected afterwards.
    RUN = newRun()
    const at = clock()
    await append(db, { runId: RUN, kind: 'run.started', actor: 'system', stage: null, payload: { x: 1 } }, at)

    await expect(redact(db, RUN, '999', 'no such entry', at)).rejects.toBeInstanceOf(
      NothingToRedactError,
    )

    // And nothing was written. One entry in, one entry still there.
    const events = await readEvents(db, RUN)
    expect(events).toHaveLength(1)
    expect(events.some((e) => e.kind === 'payload.redacted')).toBe(false)
  })

  it('says plainly why it refused, rather than failing quietly', async () => {
    RUN = newRun()
    await expect(redact(db, RUN, '4', 'reason')).rejects.toThrow(/nothing to forget/)
  })

  it('lets the database answer when a detail was already forgotten', async () => {
    // A second request to forget the same thing is a different situation from a
    // request to forget something that never existed, and the two should not be
    // reported with the same words.
    RUN = newRun()
    const at = clock()
    const first = await append(db, { runId: RUN, kind: 'document.read', actor: 'vendor', stage: 'verify', payload: { secret: 'x' } }, at)
    await redact(db, RUN, first.seq, 'first time', at)

    await expect(redact(db, RUN, first.seq, 'second time', at)).rejects.toThrow(
      /already been cleared/,
    )
  })

  it('refuses to replace a detail with something else', async () => {
    RUN = newRun()
    const at = clock()
    const event = await append(db, { runId: RUN, kind: 'document.read', actor: 'vendor', stage: 'verify', payload: { real: true } }, at)

    await expect(
      db.query('UPDATE event_payloads SET payload = $1 WHERE run_id = $2 AND seq = $3', [
        JSON.stringify({ real: false }),
        RUN,
        event.seq,
      ]),
    ).rejects.toSatisfy(isRuleViolation)
  })

  it('refuses to remove a detail row entirely', async () => {
    RUN = newRun()
    const at = clock()
    const event = await append(db, { runId: RUN, kind: 'document.read', actor: 'vendor', stage: 'verify', payload: { x: 1 } }, at)

    await expect(
      db.query('DELETE FROM event_payloads WHERE run_id = $1 AND seq = $2', [RUN, event.seq]),
    ).rejects.toSatisfy(isRuleViolation)
  })
})

describe('exporting a record so someone else can check it', () => {
  it('produces something self-contained, with no secret in it', async () => {
    RUN = newRun()
    const at = clock()
    for (let i = 0; i < 4; i++) {
      await append(db, { runId: RUN, kind: 'tool.called', actor: 'model', stage: 'research', payload: { i } }, at)
    }

    const exported = await exportRecord(db, RUN)
    expect(exported.v).toBe('1')
    expect(exported.runId).toBe(RUN)
    expect(exported.genesis).toBe(genesisHash(RUN))
    expect(exported.events).toHaveLength(4)

    // Everything a stranger needs is here, and nothing else.
    const asText = JSON.stringify(exported)
    expect(asText).not.toMatch(/password|secret|api[_-]?key/i)
  })
})

describe('migrations', () => {
  it('is safe to run twice', async () => {
    RUN = newRun()
    const again = await migrate(db)
    expect(again.every((m) => m.alreadyDone)).toBe(true)
  })
})

describe('reading the end of a run', () => {
  it('returns nothing for a run that has not started', async () => {
    RUN = newRun()
    expect(await lastEvent(db, newRun('absent'))).toBeUndefined()
  })
})
