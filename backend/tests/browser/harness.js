import { spawn } from 'child_process';
import net from 'net';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

/**
 * The test harness for the browser tests.
 *
 * The browser tests need a real backend, a real static server and a real
 * browser. To keep them honest AND isolated, this harness starts its own
 * backend process with NODE_ENV=test, so it talks to the dedicated test
 * database and never to the live one, and it starts its own static server on
 * a port of its own.
 *
 * The static server also proxies /api to that backend, so the pages and the
 * API share one origin. That matters because the backend's CORS setting is
 * read from FRONTEND_ORIGIN in .env.test, and a cross-origin page would be
 * refused by the browser. Serving both from one origin keeps the browser
 * tests exercising the real code path without weakening the CORS setting.
 *
 * The whole thing is torn down again afterwards.
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BACKEND_DIR = path.resolve(__dirname, '..', '..');
const SITE_ROOT = path.resolve(__dirname, '..', '..', '..');

const CHROME_CANDIDATES = [
  path.join(
    process.env.USERPROFILE || 'C:/Users/Hp',
    '.cache/puppeteer/chrome/win64-148.0.7778.97/chrome-win64/chrome.exe'
  ),
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
];

/** Find a usable Chrome. */
export const findChrome = () => {
  for (const candidate of CHROME_CANDIDATES) {
    if (candidate && fs.existsSync(candidate)) return candidate;
  }
  const cacheRoot = path.join(
    process.env.USERPROFILE || 'C:/Users/Hp',
    '.cache/puppeteer/chrome'
  );
  if (fs.existsSync(cacheRoot)) {
    for (const build of fs.readdirSync(cacheRoot)) {
      const exe = path.join(cacheRoot, build, 'chrome-win64', 'chrome.exe');
      if (fs.existsSync(exe)) return exe;
    }
  }
  return null;
};

/** Poll a URL until it answers, or give up. */
const waitFor = async (url, attempts = 60, delay = 300) => {
  for (let i = 0; i < attempts; i += 1) {
    try {
      const response = await fetch(url);
      if (response.ok || response.status === 404) return true;
    } catch (e) {
      /* not up yet */
    }
    await new Promise((resolve) => setTimeout(resolve, delay));
  }
  return false;
};

/**
 * Find a free TCP port.
 *
 * A fixed port would make two concurrent runs fight over it, so a free port
 * is chosen each time. The port is released before the server is started,
 * which is good enough for a test harness.
 */
const freePort = async () =>
  new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });

/**
 * Start the backend and the static server, and return their details.
 *
 * The backend is started with NODE_ENV=test, which is what makes it load
 * .env.test and target the dedicated test database.
 */
export const startServers = async (options = {}) => {
  const backendPort = options.backendPort || (await freePort());
  const sitePort = options.sitePort || (await freePort());

  const backend = spawn(process.execPath, [path.join(BACKEND_DIR, 'src', 'index.js')], {
    cwd: BACKEND_DIR,
    env: {
      ...process.env,
      NODE_ENV: 'test',
      PORT: String(backendPort),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  const site = spawn(
    process.execPath,
    [
      path.join(BACKEND_DIR, 'scripts', 'static-server.js'),
      String(sitePort),
      SITE_ROOT,
      String(backendPort),
    ],
    {
      cwd: BACKEND_DIR,
      stdio: ['ignore', 'pipe', 'pipe'],
    }
  );

  const backendLog = [];
  const siteLog = [];
  backend.stdout.on('data', (d) => backendLog.push(d.toString()));
  backend.stderr.on('data', (d) => backendLog.push(d.toString()));
  site.stdout.on('data', (d) => siteLog.push(d.toString()));
  site.stderr.on('data', (d) => siteLog.push(d.toString()));

  const apiBase = `http://127.0.0.1:${backendPort}/api`;
  const siteBase = `http://127.0.0.1:${sitePort}`;

  const apiUp = await waitFor(`${apiBase}/health`);
  if (!apiUp) {
    backend.kill();
    site.kill();
    throw new Error(
      `The test backend did not start on port ${backendPort}.\n${backendLog.join('')}`
    );
  }

  const siteUp = await waitFor(`${siteBase}/post.html`);
  if (!siteUp) {
    backend.kill();
    site.kill();
    throw new Error(
      `The test static server did not start on port ${sitePort}.\n${siteLog.join('')}`
    );
  }

  return {
    apiBase,
    siteBase,
    backend,
    site,
    logs: { backend: backendLog, site: siteLog },
    stop: async () => {
      backend.kill();
      site.kill();
      await new Promise((resolve) => setTimeout(resolve, 300));
    },
  };
};
