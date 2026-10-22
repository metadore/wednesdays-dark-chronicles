
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import prisma from '../lib/prisma.js';
import { config } from '../config.js';
import { revoke } from '../lib/token-revocation.js';

const COOKIE_NAME = 'auth_token';

export const login = async (req, res, next) => {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password are required' });
    }

    const user = await prisma.user.findUnique({ where: { username } });
    if (!user) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const token = jwt.sign(
      {
        userId: user.id,
        // A unique identifier for this token. It lets the server revoke this
        // specific token at logout, instead of only clearing the cookie.
        jti: crypto.randomBytes(16).toString('hex'),
      },
      config.jwtSecret,
      {
        expiresIn: config.jwtExpiresIn,
        issuer: config.jwtIssuer,
        audience: config.jwtAudience,
        algorithm: 'HS256',
      }
    );

    res.cookie(COOKIE_NAME, token, {
      httpOnly: true,
      secure: config.nodeEnv === 'production',
      sameSite: 'Strict',
      path: '/',
      maxAge: 2 * 60 * 60 * 1000,
    });

    res.status(200).json({ message: 'Authenticated successfully' });
  } catch (error) {
    next(error);
  }
};

export const logout = async (req, res, next) => {
  try {
    // Revoke the token that is being used for this request, so a copy of it
    // that was taken before the logout stops working immediately instead of
    // remaining valid until it expires.
    if (req.authPayload && typeof req.authPayload === 'object') {
      revoke(req.authPayload);
    }

    res.clearCookie(COOKIE_NAME, {
      // The attributes must match the ones the cookie was set with,
      // otherwise the browser keeps the original cookie.
      httpOnly: true,
      secure: config.nodeEnv === 'production',
      sameSite: 'Strict',
      path: '/',
    });

    res.status(200).json({ message: 'Logged out successfully' });
  } catch (error) {
    next(error);
  }
};
