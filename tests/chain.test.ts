import { describe, it, expect } from 'vitest'
import {
  sealEvent,
  checkChain,
  genesisHash,
  hashEvent,
  nextPrevHash,
  nextSeq,
  describeCheck,
  assertWellFormed,
  InvalidEventError,
  type ChainedEvent,
  type EventContent,
} from '../src/record/chain.js'
import { fingerprint } from '../src/record/canonical.js'

const RUN = 'run-0001'

/** Build a chain of n well-formed entries, so tests can then try to break it. */
function buildChain(count: number, runId = RUN): ChainedEvent[] {
  const events: ChainedEvent[] = []
  for (let i = 0; i < count; i++) {
    const previous = events[i - 1]
    const content: EventContent = {
      runId,
      seq: nextSeq(previous),
      ts: `2026-08-27T09:${String(i).padStart(2, '0')}:00.000Z`,
      kind: 'tool.called',
      actor: 'system',
      stage: 'understand',
      payloadHash: fingerprint({ step: i }),
    }
    events.push(sealEvent(content, nextPrevHash(runId, previous)))
  }
  return events
}

describe('sealing an entry', () => {
  it('produces the fingerprint anyone else would compute', () => {
    const [event] = buildChain(1)
    expect(event!.hash).toBe(hashEvent(event!, event!.prevHash))
    expect(event!.hash).toMatch(/^[0-9a-f]{64}$/)
  })

  it('starts a run from a beginning derived from the run itself', () => {
    const [event] = buildChain(1)
    expect(event!.prevHash).toBe(genesisHash(RUN))
    // Not a row of zeroes, which anyone could produce.
    expect(event!.prevHash).not.toBe('0'.repeat(64))
  })

  it('gives different runs different beginnings, so entries cannot be moved between them', () => {
    expect(genesisHash('run-a')).not.toBe(genesisHash('run-b'))
  })

  it('is pure — the same input always gives the same output', () => {
    const content: EventContent = {
      runId: RUN,
      seq: '1',
      ts: '2026-08-27T09:00:00.000Z',
      kind: 'run.started',
      actor: 'system',
      stage: null,
      payloadHash: fingerprint({}),
    }
    const a = sealEvent(content, genesisHash(RUN))
    const b = sealEvent(content, genesisHash(RUN))
    expect(a).toEqual(b)
  })
})

describe('what a malformed entry looks like', () => {
  const base: EventContent = {
    runId: RUN,
    seq: '1',
    ts: '2026-08-27T09:00:00.000Z',
    kind: 'tool.called',
    actor: 'system',
    stage: 'understand',
    payloadHash: fingerprint({}),
  }

  it('refuses a position that is not a whole number written as text', () => {
    expect(() => assertWellFormed({ ...base, seq: '0' })).toThrow(InvalidEventError)
    expect(() => assertWellFormed({ ...base, seq: '01' })).toThrow(/counting from/)
    expect(() => assertWellFormed({ ...base, seq: '1.5' })).toThrow(InvalidEventError)
  })

  it('refuses a number where text is required, because a regex would coerce it', () => {
    // /^[1-9]\d*$/.test(1) passes, because the regex turns 1 into "1" first. But
    // {"seq":1} and {"seq":"1"} have different fingerprints, so a record written
    // with a number could never be checked by anyone else. Every string field is
    // type-checked before its pattern is applied.
    expect(() => assertWellFormed({ ...base, seq: 1 as unknown as string })).toThrow(/must be text/)
    expect(() => assertWellFormed({ ...base, runId: 42 as unknown as string })).toThrow(/must be text/)
    expect(() => assertWellFormed({ ...base, kind: null as unknown as string })).toThrow(/must be text/)
    expect(() => assertWellFormed({ ...base, stage: 7 as unknown as string })).toThrow(/must be text/)
    expect(() => assertWellFormed({ ...base, payloadHash: 1 as unknown as string })).toThrow(/must be text/)
  })

  it('refuses a time that is not exactly the agreed shape', () => {
    expect(() => assertWellFormed({ ...base, ts: '2026-08-27T09:00:00Z' })).toThrow(/2026-08-27T09/)
    expect(() => assertWellFormed({ ...base, ts: '2026-08-27 09:00:00.000Z' })).toThrow()
    expect(() => assertWellFormed({ ...base, ts: '2026-08-27T09:00:00.000+05:30' })).toThrow()
  })

  it('refuses a kind that is not lowercase dotted words', () => {
    expect(() => assertWellFormed({ ...base, kind: 'ToolCalled' })).toThrow(/lowercase dotted/)
    expect(() => assertWellFormed({ ...base, kind: 'tool' })).toThrow(/lowercase dotted/)
    expect(() => assertWellFormed({ ...base, kind: 'tool_called' })).toThrow()
  })

  it('refuses an actor outside the four we allow', () => {
    expect(() => assertWellFormed({ ...base, actor: 'agent' as never })).toThrow(/actor must be one of/)
  })

  it('accepts a null stage, for things that happen outside any stage', () => {
    expect(() => assertWellFormed({ ...base, stage: null })).not.toThrow()
  })

  it('refuses a payload fingerprint of the wrong shape', () => {
    expect(() => assertWellFormed({ ...base, payloadHash: 'nope' })).toThrow(/64 lowercase hex/)
    expect(() => assertWellFormed({ ...base, payloadHash: 'A'.repeat(64) })).toThrow()
  })
})

describe('checking a chain that is intact', () => {
  it('passes an empty record', () => {
    const result = checkChain([], RUN)
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.count).toBe(0)
      expect(result.head).toBe(genesisHash(RUN))
    }
  })

  it('passes a long chain and reports its head', () => {
    const events = buildChain(50)
    const result = checkChain(events, RUN)
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.count).toBe(50)
      expect(result.head).toBe(events[49]!.hash)
    }
  })
})

describe('what the chain catches', () => {
  it('catches a changed entry, and names exactly which one', () => {
    const events = buildChain(5)
    // Someone edits entry 3 after the fact — the classic tampering case.
    const tampered = [...events]
    tampered[2] = { ...events[2]!, kind: 'tool.succeeded' }

    const result = checkChain(tampered, RUN)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.firstBreak.seq).toBe('3')
      expect(result.firstBreak.reason).toBe('fingerprint-mismatch')
      expect(result.firstBreak.detail).toMatch(/changed since it was written/)
    }
  })

  it('catches a changed payload fingerprint', () => {
    const events = buildChain(4)
    const tampered = [...events]
    tampered[1] = { ...events[1]!, payloadHash: fingerprint({ different: true }) }

    const result = checkChain(tampered, RUN)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.firstBreak.seq).toBe('2')
  })

  it('catches an entry removed from the middle', () => {
    const events = buildChain(5)
    const withGap = [events[0]!, events[1]!, events[3]!, events[4]!]

    const result = checkChain(withGap, RUN)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.firstBreak.reason).toBe('out-of-order')
      expect(result.firstBreak.expected).toBe('3')
      expect(result.firstBreak.found).toBe('4')
    }
  })

  it('catches reordered entries', () => {
    const events = buildChain(4)
    const swapped = [events[0]!, events[2]!, events[1]!, events[3]!]
    expect(checkChain(swapped, RUN).ok).toBe(false)
  })

  it('catches a duplicated entry', () => {
    const events = buildChain(3)
    const doubled = [events[0]!, events[1]!, events[1]!, events[2]!]
    expect(checkChain(doubled, RUN).ok).toBe(false)
  })

  it('catches entries spliced in from a different run', () => {
    const ours = buildChain(3, RUN)
    const theirs = buildChain(3, 'run-other')
    const mixed = [ours[0]!, ours[1]!, theirs[2]!]

    const result = checkChain(mixed, RUN)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.firstBreak.reason).toBe('wrong-run')
  })

  it('catches a chain that does not start at the beginning', () => {
    const events = buildChain(4)
    const beheaded = events.slice(1).map((e, i) => ({ ...e, seq: String(i + 1) }))

    const result = checkChain(beheaded, RUN)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.firstBreak.reason).toBe('broken-link')
  })

  it('catches a forged entry, even one whose own fingerprint is computed correctly', () => {
    // The hard case: someone rewrites an entry AND recomputes its fingerprint so it
    // is internally consistent. The link to the entry before it still fails.
    const events = buildChain(4)
    const forgedContent: EventContent = { ...events[2]!, kind: 'approval.granted', actor: 'human' }
    const forged = { ...forgedContent, prevHash: events[2]!.prevHash, hash: hashEvent(forgedContent, events[2]!.prevHash) }
    const tampered = [events[0]!, events[1]!, forged, events[3]!]

    const result = checkChain(tampered, RUN)
    expect(result.ok).toBe(false)
    // Entry 3 is now self-consistent, so it passes. Entry 4 no longer follows it.
    if (!result.ok) {
      expect(result.firstBreak.seq).toBe('4')
      expect(result.firstBreak.reason).toBe('broken-link')
    }
  })

  it('reports only the first break, not every consequence of it', () => {
    const events = buildChain(10)
    const tampered = [...events]
    tampered[1] = { ...events[1]!, kind: 'tool.failed' }

    const result = checkChain(tampered, RUN)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.firstBreak.seq).toBe('2')
  })
})

describe('what the chain honestly cannot catch', () => {
  it('does NOT catch entries removed from the end, and we say so', () => {
    // This is the one real limitation, and hiding it would be worse than useless.
    // A shortened chain is a perfectly valid chain. Only a signature over the head,
    // taken at the time, can prove what the end used to be.
    const events = buildChain(10)
    const truncated = events.slice(0, 6)

    const result = checkChain(truncated, RUN)
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.count).toBe(6)
      // But the head is different, which is exactly what the signature pins down.
      expect(result.head).not.toBe(events[9]!.hash)
      expect(result.head).toBe(events[5]!.hash)
    }
  })
})

describe('explaining a result to a person', () => {
  it('says plainly when the record holds', () => {
    expect(describeCheck(checkChain(buildChain(3), RUN))).toMatch(/holds together.*3 entries/s)
  })

  it('says which entry failed, and admits what it cannot prove', () => {
    const events = buildChain(5)
    const tampered = [...events]
    tampered[3] = { ...events[3]!, actor: 'human' }

    const text = describeCheck(checkChain(tampered, RUN))
    expect(text).toMatch(/does not hold together/)
    expect(text).toMatch(/Entry 4 is the first one that fails/)
    expect(text).toMatch(/removed from the END/)
  })
})
