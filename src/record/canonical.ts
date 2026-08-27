/**
 * Turning data into text the same way, every time, on every machine.
 *
 * WHY THIS FILE EXISTS
 *
 * Charter keeps a record of everything it does, where each entry carries a
 * fingerprint of the entry before it. Change anything in the middle and every
 * fingerprint after it stops matching, which is how modification is detected.
 *
 * A fingerprint is taken over text. So the same data must always produce exactly
 * the same text — on Windows and on Linux, today and in a year, in our code and in
 * the code of a stranger checking our work. Ordinary JSON does not promise that:
 * `{"a":1,"b":2}` and `{"b":2,"a":1}` hold identical data and produce different
 * text, and therefore different fingerprints.
 *
 * The fix is a published standard, RFC 8785, which defines one canonical way to
 * write any JSON value as text. Keys sorted, whitespace removed, numbers and
 * strings written one agreed way. We use the `canonicalize` package, which
 * implements it and was written by one of the standard's authors.
 *
 * ONE CANONICALISER FOR THE WHOLE PROJECT. The record uses it, and so does the
 * cache that decides whether it has seen a request before. Two implementations
 * would eventually disagree, and the disagreement would be silent.
 */

import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'

/**
 * The `canonicalize` package is CommonJS, but ships an ES-style type declaration.
 * Under Node's newer module resolution those two disagree: the declaration says
 * "default export", the runtime says `module.exports = fn`, and a plain default
 * import ends up typed as a namespace that cannot be called.
 *
 * Loading it explicitly as CommonJS is the honest fix. It says what is actually
 * happening, it works at runtime and at compile time, and it needs no interop
 * setting to be switched on somewhere else for this file to be correct.
 *
 * This project runs on Node and only on Node, which is a decision recorded as D35,
 * so there is nothing to lose here.
 */
const canonicalize = createRequire(import.meta.url)('canonicalize') as (
  input: unknown,
) => string | undefined

/**
 * The values we allow into anything that gets fingerprinted.
 *
 * `undefined` is deliberately absent. JSON has no way to write it, so a field set
 * to `undefined` silently disappears — meaning two different objects can produce
 * the same text. Anything genuinely absent should be absent, and anything
 * genuinely empty should be `null`.
 */
export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue }

export type JsonObject = { [key: string]: JsonValue }

/** Thrown when a value cannot be safely fingerprinted. Always a bug, never input. */
export class NotHashableError extends Error {
  constructor(
    message: string,
    readonly path: string,
  ) {
    super(`${message} (at ${path || 'the top level'})`)
    this.name = 'NotHashableError'
  }
}

/**
 * The number rule, and why it is worth a whole function.
 *
 * JavaScript stores every number as a double. Whole numbers above about nine
 * quadrillion cannot be held exactly, and the loss is SILENT — no error, no
 * warning, no sign anything happened:
 *
 *     JSON.parse('{"id":12345678901234567890}').id
 *     // 12345678901234567000   ← the last three digits are gone
 *
 * Put one of those in the record and our fingerprint is taken over a number that
 * is not the number we were given. The chain still verifies against itself, so
 * nothing looks wrong; it is simply, quietly, recording the wrong value.
 *
 * So: any whole number too large to be held exactly is refused. Identifiers,
 * timestamps and amounts of money belong in the record as STRINGS, where no
 * arithmetic can touch them and no precision can be lost. Ordinary small numbers
 * — a confidence score of 0.87, a count of 3 — are fine and stay numbers.
 */
function checkNumber(value: number, path: string): void {
  if (!Number.isFinite(value)) {
    throw new NotHashableError(
      `${value} cannot be written as JSON. Not-a-number and infinity have no JSON form`,
      path,
    )
  }
  if (Number.isInteger(value) && !Number.isSafeInteger(value)) {
    throw new NotHashableError(
      `the whole number ${value} is too large for JavaScript to hold exactly, so it may ` +
        `already have been altered before it reached here. Record identifiers, timestamps ` +
        `and amounts as strings instead`,
      path,
    )
  }
}

/**
 * Walk a value and refuse anything that cannot be fingerprinted safely.
 *
 * Called before every fingerprint. It is cheap, and the failures it prevents are
 * the kind nobody finds by reading the code later.
 */
export function assertHashable(value: unknown, path = ''): asserts value is JsonValue {
  if (value === null) return

  switch (typeof value) {
    case 'string':
    case 'boolean':
      return
    case 'number':
      checkNumber(value, path)
      return
    case 'undefined':
      throw new NotHashableError(
        'undefined has no JSON form, so this field would silently vanish. Use null, or leave it out',
        path,
      )
    case 'bigint':
      throw new NotHashableError('a bigint has no JSON form. Write it as a string', path)
    case 'function':
    case 'symbol':
      throw new NotHashableError(`a ${typeof value} cannot go in the record`, path)
  }

  if (Array.isArray(value)) {
    value.forEach((item, i) => assertHashable(item, `${path}[${i}]`))
    return
  }

  // Dates are a common and dangerous mistake here. `JSON.stringify` turns one into
  // a string using the machine's own idea of time formatting, which is not a
  // promise we can rely on. Format it yourself, so the record shows what you meant.
  if (value instanceof Date) {
    throw new NotHashableError(
      'a Date cannot go in the record directly, because how it is written depends on the ' +
        'machine. Convert it yourself first, with .toISOString()',
      path,
    )
  }

  const proto: unknown = Object.getPrototypeOf(value)
  if (proto !== Object.prototype && proto !== null) {
    throw new NotHashableError(
      `only plain objects can go in the record, and this is a ${
        (value as object).constructor?.name ?? 'special object'
      }`,
      path,
    )
  }

  for (const [key, child] of Object.entries(value as object)) {
    assertHashable(child, path ? `${path}.${key}` : key)
  }
}

/**
 * One value in, one exact string out. The same value always gives the same string.
 *
 * This is the only place in Charter that turns data into text for fingerprinting.
 */
export function canonicalText(value: unknown): string {
  assertHashable(value)
  const text = canonicalize(value)
  if (text === undefined) {
    // The guard above should make this impossible. If it ever happens, something
    // about our assumptions is wrong, and failing loudly is the only safe answer.
    throw new NotHashableError('this value has no canonical form', '')
  }
  return text
}

/**
 * The fingerprint itself: SHA-256 of the canonical text, written in lowercase hex.
 *
 * SHA-256 because it is the same function the sealed document and the timestamp
 * service use. One function across the whole project means one thing for a
 * stranger to check.
 */
export function fingerprint(value: unknown): string {
  return createHash('sha256').update(canonicalText(value), 'utf8').digest('hex')
}

/** The fingerprint of raw bytes — for files, where there is nothing to canonicalise. */
export function fingerprintBytes(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex')
}

/**
 * Is this genuinely text, rather than something that merely looks like text?
 *
 * This exists because of a bug that appeared twice in one afternoon, in two
 * different files, for the same reason.
 *
 * A regular expression converts whatever it is given into text before matching.
 * So `/^[0-9]+$/.test(12)` matches the text "12" and passes — letting the NUMBER
 * 12 through a field that must hold the TEXT "12". The two are not
 * interchangeable anywhere in this project: they canonicalise to `{"n":12}` and
 * `{"n":"12"}`, which have different fingerprints. A record or an attestation
 * written with a number would produce a fingerprint that no independent checker
 * could reproduce, and nothing would look wrong until somebody tried to check it.
 *
 * Every field that must hold text is passed through here BEFORE its pattern is
 * applied. Twice was enough to make it shared rather than repeated.
 */
export function isText(value: unknown): value is string {
  return typeof value === 'string'
}

/** How to describe what something is, when it should have been text. */
export function describeType(value: unknown): string {
  if (value === null) return 'null'
  if (Array.isArray(value)) return 'a list'
  return `a ${typeof value}`
}

/** How a fingerprint is written wherever one appears. */
export const FINGERPRINT_PATTERN = /^[0-9a-f]{64}$/

export function isFingerprint(value: unknown): value is string {
  return typeof value === 'string' && FINGERPRINT_PATTERN.test(value)
}
