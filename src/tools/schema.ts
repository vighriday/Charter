/**
 * Checking what the model sent against what it was told to send.
 *
 * WHY THIS EXISTS
 *
 * Before any tool runs, its arguments are checked against the shape that tool
 * declared. If they are wrong, the model is sent a message naming the offending
 * field, the type expected and the values allowed, and it tries again — twice at
 * most.
 *
 * This is not defensive padding. Published work on tool use found that this exact
 * feedback is what lets a mid-tier model correct its own argument names and its
 * own choice of function. It is the single highest-value thing that makes a free
 * model behave like a much better one, and Charter runs entirely on free models.
 *
 * ONE SHAPE, NOT TWO
 *
 * The shape sent to the model and the shape used to check its answer are the same
 * value, not two descriptions kept in step by hand. That matters more than it
 * sounds: two schemas that are supposed to agree eventually do not, and the
 * failure is that the model is told one thing and judged by another — which looks
 * exactly like the model being stupid, and is impossible to debug from the outside.
 *
 * WHY A SMALL CHECKER RATHER THAN A LIBRARY
 *
 * The full JSON Schema standard is large, and almost none of it is usable here.
 * Tool arguments have to be flat and small: the providers restrict what they
 * accept, and every extra layer of nesting measurably worsens how well a small
 * model fills them in. So the shapes Charter uses are one level deep, with a
 * handful of field types.
 *
 * A checker for exactly that is about a hundred lines, has no dependency, and —
 * the part that actually matters — can produce a repair message that names the
 * field and lists the allowed values. A general library reports violations against
 * a specification; a model needs to be told what to write instead.
 *
 * Anything outside the supported subset is refused when the tool is declared,
 * rather than quietly ignored while checking. A rule that is silently not enforced
 * is worse than no rule.
 */

import type { JsonObject, JsonValue } from '../record/canonical.js'

// ─────────────────────────────────────────────────────────────────────────────
// The shapes a tool argument may have
// ─────────────────────────────────────────────────────────────────────────────

export type FieldType = 'string' | 'number' | 'integer' | 'boolean' | 'array'

/** One field of a tool's arguments. */
export interface FieldSchema {
  readonly type: FieldType
  /** What the field is for, shown to the model. */
  readonly description: string
  /** The complete set of permitted values, when there is one. */
  readonly enum?: readonly string[]
  /** For an array: what each item must be. Only simple items are supported. */
  readonly items?: { readonly type: 'string' | 'number' | 'integer' | 'boolean' }
  readonly minimum?: number
  readonly maximum?: number
  readonly minLength?: number
  readonly maxLength?: number
  readonly minItems?: number
}

/** The whole shape of one tool's arguments: an object with named fields. */
export interface ArgumentSchema {
  readonly type: 'object'
  readonly properties: Readonly<Record<string, FieldSchema>>
  readonly required: readonly string[]
  /** Always false. Extra fields are a mistake worth reporting, never ignored. */
  readonly additionalProperties: false
}

export class BadSchema extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'BadSchema'
  }
}

/**
 * Refuse a schema this checker cannot enforce.
 *
 * Called when a tool is declared, so the failure happens at the moment somebody
 * writes something unsupported, rather than months later when a model happens to
 * fill in the field that was never being checked.
 */
export function assertSupported(name: string, schema: ArgumentSchema): void {
  const where = (field: string) => `tool "${name}", field "${field}"`

  for (const [field, spec] of Object.entries(schema.properties)) {
    if (spec.enum !== undefined && spec.type !== 'string') {
      throw new BadSchema(
        `${where(field)}: a fixed list of values is only supported for text fields, ` +
          `and this one is "${spec.type}".`,
      )
    }
    if (spec.enum !== undefined && spec.enum.length === 0) {
      throw new BadSchema(`${where(field)}: an empty list of allowed values permits nothing at all.`)
    }
    if (spec.type === 'array' && spec.items === undefined) {
      throw new BadSchema(
        `${where(field)}: an array must say what its items are, or nothing about them ` +
          `is being checked.`,
      )
    }
    if (spec.description.trim() === '') {
      throw new BadSchema(
        `${where(field)}: every field needs a description. It is the only thing telling ` +
          `the model what to put there, and a small model fills in an undescribed field badly.`,
      )
    }
  }

  for (const field of schema.required) {
    if (!Object.hasOwn(schema.properties, field)) {
      throw new BadSchema(
        `tool "${name}" requires a field "${field}" that it never describes. The model ` +
          `would be asked for something it was never told about.`,
      )
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// What went wrong
// ─────────────────────────────────────────────────────────────────────────────

export interface Problem {
  /** The field, or `''` when the whole value is wrong. */
  readonly field: string
  /** What is wrong, in a few plain words. */
  readonly what: string
  /** What the field should be, written the way the model should read it. */
  readonly expected: string
  /** What arrived, written short enough to put in a message. */
  readonly found: string
  /** The permitted values, when the field has a fixed list. */
  readonly allowed?: readonly string[]
}

export type Check = { readonly ok: true } | { readonly ok: false; readonly problems: readonly Problem[] }

const shortly = (value: JsonValue | undefined): string => {
  if (value === undefined) return 'nothing'
  const text = typeof value === 'string' ? `"${value}"` : JSON.stringify(value)
  return text.length > 60 ? `${text.slice(0, 57)}…` : text
}

const nameOfType = (value: JsonValue): string => {
  if (value === null) return 'nothing'
  if (Array.isArray(value)) return 'a list'
  switch (typeof value) {
    case 'string':
      return 'text'
    case 'number':
      return Number.isInteger(value) ? 'a whole number' : 'a number'
    case 'boolean':
      return 'true or false'
    default:
      return 'an object'
  }
}

const readable = (type: FieldType): string => {
  switch (type) {
    case 'string':
      return 'text'
    case 'number':
      return 'a number'
    case 'integer':
      return 'a whole number'
    case 'boolean':
      return 'true or false'
    case 'array':
      return 'a list'
  }
}

/** Check one set of arguments against one tool's shape. */
export function checkArguments(schema: ArgumentSchema, args: JsonObject): Check {
  const problems: Problem[] = []

  for (const field of schema.required) {
    if (!Object.hasOwn(args, field) || args[field] === undefined || args[field] === null) {
      const spec = schema.properties[field]
      problems.push({
        field,
        what: 'missing, and it is required',
        expected: spec === undefined ? 'a value' : `${readable(spec.type)} — ${spec.description}`,
        found: 'nothing',
        ...(spec?.enum === undefined ? {} : { allowed: spec.enum }),
      })
    }
  }

  for (const [field, value] of Object.entries(args)) {
    const spec = schema.properties[field]
    if (spec === undefined) {
      problems.push({
        field,
        what: 'not a field this tool has',
        expected: `one of: ${Object.keys(schema.properties).join(', ')}`,
        found: shortly(value),
      })
      continue
    }
    if (value === undefined || value === null) continue
    problems.push(...checkField(field, spec, value))
  }

  return problems.length === 0 ? { ok: true } : { ok: false, problems }
}

function checkField(field: string, spec: FieldSchema, value: JsonValue): Problem[] {
  const wrongType = (): Problem => ({
    field,
    what: `should be ${readable(spec.type)}`,
    expected: `${readable(spec.type)} — ${spec.description}`,
    found: `${nameOfType(value)}, ${shortly(value)}`,
    ...(spec.enum === undefined ? {} : { allowed: spec.enum }),
  })

  switch (spec.type) {
    case 'string': {
      if (typeof value !== 'string') return [wrongType()]
      const problems: Problem[] = []
      if (spec.enum !== undefined && !spec.enum.includes(value)) {
        problems.push({
          field,
          what: 'not one of the permitted values',
          expected: spec.description,
          found: shortly(value),
          allowed: spec.enum,
        })
      }
      if (spec.minLength !== undefined && value.length < spec.minLength) {
        problems.push({
          field,
          what: `too short — at least ${spec.minLength} characters`,
          expected: spec.description,
          found: `${value.length} characters`,
        })
      }
      if (spec.maxLength !== undefined && value.length > spec.maxLength) {
        problems.push({
          field,
          what: `too long — at most ${spec.maxLength} characters`,
          expected: spec.description,
          found: `${value.length} characters`,
        })
      }
      return problems
    }

    case 'number':
    case 'integer': {
      if (typeof value !== 'number' || !Number.isFinite(value)) return [wrongType()]
      if (spec.type === 'integer' && !Number.isInteger(value)) return [wrongType()]
      const problems: Problem[] = []
      if (spec.minimum !== undefined && value < spec.minimum) {
        problems.push({
          field,
          what: `too small — at least ${spec.minimum}`,
          expected: spec.description,
          found: String(value),
        })
      }
      if (spec.maximum !== undefined && value > spec.maximum) {
        problems.push({
          field,
          what: `too large — at most ${spec.maximum}`,
          expected: spec.description,
          found: String(value),
        })
      }
      return problems
    }

    case 'boolean':
      return typeof value === 'boolean' ? [] : [wrongType()]

    case 'array': {
      if (!Array.isArray(value)) return [wrongType()]
      const problems: Problem[] = []
      if (spec.minItems !== undefined && value.length < spec.minItems) {
        problems.push({
          field,
          what: `too few — at least ${spec.minItems}`,
          expected: spec.description,
          found: `${value.length} item(s)`,
        })
      }
      const itemType = spec.items?.type
      if (itemType !== undefined) {
        value.forEach((item, index) => {
          const good =
            itemType === 'string'
              ? typeof item === 'string'
              : itemType === 'boolean'
                ? typeof item === 'boolean'
                : typeof item === 'number' &&
                  Number.isFinite(item) &&
                  (itemType !== 'integer' || Number.isInteger(item))
          if (!good) {
            problems.push({
              field: `${field}[${index}]`,
              what: `should be ${readable(itemType)}`,
              expected: `${readable(itemType)} — ${spec.description}`,
              found: `${nameOfType(item as JsonValue)}, ${shortly(item as JsonValue)}`,
            })
          }
        })
      }
      return problems
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Telling the model what to write instead
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The message sent back when arguments do not fit.
 *
 * Written for a model to act on, not for a person to read as a log line. Three
 * things are in it deliberately, and each was found to matter:
 *
 *   the field name        so it changes the right one
 *   the type expected     so it stops sending text where a number belongs
 *   the values allowed    so a near-miss becomes an exact hit rather than
 *                         another near-miss
 *
 * It ends by saying what to do, because a model given only a complaint often
 * apologises rather than retrying.
 */
export function repairMessage(toolName: string, problems: readonly Problem[]): string {
  const lines = problems.map((problem) => {
    const parts = [`  ${problem.field === '' ? '(the arguments)' : problem.field}: ${problem.what}.`]
    parts.push(`    you sent: ${problem.found}`)
    parts.push(`    expected: ${problem.expected}`)
    if (problem.allowed !== undefined) {
      parts.push(`    allowed values, exactly as written: ${problem.allowed.map((v) => `"${v}"`).join(', ')}`)
    }
    return parts.join('\n')
  })

  return (
    `The call to ${toolName} could not be run, because its arguments did not fit.\n\n` +
    `${lines.join('\n\n')}\n\n` +
    `Call ${toolName} again with those corrected. Send the whole set of arguments, ` +
    `not only the changed ones. Do not explain the mistake — just make the call.`
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// The form providers want
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The same shape, written the way the model providers expect to receive it.
 *
 * A plain conversion with nothing dropped, so what the model is shown really is
 * what its answer is judged against.
 */
export function asJsonSchema(schema: ArgumentSchema): JsonObject {
  const properties: Record<string, JsonValue> = {}
  for (const [field, spec] of Object.entries(schema.properties)) {
    const out: Record<string, JsonValue> = {
      type: spec.type,
      description: spec.description,
    }
    if (spec.enum !== undefined) out['enum'] = [...spec.enum]
    if (spec.items !== undefined) out['items'] = { type: spec.items.type }
    if (spec.minimum !== undefined) out['minimum'] = spec.minimum
    if (spec.maximum !== undefined) out['maximum'] = spec.maximum
    if (spec.minLength !== undefined) out['minLength'] = spec.minLength
    if (spec.maxLength !== undefined) out['maxLength'] = spec.maxLength
    if (spec.minItems !== undefined) out['minItems'] = spec.minItems
    properties[field] = out
  }
  return {
    type: 'object',
    properties,
    required: [...schema.required],
    additionalProperties: false,
  }
}
