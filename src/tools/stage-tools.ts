/**
 * The tools for the first three stages.
 *
 * Stage 1, Understand    — ask the person what is still missing, write down what
 *                          is learned, and ask for permission to spend.
 * Stage 2, Research      — search for businesses already using the name, and have
 *                          plain code decide whether they collide.
 * Stage 3, Address       — find out whether the web address is free, and register
 *                          it only inside a permission a person already gave.
 *
 * THREE THINGS TO NOTICE, BECAUSE THEY ARE THE DESIGN RATHER THAN DETAILS
 *
 * **The agent can ask for permission to spend. It cannot grant one.** There is a
 * tool for asking and no tool for granting. The grant arrives from a person's
 * browser and is written to the record along a path the model is not on. So a
 * model that decided to authorise itself has nothing to call.
 *
 * **Whether two business names collide is decided in plain code.** The model
 * chooses which searches to run and writes the explanation afterwards. The
 * comparison itself is lowercase-it, remove-the-company-ending, compare, and send
 * anything close to a person — reproducible, free, and a complete answer to
 * somebody who asks how it works.
 *
 * **The model is never told which search service answered.** Two companies sit
 * behind one tool. If the model could see which one replied it would start
 * reasoning about the services rather than the business, and it has no basis for
 * judging either. The vendor's name goes into the record, where a person can see
 * it, and not into the reply.
 */

import type { JsonObject, JsonValue } from '../record/canonical.js'
import { compareNames, verdictFrom, type Comparison } from '../names/compare.js'
import { maySpend, afterSpending, cents, asMoney } from './guard.js'
import type { Tool, ToolContext, ToolOutcome, ToolEvent } from './registry.js'

/** Read a required text argument. The shape was already checked before this ran. */
const text = (args: JsonObject, field: string): string => {
  const value = args[field]
  return typeof value === 'string' ? value : ''
}

const list = (args: JsonObject, field: string): string[] => {
  const value = args[field]
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : []
}

// ─────────────────────────────────────────────────────────────────────────────
// Stage 1 — Understand
// ─────────────────────────────────────────────────────────────────────────────

export const askQuestion: Tool = {
  name: 'ask_question',
  summary:
    'Ask the owners one thing you still need to know. Ask about one thing at a ' +
    'time, in plain words, as you would ask a person across a table.',
  why:
    'Puts a question on the screen for the owners to answer. Changes nothing, ' +
    'costs nothing, and reaches no outside service. The stage cannot finish while ' +
    'any question is still unanswered, so the agent cannot decide it has heard ' +
    'enough while somebody is still typing.',
  schema: {
    type: 'object',
    properties: {
      question: {
        type: 'string',
        description:
          'The question, in plain words, addressed to the owners. One thing at a time.',
        minLength: 5,
        maxLength: 400,
      },
      why: {
        type: 'string',
        description: 'Why this is needed, in one short sentence, shown under the question.',
        minLength: 5,
        maxLength: 300,
      },
    },
    required: ['question', 'why'],
    additionalProperties: false,
  },
  reversible: true,
  costsMoney: false,
  async run(args: JsonObject): Promise<ToolOutcome> {
    const question = text(args, 'question')
    return {
      result: { asked: question, waitingForAnAnswer: true },
      events: [{ kind: 'question.asked', payload: { question, why: text(args, 'why') } }],
    }
  },
}

export const recordFact: Tool = {
  name: 'record_fact',
  summary:
    'Write down something the owners told you: the business description, the ' +
    'state, the proposed name, or one owner and what they are putting in.',
  why:
    'Adds one entry to the record. Nothing is stored anywhere else, so what ' +
    'Charter knows is always the record read forward — which is why a run survives ' +
    'a crash or a closed browser tab with nothing lost.',
  schema: {
    type: 'object',
    properties: {
      about: {
        type: 'string',
        description: 'Which thing is being written down.',
        enum: ['description', 'state', 'proposed_name', 'owner'],
      },
      value: {
        type: 'string',
        description:
          'The thing itself. For an owner, their name. For the state, its two ' +
          'letters as the state writes them, such as TX.',
        minLength: 1,
        maxLength: 2000,
      },
      contribution: {
        type: 'string',
        description:
          "Only when writing down an owner: what they are putting in, in the " +
          "owners' own words.",
        maxLength: 500,
      },
    },
    required: ['about', 'value'],
    additionalProperties: false,
  },
  reversible: true,
  costsMoney: false,
  async run(args: JsonObject): Promise<ToolOutcome> {
    const about = text(args, 'about')
    const value = text(args, 'value')
    const payload: JsonObject = { about, value }
    if (about === 'owner') payload['contribution'] = text(args, 'contribution')
    return { result: { written: about, value }, events: [{ kind: 'fact.recorded', payload }] }
  },
}

export const requestSpendPermission: Tool = {
  name: 'request_spend_permission',
  summary:
    'Ask the owners for permission to spend up to a stated amount on the web ' +
    'address. This asks. It does not grant.',
  why:
    'Puts a request on the screen. It cannot give permission — there is no tool ' +
    'for that anywhere in Charter. A permission is written to the record only when ' +
    'a person grants it in their browser, along a path the model is not on. So a ' +
    'model that decided to authorise itself has nothing to call.',
  schema: {
    type: 'object',
    properties: {
      limit_cents: {
        type: 'integer',
        description:
          'The most that may be spent, in whole cents. 2500 means twenty-five ' +
          'dollars. Ask for what the address is likely to cost, not more.',
        minimum: 1,
        maximum: 20000,
      },
      for_what: {
        type: 'string',
        description: 'What the money would be spent on, in the words the owners will read.',
        minLength: 5,
        maxLength: 200,
      },
    },
    required: ['limit_cents', 'for_what'],
    additionalProperties: false,
  },
  reversible: true,
  costsMoney: false,
  async run(args: JsonObject): Promise<ToolOutcome> {
    const limit = args['limit_cents']
    const limitCents = typeof limit === 'number' ? String(Math.trunc(limit)) : '0'
    const forWhat = text(args, 'for_what')
    return {
      result: {
        requested: asMoney(limitCents),
        granted: false,
        note:
          'A person has to grant this in their browser. Nothing you can call will ' +
          'grant it, so wait rather than trying again.',
      },
      events: [{ kind: 'spend.requested', payload: { limitCents, forWhat } }],
    }
  },
}

// ─────────────────────────────────────────────────────────────────────────────
// Stage 2 — Research the name
// ─────────────────────────────────────────────────────────────────────────────

export const searchWeb: Tool = {
  name: 'search_web',
  summary:
    'Search the live web for businesses that might already use a name. Returns ' +
    'titles, addresses and the short text under each result.',
  why:
    'One tool with two search companies behind it. Which one answered goes into ' +
    'the record but is never returned here, because a model that can see which ' +
    'service replied starts reasoning about the services instead of the business. ' +
    'Results are cached by the exact query text, because the main service allows ' +
    '250 searches a month and one run uses several.',
  schema: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description:
          'What to search for. Write it as a person would type it into a search box.',
        minLength: 2,
        maxLength: 200,
      },
    },
    required: ['query'],
    additionalProperties: false,
  },
  reversible: true,
  costsMoney: false,
  async run(args: JsonObject, context: ToolContext): Promise<ToolOutcome> {
    const query = text(args, 'query')
    const answer = await context.services.search.search(query)
    const hits = answer.hits.map((hit) => ({
      title: hit.title,
      url: hit.url,
      snippet: hit.snippet,
    }))
    return {
      // No mention of which service answered. That is in the record, not here.
      result: { query, found: hits.length, results: hits as unknown as JsonValue },
      events: [
        {
          kind: 'search.performed',
          payload: {
            query,
            resultCount: String(hits.length),
            answeredBy: answer.answeredBy,
            results: hits as unknown as JsonValue,
          },
        },
      ],
    }
  },
}

export const compareNamesTool: Tool = {
  name: 'compare_names',
  summary:
    'Compare the proposed business name against names you found, and get back ' +
    'whether they collide. You do not decide this — the comparison does.',
  why:
    'The decision is made in plain code: fold the accents, lowercase it, remove ' +
    'the company ending and the punctuation, join up initials, then compare. ' +
    'Anything close goes to a person rather than being guessed at. Reproducible on ' +
    'anyone\'s machine, free to run, and a complete answer to somebody who asks ' +
    'how it works. The model chooses what to compare and writes the explanation ' +
    'afterwards; it does not reach the verdict.',
  schema: {
    type: 'object',
    properties: {
      found_names: {
        type: 'array',
        description:
          'The business names you found in the search results, exactly as they were ' +
          'written there.',
        items: { type: 'string' },
        minItems: 1,
      },
    },
    required: ['found_names'],
    additionalProperties: false,
  },
  reversible: true,
  costsMoney: false,
  async run(args: JsonObject, context: ToolContext): Promise<ToolOutcome> {
    const proposed = context.facts.proposedName
    if (proposed === undefined) {
      return {
        result: {
          error:
            'There is no proposed name written down yet, so there is nothing to ' +
            'compare against. Record the proposed name first.',
        },
        events: [{ kind: 'compare.refused', payload: { why: 'no proposed name recorded yet' } }],
      }
    }

    const found = list(args, 'found_names')
    const comparisons: Comparison[] = found.map((name) => compareNames(proposed, name))
    const verdict = verdictFrom(comparisons)

    const detail = comparisons.map((comparison, index) => ({
      foundName: found[index] ?? '',
      closeness: comparison.closeness,
      similarity: comparison.similarity,
      because: comparison.because,
      comparedAs: comparison.comparedAs,
    }))

    return {
      result: {
        proposedName: proposed,
        verdict,
        comparisons: detail as unknown as JsonValue,
        note:
          verdict === 'needs-a-person'
            ? 'A person has to look at the close ones. Do not decide this yourself.'
            : verdict === 'collides'
              ? 'This name is taken. A different name is needed.'
              : 'Nothing close was found.',
      },
      events: [
        {
          kind: 'names.compared',
          payload: { proposedName: proposed, verdict, comparisons: detail as unknown as JsonValue },
        },
      ],
    }
  },
}

// ─────────────────────────────────────────────────────────────────────────────
// Stage 3 — Secure the address
// ─────────────────────────────────────────────────────────────────────────────

export const checkAddress: Tool = {
  name: 'check_address',
  summary: 'Find out whether a web address is free, and what the first year costs.',
  why:
    'Asks the registrar a question. Costs nothing, registers nothing, and can be ' +
    'run as often as needed. This is the tool that finds out the price the ' +
    'permission then has to cover.',
  schema: {
    type: 'object',
    properties: {
      domain: {
        type: 'string',
        description: 'The whole address including the ending, such as riverabakery.com',
        minLength: 4,
        maxLength: 253,
      },
    },
    required: ['domain'],
    additionalProperties: false,
  },
  reversible: true,
  costsMoney: false,
  async run(args: JsonObject, context: ToolContext): Promise<ToolOutcome> {
    const domain = text(args, 'domain')
    const quote = await context.services.registrar.quote(domain)
    const payload: JsonObject = { domain, available: quote.available }
    if (quote.priceCents !== undefined) payload['priceCents'] = quote.priceCents

    return {
      result: {
        domain,
        available: quote.available,
        ...(quote.priceCents === undefined ? {} : { price: asMoney(quote.priceCents) }),
      },
      events: [{ kind: 'address.checked', payload }],
    }
  },
}

export const registerAddress: Tool = {
  name: 'register_address',
  summary:
    'Register the web address. This spends money and cannot be undone. It only ' +
    'runs if a person has already given permission covering the price.',
  why:
    'The one tool in the first three stages that changes something in the world ' +
    'and cannot be taken back. Before it runs, code reads the record for a ' +
    'permission a person granted and checks the price falls inside it. No ' +
    'permission, or a price above what is left, and nothing is called — the ' +
    'registrar is not contacted at all. The check is deliberately outside the ' +
    'registrar code, so that replacing the registrar cannot take the rule with it.',
  schema: {
    type: 'object',
    properties: {
      domain: {
        type: 'string',
        description: 'The whole address to register, exactly as it was checked.',
        minLength: 4,
        maxLength: 253,
      },
    },
    required: ['domain'],
    additionalProperties: false,
  },
  // Both flags true, and both are read by code rather than being documentation:
  // the guard runs on anything marked as costing money, and the catalogue marks
  // anything that cannot be undone.
  reversible: false,
  costsMoney: true,
  async run(args: JsonObject, context: ToolContext): Promise<ToolOutcome> {
    const domain = text(args, 'domain')
    const address = context.facts.address

    if (address === undefined || address.candidate !== domain) {
      return {
        result: {
          registered: false,
          why:
            `${domain} has not been checked yet. Check whether it is free, and what ` +
            `it costs, before trying to register it.`,
        },
        events: [
          { kind: 'address.registration.refused', payload: { domain, why: 'not checked first' } },
        ],
      }
    }
    if (address.available !== true) {
      return {
        result: { registered: false, why: `${domain} is already taken.` },
        events: [
          { kind: 'address.registration.refused', payload: { domain, why: 'not available' } },
        ],
      }
    }
    if (address.priceCents === undefined) {
      return {
        result: { registered: false, why: `no price is known for ${domain}.` },
        events: [{ kind: 'address.registration.refused', payload: { domain, why: 'no price' } }],
      }
    }

    // The rule. Nothing below this line runs without a person's permission
    // covering the exact price, read from the record.
    const verdict = maySpend(context.facts, address.priceCents, `registering ${domain}`)
    if (!verdict.allowed) {
      return {
        result: { registered: false, why: verdict.reason },
        events: [
          {
            kind: 'address.registration.refused',
            payload: { domain, priceCents: address.priceCents, why: verdict.reason },
          },
        ],
      }
    }

    const registration = await context.services.registrar.register(domain, address.priceCents)
    const authorisation = context.facts.spendAuthorisation
    const events: ToolEvent[] = [
      {
        kind: 'address.registered',
        payload: {
          domain,
          chargedCents: registration.chargedCents,
          sandbox: registration.sandbox,
          at: context.now().toISOString(),
        },
      },
    ]
    if (authorisation !== undefined) {
      const after = afterSpending(authorisation, registration.chargedCents)
      events.push({
        kind: 'spend.applied',
        payload: {
          forWhat: `registering ${domain}`,
          amountCents: registration.chargedCents,
          spentCentsAfter: after.spentCents,
          limitCents: after.limitCents,
        },
      })
    }

    return {
      result: {
        registered: true,
        domain,
        charged: asMoney(registration.chargedCents),
        sandbox: registration.sandbox,
        leftUnderPermission: asMoney(verdict.remainingCents),
      },
      events,
    }
  },
}

/**
 * Every tool that exists today.
 *
 * Stages four to eight have empty tool lists, and will grow their own. Nothing
 * here signs anything, and nothing here can reach the code that will.
 */
export const ALL_TOOLS: readonly Tool[] = [
  askQuestion,
  recordFact,
  requestSpendPermission,
  searchWeb,
  compareNamesTool,
  checkAddress,
  registerAddress,
]

// Used by the guard's tests and by the spend report. Re-exported here so callers
// need one import rather than knowing where the money rules live.
export { cents }
