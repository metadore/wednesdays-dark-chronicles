/**
 * Read-only probe: reports which DATABASE_URL the backend's Prisma client
 * actually resolves under the current NODE_ENV, WITHOUT connecting or writing.
 *
 * Usage: node scripts/db-resolve-probe.js
 * The optional argument 'hide-test-env' renames .env.test for the duration of
 * the probe so the failure mode can be observed.
 */
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const backendDir = path.resolve(__dirname, '..');
const envTestPath = path.join(backendDir, '.env.test');
const envPath = path.join(backendDir, '.env');

const hideTestEnv = process.argv[2] === 'hide-test-env';
const backupPath = `${envTestPath}.probe-backup`;

const expand = (url, env) =>
  url.replace(/\$\{([A-Z0-9_]+)\}/g, (_, n) => env[n] ?? '');

const readEnvFile = (file) => {
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

if (hideTestEnv && fs.existsSync(envTestPath)) {
  fs.renameSync(envTestPath, backupPath);
  console.log('[probe] .env.test temporarily hidden');
}

const prodEnv = readEnvFile(envPath);
const prodUrl = prodEnv.DATABASE_URL ? expand(prodEnv.DATABASE_URL, prodEnv) : null;

let resolved = 'UNRESOLVED';
let error = null;

try {
  const { pathToFileURL } = await import('url');
  const mod = await import(pathToFileURL(path.join(backendDir, 'src', 'lib', 'prisma.js')).href);
  resolved = process.env.DATABASE_URL || 'UNRESOLVED';
  void mod;
} catch (e) {
  error = e.message;
}

if (hideTestEnv && fs.existsSync(backupPath)) {
  fs.renameSync(backupPath, envTestPath);
  console.log('[probe] .env.test restored');
}

const dbName = (u) => {
  if (!u || u === 'UNRESOLVED') return u;
  try {
    return new URL(u).pathname.replace(/^\//, '').split('?')[0];
  } catch {
    return 'UNPARSEABLE';
  }
};

console.log(`NODE_ENV=${process.env.NODE_ENV ?? '(unset)'}`);
console.log(`resolved_db=${dbName(resolved)}`);
console.log(`production_db=${dbName(prodUrl)}`);
console.log(
  resolved !== 'UNRESOLVED' && prodUrl && resolved === prodUrl
    ? 'RESULT=RESOLVED_TO_PRODUCTION  <-- would touch the live database'
    : 'RESULT=NOT_PRODUCTION'
);
if (error) console.log(`IMPORT_ERROR=${error}`);
