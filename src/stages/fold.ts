/**
 * Reading the record forward into what Charter knows.
 *
 * WHY THE SUMMARY IS ALWAYS REBUILT AND NEVER KEPT
 *
 * Charter holds no running summary of a case. Every time it needs to know
 * something, it reads the record from the first entry to the last and folds it
 * into a plain value. That sounds wasteful and is the opposite.
 *
 * **A run survives anything.** A closed browser tab, a machine restarting, a crash
 * in the middle of stage three: none of them lose a thing, because nothing was
 * being held in the first place. The record is on disk and rebuilding takes
 * milliseconds.
 *
 * **The summary cannot drift from the truth.** There is no second place where what
 * Charter knows is stored, so there is no possibility of two places disagreeing.
 * A stored summary and an append-only record will eventually differ, and the
 * moment they do, one of them is lying and nothing says which.
 *
 * **What Charter believes is auditable.** Every fact traces to an entry that has a
 * fingerprint, a position in a chain, and something that caused it. "Why did it
 * think the state was Texas?" has an exact answer.
 *
 * WHY UNKNOWN ENTRIES ARE PASSED OVER RATHER THAN REFUSED
 *
 * A record written by a later version of Charter will hold entry kinds this code
 * has never heard of. Refusing to read such a record would make every past run
 * unreadable the first time a new kind of entry is added, which would defeat the
 * point of keeping a permanent record at all. Anything unrecognised is passed over
 * and the rest is read.
 *
 * The same applies within an entry: a payload missing the field this code expects
 * is skipped rather than crashing. A record is read by things that check it,
 * including things a stranger runs, and a checker that stops at the first surprise
 * checks nothing.
 *
 * THE ONE ENTRY NO TOOL CAN WRITE
 *
 * `spend.authorised` is a person granting permission to spend, in their browser.
 * It is read here, and it is written by ordinary code on a path the model is not
 * on. There is no tool that produces it. That is what stops a model authorising
 * itself and then spending under its own permission — not a rule it is asked to
 * follow, but the absence of anything to call.
 */

import type { JsonObject, JsonValue } from '../record/canonical.js'
import {
  emptyCase,
  type CaseFacts,
  type Owner,
  type PossibleCollision,
  type SearchPerformed,
} from './facts.js'

/** One entry as the fold sees it: what kind it is, and what it carried. */
export interface RecordedEntry {
  readonly kind: string
  readonly payload: JsonObject | null
}

const asText = (payload: JsonObject, field: string): string | undefined => {
  const value = payload[field]
  return typeof value === 'string' ? value : undefined
}

const asFlag = (payload: JsonObject, field: string): boolean | undefined => {
  const value = payload[field]
  return typeof value === 'boolean' ? value : undefined
}

/** A list of plain text lines, skipping anything that is not text. */
const asTextList = (payload: JsonObject, field: string): readonly string[] => {
  const value = payload[field]
  return Array.isArray(value) ? value.filter((one): one is string => typeof one === 'string') : []
}

const asRows = (payload: JsonObject, field: string): JsonObject[] => {
  const value = payload[field]
  if (!Array.isArray(value)) return []
  return value.filter(
    (row): row is JsonObject => typeof row === 'object' && row !== null && !Array.isArray(row),
  )
}

/**
 * Fold a case's entries into what is known.
 *
 * The entries must be in the order they were written, which is the order the
 * record keeps them in. Order matters: a later answer replaces an earlier one, and
 * that is how somebody correcting themselves works.
 */
export function foldFacts(caseId: string, entries: readonly RecordedEntry[]): CaseFacts {
  let facts = emptyCase(caseId)

  // Built up as we go, then attached once, so the returned value has no partly
  // filled sections.
  const searches: SearchPerformed[] = []
  let collisions: readonly PossibleCollision[] = []
  let verdict: 'clear' | 'collides' | 'needs-a-person' | undefined
  const owners: Owner[] = []
  const openQuestions: string[] = []
  const answers: { question: string; answer: string }[] = []

  for (const entry of entries) {
    // A forgotten payload is a real state: personal details can be cleared from
    // the record while the entry itself stays, so the chain still checks out. A
    // fold that crashed on one would make forgetting break every past run.
    const payload = entry.payload
    if (payload === null) continue

    switch (entry.kind) {
      case 'fact.recorded': {
        const about = asText(payload, 'about')
        const value = asText(payload, 'value')
        if (about === undefined || value === undefined) break
        if (about === 'description') facts = { ...facts, description: value }
        else if (about === 'state') facts = { ...facts, state: value.toUpperCase() }
        else if (about === 'proposed_name') facts = { ...facts, proposedName: value }
        else if (about === 'owner') {
          const contribution = asText(payload, 'contribution') ?? ''
          const already = owners.findIndex((owner) => owner.name === value)
          const owner: Owner = { name: value, contribution }
          if (already === -1) owners.push(owner)
          else owners[already] = owner
        } else if (about === 'owner_share' || about === 'owner_contribution_value') {
          // These two attach to an owner already written down. An owner nobody
          // has recorded yet is not created here: a share belonging to a person
          // whose name was never given is a share nobody can check.
          const whose = asText(payload, 'owner')
          if (whose === undefined) break
          const at = owners.findIndex((owner) => owner.name === whose)
          if (at === -1) break
          const owner = owners[at] as Owner
          owners[at] =
            about === 'owner_share'
              ? { ...owner, sharePercent: value }
              : { ...owner, contributionCents: value }
        }
        break
      }

      case 'question.asked': {
        const question = asText(payload, 'question')
        if (question !== undefined && !openQuestions.includes(question)) openQuestions.push(question)
        break
      }

      case 'question.answered': {
        const question = asText(payload, 'question')
        if (question === undefined) break
        const at = openQuestions.indexOf(question)
        if (at !== -1) openQuestions.splice(at, 1)
        // Kept with its answer, because two terms of the ownership agreement may
        // only be written down when a person was asked and replied, and that
        // cannot be checked against a list of questions still outstanding.
        answers.push({ question, answer: asText(payload, 'answer') ?? '' })
        break
      }

      case 'agreement.choice.recorded': {
        const which = asText(payload, 'which')
        const value = asText(payload, 'value')
        if (which === undefined || value === undefined) break
        const choices = facts.agreementChoices ?? {}
        if (which === 'managed_by' && (value === 'the owners themselves' || value === 'an appointed manager')) {
          facts = { ...facts, agreementChoices: { ...choices, managedBy: value } }
        } else if (which === 'exit_process') {
          facts = { ...facts, agreementChoices: { ...choices, hasExitProcess: value === 'yes' } }
        }
        break
      }

      case 'agreement.drafted': {
        const articleCount = asText(payload, 'articleCount')
        const dated = asText(payload, 'dated')
        if (articleCount === undefined || dated === undefined) break
        facts = {
          ...facts,
          agreement: {
            articleCount,
            dated,
            blocks: asTextList(payload, 'blocks'),
            explanation: asTextList(payload, 'explanation'),
          },
        }
        break
      }

      case 'spend.requested': {
        const limitCents = asText(payload, 'limitCents')
        const forWhat = asText(payload, 'forWhat')
        if (limitCents === undefined || forWhat === undefined) break
        facts = { ...facts, spendRequested: { limitCents, forWhat } }
        break
      }

      // Written by a person in their browser, never by any tool. See the note at
      // the top of this file.
      case 'spend.authorised': {
        const limitCents = asText(payload, 'limitCents')
        const forWhat = asText(payload, 'forWhat')
        const grantedAt = asText(payload, 'grantedAt')
        if (limitCents === undefined || forWhat === undefined || grantedAt === undefined) break
        facts = {
          ...facts,
          spendAuthorisation: { limitCents, forWhat, grantedAt, spentCents: '0' },
        }
        break
      }

      case 'spend.applied': {
        const spentAfter = asText(payload, 'spentCentsAfter')
        const existing = facts.spendAuthorisation
        if (spentAfter === undefined || existing === undefined) break
        facts = { ...facts, spendAuthorisation: { ...existing, spentCents: spentAfter } }
        break
      }

      case 'search.performed': {
        const query = asText(payload, 'query')
        const resultCount = asText(payload, 'resultCount')
        const answeredBy = asText(payload, 'answeredBy')
        if (query === undefined) break
        searches.push({
          query,
          resultCount: resultCount ?? '0',
          answeredBy: answeredBy ?? 'unrecorded',
        })
        break
      }

      case 'names.compared': {
        const found = asText(payload, 'verdict')
        if (found === 'clear' || found === 'collides' || found === 'needs-a-person') {
          verdict = found
        }
        collisions = asRows(payload, 'comparisons').flatMap((row): PossibleCollision[] => {
          const foundName = asText(row, 'foundName')
          const closeness = asText(row, 'closeness')
          if (foundName === undefined) return []
          const comparedAs = row['comparedAs']
          const pair =
            typeof comparedAs === 'object' && comparedAs !== null && !Array.isArray(comparedAs)
              ? comparedAs
              : {}
          return [
            {
              foundName,
              where: 'the live web',
              closeness:
                closeness === 'exact' ||
                closeness === 'same-after-tidying' ||
                closeness === 'close'
                  ? closeness
                  : 'different',
              comparedAs: {
                proposed: asText(pair as JsonObject, 'proposed') ?? '',
                found: asText(pair as JsonObject, 'found') ?? '',
              },
            },
          ]
        })
        break
      }

      case 'address.checked': {
        const domain = asText(payload, 'domain')
        if (domain === undefined) break
        const available = asFlag(payload, 'available')
        const priceCents = asText(payload, 'priceCents')
        facts = {
          ...facts,
          address: {
            candidate: domain,
            ...(available === undefined ? {} : { available }),
            ...(priceCents === undefined ? {} : { priceCents }),
          },
        }
        break
      }

      case 'address.registered': {
        const domain = asText(payload, 'domain')
        if (domain === undefined) break
        const existing = facts.address
        facts = {
          ...facts,
          address:
            existing !== undefined && existing.candidate === domain
              ? { ...existing, registered: true }
              : { candidate: domain, available: true, registered: true },
        }
        break
      }

      default:
        // An entry kind this version has never heard of. Passed over on purpose.
        break
    }
  }

  if (searches.length > 0 || verdict !== undefined) {
    // The verdict is left out when nothing has been compared yet, rather than
    // defaulting to anything. Defaulting it to "a person should look" made a run
    // stop and wait before there was anything for a person to look at.
    facts = {
      ...facts,
      nameResearch: { searches, collisions, ...(verdict === undefined ? {} : { verdict }) },
    }
  }

  return { ...facts, owners, openQuestions, answers }
}

/**
 * The situation, written for the model at the start of a turn.
 *
 * Deliberately short. Everything here is sent again on every turn of the stage,
 * and there is a hard ceiling on request size that exists so the fallback provider
 * stays usable at all. A summary that grows without limit is the thing that
 * quietly breaks a run halfway through.
 */
export function describeSituation(facts: CaseFacts): string {
  const lines: string[] = []
  lines.push(`Case ${facts.caseId}.`)
  lines.push(
    facts.description === undefined
      ? 'Nobody has described the business yet.'
      : `The owners describe it as: ${facts.description}`,
  )
  if (facts.proposedName !== undefined) lines.push(`Proposed name: ${facts.proposedName}`)
  if (facts.state !== undefined) lines.push(`To be formed in: ${facts.state}`)

  lines.push(
    facts.owners.length === 0
      ? 'No owners are known yet.'
      : `Owners so far: ${facts.owners
          .map((owner) => `${owner.name}${owner.contribution ? ` (${owner.contribution})` : ''}`)
          .join('; ')}`,
  )

  if (facts.openQuestions.length > 0) {
    lines.push(`Waiting for an answer to: ${facts.openQuestions.join('; ')}`)
  }

  const authorisation = facts.spendAuthorisation
  lines.push(
    authorisation === undefined
      ? 'Nobody has given permission to spend anything yet.'
      : `Permission to spend up to ${authorisation.limitCents} cents on ` +
          `${authorisation.forWhat}; ${authorisation.spentCents} cents spent so far.`,
  )

  const research = facts.nameResearch
  if (research !== undefined) {
    lines.push(
      `${research.searches.length} search(es) run. Name check so far: ${research.verdict}.`,
    )
  }

  const address = facts.address
  if (address !== undefined) {
    const state =
      address.registered === true
        ? 'registered'
        : address.available === true
          ? 'free, not yet registered'
          : address.available === false
            ? 'taken'
            : 'not checked yet'
    lines.push(`Web address ${address.candidate}: ${state}.`)
  }

  return lines.join('\n')
}

/** The value form, for putting a summary into the record. */
export function factsAsJson(facts: CaseFacts): JsonObject {
  return JSON.parse(JSON.stringify(facts)) as JsonObject
}

export type { JsonValue }
