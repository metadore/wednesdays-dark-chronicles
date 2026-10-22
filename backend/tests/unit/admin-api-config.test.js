/**
 * Tests for the admin dashboard's API base resolution.
 *
 * `public/admin/api-config.js` is a browser script, but it is written so
 * that it can also be loaded in Node, with a fake `window`. That lets the
 * resolution rules be tested directly instead of only through a browser.
 *
 * The defect these cover: the dashboard used a relative '/api' base, which
 * on a development page served from a static server on port 5500 points at
 * that static server rather than at the API on port 3000. Every request
 * then failed, and the page looked broken.
 *
 * The rules that must hold:
 *
 *   - an explicit override (window.__API_BASE__) always wins;
 *   - the host's meta tag is honoured;
 *   - a page opened on a loopback address uses the backend's port on the
 *     SAME host name, so the SameSite=Strict session cookie is sent;
 *   - a page served from a real host never falls back to a development
 *     origin, and uses the same-origin '/api' path instead.
 */
import { expect } from 'chai';
import fs from 'fs';
import path from 'path';
import vm from 'vm';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..', '..', '..');
const API_CONFIG_PATH = path.join(PROJECT_ROOT, 'public', 'admin', 'api-config.js');

const source = fs.readFileSync(API_CONFIG_PATH, 'utf8');

/**
 * Load api-config.js with a fake window.
 *
 * @param {object} window  the fake window: location, __API_BASE__, and an
 *                         optional document with a meta tag.
 * @returns {string} the resolved API base.
 */
const resolveWith = (window) => {
  // In a browser the script's `root` is globalThis, which IS the window.
  // The sandbox plays the part of the window here.
  const sandbox = { ...window };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(source, sandbox);
  return sandbox.AdminConfig.apiBase;
};

/** A fake document that exposes one meta tag, if any. */
const documentWithMeta = (content) => ({
  querySelector(selector) {
    if (selector !== 'meta[name="api-base"]') return null;
    if (content === undefined || content === null) return null;
    return { getAttribute: () => content };
  },
});

describe("The admin dashboard's API base", () => {
  describe('The explicit override', () => {
    it('should use the configured origin', () => {
      const base = resolveWith({
        __API_BASE__: 'https://api.example.com/api',
        location: { hostname: 'example.com', port: '443' },
      });

      expect(base).to.equal('https://api.example.com/api');
    });

    it('should add the /api path when the host omits it', () => {
      const base = resolveWith({
        __API_BASE__: 'https://api.example.com',
        location: { hostname: 'example.com', port: '443' },
      });

      expect(base).to.equal('https://api.example.com/api');
    });

    it('should beat the development fallback', () => {
      const base = resolveWith({
        __API_BASE__: 'http://127.0.0.1:3999/api',
        location: { hostname: '127.0.0.1', port: '5500' },
      });

      expect(base).to.equal('http://127.0.0.1:3999/api');
    });
  });

  describe("The host's meta tag", () => {
    it('should be used when there is no explicit override', () => {
      const base = resolveWith({
        document: documentWithMeta('https://api.example.com/api'),
        location: { hostname: 'example.com', port: '443' },
      });

      expect(base).to.equal('https://api.example.com/api');
    });

    it('should be ignored when an explicit override is present', () => {
      const base = resolveWith({
        __API_BASE__: 'http://127.0.0.1:3999/api',
        document: documentWithMeta('https://api.example.com/api'),
        location: { hostname: '127.0.0.1', port: '5500' },
      });

      expect(base).to.equal('http://127.0.0.1:3999/api');
    });
  });

  describe('The development fallback', () => {
    it('should point at the backend port for a loopback page', () => {
      const base = resolveWith({
        location: { hostname: '127.0.0.1', port: '5500' },
      });

      expect(base).to.equal('http://127.0.0.1:3000/api');
    });

    it('should keep the page host name, so the session cookie is sent', () => {
      const base = resolveWith({
        location: { hostname: 'localhost', port: '5500' },
      });

      // The API sets its cookie with SameSite=Strict. A page on
      // 'localhost' talking to '127.0.0.1' is a different site to a
      // browser, and the cookie would never be sent back.
      expect(base).to.equal('http://localhost:3000/api');
    });

    it('should not fire when the page is already the API host', () => {
      const base = resolveWith({
        location: { hostname: 'localhost', port: '3000' },
      });

      expect(base).to.equal('/api');
    });
  });

  describe('The same-origin default', () => {
    it('should be used for a page on a real host', () => {
      const base = resolveWith({
        location: { hostname: 'example.com', port: '443' },
      });

      // A production deployment must never send its administrators' requests
      // to their own machine.
      expect(base).to.equal('/api');
    });

    it('should be used when there is no location at all', () => {
      const base = resolveWith({});

      expect(base).to.equal('/api');
    });
  });

  describe('The dashboard script', () => {
    it('should read the base from the resolved configuration', () => {
      const appSource = fs.readFileSync(
        path.join(PROJECT_ROOT, 'public', 'admin', 'app.js'),
        'utf8'
      );

      expect(appSource).to.include('window.AdminConfig');
    });

    it('should not hardcode a development origin', () => {
      const appSource = fs.readFileSync(
        path.join(PROJECT_ROOT, 'public', 'admin', 'app.js'),
        'utf8'
      );
      const html = fs.readFileSync(
        path.join(PROJECT_ROOT, 'public', 'admin', 'index.html'),
        'utf8'
      );

      expect(appSource).to.not.include('localhost:3000');
      expect(html).to.not.include('localhost:3000');
    });

    it('should load the configuration script before the dashboard script', () => {
      const html = fs.readFileSync(
        path.join(PROJECT_ROOT, 'public', 'admin', 'index.html'),
        'utf8'
      );

      expect(html.indexOf('api-config.js')).to.be.greaterThan(-1);
      expect(html.indexOf('api-config.js')).to.be.lessThan(html.indexOf('app.js'));
    });
  });
});
