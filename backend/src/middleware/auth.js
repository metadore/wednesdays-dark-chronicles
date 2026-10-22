
import jwt from 'jsonwebtoken';
import prisma from '../lib/prisma.js';
import { config } from '../config.js';
import { isRevoked } from '../lib/token-revocation.js';

const COOKIE_NAME = 'auth_token';

/**
 * Administrator authorization.
 *
 * The token must be:
 *   - signed with this application's secret,
 *   - issued by and intended for this application (issuer + audience),
 *   - unexpired,
 *   - not revoked (a token that was used for a logout stops working),
 *   - carry a subject (the administrator's user id),
 *   - and refer to a user that still exists.
 *
 * The user is loaded from the database on every request. A token for a
 * deleted administrator therefore stops working immediately, without any
 * token blocklist.
 */
export const protect = async (req, res, next) => {
  try {
    const token = req.cookies[COOKIE_NAME];

    if (!token) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const decoded = jwt.verify(token, config.jwtSecret, {
      issuer: config.jwtIssuer,
      audience: config.jwtAudience,
      algorithms: ['HS256'],
    });

    if (!decoded || typeof decoded !== 'object' || !decoded.userId) {
      return res.status(401).json({ error: 'Invalid or expired token' });
    }

    // A token that was revoked at logout is refused, even though it has not
    // expired yet.
    if (isRevoked(decoded)) {
      return res.status(401).json({ error: 'Invalid or expired token' });
    }

    const user = await prisma.user.findUnique({
      where: { id: decoded.userId },
      select: { id: true, username: true },
    });

    if (!user) {
      return res.status(401).json({ error: 'Invalid or expired token' });
    }

    // Only the identity is exposed downstream; never the password hash.
    req.user = { id: user.id, username: user.username };
    // The decoded token is kept so the logout endpoint can revoke it.
    req.authPayload = decoded;
    next();
  } catch (error) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
};
