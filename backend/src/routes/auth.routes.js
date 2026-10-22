
import express from 'express';
import { login, logout } from '../controllers/auth.controller.js';
import { doubleCsrfProtection } from '../middleware/csrf.js';
import { protect } from '../middleware/auth.js';
import rateLimit from 'express-rate-limit';

const router = express.Router();

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  // express-rate-limit v7+ renamed `max` to `limit`. `max` still works but is
  // deprecated, and it is silently ignored if a future release drops it, so
  // the current option name is used.
  limit: 5,
  message: { error: 'Too many login attempts, please try again after 15 minutes' },
  standardHeaders: true,
  legacyHeaders: false,
});

/**
 * Clear the login rate-limit counter for a given client key.
 * Used by the automated test suite so each test starts from a clean slate.
 */
export const resetLoginLimiter = async (key) => {
  if (typeof loginLimiter.resetKey === 'function') {
    await loginLimiter.resetKey(key);
  }
};

export { loginLimiter };

router.post('/login', loginLimiter, login);

// The logout must present a valid session, so that the token it revokes is
// the one that was actually used. A logout without a valid session is
// refused rather than silently accepted.
router.post('/logout', protect, doubleCsrfProtection, logout);

export default router;
