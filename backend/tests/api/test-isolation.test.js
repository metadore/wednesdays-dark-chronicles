/**
 * Phase 10 test-isolation regression tests.
 *
 * The fail-closed guards added in Phase 8 are mandatory: the automated suite
 * must never touch the live application database, whatever the caller does.
 * These tests exercise the guard itself, in isolated child processes, because
 * a guard that is only correct when it is imported in a particular order is
 * not a guard.
 *
 * Each case runs a SEPARATE node process with a controlled environment, so
 * one case cannot leave state behind for the next.
 */
import { expect } from 'chai';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { spawnSync } from 'child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const backendDir = path.resolve(__dirname, '..', '..');
const testEnvPath = path.join(backendDir, '.env.test');

/**
 * Run a node process in the backend directory with a controlled environment.
 * @returns {{status: number|null, stdout: string, stderr: string}}
 */
const runNode = (script, env = {}, argv = [], cwd = backendDir) => {
  const result = spawnSync(process.execPath, ['-e', script, ...argv], {
    cwd,
    encoding: 'utf8',
    env: {
      // A deliberately minimal environment: the guard must not depend on
      // anything the developer happens to have exported in their shell.
      PATH: process.env.PATH,
      SystemRoot: process.env.SystemRoot,
      TEMP: process.env.TEMP,
      TMP: process.env.TMP,
      ...env,
    },
    timeout: 30000,
  });
  return {
    status: result.status,
    stdout: result.stdout || '',
    stderr: result.stderr || '',
  };
};

describe('Phase 10: test-database isolation', () => {
  describe('The dedicated test configuration must exist', () => {
    it('should have a .env.test next to the backend', () => {
      expect(fs.existsSync(testEnvPath), `${testEnvPath} is missing`).to.equal(true);
    });

    it('should define a DATABASE_URL in .env.test', () => {
      const content = fs.readFileSync(testEnvPath, 'utf8');
      expect(content).to.match(/^\s*DATABASE_URL\s*=/m);
    });

    it('should point at a different database than the live configuration', () => {
      const prod = fs.readFileSync(path.join(backendDir, '.env'), 'utf8');
      const test = fs.readFileSync(testEnvPath, 'utf8');

      const nameOf = (text) => {
        const m = text.match(/DATABASE_URL\s*=\s*["']?[^"'\n]*?\/([^/?:"'\s]+)\??[^"'\n]*["']?/);
        return m ? m[1] : null;
      };

      const prodDb = nameOf(prod);
      const testDb = nameOf(test);

      expect(prodDb, 'could not read the live database name').to.be.a('string');
      expect(testDb, 'could not read the test database name').to.be.a('string');
      expect(testDb).to.not.equal(prodDb);
    });
  });

  describe('The guard must abort when the test configuration is missing', () => {
    it('should refuse to load when .env.test is absent', () => {
      // A copy of the backend directory without .env.test, so the real file
      // is untouched.
      const scratch = path.join(backendDir, 'scripts', 'tmp', 'isolation-no-envtest');
      fs.rmSync(scratch, { recursive: true, force: true });
      fs.mkdirSync(scratch, { recursive: true });
      fs.mkdirSync(path.join(scratch, 'src', 'lib'), { recursive: true });
      fs.copyFileSync(
        path.join(backendDir, 'src', 'lib', 'test-env.js'),
        path.join(scratch, 'src', 'lib', 'test-env.js')
      );

      const result = runNode(
        "import('./src/lib/test-env.js').then(m => { m.loadTestEnv(); console.log('LOADED'); }).catch(e => { console.error('ABORTED: ' + e.message); process.exit(1); });",
        { NODE_ENV: 'test' },
        [],
        scratch
      );

      // The scratch directory has no .env.test and no .env, so the guard must
      // abort rather than fall through to the live database.
      const output = `${result.stdout}${result.stderr}`;
      expect(output).to.not.include('LOADED');
      expect(result.status).to.equal(1);

      fs.rmSync(scratch, { recursive: true, force: true });
    });
  });

  describe('The guard must abort when the test URL points at the live database', () => {
    it('should refuse to load when .env.test names the production database', () => {
      const scratch = path.join(backendDir, 'scripts', 'tmp', 'isolation-same-db');
      fs.rmSync(scratch, { recursive: true, force: true });
      fs.mkdirSync(path.join(scratch, 'src', 'lib'), { recursive: true });
      fs.copyFileSync(
        path.join(backendDir, 'src', 'lib', 'test-env.js'),
        path.join(scratch, 'src', 'lib', 'test-env.js')
      );

      // A .env that names the SAME database as .env.test. The guard compares
      // the two names and must refuse to continue.
      fs.writeFileSync(
        path.join(scratch, '.env'),
        'DATABASE_URL="postgresql://user:pw@localhost:5432/db_test"\n'
      );
      fs.writeFileSync(
        path.join(scratch, '.env.test'),
        'DATABASE_URL="postgresql://user:pw@localhost:5432/db_test"\n'
      );

      const result = runNode(
        "import('./src/lib/test-env.js').then(m => { m.loadTestEnv(); console.log('LOADED'); }).catch(e => { console.error('ABORTED: ' + e.message); process.exit(1); });",
        { NODE_ENV: 'test' },
        [],
        scratch
      );

      const output = `${result.stdout}${result.stderr}`;
      expect(output).to.not.include('LOADED');
      expect(output).to.match(/production database/i);
      expect(result.status).to.equal(1);

      fs.rmSync(scratch, { recursive: true, force: true });
    });
  });

  describe('The guard must abort when the test configuration has no URL', () => {
    it('should refuse to load when .env.test defines no DATABASE_URL', () => {
      const scratch = path.join(backendDir, 'scripts', 'tmp', 'isolation-no-url');
      fs.rmSync(scratch, { recursive: true, force: true });
      fs.mkdirSync(path.join(scratch, 'src', 'lib'), { recursive: true });
      fs.copyFileSync(
        path.join(backendDir, 'src', 'lib', 'test-env.js'),
        path.join(scratch, 'src', 'lib', 'test-env.js')
      );

      fs.writeFileSync(path.join(scratch, '.env'), 'DATABASE_URL="postgresql://u:p@localhost:5432/live"\n');
      fs.writeFileSync(path.join(scratch, '.env.test'), 'JWT_SECRET="x"\nCSRF_SECRET="y"\n');

      const result = runNode(
        "import('./src/lib/test-env.js').then(m => { m.loadTestEnv(); console.log('LOADED'); }).catch(e => { console.error('ABORTED: ' + e.message); process.exit(1); });",
        { NODE_ENV: 'test' },
        [],
        scratch
      );

      const output = `${result.stdout}${result.stderr}`;
      expect(output).to.not.include('LOADED');
      expect(output).to.match(/does not define DATABASE_URL/i);
      expect(result.status).to.equal(1);

      fs.rmSync(scratch, { recursive: true, force: true });
    });
  });

  describe('The guard must be inert outside test mode', () => {
    it('should not abort in development mode', () => {
      const result = runNode(
        "import('./src/lib/test-env.js').then(m => { m.loadTestEnv(); console.log('LOADED'); }).catch(e => { console.error('ABORTED: ' + e.message); process.exit(1); });",
        { NODE_ENV: 'development' }
      );

      const output = `${result.stdout}${result.stderr}`;
      expect(output).to.include('LOADED');
      expect(result.status).to.equal(0);
    });
  });

  describe('The mocha root guard must refuse a run without NODE_ENV=test', () => {
    it('should abort when mocha is invoked without NODE_ENV=test', () => {
      const result = spawnSync(
        process.execPath,
        [path.join(backendDir, 'node_modules', 'mocha', 'bin', 'mocha.js'), 'tests/health.test.js', '--exit'],
        {
          cwd: backendDir,
          encoding: 'utf8',
          env: {
            PATH: process.env.PATH,
            SystemRoot: process.env.SystemRoot,
            TEMP: process.env.TEMP,
            TMP: process.env.TMP,
            NODE_ENV: 'development',
          },
          timeout: 60000,
        }
      );

      const output = `${result.stdout}${result.stderr}`;
      expect(output).to.match(/NODE_ENV=test/);
      expect(result.status).to.not.equal(0);
    });
  });

  describe('The Prisma CLI wrapper must target the test database', () => {
    it('should resolve the test database when NODE_ENV=test', () => {
      const result = runNode(
        "import('./src/lib/test-env.js').then(m => { m.loadTestEnv(); const n = m.databaseName(process.env.DATABASE_URL); const p = m.productionDatabaseName(); console.log('TESTDB=' + n); console.log('PRODDB=' + p); }).catch(e => { console.error('ABORTED: ' + e.message); process.exit(1); });",
        { NODE_ENV: 'test' }
      );

      const output = `${result.stdout}${result.stderr}`;
      const testDb = (output.match(/TESTDB=(\S+)/) || [])[1];
      const prodDb = (output.match(/PRODDB=(\S+)/) || [])[1];

      expect(testDb, 'the test database name was not resolved').to.be.a('string');
      expect(prodDb, 'the live database name was not resolved').to.be.a('string');
      expect(testDb).to.not.equal(prodDb);
    });
  });

  describe('The suite must not reach the live database', () => {
    it('should report the test database as the one in use', () => {
      // The Prisma client resolves its URL from the environment in test mode.
      const result = runNode(
        "import('./src/lib/prisma.js').then(async m => { const rows = await m.default.$queryRawUnsafe('SELECT current_database() AS db'); console.log('ACTIVE=' + rows[0].db); process.exit(0); }).catch(e => { console.error('FAILED: ' + e.message); process.exit(1); });",
        { NODE_ENV: 'test' }
      );

      const output = `${result.stdout}${result.stderr}`;
      const active = (output.match(/ACTIVE=(\S+)/) || [])[1];

      expect(active, 'could not read the active database').to.be.a('string');

      const prodEnv = fs.readFileSync(path.join(backendDir, '.env'), 'utf8');
      const prodDb = (prodEnv.match(/DATABASE_URL\s*=\s*["']?[^"'\n]*?\/([^/?:"'\s]+)\??[^"'\n]*["']?/) || [])[1];

      expect(active).to.not.equal(prodDb);
    });
  });
});
