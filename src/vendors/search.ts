/**
 * Finding out whether somebody is already using the name.
 *
 * TWO COMPANIES, ONE QUESTION, AND THE MODEL IS NEVER TOLD WHICH ANSWERED
 *
 * Two search services answer the same question. The second takes over when the
 * first is unavailable or out of allowance. **The reply handed back names no
 * vendor.** Which one answered goes into the record, where a person can see it.
 *
 * If the model could see which service replied it would start reasoning about the
 * services rather than about the business — asking to retry "with the other one",
 * or treating results as more or less trustworthy by source. It has no basis for
 * either judgement. Hiding the fallback from the model is sensible; hiding it from
 * the record would not be.
 *
 * THE NUMBER THAT DECIDES THE DESIGN
 *
 * 250 searches a month, 50 an hour, and a single run uses eight to twelve. That is
 * about twenty complete runs a month for the whole project.
 *
 * So results are cached by the exact query text, and that cache existed from the
 * first commit rather than being added later as a tidy-up. Forty runs while
 * building, at several searches each, would exhaust a month's allowance before a
 * single repeated test.
 *
 * WHAT THIS DELIBERATELY DOES NOT CLAIM
 *
 * A web search is not a trademark search. It finds out whether somebody appears to
 * be trading under a name. It does not clear a name, and nothing built on it may
 * say that it does. What it produces goes to a person to read, and the words used
 * about it everywhere in this project are "already in use", never "available".
 */

import { ask, describeReply, type Fetcher, type Reply } from './http.js'
import type { SearchAnswer, SearchHit, SearchService } from '../tools/services.js'

export const SERPAPI_HOST = 'https://serpapi.com'
export const TAVILY_HOST = 'https://api.tavily.com'

/** How many results are worth reading. More than this is noise a person scrolls past. */
export const HITS_WANTED = 8

export class NoSearchService extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'NoSearchService'
  }
}

export interface SearchOptions {
  readonly serpapiKey?: string
  readonly tavilyKey?: string
  /**
   * True on the day it is filmed.
   *
   * Their cache lasts an hour and a cached result does not count against the
   * allowance, which is exactly right while building and a lie about freshness in
   * a demonstration. So a demonstration always forces a fresh call.
   */
  readonly freshOnly?: boolean
  readonly fetcher?: Fetcher
  readonly serpapiBaseUrl?: string
  readonly tavilyBaseUrl?: string
}

interface SerpResult {
  readonly title?: string
  readonly link?: string
  readonly snippet?: string
}

interface TavilyResult {
  readonly title?: string
  readonly url?: string
  readonly content?: string
}

/** Turn one service's rows into the shape everything above this file knows. */
function hitsFromSerpapi(body: unknown): readonly SearchHit[] {
  const bag = (body ?? {}) as Record<string, unknown>
  const rows = Array.isArray(bag['organic_results']) ? (bag['organic_results'] as SerpResult[]) : []

  return rows.slice(0, HITS_WANTED).map((row) => ({
    title: row.title ?? '',
    url: row.link ?? '',
    snippet: row.snippet ?? '',
  }))
}

function hitsFromTavily(body: unknown): readonly SearchHit[] {
  const bag = (body ?? {}) as Record<string, unknown>
  const rows = Array.isArray(bag['results']) ? (bag['results'] as TavilyResult[]) : []

  return rows.slice(0, HITS_WANTED).map((row) => ({
    title: row.title ?? '',
    url: row.url ?? '',
    snippet: row.content ?? '',
  }))
}

/**
 * Search, with one service behind another.
 *
 * The order is not arbitrary. The first is the one whose results carry the local
 * business and map listings the trademark question actually turns on — US
 * common-law rights are bounded to the territory of actual use, so *where* somebody
 * is trading is the legal test rather than decoration. The second answers the plain
 * web question and is there so that one company being down does not stop a run.
 */
export function webSearch(options: SearchOptions): SearchService {
  const serpapi = (options.serpapiKey ?? '').trim()
  const tavily = (options.tavilyKey ?? '').trim()

  if (serpapi === '' && tavily === '') {
    throw new NoSearchService(
      'Neither SERPAPI_KEY nor TAVILY_API_KEY is set, so there is no search service ' +
        'to build. That is the normal state of a fresh clone: every stage runs from ' +
        'saved answers instead.',
    )
  }

/**
 * How long a search is given to come back, in milliseconds.
 *
 * Every other call in this project waits twenty seconds. A search waits four and a
 * half times as long, and the reason is measured rather than guessed.
 *
 * Charter asks for a search that is not served from the search company's own store
 * of recent answers, because a demonstration should be a real call all the way to
 * the far end. That request is slow in a very particular way: measured repeatedly
 * on 1 September 2026, the same query came back in 0.7 seconds from their store and
 * in 30.0 seconds without it. Not thirty-ish. Thirty, to within a hundredth of a
 * second, every time — which is the shape of a limit inside their own system rather
 * than of a slow network.
 *
 * Twenty seconds therefore failed every single time, and it failed as a timeout,
 * which reads like the network being down. Two whole runs of this project stopped
 * on it before anybody timed the two calls side by side.
 *
 * Ninety seconds leaves room for that thirty to be worse under load, without ever
 * letting a genuinely dead connection hang a run for long. Waiting is cheap. A run
 * that stops on the second of eight steps is not.
 */
const SEARCH_PATIENCE = 90_000

  const trySerpapi = async (query: string): Promise<Reply | undefined> => {
    if (serpapi === '') return undefined
    const base = options.serpapiBaseUrl ?? SERPAPI_HOST
    const url =
      `${base}/search.json?engine=google&q=${encodeURIComponent(query)}` +
      `&num=${HITS_WANTED}&api_key=${encodeURIComponent(serpapi)}` +
      (options.freshOnly === true ? '&no_cache=true' : '')
    return ask(url, {
      // Longer than the twenty seconds everything else waits. A search goes out to
      // Google and comes back through a middleman, and on the first real run of
      // this project one of them took longer than twenty seconds and the whole run
      // stopped over it. Waiting is cheap; a stopped run is not.
      patience: SEARCH_PATIENCE,
      ...(options.fetcher === undefined ? {} : { fetcher: options.fetcher }),
    })
  }

  const tryTavily = async (query: string): Promise<Reply | undefined> => {
    if (tavily === '') return undefined
    const base = options.tavilyBaseUrl ?? TAVILY_HOST
    return ask(`${base}/search`, {
      method: 'POST',
      headers: { authorization: `Bearer ${tavily}` },
      body: { query, max_results: HITS_WANTED },
      patience: SEARCH_PATIENCE,
      ...(options.fetcher === undefined ? {} : { fetcher: options.fetcher }),
    })
  }

  return {
    async search(query: string): Promise<SearchAnswer> {
      const tried: string[] = []

      const first = await trySerpapi(query)
      if (first !== undefined) {
        if (first.kind === 'ok') {
          return { hits: hitsFromSerpapi(first.body), answeredBy: 'serpapi' }
        }
        tried.push(`serpapi ${describeReply(first)}`)
      }

      const second = await tryTavily(query)
      if (second !== undefined) {
        if (second.kind === 'ok') {
          return { hits: hitsFromTavily(second.body), answeredBy: 'tavily' }
        }
        tried.push(`tavily ${describeReply(second)}`)
      }

      // Nothing answered. This is an error rather than an empty result on purpose:
      // "nobody is using this name" and "nobody could be asked" are different
      // facts, and only one of them is a reason to go ahead with a name.
      throw new NoSearchService(
        `No search service answered "${query}". ${tried.join('; ')}. An empty result ` +
          `is not returned here, because "nobody is using this name" and "nobody ` +
          `could be asked" are different facts and only one of them is a reason to ` +
          `go ahead.`,
      )
    },
  }
}

/**
 * The searches Charter runs for one name, and the reason each one is a real test.
 *
 * A single generic search is what most people do. Each of these tests something
 * different, and each has a reason a lawyer would recognise.
 *
 * Written here rather than chosen by the model, because which questions establish
 * whether a name is in use is not a judgement call and must not vary between runs.
 */
export function searchesFor(name: string, place: string): readonly { readonly query: string; readonly tests: string }[] {
  return [
    {
      query: `"${name}" trademark`,
      tests: 'a registered mark. The obvious one, and the least interesting',
    },
    {
      query: `"${name}" business ${place}`,
      tests:
        'somebody actually trading under the name, and where. United States ' +
        'common-law trademark rights are bounded to the territory of actual use, so ' +
        'where somebody trades is the legal test rather than decoration',
    },
    {
      query: `"${name}" ${place} reviews hours`,
      tests:
        'the same, with signs of a business that is alive. It separates a trading ' +
        'business from a dead listing',
    },
    {
      query: `"${name}" court OR lawsuit OR "v."`,
      tests:
        'litigation mentioning the name. Searching a proposed name against court ' +
        'decisions is precisely what a trademark attorney does',
    },
  ]
}
