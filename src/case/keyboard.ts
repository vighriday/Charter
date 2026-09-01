/**
 * Reading what somebody types, one line at a time, without losing any of it.
 *
 * WHY THIS FILE EXISTS
 *
 * Node has a built-in way to ask a question and wait for an answer. It works when
 * a person is sitting at a keyboard, and it quietly loses lines when the answers
 * arrive any other way.
 *
 * The reason is worth writing down, because the failure looks like nothing at all.
 * The built-in `question` attaches a listener for one line, takes that line, and
 * removes the listener. When somebody is typing, that is fine: the next line does
 * not exist yet, so nothing can be missed. When the answers are piped in from a
 * file or another program, the whole lot arrives in one go, and every line after
 * the first is handed out while nobody is listening. Those lines are gone. The
 * next question then waits forever for something that already came and went.
 *
 * What that looked like here: a run driven from a file answered the first question,
 * printed the second, and then the program simply ended, with no error and no
 * explanation. The answers were all there. They had been thrown away.
 *
 * WHAT THIS DOES INSTEAD
 *
 * It listens for every line from the moment it opens, and keeps the ones nobody
 * has asked for yet. A question is answered from that store if a line is already
 * waiting, and otherwise waits for the next one. Nothing is ever handed out while
 * nobody is listening, so nothing can be lost.
 *
 * WHY THAT MATTERS BEYOND CONVENIENCE
 *
 * A run of Charter stops and asks a person at every point only a person can
 * decide. If those answers can only ever be typed by hand, then nobody can check
 * the program end to end without sitting and typing, which in practice means it
 * gets checked once and never again. Being able to hand it a written-out set of
 * answers is what makes the whole path testable.
 *
 * ENDING IS NOT ANSWERING
 *
 * If the input runs out while a question is still waiting, that is not an empty
 * answer and must not be treated as one. Somebody piping in four answers to a run
 * that asks five has not agreed to anything about the fifth. The waiting question
 * is failed with `InputEnded`, and the caller says so and stops.
 */

import { createInterface, type Interface } from 'node:readline'

/**
 * The input finished while a question was still waiting for an answer.
 *
 * A separate kind of error because the caller has to tell it apart from a run that
 * stopped for its own reasons. "You did not answer" and "the program gave up" are
 * different things to be told.
 */
export class InputEnded extends Error {
  constructor(question: string) {
    super(
      `the answers ran out while Charter was still waiting for one: ${question}. ` +
        `Nothing was assumed on your behalf.`,
    )
    this.name = 'InputEnded'
  }
}

/** A way of asking a person something and getting back what they said. */
export interface Keyboard {
  /** Ask, and wait. Rejects with `InputEnded` if the input finishes first. */
  readonly ask: (prompt: string) => Promise<string>
  /** Stop listening. Safe to call more than once. */
  readonly close: () => void
}

/**
 * Open a keyboard over a stream of lines.
 *
 * `write` is where prompts go. It is separate from the input on purpose: the tests
 * pass a stream of written-out answers and collect the prompts in an array, which
 * is how every question this program asks is checked without anybody typing.
 */
export function openKeyboard(options?: {
  readonly input?: NodeJS.ReadableStream
  readonly write?: (text: string) => void
}): Keyboard {
  const input = options?.input ?? process.stdin
  const write = options?.write ?? ((text: string): void => void process.stdout.write(text))

  const waitingLines: string[] = []
  const waitingAsks: Array<{
    readonly question: string
    readonly settle: (line: string) => void
    readonly fail: (problem: Error) => void
  }> = []

  let ended = false

  const lines: Interface = createInterface({ input, crlfDelay: Infinity })

  lines.on('line', (line: string) => {
    const next = waitingAsks.shift()
    if (next === undefined) {
      waitingLines.push(line)
      return
    }
    next.settle(line)
  })

  const finish = (): void => {
    ended = true
    // Everything still waiting is failed, not answered. A question nobody
    // answered has no answer, and a blank one would be recorded as though
    // somebody had decided something.
    while (waitingAsks.length > 0) {
      const next = waitingAsks.shift()
      if (next !== undefined) next.fail(new InputEnded(next.question))
    }
  }

  lines.on('close', finish)

  return {
    ask: async (prompt: string): Promise<string> => {
      write(prompt)

      const already = waitingLines.shift()
      if (already !== undefined) return already

      if (ended) throw new InputEnded(prompt)

      return await new Promise<string>((settle, fail) => {
        waitingAsks.push({ question: prompt, settle, fail })
      })
    },
    close: (): void => {
      lines.close()
      finish()
    },
  }
}
