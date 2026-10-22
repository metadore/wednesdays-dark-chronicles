/**
 * Test helper: mint an administrator token exactly the way the real login
 * endpoint does, so the tests exercise the same issuer/audience/algorithm
 * rules the application enforces.
 */
import jwt from 'jsonwebtoken';
import { config } from '../../src/config.js';

export const signAdminToken = (user, overrides = {}) =>
  jwt.sign(
    { userId: user.id, ...overrides },
    config.jwtSecret,
    {
      expiresIn: '1h',
      issuer: config.jwtIssuer,
      audience: config.jwtAudience,
      algorithm: 'HS256',
    }
  );
