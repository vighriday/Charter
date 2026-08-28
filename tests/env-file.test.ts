import { describe, it, expect } from 'vitest'
import { readFileSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createPublicKey } from 'node:crypto'
import { setEnvValue, readEnvValue, EnvFileRefusal } from '../src/record/env-file.js'
import {
  generateKeyPair,
  privateKeyFromEnv,
  keyIdOf,
  attest,
  verifyAttestation,
} from '../src/record/attestation.js'

/**
 * Writing the attestation key into the environment file, and reading it back.
 *
 * `npm run keys:generate` puts the private half of Charter's attestation key into
 * `.env` — a plain text file holding one setting per line, which is where a
 * project keeps the passwords and keys it needs and which is never committed.
 *
 * Charter's `.env` holds around forty real credentials and has no undo. A program
 * that mangles it costs every one of them, and some cannot be replaced without
 * going back to a vendor. So the part that could get it wrong takes text and
 * returns text, touching no disk, and these tests throw awkward files at it.
 */

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

/** A realistic file: comments, blank lines, a value containing an equals sign. */
const REALISTIC = [
  '# Charter',
  '',
  'REPLAY_MODE=true',
  '',
  '# The models',
  'GEMINI_API_KEY=abc123',
  'DATABASE_URL=postgres://user:pass@host/db?ssl=require',
  '',
  'ATTESTATION_PRIVATE_KEY=',
  '',
  'REVIEW_CONFIDENCE_FLOOR=0.85',
  '',
].join('\n')

describe('setting one value in an environment file', () => {
  it('fills in a line that is there but empty', () => {
    const { text, outcome } = setEnvValue(REALISTIC, 'ATTESTATION_PRIVATE_KEY', '"a-key"')
    expect(outcome).toBe('filled in')
    expect(readEnvValue(text, 'ATTESTATION_PRIVATE_KEY')).toBe('"a-key"')
  })

  it('leaves every other line exactly as it was, in the same order', () => {
    const { text } = setEnvValue(REALISTIC, 'ATTESTATION_PRIVATE_KEY', '"a-key"')
    const before = REALISTIC.split('\n').filter((l) => !l.startsWith('ATTESTATION_PRIVATE_KEY='))
    const after = text.split('\n').filter((l) => !l.startsWith('ATTESTATION_PRIVATE_KEY='))
    expect(after).toEqual(before)
  })

  it('does not disturb a value that itself contains an equals sign', () => {
    // A database address has one, and a naive split on "=" would cut it in half.
    const { text } = setEnvValue(REALISTIC, 'ATTESTATION_PRIVATE_KEY', '"a-key"')
    expect(readEnvValue(text, 'DATABASE_URL')).toBe('postgres://user:pass@host/db?ssl=require')
  })

  it('refuses to replace a value it was not asked to replace', () => {
    const held = REALISTIC.replace('ATTESTATION_PRIVATE_KEY=', 'ATTESTATION_PRIVATE_KEY="old-key"')
    expect(() => setEnvValue(held, 'ATTESTATION_PRIVATE_KEY', '"new-key"')).toThrow(EnvFileRefusal)
  })

  it('says why it refused, in words that explain the cost', () => {
    const held = REALISTIC.replace('ATTESTATION_PRIVATE_KEY=', 'ATTESTATION_PRIVATE_KEY="old-key"')
    try {
      setEnvValue(held, 'ATTESTATION_PRIVATE_KEY', '"new-key"')
      expect.unreachable('should have refused')
    } catch (error) {
      expect((error as Error).message).toContain('already holds a value')
      expect((error as Error).message).toContain('nothing')
    }
  })

  it('replaces when replacing is what was asked for', () => {
    const held = REALISTIC.replace('ATTESTATION_PRIVATE_KEY=', 'ATTESTATION_PRIVATE_KEY="old-key"')
    const { text, outcome } = setEnvValue(held, 'ATTESTATION_PRIVATE_KEY', '"new-key"', {
      replaceExisting: true,
    })
    expect(outcome).toBe('replaced')
    expect(readEnvValue(text, 'ATTESTATION_PRIVATE_KEY')).toBe('"new-key"')
    expect(text).not.toContain('old-key')
  })

  it('adds the setting, with an explanation, when the file has never heard of it', () => {
    const { text, outcome } = setEnvValue('REPLAY_MODE=true\n', 'ATTESTATION_PRIVATE_KEY', '"a-key"', {
      header: ['# Made by: npm run keys:generate'],
    })
    expect(outcome).toBe('added')
    expect(text).toContain('# Made by: npm run keys:generate')
    expect(readEnvValue(text, 'ATTESTATION_PRIVATE_KEY')).toBe('"a-key"')
    // And the setting that was already there is untouched.
    expect(readEnvValue(text, 'REPLAY_MODE')).toBe('true')
  })

  it('handles a file that does not end with a line break', () => {
    const { text } = setEnvValue('REPLAY_MODE=true', 'NEW_THING', 'x')
    expect(readEnvValue(text, 'REPLAY_MODE')).toBe('true')
    expect(readEnvValue(text, 'NEW_THING')).toBe('x')
  })

  it('handles a completely empty file', () => {
    const { text, outcome } = setEnvValue('', 'NEW_THING', 'x')
    expect(outcome).toBe('added')
    expect(readEnvValue(text, 'NEW_THING')).toBe('x')
  })

  it('refuses a value with a real line break in it, because one setting is one line', () => {
    expect(() => setEnvValue(REALISTIC, 'ATTESTATION_PRIVATE_KEY', 'line one\nline two')).toThrow(
      /one setting is one line/,
    )
  })

  it('refuses a name that is not a setting name', () => {
    expect(() => setEnvValue(REALISTIC, 'lower case', 'x')).toThrow(EnvFileRefusal)
    expect(() => setEnvValue(REALISTIC, '9LIVES', 'x')).toThrow(EnvFileRefusal)
  })

  it('reads back nothing for a name that is not there', () => {
    expect(readEnvValue(REALISTIC, 'NOT_A_SETTING')).toBeUndefined()
  })
})

describe('reading the attestation key back out of the environment', () => {
  const { privateKeyPem } = generateKeyPair()
  const oneLine = privateKeyPem.trimEnd().replace(/\n/g, '\\n')

  it('reads the form that keys:generate writes', () => {
    const read = privateKeyFromEnv({ ATTESTATION_PRIVATE_KEY: `"${oneLine}"` } as NodeJS.ProcessEnv)
    expect(read?.trim()).toBe(privateKeyPem.trim())
  })

  it('reads it without the quotes, because some tools strip them', () => {
    const read = privateKeyFromEnv({ ATTESTATION_PRIVATE_KEY: oneLine } as NodeJS.ProcessEnv)
    expect(read?.trim()).toBe(privateKeyPem.trim())
  })

  it('reads it with single quotes', () => {
    const read = privateKeyFromEnv({ ATTESTATION_PRIVATE_KEY: `'${oneLine}'` } as NodeJS.ProcessEnv)
    expect(read?.trim()).toBe(privateKeyPem.trim())
  })

  it('reads it when the line breaks are already real', () => {
    // How it arrives from a hosting provider's settings screen, where a text box
    // holds actual line breaks rather than the two characters standing for one.
    const read = privateKeyFromEnv({ ATTESTATION_PRIVATE_KEY: privateKeyPem } as NodeJS.ProcessEnv)
    expect(read?.trim()).toBe(privateKeyPem.trim())
  })

  it('the key it reads back actually works', () => {
    const read = privateKeyFromEnv({ ATTESTATION_PRIVATE_KEY: `"${oneLine}"` } as NodeJS.ProcessEnv)
    const head = {
      runId: 'r1',
      head: 'a'.repeat(64),
      count: '3',
      attestedAt: '2026-08-28T10:00:00.000Z',
    }
    expect(() => attest(head, read ?? '')).not.toThrow()
  })

  it('says nothing rather than guessing when the key is absent or blank', () => {
    expect(privateKeyFromEnv({} as NodeJS.ProcessEnv)).toBeUndefined()
    expect(privateKeyFromEnv({ ATTESTATION_PRIVATE_KEY: '' } as NodeJS.ProcessEnv)).toBeUndefined()
    expect(privateKeyFromEnv({ ATTESTATION_PRIVATE_KEY: '   ' } as NodeJS.ProcessEnv)).toBeUndefined()
  })

  it('makes two halves of one key, not two keys', () => {
    // The whole arrangement rests on this: the half published in the repository
    // must check what the half in .env signs.
    const { publicKeyPem, privateKeyPem: priv, keyId } = generateKeyPair()
    expect(keyIdOf(createPublicKey(priv))).toBe(keyId)
    expect(keyIdOf(createPublicKey(publicKeyPem))).toBe(keyId)
  })
})

describe('the public key committed to this repository', () => {
  const path = join(ROOT, 'keys/attestation.pub')

  it('exists, because without it nobody can check our record', () => {
    expect(
      existsSync(path),
      'keys/attestation.pub is missing. Run `npm run keys:generate`. Until it is ' +
        'there, "anyone can check our record" is a design rather than a fact.',
    ).toBe(true)
  })

  it('is a real Ed25519 public key', () => {
    const key = createPublicKey(readFileSync(path, 'utf8'))
    expect(key.asymmetricKeyType).toBe('ed25519')
    expect(key.type).toBe('public')
  })

  it('is a public key and nothing more, so publishing it gives nothing away', () => {
    const text = readFileSync(path, 'utf8')
    expect(text).toContain('-----BEGIN PUBLIC KEY-----')
    expect(text).not.toContain('PRIVATE')
  })

  it('has the key name the readme publishes, so a stranger can match them', () => {
    // Somebody handed one of our packets needs to confirm the key that checks it
    // is the key we published, without trusting the packet. That only works if the
    // name in the readme is the name of the key actually committed here.
    const name = keyIdOf(createPublicKey(readFileSync(path, 'utf8')))
    const readme = readFileSync(join(ROOT, 'README.md'), 'utf8')
    expect(
      readme,
      `The readme does not publish the key name of the committed public key ` +
        `(${name}). Add it, or a person checking a packet has nothing to compare against.`,
    ).toContain(name)
  })

  it('cannot check an attestation made by a different key', () => {
    // Proves the published key is doing real work rather than accepting anything.
    const stranger = generateKeyPair()
    const head = {
      runId: 'r1',
      head: 'b'.repeat(64),
      count: '2',
      attestedAt: '2026-08-28T10:00:00.000Z',
    }
    const forged = attest(head, stranger.privateKeyPem)
    const result = verifyAttestation(forged, readFileSync(path, 'utf8'), head)
    expect(result.ok).toBe(false)
  })
})
