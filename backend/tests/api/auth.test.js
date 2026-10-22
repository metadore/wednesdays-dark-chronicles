
import request from 'supertest';
import app from '../../src/app.js';
import prisma from '../../src/lib/prisma.js';
import { expect } from 'chai';
import jwt from 'jsonwebtoken';
import { config } from '../../src/config.js';
import { signAdminToken } from '../helpers/admin-token.js';

describe('Authentication Security', () => {
  let adminUser;

  before(async () => {
    adminUser = await prisma.user.upsert({
      where: { username: 'testadmin' },
      update: {},
      create: {
        username: 'testadmin',
        password: 'Password123!',
      },
    });
    const bcrypt = await import('bcryptjs');
    const hash = await bcrypt.hash('Password123!', 10);
    await prisma.user.update({
      where: { username: 'testadmin' },
      data: { password: hash },
    });
  });

  it('should reject malformed JWT tokens', async () => {
    const res = await request(app)
      .get('/api/admin/test-auth')
      .set('Cookie', 'auth_token=not-a-jwt')
      .send();
    expect(res.status).to.equal(401);
    expect(res.body.error).to.equal('Invalid or expired token');
  });

  it('should reject expired JWT tokens', async () => {
    const expiredToken = jwt.sign({ userId: '123' }, config.jwtSecret, { expiresIn: '-1s' });
    const res = await request(app)
      .get('/api/admin/test-auth')
      .set('Cookie', `auth_token=${expiredToken}`)
      .send();
    expect(res.status).to.equal(401);
  });

  it('should allow access to protected route with valid JWT', async () => {
    const token = signAdminToken(adminUser);
    const res = await request(app)
      .get('/api/admin/test-auth')
      .set('Cookie', `auth_token=${token}`)
      .send();
    expect(res.status).to.equal(200);
    expect(res.body.status).to.equal('ok');
  });

  it('should fail login with invalid credentials', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ username: 'testadmin', password: 'WrongPassword' });
    expect(res.status).to.equal(401);
  });
});
