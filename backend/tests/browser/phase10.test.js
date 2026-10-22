/**
 * Phase 10 accessibility and deployment-readiness browser tests.
 *
 * Each test here corresponds to a defect found by the Phase 10 audit.
 */
import puppeteer from 'puppeteer-core';
import { expect } from 'chai';
import { startServers, findChrome } from './harness.js';

let SITE_BASE = '';

describe('Phase 10 accessibility and deployment readiness', function () {
  // These tests load a full page and wait for it to settle, which takes
  // longer than mocha's 2-second default.
  this.timeout(30000);

  let servers;
  let browser;
  let page;

  before(async () => {
    servers = await startServers();
    SITE_BASE = servers.siteBase;
    browser = await puppeteer.launch({
      executablePath: await findChrome(),
      headless: 'new',
      args: ['--no-sandbox', '--disable-dev-shm-usage'],
    });
    page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 900 });
  });

  after(async () => {
    if (browser) await browser.close();
    if (servers) await servers.stop();
  });

  const PUBLIC_PAGES = [
    ['/post.html?slug=test-blog-post', 'article'],
    ['/grim_chronicles/code.html', 'blog'],
    ['/the_vault/code.html', 'vault'],
    ['/inquiries/code.html', 'inquiries'],
    ['/bookmarks/code.html', 'bookmarks'],
    ['/branching_stories/code.html', 'story listing'],
  ];

  describe('Labels and headings', () => {
    for (const [path, label] of PUBLIC_PAGES) {
      it(`should label every form control on the ${label} page`, async () => {
        await page.goto(`${SITE_BASE}${path}`, { waitUntil: 'domcontentloaded' });
        await new Promise((r) => setTimeout(r, 1500));

        const unlabelled = await page.evaluate(() =>
          Array.from(document.querySelectorAll('input, textarea, select'))
            .filter((el) => el.type !== 'hidden')
            .filter((el) => {
              const id = el.id;
              return !(
                (id && document.querySelector(`label[for="${id}"]`)) ||
                el.closest('label') ||
                el.getAttribute('aria-label') ||
                el.getAttribute('aria-labelledby')
              );
            })
            .map((el) => el.tagName.toLowerCase() + (el.id ? '#' + el.id : ''))
        );

        expect(unlabelled, `unlabelled controls on ${label}`).to.deep.equal([]);
      });

      it(`should give every image an alt attribute on the ${label} page`, async () => {
        await page.goto(`${SITE_BASE}${path}`, { waitUntil: 'domcontentloaded' });
        await new Promise((r) => setTimeout(r, 1500));

        const missing = await page.evaluate(() =>
          Array.from(document.querySelectorAll('img'))
            .filter((i) => !i.hasAttribute('alt'))
            .map((i) => i.src || i.id || 'unnamed')
        );

        expect(missing, `images without alt on ${label}`).to.deep.equal([]);
      });

      it(`should have exactly one h1 on the ${label} page`, async () => {
        await page.goto(`${SITE_BASE}${path}`, { waitUntil: 'domcontentloaded' });
        await new Promise((r) => setTimeout(r, 1500));

        const count = await page.evaluate(() => document.querySelectorAll('h1').length);
        expect(count, `h1 count on ${label}`).to.equal(1);
      });
    }
  });

  describe('Keyboard focus', () => {
    for (const [path, label] of PUBLIC_PAGES) {
      it(`should show a focus indicator on every focusable control of the ${label} page`, async () => {
        await page.goto(`${SITE_BASE}${path}`, { waitUntil: 'domcontentloaded' });
        await new Promise((r) => setTimeout(r, 1500));

        const without = await page.evaluate(() => {
          const focusables = Array.from(
            document.querySelectorAll(
              'a[href], button:not([disabled]), input:not([disabled]), select, textarea, [tabindex]:not([tabindex="-1"])'
            )
          ).filter((el) => el.offsetParent !== null || el.getClientRects().length > 0);

          const offenders = [];
          for (const el of focusables) {
            el.focus();
            const s = getComputedStyle(el);
            const hasOutline = s.outlineStyle !== 'none' && parseFloat(s.outlineWidth) > 0;
            const hasShadow = s.boxShadow && s.boxShadow !== 'none';
            if (!hasOutline && !hasShadow) {
              offenders.push(el.tagName.toLowerCase() + (el.id ? '#' + el.id : ''));
            }
          }
          return offenders;
        });

        expect(without, `controls without a focus ring on ${label}`).to.deep.equal([]);
      });
    }
  });

  describe('The API base URL must be configurable', () => {
    it('should not hardcode the development API origin in any page', async () => {
      const pages = [
        '/post.html',
        '/grim_chronicles/code.html',
        '/the_vault/code.html',
        '/inquiries/code.html',
        '/bookmarks/code.html',
        '/branching_stories/code.html',
        '/branching_stories/reader.html',
        '/public/admin/index.html',
      ];

      const hardcoded = [];
      for (const path of pages) {
        const res = await page.goto(`${SITE_BASE}${path}`, { waitUntil: 'domcontentloaded' });
        const html = await res.text();
        // The development origin may appear only as a fallback inside
        // reader-config.js, never as the value the page actually uses.
        const usesHardcodedApi = /const\s+API_BASE\s*=\s*'http:\/\/localhost:3000\/api'/.test(html);
        const adminHardcoded = /window\.__API_BASE__\s*=\s*'http:\/\/localhost:3000\/api'/.test(html);
        if (usesHardcodedApi || adminHardcoded) hardcoded.push(path);
      }

      expect(hardcoded, 'pages that hardcode the development API origin').to.deep.equal([]);
    });

    it('should resolve the API base through reader-config.js', async () => {
      await page.goto(`${SITE_BASE}/post.html?slug=test-blog-post`, {
        waitUntil: 'domcontentloaded',
      });
      await new Promise((r) => setTimeout(r, 1200));

      const resolved = await page.evaluate(() => ({
        hasConfig: !!(window.ReaderConfig && window.ReaderConfig.apiBase),
        value: window.ReaderConfig && window.ReaderConfig.apiBase,
        honoursOverride: (() => {
          const original = window.__API_BASE__;
          window.__API_BASE__ = 'https://api.example.com/api';
          const before = window.ReaderConfig.apiBase;
          window.__API_BASE__ = original;
          return before;
        })(),
      }));

      expect(resolved.hasConfig).to.equal(true);
      // The config must be a usable API base, not undefined.
      expect(resolved.value).to.be.a('string');
      expect(resolved.value.length).to.be.greaterThan(0);
    });
  });

  describe('Mobile layout', () => {
    for (const [path, label] of PUBLIC_PAGES) {
      it(`should not overflow horizontally at 390px on the ${label} page`, async () => {
        await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
        await page.goto(`${SITE_BASE}${path}`, { waitUntil: 'domcontentloaded' });
        await new Promise((r) => setTimeout(r, 1500));

        const state = await page.evaluate(() => ({
          scrollWidth: document.documentElement.scrollWidth,
          clientWidth: document.documentElement.clientWidth,
        }));

        expect(state.scrollWidth, `horizontal overflow on ${label}`).to.equal(state.clientWidth);
        await page.setViewport({ width: 1280, height: 900 });
      });
    }
  });

  describe('The admin modal', () => {
    it('should move the focus into the dialog, trap it, and restore it on Escape', async () => {
      await page.goto(`${SITE_BASE}/public/admin/index.html`, { waitUntil: 'domcontentloaded' });
      await new Promise((r) => setTimeout(r, 1500));

      await page.evaluate(() => {
        const opener = document.createElement('button');
        opener.id = 'probe-opener';
        opener.textContent = 'Open';
        document.body.appendChild(opener);
        opener.focus();
        openModal(
          '<label for="probe-input">Name</label><input id="probe-input" type="text"><button type="button">Inside</button>'
        );
      });
      await new Promise((r) => setTimeout(r, 400));

      const afterOpen = await page.evaluate(() => {
        const dialog = document.querySelector('[role="dialog"]');
        return {
          open: !document.getElementById('modal-overlay').classList.contains('hidden'),
          hasRole: dialog?.getAttribute('role') === 'dialog',
          ariaModal: dialog?.getAttribute('aria-modal') === 'true',
          hasLabel: !!document.getElementById(dialog?.getAttribute('aria-labelledby') || ''),
          focusInside: !!(dialog && dialog.contains(document.activeElement)),
        };
      });

      expect(afterOpen.open).to.equal(true);
      expect(afterOpen.hasRole).to.equal(true);
      expect(afterOpen.ariaModal).to.equal(true);
      expect(afterOpen.hasLabel).to.equal(true);
      expect(afterOpen.focusInside).to.equal(true);

      // The focus must not escape while the dialog is open.
      let escaped = false;
      for (let i = 0; i < 25; i += 1) {
        await page.keyboard.press('Tab');
        const inside = await page.evaluate(() => {
          const dialog = document.querySelector('[role="dialog"]');
          return !!(dialog && dialog.contains(document.activeElement));
        });
        if (!inside) {
          escaped = true;
          break;
        }
      }
      expect(escaped, 'the focus escaped the dialog').to.equal(false);

      // Escape closes it and the focus goes back to the opener.
      await page.keyboard.press('Escape');
      await new Promise((r) => setTimeout(r, 300));

      const afterClose = await page.evaluate(() => ({
        closed: document.getElementById('modal-overlay').classList.contains('hidden'),
        focusRestored: document.activeElement?.id === 'probe-opener',
      }));

      expect(afterClose.closed).to.equal(true);
      expect(afterClose.focusRestored).to.equal(true);
    });
  });

  describe('No page may spill source code into the rendered text', () => {
    // A literal closing script tag inside an inline script block terminates
    // that block early, and the rest of the JavaScript is rendered as visible
    // text on the page. Every page is checked for it.
    for (const [path, label] of PUBLIC_PAGES) {
      it(`should not render script source as text on the ${label} page`, async () => {
        await page.goto(`${SITE_BASE}${path}`, { waitUntil: 'domcontentloaded' });
        await new Promise((r) => setTimeout(r, 1200));

        const leaked = await page.evaluate(() => {
          const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
          const leaks = [];
          let node;
          while ((node = walker.nextNode())) {
            const text = node.textContent || '';
            // A text node that is a direct child of BODY (not inside a
            // SCRIPT or a code element) and that looks like source code.
            if (
              node.parentElement &&
              node.parentElement.tagName === 'BODY' &&
              (text.includes('__API_BASE__') ||
                text.includes('window.') ||
                text.includes('=>') ||
                text.includes('const '))
            ) {
              leaks.push(text.trim().slice(0, 120));
            }
          }
          return leaks;
        });

        expect(leaked, `script source rendered as text on ${label}`).to.deep.equal([]);
      });
    }

    it('should not render script source as text on the admin dashboard', async () => {
      await page.goto(`${SITE_BASE}/public/admin/index.html`, { waitUntil: 'domcontentloaded' });
      await new Promise((r) => setTimeout(r, 1500));

      const leaked = await page.evaluate(() => {
        const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
        const leaks = [];
        let node;
        while ((node = walker.nextNode())) {
          const text = node.textContent || '';
          if (
            node.parentElement &&
            node.parentElement.tagName === 'BODY' &&
            (text.includes('__API_BASE__') ||
              text.includes('window.') ||
              text.includes('// When it is not set'))
          ) {
            leaks.push(text.trim().slice(0, 160));
          }
        }
        return leaks;
      });

      expect(leaked, 'script source rendered as text on the admin dashboard').to.deep.equal([]);
    });
  });
});
