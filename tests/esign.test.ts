/**
 * The client that carries a sealed packet to the owners, checked without a server.
 *
 * WHAT IT IS FOR
 *
 * Charter prepares a formation packet and then has to get it in front of the
 * people who will sign it. That is the one act this whole project is arranged
 * around not doing itself: the software seals the document, and a person signs it.
 *
 * THE ONE THAT MATTERS MOST
 *
 * A signing folder with nowhere to sign in it.
 *
 * The service places a signature by finding marks in the text, by finding form
 * fields, or by being told exactly where. If it is asked to go looking and finds
 * nothing, the signing screen has no required fields on it, the person reaches
 * "Finish", and the service reports a completed folder containing an unsigned
 * document. Every screen after that says the run worked.
 *
 * For a project whose entire argument is that only a person signs, producing an
 * unsigned document while everything reports success is the worst outcome
 * available. So it is checked twice — once when the request is prepared and once
 * more in the client, immediately before it leaves — and both checks are here.
 *
 * WHAT THESE TESTS DO NOT PROVE
 *
 * That the client works against the real service. It has never been called: Foxit
 * issues eSign credentials from their eSign product, and the developer-portal pair
 * that works for their document services is refused here. So this file proves the
 * request is built correctly and the refusals fire; it does not prove the service
 * accepts it, and nothing in this project may claim otherwise until somebody has
 * run npm run esign:proof against a real account and seen it work.
 *
 * That distinction is not pedantry. The last client here that had never been
 * called was wrong three separate ways at once, under a test suite that passed.
 */

import { describe, expect, it } from 'vitest'

import {
  foxitESign,
  partyNumberFor,
  firstNameOf,
  lastNameOf,
  CannotCarry,
  WillNotAsk,
  MUST_SIGN,
  CARRIED_BY,
  type SignatureBox,
} from '../src/sign/foxit-esign.js'
import type { SignatureRequest, Signer } from '../src/sign/request.js'

const BASE = 'https://esign.example.invalid/api'
const TOKEN = 'a-token-that-is-not-real'

const SIGNERS: readonly Signer[] = [
  { fullName: 'Ana Rivera', email: 'ana@example.test', order: 1 },
  { fullName: 'Lucia Rivera', email: 'lucia@example.test', order: 2 },
]

const BOXES: readonly SignatureBox[] = [
  { owner: 'Ana Rivera', page: 3, x: 214, y: 640, width: 220, height: 22 },
  { owner: 'Lucia Rivera', page: 3, x: 214, y: 670, width: 220, height: 22 },
]

const request = (over: Partial<SignatureRequest> = {}): SignatureRequest => ({
  caseId: 'case-1',
  pack: new TextEncoder().encode('%PDF-1.7 a sealed pack'),
  packFingerprint: 'a'.repeat(64),
  signers: SIGNERS,
  whereToSign: 'boxes placed where Charter drew the lines',
  boxes: BOXES,
  sendImmediately: false,
  ...over,
})

/** A network that answers from a written-out list and remembers what it was asked. */
function pretendNetwork(answers: Readonly<Record<string, unknown>>): {
  readonly fetcher: (url: string, init: RequestInit) => Promise<Response>
  readonly asked: Array<{ url: string; body: unknown }>
} {
  const asked: Array<{ url: string; body: unknown }> = []

  return {
    asked,
    fetcher: async (url, init) => {
      const raw = typeof init.body === 'string' ? init.body : ''
      asked.push({
        url,
        body: raw.startsWith('{') ? JSON.parse(raw) : raw,
      })

      const found = Object.entries(answers).find(([part]) => url.includes(part))
      const answer = found === undefined ? { error: 'nothing written out for this' } : found[1]

      return new Response(JSON.stringify(answer), {
        status: found === undefined ? 404 : 200,
        headers: { 'content-type': 'application/json' },
      })
    },
  }
}

const client = (fetcher: (url: string, init: RequestInit) => Promise<Response>) =>
  foxitESign({ baseUrl: BASE, clientId: 'an-id', clientSecret: 'a-secret', fetcher })

describe('signing in', () => {
  it('sends the credentials as a form, which is what their endpoint takes', async () => {
    const net = pretendNetwork({ '/oauth2/access_token': { access_token: TOKEN } })
    expect(await client(net.fetcher).signIn()).toBe(TOKEN)

    // Sent as JSON their endpoint answers 415, and put in the address it answers
    // 500. Both were measured against the real host before this was written.
    expect(String(net.asked[0]?.body)).toContain('grant_type=client_credentials')
    expect(String(net.asked[0]?.body)).toContain('scope=read-write')
  })

  it('treats a refusal in the body as a refusal, even though the status is 200', async () => {
    // Their token endpoint answers 200 and puts the refusal inside. Reading the
    // status alone would hand an empty token to everything downstream.
    const net = pretendNetwork({
      '/oauth2/access_token': {
        error: 'invalid_client',
        error_description: 'invalid consumer credentials',
      },
    })

    await expect(client(net.fetcher).signIn()).rejects.toThrow(CannotCarry)
    await expect(client(net.fetcher).signIn()).rejects.toThrow(/invalid consumer credentials/)
  })

  it('says where the right credentials come from, because the wrong ones look right', async () => {
    const net = pretendNetwork({
      '/oauth2/access_token': { error_description: 'invalid consumer credentials' },
    })
    await expect(client(net.fetcher).signIn()).rejects.toThrow(/issues its own key pair/)
  })
})

describe('creating the signing folder', () => {
  it('sends the packet, the people, and a box for each of them', async () => {
    const net = pretendNetwork({ '/folders/createfolder': { folderId: 4471 } })
    const folder = await client(net.fetcher).createDraft(TOKEN, request(), BOXES)

    expect(folder.folderId).toBe('4471')
    expect(folder.carriedBy).toBe(CARRIED_BY)

    const sent = net.asked[0]?.body as Record<string, unknown>
    expect(sent['fileNames']).toEqual(['formation-pack.pdf'])
    expect((sent['parties'] as unknown[]).length).toBe(2)
    expect((sent['fields'] as unknown[]).length).toBe(2)
  })

  it('never lets the service send it as a side effect of building it', async () => {
    // The moment a person is asked to sign is a moment this project controls and
    // records. Creating and sending are two acts, and this is the first one.
    const net = pretendNetwork({ '/folders/createfolder': { folderId: 1 } })
    await client(net.fetcher).createDraft(TOKEN, request(), BOXES)

    expect((net.asked[0]?.body as Record<string, unknown>)['sendNow']).toBe(false)
  })

  it('asks for a permission that actually requires a signature', async () => {
    // The service also offers "view only" and "fill fields only". Either would
    // produce a completed folder with nothing signed in it.
    const net = pretendNetwork({ '/folders/createfolder': { folderId: 1 } })
    await client(net.fetcher).createDraft(TOKEN, request(), BOXES)

    const parties = (net.asked[0]?.body as { parties: { permission: string }[] }).parties
    for (const party of parties) expect(party.permission).toBe(MUST_SIGN)
  })

  it('does not also let the service go hunting for places to sign', async () => {
    // The boxes are exact. Letting it search the text and the form fields as well
    // would make the number of places to sign depend on what it happened to find.
    const net = pretendNetwork({ '/folders/createfolder': { folderId: 1 } })
    await client(net.fetcher).createDraft(TOKEN, request(), BOXES)

    const sent = net.asked[0]?.body as Record<string, unknown>
    expect(sent['processTextTags']).toBe(false)
    expect(sent['processAcroFields']).toBe(false)
  })

  it('points each box at the right person', async () => {
    const net = pretendNetwork({ '/folders/createfolder': { folderId: 1 } })
    await client(net.fetcher).createDraft(TOKEN, request(), BOXES)

    const fields = (net.asked[0]?.body as { fields: { party: number; pageNumber: number }[] }).fields
    expect(fields.map((one) => one.party)).toEqual([1, 2])
    expect(fields.every((one) => one.pageNumber === 3)).toBe(true)
  })

  it('refuses to create a folder with nowhere to sign', async () => {
    // The worst outcome available to this project: a completed folder containing
    // an unsigned document, with every screen saying it worked.
    const net = pretendNetwork({ '/folders/createfolder': { folderId: 1 } })

    await expect(client(net.fetcher).createDraft(TOKEN, request(), [])).rejects.toThrow(WillNotAsk)
    expect(net.asked, 'and nothing was sent anywhere').toHaveLength(0)
  })

  it('refuses when one owner has a box and another does not', async () => {
    const net = pretendNetwork({ '/folders/createfolder': { folderId: 1 } })
    const onlyOne = [BOXES[0] as SignatureBox]

    await expect(client(net.fetcher).createDraft(TOKEN, request(), onlyOne)).rejects.toThrow(
      /Lucia Rivera would be asked to sign a document with no signature box/,
    )
    expect(net.asked).toHaveLength(0)
  })

  it('refuses a reply that carried no folder to send later', async () => {
    const net = pretendNetwork({ '/folders/createfolder': { result: 'success' } })
    await expect(client(net.fetcher).createDraft(TOKEN, request(), BOXES)).rejects.toThrow(
      /no folderId/,
    )
  })
})

describe('sending it, as a separate act', () => {
  it('sends the folder that was created, in order', async () => {
    const net = pretendNetwork({ '/folders/sendDraftFolder': { result: 'success' } })
    await client(net.fetcher).send(TOKEN, {
      folderId: '4471',
      signers: SIGNERS,
      carriedBy: CARRIED_BY,
    })

    const sent = net.asked[0]?.body as Record<string, unknown>
    expect(sent['folderId']).toBe(4471)
    expect(sent['sendNow']).toBe(true)
    // "Both owners signed" and "one owner signed twice" are different documents.
    expect(sent['signInSequence']).toBe(true)
  })
})

describe('reading the state back', () => {
  it('keeps the service’s own word for it', async () => {
    const net = pretendNetwork({ '/folders/4471': { status: 'SHARED' } })
    const state = await client(net.fetcher).stateOf(TOKEN, '4471')

    expect(state.said).toBe('SHARED')
    expect(state.finished).toBe(false)
  })

  it('says finished only for the state that means everybody signed', async () => {
    const net = pretendNetwork({ '/folders/4471': { status: 'executed' } })
    expect((await client(net.fetcher).stateOf(TOKEN, '4471')).finished).toBe(true)
  })

  it('treats a word it has never seen as NOT finished', async () => {
    // A state nobody recognised is not evidence that everybody signed. The safe
    // direction is the one that claims less.
    const net = pretendNetwork({ '/folders/4471': { status: 'SOMETHING_NEW' } })
    const state = await client(net.fetcher).stateOf(TOKEN, '4471')

    expect(state.finished).toBe(false)
    expect(state.said, 'and it is kept, so somebody can see what arrived').toBe('SOMETHING_NEW')
  })

  it('does not treat "completed" as finished', async () => {
    // Their own vocabulary has completed BEFORE executed. Releasing at completed
    // hands over a document still missing the service's closing seal.
    const net = pretendNetwork({ '/folders/4471': { status: 'completed' } })
    expect((await client(net.fetcher).stateOf(TOKEN, '4471')).finished).toBe(false)
  })
})

describe('matching a box to a person', () => {
  it('numbers people from one, the way the service counts them', () => {
    expect(partyNumberFor('Ana Rivera', SIGNERS)).toBe(1)
    expect(partyNumberFor('Lucia Rivera', SIGNERS)).toBe(2)
  })

  it('refuses a box belonging to nobody rather than guessing at the first person', () => {
    // A signature box silently assigned to the wrong person is a document signed
    // by the wrong owner.
    expect(() => partyNumberFor('Somebody Else', SIGNERS)).toThrow(WillNotAsk)
  })
})

describe('splitting a name the way the service insists on', () => {
  it('keeps every part of a name with more than two words', () => {
    expect(firstNameOf('Maria del Carmen Rivera')).toBe('Maria')
    expect(lastNameOf('Maria del Carmen Rivera')).toBe('del Carmen Rivera')
  })

  it('never leaves either half empty', () => {
    // The service refuses an empty one, and a run that fell over at the last step
    // because somebody has one name would be a poor thing.
    expect(firstNameOf('Prince')).toBe('Prince')
    expect(lastNameOf('Prince')).toBe('Prince')
  })

  it('loses no characters, whichever way it splits', () => {
    for (const name of ['Ana Rivera', 'Wei Zhang', 'Maria del Carmen Rivera', 'Prince']) {
      const rejoined = `${firstNameOf(name)} ${lastNameOf(name)}`.replace(/\s+/g, ' ')
      expect(rejoined.includes(firstNameOf(name)), name).toBe(true)
      expect(rejoined.includes(lastNameOf(name)), name).toBe(true)
    }
  })
})
