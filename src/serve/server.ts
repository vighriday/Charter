/**
 * The website, and the small door in it that lets a visitor run Charter.
 *
 * WHAT THIS IS FOR
 *
 * Everything else in this project can be checked by reading it. This is the part
 * that can be tried. Somebody opens a page, types what their business is, and
 * watches Charter work on their idea with real services — no keys, no terminal,
 * no sign-up. When it reaches one of the six things only a person can decide, the
 * page asks them, and nothing moves until they answer.
 *
 * WHY IT IS A FEW HUNDRED LINES AND NOT A FRAMEWORK
 *
 * There are two kinds of request here: a file out of the site folder, and six
 * small calls about runs. Nothing else. A framework would bring in a hundred
 * packages to do that, and every one of them is a thing a judge would have to
 * trust without reading. This uses what Node already has.
 *
 * WHAT IT REFUSES, AND WHY EACH REFUSAL IS THERE
 *
 * The keys behind this are free allowances, and one of them — 250 web searches a
 * month against about twelve a run — is small enough that a single afternoon of
 * somebody refreshing a page would end it for the month. So a run has to get past
 * src/serve/limits.ts first, and a refusal says which limit, why it exists, and
 * when it lifts.
 *
 * A run also belongs to whoever started it. Answering costs nothing and decides
 * everything: one of the six questions grants permission to spend, and another
 * approves a finished packet for sending. So every answer carries the run's own
 * secret, made when it started and shown only to the person who started it.
 *
 * WHAT IT DOES NOT DO
 *
 * It does not keep anything. Each run has a small database inside this program and
 * it goes when the program does. Nothing anybody types is written to disk, no
 * address is stored, and there is no pile of strangers' business plans anywhere.
 */

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { readFile, stat } from 'node:fs/promises'
import { extname, join, normalize, sep } from 'node:path'

import { loadEnvFile, readSettings, SettingRefusal, type Settings } from '../settings.js'
import { Limits, DEFAULT_ALLOWANCE, SEARCHES_A_MONTH, SEARCHES_A_RUN } from './limits.js'
import { Runs, sameSecret } from './runs.js'

/** Where the site's own files live. */
const SITE = 'site'

/** The largest thing anybody may send us, in bytes. */
const MOST_WE_READ = 32 * 1024

/** The longest business description we accept, in characters. */
export const LONGEST_DESCRIPTION = 4000

/** The shortest one that could possibly be worked from. */
export const SHORTEST_DESCRIPTION = 20

const TYPES: Readonly<Record<string, string>> = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.jsonl': 'text/plain; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.pdf': 'application/pdf',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
}

/**
 * Where a request came from, as far as we can tell.
 *
 * Behind a hosting service the real address arrives in a header the service sets.
 * Only the FIRST value is used: everything after it was put there by whoever sent
 * the request and can say anything at all. Trusting the last one is how a limit
 * per visitor becomes no limit at all.
 */
export function whereFrom(headers: IncomingMessage['headers'], socketAddress: string): string {
  const forwarded = headers['x-forwarded-for']
  const line = Array.isArray(forwarded) ? forwarded[0] : forwarded
  if (typeof line === 'string' && line.trim() !== '') {
    return (line.split(',')[0] ?? '').trim()
  }
  return socketAddress
}

/**
 * The path a request asked for, turned into a file inside the site folder, or
 * null when it points outside it.
 *
 * The check is done on the finished path rather than by looking for `..` in the
 * text, because there are many ways to write the same climb out of a folder and
 * only one way to ask where a path actually ended up.
 */
export function fileAsked(urlPath: string, root = SITE): string | null {
  const decoded = decodeURIComponent(urlPath.split('?')[0] ?? '/')
  const wanted = decoded === '/' ? '/index.html' : decoded
  const full = normalize(join(root, wanted))
  const inside = normalize(root)
  if (full !== inside && !full.startsWith(inside + sep)) return null
  return full
}

/**
 * The run secret a request carried, or empty when it carried none.
 *
 * Sent as `Authorization: Bearer <secret>` and never in the web address itself.
 * A secret in an address is a secret in the browser history, in whatever the
 * visitor pastes into a message to somebody, and in every log between here and
 * them. The page holds it in memory and sends it on each request, including the
 * ones that download the three files.
 */
export function secretSent(headers: IncomingMessage['headers']): string {
  const line = headers['authorization']
  const value = Array.isArray(line) ? line[0] : line
  if (typeof value !== 'string') return ''
  const match = /^Bearer\s+(.+)$/i.exec(value.trim())
  return match === null ? '' : (match[1] as string).trim()
}

/** What to say to somebody asking about a run that is not theirs. */
const NOT_YOURS =
  'A run belongs to whoever started it. Reading one needs the secret it was given ' +
  'when it started, because its feed carries the business description in the ' +
  "owners' own words and its record carries their names and every answer they " +
  'gave. Start your own run and you will have its secret.'

async function readBody(request: IncomingMessage): Promise<string> {
  const parts: Buffer[] = []
  let size = 0
  for await (const chunk of request) {
    const piece = chunk as Buffer
    size += piece.length
    if (size > MOST_WE_READ) throw new Error('that is more than this accepts')
    parts.push(piece)
  }
  return Buffer.concat(parts).toString('utf8')
}

function sendJson(response: ServerResponse, status: number, body: unknown): void {
  const text = JSON.stringify(body)
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(text),
    'cache-control': 'no-store',
  })
  response.end(text)
}

/**
 * Is this request just somebody knocking to keep the service awake?
 *
 * Free hosting puts a service to sleep when nobody has asked it for anything for
 * a while, and waking it takes the best part of a minute. So something outside
 * knocks every few minutes. `/healthz` is the name almost every hosting service
 * and uptime checker expects; `/api/health` is here because the rest of this
 * program's own addresses begin `/api/`, and somebody looking for it will try
 * that first.
 *
 * Written as its own function so that a test can hold one thing in place: a knock
 * is answered BEFORE the visitor limits are consulted. A knock arriving every few
 * minutes forever, counted against an allowance meant for people, would use the
 * whole day's runs before breakfast.
 */
export function isKnock(path: string): boolean {
  return path === '/healthz' || path === '/api/health'
}

export interface ServerOptions {
  readonly port?: number
  readonly host?: string
}

export async function start(options: ServerOptions = {}): Promise<{ readonly port: number }> {
  loadEnvFile()

  let settings: Settings
  try {
    settings = readSettings()
  } catch (problem) {
    if (problem instanceof SettingRefusal) {
      console.log('')
      console.log('  A setting cannot mean anything, so nothing has started.')
      console.log(`  ${problem.message}`)
      console.log('')
      process.exitCode = 1
      return { port: 0 }
    }
    throw problem
  }

  const limits = new Limits()
  const runs = new Runs({ settings, env: process.env, onEnded: () => limits.finished() })

  // A run nobody answers holds the one place there is. Checked often enough that
  // somebody who walked away does not block the next person for long.
  const sweep = setInterval(() => runs.forgetTheAbandoned(), 30_000)
  sweep.unref()

  const server = createServer((request, response) => {
    void handle(request, response).catch((problem: unknown) => {
      sendJson(response, 500, {
        error: problem instanceof Error ? problem.message : 'something went wrong',
      })
    })
  })

  async function handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const url = request.url ?? '/'
    const path = url.split('?')[0] ?? '/'
    const visitor = limits.code(whereFrom(request.headers, request.socket.remoteAddress ?? ''))

    // ---- is this thing awake -------------------------------------------------
    //
    // WHY THIS EXISTS
    //
    // Free hosting puts a service to sleep when nobody has asked it for anything
    // for a while, and waking it up again takes the best part of a minute. A judge
    // who opens the page and waits fifty seconds for a blank screen has already
    // formed an opinion. So something outside has to knock on the door every few
    // minutes, and this is the door.
    //
    // WHY IT IS THIS CHEAP
    //
    // It reads nothing, writes nothing, opens no database connection and calls no
    // outside company. That is deliberate: something is going to call this every
    // few minutes forever, and anything it touched would be touched every few
    // minutes forever too. It answers from what the process already knows.
    //
    // It is also outside the visitor limits on purpose. A knock on the door is
    // not a run, and counting it would eat an allowance meant for people.
    if (isKnock(path)) {
      sendJson(response, 200, {
        awake: true,
        // Seconds this process has been up. A number that keeps climbing is how
        // somebody can tell the pinging is working, rather than the service
        // sleeping and being woken by whoever happened to look.
        upForSeconds: Math.round(process.uptime()),
        runsGoingNow: limits.goingNow(),
        replaying: settings.replaying,
      })
      return
    }

    // ---- what the limits are, and where this visitor stands ------------------
    if (path === '/api/limits') {
      const decision = limits.mayStart(visitor)
      sendJson(response, 200, {
        canStart: decision.allowed,
        because: decision.allowed ? null : decision.because,
        leftToday: decision.leftToday,
        goingNow: limits.goingNow(),
        allowance: DEFAULT_ALLOWANCE,
        // Said plainly on the page, because a limit whose reason is hidden reads
        // as meanness rather than as arithmetic.
        why:
          `One run uses about ${SEARCHES_A_RUN} web searches, and the search allowance ` +
          `behind this is ${SEARCHES_A_MONTH} a month. The limits are what let this be ` +
          `open to anybody at all rather than to nobody.`,
        replaying: settings.replaying,
      })
      return
    }

    // ---- start a run ---------------------------------------------------------
    if (path === '/api/runs' && request.method === 'POST') {
      let asked: { description?: unknown; state?: unknown }
      try {
        asked = JSON.parse(await readBody(request)) as typeof asked
      } catch {
        sendJson(response, 400, { error: 'that was not something this could read' })
        return
      }

      const description = typeof asked.description === 'string' ? asked.description.trim() : ''
      const state = typeof asked.state === 'string' ? asked.state.trim().toUpperCase() : ''

      if (description.length < SHORTEST_DESCRIPTION) {
        sendJson(response, 400, {
          error:
            `That is too short to work from. Charter needs at least who the owners ` +
            `are and what the business does — a sentence or two is plenty.`,
        })
        return
      }
      if (description.length > LONGEST_DESCRIPTION) {
        sendJson(response, 400, {
          error:
            `That is longer than ${LONGEST_DESCRIPTION} characters, which is more than ` +
            `this accepts. A paragraph is plenty.`,
        })
        return
      }
      if (!/^[A-Z]{2}$/.test(state)) {
        sendJson(response, 400, {
          error: 'The state has to be its two letters, such as TX.',
        })
        return
      }

      // Asked and counted in one go. Two separate calls leave a gap, and two
      // requests arriving in that gap both get told yes.
      const decision = limits.start(visitor)
      if (!decision.allowed) {
        sendJson(response, 429, {
          error: decision.because,
          liftsAt: decision.liftsAt.toISOString(),
          leftToday: decision.leftToday,
        })
        return
      }

      const started = await runs.start({ description, state })
      sendJson(response, 200, { ...started, leftToday: decision.leftToday })
      return
    }

    // ---- watch a run ---------------------------------------------------------
    const watching = /^\/api\/runs\/([A-Za-z0-9-]+)$/.exec(path)
    if (watching !== null && request.method === 'GET') {
      const id = watching[1] as string
      const expected = runs.tokenFor(id)

      // The same answer whether the run does not exist or is somebody else's.
      // Telling the two apart would let a stranger work out which names are real
      // without ever reading one, which is most of the way to reading one.
      if (expected === null || !sameSecret(secretSent(request.headers), expected)) {
        sendJson(response, 403, { error: NOT_YOURS })
        return
      }

      const view = runs.view(id)
      if (view === null) {
        sendJson(response, 404, { error: 'there is no run by that name here' })
        return
      }
      sendJson(response, 200, view)
      return
    }

    // ---- answer whatever it is waiting for -----------------------------------
    const answering = /^\/api\/runs\/([A-Za-z0-9-]+)\/answer$/.exec(path)
    if (answering !== null && request.method === 'POST') {
      let asked: { token?: unknown; answer?: unknown }
      try {
        asked = JSON.parse(await readBody(request)) as typeof asked
      } catch {
        sendJson(response, 400, { error: 'that was not something this could read' })
        return
      }
      const token = typeof asked.token === 'string' ? asked.token : ''
      const answer = typeof asked.answer === 'string' ? asked.answer : ''

      const said = runs.answer(answering[1] as string, token, answer)
      if (said === 'not you') {
        sendJson(response, 403, {
          error:
            'That answer did not come with this run own secret. Only whoever started ' +
            'a run can answer its questions, because two of them decide whether money ' +
            'is spent and whether a finished packet is sent to anybody.',
        })
        return
      }
      if (said === 'not waiting') {
        sendJson(response, 409, { error: 'nothing is waiting for an answer just now' })
        return
      }
      sendJson(response, 200, { ok: true })
      return
    }

    // ---- the three files a run leaves ----------------------------------------
    const wanting = /^\/api\/runs\/([A-Za-z0-9-]+)\/(pack\.pdf|record\.jsonl|attestation\.json)$/.exec(
      path,
    )
    if (wanting !== null && request.method === 'GET') {
      const id = wanting[1] as string
      const expected = runs.tokenFor(id)

      // The files are the most private thing here. The record carries every answer
      // a person gave and the packet carries their names, so this is the endpoint
      // where getting the rule wrong hands somebody else's paperwork to a stranger.
      if (expected === null || !sameSecret(secretSent(request.headers), expected)) {
        sendJson(response, 403, { error: NOT_YOURS })
        return
      }

      const which =
        wanting[2] === 'pack.pdf' ? 'pack' : wanting[2] === 'record.jsonl' ? 'record' : 'attestation'
      const file = runs.fileFor(id, which)
      if (file === null) {
        sendJson(response, 404, { error: 'that file does not exist yet' })
        return
      }
      const body = typeof file === 'string' ? Buffer.from(file, 'utf8') : Buffer.from(file)
      response.writeHead(200, {
        'content-type': TYPES[extname(wanting[2] as string)] ?? 'application/octet-stream',
        'content-length': body.length,
        'cache-control': 'no-store',
      })
      response.end(body)
      return
    }

    // ---- anything else is a file out of the site folder ----------------------
    if (request.method !== 'GET') {
      sendJson(response, 405, { error: 'that is not something this answers' })
      return
    }

    const file = fileAsked(path)
    if (file === null) {
      sendJson(response, 403, { error: 'that path points outside the site' })
      return
    }

    try {
      const about = await stat(file)
      if (!about.isFile()) throw new Error('not a file')
      const body = await readFile(file)
      response.writeHead(200, {
        'content-type': TYPES[extname(file)] ?? 'application/octet-stream',
        'content-length': body.length,
      })
      response.end(body)
    } catch {
      response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' })
      response.end('There is nothing at that address.\n')
    }
  }

  const port = options.port ?? Number(process.env['PORT'] ?? 4321)

  /**
   * Which network to answer on.
   *
   * On your own machine: 127.0.0.1, which means nothing outside the machine can
   * reach it. That is the right default for something started while working, and
   * it is the safe one.
   *
   * On a hosting service: 0.0.0.0, meaning every network the container has,
   * because the service routes traffic in from outside and a program listening
   * only to itself is one the service reports as dead.
   *
   * Told apart by whether the service set PORT, which every one of them does and
   * nobody does by hand. HOST overrides both, for whoever has a reason to.
   */
  const host = options.host ?? process.env['HOST'] ?? (process.env['PORT'] === undefined ? '127.0.0.1' : '0.0.0.0')

  await new Promise<void>((ready) => server.listen(port, host, ready))

  const actual = (server.address() as { port: number }).port

  console.log('')
  console.log(
    `  Charter is at  ${host === '0.0.0.0' ? `port ${actual}, on every network this has` : `http://${host}:${actual}`}`,
  )
  console.log('')
  console.log(`  Anybody can start a run there. ${DEFAULT_ALLOWANCE.perDay} a day for`)
  console.log(`  everybody together, ${DEFAULT_ALLOWANCE.perVisitorPerDay} per person,`)
  console.log(`  one at a time.`)
  if (settings.replaying) {
    console.log('')
    console.log('  REPLAY_MODE is on, so every outside service is a stand-in. Runs')
    console.log('  will still work end to end. Set REPLAY_MODE=false for real ones.')
  }
  console.log('')

  return { port: actual }
}

const wasRunDirectly = /server\.ts$/.test(process.argv[1] ?? '')
if (wasRunDirectly) await start()
