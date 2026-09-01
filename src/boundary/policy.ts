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
 * `src/tools/` holds the tools themselves and the code that checks and runs them.
 * `src/agent/` holds the loop that asks the model for one choice and carries it
 * out. Between them, that is everything a decision by the model can set in motion.
 *
 * These folders were named here before either existed, so the rules below were
 * enforced from the very first handler rather than from whenever somebody
 * remembered. A test now fails the build if they ever go empty again, because an
 * empty set would make the reach check pass for the wrong reason.
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
    // Written down on 30 August 2026, the day the module arrived. The rule had
    // been armed since 28 August with a note saying the code did not exist yet,
    // and a test asserting the folder really was empty. Creating the first file
    // in it failed the build until this line was filled in, which is exactly what
    // that note was for: permission granted deliberately and in the open, never
    // acquired by accident.
    //
    // One file, and it is not part of the agent. It runs after a person has
    // approved, reads that approval out of the append-only record rather than
    // being handed it, and is itself unreachable from anything the model can
    // trigger.
    mayReach: ['src/case/send-for-signature.ts'],
  },
  {
    name: 'the human consent path',
    why:
      'The only code that writes a granted permission to spend, and a recorded ' +
      'answer from a person. The agent has a tool for ASKING for permission and no ' +
      'tool for granting one, and this is what makes that structural rather than a ' +
      'rule somebody has to keep. If anything the model can trigger could reach ' +
      'this, a model could be talked into granting itself permission and then ' +
      'spending under it, and every check downstream would be arguing with a ' +
      'permission that looked completely genuine. The one file listed below is the ' +
      "demonstration, which stands in for a person's browser. It does not live in " +
      "the agent's folder, and it was moved out of it because this check refused " +
      'the build while it was there.',
    guards: ['src/case/human.ts'],
    mayReach: [
      'src/case/demo.ts',
      // The live run: somebody brings their own business idea and answers at a
      // keyboard. It reaches this module for the same reason the demonstration
      // does, and more honestly: here there really is a person typing.
      //
      // Allowed deliberately, in the open, because that is the only way anything
      // gets past this rule. The rule's purpose is untouched. Nothing the model can
      // trigger reaches this file: it is a command a person types, it does the
      // asking itself, and the agent has no tool that could cause any of it.
      'src/case/live.ts',
      // The run itself, which is now one piece of code rather than one per way in.
      // It is the file that decides when Charter stops and waits for a person, and
      // it therefore has to be able to write down what the person said.
      //
      // This is the file the rule is really about, and it is worth being exact
      // about why letting it through does not weaken anything. It never answers
      // anything itself: every one of the six places it stops calls out through a
      // function it was handed, waits, and writes down whatever came back. It has
      // no model, no tools, and no way to reach either. What it can do is record
      // that a person said something, which is the same power the terminal and the
      // browser already have and the whole reason both of them exist.
      'src/case/drive.ts',
      // The website's run panel, and the small server behind it.
      //
      // This is the largest thing this rule has ever been asked to let through,
      // and it is worth setting out exactly what it is and is not, because
      // "anybody on the internet can reach the consent path" sounds alarming and
      // the truthful version is narrower.
      //
      // What actually happens: a visitor starts a run, and is given a secret made
      // for that run alone. The run reaches one of the six things only a person may
      // decide and stops. The page shows the question. The visitor answers, and the
      // answer comes back with that secret. The server checks the secret and writes
      // down what they said. That is the whole of it.
      //
      // What is unchanged: the model still cannot cause any of it. There is no tool
      // that posts an answer, no tool that can reach this file, and no path from a
      // model turn to a consent entry. What arrives here arrived from outside, from
      // a person, over a connection that had to carry a secret only that person was
      // given. That is the same shape as the terminal, where the secret is that you
      // are the one at the keyboard.
      //
      // What this DOES widen, honestly stated: before this, being at the machine
      // was the proof. Now the proof is holding the run's secret. Somebody who
      // could read that secret in transit could answer somebody else's questions.
      // That is the reason the secret is per run, is never in a page address, is
      // never written to disk, and dies with the run.
      'src/serve/runs.ts',
      'src/serve/server.ts',
    ],
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
    mayReach: [
      'src/record/generate-keys.ts',
      'src/record/demo.ts',
      // The check a stranger runs against a finished pack. It reaches this module
      // to VERIFY an attestation, using the public half of the key read from this
      // repository — which is the whole point of publishing that half. It is a
      // command a person types, not anything the model can set in motion, and the
      // rule above still proves that separately.
      'src/verify/check.ts',
      'src/verify/cli.ts',
      // The whole-run demonstration. It reaches this to attest over the record it
      // just produced, so that a person watching can immediately run the checker
      // against the pack and the record and see every answer come back yes.
      //
      // Allowed for the same reason as the two above it: this is a command a
      // person types into a terminal, not anything the model can set in motion.
      // The rule's actual purpose — that nothing the model can trigger may vouch
      // for a record the model wrote — is untouched, and this file is already
      // guarded separately as the code that stands in for a person's browser.
      'src/case/demo.ts',
      // The live run, for the same reason: it attests over the record it just
      // produced so the person who ran it can check their own packet immediately.
      // A command somebody types, never anything the model sets in motion.
      'src/case/live.ts',
      // The website's run panel, for exactly the same reason as the two above: a
      // visitor who has just watched a run needs to be able to download its record
      // and its attestation and check them on their own machine. Without the
      // attestation the record is a text file with no claim attached to it, which
      // is the one thing this whole project argues against.
      //
      // The rule's purpose is that nothing the model can set in motion may vouch
      // for a record the model wrote. That is untouched. This signs over a finished
      // record, once, at the end, in code no tool can reach.
      'src/serve/runs.ts',
      'src/serve/server.ts',
    ],
  },
  {
    name: 'the credential check',
    why:
      'This is the command a person runs to find out which outside company each ' +
      'of our credentials belongs to. A credential is a long string of characters ' +
      'that proves to a company we are allowed to use their service. To do its ' +
      'job this code reads EVERY credential in the settings file and sends some ' +
      'of them to the companies that issued them. That is exactly right for a ' +
      'command a person types, and exactly wrong for anything a model can set in ' +
      'motion: a model that could reach it could read every key we hold. Nothing ' +
      'in the running product needs it, so nothing but itself may reach it, and ' +
      'this rule fails the build the day something does.',
    guards: ['src/checks/'],
    mayReach: [],
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
