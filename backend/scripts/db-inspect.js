/**
 * Read-only inspection helper for Phase 8.1 verification.
 * Usage: node scripts/db-inspect.js <live|test>
 * Prints row counts and identifying details. Performs no writes.
 */
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { PrismaClient } from '@prisma/client';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const target = process.argv[2] === 'live' ? 'live' : 'test';

const envPath = target === 'test'
  ? path.resolve(__dirname, '..', '.env.test')
  : path.resolve(__dirname, '..', '.env');

dotenv.config({ path: envPath, override: true });

// `.env` stores DATABASE_URL with `${VAR}` placeholders that dotenv does not
// expand, so interpolate them against the loaded environment.
if (process.env.DATABASE_URL && process.env.DATABASE_URL.includes('${')) {
  process.env.DATABASE_URL = process.env.DATABASE_URL.replace(
    /\$\{([A-Z0-9_]+)\}/g,
    (_, name) => process.env[name] ?? ''
  );
}

if (!process.env.DATABASE_URL) {
  console.error(`No DATABASE_URL resolved for target "${target}".`);
  process.exit(1);
}

const prisma = new PrismaClient({
  datasources: { db: { url: process.env.DATABASE_URL } },
});

const maskUrl = (u) => u.replace(/\/\/([^:]+):[^@]*@/, '//$1:***@');

(async () => {
  console.log(`TARGET=${target}`);
  console.log(`URL=${maskUrl(process.env.DATABASE_URL)}`);
  console.log('');

  const [posts, artifacts, categories, users, inquiries, comments] = await Promise.all([
    prisma.post.count(),
    prisma.artifact.count(),
    prisma.category.count(),
    prisma.user.count(),
    prisma.inquiry.count(),
    prisma.comment.count(),
  ]);

  console.log(`posts=${posts} artifacts=${artifacts} categories=${categories} users=${users} inquiries=${inquiries} comments=${comments}`);

  console.log('\n--- POSTS ---');
  const allPosts = await prisma.post.findMany({
    select: { id: true, slug: true, title: true, published: true, createdAt: true },
    orderBy: { createdAt: 'asc' },
  });
  for (const p of allPosts) {
    console.log(`${p.published ? 'PUB ' : 'DRAFT'} ${p.slug} | ${p.title} | ${p.id} | ${p.createdAt.toISOString()}`);
  }

  console.log('\n--- USERS ---');
  const allUsers = await prisma.user.findMany({ select: { id: true, username: true, createdAt: true } });
  for (const u of allUsers) {
    console.log(`${u.username} | ${u.id} | ${u.createdAt.toISOString()}`);
  }

  console.log('\n--- INQUIRIES ---');
  const allInq = await prisma.inquiry.findMany({
    select: { id: true, name: true, email: true, message: true, createdAt: true },
    orderBy: { createdAt: 'asc' },
  });
  for (const i of allInq) {
    console.log(`${i.createdAt.toISOString()} | ${i.name} | ${i.email} | ${i.message.replace(/\s+/g, ' ').slice(0, 90)} | ${i.id}`);
  }

  console.log('\n--- COMMENTS ---');
  const allComments = await prisma.comment.findMany({
    select: { id: true, postId: true, parentId: true, author: true, content: true, status: true, createdAt: true },
    orderBy: { createdAt: 'asc' },
  });
  for (const c of allComments) {
    console.log(`${c.createdAt.toISOString()} | ${c.status.padEnd(8)} | author=${JSON.stringify(c.author)} | ${JSON.stringify(c.content.slice(0, 70))} | post=${c.postId} | parent=${c.parentId || '-'} | ${c.id}`);
  }

  console.log('\n--- ARTIFACTS ---');
  const allArt = await prisma.artifact.findMany({
    select: { id: true, slug: true, name: true, published: true },
    orderBy: { slug: 'asc' },
  });
  for (const a of allArt) {
    console.log(`${a.published ? 'PUB ' : 'DRAFT'} ${a.slug} | ${a.name} | ${a.id}`);
  }

  console.log('\n--- CATEGORIES ---');
  const allCat = await prisma.category.findMany({ select: { id: true, slug: true, name: true } });
  for (const c of allCat) {
    console.log(`${c.slug} | ${c.name} | ${c.id}`);
  }

  await prisma.$disconnect();
})().catch(async (e) => {
  console.error('ERROR:', e.message);
  await prisma.$disconnect();
  process.exit(1);
});
