/**
 * Test-environment guard.
 *
 * The Prisma client reads DATABASE_URL straight from the environment and the
 * Prisma CLI (v5) always loads `.env`, so NODE_ENV alone does not keep a run
 * away from the live database. This module is the single place that decides
 * which database a process is allowed to touch, and it fails closed:
 *
 *   - in test mode the dedicated `.env.test` MUST exist,
 *   - it MUST define DATABASE_URL,
 *   - and that URL MUST NOT point at the production database.
 *
 * Anything else aborts the process with a clear error rather than silently
 * falling back to production.
 */
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const backendDir = path.resolve(__dirname, '..', '..');

export const envTestPath = path.join(backendDir, '.env.test');
export const envProdPath = path.join(backendDir, '.env');

export const isTestEnv = () => process.env.NODE_ENV === 'test';

/** Read a dotenv-style file into a plain object (no interpolation applied). */
export const parseEnvFile = (file) => {
  const out = {};
  if (!fs.existsSync(file)) return out;
  for (const raw of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
};

/** Expand `${VAR}` placeholders against a dotenv-style object. */
export const expandVars = (value, env) =>
  value.replace(/\$\{([A-Za-z0-9_]+)\}/g, (_, name) => env[name] ?? '');

/** Extract the database name from a PostgreSQL connection string. */
export const databaseName = (url) => {
  if (!url || typeof url !== 'string') return null;
  try {
    const name = decodeURIComponent(new URL(url).pathname.replace(/^\//, '').split('?')[0]);
    return name || null;
  } catch {
    return null;
  }
};

/** The production database name, resolved from `.env` (null when unknown). */
export const productionDatabaseName = () => {
  const prodEnv = parseEnvFile(envProdPath);
  if (!prodEnv.DATABASE_URL) return null;
  return databaseName(expandVars(prodEnv.DATABASE_URL, prodEnv));
};

let loaded = false;

/**
 * Load the dedicated test configuration and verify that it is safe.
 * Idempotent: repeated calls are a no-op after the first successful load.
 *
 * @throws {Error} when the test configuration is missing, incomplete, or
 *                 points at the production database.
 */
export const loadTestEnv = () => {
  if (loaded) return;
  loaded = true;

  if (!isTestEnv()) return;

  if (!fs.existsSync(envTestPath)) {
    throw new Error(
      `FATAL: NODE_ENV=test but the dedicated test configuration is missing: ${envTestPath}. ` +
        'Refusing to run against the live database. Restore .env.test or run the suite ' +
        'against a purpose-built test database.'
    );
  }

  // `override: true` so the test configuration wins over anything that was
  // already exported into the process environment.
  dotenv.config({ path: envTestPath, override: true });

  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      `FATAL: ${envTestPath} does not define DATABASE_URL. ` +
        'Refusing to run against the live database.'
    );
  }

  const testDb = databaseName(url);
  const prodDb = productionDatabaseName();

  if (prodDb && testDb === prodDb) {
    throw new Error(
      `FATAL: the test DATABASE_URL points at the production database "${prodDb}". ` +
        'Refusing to run against the live database.'
    );
  }
};
