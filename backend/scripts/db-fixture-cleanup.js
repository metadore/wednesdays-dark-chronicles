/**
 * Phase 8.1 — targeted cleanup of browser-verification fixtures.
 *
 * Removes ONLY the rows that are positively identified as created by the
 * Phase 8.1 browser verification session. Every deletion is guarded by an
 * explicit identifier (slug / author / message), so pre-existing posts,
 * artifacts, categories, comments, inquiries and administrator accounts are
 * never touched.
 *
 * Usage: node scripts/db-fixture-cleanup.js <live|test> [--dry-run]
 */
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const backendDir = path.resolve(__dirname, '..');

const { loadTestEnv, isTestEnv } = await import(
  pathToFileURL(path.join(backendDir, 'src', 'lib', 'test-env.js')).href
);
loadTestEnv();

const { PrismaClient } = await import('@prisma/client');
const prisma = new PrismaClient({
  datasources: process.env.DATABASE_URL
    ? { db: { url: process.env.DATABASE_URL } }
    : undefined,
});

const target = process.argv[2] === 'live' ? 'live' : 'test';
const dryRun = process.argv.includes('--dry-run');

/**
 * Every fixture created during the Phase 8.1 browser verification, by the
 * exact identifier it was created with.
 */
const FIXTURES = {
  // The article the browser session used as the subject of the séance.
  // Created by the previous session (2026-10-20 15:56Z) and reused here.
  postSlugs: ['browser-verify-81-post'],

  // Comment authors used by the browser sessions.
  // 'Approved Abigail' and 'Reply Rupert' were seeded directly onto the
  // browser-verify post by the previous session; the rest were submitted
  // through the public form in this or the previous session.
  commentAuthors: [
    'Approved Abigail',
    'Reply Rupert',
    'Browser Top Level',
    'Browser Reply Tester',
    'Browser Tester',
    'Mobile Tester',
    'Final Check',
    'Phase 8.2 Check',
  ],

  // The inquiry created to exercise the admin Messages inbox.
  inquiryEmails: ['browser.tester@example.com'],

  // Inquiries created during the Phase 8.2 contact-form verification.
  inquiryEmailsPhase82: [
    'phase82.tester@example.com',
    'dup.guard@example.com',
  ],
};

const plan = [];

(async () => {
  console.log(`target=${target} dryRun=${dryRun}`);
  console.log(`db=${(process.env.DATABASE_URL || '').replace(/\/\/([^:]+):[^@]*@/, '//$1:***@')}`);
  console.log('');

  // --- Posts -----------------------------------------------------------
  for (const slug of FIXTURES.postSlugs) {
    const found = await prisma.post.findMany({
      where: { slug },
      select: { id: true, slug: true, title: true, published: true },
    });
    for (const p of found) {
      plan.push({ type: 'post', id: p.id, label: `${p.slug} (${p.title})` });
    }
  }

  // --- Comments --------------------------------------------------------
  for (const author of FIXTURES.commentAuthors) {
    const found = await prisma.comment.findMany({
      where: { author },
      select: { id: true, author: true, content: true, status: true, postId: true },
    });
    for (const c of found) {
      plan.push({
        type: 'comment',
        id: c.id,
        label: `${c.status} "${c.author}" "${c.content.slice(0, 48)}"`,
      });
    }
  }

  // --- Inquiries -------------------------------------------------------
  for (const email of [...FIXTURES.inquiryEmails, ...FIXTURES.inquiryEmailsPhase82]) {
    const found = await prisma.inquiry.findMany({
      where: { email },
      select: { id: true, name: true, email: true, message: true },
    });
    for (const i of found) {
      plan.push({ type: 'inquiry', id: i.id, label: `${i.name} <${i.email}> "${i.message.slice(0, 48)}"` });
    }
  }

  if (plan.length === 0) {
    console.log('No Phase 8.1 browser fixtures found. Nothing to remove.');
    await prisma.$disconnect();
    return;
  }

  console.log('Fixtures to remove:');
  for (const p of plan) console.log(`  ${p.type.padEnd(9)} ${p.id}  ${p.label}`);
  console.log('');

  if (dryRun) {
    console.log('DRY RUN — nothing was deleted.');
    await prisma.$disconnect();
    return;
  }

  // --- Delete ----------------------------------------------------------
  // Comments first: they reference posts and cascade from them, but deleting
  // them explicitly keeps the intent auditable.
  for (const p of plan.filter(p => p.type === 'comment')) {
    await prisma.comment.deleteMany({ where: { id: p.id } });
    console.log(`deleted comment  ${p.id}`);
  }
  for (const p of plan.filter(p => p.type === 'inquiry')) {
    await prisma.inquiry.deleteMany({ where: { id: p.id } });
    console.log(`deleted inquiry  ${p.id}`);
  }
  for (const p of plan.filter(p => p.type === 'post')) {
    // Post deletion cascades to its comments via the schema's onDelete: Cascade.
    await prisma.post.deleteMany({ where: { id: p.id } });
    console.log(`deleted post     ${p.id}`);
  }

  // --- Verify ----------------------------------------------------------
  console.log('\nPost-cleanup verification:');
  const remaining = {
    posts: await prisma.post.count({ where: { slug: { in: FIXTURES.postSlugs } } }),
    comments: await prisma.comment.count({ where: { author: { in: FIXTURES.commentAuthors } } }),
    inquiries: await prisma.inquiry.count({
      where: { email: { in: [...FIXTURES.inquiryEmails, ...FIXTURES.inquiryEmailsPhase82] } },
    }),
  };
  console.log(`  fixture posts remaining:    ${remaining.posts}`);
  console.log(`  fixture comments remaining: ${remaining.comments}`);
  console.log(`  fixture inquiries remaining:${remaining.inquiries}`);

  const totals = {
    posts: await prisma.post.count(),
    artifacts: await prisma.artifact.count(),
    categories: await prisma.category.count(),
    users: await prisma.user.count(),
    inquiries: await prisma.inquiry.count(),
    comments: await prisma.comment.count(),
  };
  console.log('\nTotals after cleanup:');
  for (const [k, v] of Object.entries(totals)) console.log(`  ${k}=${v}`);

  await prisma.$disconnect();
})().catch(async (e) => {
  console.error('ERROR:', e.message);
  await prisma.$disconnect();
  process.exit(1);
});
