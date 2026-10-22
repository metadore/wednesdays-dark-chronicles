/**
 * CORS tests for the development origins.
 *
 * The defect these cover: the admin dashboard is served from
 * `http://127.0.0.1:5500` while the API's allow-list named only
 * `http://localhost:5500`. A browser treats those as different origins, so
 * the API answered 200 without an `Access-Control-Allow-Origin` header and
 * the browser refused to hand the response to the page:
 *
 *   Access to fetch at 'http://localhost:3000/api/auth/csrf-token' from
 *   origin 'http://127.0.0.1:5500' has been blocked by CORS policy: No
 *   'Access-Control-Allow-Origin' header is present on the requested
 *   resource.
 *
 * Each test states which half of the contract it protects: the allowed
 * origin must be granted access, an unapproved origin must not be, and
 * none of it may weaken CSRF, authentication or the rate limiters.
 */
import request from 'supertest';
import { expect } from 'chai';
import path from 'path';
import { fileURLToPath } from 'url';
import { spawn } from 'child_process';
import app from '../../src/app.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const backendDir = path.resolve(__dirname, '..', '..');

const DEV_ORIGIN = 'http://127.0.0.1:5500';
const OTHER_DEV_ORIGIN = 'http://localhost:5500';

describe('CORS: the development origins', () => {
  describe('The allowed development origin', () => {
    it('should be granted access to the CSRF token endpoint', async () => {
      const res = await request(app)
        .get('/api/auth/csrf-token')
        .set('Origin', DEV_ORIGIN);

      expect(res.status).to.equal(200);
      expect(res.headers['access-control-allow-origin']).to.equal(DEV_ORIGIN);
    });

    it('should be granted credentialed access', async () => {
      const res = await request(app)
        .get('/api/auth/csrf-token')
        .set('Origin', DEV_ORIGIN);

      // The double-submit pattern needs the session cookie to travel, so
      // credentials must be allowed for the allowed origin.
      expect(res.headers['access-control-allow-credentials']).to.equal('true');
    });

    it('should be granted access to an administrative endpoint', async () => {
      const res = await request(app)
        .get('/api/admin/posts')
        .set('Origin', DEV_ORIGIN);

      // The CORS headers are present even though the request is refused:
      // the browser must be able to READ the 401 to show it to the user.
      expect(res.status).to.equal(401);
      expect(res.headers['access-control-allow-origin']).to.equal(DEV_ORIGIN);
    });

    it('should receive a readable CSRF token', async () => {
      const res = await request(app)
        .get('/api/auth/csrf-token')
        .set('Origin', DEV_ORIGIN);

      expect(res.body).to.have.property('token');
      expect(res.body.token).to.be.a('string');
      expect(res.body.token.length).to.be.greaterThan(0);
    });

    it('should vary the response on the Origin header', async () => {
      const res = await request(app)
        .get('/api/auth/csrf-token')
        .set('Origin', DEV_ORIGIN);

      // Without Vary: Origin a cache could serve one origin's response to
      // another origin.
      expect(res.headers['vary']).to.match(/Origin/i);
    });
  });

  describe('Both loopback spellings', () => {
    it('should grant access to the configured spelling', async () => {
      const res = await request(app)
        .get('/api/auth/csrf-token')
        .set('Origin', OTHER_DEV_ORIGIN);

      expect(res.headers['access-control-allow-origin']).to.equal(OTHER_DEV_ORIGIN);
    });

    it('should grant access to the numeric spelling', async () => {
      const res = await request(app)
        .get('/api/auth/csrf-token')
        .set('Origin', DEV_ORIGIN);

      expect(res.headers['access-control-allow-origin']).to.equal(DEV_ORIGIN);
    });
  });

  describe('An unapproved origin', () => {
    const UNAPPROVED = [
      'https://evil.example',
      'http://127.0.0.1:5501', // a different port on the same host
      'http://localhost:5501',
      'https://localhost:5500', // https, not http
      'http://127.0.0.1:3000', // the API's own origin
      'null', // a sandboxed iframe or a file:// page
    ];

    for (const origin of UNAPPROVED) {
      it(`should not be granted access to the API from ${origin}`, async () => {
        const res = await request(app)
          .get('/api/auth/csrf-token')
          .set('Origin', origin);

        // The request may still be answered, but the browser must not be
        // given permission to read the response.
        expect(res.headers['access-control-allow-origin']).to.not.equal(origin);
        expect(res.headers['access-control-allow-origin']).to.not.equal('*');
      });
    }

    it('should not be granted access to an administrative endpoint', async () => {
      const res = await request(app)
        .get('/api/admin/posts')
        .set('Origin', 'https://evil.example');

      expect(res.headers['access-control-allow-origin']).to.not.equal('*');
    });
  });

  describe('The preflight for an allowed origin', () => {
    it('should answer with the permitted methods and headers', async () => {
      const res = await request(app)
        .options('/api/admin/posts')
        .set('Origin', DEV_ORIGIN)
        .set('Access-Control-Request-Method', 'POST')
        .set('Access-Control-Request-Headers', 'content-type,x-csrf-token');

      expect(res.status).to.be.oneOf([200, 204]);
      expect(res.headers['access-control-allow-origin']).to.equal(DEV_ORIGIN);
      expect(res.headers['access-control-allow-credentials']).to.equal('true');
      expect(res.headers['access-control-allow-methods']).to.include('POST');
      expect(res.headers['access-control-allow-headers'].toLowerCase()).to.include('x-csrf-token');
    });

    it('should not grant a preflight to an unapproved origin', async () => {
      const res = await request(app)
        .options('/api/admin/posts')
        .set('Origin', 'https://evil.example')
        .set('Access-Control-Request-Method', 'POST');

      expect(res.headers['access-control-allow-origin']).to.not.equal('*');
    });
  });

  describe('The development origins must not leak into production', () => {
    // The allow-list is built once, at startup, so this runs a real
    // production instance in its own process and queries it over HTTP.
    // The child is started with `spawn` (not `spawnSync`) because it has
    // to keep running while the test queries it.
    const startProduction = (frontendOrigin) =>
      new Promise((resolve, reject) => {
        const child = spawn(
          process.execPath,
          [
            '-e',
            [
              "import('./src/app.js').then(m => {",
              "  const http = require('http');",
              "  const srv = http.createServer(m.default);",
              "  srv.listen(0, '127.0.0.1', () => console.log('PORT=' + srv.address().port));",
              "}).catch(e => { console.error('ERR:' + e.message); process.exit(1); });",
            ].join('\n'),
          ],
          {
            cwd: backendDir,
            env: {
              PATH: process.env.PATH,
              SystemRoot: process.env.SystemRoot,
              NODE_ENV: 'production',
              FRONTEND_ORIGIN: frontendOrigin,
              JWT_SECRET: 'x'.repeat(48),
              CSRF_SECRET: 'y'.repeat(48),
            },
          }
        );

        let out = '';
        let err = '';
        const timer = setTimeout(() => {
          child.kill();
          reject(new Error(`the production instance did not start. stdout: ${out} stderr: ${err}`));
        }, 30000);

        child.stdout.on('data', (d) => {
          out += d.toString();
          const m = out.match(/PORT=(\d+)/);
          if (m) {
            clearTimeout(timer);
            resolve({ port: m[1], child, stderr: () => err });
          }
        });
        child.stderr.on('data', (d) => {
          err += d.toString();
        });
        child.on('exit', (code) => {
          clearTimeout(timer);
          reject(new Error(`the production instance exited with ${code}. stderr: ${err}`));
        });
      });

    it('should refuse the development origins in production', async () => {
      const instance = await startProduction('https://example.com');

      try {
        // A production instance must not trust a loopback origin, even
        // though the same instance in development does.
        for (const origin of ['http://127.0.0.1:5500', 'http://localhost:5500']) {
          const res = await request(`http://127.0.0.1:${instance.port}`)
            .get('/api/auth/csrf-token')
            .set('Origin', origin);

          expect(res.headers['access-control-allow-origin'], origin).to.not.equal(origin);
          expect(res.headers['access-control-allow-origin'], origin).to.not.equal('*');
        }
      } finally {
        instance.child.kill();
      }
    });

    it('should still allow the configured production origin', async () => {
      const instance = await startProduction('https://example.com');

      try {
        const res = await request(`http://127.0.0.1:${instance.port}`)
          .get('/api/auth/csrf-token')
          .set('Origin', 'https://example.com');

        expect(res.headers['access-control-allow-origin']).to.equal('https://example.com');
        expect(res.headers['access-control-allow-credentials']).to.equal('true');
      } finally {
        instance.child.kill();
      }
    });
  });

  describe('The CORS fix must not weaken the other protections', () => {
    it('should still refuse a CSRF request with no token', async () => {
      const res = await request(app)
        .post('/api/comments')
        .set('Origin', DEV_ORIGIN)
        .send({ postId: 'x', author: 'a', content: 'c' });

      expect(res.status).to.equal(403);
      // The refusal must still be readable by the page.
      expect(res.headers['access-control-allow-origin']).to.equal(DEV_ORIGIN);
    });

    it('should still refuse a CSRF request with an invalid token', async () => {
      const res = await request(app)
        .post('/api/comments')
        .set('Origin', DEV_ORIGIN)
        .set('x-csrf-token', 'not-a-real-token')
        .send({ postId: 'x', author: 'a', content: 'c' });

      expect(res.status).to.equal(403);
    });

    it('should still refuse a CSRF request with a token from another session', async () => {
      const otherAgent = request.agent(app);
      const csrfRes = await otherAgent.get('/api/auth/csrf-token');
      const otherToken = csrfRes.body.token;

      const agent = request.agent(app);
      await agent.get('/api/auth/csrf-token');

      const res = await agent
        .post('/api/comments')
        .set('Origin', DEV_ORIGIN)
        .set('x-csrf-token', otherToken)
        .send({ postId: 'x', author: 'a', content: 'c' });

      expect(res.status).to.equal(403);
    });

    it('should still refuse an administrative endpoint without a session', async () => {
      const res = await request(app)
        .get('/api/admin/posts')
        .set('Origin', DEV_ORIGIN);

      expect(res.status).to.equal(401);
      expect(res.body.error).to.equal('Authentication required');
    });

    it('should still refuse an administrative mutation without a CSRF token', async () => {
      const res = await request(app)
        .post('/api/admin/posts')
        .set('Origin', DEV_ORIGIN)
        .send({ title: 't', slug: 'cors-probe', content: 'c' });

      // The session is missing first, and the CSRF token second. Either
      // way the request is refused.
      expect(res.status).to.be.oneOf([401, 403]);
    });

    it('should still carry the security headers', async () => {
      const res = await request(app)
        .get('/api/auth/csrf-token')
        .set('Origin', DEV_ORIGIN);

      expect(res.headers['x-content-type-options']).to.equal('nosniff');
      expect(res.headers['x-frame-options']).to.equal('SAMEORIGIN');
      expect(res.headers['content-security-policy']).to.be.a('string');
    });
  });
});
