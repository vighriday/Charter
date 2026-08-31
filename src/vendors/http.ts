/**
 * How Charter talks to an outside company, in one careful place.
 *
 * WHAT THIS IS
 *
 * Every real call to a vendor goes through here. It is small on purpose: a
 * request, a timeout, and a reply turned into something the caller can act on
 * without a try-catch around every use.
 *
 * WHY THE NETWORK IS PASSED IN RATHER THAN REACHED FOR
 *
 * Every client below takes a `fetcher`. In a test that is a function returning a
 * written-out reply, so the whole vendor layer is exercised — the address built,
 * the headers set, the reply read, the failure handled — with **no network, no
 * account, and nothing spent**.
 *
 * That is not only convenient. Charter's free allowances are small enough that a
 * test suite reaching a real service would exhaust a month in an afternoon: the
 * search service allows 250 searches a month and one run uses eight to twelve.
 * A test that quietly makes a real call is a test nobody can afford to run twice.
 *
 * WHY A FAILURE IS A VALUE AND NOT AN EXCEPTION
 *
 * A vendor being down, out of allowance, or refusing a credential are ordinary,
 * expected things that get recorded and reasoned about. They are not faults in
 * this program. So they come back as a result with a `kind`, and the caller
 * decides — which is what lets one search service take over from another, and what
 * keeps the reason in the record rather than in a stack trace.
 *
 * WHAT IT WILL NOT DO
 *
 * It never puts a credential into a message, a log, or an error. Not the first few
 * characters, not the length. A diagnostic that helpfully echoes a key has put that
 * key into terminal scrollback, into any recording of the session, and into
 * whatever collects logs.
 */

/** How the network is reached. Passed in so tests never touch it. */
export type Fetcher = (url: string, init: RequestInit) => Promise<Response>

/** How long to wait for any one answer, in milliseconds. */
export const PATIENCE = 20_000

/** What came back, or what stopped it coming back. */
export type Reply =
  | { readonly kind: 'ok'; readonly status: number; readonly body: unknown }
  | { readonly kind: 'refused'; readonly status: number; readonly detail: string }
  | { readonly kind: 'not-allowed-here'; readonly status: number; readonly detail: string }
  | { readonly kind: 'out-of-allowance'; readonly status: number; readonly detail: string }
  | { readonly kind: 'their-fault'; readonly status: number; readonly detail: string }
  | { readonly kind: 'never-arrived'; readonly detail: string }
  | { readonly kind: 'unreadable'; readonly status: number; readonly detail: string }

/** True when nothing arrived, so nothing at all was learned. */
export function nothingLearned(reply: Reply): boolean {
  return reply.kind === 'never-arrived'
}

/** One line about what happened, safe to print and safe to record. */
export function describeReply(reply: Reply): string {
  switch (reply.kind) {
    case 'ok':
      return `answered (${reply.status})`
    case 'refused':
      return `refused the credential (${reply.status}). This says the credential is not one they know`
    case 'not-allowed-here':
      return `knows the credential and will not accept it for this product (${reply.status})`
    case 'out-of-allowance':
      return `out of allowance (${reply.status}). This does not return until their own limit resets`
    case 'their-fault':
      return `their service returned ${reply.status}, which is a fault on their side`
    case 'never-arrived':
      return `the request never arrived: ${reply.detail}. Nothing was learned about anything`
    case 'unreadable':
      return `answered ${reply.status} with something that is not the shape we expected`
  }
}

export interface AskOptions {
  readonly method?: 'GET' | 'POST' | 'PUT' | 'DELETE'
  readonly headers?: Readonly<Record<string, string>>
  /** Sent as JSON. Leave out for a request with no body. */
  readonly body?: unknown
  readonly fetcher?: Fetcher
  readonly patience?: number
}

/**
 * Ask one service one question, and never throw.
 *
 * The status codes are grouped by what a caller would actually DO about them,
 * rather than by number:
 *
 *   401  the credential is not one they know          → check the credential
 *   403  they know it, and not for this               → a different product's key
 *   429  out of allowance                             → try the other vendor
 *   5xx  their fault                                  → try again, or the other one
 *   4xx  they refused the request itself              → our request is wrong
 *
 * The difference between 401 and 403 is the whole reason `npm run keys:classify`
 * works: 403 means "I know you, but not here", which identifies which product a
 * credential belongs to without processing anything.
 */
export async function ask(url: string, options: AskOptions = {}): Promise<Reply> {
  const fetcher = options.fetcher ?? ((target, init) => fetch(target, init))
  const headers: Record<string, string> = { accept: 'application/json', ...options.headers }

  const init: RequestInit = {
    method: options.method ?? 'GET',
    headers,
    signal: AbortSignal.timeout(options.patience ?? PATIENCE),
  }

  if (options.body !== undefined) {
    headers['content-type'] = 'application/json'
    init.body = JSON.stringify(options.body)
  }

  let response: Response
  try {
    response = await fetcher(url, init)
  } catch (error) {
    // Nothing arrived. Deliberately its own kind, because "we could not ask" and
    // "they said no" are different facts and only one of them says anything about
    // the credential or the question.
    return {
      kind: 'never-arrived',
      detail: error instanceof Error ? error.message : String(error),
    }
  }

  const text = await response.text().catch(() => '')

  if (response.status === 401) {
    return { kind: 'refused', status: 401, detail: shorten(text) }
  }
  if (response.status === 403) {
    return { kind: 'not-allowed-here', status: 403, detail: shorten(text) }
  }
  if (response.status === 429) {
    return { kind: 'out-of-allowance', status: 429, detail: shorten(text) }
  }
  if (response.status >= 500) {
    return { kind: 'their-fault', status: response.status, detail: shorten(text) }
  }
  if (!response.ok) {
    return { kind: 'refused', status: response.status, detail: shorten(text) }
  }

  if (text.trim() === '') return { kind: 'ok', status: response.status, body: null }

  try {
    return { kind: 'ok', status: response.status, body: JSON.parse(text) }
  } catch {
    return {
      kind: 'unreadable',
      status: response.status,
      detail: `expected JSON and got ${shorten(text)}`,
    }
  }
}

/**
 * Cut a vendor's reply down before it goes anywhere.
 *
 * Their error bodies can be long, and a whole HTML error page in a record entry
 * makes the record unreadable for everyone afterwards. The first part is the part
 * that says what went wrong.
 */
function shorten(text: string): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  return flat.length > 300 ? `${flat.slice(0, 300)}…` : flat
}

/**
 * A username and password turned into the header form HTTP calls "basic".
 *
 * Written out rather than using a library, because there is one line of it, and
 * because a reader deciding whether to trust this should be able to see that the
 * credential goes into a header and nowhere else.
 */
export function basicAuth(username: string, password: string): string {
  return `Basic ${Buffer.from(`${username}:${password}`, 'utf8').toString('base64')}`
}
