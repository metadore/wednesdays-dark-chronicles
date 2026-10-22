/**
 * Phase 8.2 — read-only PostgreSQL topology probe.
 *
 * Establishes which physical server each connection target actually reaches,
 * without writing anything and without stopping any service.
 *
 * Usage: node scripts/pg-topology.js
 */
import net from 'net';
import { execFileSync } from 'child_process';
import { PrismaClient } from '@prisma/client';

const PSQL = 'C:/Program Files/PostgreSQL/16/bin/psql.exe';

const dockerIp = () => {
  try {
    const out = execFileSync(
      'docker',
      ['inspect', '-f', '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}', 'wednesdays-db'],
      { encoding: 'utf8' }
    ).trim();
    return out || null;
  } catch {
    return null;
  }
};

const tcpProbe = (host, port) =>
  new Promise((resolve) => {
    const sock = net.connect({ host, port, timeout: 3000 });
    const done = (ok, note) => {
      sock.destroy();
      resolve({ host, port, reachable: ok, note });
    };
    sock.on('connect', () => done(true, 'TCP connect succeeded'));
    sock.on('timeout', () => done(false, 'timeout'));
    sock.on('error', (e) => done(false, e.code || e.message));
  });

const query = async (label, url) => {
  const prisma = new PrismaClient({ datasources: { db: { url } } });
  try {
    const rows = await prisma.$queryRawUnsafe(`
      SELECT current_database() AS db,
             current_user     AS usr,
             inet_server_addr()::text AS host,
             inet_server_port() AS port,
             version()        AS ver,
             (SELECT count(*) FROM pg_tables WHERE schemaname='public') AS tables
    `);
    const r = rows[0];
    console.log(`  ${label}`);
    console.log(`    db=${r.db} user=${r.usr} server_addr=${r.host} server_port=${r.port} public_tables=${Number(r.tables)}`);
    console.log(`    version=${String(r.ver).split(' on ')[0]}`);
    console.log(`    compiled_by=${String(r.ver).includes('Visual C++') ? 'Visual C++ (native Windows build)' : 'linux/musl (Alpine container build)'}`);
    return r;
  } catch (e) {
    console.log(`  ${label}\n    ERROR: ${e.message.split('\n')[0]}`);
    return null;
  } finally {
    await prisma.$disconnect();
  }
};

const sql = (db, user, sqlText) => {
  try {
    return execFileSync(PSQL, ['-U', user, '-h', 'localhost', '-d', db, '-tAc', sqlText], {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
  } catch (e) {
    return `ERROR: ${String(e.stderr || e.message).split('\n')[0]}`;
  }
};

(async () => {
  const ip = dockerIp();
  console.log('=== TCP reachability on port 5432 ===');
  for (const t of [
    { host: '127.0.0.1', port: 5432 },
    { host: '::1', port: 5432 },
    { host: 'localhost', port: 5432 },
    ...(ip ? [{ host: ip, port: 5432 }] : []),
  ]) {
    const r = await tcpProbe(t.host, t.port);
    console.log(`  ${t.host}:${t.port} -> reachable=${r.reachable} ${r.note}`);
  }

  console.log('\n=== Which physical server does each target reach? ===');
  await query('localhost (as used by .env / .env.test)', 'postgresql://postgres:postgres@localhost:5432/wednesdays_dark_chronicles');
  if (ip) {
    await query(`docker container IP ${ip}`, `postgresql://postgres:postgres@${ip}:5432/wednesdays_dark_chronicles`);
  }
  await query('127.0.0.1 explicit', 'postgresql://postgres:postgres@127.0.0.1:5432/wednesdays_dark_chronicles');

  console.log('\n=== Row counts per database (native service via psql) ===');
  for (const [db, user] of [
    ['wednesdays_dark_chronicles', 'postgres'],
    ['db_test', 'user'],
  ]) {
    const out = sql(db, user, `select 'posts='||(select count(*) from "Post")||' artifacts='||(select count(*) from "Artifact")||' categories='||(select count(*) from "Category")||' users='||(select count(*) from "User")||' inquiries='||(select count(*) from "Inquiry")||' comments='||(select count(*) from "Comment")`);
    console.log(`  ${db}: ${out}`);
  }

  console.log('\n=== Docker container internal view (read-only) ===');
  try {
    const out = execFileSync(
      'docker',
      ['exec', 'wednesdays-db', 'psql', '-U', 'postgres', '-d', 'wednesdays_dark_chronicles', '-tAc',
       `select 'public_tables='||(select count(*) from pg_tables where schemaname='public')`],
      { encoding: 'utf8' }
    ).trim();
    console.log(`  wednesdays_dark_chronicles (inside container): ${out}`);
  } catch (e) {
    console.log(`  ERROR: ${String(e.stderr || e.message).split('\n')[0]}`);
  }
})();
