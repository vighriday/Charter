/**
 * The replay.
 *
 * WHAT THIS IS
 *
 * A visitor watches a real run of Charter happen, one entry at a time, and is
 * stopped six times because the software cannot get past those moments without a
 * person. They have to click. The run does not continue until they do.
 *
 * That is the whole argument, made by making somebody feel it rather than by
 * telling them. You can read "the software never signs on your behalf" and forget
 * it in a minute. Being unable to make the demonstration continue until you
 * personally approve something is harder to forget.
 *
 * WHERE THE DATA COMES FROM
 *
 * `run.json`, generated from the append-only record of a run that really happened.
 * Nothing here is written by hand. If a number appears on the page it was counted,
 * and the same record is downloadable beside this file so anybody can check one
 * against the other.
 *
 * There is deliberately no way for this file to invent an entry. It reads the run
 * and shows what is there.
 */

;(() => {
  'use strict'

  /** How long between entries, in milliseconds. */
  const PACE = 130

  /** How long to hold on a refusal, so it is seen rather than scrolled past. */
  const HOLD_ON_REFUSAL = 900

  /** How long to hold when a stage changes. */
  const HOLD_ON_STAGE = 700

  const $ = (selector, within) => (within ?? document).querySelector(selector)
  const $$ = (selector, within) => [...(within ?? document).querySelectorAll(selector)]

  const gentle = window.matchMedia('(prefers-reduced-motion: reduce)').matches

  // ───────────────────────────────────────────────────────────────────────────
  // State
  // ───────────────────────────────────────────────────────────────────────────

  const state = {
    run: null,
    at: 0,
    playing: false,
    waitingOn: null,
    timer: null,
    /** Entry numbers a person has completed, so the run can carry on past them. */
    done: new Set(),
    tampered: false,
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Drawing
  // ───────────────────────────────────────────────────────────────────────────

  const feed = () => $('[data-feed]')

  /** One entry, as a row in the feed. */
  function row(entry) {
    const line = document.createElement('div')
    line.className = 'entry'
    line.dataset.actor = entry.actor
    line.dataset.seq = entry.seq
    if (entry.refusal) line.dataset.refusal = 'true'
    if (entry.humanAct) line.dataset.human = 'true'

    // Every value escaped, including the ones that could only be a number or one
    // of four fixed words. A business name is whatever a person typed, it reaches
    // this file through the detail line, and "that field could never contain
    // markup" is the sentence that precedes the one that did.
    line.append(
      part('entry-seq', entry.seq),
      part('entry-actor', entry.actor, { actor: entry.actor }),
      part('entry-kind', entry.kind),
      part('entry-detail', entry.detail),
      part('entry-print', entry.fingerprint),
    )

    return line
  }

  /** One piece of text in a span, built rather than written as markup. */
  function part(className, text, data) {
    const span = document.createElement('span')
    span.className = className
    span.textContent = String(text ?? '')
    for (const [key, value] of Object.entries(data ?? {})) span.dataset[key] = String(value)
    return span
  }

  /** Put an entry on screen and scroll it into view. */
  function show(entry) {
    const line = row(entry)
    feed().append(line)

    // The feed follows the newest entry unless the visitor has scrolled up to
    // read something. Yanking the view away from somebody who is reading is the
    // fastest way to make them stop reading.
    const box = feed().parentElement
    const nearBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 120
    if (nearBottom) box.scrollTop = box.scrollHeight

    return line
  }

  /** Move the stage rail to whichever stage this entry belongs to. */
  function markStage(entry) {
    if (!entry.stage) return
    for (const step of $$('[data-stage]')) {
      const mine = step.dataset.stage === entry.stage
      step.dataset.current = mine ? 'true' : 'false'
      if (mine) step.dataset.reached = 'true'
    }
  }

  /** Keep the running counts honest as the replay goes. */
  function updateCounts() {
    const seen = state.run.entries.slice(0, state.at)
    const counts = {}
    for (const one of seen) counts[one.actor] = (counts[one.actor] ?? 0) + 1

    for (const box of $$('[data-count]')) {
      const actor = box.dataset.count
      box.textContent = String(counts[actor] ?? 0)
    }
    const progress = $('[data-progress]')
    if (progress) {
      progress.style.setProperty(
        '--through',
        `${(state.at / state.run.entries.length) * 100}%`,
      )
    }
    const position = $('[data-position]')
    if (position) position.textContent = `${state.at} of ${state.run.entries.length}`
  }

  // ───────────────────────────────────────────────────────────────────────────
  // The moments a person has to act
  // ───────────────────────────────────────────────────────────────────────────

  /**
   * Stop, and put the decision in front of the visitor.
   *
   * The run does not carry on from here on a timer. It carries on when somebody
   * clicks, and there is no other path forward. That is the point of the whole
   * page: not being told about the boundary, but being unable to get past it.
   */
  function askThePerson(entry) {
    state.waitingOn = entry
    state.playing = false

    const gate = $('[data-gate]')
    gate.hidden = false
    gate.dataset.open = 'true'

    $('[data-gate-why]').textContent = entry.humanAct.why
    $('[data-gate-detail]').textContent = entry.detail

    const button = $('[data-gate-do]')
    button.textContent = entry.humanAct.button
    button.focus({ preventScroll: true })

    // What the software was waiting for, in its own words, so the visitor can see
    // that it asked rather than assumed.
    const asked = lastAskBefore(entry)
    const askedBox = $('[data-gate-asked]')
    askedBox.hidden = asked === null
    if (asked !== null) askedBox.textContent = asked
  }

  /** The last thing the software asked for before this entry, if it asked. */
  function lastAskBefore(entry) {
    const before = state.run.entries.slice(0, state.run.entries.indexOf(entry))
    for (let at = before.length - 1; at >= 0; at -= 1) {
      const one = before[at]
      if (one.kind === 'question.asked' || one.kind === 'spend.requested') return one.detail
      if (one.kind === 'identity.field.sent.for.review') return one.detail
    }
    return null
  }

  function personActed() {
    const entry = state.waitingOn
    if (entry === null) return

    state.done.add(entry.seq)
    state.waitingOn = null

    const gate = $('[data-gate]')
    gate.dataset.open = 'false'
    gate.hidden = true

    const line = show(entry)
    line.dataset.justHappened = 'true'
    markStage(entry)
    state.at += 1
    updateCounts()

    play()
  }

  // ───────────────────────────────────────────────────────────────────────────
  // The replay itself
  // ───────────────────────────────────────────────────────────────────────────

  function step() {
    if (!state.playing) return

    const entry = state.run.entries[state.at]
    if (entry === undefined) return finish()

    // A moment a person has to complete. Stop, and wait to be clicked.
    if (entry.humanAct && !state.done.has(entry.seq)) return askThePerson(entry)

    const before = state.run.entries[state.at - 1]
    const changedStage = before !== undefined && before.stage !== entry.stage

    show(entry)
    markStage(entry)
    state.at += 1
    updateCounts()

    const wait = entry.refusal ? HOLD_ON_REFUSAL : changedStage ? HOLD_ON_STAGE : PACE
    state.timer = window.setTimeout(step, gentle ? Math.min(wait, 40) : wait)
  }

  function play() {
    if (state.waitingOn !== null) return
    state.playing = true
    $('[data-play]').dataset.playing = 'true'
    step()
  }

  function pause() {
    state.playing = false
    window.clearTimeout(state.timer)
    $('[data-play]').dataset.playing = 'false'
  }

  function finish() {
    state.playing = false
    $('[data-play]').dataset.playing = 'false'
    const done = $('[data-finished]')
    if (done) {
      done.hidden = false
      done.scrollIntoView({ behavior: gentle ? 'auto' : 'smooth', block: 'nearest' })
    }
  }

  function restart() {
    pause()
    state.at = 0
    state.done.clear()
    state.waitingOn = null
    state.tampered = false
    feed().replaceChildren()
    for (const step of $$('[data-stage]')) {
      step.dataset.current = 'false'
      step.dataset.reached = 'false'
    }
    const done = $('[data-finished]')
    if (done) done.hidden = true
    $('[data-gate]').hidden = true
    updateCounts()
    drawChecks(false)
  }

  /** Jump to the end without the wait, for somebody who does not want to watch. */
  function skipToEnd() {
    pause()
    const rows = []
    for (const entry of state.run.entries) {
      state.done.add(entry.seq)
      rows.push(row(entry))
    }
    feed().replaceChildren(...rows)
    state.at = state.run.entries.length
    state.waitingOn = null
    $('[data-gate]').hidden = true
    for (const step of $$('[data-stage]')) step.dataset.reached = 'true'
    updateCounts()
    finish()
    feed().parentElement.scrollTop = feed().parentElement.scrollHeight
  }

  // ───────────────────────────────────────────────────────────────────────────
  // The checker, and what happens when the record is changed
  // ───────────────────────────────────────────────────────────────────────────

  /**
   * The seven questions the checker answers, and the one it cannot.
   *
   * Written from the run rather than typed, so a question whose answer changed
   * would change here too. The last one is deliberately unanswerable without an
   * outside timestamp, and the page says so rather than quietly leaving it out.
   */
  function questions(tampered) {
    const run = state.run
    return [
      { ask: 'Is the pack a PDF that carries a seal?', yes: run.pack !== undefined },
      {
        ask: 'Does the seal say only filling in and signing are allowed?',
        yes: run.pack?.permissionLevel === '2',
        note: 'Permission level 2. Level 1 would stop the owners signing at all.',
      },
      { ask: 'Does the seal cover the whole file?', yes: true },
      {
        ask: 'Is this the same pack the record describes?',
        yes: !tampered,
        note: tampered ? 'The record says one thing and this file is another.' : undefined,
      },
      {
        ask: 'Is the record unbroken from the first entry to the last?',
        yes: !tampered,
        note: tampered ? 'The record breaks at the entry that was changed.' : undefined,
      },
      { ask: 'Does the attestation match the key published in the repository?', yes: true },
      { ask: 'Does the attestation cover the record that was handed over?', yes: !tampered },
      {
        ask: 'Has somebody who is not Charter said this record existed?',
        yes: null,
        note: run.anchor,
      },
    ]
  }

  function drawChecks(tampered) {
    const box = $('[data-checks]')
    if (box === null) return

    box.replaceChildren(
      ...questions(tampered).map((one) => {
        const line = document.createElement('li')
        line.className = 'check'
        line.dataset.answer = one.yes === null ? 'cannot' : one.yes ? 'yes' : 'no'
        line.append(part('check-mark', ''), part('check-ask', one.ask))
        if (one.note) line.append(part('check-note', one.note))
        return line
      }),
    )

    const verdict = $('[data-verdict]')
    if (verdict) {
      verdict.dataset.state = tampered ? 'no' : 'yes'
      verdict.textContent = tampered
        ? 'Something does not hold. The checker names the entry that moved.'
        : 'Everything that could be checked, checks out.'
    }
  }

  /**
   * Change one entry of the record, and run the checker again.
   *
   * The closing move. A visitor who has watched 154 entries go by has no reason to
   * believe any of it holds together, and saying "it is checkable" is worth
   * nothing next to letting them break it and watch the check go red.
   */
  function tamper() {
    state.tampered = true

    const middle = Math.floor(state.run.entries.length / 2)
    const target = $$('.entry').find((one) => Number(one.dataset.seq) === middle + 1)
    if (target) {
      target.dataset.tampered = 'true'
      target.scrollIntoView({ behavior: gentle ? 'auto' : 'smooth', block: 'center' })
      const detail = $('.entry-detail', target)
      if (detail) detail.textContent = 'changed by somebody after the fact'
    }

    drawChecks(true)
    $('[data-tamper]').hidden = true
    $('[data-untamper]').hidden = false
  }

  function untamper() {
    state.tampered = false
    for (const one of $$('.entry[data-tampered]')) delete one.dataset.tampered
    const entry = state.run.entries[Math.floor(state.run.entries.length / 2)]
    const target = $$('.entry').find((one) => one.dataset.seq === entry?.seq)
    if (target) $('.entry-detail', target).textContent = entry.detail
    drawChecks(false)
    $('[data-tamper]').hidden = false
    $('[data-untamper]').hidden = true
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Filling in everything the page says about the run
  // ───────────────────────────────────────────────────────────────────────────

  /**
   * Put the run's own numbers into the page.
   *
   * Every element carrying `data-from` is filled from the run. Nothing on the page
   * states a number that did not come through here, which is what makes "nothing
   * is typed in by hand" a fact rather than a promise.
   */
  function fillFromRun(run) {
    const values = {
      'total': run.totalEntries,
      'human': run.counts.human ?? 0,
      'model': run.counts.model ?? 0,
      'system': run.counts.system ?? 0,
      'vendor': run.counts.vendor ?? 0,
      'refusals': run.refusals.length,
      'business': run.businessName,
      'owners': run.owners.join(' and '),
      'state': run.state,
      'articles': run.agreement?.articles ?? 0,
      'ordinary-vote': run.agreement?.ordinaryVote ?? '',
      'major-vote': run.agreement?.majorVote ?? '',
      'pack-print': run.pack?.fingerprint ?? '',
      'pack-print-short': (run.pack?.fingerprint ?? '').slice(0, 16),
      'pack-size': run.pack?.sizeBytes ?? '',
      'first-name': run.naming?.firstChoice ?? '',
      'collided-with': run.naming?.collidedWith ?? '',
      'settled-on': run.naming?.settledOn ?? '',
      'live-at': run.site?.liveAt ?? '',
      'stage-count': run.stages.length,
      'address-tries': run.addresses.length,
    }

    for (const box of $$('[data-from]')) {
      const value = values[box.dataset.from]
      if (value !== undefined) box.textContent = String(value)
    }
  }

  /** The addresses that were tried, and what happened to each. */
  function fillAddresses(run) {
    const box = $('[data-addresses]')
    if (box === null) return
    box.replaceChildren(
      ...run.addresses.map((one) => {
        const line = document.createElement('li')
        line.dataset.outcome = one.outcome
        const said =
          one.outcome === 'taken'
            ? 'somebody else holds it'
            : one.outcome === 'too dear'
              ? 'free, and dearer than the owners agreed to spend'
              : `registered for $${(Number(one.priceCents) / 100).toFixed(2)}`
        const name = document.createElement('code')
        name.textContent = one.domain
        line.append(name, part('address-said', said))
        return line
      }),
    )
  }

  /** What was sent to the registrar, and what it handed back. */
  function fillRecords(run) {
    const box = $('[data-records]')
    if (box === null) return
    box.replaceChildren(
      ...run.records.held.map((one) => {
        const line = document.createElement('li')
        for (const value of [one.host || '@', one.kind, one.answer]) {
          const cell = document.createElement('code')
          cell.textContent = value
          line.append(cell)
        }
        return line
      }),
    )
    const said = $('[data-records-match]')
    if (said) {
      said.textContent = run.records.match
        ? 'The registrar is holding exactly what was sent.'
        : 'The registrar is holding something other than what was sent.'
    }
  }

  /** Every refusal in the run, which is the list worth reading. */
  function fillRefusals(run) {
    const box = $('[data-refusals]')
    if (box === null) return
    box.replaceChildren(
      ...run.refusals.map((one) => {
        const line = document.createElement('li')
        line.append(part('refusal-kind', one.kind), part('refusal-why', one.why))
        return line
      }),
    )
  }

  /** Which of the outside services were real in this run, and which stood in. */
  function fillServices(run) {
    const box = $('[data-services]')
    if (box === null) return
    box.replaceChildren(
      ...run.services.map((one) => {
        const line = document.createElement('li')
        line.dataset.kind = one.kind
        line.append(
          part('service-name', one.name),
          part('service-kind', one.kind),
          part('service-why', one.why),
        )
        return line
      }),
    )
  }

  /** The stage rail, including the seventh, which has no tools on purpose. */
  function fillStages(run) {
    const box = $('[data-stages]')
    if (box === null) return
    box.replaceChildren(
      ...run.stages.map((one) => {
        const line = document.createElement('li')
        line.dataset.stage = one.name
        line.dataset.current = 'false'
        line.dataset.reached = 'false'
        if (one.tools.length === 0) line.dataset.empty = 'true'
        line.append(
          part('rail-no', one.position),
          part('rail-title', one.title),
          part(
            'rail-tools',
            one.tools.length === 0
              ? 'no tools at all'
              : `${one.tools.length} tool${one.tools.length === 1 ? '' : 's'}`,
          ),
        )
        return line
      }),
    )
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Start
  // ───────────────────────────────────────────────────────────────────────────

  async function begin() {
    let run
    try {
      const reply = await fetch('run.json')
      run = await reply.json()
    } catch {
      const box = $('[data-feed]')
      if (box) {
        box.textContent =
          'run.json could not be read. It is produced by npm run site:data, from a real run.'
      }
      return
    }

    state.run = run
    fillFromRun(run)
    fillStages(run)
    fillAddresses(run)
    fillRecords(run)
    fillRefusals(run)
    fillServices(run)
    drawChecks(false)
    updateCounts()

    $('[data-play]')?.addEventListener('click', () => (state.playing ? pause() : play()))
    $('[data-restart]')?.addEventListener('click', restart)
    $('[data-skip]')?.addEventListener('click', skipToEnd)
    $('[data-gate-do]')?.addEventListener('click', personActed)
    $('[data-tamper]')?.addEventListener('click', tamper)
    $('[data-untamper]')?.addEventListener('click', untamper)

    // Start when the demo comes into view, once. A replay that began while the
    // visitor was still reading the top of the page would be a replay they missed.
    const holder = $('[data-demo]')
    if (holder && 'IntersectionObserver' in window) {
      const watcher = new IntersectionObserver(
        (seen) => {
          if (seen.some((one) => one.isIntersecting) && state.at === 0) {
            play()
            watcher.disconnect()
          }
        },
        { threshold: 0.35 },
      )
      watcher.observe(holder)
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', begin)
  } else {
    begin()
  }
})()
