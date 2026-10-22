import request from 'supertest';
import { expect } from 'chai';
import app from '../../src/app.js';
import prisma from '../../src/lib/prisma.js';
import jwt from 'jsonwebtoken';
import { config } from '../../src/config.js';
import { signAdminToken } from '../helpers/admin-token.js';

describe('Admin API Protected CRUD', () => {
  let agent;
  let adminToken;
  let testPost;
  let testCategory;

  before(async () => {
    agent = request.agent(app);

    // 1. Create a test admin user
    const admin = await prisma.user.upsert({
      where: { username: 'admin_test' },
      update: {},
      create: { username: 'admin_test', password: 'Password123!' },
    });
    adminToken = signAdminToken(admin);

    // 2. Setup a test category
    testCategory = await prisma.category.upsert({
      where: { slug: 'admin-test-cat' },
      update: {},
      create: { name: 'Admin Test Cat', slug: 'admin-test-cat' },
    });
  });

  describe('Authentication Guard', () => {
    const endpoints = [
      { method: 'get', url: '/api/admin/posts' },
      { method: 'post', url: '/api/admin/posts' },
      { method: 'get', url: '/api/admin/artifacts' },
      { method: 'post', url: '/api/admin/artifacts' },
      { method: 'get', url: '/api/admin/categories' },
    ];

    endpoints.forEach(({ method, url }) => {
      it(`should reject unauthenticated access to ${url}`, async () => {
        const res = await request(app)[method](url);
        expect(res.status).to.equal(401);
        expect(res.body.error).to.equal('Authentication required');
      });
    });
  });

  describe('Blog Post Administration', () => {
    it('should create a new blog post', async () => {
      const postData = {
        title: 'Admin Post',
        slug: 'admin-post-test',
        content: 'Admin content',
        categoryIds: [testCategory.id],
        published: false,
      };
      
      // Set Auth Token
      await agent.get('/api/health').set('Cookie', `auth_token=${adminToken}`);
      
      // Fetch CSRF Token
      const csrfRes = await agent.get('/api/auth/csrf-token');
      const token = csrfRes.body.token;
      
      const res = await agent
        .post('/api/admin/posts')
        .set('Cookie', `auth_token=${adminToken}`)
        .set('x-csrf-token', token)
        .send(postData);
      
      expect(res.status).to.equal(201);
      testPost = res.body;
    });

    it('should list all posts including unpublished', async () => {
      const res = await agent
        .get('/api/admin/posts')
        .set('Cookie', `auth_token=${adminToken}`);
      expect(res.status).to.equal(200);
      expect(res.body.some(p => p.id === testPost.id)).to.be.true;
    });

    it('should update a post', async () => {
      const updateData = { title: 'Updated Admin Post' };
      const csrfRes = await agent.get('/api/auth/csrf-token');
      const token = csrfRes.body.token;
      
      const res = await agent
        .put(`/api/admin/posts/${testPost.id}`)
        .set('Cookie', `auth_token=${adminToken}`)
        .set('x-csrf-token', token)
        .send(updateData);
      expect(res.status).to.equal(200);
      expect(res.body.title).to.equal('Updated Admin Post');
    });

    it('should toggle publication status', async () => {
      const csrfRes = await agent.get('/api/auth/csrf-token');
      const token = csrfRes.body.token;

      const res = await agent
        .patch(`/api/admin/posts/${testPost.id}/publish`)
        .set('Cookie', `auth_token=${adminToken}`)
        .set('x-csrf-token', token)
        .send({ published: true });
      expect(res.status).to.equal(200);
      expect(res.body.published).to.be.true;
    });

    it('should delete a post', async () => {
      const csrfRes = await agent.get('/api/auth/csrf-token');
      const token = csrfRes.body.token;

      const res = await agent
        .delete(`/api/admin/posts/${testPost.id}`)
        .set('Cookie', `auth_token=${adminToken}`)
        .set('x-csrf-token', token)
        .send();
      expect(res.status).to.equal(204);
    });
  });

  describe('Artifact Administration', async () => {
    it('should create a new artifact', async () => {
      const artData = {
        name: 'Admin Artifact',
        slug: 'admin-art-test-' + Date.now(),
        description: 'Admin description',
        categoryIds: [testCategory.id],
        published: false,
      };
      const csrfRes = await agent.get('/api/auth/csrf-token');
      const token = csrfRes.body.token;

      const res = await agent
        .post('/api/admin/artifacts')
        .set('Cookie', `auth_token=${adminToken}`)
        .set('x-csrf-token', token)
        .send(artData);
      expect(res.status).to.equal(201);
    });
  });

  describe('Category Administration', async () => {
    it('should create a new category', async () => {
      const catData = { name: 'New Admin Cat ' + Date.now(), slug: 'new-admin-cat-' + Date.now() };
      const csrfRes = await agent.get('/api/auth/csrf-token');
      const token = csrfRes.body.token;

      const res = await agent
        .post('/api/admin/categories')
        .set('Cookie', `auth_token=${adminToken}`)
        .set('x-csrf-token', token)
        .send(catData);
      expect(res.status).to.equal(201);
    });
  });

  describe('Cross-Session CSRF Rejection', () => {
    it('should reject a token generated by a different session', async () => {
      const otherAgent = request.agent(app);
      const csrfRes = await otherAgent.get('/api/auth/csrf-token');
      const otherToken = csrfRes.body.token;

      const res = await agent
        .post('/api/admin/posts')
        .set('Cookie', `auth_token=${adminToken}`)
        .set('x-csrf-token', otherToken)
        .send({ title: 'Hacker Post', slug: 'hacker', content: '...', categoryIds: [testCategory.id], published: false });
      
      expect(res.status).to.equal(403);
    });
  });
});
