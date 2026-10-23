
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import dotenv from 'dotenv';
import { randomBytes } from 'crypto';
import { readFile } from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import cookieParser from 'cookie-parser';
import { errorHandler } from './middleware/error.js';
import postRoutes from './routes/posts.routes.js';
import categoryRoutes from './routes/categories.routes.js';
import artifactRoutes from './routes/artifacts.routes.js';
import authRoutes from './routes/auth.routes.js';
import inquiryRoutes from './routes/inquiry.routes.js';
import commentRoutes from './routes/comment.routes.js';
import adminRoutes from './routes/admin.routes.js';
import storyRoutes from './routes/stories.routes.js';
import { protect } from './middleware/auth.js';
import { generateToken, sessionMiddleware } from './middleware/csrf.js';
import { loadTestEnv, isTestEnv, envTestPath } from './lib/test-env.js';
import prisma from './lib/prisma.js';

// In test mode the dedicated test configuration is loaded and validated
// first, so a missing or mis-pointed test database aborts the run instead of
// silently falling back to the live database.
loadTestEnv();
dotenv.config({ path: isTestEnv() ? envTestPath : undefined });

const app = express();
const siteRoot = path.resolve(fileURLToPath(new URL('../../', import.meta.url)));

app.use((req, res, next) => {
  res.locals.cspNonce = randomBytes(16).toString('base64');
  next();
});

app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      scriptSrc: [
        "'self'",
        (req, res) => `'nonce-${res.locals.cspNonce}'`,
        'https://cdn.tailwindcss.com',
      ],
      scriptSrcAttr: [
        "'unsafe-hashes'",
        "'sha256-2r+bErCDCyg5KnmYpxSw4m8UPgtsLYHt6dH+fNGZyPc='",
      ],
      styleSrc: [
        "'self'",
        "'unsafe-inline'",
        'https://fonts.googleapis.com',
        'https://fonts.cdnfonts.com',
      ],
      fontSrc: [
        "'self'",
        'https://fonts.gstatic.com',
        'https://fonts.cdnfonts.com',
        'data:',
      ],
      imgSrc: ["'self'", 'data:', 'https:'],
      connectSrc: ["'self'"],
    },
  },
}));

/**
 * CORS configuration.
 *
 * The double submit cookie CSRF pattern requires the session cookie to be
 * sent with cross-origin requests, so `credentials` must stay enabled. That
 * makes the wildcard origin unusable: `Access-Control-Allow-Origin: *`
 * combined with `Access-Control-Allow-Credentials: true` is rejected by
 * browsers and would, in any case, expose the API to every origin.
 *
 * The allowed origins therefore come from FRONTEND_ORIGIN, which is a
 * comma-separated list. When nothing is configured the API is same-origin
 * only, which is the correct default for a deployment that serves the
 * frontend and the API from one host.
 */

/**
 * The development origins that are always permitted.
 *
 * `localhost` and `127.0.0.1` are DIFFERENT origins to a browser, even
 * though they usually reach the same machine. A developer who opens the
 * site on one of them and points the API at the other gets a CORS failure
 * that looks like a server fault:
 *
 *   Access to fetch at 'http://localhost:3000/api/auth/csrf-token' from
 *   origin 'http://127.0.0.1:5500' has been blocked by CORS policy: No
 *   'Access-Control-Allow-Origin' header is present on the requested
 *   resource.
 *
 * The request is answered with 200; the browser simply refuses to hand the
 * response to the page, because the header that would authorise it is
 * missing.
 *
 * Both loopback spellings are therefore allowed in development. These are
 * loopback addresses: no other machine on the network can reach them, and
 * a page served from one of them is a page on the developer's own
 * computer.
 *
 * They are NOT allowed in production. A production deployment must name
 * its real origins in FRONTEND_ORIGIN, and this list is not consulted
 * there.
 */
const DEVELOPMENT_ORIGINS = ['http://localhost:5500', 'http://127.0.0.1:5500'];

const isProduction = process.env.NODE_ENV === 'production';

/** The origins configured for this environment. */
const configuredOrigins = (process.env.FRONTEND_ORIGIN || '')
  .split(',')
  .map((o) => o.trim())
  .filter(Boolean);

/**
 * The complete allow-list.
 *
 * The configured origins are always included. The development origins are
 * added ONLY outside production, so a production deployment can never
 * accidentally trust a loopback origin.
 */
const allowedOrigins = isProduction
  ? [...new Set(configuredOrigins)]
  : [...new Set([...configuredOrigins, ...DEVELOPMENT_ORIGINS])];

const corsOptions = {
  origin(origin, callback) {
    // No Origin header: same-origin, curl, or a server-side call. Allowed.
    if (!origin) return callback(null, true);

    if (allowedOrigins.includes('*')) {
      // An explicit '*' in the allow-list still cannot be combined with
      // credentials, so echo nothing and let the browser block it.
      return callback(null, false);
    }

    if (allowedOrigins.includes(origin)) return callback(null, true);

    return callback(null, false);
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'X-CSRF-Token', 'X-Requested-With'],
  exposedHeaders: ['X-CSRF-Token'],
  maxAge: 600,
};

app.use(cors(corsOptions));
app.use(morgan('dev'));

/**
 * Reverse-proxy awareness.
 *
 * The rate limiters key on the client IP. Behind a reverse proxy (nginx, a
 * load balancer, a CDN) every request arrives with the proxy's own address,
 * so without this setting every visitor shares ONE bucket and the first five
 * visitors to arrive lock everybody else out of commenting, logging in and
 * sending inquiries.
 *
 * The hop count is explicit and configurable:
 *
 *   TRUST_PROXY_HOPS=0   the API is exposed directly, no proxy in front
 *   TRUST_PROXY_HOPS=1   one proxy in front (the usual deployment)
 *   TRUST_PROXY_HOPS=2   a CDN in front of a proxy
 *
 * It is never set to `true`, which would make the API believe any
 * X-Forwarded-For header it is given and let a client spoof its own IP to
 * escape the rate limit.
 */
const TRUST_PROXY_HOPS = (() => {
  const raw = process.env.TRUST_PROXY_HOPS;
  if (raw === undefined || raw === '') return 0; // direct exposure by default
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 0 || parsed > 10) {
    console.error(
      `FATAL: TRUST_PROXY_HOPS must be an integer between 0 and 10 (received "${raw}").`
    );
    process.exit(1);
  }
  return parsed;
})();

if (TRUST_PROXY_HOPS > 0) {
  app.set('trust proxy', TRUST_PROXY_HOPS);
}

/**
 * Request body limits.
 *
 * The limit has to be larger than the largest value the content validators
 * accept, or a legitimate submission is rejected by the parser before the
 * validator ever sees it. The largest documented field is a blog post body
 * (LIMITS.contentMax in src/lib/content-validation.js = 200000 characters),
 * and a story node body is LIMITS.nodeContentMax = 10000 characters.
 *
 * A JSON body carries the field plus its JSON overhead, so the transport
 * limit is set with headroom above the largest single field rather than
 * exactly on it. Anything beyond this is refused with 413, which is the
 * correct answer for an oversized body: the request is not a valid
 * submission, and it must never reach the database.
 */
const MAX_BODY_BYTES = 512 * 1024; // 512 KB

app.use(express.json({ limit: MAX_BODY_BYTES }));
app.use(express.urlencoded({ extended: true, limit: MAX_BODY_BYTES }));
app.use(cookieParser());
app.use(sessionMiddleware);

// CSRF Token Endpoint
app.get('/api/auth/csrf-token', (req, res) => {
  try {
    const token = generateToken(req, res);
    res.json({ token });
  } catch (e) {
    console.error('NEW CSRF Token Error Stack:', e);
    res.status(500).json({ error: e.message });
  }
});

app.use('/api/posts', postRoutes);
app.use('/api/categories', categoryRoutes);
app.use('/api/artifacts', artifactRoutes);
app.use('/api/auth', authRoutes);
app.use('/api/inquiries', inquiryRoutes);
app.use('/api/comments', commentRoutes);
app.use('/api/stories', storyRoutes);
app.use('/api/admin', adminRoutes);

// Protected test route for security verification
app.get('/api/admin/test-auth', protect, (req, res) => res.json({ status: 'ok' }));

app.get('/api/health', async (req, res) => {
  // The health check reports whether the database is actually reachable, so a
  // deployment can be monitored on the thing that matters. A database that is
  // down must be reported as a failure (503), not as a healthy service with
  // an "unconfigured" note: a load balancer that only sees the status code
  // would keep sending traffic to a broken instance.
  let database = 'unavailable';
  try {
    await prisma.$queryRaw`SELECT 1`;
    database = 'connected';
  } catch (error) {
    database = 'unavailable';
  }

  const healthy = database === 'connected';

  res.status(healthy ? 200 : 503).json({
    status: healthy ? 'ok' : 'degraded',
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || 'development',
    services: {
      database,
    },
  });
});

const serveHtmlFile = async (filePath, res, next) => {
  try {
    const html = await readFile(filePath, 'utf8');
    const nonce = res.locals.cspNonce;
    const securedHtml = html.replace(
      /<script\b(?![^>]*\bnonce=)([^>]*)>/gi,
      `<script nonce="${nonce}"$1>`
    );
    res.set('Cache-Control', 'no-store');
    res.type('html').send(securedHtml);
  } catch (error) {
    if (error.code === 'ENOENT') return next();
    return next(error);
  }
};

app.get('/', (req, res, next) => {
  serveHtmlFile(path.join(siteRoot, 'home_the_void', 'code.html'), res, next);
});

const adminRoot = path.join(siteRoot, 'public', 'admin');
app.get(['/admin', '/admin/'], (req, res, next) => {
  serveHtmlFile(path.join(adminRoot, 'index.html'), res, next);
});
app.use('/admin', express.static(adminRoot, { dotfiles: 'deny', index: false }));

for (const directory of [
  'bookmarks',
  'branching_stories',
  'grim_chronicles',
  'home_the_void',
  'inquiries',
  'obsidian_ink',
  'public',
  'the_vault',
  'the_vault_artifact_modal_view',
]) {
  const directoryRoot = path.resolve(siteRoot, directory);
  app.use(`/${directory}`, (req, res, next) => {
    if (!req.path.toLowerCase().endsWith('.html')) return next();

    const filePath = path.resolve(directoryRoot, `.${req.path}`);
    if (!filePath.startsWith(`${directoryRoot}${path.sep}`)) {
      return res.sendStatus(404);
    }

    return serveHtmlFile(filePath, res, next);
  });

  app.use(
    `/${directory}`,
    express.static(directoryRoot, {
      dotfiles: 'deny',
      index: false,
    })
  );
}

for (const filename of [
  'favicon.svg',
  'post.html',
  'reader-config.js',
  'reader-data.js',
  'reader-ui.js',
  'reader.css',
]) {
  app.get(`/${filename}`, (req, res, next) => {
    if (filename.endsWith('.html')) {
      return serveHtmlFile(path.join(siteRoot, filename), res, next);
    }
    res.sendFile(path.join(siteRoot, filename));
  });
}

app.use(errorHandler);

export default app;