/**
 * Administrator account creation and password reset.
 *
 * The logic lives here, apart from the command-line entry point, so that it
 * can be tested directly against the isolated test database. Running the
 * script is a separate concern: it is the thing that needs approval, not
 * the logic.
 *
 * The rules this module enforces:
 *
 *   - The account is created when the username does not exist.
 *   - The account's password hash is REPLACED when the username does exist.
 *     This is what makes a password reset possible at all: the application
 *     has no password-change endpoint, and the bcrypt hash is one-way, so
 *     a forgotten password cannot be recovered, only replaced.
 *   - The account is NEVER deleted and never recreated. The row is updated
 *     in place, so the id, the creation date and every relationship that
 *     points at the account are preserved.
 *   - The plaintext password is never returned, logged or printed.
 *   - The password hash is never returned, logged or printed.
 */
import bcrypt from 'bcryptjs';

/** The bcrypt cost factor. Unchanged, so existing hashes stay comparable. */
export const BCRYPT_COST = 10;

/** The shortest password the script accepts. */
export const MIN_PASSWORD_LENGTH = 8;

/** The longest username the script accepts. */
export const MAX_USERNAME_LENGTH = 100;

/**
 * Validate the username.
 *
 * The username is a unique column that the login form sends verbatim, and
 * it ends up in a URL path (`/api/admin/users/<id>` is not used, but the
 * username is used as a lookup key) and in log lines. A conservative
 * character set keeps it predictable.
 *
 * @returns {string|null} an error message, or null when the username is
 *          acceptable.
 */
export const validateUsername = (username) => {
  if (typeof username !== 'string' || !username.trim()) {
    return 'ADMIN_USERNAME must not be empty';
  }
  const trimmed = username.trim();
  if (trimmed.length > MAX_USERNAME_LENGTH) {
    return `ADMIN_USERNAME must be at most ${MAX_USERNAME_LENGTH} characters long`;
  }
  if (!/^[A-Za-z0-9._@-]+$/.test(trimmed)) {
    return 'ADMIN_USERNAME may contain only letters, numbers, and the characters . _ @ -';
  }
  return null;
};

/**
 * Validate the password.
 *
 * @returns {string|null} an error message, or null when the password is
 *          acceptable.
 */
export const validatePassword = (password) => {
  if (typeof password !== 'string' || !password) {
    return 'ADMIN_PASSWORD must not be empty';
  }
  if (password.length < MIN_PASSWORD_LENGTH) {
    return `ADMIN_PASSWORD must be at least ${MIN_PASSWORD_LENGTH} characters long`;
  }
  // An upper bound keeps a mistyped paste from hashing megabytes.
  if (password.length > 200) {
    return 'ADMIN_PASSWORD must be at most 200 characters long';
  }
  return null;
};

/**
 * Create the administrator account, or reset the password of an existing
 * one.
 *
 * @param {object} client   the Prisma client to use
 * @param {string} username
 * @param {string} password the plaintext password. It is hashed here and
 *                          never returned.
 * @returns {Promise<{action: 'created'|'password-reset', username: string,
 *                    userId: string}>}
 *          `action` says what happened; no hash and no password is
 *          included.
 * @throws {Error} when the username or the password is not acceptable.
 */
export const createOrResetAdmin = async (client, username, password) => {
  const usernameError = validateUsername(username);
  if (usernameError) throw new Error(usernameError);

  const passwordError = validatePassword(password);
  if (passwordError) throw new Error(passwordError);

  const trimmedUsername = username.trim();
  const hashedPassword = await bcrypt.hash(password, BCRYPT_COST);

  // The account is looked up first, so the two cases can be handled
  // explicitly. An upsert with `update: {}` would report success while
  // leaving the old password in place, which is exactly the confusion this
  // function exists to remove.
  const existing = await client.user.findUnique({ where: { username: trimmedUsername } });

  if (!existing) {
    const created = await client.user.create({
      data: { username: trimmedUsername, password: hashedPassword },
      select: { id: true, username: true },
    });
    return { action: 'created', username: created.username, userId: created.id };
  }

  // The account exists. Only the password column is written, so the id,
  // the creation date and every relationship are preserved. The row is
  // updated, never deleted and recreated.
  const updated = await client.user.update({
    where: { username: trimmedUsername },
    data: { password: hashedPassword },
    select: { id: true, username: true },
  });

  return { action: 'password-reset', username: updated.username, userId: updated.id };
};
