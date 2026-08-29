/**
 * The decisions behind `npm run keys:classify`, with no network and no printing.
 *
 * WHAT THIS FILE IS
 *
 * Charter holds credentials from outside companies. A credential is a long string
 * of characters that proves to a company that we are allowed to use their service.
 * Two of ours are currently a guess, and this file holds the small pieces of
 * reasoning needed to turn a guess into a fact.
 *
 * The part that actually talks to those companies lives in `classify.ts`. It is
 * separated from this file for one reason: everything here can be tested without a
 * network connection, an account, or a key. A rule about how to read a reply is
 * worth nothing if nobody can check the rule.
 *
 * The same split already exists elsewhere in this project. `env-file.ts` holds the
 * dangerous text handling and `generate-keys.ts` holds the part that touches disk.
 * Pure decisions in one file, effects in another, so the decisions can be proved.
 */

/** The practice service. The live one is deliberately not reachable from here. */
export const NAMECOM_TEST_HOST = 'https://api.dev.name.com'

/** Nutrient's document processor. An empty request is rejected before any work. */
export const NUTRIENT_PROCESSOR_PROBE = 'https://api.nutrient.io/build'

/** Nutrient's field-reading service. A separate product with a separate key. */
export const NUTRIENT_EXTRACTION_PROBE = 'https://api.nutrient.io/extraction/parse'

/** How long to wait for any one answer before giving up, in milliseconds. */
export const PATIENCE = 20_000

import { readEnvValue } from '../record/env-file.js'

/** A credential, together with the name in `.env` it was actually found under. */
export interface Found {
  readonly name: string
  readonly value: string
}

/**
 * The first of these names that holds something, or nothing if none of them do.
 *
 * The NAME comes back as well as the value, because knowing where a credential is
 * currently written is what lets this program tell you it is already in the right
 * place. A check that says "move it" every time you run it trains people to ignore
 * it, and then it is worth nothing on the day it has something new to say.
 */
export function firstFilled(env: string, names: readonly string[]): Found | undefined {
  for (const name of names) {
    const value = readEnvValue(env, name)
    if (value !== undefined && value.length > 0) return { name, value }
  }
  return undefined
}

/** Say where a key belongs, or that it is already there. */
export function place(found: Found, belongsIn: string): string {
  return found.name === belongsIn
    ? `It is already on the  ${belongsIn}  line in .env. Nothing to change.`
    : `Move it from  ${found.name}  to  ${belongsIn}  in .env.`
}

/** What a service said about a credential, in a form we can reason about. */
export type Reception =
  | { readonly kind: 'accepted'; readonly status: number }
  | { readonly kind: 'unknown to them'; readonly status: number }
  | { readonly kind: 'known but not allowed'; readonly status: number }
  | { readonly kind: 'unexpected'; readonly status: number; readonly body: string }
  | { readonly kind: 'could not ask'; readonly why: string }

/**
 * Turn a reply into one of the five meanings above.
 *
 * `accepted` deserves care: it means the service recognised the credential, NOT
 * that it did any work. We send nothing worth doing, so a complaint about the
 * request itself is the best possible answer — it proves the credential passed.
 */
export function receive(status: number, body: string): Reception {
  if (status === 401) return { kind: 'unknown to them', status }
  if (status === 403) return { kind: 'known but not allowed', status }
  if (status === 400 || status === 415 || status === 422) return { kind: 'accepted', status }
  if (status >= 200 && status < 300) return { kind: 'accepted', status }
  return { kind: 'unexpected', status, body: body.slice(0, 300) }
}

/** Enough of a credential to tell two apart, and not enough to use one. */
export function fingerprint(value: string): string {
  const visible = value.length > 12 ? value.slice(0, 9) : value.slice(0, 2)
  return `${visible}... (${value.length} characters)`
}

export function say(reception: Reception): string {
  switch (reception.kind) {
    case 'accepted':
      return `accepted (${reception.status})`
    case 'unknown to them':
      return 'not recognised (401)'
    case 'known but not allowed':
      return 'recognised, but refused for this product (403)'
    case 'unexpected':
      return `unexpected reply ${reception.status}: ${reception.body}`
    case 'could not ask':
      return `could not reach them: ${reception.why}`
  }
}

/**
 * The usernames worth trying against name.com, most likely first.
 *
 * name.com wants an ACCOUNT NAME, not an email address, and the practice account
 * adds `-test` on the end — their own example is `reseller123-test`. If what we
 * hold looks like an email we also try the part before the `@`, because that is
 * very often the account name as well.
 *
 * The `-test` forms come first deliberately. If a token somehow worked against
 * both the practice account and the live one, the first match is reported, and the
 * first match must never be the live account. Order is the safety here.
 */
export function usernameCandidates(given: string): readonly string[] {
  const seen = new Set<string>()
  const add = (value: string): void => {
    const tidy = value.trim()
    if (tidy.length > 0) seen.add(tidy)
  }

  const localPart = given.includes('@') ? given.slice(0, given.indexOf('@')) : given

  add(given.endsWith('-test') ? given : `${given}-test`)
  add(localPart.endsWith('-test') ? localPart : `${localPart}-test`)
  add(given)
  add(localPart)

  return [...seen]
}
