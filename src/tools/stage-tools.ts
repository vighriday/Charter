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
import { maySpend, afterSpending, cents, asMoney, amountsSpokenIn } from './guard.js'
import { prepareAgreement } from '../agreement/prepare.js'
import { reviewDocument, explain } from '../identity/review.js'
import { Pack, refusedAfterSealing } from '../pack/assemble.js'
import type { AddressRecord } from './services.js'
import { buildPackDocument } from '../pack/document.js'
import { PERMISSION_FILL_IN_AND_SIGN_ONLY, sealPack } from '../seal/seal.js'
import type { Tool, ToolContext, ToolOutcome, ToolEvent } from './registry.js'
import type { CaseFacts } from '../stages/facts.js'

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

/**
 * Whether an amount in whole cents appears in something a person actually said.
 *
 * Everything a person has said is searched: their answers, their description of
 * the business, and the words each owner's contribution was written down in — which
 * came from their answers too.
 *
 * Compared as digits with the punctuation taken out, so "$12,000" and "12000" are
 * the same amount written twice. Whole dollars only: nobody says a contribution is
 * worth twelve thousand dollars and forty-one cents, and matching on the cents
 * would let 1200041 through on the strength of somebody having written 12000.
 */
export function saidByAPerson(
  amountInCents: string,
  facts: CaseFacts,
  aboutOwner: string,
): boolean {
  // Not called `cents`: this file already imports a function by that name, and a
  // parameter that quietly hides an imported function is the kind of thing that
  // works until somebody adds one line and then does not.
  const dollars = Math.round(Number(amountInCents) / 100)
  if (!Number.isFinite(dollars)) return false

  const theirs = aboutOwner.trim().toLowerCase()

  const said = [
    // Answers, because that is where somebody deliberately states a figure, and
    // where the question "what do you agree to credit each contribution at" is
    // answered for everybody at once.
    ...facts.answers.map((one) => one.answer),
    facts.description ?? '',
    // This owner's contribution in their own words — and ONLY this owner's.
    //
    // The first version of this searched every owner's, and that let through the
    // exact mistake it exists to stop: one owner puts in $20,000 cash, so $20,000
    // appears somewhere, so writing $20,000 against the other owner's oven passed.
    // The oven is not worth $20,000 because the cash is.
    ...facts.owners
      .filter((one) => one.name.trim().toLowerCase() === theirs)
      .map((one) => one.contribution),
  ].join(' ')

  // Every run of digits, with the separators people use inside numbers removed.
  const written: readonly string[] = said.replace(/[,\u00a0]/g, '').match(/\d+/g) ?? []
  if (written.includes(String(dollars))) return true

  // And every amount said in words, because "twelve thousand dollars" is at least
  // as common as "$12,000" and refusing it would stop a run while the person is
  // looking at the sentence where they said it.
  return amountsSpokenIn(said).includes(dollars)
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
          'letters as the state writes them, such as TX. For a contribution value, ' +
          'whole cents written as digits and nothing else, so $12,000.00 is 1200000 ' +
          '— and where somebody contributed cash, the value IS the cash, so there is ' +
          'nothing to ask them about.',
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
  whyThisMustNotRun(args: JsonObject, facts): string | null {
    const about = text(args, 'about')
    const value = text(args, 'value')
    // Compared loosely on spacing and capitals, because "TX" and "tx " are the
    // same fact written twice, and refusing only an exact match would let a model
    // loop forever on the difference between them.
    const same = (already: string | undefined): boolean =>
      already !== undefined &&
      already.replace(/\s+/g, ' ').trim().toLowerCase() ===
        value.replace(/\s+/g, ' ').trim().toLowerCase()

    // Any description at all, not only the same one. The description is the
    // owners' account of their own business, in their own words. A model that
    // rewrites it is not adding anything; on the first real run one did exactly
    // that four times, each time shorter than the last, and spent the step. If it
    // is wrong, the owners say so and their answer replaces it.
    if (about === 'description' && facts.description !== undefined) {
      return same(facts.description)
        ? 'The business description is already written down, in those words.'
        : 'A business description is already written down, in the owners own words.'
    }
    if (about === 'state' && same(facts.state)) {
      return `The state is already written down as ${facts.state}.`
    }
    if (about === 'proposed_name' && same(facts.proposedName)) {
      return `The proposed name is already written down as ${facts.proposedName}.`
    }
    // What a contribution is WORTH is a term of the deal, not an observation.
    //
    // Texas allocates profit by contribution value as stated in the company's
    // records, and this agreement is that record. So this number decides how money
    // is split for the life of the company, and it has to come from the people
    // whose money it is.
    //
    // The test is deliberately simple and deliberately strict: the amount has to
    // appear somewhere a person actually said it. Anything else — including a
    // perfectly sensible number that makes the shares come out even — is the model
    // deciding a term, and it is refused with the question it should have asked.
    if (about === 'owner_contribution_value') {
      const owner = text(args, 'owner')

      // The shape first, and never through the money formatter, which refuses
      // anything that is not whole cents by throwing. An earlier version built its
      // complaint about "$12,000" by asking the formatter to print "$12,000", and
      // a run four steps in stopped with an exception raised by its own error
      // message.
      if (!/^\d+$/.test(value.trim())) {
        return (
          `"${value}" is not an amount this can use. Amounts are whole cents written as ` +
          `digits and nothing else, so $12,000.00 is 1200000. Money is never held as a ` +
          `decimal number here, because most decimal fractions cannot be held exactly and ` +
          `a limit checked in fractions is eventually wrong in whichever direction is worse.`
        )
      }

      if (!saidByAPerson(value, facts, owner)) {
        return (
          `Nobody has said that ${owner}'s contribution is worth ${asMoney(value)}. What a ` +
          `contribution is worth is a term of the agreement, not something to work out: ` +
          `Texas splits profit by contribution value as recorded in the agreement, so this ` +
          `number decides how money is divided for as long as the company exists. Ask the ` +
          `owners what value they agree to credit it at, and write down what they say.`
        )
      }
    }

    if (about === 'owner') {
      const contribution = text(args, 'contribution')
      const already = facts.owners.find(
        (one) => one.name.trim().toLowerCase() === value.trim().toLowerCase(),
      )
      // Only when the contribution adds nothing either. An owner written down
      // with no contribution, and then again with one, is somebody being filled in
      // rather than repeated.
      if (
        already !== undefined &&
        (contribution.trim() === '' || already.contribution.trim() === contribution.trim())
      ) {
        return `${already.name} is already written down as an owner.`
      }
    }
    return null
  },
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
  whyThisMustNotRun(args: JsonObject, facts): string | null {
    const query = text(args, 'query').replace(/\s+/g, ' ').trim().toLowerCase()
    const already = (facts.nameResearch?.searches ?? []).find(
      (one) => one.query.replace(/\s+/g, ' ').trim().toLowerCase() === query,
    )
    if (already === undefined) return null

    // Not merely pointless: a repeated search SPENDS the allowance again. Two
    // hundred and fifty searches a month, about twelve to a run, and on the first
    // real run one step ran the same two queries twelve times between them.
    return (
      `That exact search has already been run and it found ` +
      `${already.found.length === 0 ? 'nothing' : already.found.join('; ')}. ` +
      `Running it again would cost another search from a monthly allowance and ` +
      `return the same thing.`
    )
  },
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
  whyThisMustNotRun(args: JsonObject, facts): string | null {
    const domain = text(args, 'domain').trim().toLowerCase()
    const address = facts.address
    if (address === undefined) return null
    if (address.candidate.trim().toLowerCase() !== domain) return null
    if (address.available === undefined) return null

    return (
      `${address.candidate} has already been checked and it is ` +
      `${address.available ? 'free' : 'taken'}` +
      `${address.priceCents === undefined ? '' : `, at ${asMoney(address.priceCents)} for the first year`}` +
      `. Asking again gives the same answer.`
    )
  },
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
  whyThisMustNotRun(args: JsonObject, facts): string | null {
    const domain = text(args, 'domain').trim().toLowerCase()
    const address = facts.address
    const permission = facts.spendAuthorisation

    if (address === undefined || permission === undefined) return null
    if (address.candidate.trim().toLowerCase() !== domain) return null
    if (address.priceCents === undefined) return null

    const left = Number(permission.limitCents) - Number(permission.spentCents)
    if (Number(address.priceCents) <= left) return null

    // Trying anyway is not harmful — the refusal downstream is real and holds —
    // but it changes nothing and costs a turn. On a real run it cost ten of them
    // and then the step. The way forward is to ask for a bigger limit, so say so.
    return (
      `${address.candidate} costs ${address.priceCents} cents and only ${left} cents ` +
      `are left of what a person allowed. Registering it will be refused however ` +
      `many times it is tried. Ask a person to allow at least ${address.priceCents} ` +
      `cents, or find a cheaper address.`
    )
  },
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
          {
            kind: 'address.registration.refused',
            payload: { domain, why: 'somebody else already has this address' },
          },
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

export const setAddressRecords: Tool = {
  name: 'set_address_records',
  summary:
    'Point the registered address at the website by writing its address records. ' +
    'Free, and it does not register anything.',
  why:
    'Registering a name and pointing it somewhere are two different acts, and a ' +
    'name with no records is a name nobody can reach. So this is a separate tool ' +
    'from the one that spends money, it costs nothing, and it refuses outright on ' +
    'a name this case has not registered. Pointing a name somebody else holds is ' +
    'not a mistake worth making once.',
  schema: {
    type: 'object',
    properties: {
      domain: {
        type: 'string',
        description: 'The registered address these records belong to.',
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
    const address = context.facts.address

    if (address === undefined || address.candidate !== domain || address.registered !== true) {
      const why =
        `${domain} is not an address this case has registered. Records are only ` +
        `written against a name we hold, because pointing a name somebody else ` +
        `holds is pointing at somebody else's business.`
      return {
        result: { written: false, why },
        events: [{ kind: 'address.records.refused', payload: { domain, why } }],
      }
    }

    // What the records are is not a judgement call, so the model does not choose
    // them. A website needs the name itself and the www form pointing at it, and
    // a text record is how the host is shown that we hold the name.
    const records: readonly AddressRecord[] = [
      { host: '', kind: 'A', answer: '76.76.21.21', ttl: '300' },
      { host: 'www', kind: 'CNAME', answer: `${domain}.`, ttl: '300' },
      {
        host: '_charter',
        kind: 'TXT',
        answer: `charter-case=${context.caseId}`,
        ttl: '300',
      },
    ]

    await context.services.registrar.setRecords(domain, records)

    return {
      result: {
        written: true,
        domain,
        count: String(records.length),
        note:
          'Written. That means the registrar accepted the request. Read them back ' +
          'to find out what it actually holds.',
      },
      events: [
        {
          kind: 'address.records.written',
          payload: { domain, records: records as unknown as JsonValue },
        },
      ],
    }
  },
}

export const listAddressRecords: Tool = {
  name: 'list_address_records',
  summary:
    'Read the address records back from the registrar, and compare them against ' +
    'what was sent.',
  why:
    'Writing returns success, and success means the request was accepted rather ' +
    'than that anything was stored. Reading back is the only way to find out what ' +
    'the registrar actually holds, and it is the difference between "we sent it" ' +
    'and "they have it". ' +
    'What this proves is exactly one thing: the registrar stored a row. It does ' +
    'NOT prove anything resolves anywhere, and nothing built on it may say so — ' +
    'the registrar states plainly that record changes in their practice ' +
    'environment succeed through the interface without becoming publicly ' +
    'answerable. A claim about resolution would be caught by the one judge best ' +
    'equipped to catch it.',
  schema: {
    type: 'object',
    properties: {
      domain: {
        type: 'string',
        description: 'The address whose records should be read back.',
        minLength: 4,
        maxLength: 253,
      },
    },
    required: ['domain'],
    additionalProperties: false,
  },
  reversible: true,
  costsMoney: false,
  whyThisMustNotRun(_args: JsonObject, facts): string | null {
    // Only once the read-back has actually happened and agreed with what was sent.
    // A read-back that disagreed is worth doing again, because the registrar may
    // simply not have caught up yet.
    if (facts.addressRecordsHeld.length === 0) return null
    if (facts.addressRecordsHeld.length !== facts.addressRecords.length) return null

    return (
      `The records have already been read back from the registrar, and it holds ` +
      `${facts.addressRecordsHeld.length} of them, matching what was sent. Reading ` +
      `them again tells you the same thing.`
    )
  },
  async run(args: JsonObject, context: ToolContext): Promise<ToolOutcome> {
    const domain = text(args, 'domain')
    const held = await context.services.registrar.listRecords(domain)
    const sent = context.facts.addressRecords

    // Compared as sorted text rather than as objects. Two lists holding the same
    // records in a different order are the same answer, and a comparison that
    // said otherwise would report a mismatch that is ours rather than theirs.
    const asText = (
      records: readonly { readonly host: string; readonly kind: string; readonly answer: string }[],
    ): readonly string[] =>
      records.map((one) => `${one.host || '@'} ${one.kind} ${one.answer}`).sort()

    const theirs = asText(held)
    const ours = asText(sent)
    const same = theirs.length === ours.length && theirs.every((one, at) => one === ours[at])

    return {
      result: {
        domain,
        held: theirs as unknown as JsonValue,
        matchesWhatWasSent: same,
        proves:
          'The registrar is holding these rows. This does not prove the address ' +
          'resolves anywhere, and nothing here claims that it does.',
      },
      events: [
        {
          kind: 'address.records.listed',
          payload: {
            domain,
            held: held as unknown as JsonValue,
            matchesWhatWasSent: same,
          },
        },
      ],
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
  whyThisMustNotRun(args: JsonObject, facts): string | null {
    const which = text(args, 'which')
    const value = text(args, 'value')
    const chosen = facts.agreementChoices
    if (chosen === undefined) return null

    if (which === 'managed_by' && chosen.managedBy === value) {
      return `Who manages the company is already written down as: ${chosen.managedBy}.`
    }
    if (which === 'exit_process' && chosen.hasExitProcess !== undefined) {
      const already = chosen.hasExitProcess ? 'yes' : 'no'
      if (already === value) {
        return `Whether there is an agreed way out is already written down as: ${already}.`
      }
    }
    return null
  },
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
            // The voting rules go into the record as words and as numbers.
            // Anything that shows this agreement later reads them from here
            // rather than working them out again, because two places working
            // out the same threshold is two places that can disagree about
            // what the owners agreed to.
            ordinaryVote: prepared.data.ordinaryVote,
            ordinaryVotePoints: prepared.data.ordinaryVotePoints,
            majorVote: prepared.data.majorVote,
            majorVotePoints: prepared.data.majorVotePoints,
            deadlockPossible: prepared.data.deadlockPossible,
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
  whyThisMustNotRun(args: JsonObject, facts): string | null {
    const owner = text(args, 'owner').trim().toLowerCase()
    const done = facts.identityChecks.find(
      (one) => one.owner.trim().toLowerCase() === owner,
    )
    if (done === undefined) return null

    // Reading a document a second time costs credits from a monthly allowance and
    // returns the same fields. If some of them still need a person, that is a
    // thing only a person can clear, and reading the page again will not do it.
    return (
      `${done.owner}'s document has already been read.` +
      (done.toReview.length === 0
        ? ' Every field matched what was already known.'
        : ` ${done.toReview.length} value(s) still need a person to look at them, which ` +
          `reading the document again cannot change.`)
    )
  },
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
      'what Charter was asked to do and would not',
      "each owner's identity document, and which values a person checked",
      'where the owners sign',
    ]

    const pack = new Pack()
    pack.run('pdf_merge')
    pack.run('pdf_tag')

    // The agreement is prepared again here rather than carried from stage four.
    //
    // It is worked out entirely from facts that are already in the record, so this
    // produces the same document stage four described — and it means the pack is
    // built from the record rather than from something held in memory between
    // stages. Anything built from memory cannot be rebuilt by somebody checking.
    const prepared = prepareAgreement(context.facts, context.facts.agreement.dated)

    // What each owner's document produced. Names of fields only. The values
    // themselves are deliberately never put in the pack: a packet gathering every
    // owner's date of birth and document number onto one page is a document nobody
    // should be asked to carry around.
    const identity = context.facts.identityChecks.map((check) => ({
      owner: check.owner,
      fieldsRead: check.fieldsRead,
      checkedByAPerson: check.checkedByAPerson,
      missing: check.missing,
    }))

    const document = await buildPackDocument({
      caseId: context.caseId,
      agreement: prepared.data,
      explanation: prepared.explanation,
      identity,
      refusedInThisRun: pack.steps
        .filter((step) => step.outcome === 'refused')
        .map((step) => ({ operation: step.operation, why: step.why ?? '' })),
      preparedOn: prepared.data.agreementDate,
      // From the run's own clock, not from the wall. The pack is then the same
      // bytes every time the same record is replayed, which is what lets two
      // people compare one.
      stampedAt: context.now(),
    })

    // Write, then SEAL, then fingerprint the sealed bytes. In that order, and
    // nothing that rewrites the file runs afterwards. A fingerprint of a file that
    // can still be rewritten proves only what the file used to be.
    //
    // Permission level 2: filling in and signing, and nothing else. Level 1 would
    // stop the owners signing at all, which would make the pack useless for the one
    // thing it exists for. Level 3 would let content be added to the page.
    const stamped = await sealPack(document, context.certificate, {
      at: context.now(),
      reason:
        'Sealed by Charter. From this point only filling in and signing are ' +
        'permitted. Nothing here has been signed, and Charter cannot sign it.',
    })

    const sealed = pack.seal(stamped.bytes)

    // The bytes leave this process here, and only here. The record keeps the
    // fingerprint of them and never the bytes themselves, so a person handed the
    // file compares it against the record rather than being handed both by us.
    await context.keepPack?.(stamped.bytes)

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
        permissionLevel: String(PERMISSION_FILL_IN_AND_SIGN_ONLY),
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
            // Which certificate sealed it, by its short name. Somebody handed a
            // pack compares this against the one this project publishes, so a
            // seal made with a certificate somebody invented does not pass.
            certificate: stamped.certificateFingerprint,
            permissionLevel: String(PERMISSION_FILL_IN_AND_SIGN_ONLY),
            wouldRefuseAfterSealing: wouldRefuse as unknown as JsonValue,
            refusedAfterSealing: didRefuse as unknown as JsonValue,
          },
        },
      ],
    }
  },
}

/**
 * The longest a description may be when it is sent to be drawn.
 *
 * The service's own limit. Cutting it here rather than letting the service refuse
 * means a long description produces a picture instead of an error, and the record
 * shows exactly what was sent.
 */
export const LONGEST_PROMPT = 800

export const drawStorefront: Tool = {
  name: 'draw_storefront',
  summary:
    'Draw a picture for the new business’s website from the words its owners ' +
    'used to describe it.',
  why:
    'A business formed this morning owns no photographs. It has no shopfront ' +
    'photographed, no products, no staff pictures. The one thing it does have is ' +
    'the sentence its owners typed in stage one, which is already in the record ' +
    'because it started the legal work. That sentence does a second job here. ' +
    'The words sent are the OWNERS’ OWN, read from the record, not something a ' +
    'model wrote about them, and the record keeps both the words and the picture ' +
    'so a person can see what produced what. ' +
    'No photograph of any person is ever sent, and the same company’s face and ' +
    'skin tools are absent from every stage of this project. A business formation ' +
    'tool has no business touching anybody’s face.',
  schema: { type: 'object', properties: {}, required: [], additionalProperties: false },
  reversible: true,
  costsMoney: false,
  async run(_args: JsonObject, context: ToolContext): Promise<ToolOutcome> {
    const described = context.facts.description

    // Refused rather than invented. A picture drawn from words nobody said is a
    // picture of a business that does not exist, and the model must not fill the
    // gap with its own description.
    if (described === undefined || described.trim() === '') {
      const why =
        'the owners have not described their business yet, and the picture is drawn ' +
        'from their own words. Nothing here writes those words for them'
      return {
        result: { refused: why },
        events: [{ kind: 'storefront.refused', payload: { why } }],
      }
    }

    const words = described.trim().slice(0, LONGEST_PROMPT)
    const picture = await context.services.imagery.draw(words, '1664x928')

    return {
      result: {
        drawn: 'yes',
        shape: picture.shape,
        fromTheOwnersOwnWords: words.length > 120 ? `${words.slice(0, 120)}…` : words,
      },
      events: [
        {
          kind: 'storefront.drawn',
          payload: {
            url: picture.url,
            shape: picture.shape,
            // The whole prompt, kept exactly. A record that summarised what was
            // sent would be a record nobody could check against the picture.
            fromWords: picture.fromWords,
            drawnBy: picture.drawnBy,
            charactersSent: String(words.length),
            longestAllowed: String(LONGEST_PROMPT),
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
  setAddressRecords,
  listAddressRecords,
  recordAgreementChoice,
  draftAgreement,
  readIdentityDocument,
  assemblePack,
  drawStorefront,
  publishSite,
]

// Used by the guard's tests and by the spend report. Re-exported here so callers
// need one import rather than knowing where the money rules live.
export { cents }
