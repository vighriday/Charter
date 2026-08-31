/**
 * Asking somebody who is not us to say this record existed.
 *
 * THE CRITICISM THIS ANSWERS
 *
 * We hold the record and we hold the key that attests over it. So we could, in
 * principle, throw the whole thing away and produce a perfectly consistent
 * different record from scratch, attest over that, and nothing inside the record
 * would show it. No amount of our own fingerprinting fixes that, because every
 * link in it is made by us.
 *
 * It is a fair criticism and it deserves a real answer rather than a paragraph.
 *
 * WHAT AN ANCHOR IS
 *
 * A **timestamp authority** is an outside service that takes a fingerprint, and
 * hands back a statement of the form "somebody showed me this exact fingerprint at
 * this exact moment", signed with their key and not ours. It never sees the record
 * — only a fingerprint of the end of it — so nothing private is sent anywhere.
 *
 * That does not stop us rewriting the record. Nothing can. What it does is fix the
 * record in time: a rewritten record would have to produce a different head, and
 * the anchor for the old head would still exist, held by somebody else, saying
 * that a different ending existed on that day. **We cannot rewrite the past
 * quietly, only loudly.** That is the whole of the claim, and it is worth more than
 * the claim we could make without it.
 *
 * WHAT THIS DELIBERATELY DOES NOT CLAIM
 *
 * It does not check the authority's own signature on the token. Doing that
 * properly means validating their certificate chain against a trust store, which is
 * a real piece of work and would be a second, weaker copy of something every
 * operating system already does well.
 *
 * So the token is stored exactly as it arrived, byte for byte, and the checker
 * prints the one-line command that checks it with standard tools. What IS checked
 * here is the part that matters most and is easy to get wrong: **that the token is
 * about OUR fingerprint.** A token that is real, correctly signed, and about
 * somebody else's record proves nothing about ours, and it is precisely the sort of
 * thing that would go unnoticed.
 *
 * WHY NOTHING BREAKS WITHOUT ONE
 *
 * The authorities used here are free and ask for no account, and free services go
 * down. A run that could not reach one produces a record with no anchor and says
 * so, in those words. An anchor that quietly failed and left the claim standing
 * would be worse than no anchor at all.
 */

import forge from 'node-forge'
import { isFingerprint } from './canonical.js'

/** How the network is reached. Passed in so tests never touch it. */
export type Fetcher = (url: string, init: RequestInit) => Promise<Response>

/**
 * Timestamp authorities that need no account, no key and no payment card.
 *
 * More than one, because these are free services run as a public good and any of
 * them may be unavailable on the day. They are tried in order and the first that
 * answers is used; which one answered goes into the record.
 */
export const AUTHORITIES: readonly { readonly name: string; readonly url: string }[] = [
  { name: 'FreeTSA', url: 'https://freetsa.org/tsr' },
  { name: 'DigiCert', url: 'http://timestamp.digicert.com' },
  { name: 'Sectigo', url: 'http://timestamp.sectigo.com' },
]

/** What a timestamp request and a token are, as far as anything here is concerned. */
export const CONTENT_TYPE_REQUEST = 'application/timestamp-query'
export const CONTENT_TYPE_REPLY = 'application/timestamp-reply'

/** The object identifier for SHA-256, which is the fingerprint this project uses. */
const SHA256_OID = '2.16.840.1.101.3.4.2.1'

/** The object identifier that marks the part of a token saying what was stamped. */
const TST_INFO_OID = '1.2.840.113549.1.9.16.1.4'

export class CannotAnchor extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'CannotAnchor'
  }
}

/**
 * Build the request that asks an authority to stamp one fingerprint.
 *
 * Written out with the same library that builds the seal certificate, rather than
 * by hand, because the shape is a published standard and getting a byte wrong
 * produces a request every authority refuses with a message that says nothing
 * useful.
 *
 * `nonce` is a number the caller invents. The authority copies it into the reply,
 * so a reply that came back with a different one is a reply to somebody else's
 * question — which is the check that stops a saved answer being handed back as a
 * fresh one.
 */
export function buildRequest(fingerprintHex: string, nonce: string): Uint8Array {
  if (!isFingerprint(fingerprintHex)) {
    throw new CannotAnchor(
      `"${fingerprintHex}" is not a fingerprint. An anchor is a statement about ` +
        `exactly one fingerprint, and stamping anything else would produce a token ` +
        `nobody could match against anything.`,
    )
  }
  if (!/^\d+$/.test(nonce) || nonce === '') {
    throw new CannotAnchor(`the nonce has to be a whole number written out. Got "${nonce}".`)
  }

  const { asn1 } = forge
  const bytes = forge.util.hexToBytes(fingerprintHex)

  const request = asn1.create(asn1.Class.UNIVERSAL, asn1.Type.SEQUENCE, true, [
    // version 1
    asn1.create(asn1.Class.UNIVERSAL, asn1.Type.INTEGER, false, forge.util.hexToBytes('01')),
    // messageImprint: which algorithm, and the fingerprint itself
    asn1.create(asn1.Class.UNIVERSAL, asn1.Type.SEQUENCE, true, [
      asn1.create(asn1.Class.UNIVERSAL, asn1.Type.SEQUENCE, true, [
        asn1.create(
          asn1.Class.UNIVERSAL,
          asn1.Type.OID,
          false,
          asn1.oidToDer(SHA256_OID).getBytes(),
        ),
        asn1.create(asn1.Class.UNIVERSAL, asn1.Type.NULL, false, ''),
      ]),
      asn1.create(asn1.Class.UNIVERSAL, asn1.Type.OCTETSTRING, false, bytes),
    ]),
    // The nonce, which is what makes a reply provably a reply to this question.
    asn1.create(
      asn1.Class.UNIVERSAL,
      asn1.Type.INTEGER,
      false,
      forge.util.hexToBytes(evenLengthHex(BigInt(nonce).toString(16))),
    ),
    // Ask for their certificate to come back inside the token. Without it, nobody
    // handed only the token can check it against anything.
    asn1.create(asn1.Class.UNIVERSAL, asn1.Type.BOOLEAN, false, String.fromCharCode(0xff)),
  ])

  const der = asn1.toDer(request).getBytes()
  return Uint8Array.from(der, (character) => character.charCodeAt(0) & 0xff)
}

/** A whole number as hexadecimal, padded so it is a whole number of bytes. */
function evenLengthHex(hex: string): string {
  const padded = hex.length % 2 === 0 ? hex : `0${hex}`
  // A leading bit of 1 would be read as a negative number, so a zero byte goes in
  // front. Getting this wrong makes an authority refuse the request.
  return Number.parseInt(padded.slice(0, 2), 16) > 0x7f ? `00${padded}` : padded
}

/** What was read out of a token. */
export interface TokenContents {
  /** The fingerprint the authority says it stamped. */
  readonly stamped: string
  /** When they say they stamped it. */
  readonly at: string
  /** The nonce they copied back, when there was one. */
  readonly nonce?: string
}

/**
 * Read the part of a token that says what was stamped and when.
 *
 * Only that part. The authority's signature over it is not checked here — see the
 * note at the top of this file, and the command the checker prints.
 */
export function readToken(token: Uint8Array): TokenContents {
  const { asn1 } = forge

  let tree: forge.asn1.Asn1
  try {
    tree = asn1.fromDer(forge.util.createBuffer(Buffer.from(token).toString('binary')))
  } catch (error) {
    throw new CannotAnchor(
      `this is not a timestamp token: ${error instanceof Error ? error.message : String(error)}`,
    )
  }

  const info = findStampedPart(tree)
  if (info === undefined) {
    throw new CannotAnchor(
      'this reply carries no statement of what was stamped. A token without that ' +
        'part cannot be matched against any record, so it proves nothing.',
    )
  }

  // The statement is a sequence: version, which policy, what was stamped, a serial
  // number, the time, and then optional parts. Only three of those are read.
  const parts = info.value as forge.asn1.Asn1[]
  const imprint = parts[2]?.value as forge.asn1.Asn1[] | undefined
  const stampedBytes = imprint?.[1]?.value
  const at = parts[4]?.value

  if (typeof stampedBytes !== 'string' || typeof at !== 'string') {
    throw new CannotAnchor(
      'this token is missing either what was stamped or when. Both are needed, ' +
        'because a time without a fingerprint is about nothing and a fingerprint ' +
        'without a time is not an anchor.',
    )
  }

  const nonce = parts.find(
    (one, index) => index > 4 && one.type === asn1.Type.INTEGER,
  )?.value

  return {
    stamped: forge.util.bytesToHex(stampedBytes),
    at: generalizedTime(at),
    ...(typeof nonce === 'string' && nonce !== ''
      ? { nonce: BigInt(`0x${forge.util.bytesToHex(nonce)}`).toString() }
      : {}),
  }
}

/**
 * Walk the token looking for the part that says what was stamped.
 *
 * Found by the identifier that marks it, rather than by counting steps into the
 * structure. Authorities differ in what else they put in a token, and a reader
 * that counted steps would work against one and quietly return the wrong thing
 * against another.
 */
function findStampedPart(node: forge.asn1.Asn1): forge.asn1.Asn1 | undefined {
  const { asn1 } = forge
  if (!Array.isArray(node.value)) return undefined

  const children = node.value as forge.asn1.Asn1[]

  for (const [at, child] of children.entries()) {
    if (
      child.type === asn1.Type.OID &&
      typeof child.value === 'string' &&
      asn1.derToOid(forge.util.createBuffer(child.value)) === TST_INFO_OID
    ) {
      // The statement itself sits in the next element, wrapped once and held as a
      // block of bytes that is itself a structure.
      const wrapper = children[at + 1]
      const holder = Array.isArray(wrapper?.value)
        ? ((wrapper.value as forge.asn1.Asn1[])[0] ?? wrapper)
        : wrapper
      const raw = holder?.value
      if (typeof raw !== 'string') continue
      try {
        return asn1.fromDer(forge.util.createBuffer(raw))
      } catch {
        continue
      }
    }

    const deeper = findStampedPart(child)
    if (deeper !== undefined) return deeper
  }

  return undefined
}

/** Turn the time form these tokens use into the one the record uses. */
export function generalizedTime(raw: string): string {
  const match = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})/.exec(raw.trim())
  if (match === null) {
    // Some libraries hand it back already parsed. Passed through rather than
    // guessed at, because a wrong time is worse than an unfamiliar one.
    return raw
  }
  const [, year, month, day, hour, minute, second] = match
  return `${year}-${month}-${day}T${hour}:${minute}:${second}.000Z`
}

/** An anchor, as the record holds it. */
export interface Anchor {
  readonly v: '1'
  /** Which authority answered. */
  readonly authority: string
  /** The fingerprint that was stamped: the head of the record. */
  readonly head: string
  /** When the authority says it stamped it. */
  readonly at: string
  /** The token exactly as it arrived, base64. Nothing is re-encoded. */
  readonly token: string
}

export interface AnchorAttempt {
  readonly anchor?: Anchor
  /** What happened, in plain words. Recorded whether it worked or not. */
  readonly why: string
}

export interface AnchorOptions {
  readonly fetcher?: Fetcher
  readonly authorities?: readonly { readonly name: string; readonly url: string }[]
  /** Invented by the caller and copied back by the authority. */
  readonly nonce: string
  readonly patience?: number
}

/**
 * Ask each authority in turn to stamp this fingerprint, and stop at the first that
 * answers.
 *
 * Never throws. An anchor that could not be obtained is an ordinary outcome that
 * gets recorded, said plainly, and does not stop a run — these are free services
 * run as a public good, and one being down on the day is not a fault in this
 * program.
 */
export async function anchorHead(
  head: string,
  options: AnchorOptions,
): Promise<AnchorAttempt> {
  const fetcher = options.fetcher ?? ((url, init) => fetch(url, init))
  const authorities = options.authorities ?? AUTHORITIES
  const request = buildRequest(head, options.nonce)
  const tried: string[] = []

  for (const authority of authorities) {
    let response: Response
    try {
      response = await fetcher(authority.url, {
        method: 'POST',
        headers: { 'content-type': CONTENT_TYPE_REQUEST },
        body: request,
        signal: AbortSignal.timeout(options.patience ?? 15_000),
      })
    } catch (error) {
      tried.push(`${authority.name} could not be reached`)
      void error
      continue
    }

    if (!response.ok) {
      tried.push(`${authority.name} answered ${response.status}`)
      continue
    }

    const token = new Uint8Array(await response.arrayBuffer())

    let contents: TokenContents
    try {
      contents = readToken(token)
    } catch (error) {
      tried.push(
        `${authority.name} answered with something unreadable: ` +
          `${error instanceof Error ? error.message : String(error)}`,
      )
      continue
    }

    // The check that matters. A token that is real, correctly signed, and about
    // somebody else's fingerprint proves nothing about this record — and is
    // exactly the sort of thing nobody would notice.
    if (contents.stamped.toLowerCase() !== head.toLowerCase()) {
      tried.push(
        `${authority.name} stamped a different fingerprint (${contents.stamped.slice(0, 16)}…) ` +
          `than the one it was asked about. Refused.`,
      )
      continue
    }

    // The nonce is what makes this a reply to THIS question rather than a saved
    // answer to an earlier one.
    if (contents.nonce !== undefined && contents.nonce !== options.nonce) {
      tried.push(
        `${authority.name} answered a different question than the one asked. Refused.`,
      )
      continue
    }

    return {
      anchor: {
        v: '1',
        authority: authority.name,
        head,
        at: contents.at,
        token: Buffer.from(token).toString('base64'),
      },
      why:
        `${authority.name} stamped the head of this record at ${contents.at}. ` +
        `They were shown a fingerprint and nothing else — never the record.` +
        (tried.length === 0 ? '' : ` Before that: ${tried.join('; ')}.`),
    }
  }

  return {
    why:
      `No timestamp authority stamped this record. ${tried.join('; ') || 'None was tried.'} ` +
      `Nothing is wrong with the record: it is still fingerprinted end to end and ` +
      `still attested by us. What is missing is the part that would come from ` +
      `somebody who is not us, and it is missing rather than assumed.`,
  }
}

/**
 * Whether an anchor really is about this record's head.
 *
 * Read out of the token itself rather than from the fields beside it. The fields
 * are ours and could say anything; the token is theirs.
 */
export function anchorCovers(anchor: Anchor, head: string): { readonly ok: boolean; readonly reason: string } {
  let contents: TokenContents
  try {
    contents = readToken(new Uint8Array(Buffer.from(anchor.token, 'base64')))
  } catch (error) {
    return {
      ok: false,
      reason: `the token could not be read: ${error instanceof Error ? error.message : String(error)}`,
    }
  }

  if (contents.stamped.toLowerCase() !== head.toLowerCase()) {
    return {
      ok: false,
      reason:
        `the token is about ${contents.stamped.slice(0, 16)}… and this record ends ` +
        `at ${head.slice(0, 16)}…. It is a real timestamp of a different thing.`,
    }
  }

  if (contents.at !== anchor.at) {
    return {
      ok: false,
      reason:
        `the token says ${contents.at} and the record beside it says ${anchor.at}. ` +
        `The token is the one that counts, because it is theirs and the other is ours.`,
    }
  }

  return {
    ok: true,
    reason:
      `${anchor.authority} stamped ${head.slice(0, 16)}… at ${contents.at}, read out ` +
      `of their own token rather than from anything we wrote beside it.`,
  }
}

/** The command somebody runs to check the authority's own signature on a token. */
export function howToCheckTheSignature(tokenPath: string): string {
  return (
    `Charter does not check the authority's signature on this token, because doing ` +
    `it properly means validating their certificate against a trust store — which ` +
    `your machine already does well and this project would only do worse. Check it ` +
    `yourself with:\n\n` +
    `    openssl ts -reply -in ${tokenPath} -text\n\n` +
    `What Charter DOES check is that the token is about this record's fingerprint ` +
    `and no other, which is the part that would otherwise go unnoticed.`
  )
}
