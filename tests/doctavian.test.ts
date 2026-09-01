/**
 * The client for the document service, checked without touching their servers.
 *
 * WHAT THE SERVICE IS FOR
 *
 * Charter writes an ownership agreement — the document saying who owns what share
 * of a business, who decides things, and what happens when somebody wants out.
 * Charter can already write that document itself. This service is the other way of
 * producing it: hand over a Word template and a block of data, get back a finished
 * file. The template is committed to this repository, so anybody can open it and
 * check that the finished document matches.
 *
 * WHY EVERY ONE OF THESE IS A TEST AND NOT A CALL
 *
 * The account behind this is a demonstration account somebody set up by hand, it
 * is deleted a few days after the conference, and it needs a token that comes from
 * a Microsoft sign-in done by a person in a browser. So the client has to be
 * checked without any of that, and it is: the network is a written-out function
 * that gives back whatever a test says it gives back.
 *
 * THE FOUR THINGS THEIR TEAM TOLD US
 *
 * Their reference documentation and their shipped example disagree in several
 * places, and getting any of them wrong fails SILENTLY — a repeater with the wrong
 * closing tag renders nothing at all and says nothing. So we asked, and Kanwal
 * Roshi answered on 27 August 2026. The answers are encoded in the client and
 * checked here, because a note in a document is not a thing that stays true.
 */

import { describe, expect, it } from 'vitest'

import {
  doctavian,
  whatIsMissing,
  referenceIn,
  bytesIn,
  fingerprintOf,
  TEMPLATE_SYNTAX,
  DoctavianRefused,
  DEMO_HOST,
} from '../src/vendors/doctavian.js'

const KEY = 'a-key-that-is-not-real'
const TOKEN = 'a-bearer-token-that-is-not-real'

/** A network that answers from a written-out list, and remembers what it was asked. */
function pretendNetwork(answers: Readonly<Record<string, unknown>>): {
  readonly fetcher: (url: string, init: RequestInit) => Promise<Response>
  readonly asked: Array<{ url: string; headers: Record<string, string>; body: string }>
} {
  const asked: Array<{ url: string; headers: Record<string, string>; body: string }> = []

  return {
    asked,
    fetcher: async (url, init) => {
      asked.push({
        url,
        headers: (init.headers ?? {}) as Record<string, string>,
        body: typeof init.body === 'string' ? init.body : '',
      })
      const path = url.replace(DEMO_HOST, '')
      const found = Object.entries(answers).find(([shape]) => path.includes(shape))
      if (found === undefined) {
        return new Response(JSON.stringify({ error: 'nothing written out for this' }), {
          status: 404,
          headers: { 'content-type': 'application/json' },
        })
      }
      return new Response(JSON.stringify(found[1]), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    },
  }
}

const TEMPLATE = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 1, 2, 3])
const DATA = { Agreement: [{ Members: [{ FullName: 'Ana Rivera', AgreedPct: '50' }] }] }

describe('what has to be there before anything is sent', () => {
  it('says plainly when there is no key, and what happens instead', () => {
    const missing = whatIsMissing({ apiKey: '', bearerToken: TOKEN })

    expect(missing).toContain('DOCTAVIAN_API_KEY')
    expect(missing, 'somebody has to be told what happens instead').toContain('own code')
  })

  it('says plainly when there is no bearer token, and why one key is not enough', () => {
    // This is the question our own notes guessed wrong. They said the demonstration
    // environment probably took the key on its own; their team says it needs both.
    // Their answer is the one that counts, and it is written down where somebody
    // setting this up will actually read it.
    const missing = whatIsMissing({ apiKey: KEY, bearerToken: '' })

    expect(missing).toContain('DOCTAVIAN_REFRESH_TOKEN')
    expect(missing).toContain('Microsoft')
  })

  it('is happy when both are there', () => {
    expect(whatIsMissing({ apiKey: KEY, bearerToken: TOKEN })).toBeNull()
  })

  it('sends nothing at all when something is missing', async () => {
    const net = pretendNetwork({})
    const client = doctavian({ apiKey: KEY, bearerToken: '', fetcher: net.fetcher })

    await expect(
      client.generate({ template: TEMPLATE, templateName: 'agreement.docx', data: DATA }),
    ).rejects.toBeInstanceOf(DoctavianRefused)

    expect(net.asked, 'nothing should have gone out').toHaveLength(0)
  })
})

describe('both headers, on every call', () => {
  it('sends the key and the bearer token together', async () => {
    const net = pretendNetwork({ 'document/list': { items: [] } })
    const client = doctavian({ apiKey: KEY, bearerToken: TOKEN, fetcher: net.fetcher })

    await client.credentialsWork()

    const sent = net.asked[0]
    expect(sent?.headers['x-api-key']).toBe(KEY)
    expect(sent?.headers['authorization']).toBe(`Bearer ${TOKEN}`)
  })

  it('asks whether the service is there without any credential at all', async () => {
    // Two separate questions with two separate answers: "is it up" and "do our
    // credentials work". Rolling them together means an expired token reads as an
    // outage.
    const net = pretendNetwork({ 'common/status': { status: 'ok' } })
    const client = doctavian({ apiKey: KEY, bearerToken: TOKEN, fetcher: net.fetcher })

    expect(await client.reachable()).toBe(true)
    expect(net.asked[0]?.headers['x-api-key'], 'the status endpoint needs nothing').toBeUndefined()
  })
})

describe('generating a document', () => {
  const answers = {
    'template/upload': { id: 'template-123' },
    'data/upload': { id: 'data-456' },
    'document/generate': { urn: 'urn:doc:789' },
    'download': { content: Buffer.from('a pretend pdf').toString('base64') },
  }

  it('walks the four steps in order and gives back the document', async () => {
    const net = pretendNetwork(answers)
    const client = doctavian({ apiKey: KEY, bearerToken: TOKEN, fetcher: net.fetcher })

    const made = await client.generate({
      template: TEMPLATE,
      templateName: 'agreement.docx',
      data: DATA,
    })

    expect(net.asked.map((one) => one.url.replace(DEMO_HOST, ''))).toEqual([
      '/v1/documents/template/upload',
      '/v1/documents/data/upload',
      '/v1/documents/document/generate',
      '/v1/documents/document/urn%3Adoc%3A789/download',
    ])
    expect(Buffer.from(made.bytes).toString('utf8')).toBe('a pretend pdf')
    expect(made.reference).toBe('urn:doc:789')
  })

  it('fingerprints the data BEFORE sending it, because they delete it afterwards', async () => {
    // They delete the uploaded data once the document is made. If we want to be
    // able to show later exactly what data produced exactly which document, this
    // is the only moment at which it can be done.
    const net = pretendNetwork(answers)
    const client = doctavian({ apiKey: KEY, bearerToken: TOKEN, fetcher: net.fetcher })

    const made = await client.generate({
      template: TEMPLATE,
      templateName: 'agreement.docx',
      data: DATA,
    })

    const sentBytes = new TextEncoder().encode(JSON.stringify(DATA))
    expect(made.dataFingerprint).toBe(fingerprintOf(sentBytes))
    expect(made.templateFingerprint).toBe(fingerprintOf(TEMPLATE))
  })

  it('stops rather than guessing when no reference comes back', async () => {
    const net = pretendNetwork({ ...answers, 'document/generate': { nothing: 'useful' } })
    const client = doctavian({ apiKey: KEY, bearerToken: TOKEN, fetcher: net.fetcher })

    await expect(
      client.generate({ template: TEMPLATE, templateName: 'a.docx', data: DATA }),
    ).rejects.toThrow(/no reference came back/)
  })

  it('stops rather than handing back something that is not a document', async () => {
    const net = pretendNetwork({ ...answers, download: { unexpected: 'shape' } })
    const client = doctavian({ apiKey: KEY, bearerToken: TOKEN, fetcher: net.fetcher })

    await expect(
      client.generate({ template: TEMPLATE, templateName: 'a.docx', data: DATA }),
    ).rejects.toThrow(/does not recognise/)
  })
})

describe('finding their reference, whatever they called it this time', () => {
  it('reads any of the names their documentation uses', () => {
    expect(referenceIn({ urn: 'a' })).toBe('a')
    expect(referenceIn({ id: 'b' })).toBe('b')
    expect(referenceIn({ identifier: 'c' })).toBe('c')
    expect(referenceIn({ documentId: 'd' })).toBe('d')
  })

  it('looks one level in, because several of their replies wrap the useful part', () => {
    expect(referenceIn({ data: { urn: 'inside' } })).toBe('inside')
    expect(referenceIn({ result: { document: { id: 'deeper' } } })).toBe('deeper')
  })

  it('gives back nothing rather than something wrong', () => {
    expect(referenceIn({ unrelated: 'x' })).toBeNull()
    expect(referenceIn(null)).toBeNull()
    expect(referenceIn('a string')).toBeNull()
    expect(referenceIn({ urn: '   ' }), 'blank is not a reference').toBeNull()
  })
})

describe('reading the document out of whatever came back', () => {
  it('takes a bare string as the document itself', () => {
    const encoded = Buffer.from('hello').toString('base64')
    expect(Buffer.from(bytesIn(encoded) as Uint8Array).toString('utf8')).toBe('hello')
  })

  it('takes it out of the field, under any of the names they use', () => {
    const encoded = Buffer.from('hello').toString('base64')
    for (const name of ['content', 'bytes', 'file', 'document']) {
      const found = bytesIn({ [name]: encoded })
      expect(Buffer.from(found as Uint8Array).toString('utf8')).toBe('hello')
    }
  })

  it('gives back nothing when there is nothing to read', () => {
    expect(bytesIn({ status: 'ok' })).toBeNull()
    expect(bytesIn(null)).toBeNull()
  })
})

describe('the template syntax their team settled', () => {
  // Every one of these renders NOTHING when it is wrong, and says nothing about
  // why. That is the whole reason they are constants with tests rather than
  // strings typed into a Word document.

  it('closes a repeater with its name, as the shipped example does', () => {
    // Their reference documentation shows </mdoc:repeater>. Their own sample shows
    // the name repeated. Their team confirmed the sample is right.
    expect(TEMPLATE_SYNTAX.closeRepeater('members')).toBe('</mdoc:repeater name="members">')
  })

  it('writes a repeater value in the braced form', () => {
    // Documentation: value="Invoice[0].Items". Sample: value="{!Customer.Items}".
    // Confirmed: the sample.
    expect(TEMPLATE_SYNTAX.repeaterValue('Agreement[0].Members')).toBe('{!Agreement[0].Members}')
  })

  it('puts hashes on BOTH sides of a loop variable', () => {
    // A missing trailing hash fails silently, which is the worst way for a legal
    // document to be wrong: it renders, and a name is simply absent.
    expect(TEMPLATE_SYNTAX.loopField('m', 'FullName')).toBe('{!#m#.FullName}')
  })

  it('marks an expression with the dollar that makes it one', () => {
    // Without it the expression prints as literal text. In a document that
    // allocates ownership, that means a percentage printed as its own formula.
    expect(TEMPLATE_SYNTAX.expression('toDecimal(a) + toDecimal(b)')).toBe(
      '{!$toDecimal(a) + toDecimal(b)}',
    )
  })
})
