/**
 * Reading answers without losing any of them.
 *
 * WHY THIS FILE EXISTS AT ALL
 *
 * Node has a built-in way to ask a question and wait for the answer, and this
 * project used it. It works when somebody is typing and it quietly throws lines
 * away when the answers arrive any other way — from a file, from another program,
 * from a test.
 *
 * The reason is that the built-in listens for one line, takes it, and stops
 * listening. When a person is typing, the next line does not exist yet, so nothing
 * can be missed. When all the answers arrive at once, every line after the first
 * is handed out while nobody is listening, and those lines are gone. The next
 * question then waits for something that already came and went.
 *
 * What that looked like: `npm start` answered the first question, printed the
 * second, and the program ended. No error. No explanation. The answers were all
 * there, and they had been discarded.
 *
 * These tests are what stop that coming back, and they are the reason the whole
 * run can be driven from a written-out list of answers, which is the only way it
 * gets checked more than once.
 */

import { describe, expect, it } from 'vitest'
import { Readable } from 'node:stream'

import { openKeyboard, InputEnded } from '../src/case/keyboard.js'

/** Every line at once, the way a file or another program sends them. */
function allAtOnce(...lines: readonly string[]): Readable {
  return Readable.from([lines.map((one) => `${one}\n`).join('')])
}

describe('reading what somebody typed', () => {
  it('keeps every line when they all arrive together', async () => {
    // The failure this whole file is about. Three lines arrive in one go, and all
    // three have to survive being asked for one at a time.
    const keys = openKeyboard({ input: allAtOnce('a bakery in Texas', 'TX', 'y'), write: () => {} })

    expect(await keys.ask('one? ')).toBe('a bakery in Texas')
    expect(await keys.ask('two? ')).toBe('TX')
    expect(await keys.ask('three? ')).toBe('y')

    keys.close()
  })

  it('waits when the answer has not arrived yet', async () => {
    const feed = new Readable({ read: () => {} })
    const keys = openKeyboard({ input: feed, write: () => {} })

    const waiting = keys.ask('which state? ')
    feed.push('TX\n')

    expect(await waiting).toBe('TX')
    keys.close()
  })

  it('shows the prompt it was given, exactly', async () => {
    const shown: string[] = []
    const keys = openKeyboard({
      input: allAtOnce('yes'),
      write: (text) => shown.push(text),
    })

    await keys.ask('allow up to $15.00? [y/N] ')

    expect(shown).toEqual(['allow up to $15.00? [y/N] '])
    keys.close()
  })

  it('fails the question that is still waiting when the answers run out', async () => {
    // Running out of answers is NOT an empty answer. Somebody who piped in two
    // answers to a run that asks three has not agreed to anything about the third,
    // and recording a blank would be recording a decision nobody made.
    const keys = openKeyboard({ input: allAtOnce('a bakery'), write: () => {} })

    expect(await keys.ask('one? ')).toBe('a bakery')
    await expect(keys.ask('two? ')).rejects.toBeInstanceOf(InputEnded)

    keys.close()
  })

  it('says which question was left unanswered', async () => {
    const keys = openKeyboard({ input: allAtOnce(), write: () => {} })

    await expect(keys.ask('is the proposed name clear of these? ')).rejects.toThrow(
      /is the proposed name clear of these\?/,
    )
    keys.close()
  })

  it('keeps an empty line, because an empty line is something somebody typed', async () => {
    // Whether an empty answer is acceptable is decided by whoever asked, not here.
    // Pressing enter at a question is a thing that happened and it is reported as
    // it happened.
    const keys = openKeyboard({ input: allAtOnce('', 'TX'), write: () => {} })

    expect(await keys.ask('one? ')).toBe('')
    expect(await keys.ask('two? ')).toBe('TX')
    keys.close()
  })

  it('can be closed twice without complaining', async () => {
    const keys = openKeyboard({ input: allAtOnce('x'), write: () => {} })
    keys.close()
    expect(() => keys.close()).not.toThrow()
  })
})
