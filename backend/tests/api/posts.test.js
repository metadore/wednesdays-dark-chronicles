import request from 'supertest';
import { expect } from 'chai';
import app from '../../src/app.js';
import prisma from '../../src/lib/prisma.js';

describe('GET /api/posts', () => {
  before(async () => {
    // Ensure there is at least one published post for testing
    await prisma.post.upsert({
      where: { slug: 'test-post' },
      update: { published: true },
      create: {
        title: 'Test Post',
        slug: 'test-post',
        content: 'Test content',
        published: true,
        publishedAt: new Date(),
      },
    });
  });

  after(async () => {
    await prisma.$disconnect();
  });

  it('should return published posts with pagination', async () => {
    const res = await request(app).get('/api/posts?page=1&limit=10');
    expect(res.status).to.equal(200);
    expect(res.body).to.have.property('data');
    expect(res.body).to.have.property('meta');
    expect(res.body.meta).to.have.property('total');
    expect(Array.isArray(res.body.data)).to.be.true;
  });

  it('should respect the limit parameter', async () => {
    const limit = 1;
    const res = await request(app).get(`/api/posts?page=1&limit=${limit}`);
    expect(res.status).to.equal(200);
    expect(res.body.data.length).to.be.at.most(limit);
  });
});
