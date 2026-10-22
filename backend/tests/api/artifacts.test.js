import request from 'supertest';
import { expect } from 'chai';
import app from '../../src/app.js';
import prisma from '../../src/lib/prisma.js';

describe('Vault API Comprehensive Tests', () => {
  const TEST_CATEGORY = { name: 'Vault Cat', slug: 'vault-cat' };
  const TEST_ARTIFACT = {
    name: 'Test Artifact',
    slug: 'test-artifact',
    description: 'This is a test artifact description with keywords.',
    imageUrl: 'http://example.com/image.jpg',
    published: true,
  };
  const UNPUBLISHED_ARTIFACT = {
    name: 'Secret Artifact',
    slug: 'secret-artifact',
    description: 'Secret content',
    published: false,
  };

  before(async () => {
    const cat = await prisma.category.upsert({
      where: { slug: TEST_CATEGORY.slug },
      update: {},
      create: TEST_CATEGORY,
    });

    await prisma.artifact.deleteMany({ where: { slug: TEST_ARTIFACT.slug } });
    const art = await prisma.artifact.create({
      data: {
        ...TEST_ARTIFACT,
      },
    });

    await prisma.artifactCategory.upsert({
      where: {
        artifactId_categoryId: { artifactId: art.id, categoryId: cat.id },
      },
      update: {},
      create: { artifactId: art.id, categoryId: cat.id },
    });

    await prisma.artifact.upsert({
      where: { slug: UNPUBLISHED_ARTIFACT.slug },
      update: { published: false },
      create: UNPUBLISHED_ARTIFACT,
    });
  });

  after(async () => {
    await prisma.$disconnect();
  });

  describe('GET /api/artifacts', () => {
    it('should list only published artifacts', async () => {
      const res = await request(app).get('/api/artifacts?limit=100');
      expect(res.status).to.equal(200);
      expect(res.body.data.some(a => a.slug === TEST_ARTIFACT.slug)).to.be.true;
      expect(res.body.data.some(a => a.slug === UNPUBLISHED_ARTIFACT.slug)).to.be.false;
    });

    it('should filter by search query q', async () => {
      const res = await request(app).get('/api/artifacts?q=keywords');
      expect(res.status).to.equal(200);
      expect(res.body.data.some(a => a.slug === TEST_ARTIFACT.slug)).to.be.true;
    });

    it('should filter by category slug', async () => {
      const res = await request(app).get(`/api/artifacts?category=${TEST_CATEGORY.slug}`);
      expect(res.status).to.equal(200);
      expect(res.body.data.some(a => a.slug === TEST_ARTIFACT.slug)).to.be.true;
    });

    it('should enforce maximum limit of 50', async () => {
      const res = await request(app).get('/api/artifacts?limit=100');
      expect(res.status).to.equal(200);
      expect(res.body.meta.limit).to.equal(50);
    });

    it('should handle invalid pagination params', async () => {
      const res = await request(app).get('/api/artifacts?page=-1&limit=0');
      expect(res.status).to.equal(200);
      expect(res.body.meta.page).to.equal(1);
      expect(res.body.meta.limit).to.equal(10);
    });
  });

  describe('GET /api/artifacts/:slug', () => {
    it('should return a published artifact by slug', async () => {
      const res = await request(app).get(`/api/artifacts/${TEST_ARTIFACT.slug}`);
      expect(res.status).to.equal(200);
      expect(res.body.slug).to.equal(TEST_ARTIFACT.slug);
    });

    it('should return 404 for unknown slugs', async () => {
      const res = await request(app).get('/api/artifacts/non-existent');
      expect(res.status).to.equal(404);
    });

    it('should return 404 for unpublished artifacts', async () => {
      const res = await request(app).get(`/api/artifacts/${UNPUBLISHED_ARTIFACT.slug}`);
      expect(res.status).to.equal(404);
    });
  });
});
