/**
 * Phase 10 security regression tests, part two.
 *
 * Each test here corresponds to a defect that was found by the Phase 10
 * audit and fixed. They exist so the defect cannot come back.
 *
 * Part one (tests/api/security.test.js) covers CORS, JWT binding, error
 * leakage, publication-flag coercion, slug safety and URL schemes.
 * This file covers the request-shape and deployment-readiness defects:
 * request body limits, pagination bounds, field length limits, the health
 * check, and the trust-proxy setting.
 */
import request from 'supertest';
import { expect } from 'chai';
import path from 'path';
import { fileURLToPath } from 'url';
import { spawnSync } from 'child_process';
import app from '../../src/app.js';
import prisma from '../../src/lib/prisma.js';
import bcrypt from 'bcryptjs';
import { signAdminToken } from '../helpers/admin-token.js';
import { parsePositiveInt, resolvePagination } from '../../src/lib/pagination.js';
import { LIMITS } from '../../src/lib/content-validation.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const backendDir = path.resolve(__dirname, '..', '..');

describe('Phase 10 security regressions: request shape and readiness', () => {
  let adminUser;
  let adminToken;
  let agent;

  before(async () => {
    adminUser = await prisma.user.upsert({
      where: { username: 'p10-req-admin' },
      update: {},
      create: { username: 'p10-req-admin', password: 'Password123!' },
    });
    await prisma.user.update({
      where: { username: 'p10-req-admin' },
      data: { password: await bcrypt.hash('Password123!', 10) },
    });
    adminToken = signAdminToken(adminUser);
    agent = request.agent(app);
  });

  after(async () => {
    await prisma.user.deleteMany({ where: { username: 'p10-req-admin' } });
    await prisma.post.deleteMany({ where: { slug: { startsWith: 'p10-req-' } } });
    await prisma.artifact.deleteMany({ where: { slug: { startsWith: 'p10-req-' } } });
    await prisma.category.deleteMany({ where: { slug: { startsWith: 'p10-req-' } } });
  });

  const csrf = async () => (await agent.get('/api/auth/csrf-token')).body.token;

  describe('The request body limit must admit the largest documented field', () => {
    it('should accept a blog post body at the documented content limit', async () => {
      const slug = `p10-req-body-${Date.now()}`;
      const content = 'c'.repeat(LIMITS.contentMax);

      // The CSRF token must be fetched BEFORE the request object is
      // created: supertest's agent captures the cookie jar when the
      // request is built, so a token fetched inside the chain would
      // travel without the session cookies and be refused.
      const token = await csrf();

      const res = await agent
        .post('/api/admin/posts')
        .set('Cookie', `auth_token=${adminToken}`)
        .set('x-csrf-token', token)
        .send({ title: 'Long', slug, content });

      // The transport limit must not reject a value the content validator
      // accepts. A 413 here is the defect this test guards against.
      expect(res.status).to.equal(201);
      expect(res.body.content.length).to.equal(LIMITS.contentMax);
    });

    it('should accept a story introduction at the documented limit', async () => {
      const slug = `p10-req-story-${Date.now()}`;

      // The CSRF token must be fetched BEFORE the request object is
      // created: supertest's agent captures the cookie jar when the
      // request is built, so a token fetched inside the chain would
      // travel without the session cookies and be refused.
      const token = await csrf();

      const res = await agent
        .post('/api/admin/stories')
        .set('Cookie', `auth_token=${adminToken}`)
        .set('x-csrf-token', token)
        .send({ title: 'Long story', slug, introduction: 'i'.repeat(2000) });

      expect(res.status).to.equal(201);
    });

    it('should still refuse a body that is far beyond any documented limit', async () => {
      // The CSRF token must be fetched BEFORE the request object is
      // created: supertest's agent captures the cookie jar when the
      // request is built, so a token fetched inside the chain would
      // travel without the session cookies and be refused.
      const token = await csrf();

      const res = await agent
        .post('/api/admin/posts')
        .set('Cookie', `auth_token=${adminToken}`)
        .set('x-csrf-token', token)
        .send({ title: 'Huge', slug: `p10-req-huge-${Date.now()}`, content: 'x'.repeat(2 * 1024 * 1024) });

      expect(res.status).to.equal(413);
    });
  });

  describe('Pagination must be bounded and must never reach the database as garbage', () => {
    const listEndpoints = ['/api/posts', '/api/artifacts', '/api/stories'];

    for (const endpoint of listEndpoints) {
      it(`should survive a page that overflows a safe integer on ${endpoint}`, async () => {
        const res = await request(app).get(`${endpoint}?page=99999999999999999999`);

        // Before the fix this was a 500 carrying the raw Prisma query. The
        // API handles an invalid pagination parameter gracefully, so the
        // request must succeed and the value must fall back to the default.
        expect(res.status).to.equal(200);
        expect(res.body.meta.page).to.equal(1);
      });

      it(`should survive a non-numeric page on ${endpoint}`, async () => {
        const res = await request(app).get(`${endpoint}?page=abc`);
        expect(res.status).to.equal(200);
        expect(res.body.meta.page).to.equal(1);
      });

      it(`should survive a negative page on ${endpoint}`, async () => {
        const res = await request(app).get(`${endpoint}?page=-5`);
        expect(res.status).to.equal(200);
        expect(res.body.meta.page).to.equal(1);
      });

      it(`should survive an exponent-form page on ${endpoint}`, async () => {
        const res = await request(app).get(`${endpoint}?page=1e999`);
        expect(res.status).to.equal(200);
        expect(res.body.meta.page).to.equal(1);
      });

      it(`should survive a zero limit on ${endpoint}`, async () => {
        const res = await request(app).get(`${endpoint}?limit=0`);
        expect(res.status).to.equal(200);
        expect(res.body.meta.limit).to.equal(10);
      });

      it(`should cap the limit on ${endpoint}`, async () => {
        const res = await request(app).get(`${endpoint}?limit=1000`);
        expect(res.status).to.equal(200);
        expect(res.body.meta.limit).to.equal(50);
      });

      it(`should never leak a raw Prisma message on ${endpoint}`, async () => {
        for (const query of ['page=99999999999999999999', 'page=abc', 'page=-5', 'page=1e999']) {
          const res = await request(app).get(`${endpoint}?${query}`);
          const body = JSON.stringify(res.body);
          expect(body, `${endpoint}?${query}`).to.not.include('prisma.');
          expect(body, `${endpoint}?${query}`).to.not.include('Invalid `prisma');
        }
      });
    }

    it('should treat a missing page as the first page', async () => {
      const res = await request(app).get('/api/posts');
      expect(res.status).to.equal(200);
      expect(res.body.meta.page).to.equal(1);
    });

    describe('the pagination helper', () => {
      it('should accept a plain positive integer', () => {
        expect(parsePositiveInt('3')).to.equal(3);
        expect(parsePositiveInt(3)).to.equal(3);
      });

      it('should reject everything that is not a positive integer', () => {
        for (const bad of ['0', '-1', 'abc', '1.5', '1e999', '0x10', '', ' ', null, undefined, {}]) {
          expect(parsePositiveInt(bad), `input ${JSON.stringify(bad)}`).to.equal(null);
        }
      });

      it('should clamp the limit to the maximum', () => {
        expect(resolvePagination({ limit: '1000' }).limit).to.equal(50);
      });

      it('should keep the skip a safe integer for an enormous page', () => {
        const { skip } = resolvePagination({ page: '9007199254740991' });
        expect(Number.isSafeInteger(skip)).to.equal(true);
      });
    });
  });

  describe('Administrator content must be length-limited', () => {
    it('should reject a post title beyond the limit', async () => {
      // The CSRF token must be fetched BEFORE the request object is
      // created: supertest's agent captures the cookie jar when the
      // request is built, so a token fetched inside the chain would
      // travel without the session cookies and be refused.
      const token = await csrf();

      const res = await agent
        .post('/api/admin/posts')
        .set('Cookie', `auth_token=${adminToken}`)
        .set('x-csrf-token', token)
        .send({ title: 'T'.repeat(LIMITS.titleMax + 1), slug: `p10-req-title-${Date.now()}`, content: 'c' });

      expect(res.status).to.equal(400);
      expect(res.body.error).to.match(/Title/);
    });

    it('should reject a post excerpt beyond the limit', async () => {
      // The CSRF token must be fetched BEFORE the request object is
      // created: supertest's agent captures the cookie jar when the
      // request is built, so a token fetched inside the chain would
      // travel without the session cookies and be refused.
      const token = await csrf();

      const res = await agent
        .post('/api/admin/posts')
        .set('Cookie', `auth_token=${adminToken}`)
        .set('x-csrf-token', token)
        .send({
          title: 'ok',
          slug: `p10-req-excerpt-${Date.now()}`,
          excerpt: 'E'.repeat(LIMITS.excerptMax + 1),
          content: 'c',
        });

      expect(res.status).to.equal(400);
      expect(res.body.error).to.match(/Excerpt/);
    });

    it('should reject a post body beyond the limit', async () => {
      // The CSRF token must be fetched BEFORE the request object is
      // created: supertest's agent captures the cookie jar when the
      // request is built, so a token fetched inside the chain would
      // travel without the session cookies and be refused.
      const token = await csrf();

      const res = await agent
        .post('/api/admin/posts')
        .set('Cookie', `auth_token=${adminToken}`)
        .set('x-csrf-token', token)
        .send({
          title: 'ok',
          slug: `p10-req-content-${Date.now()}`,
          content: 'c'.repeat(LIMITS.contentMax + 1),
        });

      expect(res.status).to.equal(400);
      expect(res.body.error).to.match(/Content/);
    });

    it('should reject an artifact name beyond the limit', async () => {
      // The CSRF token must be fetched BEFORE the request object is
      // created: supertest's agent captures the cookie jar when the
      // request is built, so a token fetched inside the chain would
      // travel without the session cookies and be refused.
      const token = await csrf();

      const res = await agent
        .post('/api/admin/artifacts')
        .set('Cookie', `auth_token=${adminToken}`)
        .set('x-csrf-token', token)
        .send({
          name: 'N'.repeat(LIMITS.nameMax + 1),
          slug: `p10-req-name-${Date.now()}`,
          description: 'd',
        });

      expect(res.status).to.equal(400);
      expect(res.body.error).to.match(/Name/);
    });

    it('should reject an artifact description beyond the limit', async () => {
      // The CSRF token must be fetched BEFORE the request object is
      // created: supertest's agent captures the cookie jar when the
      // request is built, so a token fetched inside the chain would
      // travel without the session cookies and be refused.
      const token = await csrf();

      const res = await agent
        .post('/api/admin/artifacts')
        .set('Cookie', `auth_token=${adminToken}`)
        .set('x-csrf-token', token)
        .send({
          name: 'ok',
          slug: `p10-req-desc-${Date.now()}`,
          description: 'D'.repeat(LIMITS.descriptionMax + 1),
        });

      expect(res.status).to.equal(400);
      expect(res.body.error).to.match(/Description/);
    });

    it('should reject a category name beyond the limit', async () => {
      // The CSRF token must be fetched BEFORE the request object is
      // created: supertest's agent captures the cookie jar when the
      // request is built, so a token fetched inside the chain would
      // travel without the session cookies and be refused.
      const token = await csrf();

      const res = await agent
        .post('/api/admin/categories')
        .set('Cookie', `auth_token=${adminToken}`)
        .set('x-csrf-token', token)
        .send({ name: 'C'.repeat(LIMITS.categoryNameMax + 1), slug: `p10-req-cat-${Date.now()}` });

      expect(res.status).to.equal(400);
      expect(res.body.error).to.match(/Name/);
    });

    it('should reject an over-long title on an update', async () => {
      const slug = `p10-req-upd-${Date.now()}`;
      const created = await prisma.post.create({
        data: { title: 'Original', slug, content: 'c', published: false },
      });

      // The CSRF token must be fetched BEFORE the request object is
      // created: supertest's agent captures the cookie jar when the
      // request is built, so a token fetched inside the chain would
      // travel without the session cookies and be refused.
      const token = await csrf();

      const res = await agent
        .put(`/api/admin/posts/${created.id}`)
        .set('Cookie', `auth_token=${adminToken}`)
        .set('x-csrf-token', token)
        .send({ title: 'T'.repeat(LIMITS.titleMax + 1) });

      expect(res.status).to.equal(400);
      await prisma.post.delete({ where: { id: created.id } });
    });

    it('should accept a value exactly at the limit', async () => {
      const slug = `p10-req-ok-${Date.now()}`;
      // The CSRF token must be fetched BEFORE the request object is
      // created: supertest's agent captures the cookie jar when the
      // request is built, so a token fetched inside the chain would
      // travel without the session cookies and be refused.
      const token = await csrf();

      const res = await agent
        .post('/api/admin/posts')
        .set('Cookie', `auth_token=${adminToken}`)
        .set('x-csrf-token', token)
        .send({ title: 'T'.repeat(LIMITS.titleMax), slug, content: 'c' });

      expect(res.status).to.equal(201);
      await prisma.post.delete({ where: { slug } });
    });
  });

  describe('The health check must reflect the database', () => {
    it('should report the database as connected when it is reachable', async () => {
      const res = await request(app).get('/api/health');

      expect(res.status).to.equal(200);
      expect(res.body.status).to.equal('ok');
      expect(res.body.services.database).to.equal('connected');
    });

    it('should no longer report the database as "unconfigured"', async () => {
      const res = await request(app).get('/api/health');
      expect(res.body.services.database).to.not.equal('unconfigured');
    });
  });

  describe('The API must not be configured to trust every proxy', () => {
    it('should never set trust proxy to true', () => {
      // `trust proxy: true` lets any client spoof X-Forwarded-For and escape
      // the rate limit. The setting must be a hop count, or not set at all.
      expect(app.get('trust proxy')).to.not.equal(true);
    });

    it('should not trust a proxy when none is configured', () => {
      // The default is direct exposure, so the setting is either unset or
      // false. Anything else would mean a proxy is trusted without being
      // configured.
      const setting = app.get('trust proxy');
      expect(setting === false || setting === 0 || setting === undefined).to.equal(true);
    });
  });

  describe('The reverse-proxy setting must be read from the environment', () => {
    // The setting is read once at startup, so each case runs the
    // application in its own process with its own environment.
    const runApp = (env) => {
      const result = spawnSync(
        process.execPath,
        [
          '-e',
          "import('./src/app.js').then(m => { const a = m.default; console.log('TRUST=' + JSON.stringify(a.get('trust proxy'))); process.exit(0); }).catch(e => { console.error('ERR:' + e.message); process.exit(1); });",
        ],
        {
          cwd: backendDir,
          encoding: 'utf8',
          env: {
            PATH: process.env.PATH,
            SystemRoot: process.env.SystemRoot,
            NODE_ENV: 'test',
            JWT_SECRET: 'test-jwt-secret-value',
            CSRF_SECRET: 'test-csrf-secret-value',
            ...env,
          },
          timeout: 60000,
        }
      );
      return { status: result.status, stdout: result.stdout || '', stderr: result.stderr || '' };
    };

    it('should trust one proxy when TRUST_PROXY_HOPS is 1', () => {
      const result = runApp({ TRUST_PROXY_HOPS: '1' });
      expect(result.stdout).to.include('TRUST=1');
    });

    it('should refuse a hop count outside 0 to 10', () => {
      const result = runApp({ TRUST_PROXY_HOPS: '99' });
      expect(result.status).to.equal(1);
      expect(result.stderr).to.match(/TRUST_PROXY_HOPS must be an integer between 0 and 10/);
    });

    it('should refuse a hop count that is not a number', () => {
      const result = runApp({ TRUST_PROXY_HOPS: 'true' });
      expect(result.status).to.equal(1);
      expect(result.stderr).to.match(/TRUST_PROXY_HOPS must be an integer between 0 and 10/);
    });
  });
});
