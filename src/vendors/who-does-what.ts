/**
 * Every outside company Charter uses, what it does, and what is honestly true
 * about it today.
 *
 * WHY THIS FILE EXISTS AND WHY IT IS THE ONLY COPY
 *
 * Charter talks to other companies. A visitor deciding whether to trust it should
 * be able to read, in plain words and in one place: which companies, what is sent
 * to each of them, what comes back, what is deliberately never used, and — the one
 * that matters most — whether that has actually happened or is only written down.
 *
 * That list existed in four places at once: the settings file, the readme, the
 * website, and whatever anybody said out loud. Four copies of a list is one true
 * list and three that are slowly going wrong, and the wrong ones all read as
 * confidently as the right one.
 *
 * So this is the only copy. The website's page is generated from it, and a check
 * fails the build if the committed page and this file disagree.
 *
 * THE THREE STATES, AND WHY THE MIDDLE ONE HAS TO EXIST
 *
 * **live** — this really happens in a run, and there is a command anybody can run
 * that does it in front of them.
 *
 * **written, not proven** — the client exists, it is tested, and it has never met
 * the company's server. This state exists because of what happened when it did not.
 * The reading service's client sat here for weeks looking finished: written from
 * the documentation, covered by tests that passed, and wrong in three separate
 * ways at once. Wrong endpoint, wrong request, wrong reply shape. Every one of them
 * was invisible to a green test suite, because the tests handed the client a
 * written-out answer of the shape the client already expected. The first real call
 * found all three in ten minutes.
 *
 * A project that cannot tell those two apart will eventually say "we use X" about
 * something that has never worked. So there is a word for it, and it is used.
 *
 * **not built** — no client at all. Said plainly rather than left out of the list,
 * because a list you can only trust when something is missing from it is not a
 * list anybody can trust.
 *
 * WHAT IS DELIBERATELY NOT USED
 *
 * Every entry says so. Several of these companies sell far more than Charter
 * touches, and some of what they sell is a thing a business formation tool has no
 * business touching. Saying which parts are refused is more informative than
 * saying which parts are used, because the second is a feature list and the first
 * is a boundary.
 */

/** Whether this really happens, or is only written down. */
export type ServiceState =
  /** It happens in a run, and a command proves it. */
  | 'live'
  /** The client is written and tested and has never met their server. */
  | 'written, not proven'
  /** There is no client. */
  | 'not built'

export interface OutsideCompany {
  /** The company, as they spell it. */
  readonly company: string
  /** Their own address, so a reader can go and look. */
  readonly host: string
  /** What it does for a run, in one sentence a stranger understands. */
  readonly job: string
  /** Which step of a run it happens in, or 0 when it is not part of a run. */
  readonly step: number
  readonly state: ServiceState
  /** What Charter sends them. Written plainly, because it is the private part. */
  readonly whatWeSend: readonly string[]
  /** What comes back, and what Charter does with it. */
  readonly whatComesBack: readonly string[]
  /**
   * What Charter refuses to use, and why.
   *
   * Never empty. Every one of these companies sells more than Charter touches,
   * and the refusals say more about the design than the uses do.
   */
  readonly neverUsed: readonly string[]
  /** The command anybody can run to watch it happen, when there is one. */
  readonly seeItYourself?: string
  /** Where the code is, so a reader can go and check the sentences above. */
  readonly code: readonly string[]
  /**
   * What is still not true, said out loud.
   *
   * Left out only when there is genuinely nothing. Most entries have something.
   */
  readonly stillNotTrue?: string
}

export const OUTSIDE_COMPANIES: readonly OutsideCompany[] = [
  {
    company: 'SerpApi',
    host: 'serpapi.com',
    job: 'Searches the live web to find out whether anybody is already trading under the name the owners want.',
    step: 2,
    state: 'live',
    whatWeSend: [
      'The proposed business name, and the place the owners said they trade in.',
      'Nothing else. Not the owners’ names, not the description of the business.',
    ],
    whatComesBack: [
      'Real search results: titles, addresses and the short line underneath each one.',
      'Charter compares the names it finds against the proposed one using a fixed rule in ordinary code, and the model takes no part in that comparison.',
      'When a name is close enough to matter, the run stops and a person decides. The software never decides that a name is clear.',
    ],
    neverUsed: [
      'Their cached answers, during a demonstration. A cached result costs nothing and takes under a second, and it is a lie about freshness. Charter asks for a fresh search, which really takes about thirty seconds, and waits.',
    ],
    seeItYourself: 'npm start',
    code: ['src/vendors/search.ts', 'src/names/compare.ts'],
    stillNotTrue:
      'A search finds what a search engine indexed. It is not a trademark register, and Charter never says a name is available, only what it found.',
  },
  {
    company: 'Name.com',
    host: 'name.com',
    job: 'Checks whether a web address is free, registers it, and points it at the new business’s site.',
    step: 3,
    state: 'live',
    whatWeSend: [
      'The web address being asked about.',
      'When registering: that address and the price a person already agreed to.',
    ],
    whatComesBack: [
      'Whether it is free, and what the first year costs.',
      'A real registration in their practice environment, and the address records read back afterwards.',
    ],
    neverUsed: [
      'Registering without a person’s permission covering the actual price. The permission is written in the append-only record before the call, and the check reads it from there rather than from anything the caller hands it.',
      'Their live account, unless two separate settings are both turned on.',
    ],
    seeItYourself: 'npm start',
    code: ['src/vendors/namecom.ts', 'src/tools/guard.ts'],
    stillNotTrue:
      'Records written in their practice environment are stored and can be read back. Their own guide says those records do not become publicly answerable, and Charter does not claim they do.',
  },
  {
    company: 'Nutrient',
    host: 'nutrient.io',
    job: 'Reads the named values off an identity document and says how it found each one.',
    step: 5,
    state: 'live',
    whatWeSend: [
      'A one-page identity document that Charter itself wrote, for the owner named in the run, marked SPECIMEN twice on its face.',
      'The four field names a formation packet needs: full name, date of birth, document number, expiry date. No more than four, because asking for everything a passport carries means holding details Charter has no use for.',
    ],
    whatComesBack: [
      'The four values, each with a label saying whether it was found exactly, assembled from several parts, or not found at all, and the reader’s own confidence score.',
      'Charter then decides who has to look, in ordinary code, with no model involved. The label is tested first and the score last, which is their own recommendation.',
    ],
    neverUsed: [
      'A real person’s identity document. This is a demonstration strangers run from a website, and asking a stranger to hand over their passport so a demonstration can read it would be worse than anything this project prevents.',
      'The score on its own. Their own guide says it is uncalibrated and not a probability, so it is the last and weakest test rather than the first.',
    ],
    seeItYourself: 'npm run nutrient:proof',
    code: ['src/vendors/nutrient.ts', 'src/identity/specimen.ts', 'src/identity/review.ts'],
    stillNotTrue:
      'They say plainly that they read documents and do not verify identity. So neither does Charter. Nothing here says anybody’s identity was confirmed.',
  },
  {
    company: 'Foxit, document services',
    host: 'developer-api.foxit.com',
    job: 'Joins the packet together, makes it small enough to email, and reads its text back out so somebody other than the writer says what it says.',
    step: 6,
    state: 'live',
    whatWeSend: [
      'The two documents a packet is made of: the formation pack and the page saying what Charter did not do.',
      'Both before the packet is sealed. Nothing is sent to them afterwards.',
    ],
    whatComesBack: [
      'One joined file, a smaller version of it, and its text.',
      'Charter looks in that text for the company name and every owner’s name. A check done by the same code that wrote the document is not really a check.',
      'If the reading could not happen, that is recorded as "not checked", never as "checked and fine".',
    ],
    neverUsed: [
      'Anything at all after the packet is sealed. Their catalogue contains operations that rewrite a file, and each would leave a sealed packet looking untouched while its seal no longer covered what it claimed to.',
      'They refuse those anyway, on their own. Send them a sealed Charter packet and ask them to flatten it and they answer "no permission", because the seal marks the file as certified. Neither program was told about the other.',
    ],
    seeItYourself: 'npm run foxit:proof',
    code: ['src/vendors/foxit.ts', 'src/pack/assemble.ts'],
  },
  {
    company: 'Foxit, eSign',
    host: 'foxitesign.foxit.com',
    job: 'Carries the sealed packet to the owners so that they sign it themselves.',
    step: 7,
    state: 'written, not proven',
    whatWeSend: [
      'The sealed packet, the owners’ names and addresses, and a signature box placed exactly where Charter drew each line.',
      'Never a signature. Nothing in this project can make one.',
    ],
    whatComesBack: [
      'A draft signing folder. Sending it is a second, separate act, done at a moment this project chooses and records.',
      'The folder’s state, read back from them rather than believed from a message. Any word this code does not recognise counts as not finished.',
    ],
    neverUsed: [
      'Letting the service go looking for somewhere to sign. A search that finds nothing produces a signing screen with nothing required on it, where a person reaches Finish without ever having signed, and every screen afterwards says it worked.',
      'Any call to this from inside the agent. The code lives in a folder no tool can reach, and a test walks every import in the project and fails the build if a path ever appears.',
    ],
    seeItYourself: 'npm run esign:proof',
    code: ['src/sign/foxit-esign.ts', 'src/sign/request.ts', 'src/boundary/policy.ts'],
    stillNotTrue:
      'This client has never been called. Their eSign product issues its own key pair, separately from the developer portal, and the portal pair is refused here. Until the proof above prints a folder number, this is written and not proven, and it will keep saying so.',
  },
  {
    company: 'Doctavian',
    host: 'doctavian.com',
    job: 'Turns a template and a block of data into the finished ownership agreement.',
    step: 4,
    state: 'written, not proven',
    whatWeSend: [
      'The agreement’s data: the company, the state, each owner and what they put in.',
      'The data is fingerprinted before it goes, so the document that comes back can be tied to exactly what was sent.',
    ],
    whatComesBack: ['The finished document.'],
    neverUsed: [
      'Their signing features. Charter uses them to produce a document and never to sign one.',
    ],
    code: ['src/vendors/doctavian.ts'],
    stillNotTrue:
      'This client has never been called. Their demonstration environment needs a token that only a person can obtain, through a sign-in done in a browser. Charter writes the same agreement itself in the meantime, and says which of the two produced the document.',
  },
  {
    company: 'Perfect Corp',
    host: 'yce.perfectcorp.com',
    job: 'Draws the first picture for the new business’s website, from the owners’ own words.',
    step: 8,
    state: 'live',
    whatWeSend: [
      'The sentence the owners typed when they described their business, which is already in the record because it started the legal work. Word for word: their prompt rewriting is turned off, because a rewrite makes it a picture of what a model thought the owners meant.',
      'Separately, a list of what must NOT be in the picture. That is where the refusals go, because writing "no people" into the description of what you want is a known way to get people.',
      'Never a photograph of anybody.',
    ],
    whatComesBack: ['A picture, and the exact words that produced it, so the record can show both.'],
    neverUsed: [
      'Their face analysis, skin analysis and face swapping. None of it appears in any tool list, none is reachable from anything the model can trigger, and a business formation tool has no business touching anybody’s face.',
      'Inventing people or lettering. The picture is asked for with nobody in it and no words in it: invented people would be staff the business does not employ, and invented lettering would be a sign saying something nobody chose, on a business that has just spent an hour being careful about its wording.',
      'Their own prompt rewriting, which is on by default and is turned off here.',
    ],
    seeItYourself: 'npm run picture:proof',
    code: ['src/vendors/perfectcorp.ts', 'src/vendors/build.ts'],
  },
  {
    company: 'Google, Gemini',
    host: 'ai.google.dev',
    job: 'One of the two models that decide which tool to call next.',
    step: 0,
    state: 'live',
    whatWeSend: [
      'What the run knows so far, folded out of the record, and the list of tools allowed in the current step.',
      'Never a tool result directly. The model is told what is now known, not what a call returned, so a run can be stopped and picked up again from the record alone.',
    ],
    whatComesBack: ['One choice: which tool to call, with what arguments.'],
    seeItYourself: 'npm start',
    neverUsed: [
      'Any decision that binds a person. Every tool it can reach is checked before it runs, and the ones that spend money or touch a document are refused without a permission a person recorded.',
    ],
    code: ['src/model/gemini.ts', 'src/agent/loop.ts'],
  },
  {
    company: 'Groq',
    host: 'groq.com',
    job: 'The second model, which takes over when the first cannot answer.',
    step: 0,
    state: 'live',
    whatWeSend: ['The same thing, in the same shape.'],
    whatComesBack: ['The same one choice.'],
    seeItYourself: 'npm start',
    neverUsed: [
      'Being told which of the two answered. The run records it; the model is never shown it, because a model that could see the difference would start reasoning about the plumbing instead of about the business.',
    ],
    code: ['src/model/groq.ts', 'src/model/router.ts'],
  },
]

/** How many of them really happen in a run today. */
export function howManyAreLive(): number {
  return OUTSIDE_COMPANIES.filter((one) => one.state === 'live').length
}

/**
 * Everything, in the order a run meets them, with the two models last.
 *
 * The models have no step number because they are used in every step. Putting
 * them at the end keeps the list readable as a walk through a run.
 */
export function inRunOrder(): readonly OutsideCompany[] {
  return [...OUTSIDE_COMPANIES].sort((a, b) => {
    if (a.step === 0 && b.step === 0) return 0
    if (a.step === 0) return 1
    if (b.step === 0) return -1
    return a.step - b.step
  })
}
