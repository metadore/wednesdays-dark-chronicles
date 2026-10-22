
import request from 'supertest';
import app from '../../src/app.js';
import prisma from '../../src/lib/prisma.js';
import { expect } from 'chai';

describe('Artifact Categories API', () => {
  before(async () => {
    await prisma.category.upsert({
      where: { slug: 'test-cat' },
      update: {},
      create: { name: 'Test Category', slug: 'test-cat' },
    });

    await prisma.artifact.create({
      data: {
        name: 'Published Artifact',
        slug: 'published-art-' + Date.now(),
        description: 'Published',
        published: true,
        categories: {
          create: { category: { connect: { slug: 'test-cat' } } },
        },
      },
    });

    await prisma.artifact.create({
      data: {
        name: 'Unpublished Artifact',
        slug: 'unpublished-art-' + Date.now(),
        description: 'Unpublished',
        published: false,
        categories: {
          create: { category: { connect: { slug: 'test-cat' } } },
        },
      },
    });
  });

  it('should return categories that have at least one published artifact', async () => {
    const res = await request(app).get('/api/categories/artifact-categories');
    expect(res.status).to.equal(200);
    expect(Array.isArray(res.body)).to.be.true;
    const testCat = res.body.find(c => c.slug === 'test-cat');
    expect(testCat).to.not.be.undefined;
  });

  it('should not return categories that only have unpublished artifacts', async () => {
    await prisma.category.upsert({
      where: { slug: 'hidden-cat' },
      update: {},
      create: { name: 'Hidden Category', slug: 'hidden-cat' },
    });
    await prisma.artifact.create({
      data: {
        name: 'Hidden Artifact',
        slug: 'hidden-art-' + Date.now(),
        description: 'Hidden',
        published: false,
        categories: {
          create: { category: { connect: { slug: 'hidden-cat' } } },
        },
      },
    });

    const res = await request(app).get('/api/categories/artifact-categories');
    const hiddenCat = res.body.find(c => c.slug === 'hidden-cat');
    expect(hiddenCat).to.be.undefined;
  });

  it('should preserve the original blog categories endpoint', async () => {
    const res = await request(app).get('/api/categories');
    expect(res.status).to.equal(200);
    expect(Array.isArray(res.body)).to.be.true;
  });
});
