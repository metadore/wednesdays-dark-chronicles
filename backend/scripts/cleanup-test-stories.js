/**
 * Removes the Phase 9A / 9B test fixtures that are left behind in the TEST
 * database when a suite is interrupted before its own cleanup runs.
 *
 * It only removes stories whose slug carries this project's test prefix, and
 * it refuses to run against the production database. Nothing else is
 * touched: posts, artifacts, categories, inquiries, comments and
 * administrator accounts are never referenced here.
 *
 * Usage: NODE_ENV=test node scripts/cleanup-test-stories.js
 */
import prisma from '../src/lib/prisma.js';

const PREFIXES = ['p9a-admin-story-', 'p9a-admin-renamed-', 'p9b-browser-long-article'];

const run = async () => {
  const db = await prisma.$queryRawUnsafe('SELECT current_database() AS db');
  const name = db[0].db;
  console.log('target database:', name);

  if (name === 'wednesdays_dark_chronicles') {
    throw new Error('Refusing to run: this is the production database.');
  }

  const stories = await prisma.story.findMany({
    select: { id: true, slug: true },
  });

  const targets = stories.filter((story) =>
    PREFIXES.some((prefix) => story.slug.startsWith(prefix))
  );

  if (targets.length === 0) {
    console.log('no test stories to remove');
    await prisma.$disconnect();
    return;
  }

  const ids = targets.map((story) => story.id);

  // The starting-node pointer must be cleared before the nodes are removed,
  // because it is a foreign key with ON DELETE NO ACTION.
  await prisma.story.updateMany({
    where: { id: { in: ids } },
    data: { startingNodeId: null },
  });
  await prisma.storyChoice.deleteMany({ where: { storyId: { in: ids } } });
  await prisma.storyNode.deleteMany({ where: { storyId: { in: ids } } });
  await prisma.story.deleteMany({ where: { id: { in: ids } } });

  console.log(`removed ${targets.length} test stories`);

  // The long-article fixture post, if it is still there.
  const posts = await prisma.post.deleteMany({
    where: { slug: { startsWith: 'p9b-browser-long-article' } },
  });
  console.log(`removed ${posts.count} long-article fixture posts`);

  await prisma.$disconnect();
};

run().catch(async (e) => {
  console.error(e.message);
  await prisma.$disconnect();
  process.exit(1);
});
