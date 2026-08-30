/**
 * The certificate Charter seals documents with.
 *
 * WHAT A SEAL IS, AND WHAT IT IS NOT
 *
 * When Charter finishes assembling the pack it puts a **seal** on it. A seal is a
 * machine act on a document the machine made: it closes the file and fixes what is
 * in it, so that anybody opening it afterwards can tell whether a single byte has
 * changed since.
 *
 * It is **not a signature**. In this project the word "signature" means one thing
 * only — what a person does, with the intent to be bound. Nothing here signs on
 * anybody's behalf, and the certificate below cannot be used to.
 *
 * WHY THE CERTIFICATE IS SELF-ISSUED, SAID PLAINLY
 *
 * A certificate is normally issued by an outside authority that has checked who you
 * are, and PDF readers show a green tick for those. Ours is issued by us, to us.
 * Nobody has vouched for it.
 *
 * That means a reader will say the seal's identity is not trusted, and it will be
 * right to. **We do not hide that.** The claim this project actually makes is
 * narrower and completely checkable:
 *
 *     This file has not changed by one byte since it was sealed.
 *
 * That claim holds with a self-issued certificate exactly as well as with a
 * purchased one, because it is a claim about the bytes and not about who we are.
 * The identity half is what an authority sells, and this project does not need it:
 * the key that made the seal is published in this repository, so the comparison a
 * person actually wants — is this the same key Charter publishes — is one they can
 * do themselves without asking anybody.
 *
 * Buying a certificate is also money, and this project spends none.
 */

import forge from 'node-forge'

/** How long a seal certificate is valid for, in years. */
const VALID_YEARS = 10

/** A certificate and the key that goes with it, in the form the sealer wants. */
export interface SealCertificate {
  /** The certificate and private key packaged together, as raw bytes. */
  readonly bundle: string
  /** The password protecting that package. */
  readonly password: string
  /** The certificate on its own, in the text form people paste into checkers. */
  readonly certificatePem: string
  /**
   * A short, stable name for this certificate: the fingerprint of its bytes.
   *
   * Published, so somebody handed a sealed pack can check the seal was made with
   * the certificate this project publishes rather than one somebody invented. A
   * checker that took the certificate out of the file it was checking would prove
   * nothing at all.
   */
  readonly fingerprint: string
}

export class CannotSeal extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'CannotSeal'
  }
}

/**
 * Make a certificate for sealing documents.
 *
 * `notBefore` is passed in rather than read from the clock so the same inputs make
 * the same certificate every time, which is what lets a test assert on one.
 */
export function makeSealCertificate(options: {
  readonly commonName?: string
  readonly notBefore: Date
  readonly password: string
  /** Smaller keys make tests fast. Anything below 2048 is refused for real use. */
  readonly keyBits?: number
}): SealCertificate {
  const keyBits = options.keyBits ?? 2048

  if (options.password.length < 8) {
    throw new CannotSeal(
      'The package holding the private key needs a password of at least eight ' +
        'characters. It is the only thing standing between a copy of this file and ' +
        "somebody else's ability to seal documents as Charter.",
    )
  }

  const keys = forge.pki.rsa.generateKeyPair(keyBits)
  const certificate = forge.pki.createCertificate()

  certificate.publicKey = keys.publicKey
  certificate.serialNumber = '01'
  certificate.validity.notBefore = options.notBefore
  certificate.validity.notAfter = new Date(
    Date.UTC(options.notBefore.getUTCFullYear() + VALID_YEARS, 0, 1),
  )

  // Issuer and subject are the same, because this certificate issues itself. That
  // is the honest shape of a self-issued certificate and pretending otherwise by
  // inventing an issuer name would be worse than saying so.
  const who = [
    { name: 'commonName', value: options.commonName ?? 'Charter document seal' },
    { name: 'organizationName', value: 'Charter' },
  ]
  certificate.setSubject(who)
  certificate.setIssuer(who)

  certificate.setExtensions([
    // Not an authority. This certificate cannot issue others, and saying so in the
    // certificate itself is stronger than saying so in a document.
    { name: 'basicConstraints', cA: false },
    { name: 'keyUsage', digitalSignature: true, nonRepudiation: true },
  ])

  certificate.sign(keys.privateKey, forge.md.sha256.create())

  const bundle = forge.asn1
    .toDer(
      forge.pkcs12.toPkcs12Asn1(keys.privateKey, [certificate], options.password, {
        algorithm: '3des',
      }),
    )
    .getBytes()

  const certificatePem = forge.pki.certificateToPem(certificate)

  return {
    bundle,
    password: options.password,
    certificatePem,
    fingerprint: fingerprintOf(certificatePem),
  }
}

/**
 * The short name of a certificate: the fingerprint of its bytes.
 *
 * Worked out from the certificate itself rather than stored beside it, so the two
 * cannot drift apart. The same reasoning as the attestation key's name.
 */
export function fingerprintOf(certificatePem: string): string {
  const der = forge.asn1
    .toDer(forge.pki.certificateToAsn1(forge.pki.certificateFromPem(certificatePem)))
    .getBytes()

  const digest = forge.md.sha256.create()
  digest.update(der)
  return digest.digest().toHex()
}

/** Read a certificate back from its text form, refusing anything that is not one. */
export function readCertificate(pem: string): { readonly fingerprint: string; readonly selfIssued: boolean } {
  let certificate
  try {
    certificate = forge.pki.certificateFromPem(pem)
  } catch {
    throw new CannotSeal('That is not a certificate this can read.')
  }

  const subject = certificate.subject.getField('CN')?.value
  const issuer = certificate.issuer.getField('CN')?.value

  return {
    fingerprint: fingerprintOf(pem),
    // Said out loud rather than hidden. A reader will report this too, and a
    // project that mentions it first is in a much better position than one caught
    // by it.
    selfIssued: subject === issuer,
  }
}
