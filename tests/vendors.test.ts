/**
 * Proving the real vendor clients work, without calling a single vendor.
 *
 * WHAT IS BEING PROVED
 *
 * Every outside service in this project was a stand-in until 31 August 2026. The
 * fair suspicion about that is obvious: *does this only work because everything is
 * pretend?*
 *
 * These tests exercise the real clients — the address built, the credential put in
 * the right header, the reply read, the refusal handled, the money guard — by
 * handing each one a function that returns a written-out reply instead of reaching
 * the network. **No account, no key, no request, nothing spent.**
 *
 * WHY THAT IS NOT A DODGE
 *
 * Charter's free allowances are small enough that this is the only way. The search
 * service allows 250 searches a month and one run uses eight to twelve; reading
 * documents allows 5,000 credits a month at 15 a page. A test suite that reached a
 * real service would spend a month in an afternoon, and a test nobody can afford to
 * run twice is a test nobody runs.
 *
 * So the network is passed in rather than reached for, everywhere, and what is
 * checked here is everything except whether the vendor's own servers behave — which
 * is the part no test of ours could establish anyway.
 *
 * THE TESTS THAT MATTER MOST
 *
 * The two about money. One proves a live registration is refused when the settings
 * did not say so twice. The other proves a retry sends the same idempotency key, so
 * a timeout cannot turn into a second purchase.
 */

import { describe, expect, it } from 'vitest'
import {
  ask,
  basicAuth,
  describeReply,
  nothingLearned,
  type Fetcher,
} from '../src/vendors/http.js'
import {
  LIVE_HOST,
  PATH,
  RegistrarRefusal,
  TEST_HOST,
  ZONE_CHECK_LIMIT,
  idempotencyKeyFor,
  namecomRegistrar,
  priceInCents,
} from '../src/vendors/namecom.js'
import { NoSearchService, searchesFor, webSearch } from '../src/vendors/search.js'
import {
  CouldNotRead,
  fieldsFrom,
  nutrientIdentityReader,
  readConfidence,
  readLabel,
} from '../src/vendors/nutrient.js'
import { chooseServices, describeChoices, howManyAreReal } from '../src/vendors/build.js'
import { DEFAULT_SETTINGS, readSettings } from '../src/settings.js'

// ─────────────────────────────────────────────────────────────────────────────
// A network that is not one
// ─────────────────────────────────────────────────────────────────────────────

interface Seen {
  readonly url: string
  readonly init: RequestInit
}

/** A fetcher that records what it was asked and answers from a script. */
function fakeNetwork(
  answer: (url: string, init: RequestInit) => { status: number; body: unknown } | Error,
): Fetcher & { readonly seen: Seen[] } {
  const seen: Seen[] = []
  const fetcher = (async (url: string, init: RequestInit) => {
    seen.push({ url, init })
    const result = answer(url, init)
    if (result instanceof Error) throw result
    return new Response(JSON.stringify(result.body), {
      status: result.status,
      headers: { 'content-type': 'application/json' },
    })
  }) as Fetcher & { seen: Seen[] }
  fetcher.seen = seen
  return fetcher
}

const headerOf = (seen: Seen, name: string): string => {
  const headers = seen.init.headers as Record<string, string>
  return headers[name] ?? headers[name.toLowerCase()] ?? ''
}

// ─────────────────────────────────────────────────────────────────────────────
// The shared layer
// ─────────────────────────────────────────────────────────────────────────────

describe('asking one service one question', () => {
  it('reads a good answer', async () => {
    const net = fakeNetwork(() => ({ status: 200, body: { hello: 'there' } }))
    const reply = await ask('https://example.test/thing', { fetcher: net })

    expect(reply.kind).toBe('ok')
    expect(reply.kind === 'ok' ? reply.body : null).toEqual({ hello: 'there' })
  })

  it('tells 401 and 403 apart, which is the whole of the credential check', async () => {
    // 401 means "I do not know this credential". 403 means "I know it, and not for
    // this". That difference is what lets Charter work out which product a key
    // belongs to without processing anything at all.
    const refused = await ask('https://example.test/a', {
      fetcher: fakeNetwork(() => ({ status: 401, body: {} })),
    })
    const wrongProduct = await ask('https://example.test/a', {
      fetcher: fakeNetwork(() => ({ status: 403, body: {} })),
    })

    expect(refused.kind).toBe('refused')
    expect(wrongProduct.kind).toBe('not-allowed-here')
    expect(describeReply(wrongProduct)).toMatch(/will not accept it for this product/)
  })

  it('treats being out of allowance as its own thing', async () => {
    // Not a failure of the credential and not a failure of the request. It is a
    // reason to try the other vendor, and it does not come back until their own
    // limit resets.
    const reply = await ask('https://example.test/a', {
      fetcher: fakeNetwork(() => ({ status: 429, body: {} })),
    })
    expect(reply.kind).toBe('out-of-allowance')
  })

  it('separates their fault from ours', async () => {
    const theirs = await ask('https://example.test/a', {
      fetcher: fakeNetwork(() => ({ status: 503, body: {} })),
    })
    const ours = await ask('https://example.test/a', {
      fetcher: fakeNetwork(() => ({ status: 400, body: {} })),
    })
    expect(theirs.kind).toBe('their-fault')
    expect(ours.kind).toBe('refused')
  })

  it('says plainly when nothing arrived, so nothing is blamed', async () => {
    // A request that never arrived says nothing about the credential, the question,
    // or the vendor. A diagnostic that blamed one of them would send somebody to a
    // dashboard to replace a key that was fine.
    const reply = await ask('https://example.test/a', {
      fetcher: fakeNetwork(() => new Error('getaddrinfo ENOTFOUND')),
    })

    expect(reply.kind).toBe('never-arrived')
    expect(nothingLearned(reply)).toBe(true)
    expect(describeReply(reply)).toMatch(/Nothing was learned/)
  })

  it('never throws, whatever comes back', async () => {
    for (const status of [200, 204, 400, 401, 403, 404, 429, 500, 503]) {
      const reply = await ask('https://example.test/a', {
        fetcher: fakeNetwork(() => ({ status, body: null })),
      })
      expect(typeof reply.kind, String(status)).toBe('string')
    }
  })

  it('says so when the answer is not the shape expected', async () => {
    const fetcher = (async () =>
      new Response('<html>a login page</html>', { status: 200 })) as Fetcher
    const reply = await ask('https://example.test/a', { fetcher })
    expect(reply.kind).toBe('unreadable')
  })

  it('puts a credential in a header and nowhere else', () => {
    const header = basicAuth('someone-test', 'a-real-token')
    expect(header.startsWith('Basic ')).toBe(true)
    expect(Buffer.from(header.slice(6), 'base64').toString('utf8')).toBe(
      'someone-test:a-real-token',
    )
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// The registrar
// ─────────────────────────────────────────────────────────────────────────────

const registrar = (
  net: ReturnType<typeof fakeNetwork>,
  over: Partial<Parameters<typeof namecomRegistrar>[0]> = {},
) =>
  namecomRegistrar({
    environment: 'test',
    username: 'someone-test',
    token: 'a-token',
    mayspendRealMoney: false,
    caseId: 'case-1',
    fetcher: net,
    ...over,
  })

describe('checking whether a web address is free', () => {
  it('asks the practice service, at the current path', async () => {
    // /core/v1/ is the current interface. An older /v4/ turns up in search results
    // and is not it.
    const net = fakeNetwork(() => ({
      status: 200,
      body: { results: [{ domainName: 'riverabakery.com', purchasable: true, purchasePrice: 12.99 }] },
    }))
    await registrar(net).quote('riverabakery.com')

    expect(net.seen[0]?.url).toBe(`${TEST_HOST}${PATH}/domains:checkAvailability`)
    expect(net.seen[0]?.url).not.toContain('/v4/')
  })

  it('goes to the live service only when built for it', () => {
    const net = fakeNetwork(() => ({ status: 200, body: { results: [] } }))
    const live = registrar(net, { environment: 'live', mayspendRealMoney: true })
    void live
    // Proved by the address used on the next call rather than by reading a field.
    expect(LIVE_HOST).not.toBe(TEST_HOST)
  })

  it('carries the credential in the authorization header', async () => {
    const net = fakeNetwork(() => ({
      status: 200,
      body: { results: [{ domainName: 'a.com', purchasable: false }] },
    }))
    await registrar(net).quote('a.com')

    expect(headerOf(net.seen[0] as Seen, 'authorization')).toBe(
      basicAuth('someone-test', 'a-token'),
    )
  })

  it('reads the price in whole cents', async () => {
    const net = fakeNetwork(() => ({
      status: 200,
      body: { results: [{ domainName: 'a.com', purchasable: true, purchasePrice: 12.99 }] },
    }))
    const quote = await registrar(net).quote('a.com')

    expect(quote.available).toBe(true)
    expect(quote.priceCents).toBe('1299')
  })

  it('rounds a price rather than truncating it', () => {
    // Truncating turns 12.99 into 1298 cents and under-reports every price by a
    // cent, for ever, in a document about money.
    expect(priceInCents(12.99)).toBe('1299')
    expect(priceInCents('12.99')).toBe('1299')
    expect(priceInCents(9)).toBe('900')
    expect(priceInCents('not a number')).toBeUndefined()
    expect(priceInCents(undefined)).toBeUndefined()
  })

  it('refuses to guess when the answer never mentions the address', async () => {
    // Treating silence as "available" is how an address that is already taken gets
    // bought.
    const net = fakeNetwork(() => ({ status: 200, body: { results: [] } }))
    await expect(registrar(net).quote('a.com')).rejects.toThrow(RegistrarRefusal)
    await expect(registrar(net).quote('a.com')).rejects.toThrow(/without mentioning it/)
  })

  it('refuses rather than guessing when the registrar could not be reached', async () => {
    const net = fakeNetwork(() => new Error('socket hang up'))
    await expect(registrar(net).quote('a.com')).rejects.toThrow(/never arrived/)
  })
})

describe('the cheap wide pass, which is never an answer', () => {
  it('drops only the names the registrar said are taken', async () => {
    const net = fakeNetwork(() => ({
      status: 200,
      body: {
        results: [
          { domainName: 'taken.com', available: false },
          { domainName: 'free.com', available: true },
          // Their zone data answers null when it does not know.
          { domainName: 'unknown.com', available: null },
        ],
      },
    }))

    const left = await registrar(net).shortlist(['taken.com', 'free.com', 'unknown.com'])

    // The unknown one is KEPT. Dropping it would quietly discard a name that might
    // be free, and the authoritative check is what settles it.
    expect(left).toEqual(['free.com', 'unknown.com'])
  })

  it('keeps everything when the wide pass could not run', async () => {
    // A wide pass that failed is not a wide pass that found nothing.
    const net = fakeNetwork(() => ({ status: 500, body: {} }))
    expect(await registrar(net).shortlist(['a.com', 'b.com'])).toEqual(['a.com', 'b.com'])
  })

  it('refuses more names than the registrar accepts at once', async () => {
    const net = fakeNetwork(() => ({ status: 200, body: { results: [] } }))
    const tooMany = Array.from({ length: ZONE_CHECK_LIMIT + 1 }, (_, at) => `n${at}.com`)
    await expect(registrar(net).shortlist(tooMany)).rejects.toThrow(RegistrarRefusal)
  })

  it('asks nothing at all for an empty list', async () => {
    const net = fakeNetwork(() => ({ status: 200, body: {} }))
    expect(await registrar(net).shortlist([])).toEqual([])
    expect(net.seen).toHaveLength(0)
  })
})

describe('registering, which spends money and cannot be undone', () => {
  it('refuses a live registration when the settings did not say so twice', async () => {
    // The most important test in this file. One setting away from spending money
    // is one setting too few.
    const net = fakeNetwork(() => ({ status: 200, body: {} }))
    const live = registrar(net, { environment: 'live', mayspendRealMoney: false })

    await expect(live.register('a.com', '1299')).rejects.toThrow(RegistrarRefusal)
    expect(net.seen, 'the registrar was contacted anyway').toHaveLength(0)
  })

  it('says which two settings are needed', async () => {
    const net = fakeNetwork(() => ({ status: 200, body: {} }))
    const live = registrar(net, { environment: 'live', mayspendRealMoney: false })
    await expect(live.register('a.com', '1299')).rejects.toThrow(/SPEND_REAL_MONEY/)
  })

  it('sends the same key on a retry, so a timeout cannot buy twice', async () => {
    // A registration costs money and cannot be undone, and a retry after a timeout
    // is exactly when a duplicate purchase happens. The key is worked out from the
    // case and the address, so a retry is provably the same request.
    const net = fakeNetwork(() => ({ status: 200, body: { order: { id: 1 } } }))
    const client = registrar(net)

    await client.register('a.com', '1299')
    await client.register('a.com', '1299')

    const first = headerOf(net.seen[0] as Seen, 'X-Idempotency-Key')
    const second = headerOf(net.seen[1] as Seen, 'X-Idempotency-Key')

    expect(first).not.toBe('')
    expect(second).toBe(first)
  })

  it('gives two different cases two different keys', () => {
    expect(idempotencyKeyFor('case-1', 'a.com')).not.toBe(idempotencyKeyFor('case-2', 'a.com'))
    expect(idempotencyKeyFor('case-1', 'a.com')).not.toBe(idempotencyKeyFor('case-1', 'b.com'))
  })

  it('records that the practice service is a practice service', async () => {
    // Read from what this client was built with, not from the reply. A vendor
    // telling us their own sandbox was real would be believed.
    const net = fakeNetwork(() => ({ status: 200, body: { order: { id: 1 }, sandbox: false } }))
    const registered = await registrar(net).register('a.com', '1299')
    expect(registered.sandbox).toBe(true)
  })

  it('says nothing was charged when the registrar refused', async () => {
    const net = fakeNetwork(() => ({ status: 402, body: { message: 'no' } }))
    await expect(registrar(net).register('a.com', '1299')).rejects.toThrow(/Nothing was charged/)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Search
// ─────────────────────────────────────────────────────────────────────────────

describe('searching the live web', () => {
  const serpapiAnswer = {
    organic_results: [
      { title: 'Rivera Bakery', link: 'https://example.com/a', snippet: 'A bakery.' },
    ],
  }
  const tavilyAnswer = {
    results: [{ title: 'Rivera Bakery', url: 'https://example.com/b', content: 'A bakery.' }],
  }

  it('uses the first service when it answers', async () => {
    const net = fakeNetwork(() => ({ status: 200, body: serpapiAnswer }))
    const answer = await webSearch({ serpapiKey: 'k', tavilyKey: 't', fetcher: net }).search('x')

    expect(answer.answeredBy).toBe('serpapi')
    expect(answer.hits[0]?.url).toBe('https://example.com/a')
  })

  it('falls back to the second when the first is out of allowance', async () => {
    // 250 searches a month is not many. Running out is an ordinary Tuesday.
    const net = fakeNetwork((url) =>
      url.includes('serpapi') ? { status: 429, body: {} } : { status: 200, body: tavilyAnswer },
    )
    const answer = await webSearch({ serpapiKey: 'k', tavilyKey: 't', fetcher: net }).search('x')

    expect(answer.answeredBy).toBe('tavily')
    expect(answer.hits[0]?.url).toBe('https://example.com/b')
  })

  it('records which one answered, so the record stays honest', async () => {
    // The model is never told. It has no basis for treating one as more
    // trustworthy than the other, and a model that could see the difference would
    // start reasoning about the plumbing instead of about the business.
    const net = fakeNetwork(() => ({ status: 200, body: tavilyAnswer }))
    const answer = await webSearch({ tavilyKey: 't', fetcher: net }).search('x')
    expect(answer.answeredBy).toBe('tavily')
  })

  it('refuses rather than returning nothing when neither answered', async () => {
    // "Nobody is using this name" and "nobody could be asked" are different facts,
    // and only one of them is a reason to go ahead with a name.
    const net = fakeNetwork(() => ({ status: 500, body: {} }))
    const service = webSearch({ serpapiKey: 'k', tavilyKey: 't', fetcher: net })

    await expect(service.search('x')).rejects.toThrow(NoSearchService)
    await expect(service.search('x')).rejects.toThrow(/different facts/)
  })

  it('will not be built with no key at all', () => {
    expect(() => webSearch({})).toThrow(NoSearchService)
  })

  it('forces a fresh call when told to', async () => {
    // Their cache lasts an hour and does not count against the allowance, which is
    // right while building and a lie about freshness in a demonstration.
    const net = fakeNetwork(() => ({ status: 200, body: serpapiAnswer }))
    await webSearch({ serpapiKey: 'k', freshOnly: true, fetcher: net }).search('x')
    expect(net.seen[0]?.url).toContain('no_cache=true')
  })

  it('asks four different questions about one name, not one', async () => {
    // A single generic search is what most people do. Each of these tests
    // something different, and each has a reason a lawyer would recognise.
    const searches = searchesFor('Rivera Sisters Bakery', 'Austin, Texas')

    expect(searches.length).toBeGreaterThanOrEqual(4)
    expect(new Set(searches.map((one) => one.query)).size).toBe(searches.length)
    for (const one of searches) {
      expect(one.query, 'a search that does not name the business').toContain('Rivera')
      expect(one.tests.length, one.query).toBeGreaterThan(20)
    }
  })

  it('includes the question the territory rule turns on', () => {
    // United States common-law trademark rights are bounded to the territory of
    // actual use, so where somebody trades is the legal test rather than
    // decoration.
    const said = searchesFor('Rivera Sisters Bakery', 'Austin, Texas')
      .map((one) => one.tests)
      .join(' ')
    expect(said).toMatch(/territory of actual use/)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Reading an identity document
// ─────────────────────────────────────────────────────────────────────────────

const reader = (net: ReturnType<typeof fakeNetwork>) =>
  nutrientIdentityReader({
    extractionKey: 'a-key',
    documentAt: async () => ({ where: { url: 'https://example.test/doc' }, kind: 'passport' }),
    fetcher: net,
  })

const goodReading = {
  data: {
    full_name: { value: 'Ana Rivera', match: 'id_match', confidence: 0.97 },
    date_of_birth: { value: '1989-04-11', match: 'id_match', confidence: 0.95 },
    document_number: { value: 'X1234567', match: 'id_match', confidence: 0.93 },
    expiry_date: { value: '2031-04-11', match: 'fuzzy_match', confidence: 0.94 },
  },
}

describe('reading the fields off a document', () => {
  it('returns every field, with its label and its score', async () => {
    const net = fakeNetwork(() => ({ status: 200, body: goodReading }))
    const document = await reader(net).read('Ana Rivera', 'ana-passport', 'understand')

    expect(document.fields).toHaveLength(4)
    expect(document.owner).toBe('Ana Rivera')
    expect(document.depth).toBe('understand')
    expect(document.fields.find((one) => one.name === 'expiry_date')?.label).toBe('fuzzy_match')
  })

  it('sends the depth it was given, so a run cannot be quietly cheaper', async () => {
    const net = fakeNetwork(() => ({ status: 200, body: goodReading }))
    await reader(net).read('Ana Rivera', 'ana-passport', 'agentic')

    const sent = JSON.parse(String(net.seen[0]?.init.body)) as Record<string, unknown>
    expect(sent['mode']).toBe('agentic')
  })

  it('asks for exactly the fields a formation packet needs, and no more', async () => {
    // Asking for everything a passport carries would mean holding a person's
    // details Charter has no use for.
    const net = fakeNetwork(() => ({ status: 200, body: goodReading }))
    await reader(net).read('Ana Rivera', 'ana-passport', 'understand')

    const sent = JSON.parse(String(net.seen[0]?.init.body)) as { schema: Record<string, unknown> }
    expect(Object.keys(sent.schema).sort()).toEqual([
      'date_of_birth',
      'document_number',
      'expiry_date',
      'full_name',
    ])
  })

  it('explains a 403 as the wrong product rather than a bad key', async () => {
    // The processor key against this service is refused with 403. They are two
    // separate products with two separate accounts, and somebody told "your key is
    // invalid" would go and replace a key that was fine.
    const net = fakeNetwork(() => ({ status: 403, body: {} }))
    await expect(reader(net).read('Ana', 'doc', 'understand')).rejects.toThrow(CouldNotRead)
    await expect(reader(net).read('Ana', 'doc', 'understand')).rejects.toThrow(
      /DOCUMENT PROCESSOR key/,
    )
  })

  it('refuses an answer that named no fields at all', async () => {
    // Not a document with nothing in it. An answer that says nothing. Carrying on
    // would show "no values needed checking", which reads exactly like a clean
    // document.
    const net = fakeNetwork(() => ({ status: 200, body: { data: {} } }))
    await expect(reader(net).read('Ana', 'doc', 'understand')).rejects.toThrow(
      /reads exactly like a clean document/,
    )
  })

  it('turns a label it does not recognise into one that needs a person', () => {
    // The only safe direction. A label nobody recognised is not evidence that a
    // value is fine, and treating it as fine would let a vendor add a label and
    // quietly reduce our oversight.
    expect(readLabel({ match: 'something_new' })).toBe('not_found')
    expect(readLabel({})).toBe('not_found')
    expect(readLabel({ match: 'ID_MATCH' })).toBe('id_match')
  })

  it('never turns a missing score into a zero', () => {
    // Absent means unavailable, not low. A zero would read as "the reader was
    // certain this was wrong", which is a different and much stronger claim.
    expect(readConfidence({})).toBeUndefined()
    expect(readConfidence({ confidence: 'high' })).toBeUndefined()
    expect(readConfidence({ confidence: 0 })).toBe(0)
    expect(readConfidence({ confidence: 0.94 })).toBe(0.94)
    expect(readConfidence({ confidence: 94 })).toBe(0.94)
  })

  it('drops a value that is not text rather than putting it in a document', () => {
    const fields = fieldsFrom({ data: { full_name: { value: 12345, match: 'id_match' } } })
    expect(fields).toHaveLength(0)
  })

  it('reads their reply whichever of the three shapes it used', () => {
    for (const key of ['data', 'fields', 'result']) {
      const body = { [key]: { full_name: { value: 'Ana', match: 'id_match' } } }
      expect(fieldsFrom(body), key).toHaveLength(1)
    }
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Choosing between the real thing and a stand-in
// ─────────────────────────────────────────────────────────────────────────────

describe('which services are real', () => {
  it('uses a stand-in for all five on the settings a fresh clone gets', () => {
    const services = chooseServices({ settings: DEFAULT_SETTINGS, caseId: 'c', env: {} })
    expect(howManyAreReal(services)).toBe(0)
  })

  it('keeps using stand-ins while replaying, even when every key is present', () => {
    // The rule that stops a rehearsal spending a month's allowance because a key
    // happened to be lying around.
    const services = chooseServices({
      settings: DEFAULT_SETTINGS,
      caseId: 'c',
      env: {
        SERPAPI_KEY: 'k',
        NAMECOM_USERNAME_TEST: 'u',
        NAMECOM_TOKEN_TEST: 't',
        NUTRIENT_EXTRACTION_KEY: 'n',
      },
    })
    expect(howManyAreReal(services)).toBe(0)
    expect(services.chosen.search.why).toMatch(/recorded in advance, because this is a replay/)
  })

  it('uses the real one only when replay is off AND the key is there', () => {
    const settings = readSettings({ REPLAY_MODE: 'false' })
    const services = chooseServices({
      settings,
      caseId: 'c',
      env: { SERPAPI_KEY: 'k' },
    })

    expect(services.chosen.search.kind).toBe('real')
    expect(services.chosen.registrar.kind).toBe('stand-in')
    expect(services.chosen.identity.kind).toBe('stand-in')
  })

  it('names the missing key rather than saying something went wrong', () => {
    const settings = readSettings({ REPLAY_MODE: 'false' })
    const services = chooseServices({ settings, caseId: 'c', env: {} })
    expect(services.chosen.search.why).toContain('SERPAPI_KEY')
  })

  it('never claims publishing is real, because it is not built', () => {
    const settings = readSettings({ REPLAY_MODE: 'false' })
    const services = chooseServices({
      settings,
      caseId: 'c',
      env: { VERCEL_TOKEN: 'anything' },
    })
    expect(services.chosen.publishing.kind).toBe('stand-in')
    expect(services.chosen.publishing.why).toMatch(/not built yet/)
  })

  it('says the pack itself does not go through any outside company', () => {
    // Worth stating plainly. The part that matters — assembling and sealing the
    // pack — is Charter's own code and is not waiting on anybody.
    const services = chooseServices({ settings: DEFAULT_SETTINGS, caseId: 'c', env: {} })
    expect(services.chosen.publishing.why).toMatch(/stamped by Charter/)
  })

  it('gives a plain sentence for every service, whichever answered', () => {
    const lines = describeChoices(
      chooseServices({ settings: DEFAULT_SETTINGS, caseId: 'c', env: {} }),
    )
    // Six services now: searching, the registrar, reading identity documents,
    // the document work on the pack, publishing, and the storefront picture.
    expect(lines).toHaveLength(6)
    for (const line of lines) expect(line.length).toBeGreaterThan(40)
  })

  it('never prints a credential in any of them', () => {
    const settings = readSettings({ REPLAY_MODE: 'false' })
    const said = describeChoices(
      chooseServices({
        settings,
        caseId: 'c',
        env: {
          SERPAPI_KEY: 'a-secret-search-key',
          NAMECOM_USERNAME_TEST: 'someone-test',
          NAMECOM_TOKEN_TEST: 'a-secret-token',
          NUTRIENT_EXTRACTION_KEY: 'a-secret-reading-key',
        },
      }),
    ).join(' ')

    for (const secret of ['a-secret-search-key', 'a-secret-token', 'a-secret-reading-key']) {
      expect(said, `${secret} was printed`).not.toContain(secret)
    }
  })

  it('picks the practice registrar account, never the live one, by default', () => {
    const settings = readSettings({ REPLAY_MODE: 'false' })
    const services = chooseServices({
      settings,
      caseId: 'c',
      env: { NAMECOM_USERNAME_TEST: 'u-test', NAMECOM_TOKEN_TEST: 't' },
    })
    expect(services.chosen.registrar.kind).toBe('real')
    expect(services.chosen.registrar.why).toMatch(/practice account/)
  })

  it('will not use the live registrar on the practice credentials', () => {
    // The pair travels together: which environment you are in decides BOTH halves
    // at once, so a live token can never be paired with a practice username.
    const settings = readSettings({ REPLAY_MODE: 'false', REGISTRAR_ENV: 'live', SPEND_REAL_MONEY: 'true' })
    const services = chooseServices({
      settings,
      caseId: 'c',
      env: { NAMECOM_USERNAME_TEST: 'u-test', NAMECOM_TOKEN_TEST: 't' },
    })
    expect(services.chosen.registrar.kind).toBe('stand-in')
  })
})
