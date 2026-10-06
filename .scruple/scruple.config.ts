import { defineConfig } from '@scruple/core'
import { oxcParser } from '@scruple/parser-oxc'
import { deciderProvider } from '@scruple/provider-decider'
import { errors } from '@scruple/errors'
import { comments } from '@scruple/comments'
import { tests } from '@scruple/tests'
import { relationalDatabases } from '@scruple/relational-databases'
import { cachedProvider } from 'scruple-provider-cache'
import { ideology } from 'scruple-plugin-ideology'

const apiKey = process.env['TYPESAFE_API_KEY']
if (apiKey === undefined) {
  throw new Error('Scruple is experimental and needs TYPESAFE_API_KEY in the environment. See README.md beside this config.')
}

export default defineConfig({
  parser: oxcParser(),
  provider: cachedProvider(deciderProvider({ model: process.env['DECIDER_MODEL'] ?? 'Mapika/decider-4b' }), {
    enabled: process.env['SCRUPLE_CACHE'] !== 'off'    // SCRUPLE_CACHE=off forces a live run
  }),
  include: ['src/**/*.js', 'fake_external_services/**/*.js'],
  ignore: ['**/node_modules/**'],
  plugins: {
    errors: errors(),
    comments: comments(),
    tests: tests(),
    'relational-databases': relationalDatabases(),
    ideology: ideology()
  },
  rules: {
    'errors/no-swallowed-errors': 'warn',     // "a catch that logs and continues is a catch with no recovery in it"
    'errors/no-useless-catch-boundaries': 'warn',   // Errors bubble up
    'errors/no-lossy-error-wrapping': 'warn',       // Errors bubble up
    'comments/no-useless-comments': 'warn',         // Code comments only for non-obvious *why*
    'comments/no-change-history-comments': 'warn',  // A comment states a lasting fact, never the edit that produced it
    'comments/no-misleading-comments': 'warn',      // A comment states a lasting fact, never the edit that produced it
    'comments/no-commented-out-code': 'warn',       // Minimize code. Delete what you can.
    'comments/require-justified-suppressions': 'warn',  // An exception is documented where the exception occurs
    'tests/no-vacuous-tests': 'warn',               // Tests describe behavior
    'tests/no-nondeterministic-tests': 'warn',      // Tests describe behavior
    'tests/require-specific-error-assertions': 'warn',                  // Tests describe behavior
    'relational-databases/no-query-in-loop': 'warn',                    // Declarative transformations over imperative loops
    'relational-databases/prefer-database-join': 'warn',                // Declarative transformations over imperative loops
    'ideology/inject-dependencies': 'warn',  // Inject dependencies. Never instantiate or import a dependency internally
    'ideology/model-absence': 'warn',  // Model absence, don't default it
    'ideology/no-argument-mutation': 'warn',  // Pure functions, explicit inputs, no hidden state
    'ideology/no-decisions-by-omission': 'warn',  // A deliberate break from a documented pattern is a comment in the code at the break
    'ideology/no-hardcoded-config': 'warn',  // Config from the environment. No hardcoded credentials or connection strings
    'ideology/no-hidden-state': 'warn',  // Pure functions, explicit inputs, no hidden state
    'ideology/no-infrastructure-in-core': 'warn',  // Business logic in the core; infrastructure at the edges
    'ideology/no-repeated-literals': 'warn',  // Anything referenced twice is a constant or injected — never a repeated magic string
    'ideology/no-speculative-code': 'warn',  // Minimize code. Delete what you can
    'ideology/no-swallowed-errors': 'warn',  // Logging is not recovery
    'ideology/no-vendor-types-in-core': 'warn',  // A repository never returns an ORM instance, query row, or driver-native type
    'ideology/one-job-per-function': 'warn',  // One obvious job per function, class, module, layer
    'ideology/outbound-call-resilience': 'warn',  // Business logic in the core; infrastructure at the edges. Dependencies point inward
    'ideology/prefer-composition': 'warn',  // Declarative transformations over imperative loops
    'ideology/prefer-declarative-transformation': 'warn',  // Declarative transformations over imperative loops
    'ideology/prefer-simple-construct': 'warn',  // Simple over clever. Always
    'ideology/translate-at-boundary': 'warn'  // Translate external formats at boundaries, not in core logic
  }
})
