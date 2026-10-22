/**
 * The inquiry (contact) system.
 *
 * The inquiry endpoint is public and anonymous, so it is the endpoint most
 * exposed to abuse. These tests cover the validation, the rate limit, the
 * privacy of the stored messages and the fact that a public request can
 * never read the inbox.
 */
import request from 'supertest';
import { expect } from 'chai';
import app from '../../src/app.js';
import prisma from '../../src/lib/prisma.js';
import { signAdminToken } from '../helpers/admin-token.js';
import { resetInquiryLimiter } from '../../src/routes/inquiry.routes.js';

/**
 * Submit an inquiry with a valid CSRF token.
 *
 * The inquiry endpoint is an anonymous write protected by the double-submit
 * pattern, exactly like the comment endpoint. The token and the session
 * cookie must come from the same agent, so one agent is used throughout.
 */
const submitInquiry = async (agent, body) => {
  const csrfRes = await agent.get('/api/auth/csrf-token');
  const token = csrfRes.body.token;
  return agent
    .post('/api/inquiries')
    .set('x-csrf-token', token)
    .send(body);
};

describe('The inquiry system', () => {
  let adminUser;
  let adminToken;

  before(async () => {
    // This file submits many inquiries from one address, which is exactly
    // what the rate limit is designed to stop. The limit is raised for the
    // whole file, and the rate limit itself is tested in its own case
    // below with an explicit, lowered limit.
    process.env.INQUIRY_RATE_LIMIT_MAX = '500';
    await resetInquiryLimiter('::ffff:127.0.0.1');
    await resetInquiryLimiter('127.0.0.1');

    adminUser = await prisma.user.upsert({
      where: { username: 'p10-inquiry-admin' },
      update: {},
      create: { username: 'p10-inquiry-admin', password: 'Password123!' },
    });
    adminToken = signAdminToken(adminUser);
  });

  after(async () => {
    await prisma.inquiry.deleteMany({ where: { email: { contains: '@p10-inquiry.test' } } });
    await prisma.inquiry.deleteMany({ where: { email: { contains: 'p10-inquiry.test' } } });
    await prisma.user.deleteMany({ where: { username: 'p10-inquiry-admin' } });
    delete process.env.INQUIRY_RATE_LIMIT_MAX;
    await resetInquiryLimiter('::ffff:127.0.0.1');
    await resetInquiryLimiter('127.0.0.1');
  });

  describe('Submitting an inquiry', () => {
    it('should accept a valid inquiry', async () => {
      const res = await submitInquiry(request.agent(app), {
        name: 'A Reader',
        email: 'reader@p10-inquiry.test',
        message: 'The darkness acknowledges your message.',
      });

      expect(res.status).to.equal(201);
      expect(res.body.message).to.be.a('string');
    });

    it('should require a name, an email and a message', async () => {
      for (const body of [
        {},
        { name: 'A' },
        { name: 'A', email: 'a@b.test' },
        { email: 'a@b.test', message: 'm' },
        { name: 'A', message: 'm' },
      ]) {
        const res = await submitInquiry(request.agent(app), body);
        expect(res.status, JSON.stringify(body)).to.equal(400);
      }
    });

    it('should reject an address that is not an email address', async () => {
      for (const email of ['not-an-email', 'no@domain', 'a@b', '@b.test', 'a b@c.test']) {
        const res = await submitInquiry(request.agent(app), {
          name: 'A',
          email,
          message: 'm',
        });
        expect(res.status, email).to.equal(400);
      }
    });

    it('should reject an over-long name, email or message', async () => {
      const res = await submitInquiry(request.agent(app), {
        name: 'x'.repeat(101),
        email: 'a@b.test',
        message: 'm',
      });
      expect(res.status).to.equal(400);

      const res2 = await submitInquiry(request.agent(app), {
        name: 'A',
        email: `${'x'.repeat(250)}@b.test`,
        message: 'm',
      });
      expect(res2.status).to.equal(400);

      const res3 = await submitInquiry(request.agent(app), {
        name: 'A',
        email: 'a@b.test',
        message: 'm'.repeat(5001),
      });
      expect(res3.status).to.equal(400);
    });

    it('should refuse a submission with no CSRF token', async () => {
      // The inquiry form is an anonymous write. Without the double-submit
      // token, a third party could make a visitor's browser file inquiries
      // on their behalf.
      const res = await request(app).post('/api/inquiries').send({
        name: 'A',
        email: 'nocsrf@p10-inquiry.test',
        message: 'm',
      });

      expect(res.status).to.equal(403);
    });

    it('should refuse a submission with an invalid CSRF token', async () => {
      const res = await request(app)
        .post('/api/inquiries')
        .set('x-csrf-token', 'not-a-real-token')
        .send({
          name: 'A',
          email: 'badcsrf@p10-inquiry.test',
          message: 'm',
        });

      expect(res.status).to.equal(403);
    });

    it('should refuse a submission with a token from another session', async () => {
      const otherAgent = request.agent(app);
      const csrfRes = await otherAgent.get('/api/auth/csrf-token');
      const otherToken = csrfRes.body.token;

      const agent = request.agent(app);
      await agent.get('/api/auth/csrf-token');

      const res = await agent
        .post('/api/inquiries')
        .set('x-csrf-token', otherToken)
        .send({
          name: 'A',
          email: 'othercsrf@p10-inquiry.test',
          message: 'm',
        });

      expect(res.status).to.equal(403);
    });

    it('should not echo the submitted message back to the sender', async () => {
      const res = await submitInquiry(request.agent(app), {
        name: 'A',
        email: 'echo@p10-inquiry.test',
        message: 'a secret message',
      });

      expect(res.status).to.equal(201);
      expect(JSON.stringify(res.body)).to.not.include('a secret message');
      expect(JSON.stringify(res.body)).to.not.include('echo@p10-inquiry.test');
    });
  });

  describe('The privacy of the inbox', () => {
    it('should refuse the inbox to an unauthenticated request', async () => {
      const res = await request(app).get('/api/inquiries/admin');
      expect(res.status).to.equal(401);
    });

    it('should refuse the inbox to a request with an invalid token', async () => {
      const res = await request(app)
        .get('/api/inquiries/admin')
        .set('Cookie', 'auth_token=not-a-jwt');
      expect(res.status).to.equal(401);
    });

    it('should refuse the inbox to a request with a token for no subject', async () => {
      const jwt = (await import('jsonwebtoken')).default;
      const { config } = await import('../../src/config.js');
      const token = jwt.sign(
        { role: 'admin' },
        config.jwtSecret,
        { expiresIn: '1h', issuer: config.jwtIssuer, audience: config.jwtAudience }
      );
      const res = await request(app)
        .get('/api/inquiries/admin')
        .set('Cookie', `auth_token=${token}`);
      expect(res.status).to.equal(401);
    });

    it('should give the inbox to an administrator', async () => {
      const res = await request(app)
        .get('/api/inquiries/admin')
        .set('Cookie', `auth_token=${adminToken}`);

      expect(res.status).to.equal(200);
      expect(res.body).to.be.an('array');
    });

    it('should never expose an inquiry through a public endpoint', async () => {
      // Submit one, then check that no public endpoint returns it.
      await submitInquiry(request.agent(app), {
        name: 'Private',
        email: 'private@p10-inquiry.test',
        message: 'a private message',
      });

      const publicEndpoints = [
        '/api/posts?limit=100',
        '/api/artifacts?limit=100',
        '/api/categories',
        '/api/stories',
        '/api/comments/00000000-0000-0000-0000-000000000000',
      ];

      for (const endpoint of publicEndpoints) {
        const res = await request(app).get(endpoint);
        const body = JSON.stringify(res.body || {});
        expect(body.includes('private@p10-inquiry.test'), endpoint).to.equal(false);
        expect(body.includes('a private message'), endpoint).to.equal(false);
      }
    });
  });

  describe('Abuse prevention', () => {
    it('should rate-limit repeated submissions from one address', async () => {
      // The limit is resolved per request, so a test can raise it rather
      // than exhausting the real budget.
      const previousMax = process.env.INQUIRY_RATE_LIMIT_MAX;
      process.env.INQUIRY_RATE_LIMIT_MAX = '3';

      try {
        // Clear the counter for this client before starting.
        await resetInquiryLimiter('::ffff:127.0.0.1');
        await resetInquiryLimiter('127.0.0.1');

        const email = 'flood@p10-inquiry.test';
        const statuses = [];
        for (let i = 0; i < 6; i += 1) {
          const res = await submitInquiry(request.agent(app), {
            name: 'Flood',
            email,
            message: `message ${i}`,
          });
          statuses.push(res.status);
        }

        expect(statuses.slice(0, 3), 'the first requests should be accepted').to.deep.equal([201, 201, 201]);
        expect(statuses.slice(3), 'the later requests should be limited').to.deep.equal([429, 429, 429]);
      } finally {
        if (previousMax === undefined) delete process.env.INQUIRY_RATE_LIMIT_MAX;
        else process.env.INQUIRY_RATE_LIMIT_MAX = previousMax;
        await resetInquiryLimiter('::ffff:127.0.0.1');
        await resetInquiryLimiter('127.0.0.1');
      }
    });
  });
});
