/**
 * A minimal static file server for the browser tests.
 *
 * It serves the site root over HTTP, and proxies /api to the backend so
 * that the pages and the API share one origin. The pages read their API
 * base from window.__API_BASE__ when it is present, and fall back to the
 * relative path '/api', which is what happens when the dashboard is served
 * directly by the backend.
 *
 * Usage: node scripts/static-server.js <port> <root> [apiPort]
 */
import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const port = Number(process.argv[2]) || 5600;
const root = path.resolve(process.argv[3] || process.cwd());
const apiPort = Number(process.argv[4]) || 0;

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

/** Forward an API request to the backend and stream the answer back. */
const proxyApi = (req, res) => {
  if (!apiPort) {
    res.writeHead(502, { 'Content-Type': 'text/plain' });
    res.end('No API port was configured.');
    return;
  }

  const upstream = http.request(
    {
      hostname: '127.0.0.1',
      port: apiPort,
      path: req.url,
      method: req.method,
      headers: { ...req.headers, host: `127.0.0.1:${apiPort}` },
    },
    (upstreamRes) => {
      res.writeHead(upstreamRes.statusCode || 502, upstreamRes.headers);
      upstreamRes.pipe(res);
    }
  );

  upstream.on('error', () => {
    res.writeHead(502, { 'Content-Type': 'text/plain' });
    res.end('The API could not be reached.');
  });

  req.pipe(upstream);
};

const server = http.createServer((req, res) => {
  let pathname;
  try {
    pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  } catch (e) {
    res.writeHead(400);
    res.end('Bad request');
    return;
  }

  // The API is served from this same origin.
  if (pathname === '/api' || pathname.startsWith('/api/')) {
    proxyApi(req, res);
    return;
  }

  if (pathname === '/') pathname = '/home_the_void/code.html';

  // Never serve anything outside the root.
  const target = path.join(root, pathname);
  if (!target.startsWith(root)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  fs.readFile(target, (error, data) => {
    if (error) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not found');
      return;
    }

    // An HTML page is given the API base as a same-origin path, so the
    // browser talks to this server, which proxies /api to the backend. That
    // keeps the page and the API on one origin, which is what the backend's
    // CORS setting expects.
    if (path.extname(target) === '.html' && apiPort) {
      const html = data
        .toString('utf8')
        .replace(
          '<head>',
          '<head>\n<script>window.__API_BASE__ = "/api";</script>'
        );
      res.writeHead(200, {
        'Content-Type': TYPES['.html'],
        'Cache-Control': 'no-store',
      });
      res.end(html);
      return;
    }

    res.writeHead(200, {
      'Content-Type': TYPES[path.extname(target)] || 'application/octet-stream',
      'Cache-Control': 'no-store',
    });
    res.end(data);
  });
});

server.listen(port, '127.0.0.1', () => {
  console.log(
    `[static-server] listening on http://127.0.0.1:${port} (root: ${root}, api: ${apiPort})`
  );
});

const shutdown = () => {
  server.close(() => process.exit(0));
};
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
