/**
 * Every setting Charter has, in one place, with the file that reads each one.
 *
 * WHAT A SETTING IS
 *
 * A named value the program reads when it starts, kept outside the code so it can
 * differ between one person's machine and another's. They live in a plain text
 * file called `.env` at the top of this project, one per line, written as
 * `NAME=value`. That file is never committed, because most of what is in it is
 * secret.
 *
 * WHY THIS FILE EXISTS AT ALL
 *
 * On 30 August 2026 an audit of this project found that `.env.example` — the file
 * that tells a stranger what to put in `.env` — listed seven settings that **no
 * code anywhere read**. Somebody following the instructions exactly would have set
 * the depth an identity document is read at, the ceiling on how large a request to
 * a model may be, and the confidence floor below which a value goes to a person,
 * and every one of those would have been ignored. Worse, nothing in the project
 * ever opened `.env` at all, so even the settings that WERE read were only read
 * when a person had already put them into their shell by hand.
 *
 * A setting that is documented and ignored is worse than no setting. It tells a
 * reader the program can be steered, invites them to steer it, and then quietly
 * does something else. For a project whose whole argument is "check it yourself",
 * that is the exact failure it claims to be about.
 *
 * So there is now one list, below, and three rules the build enforces:
 *
 *   1. Every setting in the list names the file that reads it, or says plainly
 *      that nothing does yet and which unbuilt part it belongs to.
 *   2. `.env.example` is GENERATED from this list, so the two cannot drift.
 *      `npm run settings:check` fails the build if they have.
 *   3. A value that makes no sense stops the program with an explanation, rather
 *      than being quietly replaced by a default.
 *
 * WHY A VALUE THAT MAKES NO SENSE IS A REFUSAL AND NOT A WARNING
 *
 * `REVIEW_CONFIDENCE_FLOOR=banana` cannot mean anything. Treating it as the
 * default of 0.85 means the person who typed it believes one thing and the program
 * does another, and nothing tells them. Every setting here is checked before
 * anything runs, and a bad one stops the program naming the setting, the value it
 * was given, and what was expected instead.
 */

import { readFileSync, existsSync } from 'node:fs'

/** What a setting holds, which decides how it is checked and how it is printed. */
export type SettingKind =
  /** `true` or `false`, and nothing else. */
  | 'flag'
  /** One of a fixed set of words. */
  | 'choice'
  /** A number, within a stated range. */
  | 'number'
  /** Free text. */
  | 'text'
  /** Free text that is a credential. Never printed and never logged. */
  | 'secret'

export interface Setting {
  readonly name: string
  /** The heading it appears under in `.env.example`. */
  readonly section: string
  /** What it is for and why it matters, in plain words. Printed as comments. */
  readonly what: readonly string[]
  readonly kind: SettingKind
  /** For `choice`. Every value allowed, with what each one means. */
  readonly choices?: Readonly<Record<string, string>>
  /** For `number`. The range outside which the value is refused. */
  readonly range?: { readonly least: number; readonly most: number }
  /** For `number`. True when fractions are refused. */
  readonly wholeNumbersOnly?: boolean
  /** What appears after the `=` in `.env.example`. Empty for anything secret. */
  readonly example: string
  /**
   * The file or files that read this, relative to the project root, separated by
   * spaces when there is more than one.
   *
   * `null` means nothing reads it yet, and then `notYetBuilt` must say which part
   * of the project is missing. That combination is printed in `.env.example` in
   * plain words, so a stranger is never told to set something that does nothing.
   *
   * A test opens every file named here and fails the build if it does not mention
   * the setting. That is the test that would have caught the original problem: a
   * promise in a document with nothing behind it.
   */
  readonly readBy: string | null
  /** Required when `readBy` is null. What is not built, and therefore not reading it. */
  readonly notYetBuilt?: string
}

// ─────────────────────────────────────────────────────────────────────────────
// The four depths an identity document can be read at
// ─────────────────────────────────────────────────────────────────────────────

/**
 * How hard the reading service is asked to work on each page, in its OWN four
 * names, with what each one costs per page in that service's credits.
 *
 * THE SPREAD IS ABOUT THREE AND A HALF TIMES, NOT TWENTY-FOUR.
 *
 * Four public files in this project said "twenty-four times" until 30 August 2026.
 * That was the price of the dearest depth read as though it were the multiplier
 * between cheapest and dearest. 24 ÷ 7 is 3.43. The mistake made the decision look
 * more dramatic than it is, which is its own small dishonesty: the real reason for
 * choosing a depth deliberately is that the cheap ones cannot do the job at all,
 * not that they are twenty-four times cheaper.
 */
export const EXTRACTION_DEPTHS = {
  text: { creditsPerPage: 7, gives: 'plain characters off the page' },
  structure: { creditsPerPage: 7.5, gives: 'plus headings, tables and reading order' },
  understand: { creditsPerPage: 15, gives: 'plus what each value MEANS' },
  agentic: { creditsPerPage: 24, gives: 'plus reasoning across the whole document' },
} as const

export type ExtractionDepth = keyof typeof EXTRACTION_DEPTHS

/**
 * The depths that can actually produce named fields.
 *
 * `text` and `structure` return characters and layout. Neither can tell you which
 * marks on the page are the date of birth, and an identity document is nothing but
 * named fields. Setting one of them is refused rather than accepted, because a run
 * that read every document and found no fields would look like broken documents
 * rather than a wrong setting.
 */
export const DEPTHS_THAT_NAME_FIELDS: readonly ExtractionDepth[] = ['understand', 'agentic']

/** The spread between the cheapest and dearest depth, worked out rather than typed. */
export function depthSpread(): number {
  const costs = Object.values(EXTRACTION_DEPTHS).map((one) => one.creditsPerPage)
  return Math.max(...costs) / Math.min(...costs)
}

// ─────────────────────────────────────────────────────────────────────────────
// The list
// ─────────────────────────────────────────────────────────────────────────────

const NOT_BUILT_VENDOR =
  'the client that would talk to this company. Every outside service is answered ' +
  'today by a stand-in holding recorded answers, with no path to the network at all.'

/** What the picture service is, honestly, until somebody has run it. */
const PICTURE_NOT_PROVEN =
  'a client that is written, tested, and has never once been called. See above.'

const NOT_BUILT_STORAGE =
  'the file store and the publishing client. The finished pack is held in memory ' +
  'and the website is published by a stand-in today.'

/**
 * What each Doctavian setting is for, in plain words.
 *
 * Three of the six are read by the client in src/vendors/doctavian.ts. The other
 * three are the pieces of a sign-in that has to be done by a person in a browser,
 * and nothing here can do it for them — which is worth saying out loud rather than
 * leaving somebody to set four values and wonder why nothing happens.
 */
const DOCTAVIAN_NOTES: Readonly<Record<string, readonly string[]>> = {
  DOCTAVIAN_BASE_URL: [
    'Where their service lives. The demonstration environment is a separate',
    'address from the live one, and a key is scoped to one environment, so these',
    'two go together or neither works.',
  ],
  DOCTAVIAN_API_KEY: [
    'Sent in an x-api-key header. It says which product, which version and which',
    'environment is being asked for. On its own it is not enough: their team',
    'confirmed on 27 August 2026 that the demonstration environment also needs a',
    'bearer token, which is the setting below.',
  ],
  DOCTAVIAN_REFRESH_TOKEN: [
    'The bearer token, sent in an authorization header alongside the key.',
    '',
    'This one cannot be issued by anything in this project. It comes from signing',
    'in with a Microsoft account through their own sign-in page, which is a thing',
    'a person does in a browser. Without it the ownership agreement is written by',
    "Charter's own code instead, from the same data, and the run says so.",
  ],
  DOCTAVIAN_AUTH_PROVIDER: [
    'A note to a person about where the token above came from, so a token that',
    'stops working can be traced back. Nothing reads it: npm run doctavian:signin',
    'always uses Microsoft, because their proxy rewrites the requested permission',
    'before passing it to Google, into a Google web address that does not exist,',
    'and Google refuses it.',
  ],
  DOCTAVIAN_OAUTH_CLIENT_ID: [
    'Part of obtaining the bearer token. Read by npm run doctavian:signin, which',
    'opens a browser, waits for a person to sign in, and prints the token to save',
    'in the setting above. Nothing in a run reads this.',
  ],
  DOCTAVIAN_OAUTH_SCOPE: [
    'Which permissions the sign-in asks for. It must include offline_access, or',
    'the sign-in gives back only a token that stops working within the hour and',
    'has to be repeated. Read by npm run doctavian:signin. Nothing in a run reads',
    'this.',
  ],
}

const DOCTAVIAN_READ_BY = 'src/vendors/doctavian.ts'

/** The one-off sign-in a person runs, which is the only thing reading these two. */
const DOCTAVIAN_SIGNIN_READ_BY = 'src/vendors/doctavian-signin.ts'

const doctavian = (
  [
    ['DOCTAVIAN_BASE_URL', 'text'],
    ['DOCTAVIAN_API_KEY', 'secret'],
    ['DOCTAVIAN_AUTH_PROVIDER', 'text'],
    ['DOCTAVIAN_REFRESH_TOKEN', 'secret'],
    ['DOCTAVIAN_OAUTH_CLIENT_ID', 'text'],
    ['DOCTAVIAN_OAUTH_SCOPE', 'text'],
  ] as const
).map(([name, kind]): Setting => {
  // Three are read by the client during a run. Two are read by the one-off
  // sign-in command a person types. One is read by nobody and says so.
  const readBy =
    name === 'DOCTAVIAN_BASE_URL' ||
    name === 'DOCTAVIAN_API_KEY' ||
    name === 'DOCTAVIAN_REFRESH_TOKEN'
      ? DOCTAVIAN_READ_BY
      : name === 'DOCTAVIAN_OAUTH_CLIENT_ID' || name === 'DOCTAVIAN_OAUTH_SCOPE'
        ? DOCTAVIAN_SIGNIN_READ_BY
        : null

  return {
    name,
    section: 'DOCTAVIAN — writes the ownership agreement from one adaptive template',
    what: DOCTAVIAN_NOTES[name] ?? [],
    kind,
    example: '',
    ...(readBy === null ? { readBy: null, notYetBuilt: NOT_BUILT_VENDOR } : { readBy }),
  }
})

/** What the eSign half is, honestly, until somebody has run it against a server. */
const ESIGN_NOT_PROVEN =
  'a client that is written, tested, and has never once been called. See above.'

const foxit = (
  [
    ['FOXIT_PDF_BASE_URL', 'text'],
    ['FOXIT_PDF_CLIENT_ID', 'text'],
    ['FOXIT_PDF_CLIENT_SECRET', 'secret'],
    ['FOXIT_ESIGN_BASE_URL', 'text'],
    ['FOXIT_ESIGN_CLIENT_ID', 'text'],
    ['FOXIT_ESIGN_CLIENT_SECRET', 'secret'],
  ] as const
).map(([name, kind]): Setting => {
  const isESign = name.startsWith('FOXIT_ESIGN')

  return {
    name,
    section: 'FOXIT — does the reversible work on the pack, and separately carries it to a person to sign',
    what:
      name === 'FOXIT_PDF_BASE_URL'
        ? [
            'na1.fusion.foxit.com  —  keys from developer-api.foxit.com',
            '',
            'THIS HALF IS LIVE. It joins the two documents a packet is made of, makes',
            'the joined file smaller, and reads its text back out so that a program',
            'other than the one that wrote the packet says what the packet says.',
            '',
            'Everything it is asked to do is reversible and every one of them happens',
            'BEFORE the packet is sealed. It is asked for nothing at all afterwards.',
            '',
            'It refuses anyway. Send it a sealed Charter packet and ask it to flatten',
            'the file and it answers "no permission", because the seal marks the file',
            'as certified and their reader will not modify a certified file. Neither',
            'program was told about the other. Check it with:',
            '',
            '    npm run foxit:proof',
          ]
        : name === 'FOXIT_ESIGN_BASE_URL'
          ? [
              'na1.foxitesign.foxit.com/api',
              '',
              'THIS HALF HAS NEVER BEEN CALLED. The client is written and tested and',
              'the credentials below are refused: "invalid consumer credentials".',
              'eSign issues its own key pair, from inside the eSign product, separately',
              'from the developer portal. Put that pair below and run:',
              '',
              '    npm run esign:proof',
              '',
              'Until that prints a folder number, the honest description of this half is',
              '"written, not proven", and this file says so rather than implying more.',
              '',
              'The eSign call is made by ordinary code, outside every tool list, from a',
              'folder no tool can reach. A test walks every import in the project and',
              'fails the build if a path from any tool to that folder ever appears.',
              'The agent cannot start a signature; it cannot get to the call.',
            ]
          : isESign
            ? [
                'NOT the pair from the developer portal. Those work for their document',
                'services and are refused here with "invalid consumer credentials".',
                'Generate an eSign API key and secret inside the eSign product itself.',
              ]
            : [],
    kind,
    example: '',
    ...(isESign
      ? { readBy: null, notYetBuilt: ESIGN_NOT_PROVEN }
      : { readBy: 'src/vendors/build.ts' }),
  }
})

const storage = (
  [
    [
      'STORAGE_DRIVER',
      'text',
      ['vercel = the storage included with a Vercel account.  s3 = anything S3-compatible.'],
    ],
    ['BLOB_READ_WRITE_TOKEN', 'secret', []],
    ['S3_ENDPOINT', 'text', ['Only if STORAGE_DRIVER=s3.']],
    ['S3_ACCESS_KEY_ID', 'text', []],
    ['S3_SECRET_ACCESS_KEY', 'secret', []],
    ['S3_BUCKET', 'text', []],
    [
      'VERCEL_TOKEN',
      'secret',
      ['Where the generated business websites are published.  vercel.com/account/tokens'],
    ],
    ['VERCEL_PROJECT_ID', 'text', []],
    ['PUBLISH_DOMAIN_SUFFIX', 'text', []],
  ] as const
).map(
  ([name, kind, what]): Setting => ({
    name,
    section: 'STORAGE AND HOSTING',
    what: [...what],
    kind,
    example: '',
    readBy: null,
    notYetBuilt: NOT_BUILT_STORAGE,
  }),
)

export const SETTINGS: readonly Setting[] = [
  // ---- how the project runs -------------------------------------------------
  {
    name: 'REPLAY_MODE',
    section: 'YOU PROBABLY DO NOT NEED ANY OF THESE',
    what: [
      'true  = serve saved responses. No network, no credentials, costs nothing.',
      'false = call the real services. Consumes limited free allowances.',
    ],
    kind: 'flag',
    example: 'true',
    readBy: 'src/model/cache.ts',
  },
  {
    name: 'CACHE_MODE',
    section: 'YOU PROBABLY DO NOT NEED ANY OF THESE',
    what: [
      'Overrides REPLAY_MODE when you want one exact behaviour rather than the',
      'sensible pairing. Leave it blank unless you have a reason.',
      '',
      '  replay  only saved answers. A question with no saved answer is an error,',
      '          never a quiet real call.',
      '  record  call for real, and save what comes back.',
      '  auto    use a saved answer when there is one, call when there is not.',
      '  live    call every time and save nothing.',
    ],
    kind: 'choice',
    choices: {
      replay: 'only saved answers; a missing one is an error',
      record: 'call for real and save the answer',
      auto: 'saved answer if there is one, otherwise call',
      live: 'call every time and save nothing',
    },
    example: '',
    readBy: 'src/model/cache.ts',
  },
  {
    name: 'REGISTRAR_ENV',
    section: 'YOU PROBABLY DO NOT NEED ANY OF THESE',
    what: [
      'test = the registrar’s free sandbox. Nothing real is registered, no money.',
      'live = real registrations that cost real money.',
      '',
      'This project ships as "test" and every recorded registration says which it was.',
      'Setting this to "live" is REFUSED unless SPEND_REAL_MONEY is also true, because',
      'one setting away from spending money is one setting too few.',
    ],
    kind: 'choice',
    choices: {
      test: 'the free sandbox; nothing real is registered',
      live: 'real registrations that cost real money',
    },
    example: 'test',
    readBy: 'src/settings.ts',
  },
  {
    name: 'SPEND_REAL_MONEY',
    section: 'YOU PROBABLY DO NOT NEED ANY OF THESE',
    what: [
      'The second hand on the lever. REGISTRAR_ENV=live is refused without this.',
      '',
      'Two settings rather than one, because the mistake it prevents is an ordinary',
      'one: somebody changing an environment name while chasing a bug, and finding out',
      'it was the live one by being charged. Neither setting does anything alone.',
    ],
    kind: 'flag',
    example: 'false',
    readBy: 'src/settings.ts',
  },
  {
    name: 'EXTRACTION_DEPTH',
    section: 'YOU PROBABLY DO NOT NEED ANY OF THESE',
    what: [
      'How hard the reading service works on each page of an identity document.',
      '',
      'These are the service’s OWN four names, not ours, with what each one costs per',
      'page in that service’s credits:',
      '',
      ...Object.entries(EXTRACTION_DEPTHS).map(
        ([name, one]) =>
          `  ${name.padEnd(11)}${String(one.creditsPerPage).padEnd(5)}credits per page  -- ${one.gives}`,
      ),
      '',
      `The dearest costs ${depthSpread().toFixed(2)} times the cheapest. That is the whole spread, and it`,
      'is not the reason the depth is set deliberately. The reason is that "text" and',
      '"structure" return characters and layout, and cannot say which marks on the page',
      'are the date of birth. An identity document is nothing but named fields, so',
      'anything below "understand" is REFUSED rather than quietly accepted.',
      '',
      'The depth is recorded with every call, so a run cannot be quietly cheaper in',
      'development than in a demonstration.',
    ],
    kind: 'choice',
    choices: Object.fromEntries(
      Object.entries(EXTRACTION_DEPTHS).map(([name, one]) => [
        name,
        `${one.creditsPerPage} credits a page — ${one.gives}`,
      ]),
    ),
    example: 'understand',
    readBy: 'src/tools/stage-tools.ts',
  },

  // ---- the models -----------------------------------------------------------
  {
    name: 'GEMINI_API_KEY',
    section: 'THE MODELS',
    what: ['Google Gemini — the main model.  aistudio.google.com/apikey'],
    kind: 'secret',
    example: '',
    readBy: 'src/model/build.ts',
  },
  {
    name: 'GROQ_API_KEY',
    section: 'THE MODELS',
    what: [
      'Groq — the fallback, and the only provider allowed to receive a person’s',
      'details, because it keeps nothing and does not train on what it is sent.',
      '  console.groq.com/keys',
    ],
    kind: 'secret',
    example: '',
    readBy: 'src/model/build.ts',
  },
  {
    name: 'MODEL_MAX_REQUEST_TOKENS',
    section: 'THE MODELS',
    what: [
      'The most a single request to a model may be, in tokens. Checked before',
      'sending, so an oversized request fails here rather than at the provider.',
      '',
      'The default of 4000 is not arbitrary. The fallback provider allows eight',
      'thousand tokens a minute, and a request that cannot fit twice inside that',
      'cannot be retried within a minute of failing.',
    ],
    kind: 'number',
    range: { least: 256, most: 1_048_576 },
    wholeNumbersOnly: true,
    example: '4000',
    readBy: 'src/agent/loop.ts',
  },
  {
    name: 'MAX_TURNS_PER_STAGE',
    section: 'THE MODELS',
    what: [
      'A ceiling on how many model turns any one stage may take, so a failing tool',
      'cannot loop for ever.',
      '',
      'Each stage also carries its own limit in the code, and the SMALLER of the two',
      'wins. This setting can only ever make a stage stop sooner, never let it run',
      'longer — a setting that could raise a safety limit is not a safety limit.',
    ],
    kind: 'number',
    range: { least: 1, most: 100 },
    wholeNumbersOnly: true,
    example: '12',
    readBy: 'src/agent/loop.ts',
  },

  ...doctavian,
  ...foxit,

  // ---- nutrient -------------------------------------------------------------
  {
    name: 'NUTRIENT_EXTRACTION_KEY',
    section: 'NUTRIENT — reads the owners’ identity documents and scores each field',
    what: [
      'nutrient.io',
      '',
      'TWO keys, not one. Reading named fields out of a document is a separate product',
      'from the general document processor, with its own key and its own account. The',
      'processor key used against the extraction service is refused with a 403, which',
      'means "I know you, but not here."',
      '',
      'THE KEY’S PREFIX DOES NOT TELL YOU WHICH PRODUCT IT IS. Ours begins "pdf_live_",',
      'which reads like the processor, and it is the extraction key. Do not guess. Run',
      '',
      '    npm run keys:classify',
      '',
      'which asks both products directly. Every request it sends is empty on purpose,',
      'so nothing is processed and nothing is charged.',
      '',
      'This is the one the project cannot work without: it reads the fields off an',
      'identity document.',
    ],
    kind: 'secret',
    example: '',
    readBy: 'src/checks/classify.ts src/vendors/build.ts',
  },
  {
    name: 'NUTRIENT_PROCESSOR_KEY',
    section: 'NUTRIENT — reads the owners’ identity documents and scores each field',
    what: [
      'Optional, and deliberately left empty here. Its free output carries a watermark',
      'reading "For Evaluation Purposes Only", so anything that goes into a finished',
      'pack must not pass through it.',
    ],
    kind: 'secret',
    example: '',
    readBy: 'src/checks/classify.ts',
  },

  // ---- name.com -------------------------------------------------------------
  {
    name: 'NAMECOM_USERNAME_TEST',
    section: 'NAME.COM — checks and registers the web address',
    what: [
      'name.com/account/settings/api',
      '',
      'The practice area is a SEPARATE account with its own username and its own',
      'token. The practice username is the live one with "-test" on the end. If your',
      'name.com username is an email address, the practice one is that whole address',
      'with "-test" after it, which looks wrong and is correct.',
      '',
      'The username and the token are split into practice and live pairs on purpose.',
      'One shared username with two tokens invites the mistake that costs money: a',
      'live token paired with a practice username, or the reverse.',
      '',
      'To check a practice username works, run',
      '',
      '    npm run keys:classify',
      '',
      'which calls their own free connection test and never contacts the live service.',
      'A brand new practice token can take up to fifteen minutes to start working, so',
      'a refusal straight after making one is not proof that it is wrong.',
    ],
    kind: 'text',
    example: '',
    readBy: 'src/checks/classify.ts src/vendors/build.ts',
  },
  {
    name: 'NAMECOM_TOKEN_TEST',
    section: 'NAME.COM — checks and registers the web address',
    what: [],
    kind: 'secret',
    example: '',
    readBy: 'src/checks/classify.ts src/vendors/build.ts',
  },
  {
    name: 'NAMECOM_BASE_URL_TEST',
    section: 'NAME.COM — checks and registers the web address',
    what: [
      'Their practice service, which is a separate account from the live one.',
    ],
    kind: 'text',
    example: 'https://api.dev.name.com',
    readBy: 'src/checks/classify.ts src/vendors/build.ts',
  },
  {
    name: 'NAMECOM_USERNAME_LIVE',
    section: 'NAME.COM — checks and registers the web address',
    what: [
      'Leave the two LIVE lines empty unless you genuinely mean to spend money.',
      '',
      'The username and the token travel together: which environment you are in',
      'decides BOTH halves at once, so a live token can never be paired with a',
      'practice username. And a live registration is refused unless SPEND_REAL_MONEY',
      'is true as well.',
    ],
    kind: 'text',
    example: '',
    readBy: 'src/vendors/build.ts',
  },
  {
    name: 'NAMECOM_TOKEN_LIVE',
    section: 'NAME.COM — checks and registers the web address',
    what: [],
    kind: 'secret',
    example: '',
    readBy: 'src/vendors/build.ts',
  },

  // ---- search ---------------------------------------------------------------
  {
    name: 'SERPAPI_KEY',
    section: 'SEARCH — live research on whether the business name is already taken',
    what: [
      'serpapi.com, with tavily.com as the fallback behind the same internal tool.',
      'Which of the two answered goes into the record and is never shown to the model.',
      '',
      '250 searches a month, 50 an hour, and one run uses eight to twelve. That is',
      'about twenty complete runs a month for the whole project, which is why saved',
      'answers are the default and why a real search only happens when REPLAY_MODE is',
      'false AND one of these keys is present.',
    ],
    kind: 'secret',
    example: '',
    readBy: 'src/vendors/build.ts',
  },
  {
    name: 'TAVILY_API_KEY',
    section: 'SEARCH — live research on whether the business name is already taken',
    what: [],
    kind: 'secret',
    example: '',
    readBy: 'src/vendors/build.ts',
  },

  // ---- perfect corp ---------------------------------------------------------
  {
    name: 'PERFECTCORP_API_KEY',
    section: 'PERFECT CORP — draws the new business’s first storefront picture',
    what: [
      'Redeem a key at yce.perfectcorp.com/api-console, then copy it from the API',
      'keys page. It begins sk- and it goes straight into a header.',
      '',
      'ONE VALUE, NOT TWO. This company runs two services under the same name. The',
      'older one signs in by encrypting your key and the current time with a public',
      'key they issue beside it. The newer one, which is what their console hands',
      'out keys for now, takes the key in a header like everybody else. A client',
      'written from the older documentation authenticates against nothing, and the',
      'refusal blames the credential rather than the service.',
      '',
      'To prove this one really works, run:',
      '',
      '    npm run picture:proof',
      '',
      'Until that prints the address of a picture, the honest word for this is',
      '"written, not proven", and this file and the website both use that word.',
      '',
      'Used only to turn the owners’ own description of their business into one',
      'picture for the website Charter publishes. No photograph of anybody is ever',
      'sent. Their face analysis, skin analysis and face swapping are absent from',
      'every tool list and unreachable from anything the model can trigger.',
      '',
      'Optional. Leave it blank and a run says plainly what it would have drawn.',
    ],
    kind: 'secret',
    example: '',
    readBy: null,
    notYetBuilt: PICTURE_NOT_PROVEN,
  },

  // ---- storage and hosting --------------------------------------------------
  {
    name: 'DATABASE_URL',
    section: 'STORAGE AND HOSTING',
    what: [
      'Leave blank to use the PostgreSQL engine that runs inside this project, which',
      'needs nothing installed. Set it only to point at a hosted database instead.',
    ],
    kind: 'text',
    example: '',
    readBy: 'src/db/driver.ts',
  },
  {
    name: 'CHARTER_DB_PATH',
    section: 'STORAGE AND HOSTING',
    what: [
      'Where the built-in database keeps its files. Blank means in memory only, which',
      'is what the tests use, and means nothing survives the program ending.',
    ],
    kind: 'text',
    example: '',
    readBy: 'src/db/driver.ts',
  },
  ...storage,

  // ---- the attestation key --------------------------------------------------
  {
    name: 'ATTESTATION_PRIVATE_KEY',
    section: 'THE ATTESTATION KEY',
    what: [
      'Generate with: npm run keys:generate',
      '',
      'This vouches for the head of Charter’s record. The PUBLIC half is committed to',
      'the repository at keys/attestation.pub on purpose, so anyone can check our',
      'record without asking us for anything. The PRIVATE half belongs here and',
      'nowhere else.',
      '',
      'It is an ATTESTATION — the system vouching for its own conduct. It is not a',
      'signature. In Charter that word is reserved for something a person does.',
    ],
    kind: 'secret',
    example: '',
    readBy: 'src/record/attestation.ts',
  },

  // ---- review ---------------------------------------------------------------
  {
    name: 'REVIEW_CONFIDENCE_FLOOR',
    section: 'NOTHING BELOW IS A SECRET',
    what: [
      'When a field read from an identity document goes to a person.',
      '',
      'The FIRST test is not this number. It is whether the value could be found in the',
      'document at all — the reading service says so per field, and anything it could',
      'not ground, matched only approximately, or matched only in part goes to a person',
      'whatever this number says.',
      '',
      'This floor is the last test, not the first, because the service states plainly',
      'that its confidence score "is relative and uncalibrated; it isn’t a probability',
      'or percentage."',
      '',
      'THE NUMBER BELOW IS PICKED, NOT CALIBRATED. The service tells callers to',
      'calibrate a threshold against their own recorded sample. That has not been done,',
      'and no such sample exists in this repository. Until one does, the honest setting',
      'is a high one, because sending too much to a person is the safe direction. An',
      'earlier version of this file said the number was calibrated against our own',
      'sample and that the sample was recorded. Both of those were false.',
      '',
      'The system may send MORE to a person than these rules require. It can never send',
      'fewer, and no model takes part in the decision.',
    ],
    kind: 'number',
    range: { least: 0, most: 1 },
    example: '0.85',
    readBy: 'src/tools/stage-tools.ts',
  },
  {
    name: 'REVIEW_AUDIT_SAMPLE_RATE',
    section: 'NOTHING BELOW IS A SECRET',
    what: [
      'A share of the readings that passed every test are sent to a person anyway, to',
      'catch a service that is confidently wrong. 0 turns it off. 0.1 means about one',
      'in ten.',
      '',
      'WHICH ONES ARE CHOSEN IS NOT RANDOM. It is worked out from a fingerprint of the',
      'case, the owner and the field name, so the same field is always chosen the same',
      'way and a run repeated gives exactly the same answer. Real randomness would mean',
      'the same case reviewed twice produced two different review queues, and a record',
      'nobody can reproduce is a record nobody can check.',
    ],
    kind: 'number',
    range: { least: 0, most: 1 },
    example: '0.1',
    readBy: 'src/tools/stage-tools.ts',
  },
]

// ─────────────────────────────────────────────────────────────────────────────
// Which company is behind each outside service
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The five things Charter needs from outside, and the company behind each one.
 *
 * WHY THIS IS HERE AND NOT ON THE WEBSITE
 *
 * The website names these companies. If the name lived in the page's own markup,
 * it would be a claim nobody could check, and it would go stale the day a service
 * changed. So the name lives beside the credential that service uses, and the page
 * is handed it.
 *
 * `section` is the exact heading the company's credentials appear under in the
 * list above, and `host` is where they answer. Both are checked: a test looks
 * every one up in `SETTINGS` and fails the build if the heading is not there word
 * for word, or if the address is written nowhere in that section's own
 * explanation. So renaming a section, or moving a company to a different address,
 * stops the build instead of quietly changing what a visitor is told.
 *
 * PUBLISHING HAS NO COMPANY, ON PURPOSE. Putting the finished website online is
 * not built yet, and nothing here pretends otherwise. `company` is null and the
 * page prints that it is not built rather than naming somebody who is not
 * involved.
 */
export interface CompanyBehindAService {
  /** The company's ordinary name, as a person would say it. */
  readonly company: string | null
  /**
   * Where they answer.
   *
   * Must appear somewhere in that section's own explanation, rather than being
   * written twice. Empty when there is no company.
   */
  readonly host: string
  /**
   * The heading their credentials appear under in `SETTINGS`.
   *
   * Null when the service has no credentials in the list at all, which is only
   * true for publishing, because it is not built.
   */
  readonly section: string | null
}

export const COMPANY_BEHIND: Readonly<Record<string, CompanyBehindAService>> = {
  search: {
    company: 'SerpApi',
    host: 'serpapi.com',
    section: 'SEARCH — live research on whether the business name is already taken',
  },
  registrar: {
    company: 'Name.com',
    host: 'name.com',
    section: 'NAME.COM — checks and registers the web address',
  },
  identity: {
    company: 'Nutrient',
    host: 'nutrient.io',
    section: 'NUTRIENT — reads the owners’ identity documents and scores each field',
  },
  publishing: {
    company: null,
    host: '',
    section: null,
  },
  imagery: {
    company: 'Perfect Corp',
    host: 'yce.perfectcorp.com',
    section: 'PERFECT CORP — draws the new business’s first storefront picture',
  },
  // The reversible work on the pack: joining the parts into one file, making it
  // smaller, and reading the words back out of the finished thing.
  //
  // All of it happens BEFORE the seal, and that order is the point. Once the pack
  // is sealed, their own engine refuses to modify it and answers "no permission."
  // Two programs enforcing the same rule, neither told about the other.
  documents: {
    company: 'Foxit',
    host: 'developer-api.foxit.com',
    section:
      'FOXIT — does the reversible work on the pack, and separately carries it to a person to sign',
  },
}

/**
 * Every complaint about the company list, collected rather than thrown one at a
 * time.
 *
 * Returns an empty list when every named heading is a real heading in `SETTINGS`
 * and every named address really is written in that heading's first line. A test
 * calls this and fails the build on anything it returns.
 */
export function complaintsAboutCompanies(): readonly string[] {
  const complaints: string[] = []

  for (const [slot, one] of Object.entries(COMPANY_BEHIND)) {
    if (one.section === null) {
      if (one.company !== null) {
        complaints.push(
          `The service "${slot}" names the company ${one.company} but no settings section, ` +
            `so nothing ties that name to a credential anybody could check.`,
        )
      }
      continue
    }

    const inSection = SETTINGS.filter((setting) => setting.section === one.section)
    if (inSection.length === 0) {
      complaints.push(
        `The service "${slot}" points at the settings section "${one.section}", and no ` +
          `setting is under that heading. Either the heading was renamed or the company was.`,
      )
      continue
    }

    const explained = inSection.flatMap((setting) => setting.what).join('\n')
    if (one.host !== '' && !explained.includes(one.host)) {
      complaints.push(
        `The service "${slot}" says ${one.company} answers at "${one.host}", and nothing ` +
          `written under "${one.section}" mentions that address. The website would tell a ` +
          `visitor an address this project does not use.`,
      )
    }
  }

  return complaints
}

// ─────────────────────────────────────────────────────────────────────────────
// Reading a settings file
// ─────────────────────────────────────────────────────────────────────────────

export class SettingRefusal extends Error {
  constructor(readonly complaints: readonly string[]) {
    super(
      `Charter will not start with these settings:\n\n` +
        complaints.map((one) => `  - ${one}`).join('\n') +
        `\n\nEvery setting is checked before anything runs. A value that cannot mean ` +
        `anything is refused rather than replaced by a default, because a silent ` +
        `default means the person who typed it believes one thing and the program ` +
        `does another.`,
    )
    this.name = 'SettingRefusal'
  }
}

/**
 * Turn the text of a settings file into names and values.
 *
 * Pure: takes text, returns values, touches no disk. That makes the awkward cases
 * — comments, blank lines, a value containing an equals sign, quotes, a stray
 * `export` in front — testable without any file existing anywhere.
 *
 * A line that is not `NAME=value` is IGNORED rather than being an error. Settings
 * files collect notes from people over time, and refusing to start because
 * somebody wrote a sentence in one is not a useful thing to do.
 */
export function parseEnvText(text: string): Record<string, string> {
  const values: Record<string, string> = {}

  for (const raw of text.split('\n')) {
    const line = raw.trim()
    if (line === '' || line.startsWith('#')) continue

    const match = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=(.*)$/.exec(line)
    if (match === null) continue

    const name = match[1] as string
    let value = (match[2] as string).trim()

    // Quotes around a value are how people write one with spaces in it. They are
    // not part of the value. Only a matching pair is removed, so a value that
    // genuinely begins with a quote survives.
    const first = value[0]
    if (value.length >= 2 && (first === '"' || first === "'") && value.endsWith(first)) {
      value = value.slice(1, -1)
    }

    values[name] = value
  }

  return values
}

/**
 * Read `.env` from disk and fill in anything the environment does not already say.
 *
 * The environment WINS. A value already set in the shell, or handed over by a
 * hosting service, is something somebody deliberately did for this one run, and a
 * file on disk must not quietly override it.
 *
 * A missing file is not an error. The whole project runs with no settings at all —
 * which is what `REPLAY_MODE=true`, the default, is for.
 */
export function loadEnvFile(
  path = '.env',
  into: Record<string, string | undefined> = process.env,
): { readonly loaded: boolean; readonly filled: readonly string[] } {
  if (!existsSync(path)) return { loaded: false, filled: [] }

  const filled: string[] = []
  for (const [name, value] of Object.entries(parseEnvText(readFileSync(path, 'utf8')))) {
    if (into[name] !== undefined) continue
    into[name] = value
    filled.push(name)
  }

  return { loaded: true, filled }
}

// ─────────────────────────────────────────────────────────────────────────────
// Checking what was read
// ─────────────────────────────────────────────────────────────────────────────

/** Everything the running program actually uses, already checked. */
export interface Settings {
  readonly replaying: boolean
  readonly registrarEnv: 'test' | 'live'
  readonly spendRealMoney: boolean
  readonly extractionDepth: ExtractionDepth
  readonly maxRequestTokens: number
  readonly maxTurnsPerStage: number
  readonly reviewConfidenceFloor: number
  readonly reviewAuditSampleRate: number
}

const byName = new Map(SETTINGS.map((one) => [one.name, one]))

/** The setting with this name, or an error naming the list it is missing from. */
export function settingNamed(name: string): Setting {
  const found = byName.get(name)
  if (found === undefined) {
    throw new Error(
      `there is no setting called ${name} in the list in src/settings.ts. Every ` +
        `setting has to be in that list, because .env.example is generated from it.`,
    )
  }
  return found
}

/**
 * Check one value against what its setting allows.
 *
 * Returns the complaint, in plain words, or null when it is fine. An empty value
 * always passes and means "use the default": a blank line in a settings file is
 * how people say they have not set something.
 */
export function complaintAbout(name: string, value: string | undefined): string | null {
  const setting = settingNamed(name)
  const given = (value ?? '').trim()
  if (given === '') return null

  switch (setting.kind) {
    case 'flag':
      return given === 'true' || given === 'false'
        ? null
        : `${name} is "${given}". It has to be exactly true or false.`

    case 'choice': {
      const allowed = Object.keys(setting.choices ?? {})
      return allowed.includes(given)
        ? null
        : `${name} is "${given}". It has to be one of: ${allowed.join(', ')}.`
    }

    case 'number': {
      // Written out rather than handed to Number(), which reads "" as 0 and
      // "0x10" as 16. Neither is anything a person typing a setting meant.
      if (!/^-?\d+(?:\.\d+)?$/.test(given)) {
        return `${name} is "${given}", which is not a number.`
      }
      const asNumber = Number(given)
      if (setting.wholeNumbersOnly === true && !Number.isInteger(asNumber)) {
        return `${name} is ${given}, and it has to be a whole number.`
      }
      const range = setting.range
      if (range !== undefined && (asNumber < range.least || asNumber > range.most)) {
        return `${name} is ${given}, and it has to be between ${range.least} and ${range.most}.`
      }
      return null
    }

    case 'text':
    case 'secret':
      return null
  }
}

/**
 * Check every setting, and hand back the ones the running program uses.
 *
 * Every complaint is collected before any of them is raised. Somebody who got
 * three settings wrong should be told about all three once, rather than made to
 * run the program three times to find them one at a time.
 */
export function readSettings(env: Record<string, string | undefined> = process.env): Settings {
  const complaints: string[] = []

  for (const setting of SETTINGS) {
    const complaint = complaintAbout(setting.name, env[setting.name])
    if (complaint !== null) complaints.push(complaint)
  }

  const given = (name: string): string => (env[name] ?? '').trim()
  const usable = (name: string): boolean =>
    given(name) !== '' && complaintAbout(name, given(name)) === null

  const flag = (name: string, fallback: boolean): boolean =>
    usable(name) ? given(name) === 'true' : fallback
  const number = (name: string, fallback: number): number =>
    usable(name) ? Number(given(name)) : fallback
  const choice = <T extends string>(name: string, fallback: T): T =>
    usable(name) ? (given(name) as T) : fallback

  const registrarEnv = choice<'test' | 'live'>('REGISTRAR_ENV', 'test')
  const spendRealMoney = flag('SPEND_REAL_MONEY', false)
  const extractionDepth = choice<ExtractionDepth>('EXTRACTION_DEPTH', 'understand')

  // ---- rules that are about more than one setting at a time -----------------

  if (registrarEnv === 'live' && !spendRealMoney) {
    complaints.push(
      `REGISTRAR_ENV is "live", which registers real web addresses and spends real ` +
        `money, and SPEND_REAL_MONEY is not true. Both are needed, on purpose: one ` +
        `setting away from spending money is one setting too few.`,
    )
  }

  if (!DEPTHS_THAT_NAME_FIELDS.includes(extractionDepth)) {
    complaints.push(
      `EXTRACTION_DEPTH is "${extractionDepth}", which returns characters and layout ` +
        `and cannot say which marks on the page are the date of birth. An identity ` +
        `document is nothing but named fields, so this is refused rather than ` +
        `accepted. Use one of: ${DEPTHS_THAT_NAME_FIELDS.join(', ')}.`,
    )
  }

  if (complaints.length > 0) throw new SettingRefusal(complaints)

  return {
    // Exactly "false", because anything else was already refused above. Reading
    // it loosely here would mean the check and the use disagreed about what the
    // value was, which is how a setting ends up meaning two things at once.
    replaying: given('REPLAY_MODE') !== 'false',
    registrarEnv,
    spendRealMoney,
    extractionDepth,
    maxRequestTokens: number('MODEL_MAX_REQUEST_TOKENS', 4000),
    maxTurnsPerStage: number('MAX_TURNS_PER_STAGE', 12),
    reviewConfidenceFloor: number('REVIEW_CONFIDENCE_FLOOR', 0.85),
    reviewAuditSampleRate: number('REVIEW_AUDIT_SAMPLE_RATE', 0.1),
  }
}

/** What a run uses when nobody has set anything at all. */
export const DEFAULT_SETTINGS: Settings = readSettings({})

// ─────────────────────────────────────────────────────────────────────────────
// Writing .env.example
// ─────────────────────────────────────────────────────────────────────────────

const RULE = '─'.repeat(77)

/**
 * Produce the whole of `.env.example` from the list above.
 *
 * Generated rather than written by hand, for the same reason the tool catalogue
 * is. A hand-written list is right on the day it is written and wrong the first
 * time somebody adds a setting, and the gap is invisible: the file still reads as
 * though it were complete. This project has already been caught by exactly that —
 * seven settings sat in the file for days, described as configuration, read by
 * nothing.
 *
 * The line that makes this worth doing is the one printed for a setting nothing
 * reads. `npm run settings:check` fails the build when the committed file and this
 * list disagree, so a setting cannot be added to one without the other changing in
 * the same commit, and a setting nothing reads cannot pretend otherwise.
 */
export function renderEnvExample(): string {
  const lines: string[] = [
    '# Charter — the settings',
    '#',
    '#   cp .env.example .env      then fill in .env with your real values.',
    '#',
    '# .env is never committed. This file lists the NAME of every setting the project',
    '# has, what it is for, where to get it, and — the part that matters — WHICH FILE',
    '# READS IT.',
    '#',
    '# THIS FILE IS GENERATED from the list in src/settings.ts. It is not written by',
    '# hand and it is not kept in step by anybody remembering. `npm run settings:check`',
    '# fails the build if this file and that list disagree.',
    '#',
    '# It is generated because of a real failure. Until 30 August 2026 this file listed',
    '# seven settings that no code anywhere read. Somebody following it exactly would',
    '# have set the depth an identity document is read at and the confidence floor',
    '# below which a value goes to a person, and every one of those would have been',
    '# ignored. A setting that is documented and ignored is worse than no setting: it',
    '# tells a reader the program can be steered, invites them to steer it, and then',
    '# quietly does something else.',
    '#',
    '# So every setting below says which file reads it. Anything nothing reads yet says',
    '# so, in those words, and names the part of the project that is missing.',
    '#',
    '# A value that cannot mean anything stops the program with an explanation rather',
    '# than being replaced by a default. Run `npm run settings:check` to check yours.',
    '',
  ]

  let lastSection: string | null = null

  for (const setting of SETTINGS) {
    if (setting.section !== lastSection) {
      lines.push(`# ${RULE}`)
      lines.push(`# ${setting.section}`)
      lines.push(`# ${RULE}`)
      if (setting.section === 'YOU PROBABLY DO NOT NEED ANY OF THESE') {
        lines.push(
          '# With REPLAY_MODE=true — the default — Charter serves saved vendor responses',
          '# instead of calling out, and the whole flow runs end to end with no accounts and',
          '# no keys at all. That is the intended way to evaluate this project.',
          '#',
          '# Fill these in only if you want to make real calls.',
        )
      }
      lines.push('')
      lastSection = setting.section
    }

    for (const line of setting.what) lines.push(line === '' ? '#' : `# ${line}`)

    if (setting.readBy === null) {
      if (setting.what.length > 0) lines.push('#')
      lines.push(`# NOTHING READS THIS YET. What is missing: ${setting.notYetBuilt ?? ''}`)
    } else {
      if (setting.what.length > 0) lines.push('#')
      lines.push(`# Read by: ${setting.readBy}`)
    }

    lines.push(`${setting.name}=${setting.example}`)
    lines.push('')
  }

  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd() + '\n'
}

/**
 * Every setting nothing reads yet, with what is missing.
 *
 * Printed by the check so the number is visible rather than buried, and read by a
 * test that fails when one of them has no reason written down.
 */
export function settingsNothingReads(): readonly Setting[] {
  return SETTINGS.filter((one) => one.readBy === null)
}
