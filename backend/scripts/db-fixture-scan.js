/**
 * Read-only: find rows in the live DB that look like they were created by a
 * browser-verification session (rather than by the seed or the API test suite).
 * Usage: node scripts/db-fixture-scan.js <live|test> [sinceISO]
 */
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { PrismaClient } from '@prisma/client';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const target = process.argv[2] === 'live' ? 'live' : 'test';
const since = process.argv[3] ? new Date(process.argv[3]) : new Date('2026-10-20T00:00:00Z');

const envPath = target === 'test'
  ? path.resolve(__dirname, '..', '.env.test')
  : path.resolve(__dirname, '..', '.env');

dotenv.config({ path: envPath, override: true });
if (process.env.DATABASE_URL?.includes('${')) {
  process.env.DATABASE_URL = process.env.DATABASE_URL.replace(
    /\$\{([A-Z0-9_]+)\}/g, (_, n) => process.env[n] ?? ''
  );
}

const prisma = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL } } });

const fmt = (d) => d.toISOString();

(async () => {
  console.log(`target=${target} since=${fmt(since)}\n`);

  const posts = await prisma.post.findMany({
    where: { createdAt: { gte: since } },
    select: { id: true, slug: true, title: true, published: true, createdAt: true },
  });
  console.log('POSTS created since:');
  for (const p of posts) console.log(`  ${fmt(p.createdAt)} ${p.published ? 'PUB ' : 'DRAFT'} ${p.slug} | ${p.title} | ${p.id}`);

  const artifacts = await prisma.artifact.findMany({
    where: { createdAt: { gte: since } },
    select: { id: true, slug: true, name: true, published: true, createdAt: true },
  });
  console.log('\nARTIFACTS created since:');
  for (const a of artifacts) console.log(`  ${fmt(a.createdAt)} ${a.published ? 'PUB ' : 'DRAFT'} ${a.slug} | ${a.name} | ${a.id}`);

  const catList = await prisma.category.findMany({
    select: { id: true, slug: true, name: true },
    orderBy: { slug: 'asc' },
  });
  console.log('\nCATEGORIES (all):');
  for (const c of catList) console.log(`  ${c.slug} | ${c.name} | ${c.id}`);

  const users = await prisma.user.findMany({
    select: { id: true, username: true, createdAt: true },
    orderBy: { createdAt: 'asc' },
  });
  console.log('\nUSERS:');
  for (const u of users) console.log(`  ${fmt(u.createdAt)} ${u.username} | ${u.id}`);

  const inquiries = await prisma.inquiry.findMany({
    orderBy: { createdAt: 'asc' },
  });
  console.log('\nINQUIRIES:');
  for (const i of inquiries) console.log(`  ${fmt(i.createdAt)} ${i.name} <${i.email}> ${i.message.slice(0, 60)} | ${i.id}`);

  const comments = await prisma.comment.findMany({
    orderBy: { createdAt: 'asc' },
  });
  console.log('\nCOMMENTS:');
  for (const c of comments) console.log(`  ${fmt(c.createdAt)} ${c.status} "${c.author}" "${c.content.slice(0, 50)}" post=${c.postId} parent=${c.parentId || '-'} | ${c.id}`);

  await prisma.$disconnect();
})().catch(async (e) => {
  console.error('ERROR:', e.message);
  await prisma.$disconnect();
  process.exit(1);
});
