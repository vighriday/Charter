/**
 * Runs started from the website, and how a browser answers the questions.
 *
 * WHAT THIS IS
 *
 * Somebody opens the website, types what their business is, and presses a button.
 * Charter then does the same eight steps it does in a terminal, on their idea,
 * with real services. When it reaches something only a person can decide, the page
 * shows the question and waits, and the run does not move until they answer.
 *
 * WHY IT IS NOT A SECOND COPY OF ANYTHING
 *
 * The run itself is src/case/drive.ts, the same file `npm start` uses. This adds
 * two things and nothing else: a way of asking that resolves when an answer
 * arrives over the network instead of from a keyboard, and a list of what has
 * happened so far that a page can read repeatedly without missing anything.
 *
 * WHY A RUN IS HELD IN MEMORY AND NOT SOMEWHERE PERMANENT
 *
 * Every run gets its own small database inside this program, and when the program
 * stops, it is gone. That is deliberate for something anybody on the internet can
 * start: nothing a stranger types is kept, nothing about them is stored, and there
 * is no pile of other people's business plans sitting on a disk. The three files
 * their run produced can be downloaded while it is running, which is the point.
 *
 * WHY A RUN CAN BE FORGOTTEN WHILE IT IS STILL WAITING
 *
 * Most people who start something on a website do not finish it. A run waiting for
 * an answer that never comes would hold the one running slot forever and stop
 * everybody else. So a run that nobody has touched for a while is ended, said so
 * plainly, and its slot given back.
 */

import { randomBytes } from 'node:crypto'

import { openBuiltIn, type Database } from '../db/driver.js'
import { migrate } from '../db/migrate.js'
import { readEvents, readHead, readPayload } from '../record/log.js'
import { attest, generateKeyPair, privateKeyFromEnv } from '../record/attestation.js'
import { buildRegistry, type Tool } from '../tools/registry.js'
import { ALL_TOOLS } from '../tools/stage-tools.js'
import { answerQuestion, writeDownWhatTheySaid } from '../case/human.js'
import { driveEveryStep, type AskAPerson, type Ending } from '../case/drive.js'
import type { StageName } from '../stages/stages.js'
import { buildRouter } from '../model/build.js'
import { chooseServices, describeChoices } from '../vendors/build.js'
import type { Settings } from '../settings.js'

/** One line in the feed a page shows. */
export interface Line {
  readonly at: number
  readonly kind:
    | 'step'
    | 'event'
    | 'gate'
    | 'note'
    | 'ended'
  readonly text: string
  /** Extra lines belonging to the one above, such as the names found. */
  readonly extra?: readonly string[]
}

/** What the run is waiting for, if anything. */
export interface Waiting {
  readonly question: string
  /** `words` wants typing. `yes-no` is a choice. `name` is somebody's own name. */
  readonly answerWith: 'words' | 'yes-no' | 'name'
  readonly extra?: readonly string[]
}

export interface RunView {
  readonly id: string
  readonly startedAt: number
  readonly lines: readonly Line[]
  readonly waiting: Waiting | null
  readonly finished: boolean
  readonly ending: Ending | null
  /** Which outside services are real in this run, in plain words. */
  readonly whatIsReal: readonly string[]
  /** The files, when there are any. */
  readonly files: readonly string[]
}

interface HeldRun {
  readonly id: string
  readonly token: string
  readonly startedAt: number
  readonly lines: Line[]
  waiting: (Waiting & { readonly settle: (answer: string) => void }) | null
  finished: boolean
  ending: Ending | null
  touchedAt: number
  db: Database | null
  whatIsReal: string[]
  files: string[]
  packBytes: Uint8Array | null
  recordText: string | null
  attestationText: string | null
}

/**
 * Whether two secrets match, compared without leaking where they first differ.
 *
 * An ordinary comparison stops at the first character that differs, so how long it
 * takes says something about how much of a guess was right. That is a thin channel
 * and a real one, and there is no reason to leave it open when closing it is four
 * lines.
 *
 * Written once and used by everything that checks a secret, because two copies of
 * this would eventually be one careful copy and one ordinary one.
 */
export function sameSecret(sent: string, expected: string): boolean {
  if (sent.length !== expected.length) return false
  let difference = 0
  for (let at = 0; at < sent.length; at += 1) {
    difference |= sent.charCodeAt(at) ^ expected.charCodeAt(at)
  }
  return difference === 0
}

/** How a question should be answered, worked out from how it was asked. */
export function answerKind(question: string): Waiting['answerWith'] {
  if (/\[y\/N\]/i.test(question)) return 'yes-no'
  if (/your name, to approve/i.test(question)) return 'name'
  return 'words'
}

/** How long a run may sit waiting for an answer nobody sends, in milliseconds. */
export const PATIENCE_WITH_A_VISITOR = 10 * 60 * 1000

export interface RunnerOptions {
  readonly settings: Settings
  readonly env?: Record<string, string | undefined>
  /** Told when a run ends, however it ends, so a slot can be given back. */
  readonly onEnded?: () => void
  readonly now?: () => number
}

export class Runs {
  private readonly held = new Map<string, HeldRun>()
  private readonly options: RunnerOptions
  private readonly now: () => number

  constructor(options: RunnerOptions) {
    this.options = options
    this.now = options.now ?? ((): number => Date.now())
  }

  /** Everything a page is allowed to see about a run. */
  view(id: string): RunView | null {
    const run = this.held.get(id)
    if (run === undefined) return null

    return {
      id: run.id,
      startedAt: run.startedAt,
      lines: run.lines,
      waiting:
        run.waiting === null
          ? null
          : {
              question: run.waiting.question,
              answerWith: run.waiting.answerWith,
              ...(run.waiting.extra === undefined ? {} : { extra: run.waiting.extra }),
            },
      finished: run.finished,
      ending: run.ending,
      whatIsReal: run.whatIsReal,
      files: run.files,
    }
  }

  /**
   * The secret for a run, for the server to compare against what was sent.
   *
   * Given out once, to whoever started the run, and never again. It is needed to
   * READ a run as well as to answer one: a run's feed carries the business
   * description in the owners' own words, and its record carries their names and
   * every answer they gave. A run that could be read by anybody who guessed its
   * name would be a pile of strangers' business plans with a thin lid on it.
   */
  tokenFor(id: string): string | null {
    return this.held.get(id)?.token ?? null
  }

  fileFor(id: string, which: 'pack' | 'record' | 'attestation'): Uint8Array | string | null {
    const run = this.held.get(id)
    if (run === undefined) return null
    if (which === 'pack') return run.packBytes
    if (which === 'record') return run.recordText
    return run.attestationText
  }

  /**
   * Answer whatever a run is waiting for.
   *
   * The token has to match. Without it, anybody who could guess a run's name could
   * answer somebody else's question — including the one that gives permission to
   * spend, and the one that approves sending a packet.
   */
  answer(id: string, token: string, answer: string): 'ok' | 'not waiting' | 'not you' {
    const run = this.held.get(id)
    if (run === undefined) return 'not waiting'
    if (!sameSecret(token, run.token)) return 'not you'
    const waiting = run.waiting
    if (waiting === null) return 'not waiting'

    run.waiting = null
    run.touchedAt = this.now()
    waiting.settle(answer)
    return 'ok'
  }

  /** End anything nobody has touched for a while, and give its slot back. */
  forgetTheAbandoned(): void {
    for (const run of this.held.values()) {
      if (run.finished) continue
      if (this.now() - run.touchedAt < PATIENCE_WITH_A_VISITOR) continue

      run.lines.push({
        at: this.now(),
        kind: 'ended',
        text:
          'Nobody answered for ten minutes, so this run was ended and its place given ' +
          'to whoever is next. Nothing was decided on your behalf. Start again whenever ' +
          'you like.',
      })
      run.finished = true
      run.ending = { kind: 'stopped', because: 'nobody answered' }
      // Frees whatever is waiting inside the run, so the promise the driver is
      // holding does not sit there for the life of the program.
      run.waiting?.settle('')
      run.waiting = null
      this.options.onEnded?.()
    }
  }

  /**
   * Start a run and let it go.
   *
   * Returns as soon as the run has a name, because the first model call takes
   * seconds and a browser waiting on a reply for that long looks broken. Everything
   * after that is read by asking for the run again.
   */
  async start(input: {
    readonly description: string
    readonly state: string
  }): Promise<{ readonly id: string; readonly token: string }> {
    // Sixteen bytes, not four.
    //
    // Four bytes is about four billion names, which sounds like a lot and is not:
    // a name is the thing that appears in a web address, and web addresses get
    // guessed at by anybody who feels like trying. The secret below is what
    // actually protects a run — see the note on `answer` and the reading rule in
    // src/serve/server.ts — and this simply stops the name itself being a weak
    // second door standing next to a strong first one.
    const id = `web-${randomBytes(16).toString('hex')}`
    const token = randomBytes(24).toString('hex')

    const run: HeldRun = {
      id,
      token,
      startedAt: this.now(),
      lines: [],
      waiting: null,
      finished: false,
      ending: null,
      touchedAt: this.now(),
      db: null,
      whatIsReal: [],
      files: [],
      packBytes: null,
      recordText: null,
      attestationText: null,
    }
    this.held.set(id, run)

    // Deliberately not awaited. The caller gets the run's name straight away and
    // watches it from there.
    void this.go(run, input.description, input.state)

    return { id, token }
  }

  private async go(run: HeldRun, description: string, state: string): Promise<void> {
    const env = this.options.env ?? process.env
    const settings = this.options.settings

    try {
      const models = buildRouter({
        settings,
        env,
        onAttempt: (attempt) => {
          if (attempt.outcome === 'answered') return
          run.lines.push({
            at: this.now(),
            kind: 'event',
            text: `a model was passed over: ${attempt.providerId}, ${attempt.outcome}${
              attempt.detail === undefined ? '' : ` (${attempt.detail})`
            }`,
          })
        },
      })

      if (models.router === null) {
        run.lines.push({ at: this.now(), kind: 'ended', text: models.why })
        run.finished = true
        run.ending = { kind: 'stopped', because: models.why }
        this.options.onEnded?.()
        return
      }

      const db = await openBuiltIn()
      await migrate(db)
      run.db = db

      const clock = (): Date => new Date()
      const registry: ReadonlyMap<string, Tool> = buildRegistry(ALL_TOOLS)
      const services = chooseServices({ settings, caseId: run.id, env, prepared: {} })

      run.whatIsReal = [models.why, ...describeChoices(services)]

      const options = {
        db,
        caseId: run.id,
        clock,
        registry,
        router: models.router,
        services,
        settings,
        keepPack: async (bytes: Uint8Array): Promise<void> => {
          run.packBytes = bytes
          if (!run.files.includes('pack.pdf')) run.files.push('pack.pdf')
        },
        onEvent: (kind: string, _stage: StageName, detail: string): void => {
          run.lines.push({ at: this.now(), kind: 'event', text: `${kind} — ${detail}` })
        },
      }

      const act = { db, caseId: run.id, token: run.token, expectedToken: run.token, clock }

      // The same two facts the terminal writes down, for the same reason: what
      // somebody typed is written down as they typed it, not as a model retyped it.
      await answerQuestion(act, 'Describe the business in your own words.', description)
      await writeDownWhatTheySaid(act, 'description', description)
      if (state !== '') {
        await answerQuestion(act, 'Which US state will it be formed in?', state)
        await writeDownWhatTheySaid(act, 'state', state)
      }

      const ask: AskAPerson = async (question) =>
        await new Promise<string>((settle) => {
          run.touchedAt = this.now()
          run.waiting = { question, answerWith: answerKind(question), settle }
        })

      const ending = await driveEveryStep({
        options,
        act,
        ask,
        caseId: run.id,
        watch: {
          onStep: (step) =>
            run.lines.push({
              at: this.now(),
              kind: 'step',
              text: `Step ${step.position} of ${step.of} — ${step.title}`,
              extra: [step.whatHappens, `It may: ${step.mayDo.join('; ')}`],
            }),
          onGate: (question, extra) =>
            run.lines.push({
              at: this.now(),
              kind: 'gate',
              text: question,
              ...(extra === undefined ? {} : { extra }),
            }),
          onNote: (note) => run.lines.push({ at: this.now(), kind: 'note', text: note }),
        },
      })

      run.ending = ending
      await this.keepTheFiles(run, db, clock)
      run.lines.push({
        at: this.now(),
        kind: 'ended',
        text:
          ending.kind === 'finished'
            ? 'All eight steps are done. Your packet, the record of everything that ' +
              'happened, and the attestation over that record are below. Nothing in the ' +
              'packet has been signed, and Charter cannot sign it.'
            : ending.kind === 'no model'
              ? 'No model was left that could answer. Free allowances come back at ' +
                'midnight in the provider own time zone. Everything up to here is in the ' +
                'record below, and nothing was made up to get past it.'
              : `Stopped: ${ending.because} Everything up to here is in the record below, ` +
                `and nothing was made up to get past it.`,
      })
    } catch (problem) {
      // Anything unexpected. The record still gets written, because a run that
      // failed halfway is exactly the kind somebody wants to read afterwards.
      const said = problem instanceof Error ? problem.message : String(problem)
      run.ending = { kind: 'stopped', because: said }
      if (run.db !== null) {
        await this.keepTheFiles(run, run.db, () => new Date()).catch(() => undefined)
      }
      run.lines.push({
        at: this.now(),
        kind: 'ended',
        text: `Stopped: ${said}`,
      })
    } finally {
      run.finished = true
      run.waiting = null
      this.options.onEnded?.()
    }
  }

  /** The three files, held in memory, exactly as a terminal run writes them. */
  private async keepTheFiles(run: HeldRun, db: Database, clock: () => Date): Promise<void> {
    const written: string[] = []
    for (const event of await readEvents(db, run.id)) {
      const payload = await readPayload(db, run.id, event.seq)
      written.push(JSON.stringify(payload === null ? event : { ...event, payload }))
    }
    run.recordText = `${written.join('\n')}\n`
    if (!run.files.includes('record.jsonl')) run.files.push('record.jsonl')

    const head = await readHead(db, run.id)
    const ours = privateKeyFromEnv()
    const keys = ours === undefined ? generateKeyPair() : undefined
    const privateKeyPem = ours ?? (keys as NonNullable<typeof keys>).privateKeyPem

    run.attestationText = `${JSON.stringify(
      attest(
        { runId: run.id, head: head.head, count: head.count, attestedAt: clock().toISOString() },
        privateKeyPem,
      ),
      null,
      2,
    )}\n`
    if (!run.files.includes('attestation.json')) run.files.push('attestation.json')
  }
}
