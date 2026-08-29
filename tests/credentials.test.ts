/**
 * Proving the rules behind `npm run keys:classify`.
 *
 * WHAT IS BEING PROVED HERE, AND WHY IT IS WORTH PROVING
 *
 * Charter holds credentials from outside companies. A credential is a long string
 * of characters that proves to a company that we are allowed to use their service.
 * Two of ours were a guess, and `src/checks/classify.ts` asks the companies
 * directly rather than guessing. That program makes real calls over the network,
 * so it cannot be tested here.
 *
 * The three rules it depends on can be, and they are the whole of its judgement:
 *
 *   1. How to read a reply. A service answers an empty request with a number, and
 *      that number says whether it recognised the credential. Getting this wrong
 *      means classifying a key wrongly, which is worse than not classifying it.
 *
 *   2. How to show a credential without giving it away. This matters more than it
 *      looks. Output from a diagnostic gets pasted into chat messages and pull
 *      requests. A "short preview" that turns out to be most of the key is a leak
 *      that nobody notices, because it looked careful.
 *
 *   3. Which usernames to try, and in what order. name.com has a practice account
 *      and a live account. The practice one costs nothing; the live one spends
 *      real money on real web addresses. If both could match, the practice one
 *      must be found first. The order is not a preference, it is the safety.
 */

import { describe, expect, it } from 'vitest'
import {
  NAMECOM_TEST_HOST,
  NUTRIENT_EXTRACTION_PROBE,
  NUTRIENT_PROCESSOR_PROBE,
  fingerprint,
  firstFilled,
  place,
  receive,
  say,
  usernameCandidates,
} from '../src/checks/credentials.js'

describe('reading what a service said about a credential', () => {
  it('treats 401 as the service not knowing us', () => {
    expect(receive(401, '')).toEqual({ kind: 'unknown to them', status: 401 })
  })

  it('treats 403 as the service knowing us but refusing this product', () => {
    // This is the single most informative answer we can get. It means the key is
    // real and current, and belongs to the company's OTHER product. Nutrient's own
    // client documentation says the processor key answers 403 at the field-reading
    // service, which is exactly this case.
    expect(receive(403, '')).toEqual({ kind: 'known but not allowed', status: 403 })
  })

  it.each([400, 415, 422])(
    'treats %i as the credential being accepted and the request being the problem',
    (status) => {
      // We deliberately send an empty request. A complaint about the request is
      // proof that the credential got past the door, and nothing was processed, so
      // nothing was charged. This is the whole reason the check is free to run.
      expect(receive(status, 'missing required field')).toEqual({ kind: 'accepted', status })
    },
  )

  it('treats a success as accepted too', () => {
    expect(receive(200, 'hello world')).toEqual({ kind: 'accepted', status: 200 })
  })

  it('never guesses at an answer it does not recognise', () => {
    // A 500 is the service being broken, not a statement about our key. Calling
    // that "not accepted" would make us throw away a working credential.
    const result = receive(500, 'gateway exploded')
    expect(result.kind).toBe('unexpected')
    expect(say(result)).toContain('500')
  })

  it('keeps an unexpected body short enough to read', () => {
    const result = receive(503, 'x'.repeat(5000))
    expect(result.kind).toBe('unexpected')
    if (result.kind !== 'unexpected') throw new Error('narrowing')
    expect(result.body.length).toBe(300)
  })

  it('says something plain for every possible reception', () => {
    // If a new kind is ever added and left unhandled, this fails rather than
    // printing "undefined" next to somebody's credential.
    const all = [
      receive(200, ''),
      receive(400, ''),
      receive(401, ''),
      receive(403, ''),
      receive(500, 'broken'),
      { kind: 'could not ask', why: 'network down' } as const,
    ]
    for (const one of all) {
      expect(say(one)).toMatch(/\S/)
      expect(say(one)).not.toContain('undefined')
    }
  })
})

describe('showing a credential without giving it away', () => {
  it('shows the beginning of a long key and no more', () => {
    const key = 'pdf_live_ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789abcdefghij'
    const shown = fingerprint(key)

    expect(shown).toContain('pdf_live_')
    expect(shown).toContain(`(${key.length} characters)`)
    // The part that actually opens the door must not appear.
    expect(shown).not.toContain('ABCDEFGHIJ')
    expect(shown).not.toContain(key)
  })

  it('never shows more than nine characters of a long credential', () => {
    // Invented. Test fixtures never share even the opening characters of a real
    // credential, because a fixture is published and a credential is not.
    const token = 'q4v1n80w2z6k3x7m5p9r0t8j2h6d4b1s3g7f5c9a'
    const shown = fingerprint(token)
    const preview = shown.slice(0, shown.indexOf('...'))

    expect(preview.length).toBeLessThanOrEqual(9)
    expect(token.startsWith(preview)).toBe(true)
  })

  it('shows almost nothing of a short value, because a short value is mostly preview', () => {
    // A twelve-character secret shown nine characters at a time is not redacted at
    // all. Below the cut-off we show two characters, which distinguishes two keys
    // and reveals nothing useful.
    const shown = fingerprint('shortsecret')
    expect(shown).toBe('sh... (11 characters)')
  })

  it('still reports the true length, which is how a truncated paste is spotted', () => {
    // The most common credential mistake is copying part of one. The length is
    // what catches it, so it is reported even though the value is hidden.
    expect(fingerprint('a'.repeat(52))).toContain('(52 characters)')
    expect(fingerprint('a'.repeat(51))).toContain('(51 characters)')
  })
})

describe('choosing which name.com username to try', () => {
  const given = 'someone@example.com'

  it('tries the practice account before anything else', () => {
    const [first] = usernameCandidates(given)
    expect(first).toBe('someone@example.com-test')
  })

  it('puts every practice form ahead of every live form', () => {
    // This ordering is the safety rule. The first username that works is the one
    // reported, and it must never be the live account when a practice one exists.
    const candidates = usernameCandidates(given)
    const lastPractice = candidates.findLastIndex((one) => one.endsWith('-test'))
    const firstLive = candidates.findIndex((one) => !one.endsWith('-test'))

    expect(firstLive).toBeGreaterThan(lastPractice)
  })

  it('also tries the part before the @, because that is often the account name', () => {
    // name.com wants an account name, not an email address. Somebody who signed up
    // as "someone" will have typed their email into the settings file by habit.
    expect(usernameCandidates(given)).toContain('someone-test')
    expect(usernameCandidates(given)).toContain('someone')
  })

  it('does not add -test twice to a username that already has it', () => {
    const candidates = usernameCandidates('reseller123-test')
    expect(candidates).toContain('reseller123-test')
    expect(candidates.some((one) => one.endsWith('-test-test'))).toBe(false)
  })

  it('lists nothing twice', () => {
    const candidates = usernameCandidates('reseller123')
    expect(new Set(candidates).size).toBe(candidates.length)
  })

  it('drops surrounding blank space, which is what a copy and paste leaves behind', () => {
    expect(usernameCandidates('  reseller123  ')).toContain('reseller123')
  })
})

describe('where the check is allowed to send anything at all', () => {
  it('only ever names the name.com practice service', () => {
    // The live service is `api.name.com`. Registering a web address there spends
    // real money and cannot be undone. No diagnostic has any reason to touch it,
    // so its address does not appear in this program.
    expect(NAMECOM_TEST_HOST).toBe('https://api.dev.name.com')
    expect(NAMECOM_TEST_HOST).not.toBe('https://api.name.com')
  })

  it('asks name.com through the current service, never the retired one', () => {
    // name.com's older service lives under /v4/ and is being switched off this
    // year. A separate test fails the build if /v4/ appears anywhere in the
    // project; this one keeps the rule visible next to the address it applies to.
    expect(NAMECOM_TEST_HOST).not.toContain('/v4')
  })

  it('probes Nutrient at two different products, which is the entire point', () => {
    // If both addresses were the same, the check would always report whichever
    // product answered and would look like it had proved something.
    expect(NUTRIENT_PROCESSOR_PROBE).not.toBe(NUTRIENT_EXTRACTION_PROBE)
    expect(NUTRIENT_EXTRACTION_PROBE).toContain('extraction')
  })
})

describe('finding a credential under whichever name it is currently written', () => {
  const env = [
    '# a comment',
    'NUTRIENT_PROCESSOR_KEY=',
    'NUTRIENT_EXTRACTION_KEY=pdf_live_abcdef',
    'NAMECOM_USERNAME=someone@example.com',
    '',
  ].join('\n')

  it('skips a name that is present but empty', () => {
    // An empty line is not a credential. Treating it as one would make the check
    // report on nothing and look like it had found something.
    expect(firstFilled(env, ['NUTRIENT_PROCESSOR_KEY', 'NUTRIENT_EXTRACTION_KEY'])).toEqual({
      name: 'NUTRIENT_EXTRACTION_KEY',
      value: 'pdf_live_abcdef',
    })
  })

  it('reports which name it was found under, not just the value', () => {
    // Knowing where a credential is written is what lets the check say "already
    // correct" instead of "move it" every single run.
    const found = firstFilled(env, ['NAMECOM_USERNAME_TEST', 'NAMECOM_USERNAME'])
    expect(found?.name).toBe('NAMECOM_USERNAME')
  })

  it('prefers the earlier name when more than one is filled in', () => {
    const both = 'A=first\nB=second\n'
    expect(firstFilled(both, ['B', 'A'])?.value).toBe('second')
    expect(firstFilled(both, ['A', 'B'])?.value).toBe('first')
  })

  it('finds nothing when no name is filled in', () => {
    expect(firstFilled(env, ['NUTRIENT_PROCESSOR_KEY', 'MISSING_ENTIRELY'])).toBeUndefined()
  })
})

describe('telling somebody where a credential belongs', () => {
  it('says nothing needs changing when it is already in the right place', () => {
    // A check that says "move it" every time you run it trains people to ignore
    // it, and then it is worth nothing on the day it has something new to say.
    const said = place({ name: 'NUTRIENT_EXTRACTION_KEY', value: 'x' }, 'NUTRIENT_EXTRACTION_KEY')
    expect(said).toContain('already')
    expect(said).not.toContain('Move it')
  })

  it('names both the wrong place and the right one when it does need moving', () => {
    const said = place({ name: 'NUTRIENT_API_KEY_UNCLASSIFIED', value: 'x' }, 'NUTRIENT_EXTRACTION_KEY')
    expect(said).toContain('NUTRIENT_API_KEY_UNCLASSIFIED')
    expect(said).toContain('NUTRIENT_EXTRACTION_KEY')
  })

  it('never prints the credential itself', () => {
    const secret = 'pdf_live_do_not_print_me'
    expect(place({ name: 'A', value: secret }, 'B')).not.toContain(secret)
  })
})
