
import dotenv from 'dotenv';
import { loadTestEnv, isTestEnv, envTestPath } from './lib/test-env.js';

// In test mode the dedicated test configuration is loaded and validated
// first, so a missing or mis-pointed test database aborts the run instead of
// silently falling back to the live database.
loadTestEnv();
dotenv.config({ path: isTestEnv() ? envTestPath : undefined });

const requiredSecrets = ['JWT_SECRET', 'CSRF_SECRET'];

const validateSecrets = () => {
  const missing = requiredSecrets.filter(s => !process.env[s]);
  if (missing.length > 0) {
    if (process.env.NODE_ENV === 'production') {
      console.error(`FATAL: Missing required production secrets: ${missing.join(', ')}`);
      process.exit(1);
    } else if (process.env.NODE_ENV !== 'test') {
      console.warn(`WARNING: Missing secrets in development: ${missing.join(', ')}. Please define them in .env`);
    }
  }
};

validateSecrets();
console.log(`[Bootstrap] Environment loaded. NODE_ENV=${process.env.NODE_ENV}`);
