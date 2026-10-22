import request from 'supertest';
import { expect } from 'chai';
import app from '../../src/app.js';
import prisma from '../../src/lib/prisma.js';

describe('Blog API Comprehensive Tests', () => {
  const TEST_CATEGORY = { name: 'Test Cat', slug: 'test-cat' };
  const TEST_POST = {
    title: 'Test Blog Post',
    slug: 'test-blog-post',
    content: 'This is the test content with some keywords.',
    published: true,
    publishedAt: new Date(),
  };
  const UNPUBLISHED_POST = {
    title: 'Secret Post',
    slug: 'secret-post',
    content: 'Secret content',
    published: false,
  };

  before(async () => {
    // Create category
    const cat = await prisma.category.upsert({
      where: { slug: TEST_CATEGORY.slug },
      update: {},
      create: TEST_CATEGORY,
    });

    // Create published post
    const post = await prisma.post.upsert({
      where: { slug: TEST_POST.slug },
      update: { published: true },
      create: TEST_POST,
    });

    // Link post to category
    await prisma.postCategory.upsert({
      where: {
        postId_categoryId: { postId: post.id, categoryId: cat.id },
      },
      update: {},
      create: { postId: post.id, categoryId: cat.id },
    });

    // Create unpublished post
    await prisma.post.upsert({
      where: { slug: UNPUBLISHED_POST.slug },
      update: { published: false },
      create: UNPUBLISHED_POST,
    });
  });

  after(async () => {
    await prisma.$disconnect();
  });

  describe('GET /api/posts', () => {
    it('should filter by search query q', async () => {
      const res = await request(app).get('/api/posts?q=keywords');
      expect(res.status).to.equal(200);
      expect(res.body.data.some(p => p.slug === TEST_POST.slug)).to.be.true;
    });

    it('should filter by category slug', async () => {
      const res = await request(app).get(`/api/posts?category=${TEST_CATEGORY.slug}`);
      expect(res.status).to.equal(200);
      expect(res.body.data.some(p => p.slug === TEST_POST.slug)).to.be.true;
    });

    it('should enforce maximum limit of 50', async () => {
      const res = await request(app).get('/api/posts?limit=100');
      expect(res.status).to.equal(200);
      expect(res.body.meta.limit).to.equal(50);
    });

    it('should handle invalid pagination params gracefully', async () => {
      const res = await request(app).get('/api/posts?page=-1&limit=0');
      expect(res.status).to.equal(200);
      expect(res.body.meta.page).to.equal(1);
      expect(res.body.meta.limit).to.equal(10);
    });

    it('should not return unpublished posts', async () => {
      const res = await request(app).get('/api/posts');
      expect(res.body.data.some(p => p.slug === UNPUBLISHED_POST.slug)).to.be.false;
    });
  });

  describe('GET /api/posts/:slug', () => {
    it('should return a published post by slug', async () => {
      const res = await request(app).get(`/api/posts/${TEST_POST.slug}`);
      expect(res.status).to.equal(200);
      expect(res.body.slug).to.equal(TEST_POST.slug);
      expect(res.body.published).to.be.true;
    });

    it('should return 404 for unknown slugs', async () => {
      const res = await request(app).get('/api/posts/does-not-exist');
      expect(res.status).to.equal(404);
    });

    it('should return 404 for unpublished posts', async () => {
      const res = await request(app).get(`/api/posts/${UNPUBLISHED_POST.slug}`);
      expect(res.status).to.equal(404);
    });
  });

  describe('GET /api/categories', () => {
    it('should return categories that have published posts', async () => {
      const res = await request(app).get('/api/categories');
      expect(res.status).to.equal(200);
      expect(Array.isArray(res.body)).to.be.true;
      expect(res.body.some(c => c.slug === TEST_CATEGORY.slug)).to.be.true;
    });
  });
});
