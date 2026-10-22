import express from 'express';
import { createInquiry } from '../controllers/inquiry.controller.js';
import { protect } from '../middleware/auth.js';
import { adminGetInquiries } from '../controllers/inquiry.controller.js';
import { doubleCsrfProtection } from '../middleware/csrf.js';
import rateLimit from 'express-rate-limit';

const router = express.Router();

const inquiryLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  // The limit is resolved per request so it can be tuned for automated
  // tests via INQUIRY_RATE_LIMIT_MAX without changing production behaviour.
  limit: (req) => Number(process.env.INQUIRY_RATE_LIMIT_MAX) || 5, // 5 inquiries per IP per hour
  message: { error: 'You have sent too many inquiries. Please wait before reaching out to the void again.' },
  standardHeaders: true,
  legacyHeaders: false,
});

/**
 * Clear the inquiry rate-limit counter for a given client key.
 * Used by the automated test suite so each test starts from a clean slate.
 */
export const resetInquiryLimiter = async (key) => {
  if (typeof inquiryLimiter.resetKey === 'function') {
    await inquiryLimiter.resetKey(key);
  }
};

// Public route to submit inquiries.
//
// The inquiry form is an anonymous write, exactly like the comment form, and
// it is protected in exactly the same way: a double-submit CSRF token. A
// third party must not be able to make a visitor's browser file inquiries
// on their behalf.
//
// The token is obtained from the same endpoint the comment form uses, so
// the two anonymous forms behave identically.
router.post('/', inquiryLimiter, doubleCsrfProtection, createInquiry);

// Protected route for admin to view inquiries
router.get('/admin', protect, adminGetInquiries);

export default router;
