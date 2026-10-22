/**
 * Create an administrator account, or reset the password of an existing one.
 *
 * Usage:
 *   cd backend
 *
 *   # Generate a strong password and print where it was saved.
 *   ADMIN_USERNAME=admin node scripts/create-admin.js --generate
 *
 *   # Type the password at a hidden prompt (it is not echoed, and it never
 *   # appears in the shell history or in the process list).
 *   ADMIN_USERNAME=admin node scripts/create-admin.js --prompt
 *
 *   # Read the password from a file, for an automated run.
 *   ADMIN_USERNAME=admin node scripts/create-admin.js --password-file ./path
 *
 *   # The original form, kept for compatibility. The password is in the
 *   # process list while the command runs, so it is not preferred.
 *   ADMIN_USERNAME=admin ADMIN_PASSWORD='...' node scripts/create-admin.js
 *
 * What it does:
 *   - the username does not exist  -> the account is created
 *   - the username already exists  -> only that account's password hash is
 *                                     replaced, in place
 *
 * The account is never deleted and never recreated, so its id, its creation
 * date and every relationship that points at it are preserved.
 *
 * The plaintext password and the password hash are never printed.
 */
import fs from 'fs';
import os from 'os';
import path from 'path';
import dotenv from 'dotenv';
import prisma from '../src/lib/prisma.js';
import { createOrResetAdmin } from '../src/lib/admin-account.js';
import {
  generateSecret,
  promptForSecret,
  writeSecretFile,
} from '../src/lib/secret-prompt.js';

dotenv.config();

/** Read the password from a file, trimming the trailing newline. */
const readPasswordFile = (filePath) => {
  const contents = fs.readFileSync(filePath, 'utf8').replace(/\r?\n$/, '');
  if (!contents) {
    throw new Error(`The password file ${filePath} is empty.`);
  }
  return contents;
};

/**
 * Work out which password to use.
 *
 * The password is never taken from the command line: a value in argv is
 * visible to every process on the machine and ends up in the shell history.
 */
const resolvePassword = async (args) => {
  // An explicit flag always wins over the environment. The environment
  // variable is the legacy form, and an operator who typed a flag meant it.

  if (args.passwordFile) {
    return {
      password: readPasswordFile(args.passwordFile),
      source: 'the password file',
    };
  }

  if (args.prompt) {
    const password = await promptForSecret({
      prompt: 'Password for the administrator account: ',
      input: process.stdin,
      output: process.stderr,
    });
    return { password, source: 'the hidden prompt' };
  }

  if (args.generate) {
    const password = generateSecret(24);
    // The password is written to a file in the user's temporary directory,
    // with owner-only permissions, and the file is never overwritten. Only
    // the PATH of the file is printed, never the password.
    const filePath = path.join(
      os.tmpdir(),
      `admin-password-${Date.now()}-${process.pid}.txt`
    );
    writeSecretFile(filePath, password);
    return { password, source: 'a generated password', filePath };
  }

  // The original form: the password is in the environment.
  if (process.env.ADMIN_PASSWORD) {
    return { password: process.env.ADMIN_PASSWORD, source: 'ADMIN_PASSWORD' };
  }

  throw new Error(
    'No password was supplied. Use --prompt to type one, --generate to have ' +
      'one made, --password-file <file> to read one from a file, or set ' +
      'ADMIN_PASSWORD in the environment.'
  );
};

const run = async () => {
  const args = {
    prompt: process.argv.includes('--prompt'),
    generate: process.argv.includes('--generate'),
    passwordFile: null,
  };

  const fileIndex = process.argv.indexOf('--password-file');
  if (fileIndex !== -1) {
    args.passwordFile = process.argv[fileIndex + 1];
    if (!args.passwordFile) {
      console.error('Error: --password-file needs the path to a file.');
      process.exit(1);
    }
  }

  const username = process.env.ADMIN_USERNAME;

  if (!username) {
    console.error('Error: ADMIN_USERNAME must be set in .env or in the environment.');
    process.exit(1);
  }

  try {
    const { password, source, filePath } = await resolvePassword(args);

    const result = await createOrResetAdmin(prisma, username, password);

    if (result.action === 'created') {
      console.log(`Admin user "${result.username}" created.`);
    } else {
      console.log(
        `Admin user "${result.username}" already existed; its password was reset.`
      );
    }

    console.log(`The password was taken from ${source}.`);
    if (filePath) {
      console.log(`The generated password was saved to: ${filePath}`);
    }
  } catch (error) {
    console.error(`Error: ${error.message}`);
    process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
};

run();
