/**
 * Phase 10 security regression tests.
 *
 * Each test here corresponds to a defect that was found by the Phase 10
 * audit and fixed. They exist so the defect cannot come back.
 */
import request from 'supertest';
import { expect } from 'chai';
import jwt from 'jsonwebtoken';
import app from '../../src/app.js';
import prisma from '../../src/lib/prisma.js';
import { config } from '../../src/config.js';
import { signAdminToken } from '../helpers/admin-token.js';

describe('Phase 10 security regressions', () => {
  let adminUser;
  let adminToken;
  let agent;

  before(async () => {
    adminUser = await prisma.user.upsert({
      where: { username: 'p10-security-admin' },
      update: {},
      create: { username: 'p10-security-admin', password: 'Password123!' },
    });
    const bcrypt = await import('bcryptjs');
    await prisma.user.update({
      where: { username: 'p10-security-admin' },
      data: { password: await bcrypt.hash('Password123!', 10) },
    });
    adminToken = signAdminToken(adminUser);
    agent = request.agent(app);
  });

  after(async () => {
    await prisma.user.deleteMany({ where: { username: 'p10-security-admin' } });
  });

  describe('CORS: the wildcard must never be combined with credentials', () => {
    it('should not send Access-Control-Allow-Origin: * on a request with an Origin', async () => {
      const res = await request(app)
        .get('/api/health')
        .set('Origin', 'https://evil.example');

      const allowOrigin = res.headers['access-control-allow-origin'];
      expect(allowOrigin).to.not.equal('*');
    });

    it('should not send a wildcard alongside Allow-Credentials: true', async () => {
      const res = await request(app)
        .get('/api/health')
        .set('Origin', 'https://evil.example');

      const allowOrigin = res.headers['access-control-allow-origin'];
      const allowCredentials = res.headers['access-control-allow-credentials'];
      // The two must never appear together.
      expect(allowOrigin === '*' && allowCredentials === 'true').to.equal(false);
    });

    it('should not answer a preflight for an unknown origin with a wildcard', async () => {
      const res = await request(app)
        .options('/api/posts')
        .set('Origin', 'https://evil.example')
        .set('Access-Control-Request-Method', 'GET');

      expect(res.headers['access-control-allow-origin']).to.not.equal('*');
    });
  });

  describe('JWT: the token must be bound to this application', () => {
    it('should reject a token with the wrong issuer', async () => {
      const token = jwt.sign(
        { userId: adminUser.id },
        config.jwtSecret,
        { expiresIn: '1h', issuer: 'some-other-service', audience: config.jwtAudience }
      );
      const res = await request(app)
        .get('/api/admin/test-auth')
        .set('Cookie', `auth_token=${token}`);
      expect(res.status).to.equal(401);
    });

    it('should reject a token with the wrong audience', async () => {
      const token = jwt.sign(
        { userId: adminUser.id },
        config.jwtSecret,
        { expiresIn: '1h', issuer: config.jwtIssuer, audience: 'some-other-client' }
      );
      const res = await request(app)
        .get('/api/admin/test-auth')
        .set('Cookie', `auth_token=${token}`);
      expect(res.status).to.equal(401);
    });

    it('should reject a token with no subject', async () => {
      const token = jwt.sign(
        { role: 'admin' },
        config.jwtSecret,
        { expiresIn: '1h', issuer: config.jwtIssuer, audience: config.jwtAudience }
      );
      const res = await request(app)
        .get('/api/admin/test-auth')
        .set('Cookie', `auth_token=${token}`);
      expect(res.status).to.equal(401);
    });

    it('should reject a token for an administrator that no longer exists', async () => {
      const token = signAdminToken({ id: '00000000-0000-0000-0000-000000000000' });
      const res = await request(app)
        .get('/api/admin/test-auth')
        .set('Cookie', `auth_token=${token}`);
      expect(res.status).to.equal(401);
    });

    it('should reject an unsigned token', async () => {
      const token =
        Buffer.from(JSON.stringify({ userId: adminUser.id, alg: 'none', typ: 'JWT' })).toString(
          'base64url'
        ) + '.';
      const res = await request(app)
        .get('/api/admin/test-auth')
        .set('Cookie', `auth_token=${token}`);
      expect(res.status).to.equal(401);
    });

    it('should never expose the password hash through the auth guard', async () => {
      const res = await request(app)
        .get('/api/admin/test-auth')
        .set('Cookie', `auth_token=${adminToken}`);
      expect(res.status).to.equal(200);
      expect(res.body).to.not.have.property('password');
      expect(JSON.stringify(res.body)).to.not.include('$2');
    });
  });

  describe('Internal errors must not leak to the client', () => {
    it('should not return the raw Prisma error message for a server error', async () => {
      // A category id that is not a valid UUID makes Prisma throw deep in
      // the client, and the raw message names the model, the field and the
      // argument it choked on.
      const res = await agent
        .post('/api/admin/posts')
        .set('Cookie', `auth_token=${adminToken}`)
        .set('x-csrf-token', (await agent.get('/api/auth/csrf-token')).body.token)
        .send({
          title: 'x',
          slug: `p10-internal-${Date.now()}`,
          content: 'c',
          categoryIds: ['not-a-uuid'],
        });

      expect(res.status).to.be.at.least(400);
      const body = JSON.stringify(res.body);
      expect(body).to.not.include('prisma.post.create');
      expect(body).to.not.include('Invalid `prisma');
      // The response must still be useful.
      expect(res.body).to.have.property('message');
    });

    it('should include a reference the server log can be searched with', async () => {
      const res = await agent
        .post('/api/admin/posts')
        .set('Cookie', `auth_token=${adminToken}`)
        .set('x-csrf-token', (await agent.get('/api/auth/csrf-token')).body.token)
        .send({
          title: 'x',
          slug: `p10-internal-${Date.now()}`,
          content: 'c',
          categoryIds: ['not-a-uuid'],
        });

      expect(res.body).to.have.property('reference');
      expect(res.body.reference).to.be.a('string');
    });
  });

  describe('Publication flags must be real booleans', () => {
    it('should reject the string "false" as a publication flag on create', async () => {
      const res = await agent
        .post('/api/admin/posts')
        .set('Cookie', `auth_token=${adminToken}`)
        .set('x-csrf-token', (await agent.get('/api/auth/csrf-token')).body.token)
        .send({ title: 'Coercion', slug: 'p10-coercion-create', content: 'c', published: 'false' });

      expect(res.status).to.equal(400);
      expect(res.body.error).to.equal('Published must be a boolean');
    });

    it('should reject the string "true" as a publication flag on publish', async () => {
      const post = await prisma.post.create({
        data: { title: 'Coercion', slug: `p10-coercion-${Date.now()}`, content: 'c', published: false },
      });
      const res = await agent
        .patch(`/api/admin/posts/${post.id}/publish`)
        .set('Cookie', `auth_token=${adminToken}`)
        .set('x-csrf-token', (await agent.get('/api/auth/csrf-token')).body.token)
        .send({ published: 'true' });

      expect(res.status).to.equal(400);
      await prisma.post.delete({ where: { id: post.id } });
    });

    it('should treat a missing publication flag as unpublished on create', async () => {
      const slug = `p10-unpublished-${Date.now()}`;
      const res = await agent
        .post('/api/admin/posts')
        .set('Cookie', `auth_token=${adminToken}`)
        .set('x-csrf-token', (await agent.get('/api/auth/csrf-token')).body.token)
        .send({ title: 'No flag', slug, content: 'c' });

      expect(res.status).to.equal(201);
      expect(res.body.published).to.equal(false);
      expect(res.body.publishedAt).to.equal(null);
      await prisma.post.delete({ where: { slug } });
    });
  });

  describe('Slugs must be safe to place in a URL and in an attribute', () => {
    const badSlugs = [
      'has space',
      'Has-Capitals',
      'has"quote',
      "has'quote",
      'has<script>',
      'has/slash',
      'double--hyphen',
      '-leading',
      'trailing-',
    ];

    for (const slug of badSlugs) {
      it(`should reject the slug ${JSON.stringify(slug)}`, async () => {
        const res = await agent
          .post('/api/admin/posts')
          .set('Cookie', `auth_token=${adminToken}`)
          .set('x-csrf-token', (await agent.get('/api/auth/csrf-token')).body.token)
          .send({ title: 'Bad slug', slug, content: 'c' });

        expect(res.status).to.equal(400);
        expect(res.body.error).to.match(/Slug/);
      });
    }

    it('should reject a bad slug on an artifact', async () => {
      const res = await agent
        .post('/api/admin/artifacts')
        .set('Cookie', `auth_token=${adminToken}`)
        .set('x-csrf-token', (await agent.get('/api/auth/csrf-token')).body.token)
        .send({ name: 'Bad', slug: 'has"quote', description: 'd' });

      expect(res.status).to.equal(400);
    });

    it('should reject a bad slug on a category', async () => {
      const res = await agent
        .post('/api/admin/categories')
        .set('Cookie', `auth_token=${adminToken}`)
        .set('x-csrf-token', (await agent.get('/api/auth/csrf-token')).body.token)
        .send({ name: 'Bad', slug: 'has"quote' });

      expect(res.status).to.equal(400);
    });
  });

  describe('URLs must not carry a script scheme', () => {
    it('should reject a javascript: cover image URL', async () => {
      const res = await agent
        .post('/api/admin/posts')
        .set('Cookie', `auth_token=${adminToken}`)
        .set('x-csrf-token', (await agent.get('/api/auth/csrf-token')).body.token)
        .send({
          title: 'Scheme',
          slug: `p10-scheme-${Date.now()}`,
          content: 'c',
          coverImageUrl: 'javascript:alert(1)',
        });

      expect(res.status).to.equal(400);
      expect(res.body.error).to.match(/http or https/);
    });

    it('should reject a data: file URL on an artifact', async () => {
      const res = await agent
        .post('/api/admin/artifacts')
        .set('Cookie', `auth_token=${adminToken}`)
        .set('x-csrf-token', (await agent.get('/api/auth/csrf-token')).body.token)
        .send({
          name: 'Scheme',
          slug: `p10-scheme-${Date.now()}`,
          description: 'd',
          fileUrl: 'data:text/html,<script>alert(1)</script>',
        });

      expect(res.status).to.equal(400);
    });

    it('should accept a normal https image URL', async () => {
      const slug = `p10-https-${Date.now()}`;
      const res = await agent
        .post('/api/admin/posts')
        .set('Cookie', `auth_token=${adminToken}`)
        .set('x-csrf-token', (await agent.get('/api/auth/csrf-token')).body.token)
        .send({ title: 'Https', slug, content: 'c', coverImageUrl: 'https://example.com/a.jpg' });

      expect(res.status).to.equal(201);
      await prisma.post.delete({ where: { slug } });
    });
  });

  describe('A partial update must not blank the fields it was not given', () => {
    it('should keep the publication date when a published post is edited', async () => {
      const slug = `p10-publishedat-${Date.now()}`;
      const created = await prisma.post.create({
        data: {
          title: 'Keep date',
          slug,
          content: 'c',
          published: true,
          publishedAt: new Date('2020-01-01T00:00:00.000Z'),
        },
      });
      const originalPublishedAt = created.publishedAt;

      const res = await agent
        .put(`/api/admin/posts/${created.id}`)
        .set('Cookie', `auth_token=${adminToken}`)
        .set('x-csrf-token', (await agent.get('/api/auth/csrf-token')).body.token)
        .send({ title: 'A new title' });

      expect(res.status).to.equal(200);
      expect(res.body.title).to.equal('A new title');
      // The publication flag and its date are untouched.
      expect(res.body.published).to.equal(true);
      expect(new Date(res.body.publishedAt).toISOString()).to.equal(
        new Date(originalPublishedAt).toISOString()
      );
      await prisma.post.delete({ where: { id: created.id } });
    });

    it('should keep the slug when only the title is edited', async () => {
      const slug = `p10-keepslug-${Date.now()}`;
      const created = await prisma.post.create({
        data: { title: 'Keep slug', slug, content: 'c', published: false },
      });

      const res = await agent
        .put(`/api/admin/posts/${created.id}`)
        .set('Cookie', `auth_token=${adminToken}`)
        .set('x-csrf-token', (await agent.get('/api/auth/csrf-token')).body.token)
        .send({ title: 'Another title' });

      expect(res.status).to.equal(200);
      expect(res.body.slug).to.equal(slug);
      await prisma.post.delete({ where: { id: created.id } });
    });

    it('should keep the publication state when only the title is edited', async () => {
      const slug = `p10-keepstate-${Date.now()}`;
      const created = await prisma.post.create({
        data: { title: 'Keep state', slug, content: 'c', published: true, publishedAt: new Date() },
      });

      const res = await agent
        .put(`/api/admin/posts/${created.id}`)
        .set('Cookie', `auth_token=${adminToken}`)
        .set('x-csrf-token', (await agent.get('/api/auth/csrf-token')).body.token)
        .send({ title: 'Yet another title' });

      expect(res.status).to.equal(200);
      expect(res.body.published).to.equal(true);
      await prisma.post.delete({ where: { id: created.id } });
    });
  });

  describe('A public request must never be able to act as an administrator', () => {
    it('should ignore a role field supplied in the request body', async () => {
      const res = await agent
        .post('/api/admin/posts')
        .set('x-csrf-token', (await agent.get('/api/auth/csrf-token')).body.token)
        .send({ title: 'x', slug: 'x-role-probe', content: 'c', role: 'admin', isAdmin: true });

      expect(res.status).to.equal(401);
    });

    it('should reject a forged admin cookie with a manipulated payload', async () => {
      const token = jwt.sign(
        { userId: adminUser.id, role: 'admin', isAdmin: true },
        'not-the-real-secret',
        { expiresIn: '1h' }
      );
      const res = await request(app)
        .get('/api/admin/test-auth')
        .set('Cookie', `auth_token=${token}`);
      expect(res.status).to.equal(401);
    });
  });
});
