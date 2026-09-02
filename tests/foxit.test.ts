/**
 * The document service, checked without touching their servers.
 *
 * WHAT THE SERVICE DOES FOR CHARTER
 *
 * Charter writes the formation packet itself. An outside document service does the
 * reversible work on it before it is sealed: joining the separate documents into
 * one file, making that file small enough to email, and reading its text back out
 * so that somebody other than the writer can say what the packet says.
 *
 * WHY EVERY ONE OF THESE IS A TEST AND NOT A REAL CALL
 *
 * The free account is generous per month and strict per minute, and a test suite
 * that made real calls would be a suite nobody could run twice in a row. So the
 * network here is a written-out function that answers whatever a test says, and
 * the whole client is exercised — the address built, the form assembled, the task
 * waited on, the failure read — with no account and nothing sent.
 *
 * There is a separate command, `npm run foxit:proof`, that does make real calls.
 * It is run by a person on purpose and it is not part of this suite.
 *
 * THE FOUR THINGS THAT ARE EASY TO GET WRONG, AND ARE CHECKED HERE
 *
 * **A task is not finished when it is accepted.** The service answers 202 to mean
 * "accepted", and a caller that treated that as success would download nothing and
 * carry on with an empty file.
 *
 * **"Too many requests" is not a failure.** It means asked too fast, and the right
 * answer is to wait. Treating it as a failure would abandon a packet over a burst.
 *
 * **A failed task says nothing about the credential.** The request arrived and the
 * key was accepted; the service tried and would not finish. Describing that as a
 * rejected credential sends somebody to check a key that is perfectly fine.
 *
 * **Not reading the packet back is not the same as reading it and finding it
 * fine.** Those are different facts, and only one of them is worth anything.
 */

import { describe, expect, it } from 'vitest'

import {
  foxitDocuments,
  fileNameFor,
  whatIsMissingFrom,
  TaskFailed,
  JOINED_BY,
} from '../src/vendors/foxit.js'

const BASE = 'https://example.invalid'
const ID = 'a-client-id-that-is-not-real'
const SECRET = 'a-client-secret-that-is-not-real'

/** A PDF-shaped run of bytes. Nothing here parses it, so it need only be bytes. */
function bytes(text: string): Uint8Array {
  return new TextEncoder().encode(`%PDF-1.7\n${text}`)
}

/**
 * A network that answers from a written-out list and remembers what it was asked.
 *
 * Each answer is either a value to send back as JSON, or a function so that a test
 * can answer differently the second time — which is how "too many requests, then
 * fine" and "still working, then finished" are checked.
 */
function pretendNetwork(
  answers: Readonly<Record<string, unknown | ((count: number) => unknown)>>,
): {
  readonly fetcher: (url: string, init: RequestInit) => Promise<Response>
  readonly asked: Array<{ url: string; method: string; body: unknown }>
} {
  const asked: Array<{ url: string; method: string; body: unknown }> = []
  const counts = new Map<string, number>()

  return {
    asked,
    fetcher: async (url, init) => {
      asked.push({
        url,
        method: String(init.method ?? 'GET'),
        body: typeof init.body === 'string' ? JSON.parse(init.body) : init.body,
      })

      const found = Object.entries(answers).find(([part]) => url.includes(part))
      if (found === undefined) {
        return new Response(JSON.stringify({ error: 'nothing written out for this' }), {
          status: 404,
          headers: { 'content-type': 'application/json' },
        })
      }

      const seen = (counts.get(found[0]) ?? 0) + 1
      counts.set(found[0], seen)

      const answer = typeof found[1] === 'function' ? (found[1] as (n: number) => unknown)(seen) : found[1]

      if (answer instanceof Response) return answer
      return new Response(JSON.stringify(answer), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    },
  }
}

/** The client, wired so nothing really waits. */
function client(fetcher: (url: string, init: RequestInit) => Promise<Response>) {
  return foxitDocuments({
    baseUrl: BASE,
    clientId: ID,
    clientSecret: SECRET,
    fetcher,
    betweenAsks: 0,
    taskPatience: 50,
  })
}

/** The three-answer sequence a successful operation needs. */
function successfulOperation(operation: string, result: unknown) {
  return {
    '/documents/upload': { documentId: 'doc-1' },
    [operation]: { taskId: 'task-1' },
    '/tasks/task-1': { taskId: 'task-1', status: 'COMPLETED', resultDocumentId: 'out-1' },
    '/documents/out-1/download': result,
  }
}

describe('joining documents', () => {
  it('sends each one up, asks for the join, waits, and collects the result', async () => {
    const net = pretendNetwork({
      ...successfulOperation(
        '/enhance/pdf-combine',
        new Response(bytes('joined'), { status: 200 }),
      ),
    })

    const joined = await client(net.fetcher).join([
      { name: 'the formation pack', bytes: bytes('one') },
      { name: 'what you must still do yourself', bytes: bytes('two') },
    ])

    expect(new TextDecoder().decode(joined.bytes)).toContain('joined')
    expect(joined.partNames).toEqual([
      'the formation pack',
      'what you must still do yourself',
    ])
    expect(joined.joinedBy).toBe(JOINED_BY)

    // Two uploads, one join, at least one ask about the task, one download.
    const uploads = net.asked.filter((one) => one.url.includes('/documents/upload'))
    expect(uploads, 'one upload per document').toHaveLength(2)

    const join = net.asked.find((one) => one.url.includes('pdf-combine'))
    expect(join?.body).toEqual({
      documentInfos: [{ documentId: 'doc-1' }, { documentId: 'doc-1' }],
    })
  })

  it('does not go out to anybody when there is only one document', async () => {
    const net = pretendNetwork({})
    const joined = await client(net.fetcher).join([{ name: 'the only one', bytes: bytes('one') }])

    expect(net.asked, 'nothing was sent anywhere').toHaveLength(0)
    expect(joined.joinedBy).toContain('nothing to join')
  })

  it('refuses to pretend it joined nothing', async () => {
    const net = pretendNetwork({})
    await expect(client(net.fetcher).join([])).rejects.toThrow(/nothing to join/i)
  })

  it('keeps asking while the task is still working', async () => {
    let asks = 0
    const net = pretendNetwork({
      '/documents/upload': { documentId: 'doc-1' },
      '/enhance/pdf-combine': { taskId: 'task-1' },
      '/tasks/task-1': (count: number) => {
        asks = count
        return count < 3
          ? { taskId: 'task-1', status: 'PROCESSING', progress: 40 }
          : { taskId: 'task-1', status: 'COMPLETED', resultDocumentId: 'out-1' }
      },
      '/documents/out-1/download': new Response(bytes('joined'), { status: 200 }),
    })

    await client(net.fetcher).join([
      { name: 'one', bytes: bytes('one') },
      { name: 'two', bytes: bytes('two') },
    ])

    // The point: it did not stop at the first answer. "Accepted" is not "done".
    expect(asks).toBe(3)
  })

  it('gives up honestly when the task never finishes', async () => {
    const net = pretendNetwork({
      '/documents/upload': { documentId: 'doc-1' },
      '/enhance/pdf-combine': { taskId: 'task-1' },
      '/tasks/task-1': { taskId: 'task-1', status: 'PROCESSING' },
    })

    await expect(
      client(net.fetcher).join([
        { name: 'one', bytes: bytes('one') },
        { name: 'two', bytes: bytes('two') },
      ]),
    ).rejects.toThrow(/still "PROCESSING"/)
  })
})

describe('when the answer is "you are asking too fast"', () => {
  it('waits and asks again rather than treating it as a failure', async () => {
    // Put together rather than written as one object, so that replacing the
    // upload answer is a deliberate act rather than two keys with the same name
    // sitting next to each other and the second quietly winning.
    const net = pretendNetwork(
      Object.assign(
        successfulOperation('/enhance/pdf-combine', new Response(bytes('joined'), { status: 200 })),
        {
          '/documents/upload': (count: number) =>
            count === 1
              ? new Response('{"error":"Too Many Requests"}', { status: 429 })
              : { documentId: 'doc-1' },
        },
      ),
    )

    const joined = await client(net.fetcher).join([
      { name: 'one', bytes: bytes('one') },
      { name: 'two', bytes: bytes('two') },
    ])
    expect(joined.joinedBy).toBe(JOINED_BY)
  })

  it('gives up after a fixed number of tries rather than waiting forever', async () => {
    const net = pretendNetwork({
      '/documents/upload': new Response('{"error":"Too Many Requests"}', { status: 429 }),
    })

    await expect(
      client(net.fetcher).join([
        { name: 'one', bytes: bytes('one') },
        { name: 'two', bytes: bytes('two') },
      ]),
    ).rejects.toThrow(/allowance/i)
  })
})

describe('a task the service tried and would not finish', () => {
  it('says so, and says nothing about the credential', async () => {
    const net = pretendNetwork({
      '/documents/upload': { documentId: 'doc-1' },
      '/enhance/pdf-combine': { taskId: 'task-1' },
      '/tasks/task-1': {
        taskId: 'task-1',
        status: 'FAILED',
        error: { code: '10004', message: 'no permission.' },
      },
    })

    const failure = await client(net.fetcher)
      .join([
        { name: 'one', bytes: bytes('one') },
        { name: 'two', bytes: bytes('two') },
      ])
      .catch((error: unknown) => error)

    expect(failure).toBeInstanceOf(TaskFailed)
    expect((failure as TaskFailed).said).toBe('no permission.')
    // The whole reason this is its own kind. A key that works must never be
    // reported as a key that does not.
    expect((failure as Error).message).not.toMatch(/credential/i)
  })
})

describe('asking a service to rewrite a sealed pack', () => {
  it('reports a refusal as a refusal, with the words the service used', async () => {
    const net = pretendNetwork({
      '/documents/upload': { documentId: 'doc-1' },
      '/modify/pdf-flatten': { taskId: 'task-1' },
      '/tasks/task-1': {
        taskId: 'task-1',
        status: 'FAILED',
        error: { code: '10004', message: 'no permission.' },
      },
    })

    const attempt = await client(net.fetcher).tryToFlatten(bytes('a sealed pack'))
    expect(attempt.refused).toBe(true)
    expect(attempt.said).toContain('no permission.')
  })

  it('says plainly when the sealed pack WAS rewritten', async () => {
    // The outcome this project would need to hear about immediately. It must never
    // be quietly reported as a refusal because a refusal is what we expected.
    const net = pretendNetwork(
      successfulOperation('/modify/pdf-flatten', new Response(bytes('flattened'), { status: 200 })),
    )

    const attempt = await client(net.fetcher).tryToFlatten(bytes('a sealed pack'))
    expect(attempt.refused).toBe(false)
    expect(attempt.said).toMatch(/rewritten by an outside service/i)
  })
})

describe('reading the pack back', () => {
  it('gives back the text and says who read it', async () => {
    const net = pretendNetwork(
      successfulOperation(
        '/modify/pdf-extract',
        new Response('Rivera Sisters Baking Co\nAna Rivera', { status: 200 }),
      ),
    )

    const read = await client(net.fetcher).readBack(bytes('the pack'))
    expect(read.happened).toBe(true)
    expect(read.readBy).toBe(JOINED_BY)
    expect(read.text).toContain('Ana Rivera')

    const asked = net.asked.find((one) => one.url.includes('pdf-extract'))
    expect(asked?.body).toEqual({ documentId: 'doc-1', extractType: 'TEXT' })
  })

  it('says it did not happen rather than failing the run', async () => {
    // Not being able to check is ordinary: no network, out of allowance, service
    // down. What must never happen is a run that carries on as though the packet
    // had been checked.
    const net = pretendNetwork({})

    const read = await client(net.fetcher).readBack(bytes('the pack'))
    expect(read.happened).toBe(false)
    expect(read.text).toBe('')
    expect(read.readBy).toMatch(/nothing here says its text was checked/i)
  })
})

describe('making the pack smaller', () => {
  it('keeps the smaller file when it really is smaller', async () => {
    const net = pretendNetwork(
      successfulOperation('/modify/pdf-compress', new Response(bytes('x'), { status: 200 })),
    )

    const shrunk = await client(net.fetcher).shrink(bytes('a much longer pack than the result'))
    expect(shrunk.wasShrunk).toBe(true)
    expect(shrunk.shrunkBy).toBe(JOINED_BY)
  })

  it('keeps the original when what came back was not smaller', async () => {
    const original = bytes('short')
    const net = pretendNetwork(
      successfulOperation(
        '/modify/pdf-compress',
        new Response(bytes('a great deal longer than the original'), { status: 200 }),
      ),
    )

    const shrunk = await client(net.fetcher).shrink(original)
    expect(shrunk.wasShrunk).toBe(false)
    expect(shrunk.bytes).toBe(original)
    expect(shrunk.shrunkBy).toMatch(/not smaller/i)
  })

  it('hands back the original, and says why, when it could not ask', async () => {
    const net = pretendNetwork({})
    const original = bytes('the pack')

    const shrunk = await client(net.fetcher).shrink(original)
    expect(shrunk.wasShrunk).toBe(false)
    expect(shrunk.bytes).toBe(original)
    expect(shrunk.shrunkBy).toMatch(/^nobody\./)
  })
})

describe('the name a document is sent under', () => {
  it('turns a sentence into something a service will accept', () => {
    expect(fileNameFor('what you must still do yourself')).toBe(
      'what-you-must-still-do-yourself.pdf',
    )
    expect(fileNameFor('the formation pack')).toBe('the-formation-pack.pdf')
  })

  it('never produces an empty name', () => {
    expect(fileNameFor('')).toBe('document.pdf')
    expect(fileNameFor('   ---   ')).toBe('document.pdf')
  })
})

describe('what the packet must say, checked against what was read back', () => {
  const text = `Formation Pack
    Business   Rivera Sisters Baking Co
    Owners     Ana  Rivera, Lucia Rivera`

  it('finds nothing missing when everything is there', () => {
    expect(
      whatIsMissingFrom(text, ['Rivera Sisters Baking Co', 'Ana Rivera', 'Lucia Rivera']),
    ).toEqual([])
  })

  it('names what is missing', () => {
    expect(whatIsMissingFrom(text, ['Ana Rivera', 'Marta Rivera'])).toEqual(['Marta Rivera'])
  })

  it('does not report a name missing because a line broke differently', () => {
    // A PDF stores text in pieces, and reading it back can put a space where the
    // page shows none. Comparing raw strings would report a missing owner every
    // time the reader broke a line differently, which trains everybody to ignore
    // the check.
    expect(whatIsMissingFrom('Ana\n   Rivera', ['Ana Rivera'])).toEqual([])
    expect(whatIsMissingFrom('ANA RIVERA', ['Ana Rivera'])).toEqual([])
  })

  it('ignores an empty thing to look for rather than always failing', () => {
    expect(whatIsMissingFrom(text, ['', '   '])).toEqual([])
  })
})
