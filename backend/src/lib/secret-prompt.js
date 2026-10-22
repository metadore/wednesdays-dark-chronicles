/**
 * Reading a secret without echoing it, and generating a strong one.
 *
 * The administrator password must never appear in a command line, in the
 * process list, in a shell history, in a log file or in a transcript. This
 * module provides the two safe ways to supply it:
 *
 *   - `promptForSecret` asks the operator for the password and does not
 *     echo what they type.
 *   - `generateSecret` produces a strong random password, so an operator
 *     never has to invent one.
 *
 * The generated password is written to a file that only the operator reads.
 * The password itself is never returned to the caller that prints anything:
 * `generateSecret` returns the file path and the password, and it is the
 * caller's job to keep the second one out of the output.
 */
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import readline from 'readline';

/**
 * The characters a generated password is built from.
 *
 * Ambiguous characters (0/O, 1/l/I) are left out, because the password is
 * going to be typed by a human at least once.
 */
const ALPHABET =
  'abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789!@#%^&*()-_=+';

/**
 * Generate a cryptographically strong random password.
 *
 * @param {number} length  how many characters to generate.
 * @returns {string} the password.
 */
export const generateSecret = (length = 24) => {
  const size = Number.isInteger(length) && length >= 16 ? length : 24;
  const bytes = crypto.randomBytes(size * 2);
  let out = '';
  for (let i = 0; out.length < size; i += 1) {
    const byte = bytes[i % bytes.length];
    // Rejection sampling, so every character is equally likely.
    if (byte >= 256 - (256 % ALPHABET.length)) continue;
    out += ALPHABET[byte % ALPHABET.length];
  }
  return out;
};

/**
 * Write a secret to a file that only the operator can read.
 *
 * The file is created with owner-only permissions on the platforms that
 * support them, and refuses to overwrite an existing file, so a stale
 * password file is never silently replaced.
 *
 * @param {string} filePath
 * @param {string} secret
 * @returns {string} the path that was written.
 */
export const writeSecretFile = (filePath, secret) => {
  if (fs.existsSync(filePath)) {
    throw new Error(
      `The file ${filePath} already exists. Refusing to overwrite it: it may hold a password that is still in use.`
    );
  }

  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  // 'wx' fails if the file exists, which closes the race with the check above.
  fs.writeFileSync(filePath, `${secret}\n`, { encoding: 'utf8', flag: 'wx' });

  try {
    fs.chmodSync(filePath, 0o600);
  } catch (e) {
    // Windows does not have POSIX permissions. The file still exists with
    // the user's own ACL, which is what matters there.
  }

  return filePath;
};

/**
 * Read a secret from the terminal without echoing it.
 *
 * The typed characters are swallowed, so they never appear on screen and
 * never end up in a terminal log. The prompt is written to the output
 * stream, and a newline is written when the operator presses enter.
 *
 * @param {object} options
 * @param {string} options.prompt   the text to show.
 * @param {NodeJS.ReadableStream} options.input
 * @param {NodeJS.WritableStream} options.output
 * @returns {Promise<string>} the secret.
 */
export const promptForSecret = ({ prompt, input, output }) =>
  new Promise((resolve, reject) => {
    const rl = readline.createInterface({ input, output, terminal: true });

    // Swallow every character that is written while the prompt is active.
    const writeToOutput = rl._writeToOutput;
    rl._writeToOutput = function mutedWriteToOutput(chunk) {
      if (this.stdoutMuted) return;
      writeToOutput.call(this, chunk);
    };

    rl.stdoutMuted = true;

    rl.question(prompt, (answer) => {
      rl.stdoutMuted = false;
      // A newline, so the operator's next prompt starts on a fresh line.
      output.write('\n');
      rl.close();
      resolve(answer);
    });

    rl.on('SIGINT', () => {
      rl.stdoutMuted = false;
      rl.close();
      reject(new Error('Cancelled'));
    });
  });
