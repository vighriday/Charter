# Recorded vendor responses

**What lives here right now: nothing but this file.** No outside service has been
called yet. The recording machinery is built and tested, and the recordings
themselves arrive when the vendor integrations do. This file says so plainly rather
than describing a folder that does not exist yet.

**What will live here.** Real responses from every outside service Charter uses,
captured once from real calls and saved as plain JSON.

**Why they will be committed.** Two reasons, and both matter.

**One — anyone can run this project without any credentials.** In replay mode
Charter serves these saved responses instead of calling out, and the whole flow
works end to end. Nothing is simulated or invented — these are the real responses
those services really gave. Three of the challenges this project enters require
exactly that: a stranger clones the repository and it runs.

**Two — the tests become real.** A test written against a hand-invented response
only proves the code agrees with our imagination. A test written against a recorded
response proves the code agrees with the world. The difference shows up at exactly
the worst moment.

There is also a practical reason. One vendor allows a fixed number of operations per
**year**, shared across all their products, and a single complete run consumes a
meaningful fraction of it. Development happens against recordings. Real calls happen
at deliberate checkpoints.

**How a recording is made.** Run in record mode. Every response is saved
automatically, keyed by a fingerprint of its request, in the canonical text form
used everywhere else in this project — so the same request always finds the same
recording, on any machine. Run again in replay mode and the saved response is
served with no network path at all.

**Replay mode has no network path.** It is not a cache that falls back to a real
call when it misses. A miss is an error naming the request that was not recorded.
That is deliberate: a demonstration must never be able to quietly become a real
call, and a test must never be able to quietly reach the internet.

**What is never recorded.** Anything containing real personal data. Only synthetic
sample identity documents are ever used. The recorder redacts credentials before
writing, and `npm run git:check` independently searches every file here for every
real value in the local environment file before any commit. Two mechanisms, because
one would be a hope.
