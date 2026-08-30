# Charter

**From idea to legally alive.**

You describe your business in plain English. Charter prepares everything around the
government filing — it researches the name, secures a web address, drafts the
ownership agreement, checks each owner's identity documents, assembles one signable
pack, and puts a live website online.

Then it stops, and hands the pack to the owners to sign **themselves**.

Built for businesses with **more than one owner**. Forming a business alone is
already solved and already free. Everything hard lives in the second owner — because
the difficulty was never the paperwork, it is writing down an agreement between
people who trust each other completely today and might not in three years.

---

## Try it in thirty seconds

No account. No key. No database to install. No network.

```bash
npm install
npm run record:demo     # the record, and what it can and cannot prove
npm run agent:demo      # one business through all eight stages, start to finish
```

That runs a real PostgreSQL engine inside the Node process and shows five things:

1. A record being written — five entries, each carrying the fingerprint of the one
   before it.
2. Somebody altering entry three. The checker names exactly which entry changed,
   and shows the fingerprint it expected against the one it found.
3. The database refusing the alteration. Not our code being careful — a rule
   inside PostgreSQL, which returns `restrict_violation`. Nothing gets around it by
   accident or through any ordinary code path. Somebody holding the connection
   string can still switch it off deliberately, and **that is exactly why the
   fingerprint chain exists**: they cannot then hide what they did. We tested both
   routes rather than assuming, closed the one that could be closed, and say so.
4. **The one thing the chain cannot catch on its own.** Drop the last two entries
   and the chain still verifies perfectly, because a shortened chain is a valid
   chain. The attestation catches it. We show this rather than hiding it.
5. The same question asked twice, reaching the network once.

Everything else:

```bash
npm test          # 851 tests
npm run typecheck
npm run git:check # proves nothing secret is publishable, before every commit
```

`npm install` is the whole setup. There is no container to build, no database to
start, no port to free and no password to set. The append-only rules are installed
and enforced identically whether this runs on your laptop or against a hosted
PostgreSQL.

---

## The line this software will not cross

**Charter never signs anything on a human's behalf.**

Not as a setting. Not as a policy that could be changed. As a property of how it is
built.

The law here is more subtle than the usual slogan, and getting it right matters. The
Uniform Electronic Transactions Act, section 14, **does** let a contract be formed
by electronic agents with no person aware of it. So the honest claim is not "a
machine may not act." It is this:

> The law lets an agent **form** a contract, with the result attributed to the
> person to be bound. But it defines a **signature** as a process executed or
> adopted *by a person, with the intent to sign*. Formation may be delegated. The
> signature is the act of a person, and a machine has no intent to lend it.

Charter is built along that line, not across it.

**Part of that is already checkable, on your machine, right now.**

The module that carries a document to a person and asks them to sign it must be out
of the agent's reach — not "we were careful", but genuinely unable to be called by
anything the model can trigger. In a program that has an exact meaning: there is no
chain of imports leading from the agent's code to that module. Code that cannot be
reached cannot be run, whatever the model asks for.

So it is a test rather than a promise. `npm test` reads every file in `src/`,
follows every import, and fails if anything the model can trigger can arrive at the
signing module — or at the private key that vouches for Charter's own record, which
is guarded for the same reason. The rules it enforces sit in one short file,
[src/boundary/policy.ts](src/boundary/policy.ts), written to be read without reading
any code.

Half of that test exists to prove the check works. It runs the same rules against
small invented projects where the guarded module *is* reachable — directly, four
steps away, and loaded only at the moment it is needed — and requires every one to
be caught. A check that has only ever seen clean code has never been shown to catch
anything, and would pass just as happily if it were broken.

One limit, said out loud: nothing that reads code can follow a file loaded by a name
the program works out while running. Rather than skipping those, the check reports
every one and fails the build if a single one exists. It refuses to be blind rather
than assuming the best.

**And the rule fired for real.** It was armed on 28 August, while the signing
module did not exist, with a note saying so and a test asserting the folder really
was empty — a note that expires by itself rather than one somebody has to remember.
On 30 August the first file was written into that folder and **the build failed**,
exactly as designed. It stayed failing until somebody wrote down, in the open, which
single file is allowed to reach it: `src/case/send-for-signature.ts`, which is not
part of the agent, runs only after a person has approved, and reads that approval
out of the append-only record rather than being handed it.

Permission granted deliberately and in the open, never acquired by accident. That
is the whole of what the rule is for, and it has now been tested by the thing
happening rather than by us imagining it.

---

## Checking our record without trusting us

Charter keeps a record of everything it does. Each entry carries the fingerprint of
the entry before it, so altering anything in the middle breaks every link after it
and the checker names the exact entry that changed.

One thing that chain cannot catch on its own: entries removed from the **end**,
because a shortened chain is still a valid chain. So the end of each record is
vouched for separately, with a key. That statement is an **attestation** — the
machine vouching for its own conduct. It is not a signature, and in Charter that
word is only ever used for something a person does.

An attestation is worth exactly as much as the key behind it is trusted, so the
public half of that key is published here, in the open:

    keys/attestation.pub

    key name   e9882545fba024e54fdbb93088300da8ff3d2e6455089726b05b48f82559249b

The public half only *checks* statements; it cannot make them, so publishing it
gives nothing away. The private half never leaves one machine.

**Why the key is published rather than shipped inside the thing it checks.** A
checker that read its key out of the same file it was checking would prove nothing
at all — anyone could sign anything with a key they invented and ship both
together. The key has to come from outside. That is what this file is for, and why
the key name above is worth comparing against the one in any packet you are handed.

If you are making your own copy, `npm run keys:generate` writes a fresh pair: the
public half here, the private half straight into `.env`, which is never committed.
It is never printed, so it does not end up in terminal scrollback.

---

## Three words, and their meanings never move

| Word | What it means here |
| --- | --- |
| **Seal** | What the machine puts on a document it made |
| **Attestation** | What the machine puts over its own record, vouching for its own conduct |
| **Signature** | What a **person** does. The word is never used for anything a machine does |

Anywhere the code, the screens or the writing breaks that, it is a bug.

Two words are never used: *immutable* and *tamper-proof*. The record is
**append-only** and **tamper-evident**. Charter detects modification; it does not
prevent it. Claiming prevention would be a claim the code cannot back.

---

## What is built, and what is not

Honest, because the demonstration above is checkable and this table should be too.

**Every count in this table is checked by the build.** `npm run readme:check` runs
the suite, asks the runner how many tests each file produced, and fails if any
number here is wrong — or if a test file exists that no row claims. A count nobody
states is fine. A count nobody checks is how a readme ends up saying 201 when the
answer is 658, which is what this one said on 30 August.

| Part | State |
| --- | --- |
| Canonical text form, so a fingerprint reproduces on any machine (RFC 8785) | **built, 26 tests** <!-- tests/canonical.test.ts --> |
| The chained record, and the checker that names the first broken link | **built, 25 tests** <!-- tests/chain.test.ts --> |
| Attestation over the head of the record (Ed25519, Node's own cryptography) | **built, 22 tests** <!-- tests/attestation.test.ts --> |
| Append-only rules enforced inside PostgreSQL, not by our code | **built, 24 tests** <!-- tests/log.test.ts --> |
| Record-and-replay, so the whole thing runs with no credentials | **built, 19 tests** <!-- tests/cache.test.ts --> |
| Model adapter — two verbs, never combined; replies kept exactly as they arrived | **built, 88 tests** <!-- tests/gemini.test.ts tests/groq.test.ts tests/router.test.ts --> |
| Counting each model's free daily allowance before sending, and refusing early | **built, 30 tests** <!-- tests/allowance.test.ts --> |
| Assembling the real models from the settings, and saying plainly when a key is missing | **built, 18 tests** <!-- tests/build.test.ts --> |
| The consent boundary as a code boundary — nothing the model can trigger can reach the signing module, the attestation key, or the code that records a person's consent | **built, 60 tests**, and the rule fired for real on 30 August <!-- tests/boundary.test.ts --> |
| Attacks on our own boundary, run on every build | **built, 19 tests** — all eight from the plan <!-- tests/attacks.test.ts --> |
| The agent loop — one request, one turn, nothing carried between them | **built, 41 tests** <!-- tests/loop.test.ts --> |
| Checking the model's arguments, and telling it exactly what to send instead | **built, 27 tests** <!-- tests/tool-schema.test.ts --> |
| All eight stages, which tools exist in each, and the rules that decide when each is finished | **built, 63 tests** <!-- tests/stages.test.ts --> |
| Every tool, including the rule that nothing costs money without a person's permission covering it | **built, 46 tests**, the spending rule proved by nothing being charged rather than by an error <!-- tests/tools.test.ts --> |
| One whole case through all eight stages, as a test rather than only as a demonstration | **built, 12 tests** <!-- tests/whole-run.test.ts --> |
| Whether two business names collide, decided in plain code | **built, 24 tests** <!-- tests/names.test.ts --> |
| The ownership agreement — every number, article number and cross-reference worked out in code, including a check that the voting rule and the deadlock article do not contradict each other | **built, 70 tests** <!-- tests/agreement.test.ts --> |
| Whether a written date is a day that actually happened, in one place both callers use | **built, 20 tests** <!-- tests/dates.test.ts --> |
| Reading identity documents, and routing a value to a person on whether it can be found in the document rather than on a confidence score | **built, 27 tests** <!-- tests/identity.test.ts --> |
| Assembling the pack, and refusing anything that would rewrite the file after it is sealed | **built, 40 tests** <!-- tests/pack.test.ts --> |
| The seal that sets the pack's permission level | **built, 22 tests**, on a real multi-page document <!-- tests/seal.test.ts --> |
| The checker a stranger runs against a finished pack | **built, 16 tests.** `npm run verify` <!-- tests/verify.test.ts --> |
| Classifying which vendor product each credential opens, by asking the vendor | **built, 29 tests** <!-- tests/credentials.test.ts --> |
| Every setting, and the file that reads each one — with `.env.example` generated from the code so the two cannot drift | **built, 43 tests** <!-- tests/settings.test.ts --> |
| Changing one line of `.env` and proving nothing else moved | **built, 24 tests** <!-- tests/env-file.test.ts --> |
| The readme's own numbers, checked against the code | **built, 16 tests** <!-- tests/readme.test.ts --> |
| The tool registry, and the catalogue generated from the code that runs | **built.** [TOOLS.md](TOOLS.md), regenerated and compared on every build |
| The outside services — documents, identity, registrar, search, publishing | **not yet.** Every one is a stand-in holding recorded answers, with no path to a network |
| The ownership agreement as a Word file, and the screens | **not yet** |

---

### The second demonstration

`npm run agent:demo` takes one business — two sisters, a bakery, one putting in
cash and one putting in an oven — through **all eight stages**, from a plain-English
description to a published website, against the same real database and the same
append-only record.

Nine things in it are worth watching for:

1. **The tools change when the stage changes.** Each stage sends the model its own
   list and nothing else, so a tool absent from a stage is not forbidden there —
   it does not exist there.
2. **The model sends a wrong argument** and is told which field, what type was
   expected and which values are allowed. It gets it right on the next attempt.
   That feedback is what makes a free model behave like a much better one.
3. **It reaches for a tool from a later stage.** Refused: it was never offered one.
4. **It asks for permission to spend, and cannot grant one.** A person grants it,
   and the record shows that entry caused by a human rather than by the model. It
   is the only reason anything was allowed to be bought.
5. **It tries to register an address costing more than the permission covers.**
   Refused, and the registrar is not contacted at all.
6. **Whether two business names collide is decided in plain code**, not by the
   model, and the working is shown.
7. **The ownership agreement is drafted, and Charter refuses to choose two of its
   terms.** Who runs the company, and whether there is a written way for an owner
   to leave. Neither has a safe default, so the tool that writes either one down
   refuses until the record shows a person was asked and answered.
8. **A value read from an identity document goes to a person** — one the reader was
   94% confident of. It goes anyway, because it could only be matched approximately
   in the document, and whether a value can be *found* is tested before how sure
   the reader *felt*. Nothing in the agent can clear it.
9. **The run reaches the boundary and stops.** Stage seven has no tools at all. A
   person approves sending the pack, naming it by its fingerprint, and only then
   does the last stage run.

At the end it prints the record — 122 entries, who caused each one, and whether the
chain holds — and then the complete list of everything the agent can do, generated
from the code that runs rather than written alongside it.

**Six entries in that record were caused by a person, of four kinds, and none of
the four kinds has a tool:** answering a question, granting permission to spend,
checking a value against the document it was read from, and approving that the pack
be sent. There are six because two questions were asked and answered.

**What is real and what is stood in for, plainly.** The demonstration prints this
itself, before it runs anything, rather than leaving it to be discovered.

Real: the database, the record and its chain, the rules the database enforces, the
stage machine, every tool, the checking of the model's arguments, the correction
sent back, the spending rule, the name comparison, the settings, and the seal — a
real certificate on a real multi-page PDF at permission level 2.

Stood in for: the model's replies, and **all four** outside services — search, the
registrar, the identity reader, and publishing. Each is a stand-in holding answers
recorded in advance, with no path to the network at all, so a missing answer is an
error rather than a quiet real call. Every one of them still goes through exactly
the code a real answer would.

The demonstration only shows what exists. Nothing in it is staged.

---

## Licence

No licence file, which means all rights are reserved. Design notes, decisions and
research for this project are not published.

---

*Built for the DevNetwork [API + Cloud + AI] Hackathon 2026.*
