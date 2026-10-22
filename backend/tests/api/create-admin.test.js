/**
 * Tests for the administrator account creation and password reset.
 *
 * These run against the TEST database only. The suite is loaded through
 * `.mocharc.json`, whose root guard refuses to start without
 * `NODE_ENV=test`, and `src/lib/prisma.js` refuses to start in test mode
 * unless the dedicated test configuration is present and points at a
 * database other than the production one.
 *
 * The tests use their own username, so they never disturb the accounts the
 * other test files rely on, and they clean up after themselves.
 */
import { expect } from 'chai';
import bcrypt from 'bcryptjs';
import prisma from '../../src/lib/prisma.js';
import {
  BCRYPT_COST,
  MIN_PASSWORD_LENGTH,
  createOrResetAdmin,
  validatePassword,
  validateUsername,
} from '../../src/lib/admin-account.js';

describe('The administrator account script', () => {
  // A username of its own, so this file never touches the accounts the
  // other test files use.
  const USERNAME = 'p10-reset-probe';
  const ORIGINAL_PASSWORD = 'OriginalPassword1!';
  const NEW_PASSWORD = 'ReplacementPassword2!';

  beforeEach(async () => {
    await prisma.user.deleteMany({ where: { username: USERNAME } });
  });

  afterEach(async () => {
    await prisma.user.deleteMany({ where: { username: USERNAME } });
  });

  describe('Creating an account', () => {
    it('should create the account when the username does not exist', async () => {
      const result = await createOrResetAdmin(prisma, USERNAME, ORIGINAL_PASSWORD);

      expect(result.action).to.equal('created');
      expect(result.username).to.equal(USERNAME);

      const stored = await prisma.user.findUnique({ where: { username: USERNAME } });
      expect(stored).to.not.equal(null);
    });

    it('should store the password as a bcrypt hash, never as plaintext', async () => {
      await createOrResetAdmin(prisma, USERNAME, ORIGINAL_PASSWORD);

      const stored = await prisma.user.findUnique({ where: { username: USERNAME } });

      expect(stored.password).to.not.equal(ORIGINAL_PASSWORD);
      expect(stored.password).to.not.include(ORIGINAL_PASSWORD);
      // A bcrypt hash, with the cost factor the project uses.
      expect(stored.password.startsWith(`$2b$${BCRYPT_COST}$`)).to.equal(true);
    });

    it('should produce a hash the login can verify', async () => {
      await createOrResetAdmin(prisma, USERNAME, ORIGINAL_PASSWORD);

      const stored = await prisma.user.findUnique({ where: { username: USERNAME } });
      const matches = await bcrypt.compare(ORIGINAL_PASSWORD, stored.password);

      expect(matches).to.equal(true);
    });
  });

  describe('Resetting the password of an existing account', () => {
    it('should report a password reset, not a creation', async () => {
      await createOrResetAdmin(prisma, USERNAME, ORIGINAL_PASSWORD);

      const result = await createOrResetAdmin(prisma, USERNAME, NEW_PASSWORD);

      expect(result.action).to.equal('password-reset');
    });

    it('should accept the new password', async () => {
      await createOrResetAdmin(prisma, USERNAME, ORIGINAL_PASSWORD);
      await createOrResetAdmin(prisma, USERNAME, NEW_PASSWORD);

      const stored = await prisma.user.findUnique({ where: { username: USERNAME } });
      const matches = await bcrypt.compare(NEW_PASSWORD, stored.password);

      expect(matches).to.equal(true);
    });

    it('should refuse the old password', async () => {
      await createOrResetAdmin(prisma, USERNAME, ORIGINAL_PASSWORD);
      await createOrResetAdmin(prisma, USERNAME, NEW_PASSWORD);

      const stored = await prisma.user.findUnique({ where: { username: USERNAME } });
      const matches = await bcrypt.compare(ORIGINAL_PASSWORD, stored.password);

      expect(matches).to.equal(false);
    });

    it('should preserve the account id', async () => {
      const created = await createOrResetAdmin(prisma, USERNAME, ORIGINAL_PASSWORD);
      const before = await prisma.user.findUnique({ where: { username: USERNAME } });

      const result = await createOrResetAdmin(prisma, USERNAME, NEW_PASSWORD);
      const after = await prisma.user.findUnique({ where: { username: USERNAME } });

      // The row was updated in place, never deleted and recreated.
      expect(after.id).to.equal(before.id);
      expect(result.userId).to.equal(created.userId);
    });

    it('should preserve the creation date', async () => {
      await createOrResetAdmin(prisma, USERNAME, ORIGINAL_PASSWORD);
      const before = await prisma.user.findUnique({ where: { username: USERNAME } });

      await createOrResetAdmin(prisma, USERNAME, NEW_PASSWORD);
      const after = await prisma.user.findUnique({ where: { username: USERNAME } });

      expect(after.createdAt.getTime()).to.equal(before.createdAt.getTime());
    });

    it('should leave the other fields of the account untouched', async () => {
      await createOrResetAdmin(prisma, USERNAME, ORIGINAL_PASSWORD);
      await createOrResetAdmin(prisma, USERNAME, NEW_PASSWORD);

      const stored = await prisma.user.findUnique({ where: { username: USERNAME } });

      // The User model has exactly three columns besides the id: username,
      // password and createdAt. Only the password may change.
      expect(stored.username).to.equal(USERNAME);
      expect(Object.keys(stored).sort()).to.deep.equal(['createdAt', 'id', 'password', 'username']);
    });

    it('should not delete the account', async () => {
      await createOrResetAdmin(prisma, USERNAME, ORIGINAL_PASSWORD);
      await createOrResetAdmin(prisma, USERNAME, NEW_PASSWORD);

      const count = await prisma.user.count({ where: { username: USERNAME } });

      expect(count).to.equal(1);
    });

    it('should be repeatable', async () => {
      await createOrResetAdmin(prisma, USERNAME, ORIGINAL_PASSWORD);
      await createOrResetAdmin(prisma, USERNAME, NEW_PASSWORD);
      const result = await createOrResetAdmin(prisma, USERNAME, NEW_PASSWORD);

      expect(result.action).to.equal('password-reset');

      const stored = await prisma.user.findUnique({ where: { username: USERNAME } });
      expect(await bcrypt.compare(NEW_PASSWORD, stored.password)).to.equal(true);
    });
  });

  describe('The result must not leak anything secret', () => {
    it('should not return the password', async () => {
      const result = await createOrResetAdmin(prisma, USERNAME, ORIGINAL_PASSWORD);

      expect(JSON.stringify(result)).to.not.include(ORIGINAL_PASSWORD);
      expect(result).to.not.have.property('password');
      expect(result).to.not.have.property('hashedPassword');
    });

    it('should not return the hash', async () => {
      const result = await createOrResetAdmin(prisma, USERNAME, ORIGINAL_PASSWORD);

      expect(result).to.not.have.property('passwordHash');
      expect(result).to.not.have.property('hash');
      // No value in the result may look like a bcrypt hash.
      for (const value of Object.values(result)) {
        expect(String(value)).to.not.match(/^\$2[aby]\$\d{2}\$/);
      }
    });
  });

  describe('Validation', () => {
    it('should reject a missing username', async () => {
      let error = null;
      try {
        await createOrResetAdmin(prisma, '', ORIGINAL_PASSWORD);
      } catch (e) {
        error = e;
      }
      expect(error).to.be.an('error');
      expect(error.message).to.match(/ADMIN_USERNAME/);
    });

    it('should reject a username with an unexpected character', () => {
      expect(validateUsername('has space')).to.be.a('string');
      expect(validateUsername('has<script>')).to.be.a('string');
      expect(validateUsername('has"quote')).to.be.a('string');
      expect(validateUsername('has/slash')).to.be.a('string');
    });

    it('should accept a reasonable username', () => {
      expect(validateUsername('admin')).to.equal(null);
      expect(validateUsername('admin@example.com')).to.equal(null);
      expect(validateUsername('admin_test')).to.equal(null);
    });

    it('should reject a password shorter than the minimum', async () => {
      let error = null;
      try {
        await createOrResetAdmin(prisma, USERNAME, 'short');
      } catch (e) {
        error = e;
      }
      expect(error).to.be.an('error');
      expect(error.message).to.match(/at least 8 characters/);
    });

    it('should not create the account when the password is too short', async () => {
      try {
        await createOrResetAdmin(prisma, USERNAME, 'short');
      } catch (e) {
        // expected
      }
      const count = await prisma.user.count({ where: { username: USERNAME } });
      expect(count).to.equal(0);
    });

    it('should accept a password of exactly the minimum length', () => {
      const password = 'a'.repeat(MIN_PASSWORD_LENGTH);
      expect(validatePassword(password)).to.equal(null);
    });

    it('should reject a missing password', () => {
      expect(validatePassword(undefined)).to.be.a('string');
      expect(validatePassword('')).to.be.a('string');
    });
  });

  describe('The script must not disturb the other accounts', () => {
    it('should leave every other administrator account untouched', async () => {
      const before = await prisma.user.findMany({
        select: { id: true, username: true, password: true, createdAt: true },
        orderBy: { username: 'asc' },
      });

      await createOrResetAdmin(prisma, USERNAME, ORIGINAL_PASSWORD);
      await createOrResetAdmin(prisma, USERNAME, NEW_PASSWORD);

      const after = await prisma.user.findMany({
        select: { id: true, username: true, password: true, createdAt: true },
        orderBy: { username: 'asc' },
      });

      // Only the one account this file creates may differ.
      const others = (rows) => rows.filter((u) => u.username !== USERNAME);
      expect(others(after)).to.deep.equal(others(before));
    });
  });
});
