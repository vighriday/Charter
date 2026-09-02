/**
 * Who may read a run, and what a request can and cannot reach.
 *
 * WHY THIS FILE EXISTS
 *
 * The website lets anybody start a run on their own business idea. That means a
 * program of ours, on the open internet, holding somebody else's business
 * description, their names, and every answer they gave.
 *
 * Answering a run always needed the run's own secret. Reading one needed nothing
 * at all: the name of the run was the only thing between a stranger and all of it,
 * and the name was four bytes. Anybody who guessed one could read the feed, which
 * carries the business description in the owners' own words, download the record,
 * which carries their names and their answers, and download the finished packet.
 *
 * The name is sixteen bytes now, and that is the smaller half of the fix. The real
 * half is that reading needs the same secret answering does. These tests are what
 * hold that in place, because an access rule nobody tests is a promise rather than
 * a rule.
 *
 * THE OTHER TWO THINGS CHECKED HERE
 *
 * A web address that points outside the site folder is refused, checked on where
 * the path actually ends up rather than by looking for ".." in the text — there
 * are many ways to write the same climb out of a folder and only one way to ask
 * where it landed.
 *
 * And the address a request came from is read from the FIRST value of the header a
 * hosting service sets, never the last. Everything after the first was put there
 * by whoever sent the request and can say anything at all, which is how a limit
 * per visitor quietly becomes no limit.
 */

import { describe, expect, it } from 'vitest'
import { join, sep } from 'node:path'

import { fileAsked, whereFrom, secretSent, isKnock } from '../src/serve/server.js'
import { sameSecret, answerKind } from '../src/serve/runs.js'

describe('somebody knocking to keep the site awake', () => {
  // Free hosting sleeps after about fifteen minutes with nothing to do, and
  // waking it takes most of a minute. Something outside knocks every few minutes
  // so that a stranger who opens the link never meets a blank screen.
  it('recognises both names for the door', () => {
    // /healthz is what hosting services and uptime checkers try first. The other
    // is here because every other address in this program begins /api/, so it is
    // what somebody reading the code would guess.
    expect(isKnock('/healthz')).toBe(true)
    expect(isKnock('/api/health')).toBe(true)
  })

  it('is not confused by anything else', () => {
    expect(isKnock('/')).toBe(false)
    expect(isKnock('/api/limits')).toBe(false)
    expect(isKnock('/api/runs')).toBe(false)
    expect(isKnock('/healthz/../api/runs')).toBe(false)
    expect(isKnock('/healthzzz')).toBe(false)
  })
})

describe('the secret a request carried', () => {
  it('reads it out of the authorization header', () => {
    expect(secretSent({ authorization: 'Bearer abc123' })).toBe('abc123')
  })

  it('does not care how the word Bearer was capitalised', () => {
    expect(secretSent({ authorization: 'bearer abc123' })).toBe('abc123')
  })

  it('gives back nothing when there is nothing to read', () => {
    expect(secretSent({})).toBe('')
    expect(secretSent({ authorization: 'abc123' }), 'no Bearer, no secret').toBe('')
    expect(secretSent({ authorization: 'Bearer    ' })).toBe('')
  })
})

describe('comparing two secrets', () => {
  it('says yes only when they are the same', () => {
    expect(sameSecret('abc', 'abc')).toBe(true)
    expect(sameSecret('abc', 'abd')).toBe(false)
  })

  it('says no to a shorter guess and to a longer one', () => {
    expect(sameSecret('ab', 'abc')).toBe(false)
    expect(sameSecret('abcd', 'abc')).toBe(false)
  })

  it('says no to nothing at all', () => {
    // The case that matters most: a request that carried no secret. Somewhere in
    // between "" and the real secret there must be no accident that lets it past.
    expect(sameSecret('', 'a-real-secret')).toBe(false)
    expect(sameSecret('', '')).toBe(true)
  })

  it('looks at every character rather than stopping at the first difference', () => {
    // Not a timing measurement, which would be flaky. This checks the shape: two
    // guesses that differ from the answer at opposite ends both come back false,
    // and the implementation has no early exit inside the loop to find.
    expect(sameSecret('Xbcdefgh', 'abcdefgh')).toBe(false)
    expect(sameSecret('abcdefgX', 'abcdefgh')).toBe(false)
  })
})

describe('which file a web address is asking for', () => {
  it('gives the front page for the root', () => {
    expect(fileAsked('/')).toBe(join('site', 'index.html'))
  })

  it('gives a file inside the site folder', () => {
    expect(fileAsked('/panel.js')).toBe(join('site', 'panel.js'))
  })

  it('refuses a path that climbs out of the folder', () => {
    expect(fileAsked('/../package.json')).toBeNull()
    expect(fileAsked('/../../.env')).toBeNull()
  })

  it('refuses a climb that was written in escape codes', () => {
    // Checked on where the path ended up rather than on how it was spelled. There
    // are many ways to write the same climb and only one way to ask where it went.
    expect(fileAsked('/%2e%2e%2fpackage.json')).toBeNull()
    expect(fileAsked('/%2e%2e/%2e%2e/.env')).toBeNull()
  })

  it('refuses a climb hidden in the middle of a path', () => {
    expect(fileAsked('/fonts/../../package.json')).toBeNull()
  })

  it('allows a path that goes down and comes back inside', () => {
    expect(fileAsked('/fonts/../index.html')).toBe(join('site', 'index.html'))
  })

  it('never hands back something outside the folder it was given', () => {
    for (const asked of ['/../x', '/../../x', '/%2e%2e/x', '/a/../../x']) {
      const found = fileAsked(asked)
      if (found === null) continue
      expect(found.startsWith(`site${sep}`), `${asked} escaped to ${found}`).toBe(true)
    }
  })
})

describe('where a request came from', () => {
  it('uses the socket when nothing was forwarded', () => {
    expect(whereFrom({}, '203.0.113.7')).toBe('203.0.113.7')
  })

  it('uses the FIRST forwarded value, never the last', () => {
    // Everything after the first was put there by whoever sent the request. Reading
    // the last one means a visitor picks their own identity, and a limit per
    // visitor becomes no limit at all.
    expect(whereFrom({ 'x-forwarded-for': '203.0.113.7, 10.0.0.1' }, '10.0.0.1')).toBe(
      '203.0.113.7',
    )
  })

  it('ignores an empty forwarded header and falls back to the socket', () => {
    expect(whereFrom({ 'x-forwarded-for': '   ' }, '203.0.113.7')).toBe('203.0.113.7')
  })
})

describe('how a question should be answered', () => {
  it('knows a yes or no when it sees one', () => {
    expect(answerKind('allow up to $15.00? [y/N]')).toBe('yes-no')
    expect(answerKind('is the proposed name clear of these? [y/N]')).toBe('yes-no')
  })

  it('knows the one that asks for somebody own name', () => {
    expect(answerKind('your name, to approve sending it')).toBe('name')
  })

  it('treats everything else as words', () => {
    expect(answerKind('Who is putting in the van, and what is it worth?')).toBe('words')
  })
})
