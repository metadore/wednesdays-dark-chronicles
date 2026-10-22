import { PrismaClient } from '@prisma/client';
import { loadTestEnv, isTestEnv } from './test-env.js';

/**
 * Resolve the database connection string.
 *
 * The Prisma client reads the `DATABASE_URL` environment variable directly and
 * loads `.env` on its own, so simply setting NODE_ENV=test is not enough to
 * redirect the connection: dotenv never overrides a variable that is already
 * present in the environment.
 *
 * When NODE_ENV=test the connection string is therefore taken explicitly from
 * `.env.test` and passed to the client constructor. This keeps the automated
 * test suite away from the live database.
 *
 * `loadTestEnv()` fails closed: if the dedicated test configuration is missing
 * or points at the production database, the process aborts instead of
 * silently falling back to production.
 */
loadTestEnv();

const prisma = new PrismaClient({
  datasources: isTestEnv() && process.env.DATABASE_URL
    ? { db: { url: process.env.DATABASE_URL } }
    : undefined,
});

export default prisma;
