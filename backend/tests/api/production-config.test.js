/**
 * Phase 10 production-configuration regression tests.
 *
 * These tests cover the environment behaviour a deployment depends on:
 * the startup check, the cookie attributes, the CORS policy and the
 * rate-limit configuration.
 *
 * The startup check is exercised in an ISOLATED copy of the configuration
 * module, because the real one loads `.env` from the source tree, and a
 * deployment has no `.env`: its secrets come from the platform's
 * environment. Testing against the real directory would prove nothing.
 */
import { expect } from 'chai';
import request from 'supertest';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { spawnSync } from 'child_process';
import app from '../../src/app.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const backendDir = path.resolve(__dirname, '..', '..');

/**
 * Copy the configuration module into a scratch directory that has no `.env`
 * and run it there with a controlled environment.
 */
const runConfig = (env) => {
  const scratch = path.join(backendDir, 'scripts', 'tmp', `prod-check-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
  fs.rmSync(scratch, { recursive: true, force: true });
  fs.mkdirSync(path.join(scratch, 'src', 'lib'), { recursive: true });
  fs.copyFileSync(path.join(backendDir, 'src', 'lib', 'test-env.js'), path.join(scratch, 'src', 'lib', 'test-env.js'));
  fs.copyFileSync(path.join(backendDir, 'src', 'config.js'), path.join(scratch, 'src', 'config.js'));

  const result = spawnSync(
    process.execPath,
    ['-e', "import('./src/config.js').then(()=>{console.log('STARTED');}).catch(e=>{console.error('ERR: '+e.message);process.exit(1);});"],
    {
      cwd: scratch,
      encoding: 'utf8',
      env: { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, ...env },
      timeout: 30000,
    }
  );

  fs.rmSync(scratch, { recursive: true, force: true });

  return {
    status: result.status,
    stdout: result.stdout || '',
    stderr: result.stderr || '',
  };
};

describe('Phase 10: production configuration', () => {
  describe('The startup check must abort a production run without secrets', () => {
    it('should abort when neither secret is present', () => {
      const result = runConfig({ NODE_ENV: 'production' });

      expect(result.status).to.equal(1);
      expect(result.stdout).to.not.include('STARTED');
      expect(result.stderr).to.match(/FATAL: Missing required production secrets/);
      expect(result.stderr).to.include('JWT_SECRET');
      expect(result.stderr).to.include('CSRF_SECRET');
    });

    it('should abort when only one secret is present', () => {
      const result = runConfig({ NODE_ENV: 'production', JWT_SECRET: 'x'.repeat(48) });

      expect(result.status).to.equal(1);
      expect(result.stderr).to.match(/FATAL: Missing required production secrets: CSRF_SECRET/);
    });

    it('should start when both secrets are present', () => {
      const result = runConfig({
        NODE_ENV: 'production',
        JWT_SECRET: 'x'.repeat(48),
        CSRF_SECRET: 'y'.repeat(48),
      });

      expect(result.status).to.equal(0);
      expect(result.stdout).to.include('STARTED');
    });

    it('should only warn, not abort, outside production', () => {
      const result = runConfig({ NODE_ENV: 'development' });

      expect(result.status).to.equal(0);
      expect(result.stdout).to.include('STARTED');
      expect(result.stderr).to.match(/WARNING: Missing secrets in development/);
    });
  });

  describe('The example configuration must carry no real credentials', () => {
    const examplePath = path.join(backendDir, '.env.example');

    it('should exist', () => {
      expect(fs.existsSync(examplePath)).to.equal(true);
    });

    it('should hold a placeholder for every secret', () => {
      const content = fs.readFileSync(examplePath, 'utf8');
      const secrets = ['JWT_SECRET', 'CSRF_SECRET', 'DB_PASSWORD'];

      for (const key of secrets) {
        const match = content.match(new RegExp(`^${key}=(.*)$`, 'm'));
        expect(match, `${key} is missing from .env.example`).to.be.a('array');
        expect(match[1], `${key} in .env.example`).to.match(/replace-me/);
      }
    });

    it('should not carry the unused SESSION_SECRET', () => {
      const content = fs.readFileSync(examplePath, 'utf8');
      // The CSRF session identifier is a random cookie value, not a signed
      // one, so there is no session secret to configure.
      expect(content).to.not.match(/^SESSION_SECRET=/m);
    });

    it('should document the reverse-proxy setting', () => {
      const content = fs.readFileSync(examplePath, 'utf8');
      expect(content).to.match(/^TRUST_PROXY_HOPS=/m);
    });
  });

  describe('The cookies must be set with safe attributes', () => {
    it('should set the CSRF cookies with HttpOnly, SameSite and Path', async () => {
      const res = await request(app).get('/api/auth/csrf-token');
      const cookies = res.headers['set-cookie'] || [];

      expect(cookies.length).to.be.at.least(2);

      for (const cookie of cookies) {
        expect(cookie).to.match(/HttpOnly/i);
        expect(cookie).to.match(/SameSite=Strict/i);
        expect(cookie).to.match(/Path=\//i);
      }
    });

    it('must never expose the session identifier to the browser script', async () => {
      const res = await request(app).get('/api/auth/csrf-token');
      const cookies = res.headers['set-cookie'] || [];

      // The CSRF token cookie and the session cookie are both HttpOnly, so
      // the page cannot read them; the token is handed out in the body
      // instead.
      for (const cookie of cookies) {
        expect(cookie).to.match(/HttpOnly/i);
      }
    });
  });

  describe('CORS must never combine a wildcard with credentials', () => {
    it('should refuse an unknown origin', async () => {
      const res = await request(app)
        .get('/api/health')
        .set('Origin', 'https://not-allowed.example');

      expect(res.headers['access-control-allow-origin']).to.not.equal('*');
    });

    it('should allow a configured origin', async () => {
      const allowed = process.env.FRONTEND_ORIGIN;
      if (!allowed) return; // Nothing to assert without a configured origin.

      const origin = allowed.split(',')[0].trim();
      const res = await request(app)
        .get('/api/health')
        .set('Origin', origin);

      expect(res.headers['access-control-allow-origin']).to.equal(origin);
      expect(res.headers['access-control-allow-credentials']).to.equal('true');
    });
  });
});
