import crypto from 'crypto';
import { doubleCsrf } from 'csrf-csrf';
import { config } from '../config.js';

export const sessionMiddleware = (req, res, next) => {
  if (!req.cookies.csrf_session) {
    const sessionId = crypto.randomBytes(16).toString('hex');
    res.cookie('csrf_session', sessionId, {
      httpOnly: true,
      sameSite: 'Strict',
      secure: process.env.NODE_ENV === 'production',
      path: '/',
    });
    req.cookies.csrf_session = sessionId;
  }
  next();
};

const csrf = doubleCsrf({
  getSecret: () => {
    if (!config.csrfSecret) {
      throw new Error('CSRF_SECRET is not defined in the configuration');
    }
    return config.csrfSecret;
  },
  getSessionIdentifier: (req) => req.cookies.csrf_session,
  cookieName: 'x-csrf-token',
  cookieOptions: {
    httpOnly: true,
    sameSite: 'Strict',
    secure: config.nodeEnv === 'production',
  },
  getTokenFromRequest: (req) => req.headers['x-csrf-token'],
});

export const generateToken = (req, res) => {
  return csrf.generateCsrfToken(req, res);
};

export const doubleCsrfProtection = csrf.doubleCsrfProtection;
export default csrf;
