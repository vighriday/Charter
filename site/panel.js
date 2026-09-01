/*
  Running Charter on your own idea, from this page.

  WHAT THIS IS

  Every other tab on this page replays one run that already happened. You can pull
  it apart, break its record on purpose and watch the checker catch it, and none of
  it needs anything but the file you are reading.

  This tab is the other thing. You type what your business is, and Charter works on
  it: a real model deciding what to do next, a real search of the web for the name,
  a real registrar. When it reaches one of the six things only a person can decide,
  it stops here and asks you, and nothing moves until you answer.

  WHY IT SOMETIMES SAYS NO

  Everything behind this is a free allowance and one of them is small: 250 web
  searches a month, against about twelve for one run. If it says no, it says which
  limit, why that limit is there, and when it lifts. That is the whole reason it can
  be open to anybody rather than to nobody.

  WHEN THERE IS NO SERVER

  This page also works as a plain file on a disk, with nothing running behind it.
  Then there is nothing to run against, and this tab says so and gives the two
  commands that start one. It does not pretend, and it does not quietly show a
  recording instead.

  Plain old browser JavaScript. No build step, no packages, nothing fetched from
  anywhere else.
*/

;(function () {
  'use strict'

  var panel = document.querySelector('[data-panel]')
  if (!panel) return

  var one = function (selector) {
    return panel.querySelector(selector)
  }

  var form = one('[data-panel-form]')
  var idea = one('[data-panel-idea]')
  var state = one('[data-panel-state]')
  var goButton = one('[data-panel-go]')
  var limitsNote = one('[data-panel-limits]')
  var offline = one('[data-panel-offline]')
  var live = one('[data-panel-live]')
  var feed = one('[data-panel-feed]')
  var gate = one('[data-panel-gate]')
  var gateText = one('[data-panel-gate-text]')
  var gateExtra = one('[data-panel-gate-extra]')
  var gateForm = one('[data-panel-gate-form]')
  var gateInput = one('[data-panel-gate-input]')
  var gateYes = one('[data-panel-yes]')
  var gateNo = one('[data-panel-no]')
  var realNote = one('[data-panel-real]')
  var files = one('[data-panel-files]')

  var runId = null
  var token = null
  var shown = 0
  var polling = null

  /* ── talking to the server ───────────────────────────────────────────────── */

  function askServer(path, options) {
    var settings = options || {}

    // The run's own secret goes on every request about a run, in a header and
    // never in the address. A secret in an address is a secret in the browser
    // history, in whatever the visitor pastes into a message to somebody, and in
    // every log between here and there.
    if (token) {
      settings.headers = Object.assign({}, settings.headers, {
        authorization: 'Bearer ' + token,
      })
    }

    return fetch(path, settings).then(function (response) {
      return response.json().then(function (body) {
        return { status: response.status, body: body }
      })
    })
  }

  /* ── is there a server at all ────────────────────────────────────────────── */

  function findOutWhereWeStand() {
    askServer('/api/limits')
      .then(function (answer) {
        offline.hidden = true
        form.hidden = false
        sayWhereWeStand(answer.body)
      })
      .catch(function () {
        // No server. Say so plainly rather than showing something that looks like
        // a run and is not one.
        offline.hidden = false
        form.hidden = true
      })
  }

  function sayWhereWeStand(limits) {
    var lines = []
    lines.push(
      limits.leftToday +
        ' of ' +
        limits.allowance.perDay +
        ' runs left today for everybody together.',
    )
    if (limits.goingNow > 0) lines.push('One is going right now.')
    if (!limits.canStart && limits.because) lines.push(limits.because)
    lines.push(limits.why)
    if (limits.replaying) {
      lines.push(
        'This server has REPLAY_MODE on, so every outside company is a stand-in. ' +
          'The run still works end to end and is still about your idea, but nothing ' +
          'reaches the real web.',
      )
    }

    limitsNote.textContent = ''
    for (var i = 0; i < lines.length; i += 1) {
      var p = document.createElement('p')
      p.className = i === 0 ? 't-body' : 't-body quiet'
      p.textContent = lines[i]
      limitsNote.appendChild(p)
    }

    goButton.disabled = !limits.canStart
  }

  /* ── starting ────────────────────────────────────────────────────────────── */

  form.addEventListener('submit', function (event) {
    event.preventDefault()
    goButton.disabled = true
    goButton.textContent = 'starting'

    askServer('/api/runs', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ description: idea.value, state: state.value }),
    })
      .then(function (answer) {
        if (answer.status !== 200) {
          goButton.disabled = false
          goButton.textContent = 'Run it on my idea'
          limitsNote.textContent = ''
          var p = document.createElement('p')
          p.className = 't-body'
          p.textContent = answer.body.error
          limitsNote.appendChild(p)
          return
        }

        runId = answer.body.id
        token = answer.body.token
        form.hidden = true
        live.hidden = false
        watch()
      })
      .catch(function () {
        goButton.disabled = false
        goButton.textContent = 'Run it on my idea'
      })
  })

  /* ── watching ────────────────────────────────────────────────────────────── */

  function watch() {
    if (polling) window.clearInterval(polling)
    polling = window.setInterval(pull, 1200)
    pull()
  }

  function pull() {
    if (!runId) return
    askServer('/api/runs/' + runId)
      .then(function (answer) {
        if (answer.status !== 200) return
        draw(answer.body)
      })
      .catch(function () {
        /* a dropped poll is not worth saying anything about; the next one will do */
      })
  }

  function draw(view) {
    for (var i = shown; i < view.lines.length; i += 1) addLine(view.lines[i])
    shown = view.lines.length

    if (view.whatIsReal.length && !realNote.textContent) {
      var title = document.createElement('p')
      title.className = 't-sub'
      title.textContent = 'What is real in your run'
      realNote.appendChild(title)
      for (var r = 0; r < view.whatIsReal.length; r += 1) {
        var line = document.createElement('p')
        line.className = 't-body quiet'
        line.textContent = view.whatIsReal[r]
        realNote.appendChild(line)
      }
    }

    showGate(view.waiting)
    showFiles(view.files)

    if (view.finished && polling) {
      window.clearInterval(polling)
      polling = null
    }
  }

  function addLine(entry) {
    var row = document.createElement('div')
    row.className = 'run-line'
    row.setAttribute('data-kind', entry.kind)

    var text = document.createElement('div')
    text.className = entry.kind === 'step' ? 't-sub' : 't-body'
    text.textContent = entry.text
    row.appendChild(text)

    if (entry.extra && entry.extra.length) {
      for (var i = 0; i < entry.extra.length; i += 1) {
        var more = document.createElement('div')
        more.className = 't-body quiet'
        more.textContent = entry.extra[i]
        row.appendChild(more)
      }
    }

    feed.appendChild(row)
    row.scrollIntoView({ block: 'nearest' })
  }

  /* ── the six places it stops ─────────────────────────────────────────────── */

  function showGate(waiting) {
    if (!waiting) {
      gate.hidden = true
      return
    }
    if (gate.hidden === false && gateText.textContent === waiting.question) return

    gate.hidden = false
    gateText.textContent = waiting.question
    gateExtra.textContent = ''
    if (waiting.extra) {
      for (var i = 0; i < waiting.extra.length; i += 1) {
        var line = document.createElement('div')
        line.className = 't-body quiet'
        line.textContent = waiting.extra[i]
        gateExtra.appendChild(line)
      }
    }

    var yesNo = waiting.answerWith === 'yes-no'
    gateInput.hidden = yesNo
    gateYes.hidden = !yesNo
    gateNo.hidden = !yesNo
    gateInput.value = ''
    gateInput.placeholder =
      waiting.answerWith === 'name' ? 'your name' : 'your answer, in your own words'
    if (!yesNo) gateInput.focus()
  }

  function answer(text) {
    askServer('/api/runs/' + runId + '/answer', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token: token, answer: text }),
    }).then(function () {
      gate.hidden = true
      pull()
    })
  }

  gateForm.addEventListener('submit', function (event) {
    event.preventDefault()
    if (gateInput.value.trim() === '') return
    answer(gateInput.value)
  })

  gateYes.addEventListener('click', function () {
    answer('y')
  })

  gateNo.addEventListener('click', function () {
    answer('n')
  })

  /* ── what it leaves behind ───────────────────────────────────────────────── */

  var WHAT_THE_FILES_ARE = {
    'pack.pdf': 'the packet itself, unsigned, for the owners to sign themselves',
    'record.jsonl': 'every step, in order, each one carrying the fingerprint of the one before',
    'attestation.json': 'one signature over that record, so a change to it can be found',
  }

  function showFiles(names) {
    if (!names.length) return
    if (files.childNodes.length === names.length + 1) return

    files.textContent = ''
    var title = document.createElement('p')
    title.className = 't-sub'
    title.textContent = 'Yours to download and check'
    files.appendChild(title)

    for (var i = 0; i < names.length; i += 1) {
      files.appendChild(fileRow(names[i]))
    }
  }

  /*
    A button rather than a plain link.

    The three files are the most private things here: the record carries every
    answer a person gave, and the packet carries their names. Reading them needs
    the run's secret, and a plain link cannot carry a header — it could only carry
    the secret in the address, which is the one place it must not be. So the file
    is fetched with the header and handed to the browser from memory.
  */
  function fileRow(name) {
    var row = document.createElement('p')
    row.className = 't-body'

    var button = document.createElement('button')
    button.className = 'button'
    button.type = 'button'
    button.textContent = name
    button.addEventListener('click', function () {
      fetch('/api/runs/' + runId + '/' + name, {
        headers: { authorization: 'Bearer ' + token },
      })
        .then(function (response) {
          return response.blob()
        })
        .then(function (blob) {
          var where = URL.createObjectURL(blob)
          var link = document.createElement('a')
          link.href = where
          link.download = name
          link.click()
          URL.revokeObjectURL(where)
        })
    })

    row.appendChild(button)
    row.appendChild(document.createTextNode(' — ' + (WHAT_THE_FILES_ARE[name] || '')))
    return row
  }

  findOutWhereWeStand()
})()
