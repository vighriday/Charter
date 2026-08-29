/**
 * Proving the ordering rule that closes the gap in "your agent shouldn't sign
 * that."
 *
 * THE GAP
 *
 * The document service Charter uses has thirty-two operations and none of them can
 * create a signature. That is a real barrier and it is only half the problem.
 *
 * Several of those operations rewrite the file. Flattening destroys the signature
 * field. A watermark rewrites the page content. Deleting pages can remove the
 * signed page outright. So a program holding all thirty-two operations and no
 * signing operation can still take a signed contract and make its signature
 * unverifiable.
 *
 *     You can stop an agent making a promise, and still leave it able to unmake one.
 *
 * The rule that closes it: merge, then seal, then fingerprint the sealed bytes,
 * and nothing that rewrites the file may run after the seal. These tests are what
 * make that a rule rather than an intention.
 */

import { describe, expect, it } from 'vitest'
import {
  OPERATIONS,
  OutOfOrder,
  Pack,
  checkOrder,
  operation,
} from '../src/pack/assemble.js'

const bytes = (text: string): Uint8Array => new TextEncoder().encode(text)

/** Every operation that rewrites the file, which is the set the rule acts on. */
const rewriting = OPERATIONS.filter((one) => one.rewritesTheFile).map((one) => one.name)

describe('what the rule is protecting against', () => {
  it('knows which operations rewrite the file, and there are several', () => {
    // If this set were empty the rule would pass every test while protecting
    // nothing at all.
    expect(rewriting.length).toBeGreaterThan(4)
    expect(rewriting).toContain('pdf_flatten')
    expect(rewriting).toContain('pdf_watermark')
    expect(rewriting).toContain('pdf_manipulate')
  })

  it('gives every rewriting operation a reason it may not run after sealing', () => {
    // Printed beside the refusal. A list of what a program may do is ordinary; a
    // list of what it may not, with reasons, is not.
    for (const one of OPERATIONS.filter((op) => op.rewritesTheFile)) {
      expect(one.afterSealing, one.name).toBeDefined()
      expect((one.afterSealing as string).length).toBeGreaterThan(20)
    }
  })

  it('lets reading operations through, because reading changes nothing', () => {
    expect(operation('pdf_extract_text')?.rewritesTheFile).toBe(false)
    expect(operation('get_pdf_properties')?.rewritesTheFile).toBe(false)
  })
})

describe('assembling a pack in the right order', () => {
  it('runs everything freely before the seal', () => {
    const pack = new Pack()
    expect(pack.run('pdf_merge').outcome).toBe('ran')
    expect(pack.run('pdf_tag').outcome).toBe('ran')
    expect(pack.isSealed).toBe(false)
  })

  it('fingerprints exactly what was sealed', () => {
    const pack = new Pack()
    pack.run('pdf_merge')
    const sealed = pack.seal(bytes('the finished pack'))

    expect(sealed.fingerprint).toMatch(/^[0-9a-f]{64}$/)
    expect(sealed.sizeBytes).toBe('17')
  })

  it('gives different bytes a different fingerprint', () => {
    const one = new Pack().seal(bytes('pack A'))
    const two = new Pack().seal(bytes('pack B'))
    expect(one.fingerprint).not.toBe(two.fingerprint)
  })

  it('gives the same bytes the same fingerprint, so anybody can check', () => {
    const one = new Pack().seal(bytes('the finished pack'))
    const two = new Pack().seal(bytes('the finished pack'))
    expect(one.fingerprint).toBe(two.fingerprint)
  })
})

describe('after the seal', () => {
  const sealedPack = (): Pack => {
    const pack = new Pack()
    pack.run('pdf_merge')
    pack.seal(bytes('the finished pack'))
    return pack
  }

  it.each(rewriting)('refuses %s, which would rewrite the file', (name) => {
    const step = sealedPack().run(name)
    expect(step.outcome).toBe('refused')
    expect(step.why).toContain('sealed')
  })

  it('says specifically that flattening would leave nowhere to sign', () => {
    // The worst of the set for this project. A system whose whole argument is
    // that only a person signs, producing a document with no signature field.
    const step = sealedPack().run('pdf_flatten')
    expect(step.why).toMatch(/nowhere to sign/)
  })

  it('says specifically that deleting pages could remove the signature page', () => {
    expect(sealedPack().run('pdf_manipulate').why).toMatch(/remove the signature page/)
  })

  it('still allows reading, because reading changes nothing', () => {
    const pack = sealedPack()
    expect(pack.run('get_pdf_properties').outcome).toBe('ran')
    expect(pack.run('pdf_extract_text').outcome).toBe('ran')
  })

  it('records every refusal in order, rather than silently doing nothing', () => {
    // A refusal that leaves no trace cannot be told apart from never having been
    // attempted. Somebody reading a run afterwards should see the moment Charter
    // was asked and declined.
    const pack = new Pack()
    pack.run('pdf_merge')
    const sealed = pack.seal(bytes('x'))
    pack.run('pdf_watermark')
    pack.run('pdf_flatten')

    const after = pack.steps.filter((step) => step.outcome === 'refused')
    expect(after.map((step) => step.operation)).toEqual(['pdf_watermark', 'pdf_flatten'])
    expect(sealed.refusals).toEqual([])
  })

  it('refuses an operation it has never heard of, and says what it does have', () => {
    const step = new Pack().run('pdf_do_whatever')
    expect(step.outcome).toBe('refused')
    expect(step.why).toContain('pdf_merge')
  })

  it('refuses to seal twice, because two fingerprints for one document is worse than none', () => {
    const pack = sealedPack()
    expect(() => pack.seal(bytes('again'))).toThrow(OutOfOrder)
    expect(() => pack.seal(bytes('again'))).toThrow(/told the document had been tampered with/)
  })

  it('refuses to seal nothing', () => {
    // An empty pack with a valid fingerprint is worse than no pack, because it
    // looks finished.
    expect(() => new Pack().seal(new Uint8Array())).toThrow(/looks finished/)
  })
})

describe('checking a plan before running any of it', () => {
  it('accepts a plan that merges, then seals', () => {
    expect(() => checkOrder(['pdf_merge', 'pdf_tag', 'seal', 'get_pdf_properties'])).not.toThrow()
  })

  it.each(rewriting)('rejects a plan that runs %s after the seal', (name) => {
    expect(() => checkOrder(['pdf_merge', 'seal', name])).toThrow(OutOfOrder)
  })

  it('rejects a plan that never seals at all', () => {
    // An unsealed pack has no fingerprint, so nobody can check afterwards that
    // the document they were shown is the document that was made.
    expect(() => checkOrder(['pdf_merge', 'pdf_tag'])).toThrow(/never seals/)
  })

  it('rejects a plan that seals twice', () => {
    expect(() => checkOrder(['pdf_merge', 'seal', 'seal'])).toThrow(/seals the pack twice/)
  })

  it('rejects a plan naming an operation that does not exist', () => {
    expect(() => checkOrder(['pdf_merge', 'pdf_invent_something', 'seal'])).toThrow(
      /not an operation Charter has/,
    )
  })

  it('has no operation anywhere that could create a signature', () => {
    // The same rule the stage machine enforces on tool lists, applied to the
    // document operations. Charter seals documents. It never signs one.
    const forbidden = /sign|signature|esign|envelope|execute/i
    expect(OPERATIONS.map((one) => one.name).filter((name) => forbidden.test(name))).toEqual([])
  })
})
