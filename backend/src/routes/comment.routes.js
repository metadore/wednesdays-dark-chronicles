import express from 'express';
import rateLimit from 'express-rate-limit';
import {
  createComment,
  getApprovedComments,
  adminGetComments,
  adminModerateComment,
  adminDeleteComment,
} from '../controllers/comment.controller.js';
import { protect } from '../middleware/auth.js';
import { doubleCsrfProtection } from '../middleware/csrf.js';

const router = express.Router();

/**
 * Rate limit for public comment submission.
 * Keeps a single IP from flooding the moderation queue.
 *
 * The limit is resolved per request so it can be tuned for automated tests via
 * COMMENT_RATE_LIMIT_MAX without changing production behaviour.
 */
export const commentLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  // The limit is resolved per request so it can be tuned for automated tests via
  // COMMENT_RATE_LIMIT_MAX without changing production behaviour.
  //
  // express-rate-limit v7+ renamed `max` to `limit`. `max` still works but is
  // deprecated, and it is silently ignored if a future release drops it, so
  // the current option name is used.
  limit: (req) => Number(process.env.COMMENT_RATE_LIMIT_MAX) || 5, // 5 comments per IP per hour
  message: {
    error: 'You have spoken too often. Please wait before adding your voice to the void again.',
  },
  standardHeaders: true,
  legacyHeaders: false,
});

/**
 * Clear the comment rate-limit counter for a given client key.
 * Used by the automated test suite so each test starts from a clean slate.
 */
export const resetCommentLimiter = async (key) => {
  if (typeof commentLimiter.resetKey === 'function') {
    await commentLimiter.resetKey(key);
  }
};

// Admin routes are declared BEFORE the public '/:postId' route so that the
// literal 'admin' segment is never swallowed by the parameterised path.
router.get('/admin', protect, adminGetComments);
router.patch('/admin/:id', protect, doubleCsrfProtection, adminModerateComment);
router.delete('/admin/:id', protect, doubleCsrfProtection, adminDeleteComment);

// Public
router.get('/:postId', getApprovedComments);
router.post('/', commentLimiter, doubleCsrfProtection, createComment);

export default router;
