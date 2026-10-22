/**
 * Mocha root guard: the automated suite must never run against the production
 * database.
 *
 * `npm test` sets NODE_ENV=test through cross-env, and src/lib/prisma.js
 * refuses to start in test mode unless a dedicated test database is
 * configured. This guard closes the remaining gap: if somebody runs mocha
 * directly (without npm test) the suite now fails immediately and loudly
 * instead of quietly exercising the live database.
 *
 * Loaded through .mocharc.json -> "require".
 */
if (process.env.NODE_ENV !== 'test') {
  throw new Error(
    'FATAL: the test suite must be run with NODE_ENV=test. Use `npm test` (or ' +
      '`npm run test:comments`) so that the dedicated test database is used. ' +
      'Refusing to run the suite against the live database.'
  );
}
