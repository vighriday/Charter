/**
 * What must not be able to reach what, and why.
 *
 * WHAT THIS FILE IS
 *
 * A short list of rules about which parts of this program are allowed to call
 * which other parts. Each rule names something that must stay out of reach, says
 * plainly why, and lists the complete set of files permitted to reach it.
 *
 * `tests/boundary.test.ts` reads this list, follows every import in the project,
 * and fails the build if any rule is broken. Nothing here is advice or a comment.
 * These are the rules the build actually enforces.
 *
 * WHY THE RULES LIVE IN THEIR OWN FILE
 *
 * So they can be read without reading any code. A person deciding whether to trust
 * Charter's central promise — that the software never signs on a person's behalf —
 * should be able to open one short file, see the promise written as a rule, and
 * then run `npm test` on their own machine to see it checked. If the rules were
 * buried inside the test that checks them, they would only be legible to people
 * who read tests.
 *
 * WHY BOTH DIRECTIONS ARE WRITTEN DOWN
 *
 * Each rule says two things, and the second is the one that does the work today.
 *
 *   1. Nothing the model can trigger may reach this.
 *   2. Here is the *complete* list of everything in the whole project that can
 *      reach this.
 *
 * Rule 1 only tests the agent's own code, which means it tests nothing until that
 * code exists. Rule 2 tests the entire project at once, right now — and it stays
 * useful afterwards, because a new file that gains the ability to reach a guarded
 * module fails the build until somebody writes down that it may. Permission has to
 * be granted deliberately and in the open, never acquired by accident.
 */

/** A file, or a folder if it ends in `/`. Paths are relative to the project root. */
export type PathPattern = string

export interface Boundary {
  /** What is being kept out of reach, in plain words. */
  readonly name: string
  /** Why it matters, and what goes wrong if the rule breaks. */
  readonly why: string
  /** The files being guarded. */
  readonly guards: readonly PathPattern[]
  /**
   * Every file in the project permitted to reach the guarded files, directly or
   * through any number of steps. Anything else that can reach them fails the
   * build. A guarded file always reaches itself, so it need not be listed.
   */
  readonly mayReach: readonly PathPattern[]
  /**
   * Set only while the guarded code has not been written yet, with the reason.
   *
   * This is not a way to switch a rule off. The test asserts that a boundary
   * marked this way really does match no file on disk — so the day the code
   * arrives, the build fails until this line is deleted and the rule turned on.
   * A note that expires by itself, rather than one somebody has to remember.
   */
  readonly notBuiltYet?: string
}

/**
 * Where the agent's own code lives: the tool handlers, meaning the code that runs
 * when the model chooses to do something.
 *
 * Nothing here exists yet. The tool registry is the first thing built on day two,
 * and it goes in `src/tools/`. Naming the folder before it exists is deliberate —
 * the check is already written and already running, so the boundary is enforced
 * from the very first handler rather than from whenever somebody remembers.
 */
export const AGENT_REACHABLE: readonly PathPattern[] = ['src/tools/', 'src/agent/']

export const BOUNDARIES: readonly Boundary[] = [
  {
    name: 'the signing module',
    why:
      'This is the module that carries a finished document to a person and asks ' +
      'them to sign it. Charter promises that the software never signs on a ' +
      "person's behalf, and that promise is only worth something if the agent " +
      'cannot start a signature at all. Absence from every tool list is the first ' +
      'guard; this is the second, and it holds even if the first is got wrong, ' +
      'because code that cannot be reached cannot be run whatever the model asks ' +
      'for. Only ordinary code, running after a recorded human approval, may call ' +
      'it.',
    guards: ['src/sign/'],
    mayReach: [],
    notBuiltYet:
      'The signature request is built on day five. The rule is written now so it ' +
      'is enforced from the first line of that module rather than added afterwards.',
  },
  {
    name: 'the attestation key',
    why:
      "This module holds the private key that vouches for Charter's own record. " +
      'If anything the model can trigger could reach it, the model could write ' +
      'the record and then vouch for what it wrote, and the record would prove ' +
      'nothing to anybody. The two files permitted below are both commands a ' +
      'person runs from a terminal, not anything the model can cause: one makes ' +
      'the key pair, the other is the demonstration that shows the record being ' +
      'checked.',
    guards: ['src/record/attestation.ts'],
    mayReach: ['src/record/generate-keys.ts', 'src/record/demo.ts'],
  },
]

/**
 * Does this file match one of these patterns?
 *
 * A pattern ending in `/` means the folder and everything beneath it. Anything
 * else means exactly that one file. Deliberately not a general pattern language:
 * these rules are read by people deciding whether to trust the promise, and a rule
 * nobody can read without learning a syntax first is a rule nobody checks.
 */
export function matches(file: string, patterns: readonly PathPattern[]): boolean {
  return patterns.some((pattern) =>
    pattern.endsWith('/') ? file.startsWith(pattern) : file === pattern,
  )
}

/** Every file in the project that a set of patterns actually picks out today. */
export function filesMatching(files: readonly string[], patterns: readonly PathPattern[]): string[] {
  return files.filter((file) => matches(file, patterns))
}
