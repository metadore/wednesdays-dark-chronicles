/**
 * Phase 10 token-revocation regression tests.
 *
 * The Phase 10 audit found that a logout only cleared the cookie: the JWT
 * itself stayed valid until it expired, so a token captured before the
 * logout kept working. The server now revokes the token at logout.
 *
 * The limits of that revocation are documented in
 * src/lib/token-revocation.js: the denylist lives in the process, so it is
 * not shared between instances and it does not survive a restart.
 */
import request from 'supertest';
import { expect } from 'chai';
import app from '../../src/app.js';
import prisma from '../../src/lib/prisma.js';
import bcrypt from 'bcryptjs';
import { clearRevocations, isRevoked, revoke } from '../../src/lib/token-revocation.js';
import { loginLimiter } from '../../src/routes/auth.routes.js';

describe('Phase 10: token revocation at logout', () => {
  const USERNAME = 'p10-revoke-admin';
  const PASSWORD = 'Password123!';

  beforeEach(async () => {
    // The login rate limiter allows five attempts per quarter hour per IP,
    // and the whole suite runs from one address. The counter is cleared so
    // that this file's own logins do not exhaust it.
    if (typeof loginLimiter.resetKey === 'function') {
      await loginLimiter.resetKey('::ffff:127.0.0.1');
      await loginLimiter.resetKey('127.0.0.1');
      await loginLimiter.resetKey('::1');
    }
  });

  before(async () => {
    await prisma.user.upsert({
      where: { username: USERNAME },
      update: {},
      create: { username: USERNAME, password: PASSWORD },
    });
    await prisma.user.update({
      where: { username: USERNAME },
      data: { password: await bcrypt.hash(PASSWORD, 10) },
    });
  });

  after(async () => {
    await prisma.user.deleteMany({ where: { username: USERNAME } });
    clearRevocations();
  });

  /**
   * Log in over the real endpoint and return the issued token.
   *
   * The CSRF token and the auth cookie must come from the SAME session: the
   * CSRF token is bound to the session cookie, so a token fetched by one
   * agent is refused by another. One agent is used throughout.
   */
  const login = async (agent) => {
    const res = await agent
      .post('/api/auth/login')
      .send({ username: USERNAME, password: PASSWORD });
    expect(res.status).to.equal(200);
    const cookie = (res.headers['set-cookie'] || []).find((c) => c.startsWith('auth_token='));
    expect(cookie, 'the login did not set an auth_token cookie').to.be.a('string');
    return {
      token: cookie.split(';')[0].split('=').slice(1).join('='),
      cookie: cookie.split(';')[0],
    };
  };

  describe('The issued token', () => {
    it('should carry a unique identifier so it can be revoked', async () => {
      const a = await login(request.agent(app));
      const b = await login(request.agent(app));

      const jtiOf = (token) => {
        const payload = JSON.parse(
          Buffer.from(token.split('.')[1], 'base64url').toString('utf8')
        );
        return payload.jti;
      };

      expect(jtiOf(a.token)).to.be.a('string');
      expect(jtiOf(a.token)).to.not.equal(jtiOf(b.token));
    });
  });

  describe('A logout', () => {
    it('should revoke the token that was used', async () => {
      const agent = request.agent(app);
      const { token, cookie } = await login(agent);

      // The token works before the logout.
      const before = await request(app)
        .get('/api/admin/test-auth')
        .set('Cookie', cookie);
      expect(before.status).to.equal(200);

      // Log out, presenting the token and a valid CSRF token.
      const csrfRes = await agent.get('/api/auth/csrf-token');
      const logout = await agent
        .post('/api/auth/logout')
        .set('Cookie', cookie)
        .set('x-csrf-token', csrfRes.body.token)
        .send({});
      expect(logout.status).to.equal(200);

      // The same token must no longer be accepted.
      const after = await request(app)
        .get('/api/admin/test-auth')
        .set('Cookie', cookie);
      expect(after.status).to.equal(401);
      expect(after.body.error).to.equal('Invalid or expired token');
      expect(token).to.be.a('string');
    });

    it('should clear the cookie with the attributes it was set with', async () => {
      const agent = request.agent(app);
      const { cookie } = await login(agent);
      const csrfRes = await agent.get('/api/auth/csrf-token');

      const logout = await agent
        .post('/api/auth/logout')
        .set('Cookie', cookie)
        .set('x-csrf-token', csrfRes.body.token)
        .send({});

      const setCookie = (logout.headers['set-cookie'] || []).find((c) =>
        c.startsWith('auth_token=')
      );
      expect(setCookie).to.be.a('string');
      // The cookie must be expired immediately.
      expect(setCookie).to.match(/Expires=Thu, 01 Jan 1970/i);
      // And it must carry the same attributes, or the browser keeps it.
      expect(setCookie).to.match(/Path=\//);
      expect(setCookie).to.match(/HttpOnly/i);
      expect(setCookie).to.match(/SameSite=Strict/i);
    });

    it('should refuse a logout that presents no session', async () => {
      const csrfRes = await request(app).get('/api/auth/csrf-token');
      const res = await request(app)
        .post('/api/auth/logout')
        .set('x-csrf-token', csrfRes.body.token)
        .send({});

      expect(res.status).to.equal(401);
    });
  });

  describe('The denylist', () => {
    it('should report a revoked token as revoked', () => {
      clearRevocations();
      const payload = { jti: 'probe-jti', exp: Math.floor(Date.now() / 1000) + 60 };
      expect(isRevoked(payload)).to.equal(false);
      revoke(payload);
      expect(isRevoked(payload)).to.equal(true);
    });

    it('should forget a token whose expiry has passed', () => {
      clearRevocations();
      const payload = { jti: 'expired-jti', exp: Math.floor(Date.now() / 1000) - 1 };
      revoke(payload);
      // An expired token is not kept in the denylist: it is refused anyway.
      expect(isRevoked(payload)).to.equal(false);
    });

    it('should ignore a payload without an identifier', () => {
      clearRevocations();
      expect(isRevoked({})).to.equal(false);
      expect(isRevoked(null)).to.equal(false);
      revoke({});
      expect(isRevoked({})).to.equal(false);
    });
  });
});
