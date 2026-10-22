/**
 * Read-only identity probe: reports which database/server Prisma reaches.
 * Usage: node scripts/db-identity.js <live|test>
 */
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { PrismaClient } from '@prisma/client';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const target = process.argv[2] === 'live' ? 'live' : 'test';
const envPath = target === 'test'
  ? path.resolve(__dirname, '..', '.env.test')
  : path.resolve(__dirname, '..', '.env');

dotenv.config({ path: envPath, override: true });
if (process.env.DATABASE_URL?.includes('${')) {
  process.env.DATABASE_URL = process.env.DATABASE_URL.replace(
    /\$\{([A-Z0-9_]+)\}/g, (_, n) => process.env[n] ?? ''
  );
}

const prisma = new PrismaClient({
  datasources: { db: { url: process.env.DATABASE_URL } },
});

const mask = (u) => u.replace(/\/\/([^:]+):[^@]*@/, '//$1:***@');

(async () => {
  const rows = await prisma.$queryRawUnsafe(`
    SELECT current_database() AS db,
           current_user     AS usr,
           inet_server_addr()::text AS host,
           inet_server_port() AS port,
           current_schema() AS schema,
           (SELECT count(*) FROM information_schema.tables
             WHERE table_schema = current_schema()) AS user_tables
  `);
  console.log(`target=${target}`);
  console.log(`url=${mask(process.env.DATABASE_URL)}`);
  const r = rows[0];
  console.log(`db=${r.db} user=${r.usr} host=${r.host} port=${r.port} schema=${r.schema} user_tables=${Number(r.user_tables)}`);
  await prisma.$disconnect();
})().catch(async (e) => {
  console.error('ERROR:', e.message);
  await prisma.$disconnect();
  process.exit(1);
});
