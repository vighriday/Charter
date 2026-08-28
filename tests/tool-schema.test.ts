import { describe, it, expect } from 'vitest'
import {
  checkArguments,
  repairMessage,
  assertSupported,
  asJsonSchema,
  BadSchema,
  type ArgumentSchema,
} from '../src/tools/schema.js'

/**
 * Checking what the model sent, and telling it what to send instead.
 *
 * Before any tool runs, its arguments are checked against the shape that tool
 * declared. If they are wrong, the model is sent a message naming the offending
 * field, the type expected and the values allowed, and it tries again.
 *
 * That feedback is the single highest-value thing that makes a free model behave
 * like a much better one, and Charter runs entirely on free models. So the tests
 * below care as much about what the message says as about whether the check fires.
 */

const schema: ArgumentSchema = {
  type: 'object',
  properties: {
    about: {
      type: 'string',
      description: 'Which thing is being written down.',
      enum: ['description', 'state', 'proposed_name', 'owner'],
    },
    value: { type: 'string', description: 'The thing itself.', minLength: 1, maxLength: 20 },
    limit_cents: {
      type: 'integer',
      description: 'The most that may be spent, in whole cents.',
      minimum: 1,
      maximum: 20000,
    },
    urgent: { type: 'boolean', description: 'Whether this is urgent.' },
    names: {
      type: 'array',
      description: 'The names you found.',
      items: { type: 'string' },
      minItems: 1,
    },
  },
  required: ['about', 'value'],
  additionalProperties: false,
}

describe('accepting arguments that fit', () => {
  it('accepts the required fields on their own', () => {
    expect(checkArguments(schema, { about: 'state', value: 'TX' })).toEqual({ ok: true })
  })

  it('accepts every supported kind of field at once', () => {
    const check = checkArguments(schema, {
      about: 'owner',
      value: 'Ana Rivera',
      limit_cents: 2500,
      urgent: false,
      names: ['Rivera Bakery'],
    })
    expect(check).toEqual({ ok: true })
  })
})

describe('catching arguments that do not fit', () => {
  const problemsFor = (args: Record<string, unknown>) => {
    const check = checkArguments(schema, args as never)
    return check.ok ? [] : check.problems
  }

  it('catches a missing required field', () => {
    const problems = problemsFor({ about: 'state' })
    expect(problems).toHaveLength(1)
    expect(problems[0]?.field).toBe('value')
    expect(problems[0]?.what).toContain('required')
  })

  it('catches a field the tool does not have, and lists the ones it does', () => {
    // The commonest small-model mistake: a plausible name that is not the name.
    const problems = problemsFor({ about: 'state', value: 'TX', stateName: 'Texas' })
    expect(problems[0]?.field).toBe('stateName')
    expect(problems[0]?.expected).toContain('about')
    expect(problems[0]?.expected).toContain('value')
  })

  it('catches a value outside the fixed list, and says which are allowed', () => {
    const problems = problemsFor({ about: 'the_state', value: 'TX' })
    expect(problems[0]?.allowed).toEqual(['description', 'state', 'proposed_name', 'owner'])
  })

  it('catches text sent where a number belongs', () => {
    const problems = problemsFor({ about: 'state', value: 'TX', limit_cents: '2500' })
    expect(problems[0]?.field).toBe('limit_cents')
    expect(problems[0]?.what).toContain('whole number')
    expect(problems[0]?.found).toContain('text')
  })

  it('catches a fraction sent where a whole number belongs', () => {
    const problems = problemsFor({ about: 'state', value: 'TX', limit_cents: 25.5 })
    expect(problems[0]?.field).toBe('limit_cents')
  })

  it('catches a number outside its bounds, in both directions', () => {
    expect(problemsFor({ about: 'state', value: 'TX', limit_cents: 0 })[0]?.what).toContain('too small')
    expect(problemsFor({ about: 'state', value: 'TX', limit_cents: 999999 })[0]?.what).toContain('too large')
  })

  it('catches text that is too long or too short', () => {
    expect(problemsFor({ about: 'state', value: '' })[0]?.what).toContain('too short')
    expect(problemsFor({ about: 'state', value: 'x'.repeat(40) })[0]?.what).toContain('too long')
  })

  it('catches something that is not a list where a list belongs', () => {
    const problems = problemsFor({ about: 'state', value: 'TX', names: 'Rivera Bakery' })
    expect(problems[0]?.field).toBe('names')
    expect(problems[0]?.what).toContain('list')
  })

  it('catches a wrong item inside a list, and says which one', () => {
    const problems = problemsFor({ about: 'state', value: 'TX', names: ['ok', 7] })
    expect(problems[0]?.field).toBe('names[1]')
  })

  it('catches an empty list where at least one was asked for', () => {
    expect(problemsFor({ about: 'state', value: 'TX', names: [] })[0]?.what).toContain('too few')
  })

  it('reports every problem at once, not the first one', () => {
    // Sending the model one problem at a time would cost one request from a daily
    // allowance of a few hundred for each.
    const problems = problemsFor({ about: 'nope', limit_cents: 'lots', extra: true })
    expect(problems.length).toBeGreaterThanOrEqual(3)
  })
})

describe('the message the model is sent back', () => {
  const messageFor = (args: Record<string, unknown>) => {
    const check = checkArguments(schema, args as never)
    return check.ok ? '' : repairMessage('record_fact', check.problems)
  }

  it('names the tool, the field, what arrived and what was expected', () => {
    const message = messageFor({ about: 'the_state', value: 'TX' })
    expect(message).toContain('record_fact')
    expect(message).toContain('about')
    expect(message).toContain('you sent')
    expect(message).toContain('expected')
  })

  it('lists the allowed values exactly as they must be written', () => {
    // A near-miss becomes an exact hit rather than another near-miss.
    const message = messageFor({ about: 'the_state', value: 'TX' })
    expect(message).toContain('"description", "state", "proposed_name", "owner"')
  })

  it('tells the model to send the whole set of arguments again', () => {
    // Sending only the changed field is the next mistake, and it costs a request.
    expect(messageFor({ about: 'nope', value: 'TX' })).toContain('whole set of arguments')
  })

  it('tells it to make the call rather than explain itself', () => {
    // A model given only a complaint often apologises instead of retrying.
    expect(messageFor({ about: 'nope', value: 'TX' })).toContain('just make the call')
  })

  it('shortens a very long value rather than sending it all back', () => {
    const message = messageFor({ about: 'state', value: 'x'.repeat(500), extra: 'y'.repeat(500) })
    expect(message.length).toBeLessThan(1500)
  })
})

describe('refusing a shape this project cannot enforce', () => {
  const base: ArgumentSchema = {
    type: 'object',
    properties: {},
    required: [],
    additionalProperties: false,
  }

  it('accepts the shapes it does enforce', () => {
    expect(() => assertSupported('fine', schema)).not.toThrow()
  })

  it('refuses a fixed list of values on anything but text', () => {
    // It would look enforced and never be checked.
    expect(() =>
      assertSupported('bad', {
        ...base,
        properties: {
          n: { type: 'integer', description: 'a number', enum: ['1', '2'] },
        },
      }),
    ).toThrow(BadSchema)
  })

  it('refuses an empty list of allowed values, which permits nothing', () => {
    expect(() =>
      assertSupported('bad', {
        ...base,
        properties: { a: { type: 'string', description: 'a thing', enum: [] } },
      }),
    ).toThrow(BadSchema)
  })

  it('refuses a list that does not say what is in it', () => {
    expect(() =>
      assertSupported('bad', {
        ...base,
        properties: { a: { type: 'array', description: 'some things' } },
      }),
    ).toThrow(/say what its items are/)
  })

  it('refuses a field with no description, because that is all the model has', () => {
    expect(() =>
      assertSupported('bad', {
        ...base,
        properties: { a: { type: 'string', description: '  ' } },
      }),
    ).toThrow(/needs a description/)
  })

  it('refuses requiring a field the tool never describes', () => {
    expect(() => assertSupported('bad', { ...base, required: ['ghost'] })).toThrow(/never describes/)
  })
})

describe('the form sent to the model', () => {
  it('is the same shape the answer is judged against', () => {
    // Two descriptions kept in step by hand eventually differ, and then the model
    // is told one thing and judged by another — which looks exactly like the model
    // being stupid and is impossible to debug from outside.
    const sent = asJsonSchema(schema)
    expect(sent['type']).toBe('object')
    expect(sent['required']).toEqual(['about', 'value'])
    expect(sent['additionalProperties']).toBe(false)

    const properties = sent['properties'] as Record<string, Record<string, unknown>>
    expect(Object.keys(properties)).toEqual(Object.keys(schema.properties))
    expect(properties['about']?.['enum']).toEqual(['description', 'state', 'proposed_name', 'owner'])
    expect(properties['limit_cents']?.['minimum']).toBe(1)
    expect(properties['names']?.['items']).toEqual({ type: 'string' })
  })

  it('carries every description across, because that is what the model reads', () => {
    const properties = asJsonSchema(schema)['properties'] as Record<string, Record<string, unknown>>
    for (const [field, spec] of Object.entries(schema.properties)) {
      expect(properties[field]?.['description']).toBe(spec.description)
    }
  })

  it('leaves out limits that were never set, rather than inventing them', () => {
    const properties = asJsonSchema(schema)['properties'] as Record<string, Record<string, unknown>>
    expect(properties['urgent']).toEqual({ type: 'boolean', description: 'Whether this is urgent.' })
  })
})
