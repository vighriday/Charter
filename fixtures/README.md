# Recorded vendor responses

**What lives here.** Real responses from every outside service Charter uses,
captured once from real calls and saved.

**Why they are committed.** Two reasons, and both matter.

**One — anyone can run this project without any credentials.** Set `REPLAY_MODE=true`
and Charter serves these saved responses instead of calling out. The whole flow
works end to end: the documents generate, the identity checks run, the pack
assembles. Nothing is simulated or faked — these are the real responses those
services really gave.

**Two — the tests are real.** A test written against a hand-invented response only
proves the code agrees with our imagination. A test written against a recorded
response proves the code agrees with the world. The difference shows up at exactly
the worst moment.

There is also a practical reason. One vendor allows a fixed number of operations
per **year**, shared across all their products, and a single complete run consumes
a meaningful fraction of it. Development happens here. Real calls happen at
deliberate checkpoints.

**How a recording is made.** Run with `REPLAY_MODE=false`. Every response is saved
automatically, keyed by a fingerprint of its request. Run again with replay on and
the saved response is served.

**What is never recorded.** Anything containing real personal data. Only synthetic
sample identity documents are ever used.
