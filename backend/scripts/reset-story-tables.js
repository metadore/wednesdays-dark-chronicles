/**
 * Drops ONLY the three Phase 9A story tables from the TEST database and
 * removes the Phase 9A migration record so the corrected migration can be
 * re-applied.
 *
 * This touches nothing else: the Story/StoryNode/StoryChoice tables were
 * created by this phase minutes ago and hold no pre-existing data. Posts,
 * artifacts, categories, users, inquiries and comments are never referenced
 * here.
 *
 * Usage: NODE_ENV=test node scripts/reset-story-tables.js
 */
import prisma from '../src/lib/prisma.js';

const MIGRATION = '20261021081641_add_branching_stories';

const run = async () => {
  const db = await prisma.$queryRawUnsafe('SELECT current_database() AS db');
  console.log('target database:', db[0].db);
  if (db[0].db === 'wednesdays_dark_chronicles') {
    throw new Error('Refusing to run: this is the production database.');
  }

  await prisma.$executeRawUnsafe('DROP TABLE IF EXISTS "StoryChoice" CASCADE');
  await prisma.$executeRawUnsafe('DROP TABLE IF EXISTS "StoryNode" CASCADE');
  await prisma.$executeRawUnsafe('DROP TABLE IF EXISTS "Story" CASCADE');
  console.log('story tables dropped');

  const removed = await prisma.$executeRawUnsafe(
    'DELETE FROM "_prisma_migrations" WHERE migration_name = $1',
    MIGRATION
  );
  console.log('migration record removed:', removed);

  await prisma.$disconnect();
};

run().catch(async (e) => {
  console.error(e.message);
  await prisma.$disconnect();
  process.exit(1);
});
