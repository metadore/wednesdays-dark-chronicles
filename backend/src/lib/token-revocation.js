/**
 * Token revocation.
 *
 * Signing a JWT is stateless: nothing in the token records that the
 * administrator logged out, so a token that was captured before the logout
 * keeps working until it expires. That is a real gap for an administrator
 * session, where a copied token is a copied grant of full access.
 *
 * The fix is a denylist of revoked token identifiers, pruned by their own
 * expiry so it can never grow without bound and never holds an entry longer
 * than the token it refers to.
 *
 * Scope and limits — read this before relying on it:
 *
 *   - The denylist lives in the PROCESS. It is not shared between
 *     processes, so in a deployment that runs more than one API instance
 *     behind a load balancer, a token revoked on instance A is still
 *     accepted on instance B until it expires. The exposure window is
 *     bounded by JWT_EXPIRES_IN.
 *   - Nothing is written to the database, so no migration is needed and the
 *     revocation is not durable across a restart. A restart empties the
 *     denylist, which means a revoked token becomes valid again until it
 *     expires. The same is true of the process-local rate limiters.
 *
 * A deployment that needs durable, cluster-wide revocation must either run
 * a single API instance or move the denylist into shared storage. That is a
 * decision for the owner of the deployment, and it is recorded in the
 * Phase 10 report.
 */

/**
 * The revoked token identifiers.
 * Keyed by the token's `jti` claim; the value is the token's expiry, in
 * milliseconds since the epoch.
 */
const revoked = new Map();

/** How often the expired entries are swept. */
const SWEEP_INTERVAL_MS = 60 * 1000;

let lastSweep = 0;

/**
 * Remove the entries whose token has already expired.
 * A revoked token only needs to be remembered until it would have expired
 * on its own.
 */
const sweep = () => {
  const now = Date.now();
  for (const [jti, expiresAt] of revoked) {
    if (expiresAt <= now) revoked.delete(jti);
  }
  lastSweep = now;
};

/**
 * Revoke a token.
 *
 * @param {object} payload  the decoded JWT payload
 */
export const revoke = (payload) => {
  if (!payload || typeof payload !== 'object') return;

  // A token without a jti cannot be identified in the denylist. Tokens are
  // issued with one, so this only happens for a token minted elsewhere.
  const jti = payload.jti;
  if (typeof jti !== 'string' || !jti) return;

  const now = Date.now();
  if (now - lastSweep > SWEEP_INTERVAL_MS) sweep();

  // The expiry is taken from the token itself, so the entry disappears
  // exactly when the token would have expired anyway.
  const expiresAt = payload.exp ? payload.exp * 1000 : now;
  revoked.set(jti, expiresAt);
};

/**
 * Report whether a token has been revoked.
 *
 * @param {object} payload  the decoded JWT payload
 * @returns {boolean}
 */
export const isRevoked = (payload) => {
  if (!payload || typeof payload !== 'object') return false;
  const jti = payload.jti;
  if (typeof jti !== 'string' || !jti) return false;

  const expiresAt = revoked.get(jti);
  if (expiresAt === undefined) return false;

  if (expiresAt <= Date.now()) {
    revoked.delete(jti);
    return false;
  }

  return true;
};

/**
 * The number of tokens currently on the denylist.
 * Exposed for the health check and for tests.
 */
export const revocationCount = () => revoked.size;

/**
 * Forget every revoked token. Used by the tests so that one case cannot
 * leave state behind for the next.
 */
export const clearRevocations = () => revoked.clear();
