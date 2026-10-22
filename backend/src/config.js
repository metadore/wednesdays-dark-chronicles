
import dotenv from 'dotenv';
import { loadTestEnv, isTestEnv, envTestPath } from './lib/test-env.js';

// Load environment variables IMMEDIATELY.
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

export const config = {
  jwtSecret: process.env.JWT_SECRET,
  csrfSecret: process.env.CSRF_SECRET,
  nodeEnv: process.env.NODE_ENV || 'development',
  frontendOrigin: process.env.FRONTEND_ORIGIN || '',
  // The issuer and audience bind a token to this application, so a token
  // minted for a different service (with the same secret) is not accepted.
  jwtIssuer: process.env.JWT_ISSUER || 'wdc-api',
  jwtAudience: process.env.JWT_AUDIENCE || 'wdc-admin',
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '2h',
};
