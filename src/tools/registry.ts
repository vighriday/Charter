/**
 * Every tool the model can choose, and what each one is allowed to do.
 *
 * WHAT A TOOL IS HERE
 *
 * A named action with a fixed shape of arguments. The model is shown a list of
 * them, picks one, and fills in the arguments. Code checks the arguments, runs the
 * action, and writes what happened to the record.
 *
 * WHAT IS NOT IN THIS FILE, AND WHY THAT IS THE POINT
 *
 * There is no tool that asks a person to sign anything. Charter never signs on a
 * human's behalf, and the strongest form of that promise is not a rule the model
 * is asked to follow — it is a thing that does not exist in any list the model is
 * ever shown. A model cannot choose what it has never been offered.
 *
 * Two tests hold that. One walks every stage, collects every tool list, and fails
 * the build if anything signature-related appears anywhere. The other follows every
 * import out of this folder and fails the build if the signing module can be
 * reached from here through any chain of any length.
 *
 * WHY EACH TOOL DECLARES WHAT IT COSTS AND WHAT IT CHANGES
 *
 * Two flags, both used rather than decorative:
 *
 *   `reversible`   Can what this does be undone? Registering a web address cannot.
 *   `costsMoney`   Does running this spend real money?
 *
 * Anything that costs money is refused unless a person has already given
 * permission covering that amount. That check is in `guard.ts`, runs before the
 * tool does, and takes its answer from the record rather than from anything the
 * model said.
 *
 * The same two flags are what the printed catalogue is built from, so the list a
 * judge reads is generated from the code that actually runs rather than written
 * alongside it and left to drift.
 *
 * WHY TOOLS RETURN EVENTS INSTEAD OF CHANGING ANYTHING
 *
 * A tool returns two things: a small result for the model, and the entries to add
 * to the record. It never updates a running summary of the case, because there
 * isn't one. What Charter knows is always folded from the record, which is what
 * makes a run resumable after a crash and makes the summary unable to drift from
 * the truth.
 */

import type { JsonObject } from '../record/canonical.js'
import type { ToolSpec } from '../model/types.js'
import type { CaseFacts } from '../stages/facts.js'
import { STAGES, type StageName } from '../stages/stages.js'
import { assertSupported, asJsonSchema, type ArgumentSchema } from './schema.js'
import type { Services } from './services.js'
import type { Settings } from '../settings.js'

/** One entry to add to the record. */
export interface ToolEvent {
  readonly kind: string
  readonly payload: JsonObject
}

export interface ToolOutcome {
  /**
   * What goes back to the model.
   *
   * Kept small on purpose. Everything sent back is in the next request too, and
   * the request has a hard size ceiling that exists so the fallback provider stays
   * usable at all.
   */
  readonly result: JsonObject
  /** What to add to the record. Written by the caller, never by the tool. */
  readonly events: readonly ToolEvent[]
}

export interface ToolContext {
  readonly caseId: string
  /** Everything known so far, folded from the record. */
  readonly facts: CaseFacts
  /** The outside services, passed in so tests need none of them. */
  readonly services: Services
  /** Reads the current time. Passed in so tests are exact. */
  readonly now: () => Date
  /**
   * The settings this run was started with, already checked.
   *
   * Passed in rather than read from the environment inside a tool. A tool that
   * read a setting for itself would behave differently depending on what was in
   * the surrounding process, which makes it untestable and makes a recorded run
   * impossible to reproduce. Here, everything that steers a tool arrived through
   * this one object and can be written down.
   */
  readonly settings: Settings
}

export interface Tool {
  readonly name: string
  /** One line, shown to the model. What it does, not how. */
  readonly summary: string
  /**
   * Written for a person, and printed in the tool catalogue a judge can read.
   * What it exists for, what it touches outside Charter, and what it will not do.
   */
  readonly why: string
  readonly schema: ArgumentSchema
  /** False when running this changes something outside Charter that cannot be undone. */
  readonly reversible: boolean
  /** True when running this spends real money. */
  readonly costsMoney: boolean
  run(args: JsonObject, context: ToolContext): Promise<ToolOutcome>
}

export class UnknownTool extends Error {
  constructor(
    // Deliberately not called `name`. An error already has a `name`, and a field
    // of the same name would have been quietly overwritten one line later — the
    // message would have read correctly while the error identified itself wrongly.
    readonly toolName: string,
    readonly offered: readonly string[],
  ) {
    super(
      `there is no tool called "${toolName}". This stage offers: ` +
        `${offered.join(', ') || 'nothing'}. A tool that was never offered is never run, ` +
        `whatever the model asked for.`,
    )
    this.name = 'UnknownTool'
  }
}

export class ToolNotInThisStage extends Error {
  constructor(
    readonly toolName: string,
    readonly stage: StageName,
  ) {
    super(
      `"${toolName}" exists, but not in stage "${stage}". Tools change only when the ` +
        `stage changes, and the model was never shown this one.`,
    )
    this.name = 'ToolNotInThisStage'
  }
}

/**
 * All the tools, by name.
 *
 * Built through this function rather than written as a plain object so that every
 * tool's shape is checked the moment it is declared. A shape this project cannot
 * enforce is refused here, at startup, rather than silently going unchecked until
 * a model happens to fill in the field nobody was looking at.
 */
export function buildRegistry(tools: readonly Tool[]): ReadonlyMap<string, Tool> {
  const byName = new Map<string, Tool>()
  for (const tool of tools) {
    if (byName.has(tool.name)) {
      throw new Error(
        `two tools are both called "${tool.name}". Names are what the model sends ` +
          `back, so a duplicate means one of them can never be reached.`,
      )
    }
    assertSupported(tool.name, tool.schema)
    byName.set(tool.name, tool)
  }
  return byName
}

/**
 * The tools for one stage, in the form the model providers expect.
 *
 * This is the only place a tool list is built, and it takes the stage's own list
 * as the complete truth. Nothing else can add to it, so there is no path by which
 * a tool leaks into a stage that was not meant to have it.
 */
export function specsFor(registry: ReadonlyMap<string, Tool>, stage: StageName): ToolSpec[] {
  return STAGES[stage].tools.map((name) => {
    const tool = registry.get(name)
    if (tool === undefined) {
      throw new UnknownTool(name, [...registry.keys()])
    }
    return {
      name: tool.name,
      description: tool.summary,
      parameters: asJsonSchema(tool.schema),
    }
  })
}

/**
 * Find the tool the model asked for, refusing anything not in this stage.
 *
 * Two separate refusals, because they are two different mistakes and a person
 * reading the record needs to tell them apart: a tool that does not exist at all,
 * and a real tool reached for from the wrong stage.
 */
export function toolFor(
  registry: ReadonlyMap<string, Tool>,
  stage: StageName,
  name: string,
): Tool {
  const tool = registry.get(name)
  if (tool === undefined) throw new UnknownTool(name, STAGES[stage].tools)
  if (!STAGES[stage].tools.includes(name)) throw new ToolNotInThisStage(name, stage)
  return tool
}

/**
 * The tool catalogue, written out for a person to read.
 *
 * Generated from the same declarations the running code uses, so it cannot drift
 * from what actually happens. A hand-written list of an agent's capabilities is
 * only ever true on the day it is written.
 *
 * It is grouped by stage, and it says out loud which stages have no tools at all —
 * because the empty ones are the most interesting entries. Stage seven is where a
 * human signs, and its emptiness is the whole argument.
 */
export function catalogue(registry: ReadonlyMap<string, Tool>): string {
  const lines: string[] = []
  lines.push('What this agent can do, and in which stage')
  lines.push('')
  lines.push(
    'Generated from the code that runs. Each stage sends the model exactly the tools',
    'listed under it and nothing else, so a tool absent from a stage is not forbidden',
    'there — it does not exist there.',
  )
  lines.push('')

  for (const stage of Object.values(STAGES).sort((a, b) => a.position - b.position)) {
    lines.push(`${stage.position}. ${stage.title}`)
    lines.push(`   ${stage.whatHappens}`)
    if (stage.tools.length === 0) {
      lines.push(
        `   No tools. The model is asked for nothing in this stage.`,
        stage.name === 'boundary'
          ? `   This is the stage where a person signs. Its emptiness is the design.`
          : `   This stage is not built yet.`,
      )
      lines.push('')
      continue
    }
    for (const name of stage.tools) {
      const tool = registry.get(name)
      if (tool === undefined) {
        lines.push(`   ${name} — MISSING from the registry`)
        continue
      }
      const marks: string[] = []
      if (tool.costsMoney) marks.push('spends money')
      if (!tool.reversible) marks.push('cannot be undone')
      lines.push(`   ${tool.name}${marks.length > 0 ? `  [${marks.join(', ')}]` : ''}`)
      lines.push(`      ${tool.why}`)
    }
    lines.push('')
  }

  lines.push('Not on this list, and not reachable from anything on it:')
  lines.push('   Asking a person to sign. Charter never signs on a human\'s behalf, and')
  lines.push('   there is no tool for it in any stage. A test follows every import out of')
  lines.push('   the tool folder and fails the build if the signing module can be reached')
  lines.push('   from it through any chain of any length.')
  return lines.join('\n')
}
