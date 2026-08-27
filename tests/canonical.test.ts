import { describe, it, expect } from 'vitest'
import { createHash } from 'node:crypto'
import {
  canonicalText,
  fingerprint,
  fingerprintBytes,
  assertHashable,
  isFingerprint,
  NotHashableError,
} from '../src/record/canonical.js'

describe('canonical text', () => {
  it('writes the same text no matter what order the keys were given in', () => {
    const a = { alpha: 1, beta: 2, gamma: 3 }
    const b = { gamma: 3, alpha: 1, beta: 2 }
    expect(canonicalText(a)).toBe(canonicalText(b))
    expect(canonicalText(a)).toBe('{"alpha":1,"beta":2,"gamma":3}')
  })

  it('sorts nested keys too, at every depth', () => {
    const value = { z: { y: { x: 1, a: 2 }, b: 3 }, a: 4 }
    expect(canonicalText(value)).toBe('{"a":4,"z":{"b":3,"y":{"a":2,"x":1}}}')
  })

  it('keeps array order, because order is part of the data', () => {
    expect(canonicalText([3, 1, 2])).toBe('[3,1,2]')
    expect(canonicalText([1, 2, 3])).not.toBe(canonicalText([3, 1, 2]))
  })

  it('removes all whitespace', () => {
    expect(canonicalText({ a: [1, 2], b: 'x' })).toBe('{"a":[1,2],"b":"x"}')
  })

  it('sorts keys by their unicode code points, as the standard requires', () => {
    // Not alphabetically, and not by the machine's local language settings.
    const value = { b: 1, A: 2, a: 3, B: 4 }
    expect(canonicalText(value)).toBe('{"A":2,"B":4,"a":3,"b":1}')
  })

  it('handles text outside the plain English alphabet without corrupting it', () => {
    const value = { 'näme': 'Ünïcøde', 'emoji': '🔒', '日本': 'かな' }
    const text = canonicalText(value)
    expect(JSON.parse(text)).toEqual(value)
    expect(canonicalText(JSON.parse(text))).toBe(text)
  })

  it('escapes control characters the one agreed way', () => {
    expect(canonicalText({ a: '\n\t"\\' })).toBe('{"a":"\\n\\t\\"\\\\"}')
  })

  it('writes numbers one agreed way', () => {
    expect(canonicalText({ a: 1.0 })).toBe('{"a":1}')
    expect(canonicalText({ a: 0.5 })).toBe('{"a":0.5}')
    expect(canonicalText({ a: -0 })).toBe('{"a":0}')
  })

  it('refuses very large whole numbers even when they were written exactly', () => {
    // 1e21 is held exactly. But so is the result of parsing
    // 1000000000000000000001, which lost its final digit on the way in. The two
    // are indistinguishable once parsed, so neither is allowed into the record.
    expect(JSON.parse('{"a":1000000000000000000001}').a).toBe(1e21)
    expect(() => canonicalText({ a: 1e21 })).toThrow(/too large/)
  })
})

describe('what is refused, and why', () => {
  it('refuses whole numbers too large to hold exactly', () => {
    // This is the dangerous one. JSON.parse already lost digits before we saw it.
    const parsed = JSON.parse('{"id":12345678901234567890}') as { id: number }
    // Compared as text, because writing the number as a literal here would lose
    // exactly the same digits and the comparison would prove nothing.
    expect(String(parsed.id)).not.toBe('12345678901234567890')
    expect(String(parsed.id)).toBe('12345678901234567000')

    expect(() => canonicalText(parsed)).toThrow(NotHashableError)
    expect(() => canonicalText(parsed)).toThrow(/too large/)
  })

  it('accepts the largest whole number that is still exact', () => {
    expect(() => canonicalText({ n: Number.MAX_SAFE_INTEGER })).not.toThrow()
    expect(() => canonicalText({ n: Number.MAX_SAFE_INTEGER + 2 })).toThrow(NotHashableError)
  })

  it('accepts ordinary small numbers, so confidence scores still work', () => {
    expect(() => canonicalText({ confidence: 0.87, pages: 3, offset: -12 })).not.toThrow()
  })

  it('refuses not-a-number and infinity', () => {
    expect(() => canonicalText({ a: NaN })).toThrow(/no JSON form/)
    expect(() => canonicalText({ a: Infinity })).toThrow(/no JSON form/)
  })

  it('refuses undefined, because it would silently vanish', () => {
    expect(() => canonicalText({ a: undefined })).toThrow(/silently vanish/)
  })

  it('refuses a Date, because how it is written depends on the machine', () => {
    expect(() => canonicalText({ at: new Date() })).toThrow(/depends on the machine/)
  })

  it('refuses things that are not plain objects', () => {
    class Member {
      constructor(readonly name: string) {}
    }
    expect(() => canonicalText({ m: new Member('x') })).toThrow(/only plain objects/)
    expect(() => canonicalText({ m: new Map() })).toThrow(/only plain objects/)
    expect(() => canonicalText({ m: new Set() })).toThrow(/only plain objects/)
  })

  it('refuses bigints, functions and symbols', () => {
    expect(() => canonicalText({ a: 1n })).toThrow(/bigint/)
    expect(() => canonicalText({ a: () => 1 })).toThrow(/function/)
    expect(() => canonicalText({ a: Symbol('x') })).toThrow(/symbol/)
  })

  it('says exactly where the problem is, so it can be found', () => {
    try {
      canonicalText({ run: { members: [{ ok: 1 }, { share: undefined }] } })
      expect.unreachable('should have refused')
    } catch (error) {
      expect(error).toBeInstanceOf(NotHashableError)
      expect((error as NotHashableError).path).toBe('run.members[1].share')
    }
  })

  it('allows null, which is a real value', () => {
    expect(canonicalText({ a: null })).toBe('{"a":null}')
  })

  it('narrows an unknown value to something safe to fingerprint', () => {
    const value: unknown = { a: 1 }
    assertHashable(value)
    // After the assertion the value is a JsonValue, so it can be canonicalised
    // without any further checking or casting. That is the whole point of it.
    expect(canonicalText(value)).toBe('{"a":1}')
  })
})

describe('fingerprints', () => {
  it('is plain SHA-256 of the canonical text, so anyone can reproduce it', () => {
    const value = { alpha: 1, beta: 'two' }
    const byHand = createHash('sha256').update('{"alpha":1,"beta":"two"}', 'utf8').digest('hex')
    expect(fingerprint(value)).toBe(byHand)
  })

  it('does not change when the key order changes', () => {
    expect(fingerprint({ a: 1, b: 2 })).toBe(fingerprint({ b: 2, a: 1 }))
  })

  it('changes when any single character changes', () => {
    expect(fingerprint({ a: 'x' })).not.toBe(fingerprint({ a: 'y' }))
    expect(fingerprint({ a: 1 })).not.toBe(fingerprint({ a: '1' }))
  })

  it('is always 64 lowercase hex characters', () => {
    for (const value of [{}, [], null, 'x', 0, { deep: { deeper: [1, 2, 3] } }]) {
      expect(fingerprint(value)).toMatch(/^[0-9a-f]{64}$/)
    }
  })

  it('fingerprints raw bytes for files', () => {
    // The published SHA-256 of the three letters "abc".
    expect(fingerprintBytes(new TextEncoder().encode('abc'))).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    )
  })

  it('recognises a well-formed fingerprint and rejects a malformed one', () => {
    expect(isFingerprint(fingerprint({}))).toBe(true)
    expect(isFingerprint('ABC')).toBe(false)
    expect(isFingerprint('g'.repeat(64))).toBe(false)
    expect(isFingerprint('a'.repeat(63))).toBe(false)
    expect(isFingerprint(null)).toBe(false)
  })
})
