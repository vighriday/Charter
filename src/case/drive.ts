/**
 * Running all eight steps, and stopping at every point only a person can decide.
 *
 * WHY THIS IS ITS OWN FILE
 *
 * There are two ways into Charter. One is a terminal: `npm start`, somebody types
 * their idea, answers appear as they type them. The other is the website: a person
 * who has never opened a terminal fills in a box, watches the same run happen, and
 * answers the same questions with buttons.
 *
 * Those are two ways of asking and showing. They are not two products, and the
 * moment they become two pieces of code they start to differ. The one that differs
 * is always the one nobody is watching, and the difference is always found by a
 * stranger rather than by us.
 *
 * So the run itself lives here, once, and knows nothing about terminals or
 * browsers. It is handed a way of asking a person something and a way of saying
 * what is happening, and it uses those. What is asked, in what order, and what
 * counts as an answer are the same either way, because they are these lines.
 *
 * THE SIX PLACES IT STOPS
 *
 * A question the agent asked. Permission to spend. A business name close enough to
 * another that the rule sends it to a person. A value read off an identity
 * document that could not be matched cleanly. And the finished packet, which goes
 * nowhere until somebody names it against its own fingerprint.
 *
 * They are not alike, and the differences matter. Refusing a spend has to stop the
 * run rather than be treated as a maybe. An empty answer is not an answer and is
 * asked again. An approval nobody put their name to is not an approval.
 *
 * WHAT IT WILL NEVER DO
 *
 * Answer any of them itself. There is no path through this file where a run gets
 * past one of these six without a person having said something. That is the whole
 * argument of this project, and it is one file rather than two so that it can only
 * be true or false once.
 */

import { readFacts, runStage, advance } from '../agent/run.js'
import { NoProviderAvailable } from '../model/router.js'
import { STAGES, type StageName } from '../stages/stages.js'
import { whatToolDoes } from '../tools/words.js'
import { asMoney } from '../tools/guard.js'
import {
  grantSpendPermission,
  answerQuestion,
  approveSendingForSignature,
  checkIdentityField,
  decideAboutACloseName,
} from './human.js'

/** A way of asking a person something and waiting for what they say. */
export type AskAPerson = (prompt: string) => Promise<string>

/**
 * A way of saying what is going on, to whoever is watching.
 *
 * Every one of these is optional. A caller that wants none of it gets a run that
 * says nothing and works exactly the same.
 */
export interface Watching {
  /** A new step has started. */
  readonly onStep?: (step: {
    readonly name: StageName
    readonly position: number
    readonly of: number
    readonly title: string
    /** What happens here, in plain words. */
    readonly whatHappens: string
    /** What Charter is allowed to do here, in plain words, one phrase each. */
    readonly mayDo: readonly string[]
  }) => void
  /** Something happened inside a step. */
  readonly onEvent?: (kind: string, stage: StageName, detail: string) => void
  /** A person is being asked something, and nothing moves until they answer. */
  readonly onGate?: (question: string, extra?: readonly string[]) => void
  /** A remark worth showing next to whatever was just said. */
  readonly onNote?: (note: string) => void
}

/** How a run ended. Every one of these is a normal thing that can happen. */
export type Ending =
  /** All eight steps, finished. */
  | { readonly kind: 'finished' }
  /** A person said no to spending, or put no name to an approval. */
  | { readonly kind: 'refused'; readonly because: string }
  /** The run could not go on, for a reason no person can fix by answering. */
  | { readonly kind: 'stopped'; readonly because: string }
  /** Every model refused or was already at its daily limit. */
  | { readonly kind: 'no model'; readonly tried: readonly string[] }

/** The eight steps, in the order they run. */
export function everyStepInOrder(): readonly StageName[] {
  return Object.values(STAGES)
    .slice()
    .sort((one, other) => one.position - other.position)
    .map((one) => one.name)
}

/**
 * Ask the person whatever the run is waiting for, and record their answer.
 *
 * Gives back whether anything was actually asked. A run can also stop for reasons
 * a person cannot fix — the model gave up, a step ran out of turns — and the
 * caller has to be able to tell those apart from a question nobody has answered
 * yet. Saying "waiting for you" when nothing is waiting would leave somebody
 * staring at a prompt that will never move.
 */
export async function answerWhateverIsWaiting(
  ask: AskAPerson,
  act: Parameters<typeof answerQuestion>[0],
  options: Parameters<typeof runStage>[0],
  caseId: string,
  watch: Watching = {},
): Promise<boolean> {
  const facts = await readFacts(options.db, caseId)

  // 1. a question with nobody at the keyboard
  const question = facts.openQuestions[0]
  if (question !== undefined) {
    watch.onGate?.(question)
    const answer = (await ask(question)).trim()
    if (answer === '') {
      watch.onNote?.('An empty answer is not an answer. Asking again.')
      return await answerWhateverIsWaiting(ask, act, options, caseId, watch)
    }
    await answerQuestion(act, question, answer)
    return true
  }

  // 2. permission to spend, which no tool can grant
  // Anything asked for since the last permission, including a bigger limit when
  // the first one turned out to be too small.
  if (facts.spendRequested !== undefined && facts.spendRequested.sinceLastPermission) {
    const wants = facts.spendRequested
    watch.onGate?.(
      `Charter wants to spend up to ${asMoney(wants.limitCents)} on ${wants.forWhat}. ` +
        `It cannot give itself permission.`,
      [
        `The registrar is on its ${options.settings?.registrarEnv ?? 'test'} account, so ` +
          `nothing is actually charged.`,
      ],
    )
    const yes = (await ask(`allow up to ${asMoney(wants.limitCents)}? [y/N]`)).trim().toLowerCase()

    if (yes !== 'y' && yes !== 'yes') {
      watch.onNote?.('Not allowed. Charter will have to find another way or stop.')
      return false
    }

    await grantSpendPermission(act, wants.limitCents, wants.forWhat)
    return true
  }

  // 3. a name close enough to another that the rule sends it to a person
  if (facts.nameResearch?.verdict === 'needs-a-person') {
    watch.onGate?.(
      `A business was found with a name close to the one proposed. Charter will not ` +
        `decide whether that is too close.`,
      facts.nameResearch.collisions.map(
        (near) => `${near.foundName}  ${near.closeness}  ${near.where}`,
      ),
    )
    const answer = (await ask('is the proposed name clear of these? [y/N]')).trim().toLowerCase()
    const clear = answer === 'y' || answer === 'yes'

    // Written as a decision, not as an answer to a question. An answer sits in the
    // record and changes nothing, which is exactly what happened the first time
    // this ran for real: the person said it was clear, and was asked again, and
    // again, because nothing turned what they said into the verdict.
    await decideAboutACloseName(
      act,
      clear,
      facts.nameResearch.collisions.map((near) => `${near.foundName} (${near.closeness})`),
    )
    return true
  }

  // 4. values read off an identity document, which no tool can clear
  const review = facts.identityChecks.find((check) => check.toReview.length > 0)
  if (review !== undefined) {
    const field = review.toReview[0] as string
    watch.onGate?.(
      `A value read from ${review.owner}'s ID could not be matched cleanly: ${field}. ` +
        `Only somebody looking at the document can say.`,
    )
    const right = (await ask('is the value correct? [y/N]')).trim().toLowerCase()
    await checkIdentityField(
      act,
      review.owner,
      field,
      right === 'y' || right === 'yes' ? 'the value is correct' : 'the value is wrong',
    )
    return true
  }

  // 5. the boundary: nothing is sent until a person names the file
  if (facts.pack !== undefined && facts.approvalToSend === undefined) {
    watch.onGate?.(
      `The packet is ready. Nothing goes to anybody until you say so, and your ` +
        `approval names this exact file.`,
      [`fingerprint  ${facts.pack.fingerprint}`],
    )
    const who = (await ask('your name, to approve sending it')).trim()

    if (who === '') {
      watch.onNote?.('An approval nobody signed is not an approval.')
      return false
    }

    await approveSendingForSignature(act, who, facts.pack.fingerprint)
    return true
  }

  return false
}

/**
 * Every step, in order, stopping for a person whenever one is needed.
 *
 * Returns how it ended rather than printing anything or stopping the program. A
 * run that ends early is a normal outcome and the caller decides what that looks
 * like: a message in a terminal, a panel on a page, a failing exit code, or all
 * three.
 */
export async function driveEveryStep(input: {
  readonly options: Parameters<typeof runStage>[0]
  readonly act: Parameters<typeof answerQuestion>[0]
  readonly ask: AskAPerson
  readonly caseId: string
  readonly watch?: Watching
  /** Every model that was passed over, newest last, for the "no model" ending. */
  readonly skipped?: readonly string[]
}): Promise<Ending> {
  const watch = input.watch ?? {}
  const order = everyStepInOrder()

  let stage: StageName | undefined = order[0]

  while (stage !== undefined) {
    const here = STAGES[stage]
    watch.onStep?.({
      name: here.name,
      position: here.position,
      of: order.length,
      title: here.title,
      whatHappens: here.whatHappens,
      mayDo:
        here.tools.length === 0
          ? ['nothing at all. This is where it hands over to a person.']
          : here.tools.map((one) => whatToolDoes(one)),
    })

    for (;;) {
      let result
      try {
        result = await runStage(input.options, stage)
      } catch (problem) {
        // Every model refused, or was already at its limit for the day. That
        // happens on a free allowance and it is not a fault in the run, so it is
        // handed back as what it is rather than thrown at whoever is watching.
        if (problem instanceof NoProviderAvailable) {
          return { kind: 'no model', tried: input.skipped ?? [] }
        }
        throw problem
      }

      if (result.finished) break

      const answered = await answerWhateverIsWaiting(
        input.ask,
        input.act,
        input.options,
        input.caseId,
        watch,
      )

      // Nothing was waiting for a person, and the step did not finish. Something
      // else stopped it, and saying "waiting for you" here would leave somebody at
      // a prompt that never moves while the real reason went unsaid.
      if (!answered) return { kind: 'stopped', because: result.because }
    }

    stage = await advance(input.options, stage)
  }

  return { kind: 'finished' }
}
