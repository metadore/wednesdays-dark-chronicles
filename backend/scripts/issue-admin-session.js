/**
 * Issues a session cookie for an EXISTING administrator account, for local
 * browser verification of the Grimoire dashboard.
 *
 * It does not create, modify or delete any account, and it does not read or
 * print any password. The signed token is produced by the same secret the
 * running server uses, so the browser behaves exactly as after a real login.
 *
 * Usage: node scripts/issue-admin-session.js [username]
 */
import jwt from 'jsonwebtoken';
import prisma from '../src/lib/prisma.js';
import { config } from '../src/config.js';

const username = process.argv[2] || 'admin';

const run = async () => {
  const user = await prisma.user.findUnique({ where: { username } });
  if (!user) {
    console.error(`No such administrator: ${username}`);
    await prisma.$disconnect();
    process.exit(1);
  }
  const token = jwt.sign({ userId: user.id }, config.jwtSecret, { expiresIn: '2h' });
  console.log(token);
  await prisma.$disconnect();
};

run().catch(async (e) => { console.error(e.message); await prisma.$disconnect(); process.exit(1); });
