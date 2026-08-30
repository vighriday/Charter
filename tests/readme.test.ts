/**
 * Checking that the readme tells the truth.
 *
 * WHY THIS TEST EXISTS
 *
 * The readme is the only file most people will ever read, and it is public. On 30
 * August it claimed the project had 201 tests when it had 658, and that the
 * demonstration ran the first three stages when it ran all eight. Both were true
 * when they were written. Neither was true a day later.
 *
 * That is the ordinary way a readme goes wrong: nobody writes something false, they
 * write something true and the code moves. A number in prose has no way of noticing.
 *
 * This project already argues that a count worth printing is a count worth
 * generating — the tool catalogue is built from the code that runs, and the reason
 * given is that a hand-written copy drifts. The readme was the one place still
 * quoting numbers by hand.
 *
 * So every number and every command in the readme is checked here against the thing
 * it describes. A stale claim now fails the build on the day the code changes,
 * rather than on the day a judge reads it.
 *
 * WHAT THIS DELIBERATELY DOES NOT DO
 *
 * It does not check the prose. Whether an explanation is any good is not something
 * a test can judge, and pretending otherwise would give false comfort. It checks
 * the facts: counts, commands, file names, key names, and the words this project
 * has said it will never use.
 */

import { createPublicKey } from 'node:crypto'
import { readFileSync, existsSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { keyIdOf } from '../src/record/attestation.js'
import { STAGE_ORDER } from '../src/stages/stages.js'

const readme = readFileSync('README.md', 'utf8')
const packageJson = JSON.parse(readFileSync('package.json', 'utf8')) as {
  scripts: Record<string, string>
}

describe('the readme counts what is actually there', () => {
  // The test COUNT is checked by scripts/check-readme-counts.mjs instead of here.
  // Counting the tests from inside the tests means knowing the answer while
  // producing it, and reading the count out of the source files misses every block
  // that produces one test per item in a list worked out while the code runs. That
  // undercount always looks fine, which is the worst way for a check to be wrong.

  it('claims the number of stages the stage machine actually has', () => {
    expect(STAGE_ORDER).toHaveLength(8)
    expect(readme).toContain('all eight stages')
  })
})

describe('every command the readme tells you to run exists', () => {
  const commands = [...readme.matchAll(/^npm run ([a-z:]+)/gm)].map((match) => match[1] as string)

  it('finds commands in the readme to check', () => {
    // Without this the loop below would pass by having nothing to do, which is the
    // most common way a test of this shape proves nothing at all.
    expect(commands.length).toBeGreaterThan(3)
  })

  it.each([...new Set(commands)])('`npm run %s` is a real script', (name) => {
    expect(
      Object.hasOwn(packageJson.scripts, name),
      `The readme tells a stranger to run "npm run ${name}", which does not exist. ` +
        `A documented command that fails is worse than an undocumented one.`,
    ).toBe(true)
  })

  it('every script it names points at a file that exists', () => {
    for (const [name, command] of Object.entries(packageJson.scripts)) {
      const target = /(?:tsx|node) ([^\s]+)/.exec(command)
      if (target === null) continue
      expect(existsSync(target[1] as string), `script "${name}" runs "${target[1]}", which is not there`).toBe(true)
    }
  })
})

describe('the published key name matches the published key', () => {
  it('prints the fingerprint of the key that is actually committed', () => {
    // The whole point of publishing the key name is so somebody can compare it
    // against a packet they were handed. A readme printing a different name from
    // the committed key would make that comparison fail for the wrong reason.
    const claimed = /key name\s+([0-9a-f]{64})/.exec(readme)
    expect(claimed, 'the readme no longer publishes a key name').not.toBeNull()

    expect(existsSync('keys/attestation.pub'), 'keys/attestation.pub is missing').toBe(true)

    // Worked out from the committed key with the project's own function, rather
    // than by looking for the text inside the file. The name is a fingerprint OF
    // the key, so it does not appear in the key; comparing the two as text would
    // fail for a reason that has nothing to do with whether they match.
    const derived = keyIdOf(createPublicKey(readFileSync('keys/attestation.pub', 'utf8')))

    expect(
      derived,
      'The key name printed in the readme is not the fingerprint of the key ' +
        'committed in keys/attestation.pub. Somebody comparing a packet against the ' +
        'published name would be told it does not match, and would be right to stop.',
    ).toBe((claimed as RegExpExecArray)[1])
  })
})

describe('the words this project has said it will never use', () => {
  // From CLAUDE.md, and they are rules rather than preferences. "Immutable" and
  // "tamper-proof" claim prevention, and this project detects modification rather
  // than preventing it — a claim the code cannot back.
  const banned = [
    'immutable',
    'tamper-proof',
    'tamperproof',
    'AI cofounder',
    'AI co-founder',
    'startup-in-a-box',
    'legal advice',
  ]

  it.each(banned)('does not appear: %s', (word) => {
    // The readme says these words are never used, in the readme, so it has to
    // quote them to say so. Only the table row that defines the rule may.
    const withoutTheRule = readme.replace(
      /Two words are never used:[\s\S]*?back\./,
      '',
    )
    expect(withoutTheRule.toLowerCase()).not.toContain(word.toLowerCase())
  })

  it('carries no attribution to any AI assistant', () => {
    // Nothing public-facing carries an assistant's name. A person is responsible
    // for this work and the writing should read that way.
    expect(readme).not.toMatch(/co-authored-by/i)
    expect(readme).not.toMatch(/generated with/i)
  })
})
