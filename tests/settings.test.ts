/**
 * Proving that a setting either does something or says it does not.
 *
 * WHAT IS BEING PROVED
 *
 * `.env.example` is the file that tells a stranger what to put in `.env`, the file
 * of settings and credentials that is never committed. Until 30 August 2026 it
 * listed seven settings that **no code anywhere read**. Somebody following it
 * exactly would have set the depth an identity document is read at, the ceiling on
 * how large a request to a model may be, and the confidence floor below which a
 * value goes to a person — and every one of those would have been ignored. Nothing
 * in the project ever opened `.env` at all.
 *
 * A setting that is documented and ignored is worse than no setting. It tells a
 * reader the program can be steered, invites them to steer it, and then quietly
 * does something else.
 *
 * So these tests hold three lines:
 *
 *   1. Every setting names the file that reads it, or says plainly that nothing
 *      does yet — and that file really exists and really mentions it.
 *   2. `.env.example` is exactly what the code produces, so the two cannot drift.
 *   3. A value that cannot mean anything is refused with an explanation, never
 *      replaced by a default.
 *
 * The most important test in this file is the one that opens the file each setting
 * claims to be read by and looks for its name. A promise nobody checks is how the
 * original problem happened.
 */

import { readFileSync, existsSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  SETTINGS,
  SettingRefusal,
  DEFAULT_SETTINGS,
  DEPTHS_THAT_NAME_FIELDS,
  EXTRACTION_DEPTHS,
  complaintAbout,
  depthSpread,
  loadEnvFile,
  parseEnvText,
  readSettings,
  renderEnvExample,
  settingNamed,
  settingsNothingReads,
} from '../src/settings.js'

// ─────────────────────────────────────────────────────────────────────────────
// The promise each setting makes
// ─────────────────────────────────────────────────────────────────────────────

describe('every setting says who reads it, and is telling the truth', () => {
  it('names a file that exists, or says nothing reads it yet', () => {
    for (const setting of SETTINGS) {
      if (setting.readBy === null) {
        expect(
          setting.notYetBuilt,
          `${setting.name} says nothing reads it, without saying what is missing`,
        ).toBeTruthy()
        continue
      }
      for (const file of setting.readBy.split(/\s+/).filter(Boolean)) {
        expect(
          existsSync(file),
          `${setting.name} says it is read by ${file}, which does not exist`,
        ).toBe(true)
      }
    }
  })

  it('the named file really mentions the setting', () => {
    // The test that would have caught the original problem. A file listed as the
    // reader that never mentions the name is the exact failure: a promise in a
    // document, with nothing behind it.
    for (const setting of SETTINGS) {
      if (setting.readBy === null) continue
      for (const file of setting.readBy.split(/\s+/).filter(Boolean)) {
        const source = readFileSync(file, 'utf8')
        expect(
          source.includes(setting.name),
          `${file} is named as the reader of ${setting.name} and never mentions it`,
        ).toBe(true)
      }
    }
  })

  it('every setting nothing reads says which unbuilt part it belongs to', () => {
    const unread = settingsNothingReads()
    expect(unread.length, 'nothing is marked unread, which after an audit is suspicious').toBeGreaterThan(0)
    for (const setting of unread) {
      expect(setting.notYetBuilt ?? '', `${setting.name}`).not.toBe('')
    }
  })

  it('has no two settings with the same name', () => {
    const names = SETTINGS.map((one) => one.name)
    expect(new Set(names).size, `a duplicate would silently win: ${names.join(', ')}`).toBe(
      names.length,
    )
  })

  it('gives every choice setting a list of what it allows', () => {
    for (const setting of SETTINGS) {
      if (setting.kind !== 'choice') continue
      expect(Object.keys(setting.choices ?? {}).length, setting.name).toBeGreaterThan(1)
    }
  })

  it('never puts an example value on a secret', () => {
    // A secret with an example in a committed file is a secret in a committed
    // file, whatever it was meant to be.
    for (const setting of SETTINGS) {
      if (setting.kind !== 'secret') continue
      expect(setting.example, `${setting.name} has an example value`).toBe('')
    }
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// .env.example and the code cannot drift
// ─────────────────────────────────────────────────────────────────────────────

describe('the committed .env.example', () => {
  it('is exactly what the code produces', () => {
    expect(
      readFileSync('.env.example', 'utf8'),
      'run "npm run settings" and read the change before committing it',
    ).toBe(renderEnvExample())
  })

  it('names a reader, or says nothing reads it, beside every setting', () => {
    const file = renderEnvExample()
    for (const setting of SETTINGS) {
      const line =
        setting.readBy === null ? 'NOTHING READS THIS YET' : `Read by: ${setting.readBy}`
      const at = file.indexOf(`\n${setting.name}=`)
      expect(at, `${setting.name} is not in the generated file`).toBeGreaterThan(-1)
      // The claim has to be in the comment block directly above the setting, not
      // anywhere in the file.
      const above = file.slice(Math.max(0, at - 400), at)
      expect(above, `${setting.name} does not say who reads it`).toContain(line)
    }
  })

  it('carries no real credential', () => {
    const file = renderEnvExample()
    for (const setting of SETTINGS) {
      if (setting.kind !== 'secret') continue
      expect(file, `${setting.name} has a value in a committed file`).toContain(
        `\n${setting.name}=\n`,
      )
    }
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Reading a settings file
// ─────────────────────────────────────────────────────────────────────────────

describe('reading the text of a settings file', () => {
  it('reads an ordinary line', () => {
    expect(parseEnvText('NAME=value')).toEqual({ NAME: 'value' })
  })

  it('ignores comments and blank lines', () => {
    expect(parseEnvText('# a note\n\nNAME=value\n\n# another\n')).toEqual({ NAME: 'value' })
  })

  it('keeps an equals sign inside a value', () => {
    // Real credentials end in padding, and splitting on every equals sign would
    // silently truncate them.
    expect(parseEnvText('KEY=abc=def==')).toEqual({ KEY: 'abc=def==' })
  })

  it('removes a matching pair of quotes and nothing else', () => {
    expect(parseEnvText('A="two words"')).toEqual({ A: 'two words' })
    expect(parseEnvText("B='two words'")).toEqual({ B: 'two words' })
    expect(parseEnvText('C="mismatched\'')).toEqual({ C: '"mismatched\'' })
  })

  it('accepts a stray export in front, because people write that', () => {
    expect(parseEnvText('export NAME=value')).toEqual({ NAME: 'value' })
  })

  it('ignores a line that is not a setting rather than refusing the whole file', () => {
    // Settings files collect notes from people over time. Refusing to start
    // because somebody wrote a sentence in one is not a useful thing to do.
    expect(parseEnvText('this is not a setting\nNAME=value')).toEqual({ NAME: 'value' })
  })

  it('handles a file with no line break at the end', () => {
    expect(parseEnvText('A=1\nB=2')).toEqual({ A: '1', B: '2' })
  })

  it('reads an empty value as empty rather than as missing', () => {
    expect(parseEnvText('NAME=')).toEqual({ NAME: '' })
  })
})

describe('loading .env from disk', () => {
  it('is not an error when there is no file', () => {
    const into: Record<string, string | undefined> = {}
    expect(loadEnvFile('does-not-exist-anywhere.env', into)).toEqual({ loaded: false, filled: [] })
    expect(into).toEqual({})
  })

  it('lets the environment win over the file', () => {
    // A value already set in the shell is something somebody deliberately did for
    // this one run. A file on disk must not quietly override it.
    const into: Record<string, string | undefined> = { REPLAY_MODE: 'false' }
    const result = loadEnvFile('.env.example', into)

    expect(result.loaded).toBe(true)
    expect(into['REPLAY_MODE']).toBe('false')
    expect(result.filled).not.toContain('REPLAY_MODE')
  })

  it('fills in what the environment does not say', () => {
    const into: Record<string, string | undefined> = {}
    loadEnvFile('.env.example', into)
    expect(into['REPLAY_MODE']).toBe('true')
    expect(into['EXTRACTION_DEPTH']).toBe('understand')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// A value that cannot mean anything
// ─────────────────────────────────────────────────────────────────────────────

describe('a value that makes no sense', () => {
  it('refuses a flag that is not true or false', () => {
    expect(complaintAbout('REPLAY_MODE', 'yes')).toMatch(/exactly true or false/)
    expect(complaintAbout('REPLAY_MODE', 'true')).toBeNull()
    expect(complaintAbout('REPLAY_MODE', 'false')).toBeNull()
  })

  it('refuses a choice that is not on the list, and prints the list', () => {
    const said = complaintAbout('REGISTRAR_ENV', 'production') ?? ''
    expect(said).toContain('production')
    expect(said).toContain('test')
    expect(said).toContain('live')
  })

  it('refuses a number that is not a number', () => {
    expect(complaintAbout('REVIEW_CONFIDENCE_FLOOR', 'banana')).toMatch(/not a number/)
  })

  it('refuses a number outside its range, and says the range', () => {
    // A confidence floor of 5 would send nothing to a person, silently, for ever.
    const said = complaintAbout('REVIEW_CONFIDENCE_FLOOR', '5') ?? ''
    expect(said).toMatch(/between 0 and 1/)
  })

  it('refuses a fraction where only whole numbers make sense', () => {
    expect(complaintAbout('MAX_TURNS_PER_STAGE', '3.5')).toMatch(/whole number/)
  })

  it('refuses hexadecimal, which Number() would have accepted', () => {
    // Number('0x10') is 16. Nobody typing a setting meant that.
    expect(complaintAbout('MAX_TURNS_PER_STAGE', '0x10')).toMatch(/not a number/)
  })

  it('treats an empty value as "not set" rather than as a mistake', () => {
    // A blank line in a settings file is how people say they have not set
    // something, and refusing to start over one would make the file unusable.
    expect(complaintAbout('REVIEW_CONFIDENCE_FLOOR', '')).toBeNull()
    expect(complaintAbout('REVIEW_CONFIDENCE_FLOOR', undefined)).toBeNull()
  })

  it('raises every complaint at once rather than one at a time', () => {
    // Somebody who got three settings wrong should be told about all three once.
    let raised: SettingRefusal | undefined
    try {
      readSettings({
        REPLAY_MODE: 'yes',
        MAX_TURNS_PER_STAGE: '3.5',
        REVIEW_CONFIDENCE_FLOOR: 'banana',
      })
    } catch (error) {
      raised = error as SettingRefusal
    }

    expect(raised, 'three wrong settings started the program anyway').toBeInstanceOf(SettingRefusal)
    expect(raised?.complaints).toHaveLength(3)
  })

  it('errors rather than guessing when asked about a setting nobody wrote down', () => {
    expect(() => settingNamed('NOT_A_REAL_SETTING')).toThrow(/no setting called/)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// The rules that are about more than one setting
// ─────────────────────────────────────────────────────────────────────────────

describe('spending real money takes two settings, not one', () => {
  it('refuses a live registrar on its own', () => {
    expect(() => readSettings({ REGISTRAR_ENV: 'live' })).toThrow(SettingRefusal)
  })

  it('says why, in words about money', () => {
    try {
      readSettings({ REGISTRAR_ENV: 'live' })
      throw new Error('it started')
    } catch (error) {
      expect((error as SettingRefusal).message).toMatch(/spends real money/)
    }
  })

  it('allows it when both are set, because then somebody meant it', () => {
    const settings = readSettings({ REGISTRAR_ENV: 'live', SPEND_REAL_MONEY: 'true' })
    expect(settings.registrarEnv).toBe('live')
    expect(settings.spendRealMoney).toBe(true)
  })

  it('does nothing on its own', () => {
    // The permission without the environment must not become the environment.
    expect(readSettings({ SPEND_REAL_MONEY: 'true' }).registrarEnv).toBe('test')
  })
})

describe('the depth an identity document is read at', () => {
  it('refuses a depth that cannot produce named fields', () => {
    for (const depth of ['text', 'structure']) {
      expect(() => readSettings({ EXTRACTION_DEPTH: depth }), depth).toThrow(SettingRefusal)
    }
  })

  it('explains that the cheap depths cannot do the job, not that they are cheap', () => {
    try {
      readSettings({ EXTRACTION_DEPTH: 'text' })
      throw new Error('it started')
    } catch (error) {
      expect((error as SettingRefusal).message).toMatch(/date of birth/)
    }
  })

  it('accepts the two that can', () => {
    for (const depth of DEPTHS_THAT_NAME_FIELDS) {
      expect(readSettings({ EXTRACTION_DEPTH: depth }).extractionDepth, depth).toBe(depth)
    }
  })

  it('works out the spread rather than repeating a number somebody typed', () => {
    // Four files in this project said "twenty-four times" for days. That was the
    // price of the dearest depth read as though it were the multiplier. The number
    // is now derived, so it cannot be wrong without the prices being wrong.
    expect(depthSpread()).toBeCloseTo(24 / 7, 10)
    expect(depthSpread()).toBeLessThan(4)
  })

  it('has a price for every depth', () => {
    for (const [name, one] of Object.entries(EXTRACTION_DEPTHS)) {
      expect(one.creditsPerPage, name).toBeGreaterThan(0)
      expect(one.gives, name).not.toBe('')
    }
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// What a stranger gets
// ─────────────────────────────────────────────────────────────────────────────

describe('the defaults, which are what a stranger cloning this gets', () => {
  it('replays rather than calling anything', () => {
    expect(DEFAULT_SETTINGS.replaying).toBe(true)
  })

  it('never spends money', () => {
    expect(DEFAULT_SETTINGS.registrarEnv).toBe('test')
    expect(DEFAULT_SETTINGS.spendRealMoney).toBe(false)
  })

  it('reads documents at a depth that can name fields', () => {
    expect(DEPTHS_THAT_NAME_FIELDS).toContain(DEFAULT_SETTINGS.extractionDepth)
  })

  it('sets a high confidence floor, because too much review is the safe direction', () => {
    expect(DEFAULT_SETTINGS.reviewConfidenceFloor).toBeGreaterThanOrEqual(0.8)
  })

  it('matches what .env.example publishes', () => {
    // The file a stranger copies has to produce the defaults the code has, or the
    // two are two different programs.
    const fromFile = readSettings(parseEnvText(readFileSync('.env.example', 'utf8')))
    expect(fromFile).toEqual(DEFAULT_SETTINGS)
  })
})
