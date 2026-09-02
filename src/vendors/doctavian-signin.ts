/**
 * Getting the one thing Doctavian cannot issue with a key: a token that says who
 * is calling.
 *
 * WHAT THIS IS FOR
 *
 * Doctavian's demonstration service wants two things on every call. The API key
 * says which product and which environment. A bearer token says which person. The
 * key arrives by email. The token does not: it only exists after a real human
 * signs in with a Microsoft account in a browser, which is a thing no program can
 * do on its own and no program should be able to.
 *
 * Their own Postman collection solves this by making you install Postman. This
 * file does the same sign-in without it, in about thirty seconds, and prints the
 * lines to paste into the settings file.
 *
 *     npm run doctavian:signin
 *
 * HOW IT WORKS, IN ORDER
 *
 *   1. It invents a secret, and sends only a fingerprint of that secret to the
 *      sign-in page. This is the standard protection against somebody stealing
 *      the code out of the address bar: the code is worthless without the secret,
 *      and the secret never leaves this machine.
 *   2. It starts a tiny web server on this machine, on one port, that answers
 *      exactly one request and then stops.
 *   3. It opens the browser at Doctavian's sign-in address.
 *   4. A person signs in. Doctavian sends the browser back to that tiny server
 *      with a one-time code in the address.
 *   5. It trades the code and the secret for two tokens: a short-lived one for
 *      calling the service, and a long-lived one for getting more short-lived
 *      ones without signing in again.
 *   6. It checks the short-lived one really works, by asking the service for a
 *      list of documents, and prints what to save.
 *
 * WHY THE LONG-LIVED ONE IS THE ONE WE KEEP
 *
 * The short-lived token stops working within the hour, which is fine for a
 * terminal and useless for a demonstration somebody might run tomorrow. The
 * long-lived one is what `offline_access` in the request is asking for, and it is
 * the reason a person only ever has to do this once.
 *
 * WHY MICROSOFT AND NOT GOOGLE
 *
 * Both are offered. Their proxy rewrites the requested permissions before passing
 * them to Google, in a way that turns Doctavian's own permission name into a
 * Google web address that does not exist, and Google refuses it. Microsoft is
 * passed through untouched. Choosing the door that opens is the whole of our
 * response to that.
 *
 * NOTHING IS SENT ANYWHERE ELSE
 *
 * No document, no business, no person's details. One sign-in, and the tokens
 * printed on this machine's own screen.
 */

import { createHash, randomBytes } from 'node:crypto'
import { createServer } from 'node:http'
import { spawn } from 'node:child_process'
import { pathToFileURL } from 'node:url'

import { loadEnvFile } from '../settings.js'
import { DEMO_HOST } from './doctavian.js'

/**
 * The one this project uses. See the note above: the other one is passed through
 * their proxy in a way the other company refuses.
 */
export const PROVIDER = 'microsoft'

/** The port the browser is sent back to. High, and unlikely to be in use. */
export const PORT = 8788

/** How long a person gets to sign in before this gives up and says so. */
const PATIENCE = 5 * 60_000

/**
 * The secret, and the fingerprint of it that is safe to send.
 *
 * The fingerprint is a SHA-256 of the secret, written in the address-safe form of
 * base64. This is the part of the sign-in that makes an intercepted code useless:
 * whoever redeems the code must also produce the secret that matches, and the
 * secret was never sent anywhere.
 */
export function makeSecret(bytes: Uint8Array = randomBytes(32)): {
  readonly secret: string
  readonly fingerprint: string
} {
  const secret = Buffer.from(bytes).toString('base64url')
  const fingerprint = createHash('sha256').update(secret).digest('base64url')
  return { secret, fingerprint }
}

/** Where a person is sent to sign in. */
export function signInAddress(input: {
  readonly baseUrl: string
  readonly clientId: string
  readonly scope: string
  readonly fingerprint: string
  readonly comingBackTo: string
}): string {
  const url = new URL(`${input.baseUrl}/public/v1/auth/${PROVIDER}/authorize`)
  url.searchParams.set('client_id', input.clientId)
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('redirect_uri', input.comingBackTo)
  url.searchParams.set('scope', input.scope)
  url.searchParams.set('code_challenge', input.fingerprint)
  url.searchParams.set('code_challenge_method', 'S256')
  url.searchParams.set('state', 'charter')
  return url.toString()
}

/** The one-time code out of the address the browser came back with, or null. */
export function codeIn(address: string): string | null {
  try {
    return new URL(address, `http://localhost:${PORT}`).searchParams.get('code')
  } catch {
    return null
  }
}

/** What a sign-in gives back. */
export interface Tokens {
  /** Works for about an hour. Used for calling the service right now. */
  readonly forNow: string
  /** Works for weeks. Used to get more of the first kind, without a person. */
  readonly forLater: string | null
  /** Everything they said, kept so an unexpected shape is visible rather than lost. */
  readonly said: Readonly<Record<string, unknown>>
}

/** What the browser is shown after it comes back. Plain, and it says to close. */
const DONE_PAGE =
  '<!doctype html><meta charset="utf-8"><title>Signed in</title>' +
  '<body style="font:16px/1.6 system-ui;margin:3rem auto;max-width:32rem">' +
  '<h1 style="font-size:1.2rem">Signed in.</h1>' +
  '<p>Charter has the token. You can close this tab and go back to the terminal.</p>' +
  '<p style="color:#666">Nothing was sent anywhere. No document, no business, ' +
  'no personal details.</p>'

/** Wait for the browser to come back, and give back the one-time code. */
export function waitForTheBrowser(): Promise<string> {
  return new Promise((resolve, reject) => {
    const server = createServer((request, response) => {
      const code = codeIn(request.url ?? '')
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
      response.end(
        code === null
          ? '<!doctype html><meta charset="utf-8"><p>No code in that address.'
          : DONE_PAGE,
      )
      server.close()
      if (code === null) reject(new Error('the browser came back without a code'))
      else resolve(code)
    })

    server.on('error', (error) => reject(error))
    server.listen(PORT)

    setTimeout(() => {
      server.close()
      reject(new Error(`nobody signed in within ${Math.round(PATIENCE / 60_000)} minutes`))
    }, PATIENCE).unref()
  })
}

/** Trade the one-time code and the secret for tokens. */
export async function tradeCodeForTokens(input: {
  readonly baseUrl: string
  readonly clientId: string
  readonly code: string
  readonly secret: string
  readonly comingBackTo: string
}): Promise<Tokens> {
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code: input.code,
    client_id: input.clientId,
    code_verifier: input.secret,
    redirect_uri: input.comingBackTo,
  })

  const response = await fetch(`${input.baseUrl}/public/v1/auth/${PROVIDER}/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
    signal: AbortSignal.timeout(60_000),
  })

  const text = await response.text()
  let said: Record<string, unknown> = {}
  try {
    said = JSON.parse(text) as Record<string, unknown>
  } catch {
    throw new Error(
      `they answered ${response.status} with something that is not JSON: ${text.slice(0, 300)}`,
    )
  }

  const forNow = typeof said['access_token'] === 'string' ? said['access_token'] : ''
  if (forNow === '') {
    throw new Error(`they answered ${response.status} without a token: ${text.slice(0, 300)}`)
  }

  return {
    forNow,
    forLater: typeof said['refresh_token'] === 'string' ? said['refresh_token'] : null,
    said,
  }
}

function say(line = ''): void {
  process.stdout.write(`${line}\n`)
}

/** Open the browser, on whichever kind of machine this is. */
function openTheBrowser(address: string): void {
  const [command, args]: [string, string[]] =
    process.platform === 'win32'
      ? ['cmd', ['/c', 'start', '', address]]
      : process.platform === 'darwin'
        ? ['open', [address]]
        : ['xdg-open', [address]]
  try {
    spawn(command, args, { stdio: 'ignore', detached: true }).unref()
  } catch {
    // Nothing to do. The address is printed above either way, and a person can
    // paste it. Failing to open a browser is not a reason to fail the sign-in.
  }
}

async function main(): Promise<void> {
  loadEnvFile()

  const baseUrl = (process.env['DOCTAVIAN_BASE_URL'] ?? DEMO_HOST).trim()
  const clientId = (process.env['DOCTAVIAN_OAUTH_CLIENT_ID'] ?? '').trim()
  const scope = (process.env['DOCTAVIAN_OAUTH_SCOPE'] ?? '').trim()
  const apiKey = (process.env['DOCTAVIAN_API_KEY'] ?? '').trim()

  if (clientId === '' || scope === '') {
    say('DOCTAVIAN_OAUTH_CLIENT_ID and DOCTAVIAN_OAUTH_SCOPE must both be set.')
    say('Both are in the Postman collection Doctavian sent. Nothing was sent anywhere.')
    process.exitCode = 1
    return
  }

  const comingBackTo = `http://localhost:${PORT}/callback`
  const { secret, fingerprint } = makeSecret()
  const address = signInAddress({ baseUrl, clientId, scope, fingerprint, comingBackTo })

  say('Doctavian needs a person to sign in once. This does that, and nothing else.')
  say()
  say('Opening your browser. If it does not open, paste this:')
  say()
  say(`  ${address}`)
  say()
  say('Sign in with the Microsoft account Doctavian gave access to.')
  say('Waiting.')

  const waiting = waitForTheBrowser()
  openTheBrowser(address)

  const code = await waiting
  say()
  say('Came back with a code. Trading it for a token.')

  const tokens = await tradeCodeForTokens({ baseUrl, clientId, code, secret, comingBackTo })

  // Checked against the real service before it is called a success, because a
  // token that parses and a token that works are different facts.
  const check = await fetch(`${baseUrl}/v1/documents/document/list`, {
    headers: { 'x-api-key': apiKey, authorization: `Bearer ${tokens.forNow}` },
    signal: AbortSignal.timeout(60_000),
  })

  say()
  say(
    check.ok
      ? `The service accepted it: /v1/documents/document/list answered ${check.status}.`
      : `The token arrived but the service answered ${check.status}. Printing it anyway, ` +
          'because the token is real and the refusal may be about the key or the account.',
  )
  say()

  if (tokens.forLater === null) {
    say('They gave back no long-lived token, only the short-lived one. It stops')
    say('working within the hour, so this sign-in will have to be repeated.')
    say()
    say(`DOCTAVIAN_ACCESS_TOKEN=${tokens.forNow}`)
  } else {
    say('Paste these two lines into .env, replacing what is there:')
    say()
    say(`DOCTAVIAN_REFRESH_TOKEN=${tokens.forLater}`)
    say(`DOCTAVIAN_ACCESS_TOKEN=${tokens.forNow}`)
  }

  say()
  say('Then: npm run services:live')
}

// Only when somebody typed the command. The pieces above are checked by a test
// that imports this file, and a test importing it must not open a browser.
if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) await main()
