import { describe, it, expect, beforeAll } from 'vitest'
import { createPublicKey, generateKeyPairSync } from 'node:crypto'
import {
  attest,
  verifyAttestation,
  generateKeyPair,
  keyIdOf,
  describeAttestation,
  AttestationError,
  type RecordHead,
} from '../src/record/attestation.js'
import { fingerprint } from '../src/record/canonical.js'

let keys: ReturnType<typeof generateKeyPair>
let other: ReturnType<typeof generateKeyPair>

beforeAll(() => {
  keys = generateKeyPair()
  other = generateKeyPair()
})

const head = (over: Partial<RecordHead> = {}): RecordHead => ({
  runId: 'run-0001',
  head: fingerprint({ last: 'entry' }),
  count: '12',
  attestedAt: '2026-08-27T09:15:00.000Z',
  ...over,
})

describe('making a keypair', () => {
  it('makes an Ed25519 pair with a stable name', () => {
    expect(keys.publicKeyPem).toMatch(/^-----BEGIN PUBLIC KEY-----/)
    expect(keys.privateKeyPem).toMatch(/^-----BEGIN PRIVATE KEY-----/)
    expect(keys.keyId).toMatch(/^[0-9a-f]{64}$/)
  })

  it('gives the same name for the same key every time', () => {
    const pub = createPublicKey(keys.publicKeyPem)
    expect(keyIdOf(pub)).toBe(keys.keyId)
  })

  it('gives different names to different keys', () => {
    expect(keys.keyId).not.toBe(other.keyId)
  })
})

describe('attesting', () => {
  it('produces something a checker accepts', () => {
    const a = attest(head(), keys.privateKeyPem)
    expect(a.v).toBe('1')
    expect(a.keyId).toBe(keys.keyId)
    expect(a.proof).toMatch(/^[A-Za-z0-9+/]+=*$/)
    expect(verifyAttestation(a, keys.publicKeyPem).ok).toBe(true)
  })

  it('refuses a head that is not a fingerprint', () => {
    expect(() => attest(head({ head: 'nope' }), keys.privateKeyPem)).toThrow(AttestationError)
  })

  it('refuses a count that is not a whole number written as text', () => {
    expect(() => attest(head({ count: '1.5' }), keys.privateKeyPem)).toThrow(/whole number/)
    expect(() => attest(head({ count: 12 as unknown as string }), keys.privateKeyPem)).toThrow()
  })

  it('accepts a count of zero, for a run with no entries', () => {
    expect(() => attest(head({ count: '0' }), keys.privateKeyPem)).not.toThrow()
  })

  it('refuses a time that is not exactly the agreed shape', () => {
    expect(() => attest(head({ attestedAt: '2026-08-27T09:15:00Z' }), keys.privateKeyPem)).toThrow()
  })

  it('refuses a key that is not Ed25519', () => {
    const rsa = generateKeyPairSync('rsa', { modulusLength: 2048 })
    const pem = rsa.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString()
    expect(() => attest(head(), pem)).toThrow(/must be Ed25519/)
  })

  it('refuses a key that is not a key at all', () => {
    expect(() => attest(head(), 'not a key')).toThrow(/could not be read/)
  })
})

describe('checking an attestation', () => {
  it('rejects one checked against the wrong key, and says so clearly', () => {
    const a = attest(head(), keys.privateKeyPem)
    const result = verifyAttestation(a, other.publicKeyPem)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toMatch(/different key/)
  })

  it('rejects one whose contents were altered after it was made', () => {
    const a = attest(head(), keys.privateKeyPem)
    // Someone shortens the record and edits the attestation to match.
    const tampered = { ...a, count: '6' }
    const result = verifyAttestation(tampered, keys.publicKeyPem)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toMatch(/does not match|altered/)
  })

  it('rejects one whose head was swapped', () => {
    const a = attest(head(), keys.privateKeyPem)
    const tampered = { ...a, head: fingerprint({ different: true }) }
    expect(verifyAttestation(tampered, keys.publicKeyPem).ok).toBe(false)
  })

  it('rejects a version it does not understand', () => {
    const a = attest(head(), keys.privateKeyPem)
    const future = { ...a, v: '2' as '1' }
    const result = verifyAttestation(future, keys.publicKeyPem)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toMatch(/version/)
  })

  it('rejects an unreadable public key rather than crashing', () => {
    const a = attest(head(), keys.privateKeyPem)
    const result = verifyAttestation(a, 'garbage')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toMatch(/could not be read/)
  })
})

describe('the part that actually catches truncation', () => {
  // The chain alone cannot notice entries removed from the end. This is what does.

  it('catches a record that has been shortened since it was attested', () => {
    const real = head({ head: fingerprint({ entry: 12 }), count: '12' })
    const a = attest(real, keys.privateKeyPem)

    // Four entries are quietly dropped. The remaining chain still verifies against
    // itself perfectly — but its head is now a different value.
    const shortened = { runId: 'run-0001', head: fingerprint({ entry: 8 }), count: '8' }

    const result = verifyAttestation(a, keys.publicKeyPem, shortened)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toMatch(/does not end where|added or removed/)
  })

  it('catches a record that has grown since it was attested', () => {
    const a = attest(head({ count: '12' }), keys.privateKeyPem)
    const grown = { runId: 'run-0001', head: fingerprint({ entry: 20 }), count: '20' }
    expect(verifyAttestation(a, keys.publicKeyPem, grown).ok).toBe(false)
  })

  it('catches an attestation from a different run', () => {
    const a = attest(head({ runId: 'run-aaa' }), keys.privateKeyPem)
    const result = verifyAttestation(a, keys.publicKeyPem, {
      runId: 'run-bbb',
      head: a.head,
      count: a.count,
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toMatch(/for run run-aaa, not run-bbb/)
  })

  it('passes when the record is exactly what was attested', () => {
    const real = head()
    const a = attest(real, keys.privateKeyPem)
    const result = verifyAttestation(a, keys.publicKeyPem, {
      runId: real.runId,
      head: real.head,
      count: real.count,
    })
    expect(result.ok).toBe(true)
  })

  it('a genuine attestation for a DIFFERENT record still passes without the expected head', () => {
    // Stated as a test because it is the reason expectedHead should always be given.
    // The signature only proves the statement is genuine, not that it describes the
    // record in front of you.
    const a = attest(head({ head: fingerprint({ some: 'other record' }) }), keys.privateKeyPem)
    expect(verifyAttestation(a, keys.publicKeyPem).ok).toBe(true)
  })
})

describe('explaining a result to a person', () => {
  it('says what it proves and, honestly, what it is worth', () => {
    const a = attest(head(), keys.privateKeyPem)
    const text = describeAttestation(verifyAttestation(a, keys.publicKeyPem))
    expect(text).toMatch(/vouching for its own conduct/)
    expect(text).toMatch(/worth exactly as much as that key is trusted/)
  })

  it('says plainly when it does not hold', () => {
    const a = attest(head(), keys.privateKeyPem)
    expect(describeAttestation(verifyAttestation(a, other.publicKeyPem))).toMatch(/does not hold/)
  })
})
