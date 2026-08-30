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
import { prepareAgreement } from '../agreement/prepare.js'
import { reviewDocument, explain } from '../identity/review.js'
import { Pack, refusedAfterSealing } from '../pack/assemble.js'
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
        enum: [
          'description',
          'state',
          'proposed_name',
          'owner',
          'owner_share',
          'owner_contribution_value',
        ],
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
      owner: {
        type: 'string',
        description:
          'Only for owner_share and owner_contribution_value: whose it is, spelled ' +
          'exactly as the owner was already written down.',
        maxLength: 200,
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
    if (about === 'owner_share' || about === 'owner_contribution_value') {
      payload['owner'] = text(args, 'owner')
    }
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
 * The two either/or terms of the agreement that a person has to answer, and the
 * words that have to appear in the question before an answer counts.
 *
 * Charter asks the question, a person answers it, and the model writes down what
 * they said. That last step is a transcription, and this table is what makes it a
 * checkable one. Without it a model could write "there is a way out" into a
 * document nobody was ever asked about, and the record would show a term of the
 * deal arriving from nowhere.
 */
const CHOICE_QUESTIONS: Readonly<
  Record<string, { readonly mustMention: readonly string[]; readonly values: readonly string[] }>
> = {
  managed_by: {
    mustMention: ['manage', 'run', 'day to day'],
    values: ['the owners themselves', 'an appointed manager'],
  },
  exit_process: {
    mustMention: ['leave', 'withdraw', 'exit', 'bought out', 'buy out'],
    values: ['yes', 'no'],
  },
}

export const recordAgreementChoice: Tool = {
  name: 'record_agreement_choice',
  summary:
    'Write down one of the two either/or terms of the ownership agreement, after ' +
    'a person has answered a question about it.',
  why:
    'These two terms have no safe default. Who runs the company decides whether ' +
    'every owner can bind it or none of them can. Whether there is a way out ' +
    'decides whether an owner can ever leave at all, because Texas states that a ' +
    'member may not withdraw or be expelled, and an agreement that adds nothing ' +
    'leaves that as the deal. So Charter never chooses either one. This tool only ' +
    'writes down what a person already said, and it refuses unless the record ' +
    'shows the question was actually asked and answered.',
  schema: {
    type: 'object',
    properties: {
      which: {
        type: 'string',
        description: 'Which of the two terms is being written down.',
        enum: ['managed_by', 'exit_process'],
      },
      value: {
        type: 'string',
        description:
          'What the person said. For managed_by: "the owners themselves" or "an ' +
          'appointed manager". For exit_process: "yes" or "no".',
        maxLength: 60,
      },
    },
    required: ['which', 'value'],
    additionalProperties: false,
  },
  reversible: true,
  costsMoney: false,
  async run(args: JsonObject, context: ToolContext): Promise<ToolOutcome> {
    const which = text(args, 'which')
    const value = text(args, 'value')
    const rule = CHOICE_QUESTIONS[which]

    if (rule === undefined) {
      const why = `"${which}" is not one of the agreement terms this writes down`
      return {
        result: { refused: why },
        events: [{ kind: 'agreement.choice.refused', payload: { which, why } }],
      }
    }
    if (!rule.values.includes(value)) {
      const why =
        `"${value}" is not an answer to that question. The answers are: ` +
        `${rule.values.join(', ')}`
      return {
        result: { refused: why },
        events: [{ kind: 'agreement.choice.refused', payload: { which, why } }],
      }
    }

    const asked = context.facts.answers.some((one) => {
      const question = one.question.toLowerCase()
      return rule.mustMention.some((word) => question.includes(word))
    })

    if (!asked) {
      // The refusal is recorded, not merely returned. A term of the deal arriving
      // without anybody being asked is exactly the thing somebody reading this
      // record afterwards would want to see Charter refuse.
      const why =
        'nobody has been asked about this yet, so there is nothing to write down. ' +
        'This is a term of the deal, not something Charter decides. Ask the ' +
        'question first, wait for an answer, then record what was said'
      return {
        result: { refused: why },
        events: [{ kind: 'agreement.choice.refused', payload: { which, why } }],
      }
    }

    return {
      result: { recorded: which, value },
      events: [{ kind: 'agreement.choice.recorded', payload: { which, value } }],
    }
  },
}

export const draftAgreement: Tool = {
  name: 'draft_agreement',
  summary:
    'Prepare the ownership agreement from everything recorded so far. Says exactly ' +
    'what is missing if it cannot.',
  why:
    'Builds every number, every article number and every cross-reference in plain ' +
    'code, then hands a finished set of values to the document template. The model ' +
    'chooses WHEN this happens and contributes nothing to WHAT the document says: ' +
    'the words come from a template a person wrote and can read, and the numbers ' +
    'come from arithmetic anybody can check. It refuses rather than filling a gap, ' +
    'because a term a program chose is a term nobody agreed to.',
  schema: { type: 'object', properties: {}, required: [], additionalProperties: false },
  reversible: true,
  costsMoney: false,
  async run(_args: JsonObject, context: ToolContext): Promise<ToolOutcome> {
    // The date is taken once, here, and written into the record. Everything
    // afterwards reads it from there, so the same case produces the same document
    // however many times it is replayed.
    const today = context.now().toISOString().slice(0, 10)

    let prepared
    try {
      prepared = prepareAgreement(context.facts, today)
    } catch (error) {
      // A refusal, not a crash. The message names what is missing, and the model
      // can go and ask for it. It is written into the record too, so a person
      // reading the run afterwards sees what the document was waiting on.
      const why = error instanceof Error ? error.message : String(error)
      return {
        result: { refused: why },
        events: [{ kind: 'agreement.draft.refused', payload: { why } }],
      }
    }

    const blocks = prepared.data.blocks.filter((one) => !one.hidden).map((one) => one.block)

    return {
      result: {
        articles: String(prepared.data.articles.length),
        dated: prepared.data.agreementDate,
        explanation: prepared.explanation as unknown as JsonValue,
      },
      events: [
        {
          kind: 'agreement.drafted',
          payload: {
            articleCount: String(prepared.data.articles.length),
            dated: today,
            blocks: blocks as unknown as JsonValue,
            explanation: prepared.explanation as unknown as JsonValue,
          },
        },
      ],
    }
  },
}

export const readIdentityDocument: Tool = {
  name: 'read_identity_document',
  summary:
    "Read one owner's identity document and check every value it produced. Says " +
    'which values a person has to look at.',
  why:
    'The document is read by a document service. It is never shown to a model, at ' +
    'any stage, and no model takes any part in deciding which values need a ' +
    'person. That decision is a fixed comparison in code: first whether each value ' +
    'can actually be found in the document, then whether the required fields are ' +
    'there, then format and consistency, and only last the service\u2019s own ' +
    'confidence score \u2014 which the service itself says is uncalibrated and not a ' +
    'probability. The rule may always send MORE to a person. It can never send ' +
    'fewer, and this tool cannot clear anything.',
  schema: {
    type: 'object',
    properties: {
      owner: {
        type: 'string',
        description: 'Whose document this is, spelled exactly as the owner was written down.',
        minLength: 1,
        maxLength: 200,
      },
      document: {
        type: 'string',
        description: 'Which uploaded document to read.',
        minLength: 1,
        maxLength: 200,
      },
    },
    required: ['owner', 'document'],
    additionalProperties: false,
  },
  reversible: true,
  costsMoney: false,
  async run(args: JsonObject, context: ToolContext): Promise<ToolOutcome> {
    const owner = text(args, 'owner')
    const documentRef = text(args, 'document')

    const known = context.facts.owners.some((one) => one.name === owner)
    if (!known) {
      // A document belonging to somebody nobody wrote down is a document nobody
      // can check. It is not read at all.
      const why =
        `"${owner}" is not one of the owners on this case. A document belonging to ` +
        'somebody who was never written down is a document nobody can check against ' +
        'anything, so it is not read'
      return {
        result: { refused: why },
        events: [{ kind: 'identity.read.refused', payload: { owner, why } }],
      }
    }

    // How hard the service is asked to work. EXTRACTION_DEPTH, checked before
    // anything runs and recorded with the result — so a run cannot be quietly
    // cheaper in development than in a demonstration, and the record says which
    // depth it was.
    //
    // The two cheapest depths return characters and layout and cannot say which
    // marks on the page are the date of birth. Setting one of them is refused at
    // startup rather than accepted, because a run that read every document and
    // found no fields would look like broken documents rather than a wrong
    // setting. See DEPTHS_THAT_NAME_FIELDS in src/settings.ts.
    const depth = context.settings.extractionDepth

    const document = await context.services.identity.read(owner, documentRef, depth)
    const today = context.now().toISOString().slice(0, 10)

    // Two settings steer this and neither is a model's to change.
    //
    // REVIEW_CONFIDENCE_FLOOR is the LAST test applied and the weakest, because
    // the reading service says its own score "is relative and uncalibrated".
    //
    // REVIEW_AUDIT_SAMPLE_RATE sends a share of the values that passed every test
    // to a person anyway. It is the only rule here that can catch a reader which
    // is confidently, quietly wrong — every other rule fires when something looks
    // wrong, and that failure does not look wrong. Which values are chosen is
    // worked out from a fingerprint rather than at random, so the same case always
    // produces the same review queue and a recorded run can be reproduced.
    const review = reviewDocument(document, {
      givenName: owner,
      today,
      scoreFloor: context.settings.reviewConfidenceFloor,
      caseId: context.caseId,
      auditSampleRate: context.settings.reviewAuditSampleRate,
    })

    // What goes back to the model is the shape of the outcome and nothing read off
    // the document. Not a name, not a number, not a date. Everything in the next
    // request is in this reply, and an identity detail put here would travel to a
    // provider on every following turn of the stage.
    const events: ToolEvent[] = [
      {
        kind: 'identity.read',
        payload: {
          owner,
          depth,
          fieldsRead: String(document.fields.length),
          toReview: review.toReview as unknown as JsonValue,
          missing: review.missing as unknown as JsonValue,
        },
      },
    ]

    for (const field of review.fields) {
      if (!field.needsAPerson) continue
      events.push({
        kind: 'identity.field.sent.for.review',
        payload: {
          owner,
          field: field.field,
          label: field.label,
          // Why, in the words a reviewer reads. Handing somebody "0.62" and
          // handing them "this could not be found anywhere in the document" are
          // not the same act, and only one of them tells them what to check.
          reasons: field.reasons.map(explain) as unknown as JsonValue,
        },
      })
    }

    return {
      result: {
        owner,
        fieldsRead: String(document.fields.length),
        waitingOnAPerson: String(review.toReview.length),
        floorUsed: String(context.settings.reviewConfidenceFloor),
      },
      events,
    }
  },
}

export const assemblePack: Tool = {
  name: 'assemble_pack',
  summary:
    'Merge everything into one file, add structure, seal it, and take the ' +
    'fingerprint of exactly what was sealed.',
  why:
    'The order is the point. Merge, then seal, then fingerprint the sealed bytes, ' +
    'and nothing that rewrites the file may run afterwards. A document service ' +
    'with no signing operation can still take a signed contract and make its ' +
    'signature unverifiable \u2014 flattening destroys the signature field, a ' +
    'watermark rewrites the page, deleting pages can remove the signed page ' +
    'outright. Stopping an agent making a promise is not the same as stopping it ' +
    'unmaking one. After the seal every rewriting operation is refused and the ' +
    'refusal is recorded, so the finished pack can print what Charter was asked ' +
    'to do and would not.',
  schema: { type: 'object', properties: {}, required: [], additionalProperties: false },
  reversible: true,
  costsMoney: false,
  async run(_args: JsonObject, context: ToolContext): Promise<ToolOutcome> {
    if (context.facts.agreement === undefined) {
      const why = 'there is no agreement to put in the pack yet'
      return {
        result: { refused: why },
        events: [{ kind: 'pack.refused', payload: { why } }],
      }
    }

    // What goes in the pack, in the order it appears. Written here rather than
    // chosen by the model: what a legal pack contains is not a judgement call.
    const parts = [
      'the ownership agreement',
      'the record of everything Charter did',
      'what Charter was asked to do and would not',
      "each owner's identity document",
    ]

    const pack = new Pack()
    pack.run('pdf_merge')
    pack.run('pdf_tag')

    const bytes = await context.services.publishing.buildPack(context.caseId, parts)
    const sealed = pack.seal(bytes)

    // What goes under the pack's own heading, "what Charter was asked to do and
    // would not".
    //
    // In an ordinary run nothing asks for any of these, so the refusals from this
    // run are an empty list and the heading would sit over nothing — which reads
    // as though the promise were decorative. So the section carries the complete
    // list of what WOULD be refused, taken from the same declarations the rule
    // itself reads, with anything actually refused in this run beside it. A reader
    // can check the claim rather than take it, and the list cannot fall out of
    // step with the rule, because it is the rule.
    const wouldRefuse = refusedAfterSealing()
    const didRefuse = sealed.refusals.map((step) => ({
      operation: step.operation,
      why: step.why ?? '',
    }))

    return {
      result: {
        sealed: 'yes',
        fingerprint: sealed.fingerprint,
        sizeBytes: sealed.sizeBytes,
        wouldRefuseAfterSealing: String(wouldRefuse.length),
        refusedInThisRun: String(didRefuse.length),
      },
      events: [
        {
          kind: 'pack.sealed',
          payload: {
            fingerprint: sealed.fingerprint,
            sizeBytes: sealed.sizeBytes,
            parts: parts as unknown as JsonValue,
            wouldRefuseAfterSealing: wouldRefuse as unknown as JsonValue,
            refusedAfterSealing: didRefuse as unknown as JsonValue,
          },
        },
      ],
    }
  },
}

export const publishSite: Tool = {
  name: 'publish_site',
  summary: 'Put the new business\u2019s website online at the address already registered.',
  why:
    'The last thing a newly formed business needs is somewhere to be found. The ' +
    'address was registered in stage three under a permission a person gave, and ' +
    'this points a site at it. It will not publish to an address that was never ' +
    'registered, because a site at an address we do not hold is a site that ' +
    'belongs to somebody else.',
  schema: { type: 'object', properties: {}, required: [], additionalProperties: false },
  reversible: true,
  costsMoney: false,
  async run(_args: JsonObject, context: ToolContext): Promise<ToolOutcome> {
    const address = context.facts.address
    if (address?.registered !== true) {
      const why =
        'no web address has been registered for this business, and a site published ' +
        'at an address we do not hold is a site that belongs to somebody else'
      return {
        result: { refused: why },
        events: [{ kind: 'site.publish.refused', payload: { why } }],
      }
    }

    const site = await context.services.publishing.publish(context.caseId, address.candidate)

    return {
      result: { published: 'yes', address: address.candidate, liveAt: site.liveAt },
      events: [
        {
          kind: 'site.published',
          payload: { address: address.candidate, liveAt: site.liveAt },
        },
      ],
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
  recordAgreementChoice,
  draftAgreement,
  readIdentityDocument,
  assemblePack,
  publishSite,
]

// Used by the guard's tests and by the spend report. Re-exported here so callers
// need one import rather than knowing where the money rules live.
export { cents }
