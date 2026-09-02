/**
 * Proving that a registered name actually points somewhere, and that "accepted"
 * is never reported as "stored".
 *
 * WHY THIS IS A SEPARATE STAGE OF WORK
 *
 * Registering a name and pointing it at a website are two different acts. A run
 * that registered a name and stopped would leave the owners holding something that
 * does not work: a name nobody can reach is a name they paid for and cannot use.
 *
 * THE DISTINCTION THIS FILE EXISTS TO HOLD
 *
 * Writing records returns success. Success means the registrar accepted the
 * request. It does not mean the registrar stored anything. Reading the records back
 * is the only way to find out which, and the two are different facts.
 *
 * AND THE CLAIM THAT MUST NEVER BE MADE
 *
 * Reading a record back proves the registrar is holding a row. It does NOT prove
 * the address resolves anywhere. The registrar states plainly that record changes
 * in their practice environment succeed through the interface without becoming
 * publicly answerable. Saying otherwise, to a registrar, would be caught by the one
 * person best equipped to catch it. There is a test below that reads the words the
 * tool returns and requires it to say so.
 */

import { describe, expect, it } from 'vitest'
import {
  setAddressRecords,
  listAddressRecords,
  drawStorefront,
  LONGEST_PROMPT,
} from '../src/tools/stage-tools.js'
import {
  preparedRegistrar,
  preparedSearch,
  preparedIdentity,
  preparedPublishing,
  preparedImagery,
  type Services,
} from '../src/tools/services.js'
import { joinHere } from '../src/pack/join.js'
import { emptyCase, type CaseFacts } from '../src/stages/facts.js'
import type { ToolContext } from '../src/tools/registry.js'
import { DEFAULT_SETTINGS } from '../src/settings.js'
import { makeSealCertificate } from '../src/seal/certificate.js'
import { STAGES } from '../src/stages/stages.js'

const certificate = makeSealCertificate({
  notBefore: new Date(Date.UTC(2026, 0, 1)),
  password: 'a-long-enough-password',
})

const DOMAIN = 'riverasistersbakingco.com'

const services = (over: Partial<Services> = {}): Services => ({
  search: preparedSearch({}),
  registrar: preparedRegistrar({ [DOMAIN]: { domain: DOMAIN, available: true, priceCents: '1299' } }),
  identity: preparedIdentity({}),
  publishing: preparedPublishing(),
  imagery: preparedImagery(),
  documents: joinHere({ whyNotTheService: 'This is a test and reaches nothing.' }),
  ...over,
})

const facts = (over: Partial<CaseFacts> = {}): CaseFacts => ({
  ...emptyCase('case-1'),
  address: { candidate: DOMAIN, available: true, priceCents: '1299', registered: true },
  ...over,
})

const context = (over: Partial<ToolContext> = {}): ToolContext => ({
  caseId: 'case-1',
  facts: facts(),
  services: services(),
  now: () => new Date('2026-08-28T11:00:00.000Z'),
  settings: DEFAULT_SETTINGS,
  certificate,
  ...over,
})

/** A registrar that has already registered the address, so records may be written. */
const registrarHolding = () => {
  const one = preparedRegistrar({ [DOMAIN]: { domain: DOMAIN, available: true, priceCents: '1299' } })
  return one
}

describe('pointing a registered name at the website', () => {
  it('writes records and says accepted is not the same as stored', async () => {
    const registrar = registrarHolding()
    await registrar.register(DOMAIN, '1299')

    const outcome = await setAddressRecords.run({ domain: DOMAIN }, context({ services: services({ registrar }) }))

    expect(outcome.result['written']).toBe(true)
    expect(String(outcome.result['note'])).toMatch(/Read them back to find out what it actually holds/)
  })

  it('writes the name itself, the www form, and a text record', async () => {
    const registrar = registrarHolding()
    await registrar.register(DOMAIN, '1299')
    await setAddressRecords.run({ domain: DOMAIN }, context({ services: services({ registrar }) }))

    const held = await registrar.listRecords(DOMAIN)
    expect(held.map((one) => one.kind).sort()).toEqual(['A', 'CNAME', 'TXT'])
    expect(held.find((one) => one.host === 'www')?.kind).toBe('CNAME')
  })

  it('REFUSES to point a name this case has not registered', async () => {
    // Pointing a name somebody else holds is pointing at somebody else's business.
    // Not a mistake worth making once.
    const outcome = await setAddressRecords.run(
      { domain: 'somebody-elses-name.com' },
      context(),
    )

    expect(outcome.result['written']).toBe(false)
    expect(String(outcome.result['why'])).toMatch(/somebody else/)
    expect(outcome.events[0]?.kind).toBe('address.records.refused')
  })

  it('refuses on a name that was checked but never registered', async () => {
    const outcome = await setAddressRecords.run(
      { domain: DOMAIN },
      context({ facts: facts({ address: { candidate: DOMAIN, available: true } }) }),
    )
    expect(outcome.result['written']).toBe(false)
  })

  it('does not let the model choose what the records are', async () => {
    // What a website needs is not a judgement call, so the model does not decide
    // it. The tool takes a domain and nothing else.
    expect(Object.keys(setAddressRecords.schema.properties ?? {})).toEqual(['domain'])
  })

  it('costs nothing and can be undone, unlike registering', async () => {
    expect(setAddressRecords.costsMoney).toBe(false)
    expect(setAddressRecords.reversible).toBe(true)
  })
})

describe('reading the records back from the registrar', () => {
  const written = async () => {
    const registrar = registrarHolding()
    await registrar.register(DOMAIN, '1299')
    const inner = services({ registrar })
    const sent = await setAddressRecords.run({ domain: DOMAIN }, context({ services: inner }))
    const records = (sent.events[0]?.payload['records'] ?? []) as {
      host: string
      kind: string
      answer: string
      ttl: string
    }[]
    return { registrar, inner, records }
  }

  it('reports a match when the registrar is holding what was sent', async () => {
    const { inner, records } = await written()

    const outcome = await listAddressRecords.run(
      { domain: DOMAIN },
      context({ services: inner, facts: facts({ addressRecords: records }) }),
    )

    expect(outcome.result['matchesWhatWasSent']).toBe(true)
  })

  it('reports a MISMATCH when the registrar is holding something else', async () => {
    // The whole reason to read back. A registrar that accepted a request and
    // stored something different is exactly the case nobody would notice.
    const { inner, records } = await written()

    const outcome = await listAddressRecords.run(
      { domain: DOMAIN },
      context({
        services: inner,
        facts: facts({
          addressRecords: [...records, { host: 'shop', kind: 'A', answer: '1.2.3.4', ttl: '300' }],
        }),
      }),
    )

    expect(outcome.result['matchesWhatWasSent']).toBe(false)
  })

  it('does not care what order the registrar hands them back in', async () => {
    // Two lists holding the same records in a different order are the same answer.
    const { inner, records } = await written()

    const outcome = await listAddressRecords.run(
      { domain: DOMAIN },
      context({ services: inner, facts: facts({ addressRecords: [...records].reverse() }) }),
    )

    expect(outcome.result['matchesWhatWasSent']).toBe(true)
  })

  it('says exactly what reading back proves, and what it does not', async () => {
    // The registrar's own testing guide states that record changes there succeed
    // through the interface without becoming publicly answerable. Claiming
    // resolution would be caught by the one judge best equipped to catch it.
    const { inner } = await written()
    const outcome = await listAddressRecords.run({ domain: DOMAIN }, context({ services: inner }))

    const said = String(outcome.result['proves'])
    expect(said).toMatch(/holding these rows/)
    expect(said).toMatch(/does not prove the address resolves anywhere/)
  })

  it('never claims anything resolves, anywhere in what it returns', async () => {
    const { inner } = await written()
    const outcome = await listAddressRecords.run({ domain: DOMAIN }, context({ services: inner }))
    const everything = JSON.stringify(outcome).toLowerCase()

    expect(everything).not.toMatch(/now resolves|is resolving|took effect|is live on the internet/)
  })

  it('hands back an empty list rather than failing on a name with no records', async () => {
    const outcome = await listAddressRecords.run({ domain: DOMAIN }, context())
    expect(outcome.result['held']).toEqual([])
  })
})

describe('the stage will not finish until the name points somewhere', () => {
  const ready = (over: Partial<CaseFacts>) =>
    STAGES.address.readyToLeave({ ...facts(), ...over } as CaseFacts)

  it('holds while the records have not been written', () => {
    const result = ready({ addressRecords: [], addressRecordsHeld: [] })
    expect(result.ready).toBe(false)
    expect(result.ready ? '' : result.because).toMatch(/points nowhere/)
  })

  it('holds while they have been sent and not read back', () => {
    const result = ready({
      addressRecords: [{ host: '', kind: 'A', answer: '1.2.3.4', ttl: '300' }],
      addressRecordsHeld: [],
    })
    expect(result.ready).toBe(false)
    expect(result.ready ? '' : result.because).toMatch(/Accepted is not the same as stored/)
  })

  it('lets the case through once both have happened', () => {
    const result = ready({
      addressRecords: [{ host: '', kind: 'A', answer: '1.2.3.4', ttl: '300' }],
      addressRecordsHeld: [{ host: '', kind: 'A', answer: '1.2.3.4', ttl: '300' }],
    })
    expect(result.ready).toBe(true)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// The picture the new business does not have
// ─────────────────────────────────────────────────────────────────────────────

describe('drawing the storefront from the owners’ own words', () => {
  const described =
    'Two sisters opening a bakery in Austin. Ana is putting in $20,000 cash, ' +
    'Lucia is putting in a commercial oven she already owns.'

  it('sends the owners’ own sentence, not something a model wrote', async () => {
    const imagery = preparedImagery()
    await drawStorefront.run({}, context({ facts: facts({ description: described }), services: services({ imagery }) }))

    expect(imagery.asked[0]?.prompt).toBe(described)
  })

  it('keeps the whole sentence in the record, so the picture can be checked against it', async () => {
    const outcome = await drawStorefront.run({}, context({ facts: facts({ description: described }) }))
    expect(outcome.events[0]?.payload['fromWords']).toBe(described)
  })

  it('REFUSES when the owners have not described their business', async () => {
    // A picture drawn from words nobody said is a picture of a business that does
    // not exist. The model must not fill the gap with its own description.
    const outcome = await drawStorefront.run({}, context({ facts: facts({}) }))

    expect(String(outcome.result['refused'])).toMatch(/their own words/)
    expect(outcome.events[0]?.kind).toBe('storefront.refused')
  })

  it('refuses on a description that is only spaces', async () => {
    const outcome = await drawStorefront.run({}, context({ facts: facts({ description: '   ' }) }))
    expect(outcome.result['refused']).toBeDefined()
  })

  it('cuts a very long description at the service’s own limit', async () => {
    // Cut here rather than letting the service refuse, so a long description
    // produces a picture instead of an error, and the record shows what was sent.
    const imagery = preparedImagery()
    await drawStorefront.run(
      {},
      context({ facts: facts({ description: 'a'.repeat(LONGEST_PROMPT + 500) }), services: services({ imagery }) }),
    )

    expect(imagery.asked[0]?.prompt.length).toBe(LONGEST_PROMPT)
  })

  it('takes no arguments at all, so the model cannot write the prompt', async () => {
    // The words are the owners'. There is no field here for a model to put its
    // own description of somebody else's business into.
    expect(Object.keys(drawStorefront.schema.properties ?? {})).toEqual([])
  })

  it('says in its own description that no face is ever sent', () => {
    // The same company sells face and skin analysis. None of it appears in any
    // tool list, and a business formation tool has no business touching a face.
    expect(drawStorefront.why).toMatch(/No photograph of any person is ever sent/)
    expect(drawStorefront.why).toMatch(/face and skin tools are absent/)
  })
})
