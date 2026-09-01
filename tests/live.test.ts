/**
 * The part of a live run that waits for a person.
 *
 * WHAT THIS IS ABOUT
 *
 * `npm start` lets somebody bring their own business idea and watch Charter work
 * on it for real. Everything interesting about that is in one place: what happens
 * when the run reaches something only a person can decide.
 *
 * There are five of those, and they are not alike. A question needs typing. A
 * spend needs allowing, and refusing it has to stop the run rather than being
 * treated as a yes. A name too close to another needs judging. A value read off an
 * ID needs somebody who has seen the document. And the finished packet needs
 * approving by name, against its fingerprint.
 *
 * WHY THESE TESTS EXIST AT ALL
 *
 * The obvious way to check a program that talks to a person is to run it and talk
 * to it. That needs a keyboard, a model key, and somebody willing to do it again
 * every time anything changes, which in practice means it is checked once and then
 * never again.
 *
 * So the driver was built not to know what it is talking to. It asks through one
 * function, and here that function is a written-out list of answers. The same code
 * path a person walks is walked here, without a person, without a key, and without
 * the network.
 *
 * THE ONE THAT MATTERS MOST
 *
 * "refusing a spend stops the run". A driver that treated a no as a yes, or that
 * carried on and let something else grant it, would spend somebody's money against
 * their word. That is the failure this whole project is built to make impossible,
 * so it is tested from the outside here as well as from the inside elsewhere.
 */

import { describe, expect, it, beforeEach } from 'vitest'

import { openBuiltIn, type Database } from '../src/db/driver.js'
import { migrate } from '../src/db/migrate.js'
import { append, fixedClock } from '../src/record/log.js'
import { buildRegistry, type Tool } from '../src/tools/registry.js'
import { ALL_TOOLS } from '../src/tools/stage-tools.js'
import { readFacts } from '../src/agent/run.js'
import { answerWhateverIsWaiting, type AskAPerson } from '../src/case/live.js'
import { DEFAULT_SETTINGS } from '../src/settings.js'
import type { TurnTaker } from '../src/agent/loop.js'

const CASE = 'live-test'
const TOKEN = 'a-long-unguessable-token-for-this-case'

let db: Database

/** Answers handed over in order, with a note of what was asked for. */
function scriptedPerson(answers: readonly string[]): {
  readonly ask: AskAPerson
  readonly asked: string[]
} {
  const asked: string[] = []
  let at = 0

  return {
    asked,
    ask: async (prompt: string) => {
      asked.push(prompt)
      const answer = answers[at]
      at += 1
      return answer ?? ''
    },
  }
}

function driverOptions(): Parameters<typeof answerWhateverIsWaiting>[2] {
  return {
    db,
    caseId: CASE,
    clock: fixedClock('2026-09-01T09:00:00.000Z', 1000),
    registry: buildRegistry(ALL_TOOLS) as ReadonlyMap<string, Tool>,
    // Never reached: every one of these tests stops on a person, and a person is
    // the one thing no number of model turns can produce.
    router: (() => {
      throw new Error('the model was asked to take a turn while a person was waiting')
    }) as unknown as TurnTaker,
    services: {} as never,
    settings: DEFAULT_SETTINGS,
  }
}

const person = (): {
  readonly db: Database
  readonly caseId: string
  readonly token: string
  readonly expectedToken: string
  readonly clock: () => Date
} => ({
  db,
  caseId: CASE,
  token: TOKEN,
  expectedToken: TOKEN,
  clock: fixedClock('2026-09-01T09:00:00.000Z', 1000),
})

beforeEach(async () => {
  db = await openBuiltIn()
  await migrate(db)
})

describe('a live run, at the places only a person can decide', () => {
  it('asks the question that was actually asked, in the words it was asked in', async () => {
    const clock = fixedClock('2026-09-01T09:00:00.000Z', 1000)
    await append(
      db,
      {
        runId: CASE,
        kind: 'question.asked',
        actor: 'model',
        stage: 'understand',
        payload: { question: 'Who is putting in the van, and what is it worth?', why: 'shares' },
      },
      clock,
    )

    const { ask, asked } = scriptedPerson(['Priya is. About twelve thousand dollars.'])
    const answered = await answerWhateverIsWaiting(ask, person(), driverOptions(), CASE)

    expect(answered, 'something was waiting and it was answered').toBe(true)
    expect(asked[0], 'the person is shown the real question').toBe(
      'Who is putting in the van, and what is it worth?',
    )

    const facts = await readFacts(db, CASE)
    expect(facts.openQuestions, 'the question is no longer open').toHaveLength(0)
  })

  it('will not take an empty answer, and asks again instead', async () => {
    const clock = fixedClock('2026-09-01T09:00:00.000Z', 1000)
    await append(
      db,
      {
        runId: CASE,
        kind: 'question.asked',
        actor: 'model',
        stage: 'understand',
        payload: { question: 'Which state?', why: 'the law that applies' },
      },
      clock,
    )

    // Pressing enter is not an answer. A driver that accepted it would write an
    // empty string into the record as though somebody had decided something.
    const { ask, asked } = scriptedPerson(['', '   ', 'TX'])
    const answered = await answerWhateverIsWaiting(ask, person(), driverOptions(), CASE)

    expect(answered).toBe(true)
    expect(asked.length, 'it asked again rather than accepting nothing').toBe(3)

    const facts = await readFacts(db, CASE)
    expect(facts.openQuestions).toHaveLength(0)
  })

  it('records a spend permission for exactly what was asked for, and no more', async () => {
    const clock = fixedClock('2026-09-01T09:00:00.000Z', 1000)
    await append(
      db,
      {
        runId: CASE,
        kind: 'spend.requested',
        actor: 'model',
        stage: 'understand',
        payload: { limitCents: '2500', forWhat: 'the web address' },
      },
      clock,
    )

    const { ask } = scriptedPerson(['y'])
    const answered = await answerWhateverIsWaiting(ask, person(), driverOptions(), CASE)

    expect(answered).toBe(true)

    const facts = await readFacts(db, CASE)
    expect(facts.spendAuthorisation?.limitCents, 'the limit is the one asked for').toBe('2500')
    expect(facts.spendAuthorisation?.forWhat).toBe('the web address')
  })

  it('stops the run when the person says no to spending, rather than carrying on', async () => {
    // The one that would cost somebody real money if it were wrong. A no has to
    // end the run, not fall through to something else that grants it.
    const clock = fixedClock('2026-09-01T09:00:00.000Z', 1000)
    await append(
      db,
      {
        runId: CASE,
        kind: 'spend.requested',
        actor: 'model',
        stage: 'understand',
        payload: { limitCents: '9900', forWhat: 'registering the address' },
      },
      clock,
    )

    const { ask } = scriptedPerson(['n'])
    const answered = await answerWhateverIsWaiting(ask, person(), driverOptions(), CASE)

    expect(answered, 'a refusal is not something the run can get past').toBe(false)

    const facts = await readFacts(db, CASE)
    expect(facts.spendAuthorisation, 'nothing was authorised').toBeUndefined()
  })

  it('treats anything that is not a yes as a no', async () => {
    const clock = fixedClock('2026-09-01T09:00:00.000Z', 1000)
    await append(
      db,
      {
        runId: CASE,
        kind: 'spend.requested',
        actor: 'model',
        stage: 'understand',
        payload: { limitCents: '9900', forWhat: 'registering the address' },
      },
      clock,
    )

    // Somebody who types "maybe" has not agreed to spend anything.
    const { ask } = scriptedPerson(['maybe'])
    await answerWhateverIsWaiting(ask, person(), driverOptions(), CASE)

    const facts = await readFacts(db, CASE)
    expect(facts.spendAuthorisation).toBeUndefined()
  })

  it('says there is nothing waiting when nothing is waiting', async () => {
    // A driver that always claimed somebody was needed would leave a person at a
    // prompt that never moves, while the real reason the run stopped goes unsaid.
    const { ask, asked } = scriptedPerson(['whatever'])
    const answered = await answerWhateverIsWaiting(ask, person(), driverOptions(), CASE)

    expect(answered).toBe(false)
    expect(asked, 'nobody was asked anything').toHaveLength(0)
  })
})
