/**
 * Prisma CLI wrapper that guarantees the CLI targets the same database as the
 * application.
 *
 * The Prisma CLI (v5) always loads `.env` and ignores NODE_ENV, so
 * `NODE_ENV=test prisma migrate deploy` would still target the live database.
 * This wrapper loads the correct env file first and then execs the CLI with
 * an explicit DATABASE_URL, so:
 *
 *   - in test mode the CLI reads `.env.test` (and refuses to run if it is
 *     missing or points at the production database),
 *   - otherwise the CLI reads `.env` exactly as before.
 */
import path from 'path';
import fs from 'fs';
import { spawn } from 'child_process';
import { fileURLToPath, pathToFileURL } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const backendDir = path.resolve(__dirname, '..');

const { loadTestEnv, isTestEnv, envTestPath, envProdPath, parseEnvFile, expandVars } =
  await import(pathToFileURL(path.join(backendDir, 'src', 'lib', 'test-env.js')).href);

// Throws (and aborts) when the test configuration is missing or unsafe.
loadTestEnv();

let databaseUrl = process.env.DATABASE_URL;

if (isTestEnv()) {
  if (!databaseUrl) {
    console.error(`FATAL: ${envTestPath} does not define DATABASE_URL.`);
    process.exit(1);
  }
} else {
  // Production/development: read `.env` explicitly so the CLI does not depend
  // on its own implicit `.env` loading.
  const prodEnv = parseEnvFile(envProdPath);
  if (prodEnv.DATABASE_URL) {
    databaseUrl = expandVars(prodEnv.DATABASE_URL, prodEnv);
  }
  if (!databaseUrl && fs.existsSync(envProdPath)) {
    // Fall through: the CLI will report a missing datasource itself.
  }
}

const prismaBin = path.join(
  backendDir,
  'node_modules',
  'prisma',
  'build',
  'index.js'
);

const args = process.argv.slice(2);
const child = spawn(process.execPath, [prismaBin, ...args], {
  stdio: 'inherit',
  env: {
    ...process.env,
    // The CLI loads `.env` on its own, but dotenv never overrides a variable
    // that is already present in the environment, so setting DATABASE_URL here
    // is what actually decides which database the CLI talks to.
    ...(databaseUrl ? { DATABASE_URL: databaseUrl } : {}),
  },
});

child.on('exit', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 1);
});
