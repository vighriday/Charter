/*
  Charter, the replay.

  WHAT THIS FILE DOES

  It takes the record of one real run and puts every entry of it on the page,
  all of them, before anything is clicked. Then it walks a play head down the
  list and stops dead at each entry a person caused. It will not go past one of
  those until somebody clicks. There is no timeout anywhere in this file, and a
  visitor who leaves without clicking has learned the correct thing about the
  software.

  WHY EVERY ROW IS ALREADY THERE

  A record that assembles itself on camera looks exactly like a record being made
  for the camera. So nothing here streams, types, or fades in. Every entry is in
  the document from the first frame and can be read to the end before anything
  happens. The only visual difference the play head makes is that rows it has
  reached are full ink and rows it has not are quieter.

  WHY THE CHAIN IS RECOMPUTED HERE RATHER THAN DESCRIBED

  The page invites a visitor to alter an entry and watch the check fail. Drawing
  a picture of that would be the one thing this project must never do. So this
  file carries its own SHA-256 and its own canonical form, about a hundred lines
  between them, and does the real arithmetic in the browser. The formula is the
  one in src/record/chain.ts, and it reproduces every fingerprint stored in the
  file it is handed.

  crypto.subtle would have been shorter and is deliberately not used. It does not
  exist when a page is opened straight off a disk, and this page has to work that
  way.

  NOTHING IS BUILT AS MARKUP

  Every value on the page is set with textContent. There is no innerHTML in this
  file, so nothing out of the record can become an element, whatever it holds.
*/

;(function () {
  'use strict'

  var run = window.CHARTER_RUN

  /* ══════════════════════════════════════════════════════════════════════════
     1. SHA-256
     The same function the record, the seal and the timestamp service use. One
     function across the whole project means one thing for a stranger to check.
     ══════════════════════════════════════════════════════════════════════════ */

  var K = [
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
  ]

  function rotr(x, n) {
    return (x >>> n) | (x << (32 - n))
  }

  /** SHA-256 of a string, read as UTF-8, written as lowercase hex. */
  function sha256(text) {
    var bytes = new TextEncoder().encode(text)
    var length = bytes.length
    var padded = new Uint8Array(((length + 9 + 63) >> 6) << 6)
    padded.set(bytes)
    padded[length] = 0x80

    var bits = length * 8
    var view = new DataView(padded.buffer)
    view.setUint32(padded.length - 8, Math.floor(bits / 4294967296))
    view.setUint32(padded.length - 4, bits >>> 0)

    var h = [
      0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab,
      0x5be0cd19,
    ]
    var w = new Uint32Array(64)
    var i

    for (var at = 0; at < padded.length; at += 64) {
      for (i = 0; i < 16; i += 1) w[i] = view.getUint32(at + i * 4)
      for (i = 16; i < 64; i += 1) {
        var s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3)
        var s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10)
        w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0
      }

      var a = h[0]
      var b = h[1]
      var c = h[2]
      var d = h[3]
      var e = h[4]
      var f = h[5]
      var g = h[6]
      var hh = h[7]

      for (i = 0; i < 64; i += 1) {
        var S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)
        var ch = (e & f) ^ (~e & g)
        var t1 = (hh + S1 + ch + K[i] + w[i]) >>> 0
        var S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)
        var maj = (a & b) ^ (a & c) ^ (b & c)
        var t2 = (S0 + maj) >>> 0

        hh = g
        g = f
        f = e
        e = (d + t1) >>> 0
        d = c
        c = b
        b = a
        a = (t1 + t2) >>> 0
      }

      h[0] = (h[0] + a) >>> 0
      h[1] = (h[1] + b) >>> 0
      h[2] = (h[2] + c) >>> 0
      h[3] = (h[3] + d) >>> 0
      h[4] = (h[4] + e) >>> 0
      h[5] = (h[5] + f) >>> 0
      h[6] = (h[6] + g) >>> 0
      h[7] = (h[7] + hh) >>> 0
    }

    var out = ''
    for (var j = 0; j < 8; j += 1) out += ('00000000' + h[j].toString(16)).slice(-8)
    return out
  }

  /* ══════════════════════════════════════════════════════════════════════════
     2. ONE CANONICAL FORM
     RFC 8785. Keys sorted, whitespace gone, one agreed way to write any value.
     A fingerprint is taken over text, so the same data has to produce exactly
     the same text here as it did on the machine that wrote the record.
     ══════════════════════════════════════════════════════════════════════════ */

  function canonical(value) {
    if (value === null || typeof value !== 'object') return JSON.stringify(value)
    if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']'

    var keys = Object.keys(value).sort()
    var parts = []
    for (var i = 0; i < keys.length; i += 1) {
      parts.push(JSON.stringify(keys[i]) + ':' + canonical(value[keys[i]]))
    }
    return '{' + parts.join(',') + '}'
  }

  /** What gets fingerprinted for an entry. Written out by hand, as it is in the code. */
  function headerHash(entry, payloadHash, prevHash) {
    return sha256(
      canonical({
        v: '1',
        runId: entry.runId,
        seq: entry.seq,
        ts: entry.at,
        kind: entry.kind,
        actor: entry.actor,
        stage: entry.stage,
        payloadHash: payloadHash,
        prevHash: prevHash,
      }),
    )
  }

  /* ══════════════════════════════════════════════════════════════════════════
     3. BUILDING ELEMENTS
     ══════════════════════════════════════════════════════════════════════════ */

  function make(tag, className, text) {
    var node = document.createElement(tag)
    if (className) node.className = className
    if (text !== undefined && text !== null) node.textContent = String(text)
    return node
  }

  function part(className, text) {
    return make('span', className, text)
  }

  function pad(seq) {
    return ('000' + seq).slice(-3)
  }

  function find(selector) {
    return document.querySelector(selector)
  }

  function all(selector) {
    return Array.prototype.slice.call(document.querySelectorAll(selector))
  }

  /**
   * One icon out of the set drawn once at the top of the page.
   *
   * Every icon on this site is in that one block, on the same grid and at the
   * same stroke, so the set reads as one hand and nothing is fetched from
   * anybody. This just points at one of them.
   */
  function icon(name) {
    var svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
    svg.setAttribute('viewBox', '0 0 24 24')
    svg.setAttribute('aria-hidden', 'true')
    var use = document.createElementNS('http://www.w3.org/2000/svg', 'use')
    use.setAttribute('href', '#i-' + name)
    svg.append(use)
    return svg
  }

  /* ══════════════════════════════════════════════════════════════════════════
     4. THE TOKENS
     Every number, name and fingerprint on the page is written here, into an
     element carrying data-run. Nothing is typed into the markup. When a token
     resolves to nothing the page prints the token's own name in brackets, so a
     broken build looks broken instead of looking plausible.
     ══════════════════════════════════════════════════════════════════════════ */

  var MONTHS = [
    'January',
    'February',
    'March',
    'April',
    'May',
    'June',
    'July',
    'August',
    'September',
    'October',
    'November',
    'December',
  ]

  function entryWhere(test) {
    for (var i = 0; i < run.entries.length; i += 1) {
      if (test(run.entries[i], i)) return run.entries[i]
    }
    return null
  }

  var boundaryStage = null
  for (var s = 0; s < run.stages.length; s += 1) {
    if (run.stages[s].tools.length === 0) boundaryStage = run.stages[s]
  }

  /** The answer that decided there is no written way for an owner to leave. */
  var exitQuestion = entryWhere(function (e) {
    return (
      e.kind === 'question.answered' &&
      e.payload &&
      /leave and be bought out|withdraw/i.test(String(e.payload.question))
    )
  })

  var humanRefusal = entryWhere(function (e) {
    return e.refusal && e.kind.indexOf('human') === 0
  })

  var wrongStage = entryWhere(function (e) {
    return e.refusal && e.detail.indexOf('not in stage') !== -1
  })

  /** The entry the tamper control opens on: a recorded ownership share. */
  var tamperEntry = entryWhere(function (e) {
    return e.payload && e.payload.about === 'owner_share'
  })

  function dateOf(iso) {
    var bits = String(iso).slice(0, 10).split('-')
    return { year: bits[0], month: MONTHS[Number(bits[1]) - 1], day: String(Number(bits[2])) }
  }

  var ran = dateOf(run.entries[0].at)

  var DERIVED = {
    ranOn: ran.day + ' ' + ran.month.slice(0, 3) + ' ' + ran.year,
    ranOnLong: ran.day + ' ' + ran.month + ' ' + ran.year,
    totalEntries: run.totalEntries,
    refusalCount: run.refusals.length,
    stageCount: run.stages.length,
    serviceCount: run.services.length,
    stageSevenTools: boundaryStage ? boundaryStage.tools.length : undefined,
    boundaryPosition: boundaryStage ? boundaryStage.position : undefined,
    boundaryEntry: boundaryStage ? boundaryStage.from : undefined,
    tests: run.tests,
    ownerOne: run.owners[0],
    ownerTwo: run.owners[1],
    anchorShort: /not attempted|no network/i.test(run.anchor) ? 'none' : 'taken',
    exitQuestionEntry: exitQuestion ? exitQuestion.seq : undefined,
    humanRefusalEntry: humanRefusal ? humanRefusal.seq : undefined,
    wrongStageEntry: wrongStage ? wrongStage.seq : undefined,
    tamperEntry: tamperEntry ? tamperEntry.seq : undefined,
    'pack.short': run.pack ? run.pack.fingerprint.slice(0, 12) : undefined,
    packPageCount: run.pack ? run.pack.pages.length : undefined,
    'verify.findingCount': run.verify.findings.length,
    'verify.yesCount': run.verify.findings.filter(function (f) {
      return f.answer === 'yes'
    }).length,
    'verify.unsureCount': run.verify.findings.filter(function (f) {
      return f.answer !== 'yes'
    }).length,
  }

  function valueOf(path) {
    if (path === 'here') return String(Number(head < 0 ? 1 : run.entries[head].seq))
    if (Object.prototype.hasOwnProperty.call(DERIVED, path)) return DERIVED[path]

    var at = run
    var bits = path.split('.')
    for (var i = 0; i < bits.length; i += 1) {
      if (at === null || at === undefined) return undefined
      at = at[bits[i]]
    }
    return at
  }

  function fillTokens() {
    var nodes = document.querySelectorAll('[data-run]')
    for (var i = 0; i < nodes.length; i += 1) {
      var path = nodes[i].getAttribute('data-run')
      var value = valueOf(path)
      var text =
        value === undefined || value === null || value === '' ? '[' + path + ']' : String(value)
      if (nodes[i].textContent !== text) nodes[i].textContent = text
    }
  }

  /* ══════════════════════════════════════════════════════════════════════════
     5. THE SIX MOMENTS
     Every one of these stops the run. None has a timeout. The reason under each
     heading is the record's own sentence, printed as it was written.
     ══════════════════════════════════════════════════════════════════════════ */

  function headingFor(entry) {
    if (entry.payload && typeof entry.payload.question === 'string') return entry.payload.question

    if (entry.kind === 'spend.authorised') {
      return 'The web address costs money. Charter cannot give itself permission to spend it.'
    }
    if (entry.kind === 'identity.field.checked') {
      return (
        'One thing on ' +
        String(entry.payload.owner) +
        '’s ID was close, but not an exact match.'
      )
    }
    if (entry.kind === 'signature.approved') {
      return 'Say yes to sending this exact file.'
    }
    return entry.kind
  }

  /** What the person's own answer was, where the record holds one. */
  function answerIn(entry) {
    var p = entry.payload || {}
    if (typeof p.answer === 'string') return p.answer
    if (typeof p.limitCents === 'string') {
      return 'Up to $' + (Number(p.limitCents) / 100).toFixed(2) + ', and no further.'
    }
    if (typeof p.found === 'string') {
      return 'Checked against the document, by eye: ' + p.found + '.'
    }
    return null
  }

  /* ══════════════════════════════════════════════════════════════════════════
     6. WHAT CAME BACK FROM OUTSIDE
     Blocks at the entries where something arrived from a service. Every word of
     them is read out of the run. None of it is a summary somebody wrote.
     ══════════════════════════════════════════════════════════════════════════ */

  function money(cents) {
    return '$' + (Number(cents) / 100).toFixed(2)
  }

  function returnedAfter(entry) {
    var block = make('div', 'returned')

    if (entry.kind === 'search.performed') {
      if (!run.naming) return null
      block.append(
        document.createTextNode('The search found a business already trading as '),
        make('b', '', run.naming.collidedWith),
        document.createTextNode(
          '. The comparison came back as a collision, so the name changed from ',
        ),
        make('b', '', run.naming.firstChoice),
        document.createTextNode(' to '),
        make('b', '', run.naming.settledOn),
        document.createTextNode('. The second search, on the new name, came back clear.'),
      )
      return block
    }

    if (entry.kind === 'address.registered') {
      var said = []
      for (var i = 0; i < run.addresses.length; i += 1) {
        var a = run.addresses[i]
        if (a.outcome === 'taken') said.push(a.domain + ' was taken')
        else if (a.outcome === 'too dear') {
          said.push(a.domain + ' was free and cost ' + money(a.priceCents) + ', over the limit')
        } else said.push(a.domain + ' was registered for ' + money(a.priceCents))
      }
      block.append(
        document.createTextNode(run.addresses.length + ' addresses were tried. '),
        make('b', '', said.join('. ') + '.'),
        document.createTextNode(
          ' The second was refused without contacting the registrar at all, because the price ' +
            'was over the limit a person had set.',
        ),
      )
      return block
    }

    if (entry.kind === 'address.records.written') {
      block.append(
        document.createTextNode(
          run.records.sent.length +
            ' records were sent, and the registrar accepted them. Accepted means it took them, ' +
            'not that it is holding them. ',
        ),
        make('b', '', 'Accepted is not stored.'),
        document.createTextNode(' Reading them back is the only way to know.'),
      )
      return block
    }

    if (entry.kind === 'address.records.listed') {
      var lines = []
      for (var j = 0; j < run.records.held.length; j += 1) {
        var r = run.records.held[j]
        lines.push((r.host || '@') + ' ' + r.kind + ' ' + r.answer)
      }
      block.append(
        document.createTextNode(run.records.held.length + ' records were read back: '),
        make('b', '', lines.join(', ')),
        document.createTextNode(
          run.records.match
            ? '. They match what was sent. This still does not prove the address resolves ' +
                'anywhere yet, and nothing on this page says it does.'
            : '. They do not match what was sent.',
        ),
      )
      return block
    }

    return null
  }

  /* ══════════════════════════════════════════════════════════════════════════
     7. THE RECORD ON THE PAGE
     ══════════════════════════════════════════════════════════════════════════ */

  var recordRoot = find('[data-record]')
  var railRoot = find('[data-rail]')
  var rows = []
  var ticks = []
  var inserts = []
  var head = -1
  var timer = null
  var holding = false

  var PACE = 90
  var PAUSE_AT_BOUNDARY = 900

  /** The sections written in the page and moved into the record where they belong. */
  var moved = {}
  var movedNodes = document.querySelectorAll('[data-move-after]')
  for (var mv = 0; mv < movedNodes.length; mv += 1) {
    moved[movedNodes[mv].getAttribute('data-move-after')] = movedNodes[mv]
  }

  function chipFor(entry) {
    var chip = make('button', 'chip', entry.fingerprint.slice(0, 6))
    chip.type = 'button'
    chip.title = 'this entry’s fingerprint'
    chip.addEventListener('click', function () {
      var open = chip.getAttribute('data-open') === 'true'
      chip.setAttribute('data-open', open ? 'false' : 'true')
      chip.textContent = open ? entry.fingerprint.slice(0, 6) : entry.hash
      if (!open && navigator.clipboard) navigator.clipboard.writeText(entry.hash)
    })
    return chip
  }

  /**
   * The seam: the characters this entry's backward pointer shares with the
   * fingerprint of the entry above it. It is a comparison, not a value printed
   * twice, which is the only reason it is worth a column.
   */
  function seamBetween(previous, entry) {
    if (!previous) return ''
    var shared = ''
    for (var i = 0; i < 6 && previous.hash[i] === entry.prevHash[i]; i += 1) {
      shared += previous.hash[i]
    }
    return shared
  }

  /* ══════════════════════════════════════════════════════════════════════════
     WHAT EACH STEP IS CALLED, IN WORDS

     The diary names every step the way a program names things: a short dotted
     name, the same one every time, easy to search for and impossible to mistake
     for another. That is the right way to write a diary and the wrong way to
     show one. "identity.field.sent.for.review" is exact, and a person reading it
     for the first time learns nothing from it.

     So the row shows the plain phrase and keeps the exact name on hover, and the
     file people download is untouched. Nothing is hidden and nothing is renamed:
     the diary still says what it always said.

     A name with no phrase here falls back to the name itself, so a new kind of
     step shows up as itself rather than disappearing.
     ══════════════════════════════════════════════════════════════════════════ */

  var PLAIN_WORDS = {
    'turn.started': 'asked itself what to do next',
    'model.answered': 'decided what to do',
    'tool.ran': 'used a tool',
    'tool.refused': 'was not allowed to',
    'tool.arguments.rejected': 'filled it in wrongly',
    'turn.retried': 'tried again',
    'question.asked': 'asked a question',
    'question.answered': 'a person answered',
    'fact.recorded': 'wrote something down',
    'spend.requested': 'asked to spend money',
    'spend.authorised': 'a person allowed it',
    'spend.applied': 'money spent',
    'human.act.refused': 'said no to a person',
    'stage.entered': 'moved to the next step',
    'search.performed': 'searched the web',
    'names.compared': 'compared the names',
    'address.checked': 'checked the web address',
    'address.registration.refused': 'could not take the address',
    'address.registered': 'took the web address',
    'address.records.written': 'pointed the address at the site',
    'address.records.listed': 'read the address settings back',
    'address.records.refused': 'would not change the address settings',
    'agreement.choice.recorded': 'recorded a choice for the contract',
    'agreement.choice.refused': 'would not record that choice',
    'agreement.drafted': 'wrote the contract',
    'agreement.draft.refused': 'would not write the contract',
    'identity.read': 'read an ID document',
    'identity.read.refused': 'would not read the ID',
    'identity.field.sent.for.review': 'sent a value to a person',
    'identity.field.checked': 'a person checked a value',
    'pack.sealed': 'finished and stamped the file',
    'pack.refused': 'would not change the finished file',
    'signature.approved': 'a person said yes to sending it',
    'storefront.drawn': 'drew the shop picture',
    'storefront.refused': 'would not draw the picture',
    'site.published': 'put the website online',
    'site.publish.refused': 'would not put the site online',
  }

  /* Who did a thing. The diary files them under the names the code uses, and only
     one of those four words means the same thing to everybody else. */
  var WHO = {
    model: 'software',
    system: 'system',
    vendor: 'outside',
    human: 'a person',
  }

  function whoDid(actor) {
    return Object.prototype.hasOwnProperty.call(WHO, actor) ? WHO[actor] : actor
  }

  function inWords(kind) {
    return Object.prototype.hasOwnProperty.call(PLAIN_WORDS, kind) ? PLAIN_WORDS[kind] : kind
  }

  /** What happened, in words, with the diary's own name for it kept on hover. */
  function named(kind) {
    var cell = part('row-kind', inWords(kind))
    cell.title = kind
    return cell
  }

  function buildStageHead(stage) {
    var block = make('div', 'stage-head')
    var line = make('div', 'stage-line')
    line.append(
      part('stage-no', 'Step ' + stage.position + ' of 8'),
      part('stage-range', 'steps ' + Number(stage.from) + ' to ' + Number(stage.to)),
    )
    block.append(line, make('h3', 't-sub', stage.title), make('p', 'stage-what', stage.whatHappens))
    block.append(make('div', 'tools-label', 'What it is allowed to do here'))

    var tools = make('div', 'tools')
    var does = whatToolsDo(stage.tools)
    for (var i = 0; i < stage.tools.length; i += 1) {
      var one = make('span', 'tool', does[i])
      one.title = stage.tools[i]
      tools.append(one)
    }
    block.append(tools)
    return block
  }

  function buildInsert(entry, index) {
    var insert = make('div', 'insert')
    insert.setAttribute('data-gate', entry.seq)

    var stamp = make('div', 'insert-stamp')
    stamp.append(
      icon('stop'),
      part('', 'Step ' + Number(entry.seq) + ' · stopped · only a person can answer this'),
    )

    insert.append(
      stamp,
      make('h3', 'insert-heading', headingFor(entry)),
      make('p', 'insert-why', entry.humanAct.why),
    )

    // A question that was never written as an entry of its own. Said plainly,
    // because a reader comparing the record against the page would notice.
    var previous = run.entries[index - 1]
    if (
      entry.payload &&
      typeof entry.payload.question === 'string' &&
      !(previous && previous.kind === 'question.asked')
    ) {
      insert.append(
        make(
          'div',
          'insert-aside',
          'This question is written down inside the answer, rather than as a step of its own.',
        ),
      )
    }

    var answer = answerIn(entry)
    if (answer) insert.append(make('p', 'insert-answer', answer))

    // The packet is approved by name, not in the abstract.
    if (entry.payload && typeof entry.payload.packFingerprint === 'string') {
      var named = make('p', 'insert-answer', 'The exact file, named by its fingerprint: ')
      named.append(make('code', '', entry.payload.packFingerprint.slice(0, 12)))
      insert.append(named)
    }

    var act = make('div', 'insert-act')
    var button = make('button', 'act')
    button.type = 'button'
    button.append(icon('person'), part('', entry.humanAct.button))
    button.addEventListener('click', function () {
      performGate(entry, index, insert)
    })
    act.append(button)
    insert.append(act, make('div', 'insert-skipped', 'Answered by somebody else'))

    return insert
  }

  /**
   * The visitor's own act becoming a record entry.
   *
   * The paper fades back to board, the shadow drops away, and one monospace row
   * appears in its place carrying the real sequence number, the real kind and the
   * real fingerprints. No tick, no toast, no sound. It is a record entry, and a
   * record entry is what it looks like.
   */
  function performGate(entry, index, insert) {
    if (insert.getAttribute('data-done') === 'true') return
    insert.setAttribute('data-done', 'true')

    var line = make('div', 'transcribed')
    line.append(
      part('row-seam', seamBetween(run.entries[index - 1], entry)),
      part('row-seq', pad(entry.seq)),
      part('row-actor', whoDid(entry.actor)),
      named(entry.kind),
      part('row-detail', entry.prevHash.slice(0, 8) + ' → ' + entry.hash.slice(0, 8)),
    )
    insert.append(line)

    if (exitQuestion && entry.seq === exitQuestion.seq) {
      insert.append(
        make(
          'p',
          'transcribed-bridge',
          'You have just decided there is no agreed way out of this company. Charter is about ' +
            'to write that down, and say why, further along.',
        ),
      )
    }

    var next = run.entries[index + 1]
    if (next && next.refusal && next.kind.indexOf('human') === 0) {
      insert.append(
        make(
          'p',
          'transcribed-bridge',
          'The next step is Charter saying no to a person. A second try named the wrong job, ' +
            'so it did not go through.',
        ),
      )
    }

    head = index
    paint()
    start()
  }

  function stageNamed(name) {
    for (var i = 0; i < run.stages.length; i += 1) {
      if (run.stages[i].name === name) return run.stages[i]
    }
    return null
  }

  function whyOf(seq) {
    for (var i = 0; i < run.refusals.length; i += 1) {
      if (run.refusals[i].seq === seq) return run.refusals[i].why
    }
    return null
  }

  function build() {
    var seenStage = {}
    var previous = null
    var searchesDescribed = 0

    for (var i = 0; i < run.entries.length; i += 1) {
      var entry = run.entries[i]

      // A stage header, once, at the first entry belonging to it. The boundary
      // stage supplies its own further down, because what is missing from it is
      // the whole point and an ordinary header would bury that.
      if (entry.stage && !seenStage[entry.stage]) {
        seenStage[entry.stage] = true
        var stage = stageNamed(entry.stage)
        if (stage && stage.tools.length > 0) recordRoot.append(buildStageHead(stage))
      }

      var row = make('div', 'row')
      row.setAttribute('data-actor', entry.actor)
      row.setAttribute('data-seq', entry.seq)
      if (entry.refusal) row.setAttribute('data-refusal', 'true')

      row.append(
        part('row-seam', seamBetween(previous, entry)),
        part('row-seq', pad(entry.seq)),
        part('row-actor', whoDid(entry.actor)),
        named(entry.kind),
        part('row-detail', entry.detail),
      )
      var chipCell = make('span', 'row-chip')
      chipCell.append(chipFor(entry))
      row.append(chipCell)

      recordRoot.append(row)
      rows.push(row)

      if (entry.refusal) {
        var why = whyOf(entry.seq)
        if (why) recordRoot.append(make('p', 'why', why))
      }

      // The first search gets the block. The second is the clear answer that
      // block already describes, and a second copy would be padding.
      var describe = entry.kind !== 'search.performed' || searchesDescribed === 0
      if (entry.kind === 'search.performed') searchesDescribed += 1
      if (describe) {
        var returned = returnedAfter(entry)
        if (returned) recordRoot.append(returned)
      }

      if (entry.actor === 'human' && entry.humanAct) {
        var insert = buildInsert(entry, i)
        recordRoot.append(insert)
        inserts.push({ insert: insert, index: i })
      }

      if (moved[entry.kind]) {
        moved[entry.kind].hidden = false
        recordRoot.append(moved[entry.kind])
      }
      if (boundaryStage && entry.stage === boundaryStage.name && moved.boundary) {
        moved.boundary.hidden = false
        recordRoot.append(moved.boundary)
        delete moved.boundary
      }

      previous = entry
    }
  }

  /* ---- the rail ---------------------------------------------------------- */

  function buildRail() {
    for (var i = 0; i < run.entries.length; i += 1) {
      var entry = run.entries[i]
      var tick = make('div', 'rail-tick')
      if (entry.actor === 'human') tick.setAttribute('data-human', 'true')
      if (entry.refusal) tick.setAttribute('data-refusal', 'true')
      railRoot.append(tick)
      ticks.push(tick)
    }

    railRoot.addEventListener('pointerdown', function (event) {
      railRoot.setAttribute('data-dragging', 'true')
      railRoot.setPointerCapture(event.pointerId)
      scrubTo(event)
    })
    railRoot.addEventListener('pointermove', function (event) {
      if (railRoot.getAttribute('data-dragging') === 'true') scrubTo(event)
    })
    railRoot.addEventListener('pointerup', function () {
      railRoot.setAttribute('data-dragging', 'false')
    })
    railRoot.addEventListener('pointercancel', function () {
      railRoot.setAttribute('data-dragging', 'false')
    })
  }

  function scrubTo(event) {
    var first = ticks[0].getBoundingClientRect()
    var last = ticks[ticks.length - 1].getBoundingClientRect()
    var span = Math.max(1, last.bottom - first.top)
    var share = (event.clientY - first.top) / span
    var wanted = Math.round(share * (run.entries.length - 1))
    goTo(Math.max(0, Math.min(run.entries.length - 1, wanted)))
  }

  /**
   * Move the play head.
   *
   * Backwards is free: the record is on the page and a reader may look wherever
   * they like. Forwards stops at the next gate nobody has performed, because the
   * argument of this page is that nothing gets past a person, and a page that let
   * you slide past one would be arguing the opposite.
   */
  function goTo(wanted) {
    stop()
    holding = true

    var limit = wanted
    for (var i = head + 1; i <= wanted; i += 1) {
      if (run.entries[i].actor === 'human' && !performed(i)) {
        limit = i - 1
        break
      }
    }

    head = Math.max(-1, limit)
    paint()
  }

  function performed(index) {
    for (var i = 0; i < inserts.length; i += 1) {
      if (inserts[i].index === index) {
        return inserts[i].insert.getAttribute('data-done') === 'true'
      }
    }
    return true
  }

  /* ---- the play head ----------------------------------------------------- */

  function paint() {
    for (var i = 0; i < rows.length; i += 1) {
      var reached = i <= head ? 'true' : 'false'
      if (rows[i].getAttribute('data-reached') !== reached) {
        rows[i].setAttribute('data-reached', reached)
        ticks[i].setAttribute('data-reached', reached)
      }
    }
    fillTokens()
    var back = find('[data-do="back"]')
    if (back) back.disabled = head <= 0
  }

  function step() {
    if (head >= run.entries.length - 1) {
      stop()
      return
    }

    var next = run.entries[head + 1]
    if (next.actor === 'human' && !performed(head + 1)) {
      stop()
      return
    }

    head += 1
    paint()

    // The one deliberate pause on the site. Everything holds still, and nothing
    // happening is the content.
    if (boundaryStage && next.stage === boundaryStage.name) {
      stop()
      window.setTimeout(function () {
        if (!holding) start()
      }, PAUSE_AT_BOUNDARY)
    }
  }

  function start() {
    holding = false
    stop()
    timer = window.setInterval(step, PACE)
  }

  function stop() {
    if (timer !== null) window.clearInterval(timer)
    timer = null
  }

  /* ══════════════════════════════════════════════════════════════════════════
     8. THE LISTS BESIDE THE RECORD
     ══════════════════════════════════════════════════════════════════════════ */

  function fillRefusals() {
    var root = find('[data-refusals]')
    for (var i = 0; i < run.refusals.length; i += 1) {
      var line = make('div', 'check')
      var mark = make('span', 'check-answer')
      mark.append(part('', 'step ' + Number(run.refusals[i].seq)))
      line.append(mark, make('p', 'cannot', run.refusals[i].why))
      root.append(line)
    }
  }

  function fillFindings() {
    var root = find('[data-findings]')
    for (var i = 0; i < run.verify.findings.length; i += 1) {
      var f = run.verify.findings[i]
      var mark = f.answer === 'yes' ? '[yes]' : f.answer === 'no' ? '[NO ]' : '[ ? ]'
      var line = make('div', 'check')
      line.append(part('check-answer', mark), make('p', 'check-question', f.question))
      root.append(line)
    }

    var cannot = find('[data-cannot]')
    for (var j = 0; j < run.verify.cannotProve.length; j += 1) {
      cannot.append(make('p', 'cannot', run.verify.cannotProve[j]))
    }
  }

  function countIn(stageName) {
    var n = 0
    for (var i = 0; i < run.entries.length; i += 1) {
      if (run.entries[i].stage === stageName) n += 1
    }
    return n
  }

  function fillStages() {
    var root = find('[data-stages]')
    var inStages = 0

    for (var i = 0; i < run.stages.length; i += 1) {
      var stage = run.stages[i]
      var mine = countIn(stage.name)
      inStages += mine

      var grid = make('div', 'stage-row')
      if (stage.tools.length === 0) grid.setAttribute('data-empty', 'true')
      grid.append(
        part('stage-no', String(stage.position)),
        part('stage-row-title', stage.title),
        part('stage-row-n', mine + ' entries'),
        part(
          'stage-row-n stage-row-tools',
          stage.tools.length === 0 ? '' : stage.tools.length + ' tools',
        ),
        part('stage-row-n', stage.from + ' to ' + stage.to),
      )

      var li = make('li')
      li.append(grid)
      root.append(li)
    }

    // The row that closes the arithmetic. Without it the eight stages add up to
    // less than the run, and a reader who checks would be right to stop reading.
    var loose = run.totalEntries - inStages
    var lastGrid = make('div', 'stage-row')
    lastGrid.append(
      part('stage-no', ''),
      part('stage-row-title', 'Belonging to no stage'),
      part('stage-row-n', loose + ' entries'),
      part('stage-row-n', ''),
      part('stage-row-n', ''),
    )
    var lastLi = make('li')
    lastLi.append(lastGrid)
    root.append(lastLi)

    find('[data-stage-arithmetic]').textContent =
      loose +
      ' entries belong to no stage. ' +
      run.counts.human +
      ' of them are a person. The ' +
      (loose - run.counts.human === 1 ? 'other one is' : 'others are') +
      ' Charter refusing a person, because the token did not match.'
  }

  /** Which entries a given service produced, worked out from the record. */
  var SERVICE_ENTRIES = {
    search: function (e) {
      return e.kind.indexOf('search.') === 0
    },
    registrar: function (e) {
      return e.kind.indexOf('address.') === 0
    },
    identity: function (e) {
      return e.actor === 'vendor' && e.kind.indexOf('identity.') === 0
    },
    publishing: function (e) {
      return e.actor === 'vendor' && e.kind.indexOf('site.') === 0
    },
    imagery: function (e) {
      return e.actor === 'vendor' && e.kind.indexOf('storefront.') === 0
    },
  }

  function fillServices() {
    var root = find('[data-services]')

    for (var i = 0; i < run.services.length; i += 1) {
      var service = run.services[i]
      var test = SERVICE_ENTRIES[service.name]
      var seqs = []
      for (var j = 0; j < run.entries.length; j += 1) {
        if (test && test(run.entries[j])) seqs.push(run.entries[j].seq)
      }

      var name = make('div')
      var title = make('div', 'article-heading')
      title.append(icon('globe'), part('', 'the ' + service.name))
      name.append(title, part('service-name', service.company || 'Not built yet'))
      if (service.host) name.append(make('span', 'service-host', service.host))

      var why = make('div')
      why.append(make('p', 'service-why', service.why))
      why.append(
        make(
          'div',
          'service-entries',
          seqs.length === 0
            ? 'it produced no steps in this run'
            : 'steps ' + seqs.map(Number).join(', '),
        ),
      )

      var grid = make('div', 'service')
      grid.append(name, part('service-kind', service.kind), why)

      var li = make('li')
      li.append(grid)
      root.append(li)
    }
  }

  /* ══════════════════════════════════════════════════════════════════════════
     8d. EVERY OUTSIDE COMPANY, AND WHETHER IT HAS ACTUALLY HAPPENED

     Built from site/services.js, which is generated from
     src/vendors/who-does-what.ts. There is no second copy of this list anywhere,
     and a check fails the build the moment the generated file and the code
     disagree. That matters more here than anywhere else on the page, because
     this is the list somebody would most like to quietly leave the awkward
     parts off.
     ══════════════════════════════════════════════════════════════════════════ */

  function fillWhoItUses() {
    var root = find('[data-who-list]')
    var data = window.CHARTER_SERVICES
    if (!root || !data) return

    var count = find('[data-who="count"]')
    if (count) count.textContent = String(data.companies.length)

    for (var i = 0; i < data.companies.length; i += 1) {
      root.append(oneCompany(data.companies[i]))
    }
  }

  /** The word for a state, and the class that colours it. */
  var STATE_WORD = {
    live: 'live',
    'written, not proven': 'written, never called',
    'not built': 'not built',
  }

  function oneCompany(one) {
    var card = make('section', 'who')

    var head = make('div', 'who-head')
    var title = make('div', 'who-title')
    title.append(icon('globe'), part('who-name', one.company))
    head.append(title)

    var chips = make('div', 'who-chips')
    chips.append(
      make(
        'span',
        'who-state who-state-' + one.state.split(',')[0].replace(/\s+/g, '-'),
        STATE_WORD[one.state] || one.state,
      ),
    )
    chips.append(make('span', 'who-host', one.host))
    chips.append(make('span', 'who-step', one.step === 0 ? 'every step' : 'step ' + one.step))
    head.append(chips)

    card.append(head)
    card.append(make('p', 'who-job', one.job))

    var columns = make('div', 'who-columns')
    columns.append(oneColumn('What Charter sends them', one.whatWeSend))
    columns.append(oneColumn('What comes back', one.whatComesBack))
    columns.append(oneColumn('What it never uses', one.neverUsed, 'who-never'))
    card.append(columns)

    if (one.stillNotTrue) {
      var note = make('p', 'who-note')
      note.append(part('who-note-label', 'Still not true. '), part('', one.stillNotTrue))
      card.append(note)
    }

    var foot = make('div', 'who-foot')
    if (one.seeItYourself) {
      var run = make('div', 'who-run')
      run.append(part('who-run-label', 'See it yourself'), make('code', '', one.seeItYourself))
      foot.append(run)
    }
    var where = make('div', 'who-code')
    where.append(part('who-run-label', 'The code'))
    for (var j = 0; j < one.code.length; j += 1) {
      where.append(make('code', '', one.code[j]))
    }
    foot.append(where)
    card.append(foot)

    return card
  }

  function oneColumn(heading, lines, extra) {
    var column = make('div', 'who-column' + (extra ? ' ' + extra : ''))
    column.append(make('h3', 'who-column-head', heading))
    var list = make('ul', 'who-lines')
    for (var i = 0; i < lines.length; i += 1) {
      list.append(make('li', '', lines[i]))
    }
    column.append(list)
    return column
  }

  /* ══════════════════════════════════════════════════════════════════════════
     8c. WHAT IS IN THE PACKET, AND WHOSE DOCUMENTS WERE READ
     ══════════════════════════════════════════════════════════════════════════ */

  function fillPacket() {
    var parts = find('[data-pack-parts]')
    for (var i = 0; i < run.pack.parts.length; i += 1) {
      var li = make('li', 't-note')
      li.textContent = run.pack.parts[i]
      parts.append(li)
    }

    var documents = find('[data-documents]')
    for (var j = 0; j < run.identity.length; j += 1) {
      var one = run.identity[j]
      var block = make('div', 'document')
      if (one.sentToAPerson.length > 0) block.setAttribute('data-checked', 'true')

      block.append(
        part('document-owner', one.owner),
        part('document-fields', one.fieldsRead + ' values read'),
      )

      if (one.sentToAPerson.length === 0) {
        block.append(
          make(
            'div',
            'document-note',
            'Everything matched. Nothing had to go to a person.',
          ),
        )
      } else {
        for (var k = 0; k < one.sentToAPerson.length; k += 1) {
          var field = one.sentToAPerson[k]
          block.append(
            make(
              'div',
              'document-note',
              field.field + ': ' + field.reasons.join(' ') + ' A person looked, and cleared it.',
            ),
          )
        }
      }

      documents.append(block)
    }

    var words = find('[data-storefront-words]')
    if (words && run.storefront) words.textContent = run.storefront.fromWords
  }

  function fillAgreement() {
    var decisions = find('[data-decisions]')
    for (var i = 0; i < run.agreement.decisions.length; i += 1) {
      decisions.append(make('p', 't-body', run.agreement.decisions[i]))
      if (i < run.agreement.decisions.length - 1) decisions.append(make('div', 'gap-s'))
    }

    // A few are open to begin with and the rest open in place, because fifteen
    // sections at once is a wall nobody reads.
    //
    // Which ones open is asked of the document rather than decided here: the ones
    // it says a person opens it to read, and every one that is there because of an
    // answer the owners gave. A list of headings in this file would be a second
    // opinion about a document this page did not write, and it would be wrong the
    // first time a run produced different sections.
    var opensFirst = []
    for (var f = 0; f < run.agreement.articles.length; f += 1) {
      var candidate = run.agreement.articles[f]
      if (candidate.readFirst || candidate.becauseOfAnAnswer) opensFirst.push(candidate.number)
    }

    var root = find('[data-articles]')
    for (var j = 0; j < run.agreement.articles.length; j += 1) {
      var article = run.agreement.articles[j]
      var block = make('div', 'article')
      block.setAttribute('data-article', 'true')
      if (article.becauseOfAnAnswer) block.setAttribute('data-yours', 'true')
      if (opensFirst.indexOf(article.number) === -1) block.hidden = true
      var heading = make('div', 'article-heading')
      if (article.becauseOfAnAnswer) heading.append(icon('person'))
      heading.append(
        part(
          '',
          'Article ' +
            article.number +
            (article.becauseOfAnAnswer ? ' · because of what a person answered' : ''),
        ),
      )

      block.append(
        heading,
        make('h4', 'article-title', article.heading),
        make('p', 'article-why', article.why),
      )
      root.append(block)
    }
  }

  /* ══════════════════════════════════════════════════════════════════════════
     8b. THE MURAL
     One tile per entry, drawn out of that entry's own fingerprint.

     WHY A PICTURE OF A NUMBER IS WORTH THE SPACE

     The record rests on one property: change any part of an entry and its
     fingerprint becomes a completely different number, not a nearby one. That is
     the whole reason modification is detectable, and it is invisible in a column
     of hexadecimal, because one column of hexadecimal looks like every other
     column of hexadecimal.

     So each tile is the first four bytes of that entry's fingerprint, drawn as a
     pattern: bit set, square inked. The pattern IS the number. Nothing is added,
     nothing is chosen, and there is no colour scale, no scaling factor and no
     smoothing. Two entries differing by one character produce two tiles that look
     nothing like each other, and when a visitor rewrites the record the tiles
     after the break visibly become different objects.

     Mirrored down the middle, so a tile reads as a mark rather than as noise. The
     mirror halves the information shown and none of the information used: the
     comparison a reader makes is between tiles, and both halves come from the
     same four bytes.
     ══════════════════════════════════════════════════════════════════════════ */

  var MURAL_COLUMNS = 22
  var MURAL_CELLS = 8

  /**
   * Where the mural is drawn, and in what ink.
   *
   * Twice, on two grounds. On the dark panel the tiles are board and on a light
   * card they are ink, because a mark is whatever the paper is not. The pattern
   * is identical in both, because the pattern is the number.
   */
  var MURALS = [
    { canvas: find('[data-mural]'), ink: '#e8ebe4', human: '#2c5497' },
    { canvas: find('[data-mural-2]'), ink: '#e8ebe4', human: '#2c5497' },
  ]

  /** The pattern for one fingerprint: 32 bits, one per cell of the left half. */
  function patternOf(hash) {
    var bits = []
    for (var byte = 0; byte < 4; byte += 1) {
      var value = parseInt(hash.slice(byte * 2, byte * 2 + 2), 16)
      for (var bit = 7; bit >= 0; bit -= 1) bits.push((value >> bit) & 1)
    }
    return bits
  }

  function inkFor(entry, broken, where) {
    if (broken) return '#8e2c21'
    if (entry.actor === 'human') return where.human
    return where.ink
  }

  /**
   * Draw every tile.
   *
   * `hashes` is whatever the record currently says, so the same function draws
   * the untouched record and the rewritten one. `brokenFrom` is the sequence
   * number at and after which the entries no longer match what was written.
   */
  function drawMural(hashes, brokenFrom) {
    for (var m = 0; m < MURALS.length; m += 1) {
      if (MURALS[m].canvas) drawOne(MURALS[m], hashes, brokenFrom)
    }
  }

  function drawOne(where, hashes, brokenFrom) {
    shownHashes = hashes
    shownBrokenFrom = brokenFrom
    var muralCanvas = where.canvas
    var width = muralCanvas.clientWidth
    if (width < 40) return

    var gap = width > 700 ? 6 : 3
    var tile = (width - gap * (MURAL_COLUMNS - 1)) / MURAL_COLUMNS
    // As many tiles as there are fingerprints to draw, which is not always as
    // many as the record started with. Dropping the last two entries hands this
    // 152, and a grid built for 154 would ask for a fingerprint that is not
    // there and stop drawing altogether.
    var showing = hashes.length
    var rows = Math.ceil(showing / MURAL_COLUMNS)
    var height = rows * tile + (rows - 1) * gap

    var ratio = window.devicePixelRatio || 1
    muralCanvas.width = Math.round(width * ratio)
    muralCanvas.height = Math.round(height * ratio)
    muralCanvas.style.height = height + 'px'

    // The number beside the mural is the number of tiles under it, so a record
    // that has been shortened cannot be labelled with the total it began with.
    var says = muralCanvas.parentNode.querySelector('[data-mural-count]')
    if (says) says.textContent = showing + ' steps'

    var pen = muralCanvas.getContext('2d')
    pen.setTransform(ratio, 0, 0, ratio, 0, 0)
    pen.clearRect(0, 0, width, height)

    var cell = tile / MURAL_CELLS
    var half = MURAL_CELLS / 2

    for (var i = 0; i < showing; i += 1) {
      var entry = run.entries[i]
      var broken = brokenFrom !== null && Number(entry.seq) >= Number(brokenFrom)
      var bits = patternOf(hashes[i])

      var left = (i % MURAL_COLUMNS) * (tile + gap)
      var top = Math.floor(i / MURAL_COLUMNS) * (tile + gap)

      pen.fillStyle = inkFor(entry, broken, where)

      for (var at = 0; at < bits.length; at += 1) {
        if (bits[at] === 0) continue
        var column = at % half
        var row = Math.floor(at / half)
        pen.fillRect(
          Math.round(left + column * cell),
          Math.round(top + row * cell),
          Math.ceil(cell),
          Math.ceil(cell),
        )
        // The mirror. Same four bytes, read back the other way.
        pen.fillRect(
          Math.round(left + (MURAL_CELLS - 1 - column) * cell),
          Math.round(top + row * cell),
          Math.ceil(cell),
          Math.ceil(cell),
        )
      }
    }
  }

  /** What the record says right now, before anybody has touched it. */
  var storedHashes = run.entries.map(function (one) {
    return one.hash
  })

  // What the mural is currently showing, so a view that was hidden when it
  // changed can be redrawn correctly the moment it appears.
  var shownHashes = storedHashes
  var shownBrokenFrom = null

  /**
   * Rewrite the record so that it fits together again.
   *
   * This is the attack the chain cannot stop, done properly rather than
   * described. One entry's detail is changed, and then every fingerprint after it
   * is recomputed so that every link joins. The result is a perfectly valid
   * chain. It is simply not the same one, and the mural shows that in the only
   * way a person can actually see: everything after the change becomes a
   * different object.
   *
   * What survives is the attestation, which was made over the old ending by
   * somebody holding a key, and no longer describes this record at all.
   */
  function rechainFrom(overrideSeq, overridePayloadHash) {
    var hashes = []
    var previous = run.genesis

    for (var i = 0; i < run.entries.length; i += 1) {
      var entry = run.entries[i]
      var payloadHash = entry.seq === overrideSeq ? overridePayloadHash : entry.payloadHash
      var hash = headerHash(entry, payloadHash, previous)
      hashes.push(hash)
      previous = hash
    }

    return hashes
  }

  /* ══════════════════════════════════════════════════════════════════════════
     8d. THE STAGE FLOW
     Eight nodes. The one with no tools is drawn as a hole, because it is one,
     and it is found by having no tools rather than by its number.
     ══════════════════════════════════════════════════════════════════════════ */

  /* ══════════════════════════════════════════════════════════════════════════
     WHAT EACH TOOL DOES, IN WORDS

     A tool is one specific thing Charter is allowed to do. It has a short name in
     the code and that name tells a first-time reader nothing, so every one of them
     is described here in a phrase, and the description is what the page shows.

     The list is checked on every build against the tools the run actually offered.
     A tool with no description here fails the build rather than appearing on the
     page under its code name.
     ══════════════════════════════════════════════════════════════════════════ */

  var WHAT_TOOLS_DO = run.toolWords

  function whatToolsDo(tools) {
    var said = []
    for (var i = 0; i < tools.length; i += 1) {
      var name = tools[i]
      var does = Object.prototype.hasOwnProperty.call(WHAT_TOOLS_DO, name)
        ? WHAT_TOOLS_DO[name]
        : name
      said.push(does)
    }
    return said
  }

  /* ══════════════════════════════════════════════════════════════════════════
     SAYING WHERE A NUMBER CAME FROM

     Every number on this page came from somewhere, and a number whose origin a
     reader has to take on trust is doing the opposite of what this page is for.
     So anything countable carries a short sentence saying what was counted, shown
     on hover and on keyboard focus.

     Given a tabindex so it can be reached without a mouse, because an explanation
     only some people can get to is not an explanation.
     ══════════════════════════════════════════════════════════════════════════ */

  function explain(node, sentence) {
    node.setAttribute('data-explain', sentence)
    node.setAttribute('tabindex', '0')
    node.setAttribute('role', 'note')
    return node
  }

  /**
   * Which way each note hangs.
   *
   * A note is drawn beside the thing it explains, and one near the right edge of
   * the window would reach past it. That does not merely look wrong: a hidden
   * element still takes up room, so a note nobody has opened yet is enough to make
   * the whole page slide sideways under a thumb.
   *
   * So every note is measured once the page has been laid out, and any that would
   * not fit hangs the other way instead. Measured again after a resize, because
   * the edge moves.
   */
  function placeNotes() {
    var notes = document.querySelectorAll('[data-explain]')
    var room = document.documentElement.clientWidth

    for (var i = 0; i < notes.length; i += 1) {
      var box = notes[i].getBoundingClientRect()
      if (box.width === 0) continue
      notes[i].setAttribute('data-explain-side', box.left + 300 > room - 16 ? 'right' : 'left')
    }
  }

  function fillFlow() {
    var root = find('[data-flow]')
    if (!root) return

    for (var i = 0; i < run.stages.length; i += 1) {
      var stage = run.stages[i]
      var empty = stage.tools.length === 0

      var step = make('div', 'flow-step')
      if (empty) step.setAttribute('data-empty', 'true')

      var tools = make(
        'div',
        'flow-tools',
        empty ? 'no tools' : stage.tools.length + (stage.tools.length === 1 ? ' tool' : ' tools'),
      )

      explain(
        tools,
        empty
          ? 'Nothing at all. This is the step where the file goes to a person to sign, and ' +
              'there is nothing here for software to do.'
          : 'In this step it may only: ' + whatToolsDo(stage.tools).join('; ') + '. Nothing else.',
      )

      step.append(
        make('div', 'flow-dot', String(stage.position)),
        make('div', 'flow-title', stage.title),
        tools,
      )
      root.append(step)
    }
  }

  /* ══════════════════════════════════════════════════════════════════════════
     8e. THE SHEET
     The words in the sealed packet, read back out of its bytes at build time and
     set here in this page's own type. A browser that will not render a PDF in
     place would otherwise leave the most important thing on the site as a blank
     rectangle, and this page would have shown a judge nothing.
     ══════════════════════════════════════════════════════════════════════════ */

  var sheetPage = 0

  function drawSheet() {
    var sheet = find('[data-sheet]')
    if (!sheet || !run.pack || run.pack.pages.length === 0) return

    var lines = run.pack.pages[sheetPage]
    sheet.textContent = ''

    for (var i = 0; i < lines.length; i += 1) {
      sheet.append(make('div', 'sheet-line', lines[i]))
    }

    find('[data-sheet-page]').textContent = String(sheetPage + 1)
    find('[data-sheet-pages]').textContent = String(run.pack.pages.length)
    find('[data-do="page-back"]').disabled = sheetPage === 0
    find('[data-do="page-next"]').disabled = sheetPage === run.pack.pages.length - 1
  }

  /* ══════════════════════════════════════════════════════════════════════════
     8f. THE VIEWS
     Six of them, one at a time, with the address bar kept in step so a judge can
     link somebody straight at the thing they should look at. Nothing is thrown
     away when a view is hidden: the play head keeps its place, cleared gates
     stay cleared, and coming back finds the run exactly where it was left.
     ══════════════════════════════════════════════════════════════════════════ */

  var views = all('[data-view]')
  var tabs = all('[data-tab]')

  function show(name, fromLink) {
    var known = false
    for (var i = 0; i < views.length; i += 1) {
      var mine = views[i].getAttribute('data-view') === name
      views[i].hidden = !mine
      if (mine) known = true
    }
    if (!known) return show('overview', fromLink)

    for (var j = 0; j < tabs.length; j += 1) {
      tabs[j].setAttribute('aria-selected', tabs[j].getAttribute('data-tab') === name ? 'true' : 'false')
    }

    // The rail counts the entries of the run, so it belongs to the run and to
    // nothing else. Showing it beside the agreement would be a ruler against a
    // thing it does not measure.
    if (railRoot) railRoot.hidden = name !== 'run'

    if (window.location.hash !== '#' + name) {
      window.history.replaceState(null, '', '#' + name)
    }
    if (fromLink) window.scrollTo(0, 0)

    // A canvas has no size while its view is hidden, so anything drawn on one
    // has to be drawn again once the view is on screen.
    drawMural(shownHashes, shownBrokenFrom)
    measureEmptiness()
  }

  /* ══════════════════════════════════════════════════════════════════════════
     9. BREAKING THE RECORD ON PURPOSE
     The real arithmetic, on the real fingerprints, in the browser. The sentences
     printed are the checker's own, taken word for word from src/verify/check.ts
     and src/record/chain.ts, so this page cannot say something kinder than the
     code does.
     ══════════════════════════════════════════════════════════════════════════ */

  function walkChain(overrideSeq, overridePayloadHash, dropLast) {
    var last = run.entries.length - dropLast
    var previous = run.genesis

    for (var i = 0; i < last; i += 1) {
      var entry = run.entries[i]
      var payloadHash = entry.seq === overrideSeq ? overridePayloadHash : entry.payloadHash

      if (entry.prevHash !== previous) {
        return {
          ok: false,
          seq: entry.seq,
          detail: 'this step does not follow on from the one before it',
          expected: previous,
          found: entry.prevHash,
        }
      }

      var shouldBe = headerHash(entry, payloadHash, entry.prevHash)
      if (shouldBe !== entry.hash) {
        return {
          ok: false,
          seq: entry.seq,
          detail: 'this step has been changed since it was written',
          expected: shouldBe,
          found: entry.hash,
        }
      }

      previous = entry.hash
    }

    return { ok: true, head: previous, count: last }
  }

  function fillTamper() {
    var field = find('[data-tamper-field]')
    var seam = find('[data-tamper-seam]')
    var verdict = find('[data-tamper-verdict]')
    var original = JSON.stringify(tamperEntry.payload)

    field.value = original

    function markFrom(seq) {
      for (var i = 0; i < rows.length; i += 1) {
        var broken = seq !== null && Number(rows[i].getAttribute('data-seq')) >= Number(seq)
        rows[i].setAttribute('data-moved', broken ? 'true' : 'false')
      }
    }

    /**
     * Show the record as it stands.
     *
     * `dropLast` cuts entries off the end. `rewrite` recomputes every fingerprint
     * after the change so the chain joins up again, which is the attack the chain
     * on its own cannot stop and the attestation can.
     */
    function report(dropLast, rewrite) {
      var payloadHash
      try {
        payloadHash = sha256(canonical(JSON.parse(field.value)))
      } catch (problem) {
        verdict.setAttribute('data-broken', 'false')
        verdict.textContent =
          'That is not something a step could say, so there is nothing to take a fingerprint ' +
          'of. Put the comma back, or press undo.'
        seam.textContent = ''
        markFrom(null)
        drawMural(storedHashes, null)
        return
      }

      // ---- the rewrite ------------------------------------------------------
      if (rewrite) {
        var rewritten = rechainFrom(tamperEntry.seq, payloadHash)
        var changedFrom = tamperEntry.seq
        var changed = 0
        for (var r = 0; r < rewritten.length; r += 1) {
          if (rewritten[r] !== storedHashes[r]) changed += 1
        }

        drawMural(rewritten, changedFrom)
        markFrom(changedFrom)
        seam.textContent = ''
        verdict.setAttribute('data-broken', 'true')
        seam.setAttribute('data-broken', 'true')

        var oldHead = make('div')
        oldHead.append(part('', 'the note says it ended  '), make('b', 'struck', run.attestation.head))
        var newHead = make('div')
        newHead.append(part('', 'it now ends             '), make('b', 'struck', rewritten[rewritten.length - 1]))
        seam.append(oldHead, newHead)

        verdict.textContent =
          'It joins up again. Every step now matches the one before it, and the diary says ' +
          String(JSON.parse(field.value).owner) +
          ' owns a different share of the company. ' +
          changed +
          ' of the ' +
          run.entries.length +
          ' fingerprints had to change to make that work, and you can see exactly which ones. ' +
          'What did not change is the sealed note. Charter stamped that note when it finished, ' +
          'and it still describes a diary that ended a different way. The past can still be ' +
          'rewritten. It can no longer be rewritten quietly.'
        return
      }

      var result = walkChain(tamperEntry.seq, payloadHash, dropLast)

      seam.textContent = ''
      verdict.setAttribute('data-broken', result.ok ? 'false' : 'true')
      seam.setAttribute('data-broken', result.ok ? 'false' : 'true')

      if (result.ok) {
        markFrom(null)
        drawMural(storedHashes.slice(0, result.count), null)

        var shortened = run.attestation && run.attestation.count !== String(result.count)
        verdict.textContent = shortened
          ? 'It still holds. ' +
            result.count +
            ' steps, each one matching the one before it, because a shorter chain is still a ' +
            'perfectly good chain. Nothing inside the diary can tell you that something used to ' +
            'come after. The sealed note can. Charter stamped it when it finished and it says ' +
            'there were ' +
            run.attestation.count +
            ' steps. Only ' +
            result.count +
            ' were handed over. Steps have been added or taken away since.'
          : 'It holds together. ' +
            result.count +
            ' steps, each one matching the one before it.'
        return
      }

      verdict.textContent =
        'It breaks at step ' +
        Number(result.seq) +
        ': ' +
        result.detail +
        '. Everything before it is fine. Nothing from there on can be trusted.'

      var expected = make('div')
      expected.append(part('', 'should be  '), make('b', 'struck', result.expected))
      var found = make('div')
      found.append(part('', 'actually   '), make('b', 'struck', result.found))
      seam.append(expected, found)

      markFrom(result.seq)
      drawMural(storedHashes, result.seq)
    }

    field.addEventListener('input', function () {
      report(0, false)
    })
    find('[data-do="tamper-reset"]').addEventListener('click', function () {
      field.value = original
      report(0, false)
    })
    find('[data-do="drop-two"]').addEventListener('click', function () {
      field.value = original
      report(2, false)
    })
    find('[data-do="rechain"]').addEventListener('click', function () {
      if (field.value === original) {
        // Rewriting a record nobody changed would redraw it exactly as it is, and
        // a control that appears to do nothing teaches the wrong thing. Say why.
        verdict.setAttribute('data-broken', 'false')
        verdict.textContent =
          'Nothing has been changed yet, so there is nothing to cover up. Change the value in ' +
          'the box above first, then press this.'
        return
      }
      report(0, true)
    })

    report(0, false)

    // The mural is drawn from the fingerprints, and the fingerprints do not
    // change with the width. Only the tile size does.
    window.addEventListener('resize', function () {
      drawMural(storedHashes, null)
      placeNotes()
    })
  }

  /* ══════════════════════════════════════════════════════════════════════════
     10. THE CONTROLS
     ══════════════════════════════════════════════════════════════════════════ */

  function wireControls() {
    find('[data-do="hold"]').addEventListener('click', function () {
      holding = true
      stop()
    })
    find('[data-do="resume"]').addEventListener('click', function () {
      start()
    })
    find('[data-do="back"]').addEventListener('click', function () {
      goTo(head - 1)
    })
    find('[data-do="next-person"]').addEventListener('click', function () {
      for (var i = 0; i < inserts.length; i += 1) {
        if (!performed(inserts[i].index)) {
          goTo(inserts[i].index - 1)
          inserts[i].insert.scrollIntoView({ block: 'center' })
          return
        }
      }
      goTo(run.entries.length - 1)
    })

    // The escape hatch. Everything at full ink at once, and the six holes stay
    // visible as holes. A demonstration nobody can skip is one nobody trusts.
    find('[data-do="show-everything"]').addEventListener('click', function () {
      stop()
      holding = true
      for (var i = 0; i < inserts.length; i += 1) {
        if (!performed(inserts[i].index)) {
          inserts[i].insert.setAttribute('data-skipped', 'true')
        }
      }
      head = run.entries.length - 1
      paint()
    })

    find('[data-do="all-articles"]').addEventListener('click', function (event) {
      var all = document.querySelectorAll('[data-article]')
      for (var i = 0; i < all.length; i += 1) all[i].hidden = false
      event.currentTarget.disabled = true
    })

    find('[data-do="copy-verify"]').addEventListener('click', function (event) {
      if (navigator.clipboard) navigator.clipboard.writeText(event.currentTarget.textContent.trim())
    })

    // ---- moving between the six views -------------------------------------
    for (var i = 0; i < tabs.length; i += 1) {
      tabs[i].addEventListener('click', function (event) {
        show(event.currentTarget.getAttribute('data-tab'), true)
      })
    }

    var links = all('[data-go]')
    for (var j = 0; j < links.length; j += 1) {
      links[j].addEventListener('click', function (event) {
        show(event.currentTarget.getAttribute('data-go'), true)
      })
    }

    window.addEventListener('hashchange', function () {
      show(window.location.hash.replace('#', '') || 'overview', true)
    })

    // ---- turning the pages of the packet ----------------------------------
    find('[data-do="page-back"]').addEventListener('click', function () {
      sheetPage = Math.max(0, sheetPage - 1)
      drawSheet()
    })
    find('[data-do="page-next"]').addEventListener('click', function () {
      sheetPage = Math.min(run.pack.pages.length - 1, sheetPage + 1)
      drawSheet()
    })
  }

  /**
   * The empty tool area in the boundary stage, measured against the tallest
   * filled one on the page rather than against a number somebody chose. Its
   * emptiness is exactly as big as the fullest thing Charter does.
   */
  function measureEmptiness() {
    var target = find('[data-empty-tools]')
    if (!target) return
    var tallest = 0
    var rows = all('.tools')
    for (var i = 0; i < rows.length; i += 1) tallest = Math.max(tallest, rows[i].offsetHeight)
    if (tallest > 0) target.style.minHeight = tallest + 'px'
  }

  /* ══════════════════════════════════════════════════════════════════════════
     11. START
     ══════════════════════════════════════════════════════════════════════════ */

  build()
  buildRail()
  fillRefusals()
  fillFindings()
  fillStages()
  fillServices()
  fillWhoItUses()
  fillAgreement()
  fillPacket()
  fillFlow()
  drawSheet()
  fillTamper()
  wireControls()

  // The page opens already stopped at the first thing a person had to do, with
  // that insert in the first viewport. Everything before it is at full ink, and
  // everything after it is on the page, quieter, and readable to the end.
  head = inserts.length > 0 ? inserts[0].index - 1 : run.entries.length - 1
  paint()

  // Whichever view the address bar asks for, and the overview otherwise.
  show(window.location.hash.replace('#', '') || 'overview', false)

  // Once everything is on the page and has a width, every note works out which
  // way it can hang without pushing the page sideways.
  placeNotes()

  window.addEventListener('resize', function () {
    placeNotes()
    drawMural(shownHashes, shownBrokenFrom)
    measureEmptiness()
  })
})()
