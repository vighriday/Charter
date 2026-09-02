/**
 * The one sign-in a person has to do themselves, checked without doing it.
 *
 * WHAT IS BEING CHECKED
 *
 * Doctavian's demonstration service wants a bearer token, and a bearer token only
 * exists after a real person signs in with a Microsoft account in a browser. A
 * program cannot do that, and should not be able to. What a program CAN do is
 * build the address correctly, protect the one-time code properly, and read the
 * answer back without guessing.
 *
 * Those three are what this file checks, and all three can be checked with no
 * account, no network and no browser.
 *
 * THE ONE THAT MATTERS MOST
 *
 * The secret. The sign-in sends only a fingerprint of a secret this machine
 * invented, and redeems the code by producing the secret itself. Get that wrong
 * and a code stolen out of the address bar is enough to become us. So the test
 * below recomputes the fingerprint the same way the standard says to, and fails
 * if the two ever stop matching.
 */

import { describe, expect, it } from 'vitest'
import { createHash } from 'node:crypto'

import {
  PORT,
  PROVIDER,
  codeIn,
  isTheirServiceUp,
  makeSecret,
  signInAddress,
} from '../src/vendors/doctavian-signin.js'

const BASE = 'https://demo.api.doctavian.example.invalid'
const CLIENT = '11e71170-0000-0000-0000-000000000000'
const SCOPE = 'api://a-permission/.default offline_access'

describe('the secret that makes a stolen code useless', () => {
  it('sends a fingerprint, never the secret', () => {
    const { secret, fingerprint } = makeSecret()
    expect(fingerprint).not.toBe(secret)
    expect(createHash('sha256').update(secret).digest('base64url')).toBe(fingerprint)
  })

  it('is different every time, so one sign-in tells nothing about the next', () => {
    expect(makeSecret().secret).not.toBe(makeSecret().secret)
  })

  it('is written in a form that survives being put in a web address', () => {
    // base64url, not ordinary base64. The ordinary kind contains + / and =, all
    // three of which mean something else in an address and get mangled quietly.
    const { secret, fingerprint } = makeSecret()
    expect(secret).toMatch(/^[A-Za-z0-9_-]+$/)
    expect(fingerprint).toMatch(/^[A-Za-z0-9_-]+$/)
  })
})

describe('the address a person is sent to', () => {
  const address = signInAddress({
    baseUrl: BASE,
    clientId: CLIENT,
    scope: SCOPE,
    fingerprint: 'a-fingerprint',
    comingBackTo: `http://localhost:${PORT}/callback`,
  })
  const url = new URL(address)

  it('goes through their proxy, not straight to Microsoft', () => {
    // Their proxy is what knows which account has access. Going straight to
    // Microsoft with the same details gets a token for the wrong audience.
    expect(url.host).toBe('demo.api.doctavian.example.invalid')
    expect(url.pathname).toBe(`/public/v1/auth/${PROVIDER}/authorize`)
  })

  it('asks for the long-lived token, which is the whole point', () => {
    // Without offline_access there is no refresh token, so the sign-in would have
    // to be repeated every hour and could never be used in a demonstration.
    expect(url.searchParams.get('scope')).toContain('offline_access')
  })

  it('names the fingerprint and the method, because one without the other is ignored', () => {
    expect(url.searchParams.get('code_challenge')).toBe('a-fingerprint')
    expect(url.searchParams.get('code_challenge_method')).toBe('S256')
  })

  it('asks to come back to this machine', () => {
    expect(url.searchParams.get('redirect_uri')).toBe(`http://localhost:${PORT}/callback`)
  })
})

describe('asking whether their service is up, before opening a browser at it', () => {
  // Their demonstration service goes down for minutes at a time. Without this
  // check the first thing a person sees is a browser tab full of raw error text
  // saying GATEWAY_TIMEOUT, which reads as something they did wrong.
  const answering = (status: number, body = '') =>
    (async () => new Response(body, { status })) as unknown as typeof fetch

  it('counts a redirect as up, because that is what a working sign-in does', async () => {
    expect((await isTheirServiceUp('https://x.invalid', answering(302))).up).toBe(true)
  })

  it('counts their gateway timing out as down, and keeps what it said', async () => {
    const asked = await isTheirServiceUp(
      'https://x.invalid',
      answering(504, '{"code":"GATEWAY_TIMEOUT"}'),
    )
    expect(asked.up).toBe(false)
    expect(asked.said).toContain('GATEWAY_TIMEOUT')
  })

  it('counts a page that is not a redirect as down', async () => {
    // A 200 here would mean it answered with something other than a sign-in,
    // which is not a sign-in service working.
    expect((await isTheirServiceUp('https://x.invalid', answering(200))).up).toBe(false)
  })

  it('says what went wrong rather than throwing when nothing answered at all', async () => {
    const nothing = (async () => {
      throw new Error('connection refused')
    }) as unknown as typeof fetch
    const asked = await isTheirServiceUp('https://x.invalid', nothing)
    expect(asked.up).toBe(false)
    expect(asked.said).toContain('connection refused')
  })
})

describe('reading the code the browser came back with', () => {
  it('finds it', () => {
    expect(codeIn('/callback?code=abc123&state=charter')).toBe('abc123')
  })

  it('gives back nothing rather than something wrong', () => {
    expect(codeIn('/callback?error=access_denied')).toBeNull()
    expect(codeIn('/callback')).toBeNull()
    expect(codeIn('')).toBeNull()
  })
})
