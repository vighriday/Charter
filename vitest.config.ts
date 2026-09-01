import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',

    /**
     * How long one test may take before it is called a failure, in milliseconds.
     *
     * The default is five seconds, and that is too tight for this suite for a
     * reason that has nothing to do with the code being tested: several tests start
     * a real PostgreSQL inside the Node process, which takes one to five seconds on
     * its own before a single assertion runs. That is the point of them — the
     * append-only rules are enforced by the database, so testing them against
     * anything else would test nothing.
     *
     * Run on their own they pass in about eight seconds. Run alongside the other
     * thirty-seven files on a machine that is also doing something else, one of them
     * crossed five seconds and was reported as a failure. Nothing was wrong. The
     * suite was simply sharing a computer.
     *
     * A test that fails depending on how busy the machine is teaches people to run
     * it again rather than to read it, and the first thing anybody does with this
     * project is run the tests on their own laptop. Twenty seconds is four times the
     * slowest honest case and still short enough that something genuinely stuck is
     * reported as stuck rather than waited on.
     *
     * This changes no assertion. Every test still checks exactly what it checked.
     */
    testTimeout: 20_000,
  },
})
