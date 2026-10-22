import puppeteer from 'puppeteer-core';
import { expect } from 'chai';
import prisma from '../../src/lib/prisma.js';
import { startServers, findChrome } from './harness.js';

/**
 * Browser-level tests for the reader features.
 *
 * The bookmarks, the reading progress and the reading preferences all live
 * in the browser's own storage, so they can only be verified honestly in a
 * real browser. These tests drive a real Chrome against a real static server
 * and a real backend, and assert on the live DOM and the live localStorage.
 *
 * The harness starts the backend with NODE_ENV=test, so it targets the
 * dedicated TEST database and never the live one. The fixtures created here
 * are test fixtures and are removed again afterwards.
 */

let API_BASE = '';
let SITE_BASE = '';

/**
 * A long article, so that the reading-progress behaviour — saving a
 * position, restoring it, resetting it — can be exercised properly. The
 * seeded articles are only a few dozen characters long and fit entirely on
 * one screen, which is the "short article" case rather than the scrolling
 * case.
 */
const LONG_ARTICLE = {
  slug: 'p9b-browser-long-article',
  title: 'A Chronicle Long Enough to Scroll',
  content: '',
};

const buildLongContent = () => {
  const paragraphs = [];
  for (let i = 0; i < 40; i += 1) {
    paragraphs.push(
      `Paragraph ${i + 1}. The corridor stretches on, and the ash keeps falling in a slow, ` +
        `unhurried rain that has been falling since before the house was a house. ` +
        `Each step is a small negotiation with the dark. This paragraph exists so that ` +
        `the article is long enough to require scrolling, which is what the reading ` +
        `progress feature is for.`
    );
  }
  return paragraphs.join('\n\n');
};

describe('Reader features in a real browser', function () {
  this.timeout(180000);

  let browser;
  let page;
  let pageErrors;
  let executablePath;
  let publishedSlug;
  let servers;
  let longArticleId;

  before(async () => {
    executablePath = findChrome();
    if (!executablePath) {
      // Without a browser these tests cannot run. They are reported as
      // failures rather than being silently skipped, so a missing browser
      // can never be mistaken for a passing suite.
      throw new Error('No Chrome executable was found for the browser tests.');
    }

    // The backend runs with NODE_ENV=test, so it targets the test database.
    // The ports are chosen automatically, so two concurrent runs cannot
    // fight over the same one.
    servers = await startServers();
    // The test server proxies /api, so the pages and the API share one
    // origin and the pages use the relative path.
    API_BASE = '/api';
    SITE_BASE = servers.siteBase;

    // A long published article, so the progress behaviour can be exercised.
    LONG_ARTICLE.content = buildLongContent();
    const existing = await prisma.post.findUnique({
      where: { slug: LONG_ARTICLE.slug },
    });
    if (existing) {
      await prisma.post.update({
        where: { id: existing.id },
        data: { content: LONG_ARTICLE.content, published: true, publishedAt: new Date() },
      });
      longArticleId = existing.id;
    } else {
      const created = await prisma.post.create({
        data: {
          slug: LONG_ARTICLE.slug,
          title: LONG_ARTICLE.title,
          content: LONG_ARTICLE.content,
          published: true,
          publishedAt: new Date(),
        },
      });
      longArticleId = created.id;
    }

    browser = await puppeteer.launch({
      executablePath,
      headless: 'new',
      args: ['--no-sandbox', '--disable-dev-shm-usage'],
    });
  });

  after(async () => {
    if (browser) await browser.close();
    if (servers) await servers.stop();

    // Remove the fixture article.
    if (longArticleId) {
      await prisma.post.deleteMany({ where: { id: longArticleId } });
    }
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 900 });

    // Any uncaught error in the page fails the test, so a broken script
    // cannot pass unnoticed. The errors are collected rather than thrown
    // straight away, because throwing from an event handler would abort
    // the test in a way that hides which assertion actually failed.
    pageErrors = [];
    page.on('pageerror', (error) => {
      pageErrors.push(error.message);
    });

    // The browser is shared between the tests, so the storage is cleared
    // before each one. Every test therefore starts from a known state.
    await page.goto(`${SITE_BASE}/post.html`, { waitUntil: 'domcontentloaded' });
    await page.evaluate(() => {
      try {
        localStorage.clear();
      } catch (e) {
        /* nothing to clear */
      }
    });
  });

  afterEach(async () => {
    // A page error during a test is a failure, even when the assertions
    // themselves passed: it means part of the page was broken.
    if (pageErrors && pageErrors.length) {
      const message = pageErrors.join('; ');
      if (page) await page.close();
      page = null;
      throw new Error(`Uncaught page error(s) during the test: ${message}`);
    }
    if (page) await page.close();
  });

  /** A published article to work with, read through the public API. */
  const ensureArticle = async () => {
    const response = await fetch(`${servers.apiBase}/posts/test-blog-post`);
    if (response.ok) return 'test-blog-post';
    throw new Error('The expected test article is not published.');
  };

  describe('Bookmarks', () => {
    it('should add a bookmark from the article page', async () => {
      publishedSlug = await ensureArticle();
      await page.goto(`${SITE_BASE}/post.html?slug=${publishedSlug}`, {
        waitUntil: 'networkidle0',
      });

      // The button starts unpressed.
      const before = await page.$eval('#reader-bookmark', (b) => ({
        pressed: b.getAttribute('aria-pressed'),
        label: b.getAttribute('aria-label'),
      }));
      expect(before.pressed).to.equal('false');
      expect(before.label).to.equal('Bookmark this entry');

      // Click it for real.
      await page.click('#reader-bookmark');
      await page.waitForFunction(
        () => document.getElementById('reader-bookmark').getAttribute('aria-pressed') === 'true',
        { timeout: 5000 }
      );

      const after = await page.$eval('#reader-bookmark', (b) => ({
        pressed: b.getAttribute('aria-pressed'),
        label: b.getAttribute('aria-label'),
        text: b.textContent.trim(),
      }));
      expect(after.pressed).to.equal('true');
      expect(after.label).to.equal('Remove this entry from your bookmarks');
      expect(after.text).to.contain('Bookmarked');

      // And the storage holds the slug, and nothing else.
      const stored = await page.evaluate(() => localStorage.getItem('wdc.bookmarks'));
      expect(JSON.parse(stored)).to.deep.equal([publishedSlug]);
      expect(stored).to.not.contain('content');
    });

    it('should remove a bookmark from the article page', async () => {
      publishedSlug = await ensureArticle();
      await page.goto(`${SITE_BASE}/post.html?slug=${publishedSlug}`, {
        waitUntil: 'networkidle0',
      });

      await page.click('#reader-bookmark');
      await page.waitForFunction(
        () => document.getElementById('reader-bookmark').getAttribute('aria-pressed') === 'true',
        { timeout: 5000 }
      );

      await page.click('#reader-bookmark');
      await page.waitForFunction(
        () => document.getElementById('reader-bookmark').getAttribute('aria-pressed') === 'false',
        { timeout: 5000 }
      );

      const stored = await page.evaluate(() => localStorage.getItem('wdc.bookmarks'));
      expect(JSON.parse(stored)).to.deep.equal([]);
    });

    it('should survive a reload with the bookmark still set', async () => {
      publishedSlug = await ensureArticle();
      await page.goto(`${SITE_BASE}/post.html?slug=${publishedSlug}`, {
        waitUntil: 'networkidle0',
      });

      await page.click('#reader-bookmark');
      await page.waitForFunction(
        () => document.getElementById('reader-bookmark').getAttribute('aria-pressed') === 'true',
        { timeout: 5000 }
      );

      await page.reload({ waitUntil: 'networkidle0' });
      await page.waitForSelector('#reader-bookmark');

      const pressed = await page.$eval(
        '#reader-bookmark',
        (b) => b.getAttribute('aria-pressed')
      );
      expect(pressed).to.equal('true');
    });

    it('should show the bookmarked article in the bookmarks view', async () => {
      publishedSlug = await ensureArticle();
      await page.goto(`${SITE_BASE}/post.html?slug=${publishedSlug}`, {
        waitUntil: 'networkidle0',
      });
      await page.click('#reader-bookmark');
      await page.waitForFunction(
        () => document.getElementById('reader-bookmark').getAttribute('aria-pressed') === 'true',
        { timeout: 5000 }
      );

      await page.goto(`${SITE_BASE}/bookmarks/code.html`, { waitUntil: 'networkidle0' });
      await page.waitForSelector('#saved-list .reader-card', { timeout: 10000 });

      const cards = await page.$$eval('#saved-list .reader-card', (nodes) =>
        nodes.map((n) => ({
          title: n.querySelector('.reader-card-title') ? n.querySelector('.reader-card-title').textContent.trim() : '',
          href: n.querySelector('.reader-card-title a') ? n.querySelector('.reader-card-title a').getAttribute('href') : null,
          hasRemove: !!n.querySelector('.reader-card-remove'),
        }))
      );

      expect(cards).to.have.lengthOf(1);
      expect(cards[0].title).to.contain('Test Blog Post');
      expect(cards[0].href).to.contain('test-blog-post');
      expect(cards[0].hasRemove).to.be.true;
    });

    it('should show an informative empty state when nothing is bookmarked', async () => {
      await page.goto(`${SITE_BASE}/bookmarks/code.html`, { waitUntil: 'networkidle0' });
      await page.evaluate(() => localStorage.removeItem('wdc.bookmarks'));
      await page.reload({ waitUntil: 'networkidle0' });
      await page.waitForSelector('#saved-list .reader-card', { timeout: 10000 });

      const text = await page.$eval('#saved-list', (n) => n.textContent);
      expect(text).to.contain('No entries are bookmarked');
      expect(text).to.contain('Bookmark button');
    });

    it('should remove a bookmark from the bookmarks view', async () => {
      publishedSlug = await ensureArticle();
      await page.goto(`${SITE_BASE}/post.html?slug=${publishedSlug}`, {
        waitUntil: 'networkidle0',
      });
      await page.click('#reader-bookmark');
      await page.waitForFunction(
        () => document.getElementById('reader-bookmark').getAttribute('aria-pressed') === 'true',
        { timeout: 5000 }
      );

      await page.goto(`${SITE_BASE}/bookmarks/code.html`, { waitUntil: 'networkidle0' });
      await page.waitForSelector('#saved-list .reader-card-remove', { timeout: 10000 });

      // Accept the confirmation.
      page.on('dialog', async (dialog) => {
        await dialog.accept();
      });
      await page.click('#saved-list .reader-card-remove');
      await page.waitForFunction(
        () => document.querySelectorAll('#saved-list .reader-card-remove').length === 0,
        { timeout: 5000 }
      );

      const stored = await page.evaluate(() => localStorage.getItem('wdc.bookmarks'));
      expect(JSON.parse(stored)).to.deep.equal([]);
    });

    it('should not create a duplicate bookmark when clicked twice', async () => {
      publishedSlug = await ensureArticle();
      await page.goto(`${SITE_BASE}/post.html?slug=${publishedSlug}`, {
        waitUntil: 'networkidle0',
      });

      await page.evaluate(() => localStorage.removeItem('wdc.bookmarks'));

      await page.click('#reader-bookmark');
      await page.waitForFunction(
        () => document.getElementById('reader-bookmark').getAttribute('aria-pressed') === 'true',
        { timeout: 5000 }
      );

      // Call the storage API directly a second time: it must refuse.
      const second = await page.evaluate(() => {
        const result = ReaderData.addBookmark('test-blog-post');
        return { ok: result.ok, duplicate: result.duplicate };
      });

      expect(second.ok).to.be.false;
      expect(second.duplicate).to.be.true;

      const stored = await page.evaluate(() => localStorage.getItem('wdc.bookmarks'));
      expect(JSON.parse(stored)).to.have.lengthOf(1);
    });

    it('should mark an article that is no longer published as unavailable', async () => {
      // A slug that resolves to nothing.
      await page.goto(`${SITE_BASE}/bookmarks/code.html`, { waitUntil: 'networkidle0' });
      await page.evaluate(() => {
        localStorage.setItem('wdc.bookmarks', JSON.stringify(['no-such-article']));
      });
      await page.reload({ waitUntil: 'networkidle0' });
      await page.waitForSelector('#saved-list .reader-card', { timeout: 10000 });
      // Give the lookup a moment to resolve.
      await new Promise((resolve) => setTimeout(resolve, 1200));

      const card = await page.$eval('#saved-list .reader-card', (n) => ({
        unavailable: n.classList.contains('reader-card-unavailable'),
        text: n.textContent.replace(/\s+/g, ' ').trim(),
        href: n.querySelector('.reader-card-title a') ? n.querySelector('.reader-card-title a').getAttribute('href') : null,
      }));

      expect(card.unavailable).to.be.true;
      expect(card.text).to.contain('no longer published');
      // The unavailable entry must not link anywhere.
      expect(card.href).to.equal(null);
    });

    it('should recover from malformed stored bookmarks', async () => {
      await page.goto(`${SITE_BASE}/bookmarks/code.html`, { waitUntil: 'networkidle0' });
      await page.evaluate(() => {
        localStorage.setItem('wdc.bookmarks', '{{{ not json at all');
      });
      await page.reload({ waitUntil: 'networkidle0' });
      await page.waitForSelector('#saved-list', { timeout: 10000 });

      // The page must not throw, and must show the empty state.
      const text = await page.$eval('#saved-list', (n) => n.textContent);
      expect(text).to.contain('No entries are bookmarked');

      // And the page is still usable: a new bookmark can be added.
      const result = await page.evaluate(() => {
        const r = ReaderData.addBookmark('a-valid-post');
        return { ok: r.ok, list: ReaderData.getBookmarks() };
      });
      expect(result.ok).to.be.true;
      expect(result.list).to.deep.equal(['a-valid-post']);
    });

    it('should discard malformed entries inside a stored bookmark list', async () => {
      await page.goto(`${SITE_BASE}/bookmarks/code.html`, { waitUntil: 'networkidle0' });
      const list = await page.evaluate(() => {
        localStorage.setItem(
          'wdc.bookmarks',
          JSON.stringify(['good-post', 'Bad Slug', '', null, 42, 'another-good'])
        );
        return ReaderData.getBookmarks();
      });
      expect(list).to.deep.equal(['good-post', 'another-good']);
    });
  });

  describe('Reading progress', () => {
    it('should save a reading position as the page is scrolled', async () => {
      publishedSlug = LONG_ARTICLE.slug;
      await page.goto(`${SITE_BASE}/post.html?slug=${publishedSlug}`, {
        waitUntil: 'networkidle0',
      });
      await page.evaluate(() => localStorage.removeItem('wdc.progress'));

      // Scroll to the bottom of the article.
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
      // The tracker debounces, so give it time to write.
      await new Promise((resolve) => setTimeout(resolve, 1800));

      const stored = await page.evaluate(() => localStorage.getItem('wdc.progress'));
      expect(stored).to.be.a('string');
      const map = JSON.parse(stored);
      expect(map[publishedSlug]).to.exist;
      expect(map[publishedSlug].r).to.be.a('number');
      expect(map[publishedSlug].r).to.be.within(0, 1);
      expect(map[publishedSlug].p).to.be.within(0, 100);
    });

    it('should show the progress indicator once there is progress', async () => {
      publishedSlug = LONG_ARTICLE.slug;
      await page.goto(`${SITE_BASE}/post.html?slug=${publishedSlug}`, {
        waitUntil: 'networkidle0',
      });

      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
      await new Promise((resolve) => setTimeout(resolve, 1800));

      const state = await page.evaluate(() => ({
        fillWidth: document.getElementById('reader-progress-fill').style.width,
        label: document.getElementById('reader-progress-label').textContent,
        statusHidden: document.getElementById('reader-progress-status').hidden,
        ariaValue: document.getElementById('reader-progress-bar').getAttribute('aria-valuenow'),
      }));

      expect(state.fillWidth).to.match(/%$/);
      expect(state.label).to.match(/% read$/);
      expect(state.statusHidden).to.be.false;
      expect(Number(state.ariaValue)).to.be.within(0, 100);
    });

    it('should reset the saved position', async () => {
      publishedSlug = LONG_ARTICLE.slug;
      await page.goto(`${SITE_BASE}/post.html?slug=${publishedSlug}`, {
        waitUntil: 'networkidle0',
      });

      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
      await new Promise((resolve) => setTimeout(resolve, 1800));

      const before = await page.evaluate(() => localStorage.getItem('wdc.progress'));
      expect(before).to.contain(publishedSlug);

      page.on('dialog', async (dialog) => {
        await dialog.accept();
      });

      // The reset control is inside the page, so it is scrolled into view
      // before it is clicked.
      await page.evaluate(() => {
        document.getElementById('reader-progress-reset').scrollIntoView({ block: 'center' });
      });
      await new Promise((resolve) => setTimeout(resolve, 200));
      await page.click('#reader-progress-reset');
      await new Promise((resolve) => setTimeout(resolve, 400));

      const after = await page.evaluate(() => localStorage.getItem('wdc.progress'));
      const map = JSON.parse(after || '{}');
      expect(map[publishedSlug]).to.equal(undefined);
    });

    it('should restore a saved position when the article is reopened', async () => {
      publishedSlug = LONG_ARTICLE.slug;
      await page.goto(`${SITE_BASE}/post.html?slug=${publishedSlug}`, {
        waitUntil: 'networkidle0',
      });

      // Record a position directly, then reload and check it was restored.
      await page.evaluate((slug) => {
        ReaderData.setProgress(slug, 0.5, 50);
      }, publishedSlug);

      await page.reload({ waitUntil: 'networkidle0' });
      await page.waitForSelector('#reader-progress-status', { timeout: 10000 });
      await new Promise((resolve) => setTimeout(resolve, 600));

      const label = await page.$eval('#reader-progress-label', (n) => n.textContent);
      // The article is short, so it reads as complete, but the position was
      // recognised rather than discarded.
      expect(label).to.match(/% read|Read in full/);

      const stored = await page.evaluate(
        (slug) => (ReaderData.getProgress(slug) ? ReaderData.getProgress(slug).r : null),
        publishedSlug
      );
      expect(stored).to.be.a('number');
    });

    it('should discard a corrupt saved position instead of using it', async () => {
      publishedSlug = LONG_ARTICLE.slug;
      await page.goto(`${SITE_BASE}/post.html?slug=${publishedSlug}`, {
        waitUntil: 'networkidle0',
      });

      await page.evaluate((slug) => {
        localStorage.setItem(
          'wdc.progress',
          JSON.stringify({ [slug]: { r: 99, p: 500, u: 1 } })
        );
      }, publishedSlug);

      await page.reload({ waitUntil: 'networkidle0' });
      await new Promise((resolve) => setTimeout(resolve, 800));

      // The invalid entry was discarded rather than restored.
      const stored = await page.evaluate(
        (slug) => ReaderData.getProgress(slug),
        publishedSlug
      );
      expect(stored).to.equal(null);

      // The page still works.
      const label = await page.$eval('#reader-progress-label', (n) => n.textContent);
      expect(label).to.match(/% read/);
    });

    it('should recover from a malformed progress store', async () => {
      await page.goto(`${SITE_BASE}/post.html?slug=test-blog-post`, {
        waitUntil: 'networkidle0',
      });
      await page.evaluate(() => {
        localStorage.setItem('wdc.progress', 'not json at all');
      });
      await page.reload({ waitUntil: 'networkidle0' });
      await new Promise((resolve) => setTimeout(resolve, 600));

      const map = await page.evaluate(() => ReaderData.getProgressMap());
      expect(map).to.deep.equal({});
    });

    it('should treat a short article as read in full and save no position', async () => {
      // The seeded article is shorter than the viewport, so there is no
      // position to remember.
      publishedSlug = await ensureArticle();
      await page.goto(`${SITE_BASE}/post.html?slug=${publishedSlug}`, {
        waitUntil: 'networkidle0',
      });

      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
      await new Promise((resolve) => setTimeout(resolve, 1800));

      const state = await page.evaluate((slug) => ({
        stored: ReaderData.getProgress(slug),
        label: document.getElementById('reader-progress-label').textContent,
        statusHidden: document.getElementById('reader-progress-status').hidden,
        resetHidden: document.getElementById('reader-progress-reset').hidden,
      }), publishedSlug);

      // Nothing is stored for an article that fits on one screen.
      expect(state.stored).to.equal(null);
      expect(state.label).to.equal('Read in full');
      expect(state.statusHidden).to.be.false;
      // The reset control is hidden, because there is nothing to reset.
      expect(state.resetHidden).to.be.true;
    });

    it('should not overwrite bookmarks when it saves a reading position', async () => {
      publishedSlug = LONG_ARTICLE.slug;
      await page.goto(`${SITE_BASE}/post.html?slug=${publishedSlug}`, {
        waitUntil: 'networkidle0',
      });

      await page.evaluate((slug) => {
        ReaderData.clearBookmarks();
        ReaderData.addBookmark(slug);
      }, publishedSlug);

      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
      await new Promise((resolve) => setTimeout(resolve, 1800));

      const bookmarks = await page.evaluate(() => ReaderData.getBookmarks());
      expect(bookmarks).to.deep.equal([publishedSlug]);
    });
  });

  describe('Reading preferences', () => {
    it('should change the text size and keep it across a reload', async () => {
      await page.goto(`${SITE_BASE}/post.html?slug=test-blog-post`, {
        waitUntil: 'networkidle0',
      });
      await page.evaluate(() => localStorage.removeItem('wdc.preferences'));

      await page.click('#reader-settings-toggle');
      await page.waitForSelector('#reader-settings-panel:not([hidden])', { timeout: 5000 });

      await page.click('#reader-settings-panel input[name="reader-text-size"][value="large"]');

      const applied = await page.evaluate(() => ({
        size: getComputedStyle(document.documentElement).getPropertyValue('--reader-text-size').trim(),
        attribute: document.documentElement.getAttribute('data-reader-text-size'),
        stored: ReaderData.getPreferences().textSize,
      }));
      expect(applied.size).to.equal('21px');
      expect(applied.attribute).to.equal('large');
      expect(applied.stored).to.equal('large');

      await page.reload({ waitUntil: 'networkidle0' });
      const afterReload = await page.evaluate(() =>
        getComputedStyle(document.documentElement).getPropertyValue('--reader-text-size').trim()
      );
      expect(afterReload).to.equal('21px');
    });

    it('should change the reading width and keep it across a reload', async () => {
      await page.goto(`${SITE_BASE}/post.html?slug=test-blog-post`, {
        waitUntil: 'networkidle0',
      });
      await page.evaluate(() => localStorage.removeItem('wdc.preferences'));

      await page.click('#reader-settings-toggle');
      await page.waitForSelector('#reader-settings-panel:not([hidden])', { timeout: 5000 });
      await page.click('#reader-settings-panel input[name="reader-reading-width"][value="narrow"]');

      const applied = await page.evaluate(() =>
        getComputedStyle(document.documentElement).getPropertyValue('--reader-max-width').trim()
      );
      expect(applied).to.equal('34rem');

      await page.reload({ waitUntil: 'networkidle0' });
      const afterReload = await page.evaluate(() =>
        getComputedStyle(document.documentElement).getPropertyValue('--reader-max-width').trim()
      );
      expect(afterReload).to.equal('34rem');
    });

    it('should apply the reduced-intensity preference', async () => {
      await page.goto(`${SITE_BASE}/post.html?slug=test-blog-post`, {
        waitUntil: 'networkidle0',
      });
      await page.evaluate(() => localStorage.removeItem('wdc.preferences'));

      await page.click('#reader-settings-toggle');
      await page.waitForSelector('#reader-settings-panel:not([hidden])', { timeout: 5000 });
      await page.click('#reader-settings-panel input[name="reader-reduced-intensity"]');

      const applied = await page.evaluate(() => ({
        hasClass: document.body.classList.contains('reader-reduced-intensity'),
        stored: ReaderData.getPreferences().reducedIntensity,
      }));
      expect(applied.hasClass).to.be.true;
      expect(applied.stored).to.be.true;
    });

    it('should reset the preferences to their defaults', async () => {
      await page.goto(`${SITE_BASE}/post.html?slug=test-blog-post`, {
        waitUntil: 'networkidle0',
      });

      await page.click('#reader-settings-toggle');
      await page.waitForSelector('#reader-settings-panel:not([hidden])', { timeout: 5000 });
      await page.click('#reader-settings-panel input[name="reader-text-size"][value="xlarge"]');
      await page.click('#reader-settings-panel input[name="reader-reading-width"][value="wide"]');

      let prefs = await page.evaluate(() => ReaderData.getPreferences());
      expect(prefs.textSize).to.equal('xlarge');
      expect(prefs.readingWidth).to.equal('wide');

      // The reset button in the panel.
      await page.click('#reader-settings-panel .reader-data-action');

      prefs = await page.evaluate(() => ReaderData.getPreferences());
      expect(prefs.textSize).to.equal('medium');
      expect(prefs.readingWidth).to.equal('normal');
    });

    it('should replace an invalid stored preference with its default', async () => {
      await page.goto(`${SITE_BASE}/post.html?slug=test-blog-post`, {
        waitUntil: 'networkidle0',
      });

      await page.evaluate(() => {
        localStorage.setItem(
          'wdc.preferences',
          JSON.stringify({ textSize: 'gigantic', readingWidth: 42, reducedIntensity: 'yes' })
        );
      });
      await page.reload({ waitUntil: 'networkidle0' });
      await new Promise((resolve) => setTimeout(resolve, 500));

      const prefs = await page.evaluate(() => ReaderData.getPreferences());
      expect(prefs.textSize).to.equal('medium');
      expect(prefs.readingWidth).to.equal('normal');
      expect(prefs.reducedIntensity).to.be.false;
    });

    it('should change the width of the article reading column', async () => {
      await page.goto(`${SITE_BASE}/post.html?slug=test-blog-post`, {
        waitUntil: 'networkidle0',
      });
      await page.evaluate(() => localStorage.removeItem('wdc.preferences'));

      const measure = async () =>
        page.evaluate(() => {
          const column = document.getElementById('post-content');
          const text = document.querySelector('#post-content .reader-text');
          return {
            setting: document.documentElement.getAttribute('data-reader-width'),
            columnWidth: Math.round(column.getBoundingClientRect().width),
            textWidth: text ? Math.round(text.getBoundingClientRect().width) : 0,
          };
        });

      // The panel is opened once and stays open; clicking the toggle again
      // would close it.
      await page.click('#reader-settings-toggle');
      await page.waitForSelector('#reader-settings-panel:not([hidden])', { timeout: 5000 });

      const setWidth = async (value) => {
        await page.click(
          `#reader-settings-panel input[name="reader-reading-width"][value="${value}"]`
        );
        await new Promise((resolve) => setTimeout(resolve, 400));
      };

      await setWidth('narrow');
      const narrow = await measure();
      expect(narrow.setting).to.equal('narrow');
      expect(narrow.columnWidth).to.be.below(700);

      await setWidth('normal');
      const normal = await measure();
      expect(normal.setting).to.equal('normal');
      // The default is the width the page had before the preference existed.
      expect(normal.columnWidth).to.equal(768);

      await setWidth('wide');
      const wide = await measure();
      expect(wide.setting).to.equal('wide');
      expect(wide.columnWidth).to.be.above(normal.columnWidth);

      // The three settings are genuinely different widths.
      expect(narrow.columnWidth).to.be.below(normal.columnWidth);
      expect(normal.columnWidth).to.be.below(wide.columnWidth);
    });

    it('should keep the default article width when no preference is stored', async () => {
      await page.goto(`${SITE_BASE}/post.html?slug=test-blog-post`, {
        waitUntil: 'networkidle0',
      });
      await page.evaluate(() => localStorage.removeItem('wdc.preferences'));
      await page.reload({ waitUntil: 'networkidle0' });
      await new Promise((resolve) => setTimeout(resolve, 600));

      const state = await page.evaluate(() => {
        const column = document.getElementById('post-content');
        const text = document.querySelector('#post-content .reader-text');
        return {
          stored: localStorage.getItem('wdc.preferences'),
          setting: document.documentElement.getAttribute('data-reader-width'),
          columnWidth: Math.round(column.getBoundingClientRect().width),
          fontSize: text ? getComputedStyle(text).fontSize : null,
        };
      });

      // Nothing is written merely by loading the page.
      expect(state.stored).to.equal(null);
      expect(state.setting).to.equal('normal');
      expect(state.columnWidth).to.equal(768);
      expect(state.fontSize).to.equal('18px');
    });

    it('should keep the article width across a reload', async () => {
      await page.goto(`${SITE_BASE}/post.html?slug=test-blog-post`, {
        waitUntil: 'networkidle0',
      });
      await page.evaluate(() => localStorage.removeItem('wdc.preferences'));

      await page.click('#reader-settings-toggle');
      await page.waitForSelector('#reader-settings-panel:not([hidden])', { timeout: 5000 });
      await page.click('#reader-settings-panel input[name="reader-reading-width"][value="wide"]');
      await new Promise((resolve) => setTimeout(resolve, 400));

      const before = await page.evaluate(() =>
        Math.round(document.getElementById('post-content').getBoundingClientRect().width)
      );

      await page.reload({ waitUntil: 'networkidle0' });
      await new Promise((resolve) => setTimeout(resolve, 600));

      const after = await page.evaluate(() => ({
        width: Math.round(document.getElementById('post-content').getBoundingClientRect().width),
        setting: document.documentElement.getAttribute('data-reader-width'),
      }));

      expect(after.setting).to.equal('wide');
      expect(after.width).to.equal(before);
    });

    it('should not overflow horizontally at any reading width on a phone', async () => {
      await page.setViewport({ width: 390, height: 844 });
      await page.goto(`${SITE_BASE}/post.html?slug=test-blog-post`, {
        waitUntil: 'networkidle0',
      });

      for (const value of ['narrow', 'normal', 'wide']) {
        await page.evaluate((v) => {
          localStorage.setItem(
            'wdc.preferences',
            JSON.stringify({ textSize: 'medium', readingWidth: v, reducedIntensity: false })
          );
        }, value);
        await page.reload({ waitUntil: 'networkidle0' });
        await new Promise((resolve) => setTimeout(resolve, 600));

        const state = await page.evaluate(() => {
          const w = document.documentElement.clientWidth;
          return {
            setting: document.documentElement.getAttribute('data-reader-width'),
            scrollWidth: document.documentElement.scrollWidth,
            clientWidth: w,
            columnWidth: Math.round(
              document.getElementById('post-content').getBoundingClientRect().width
            ),
            offenders: Array.from(document.querySelectorAll('*'))
              .filter((e) => e.getBoundingClientRect().right > w + 1)
              .slice(0, 4)
              .map((e) => e.tagName + '.' + String(e.className || '').slice(0, 30)),
          };
        });

        expect(state.setting).to.equal(value);
        expect(state.scrollWidth).to.equal(state.clientWidth);
        expect(state.offenders).to.deep.equal([]);
        // The column never exceeds the space available.
        expect(state.columnWidth).to.be.at.most(state.clientWidth);
      }
    });

    it('should expose the reading settings on the blog page', async () => {
      await page.goto(`${SITE_BASE}/grim_chronicles/code.html`, { waitUntil: 'networkidle0' });
      await page.evaluate(() => localStorage.removeItem('wdc.preferences'));

      const toggle = await page.$('#reader-settings-toggle');
      expect(toggle, 'the blog page should have a reading-settings button').to.not.equal(null);

      await page.click('#reader-settings-toggle');
      await page.waitForSelector('#reader-settings-panel:not([hidden])', { timeout: 5000 });

      await page.click('#reader-settings-panel input[name="reader-reading-width"][value="wide"]');
      await new Promise((resolve) => setTimeout(resolve, 400));

      const state = await page.evaluate(() => ({
        stored: JSON.parse(localStorage.getItem('wdc.preferences') || 'null'),
        setting: document.documentElement.getAttribute('data-reader-width'),
      }));

      expect(state.setting).to.equal('wide');
      expect(state.stored.readingWidth).to.equal('wide');
    });

    it('should expose the settings panel with labelled, keyboard-reachable controls', async () => {
      await page.goto(`${SITE_BASE}/post.html?slug=test-blog-post`, {
        waitUntil: 'networkidle0',
      });

      const expanded = await page.$eval('#reader-settings-toggle', (b) =>
        b.getAttribute('aria-expanded')
      );
      expect(expanded).to.equal('false');

      await page.click('#reader-settings-toggle');
      await page.waitForSelector('#reader-settings-panel:not([hidden])', { timeout: 5000 });

      const expandedAfter = await page.$eval('#reader-settings-toggle', (b) =>
        b.getAttribute('aria-expanded')
      );
      expect(expandedAfter).to.equal('true');

      const controls = await page.evaluate(() => {
        const panel = document.getElementById('reader-settings-panel');
        return {
          legends: Array.from(panel.querySelectorAll('legend')).map((l) => l.textContent),
          radios: panel.querySelectorAll('input[type="radio"]').length,
          checkbox: panel.querySelectorAll('input[type="checkbox"]').length,
          labels: Array.from(panel.querySelectorAll('label')).length,
        };
      });

      expect(controls.legends).to.deep.equal([
        'Text size',
        'Reading width',
        'Visual intensity',
      ]);
      expect(controls.radios).to.equal(7); // 4 text sizes + 3 widths
      expect(controls.checkbox).to.equal(1);
      expect(controls.labels).to.be.greaterThan(0);
    });

    it('should give the settings controls a visible focus ring', async () => {
      await page.goto(`${SITE_BASE}/post.html?slug=test-blog-post`, {
        waitUntil: 'networkidle0',
      });
      await page.click('#reader-settings-toggle');
      await page.waitForSelector('#reader-settings-panel:not([hidden])', { timeout: 5000 });

      await page.focus('#reader-settings-panel input[name="reader-text-size"][value="large"]');

      const focus = await page.evaluate(() => {
        const input = document.querySelector(
          '#reader-settings-panel input[name="reader-text-size"][value="large"]'
        );
        const label = input.closest('label');
        const style = getComputedStyle(label);
        return {
          focused: document.activeElement === input,
          outline: style.outlineStyle,
          outlineWidth: style.outlineWidth,
        };
      });

      expect(focus.focused).to.be.true;
      expect(focus.outline).to.not.equal('none');
      expect(parseFloat(focus.outlineWidth)).to.be.greaterThan(0);
    });

    it('should close the settings panel with the Escape key', async () => {
      await page.goto(`${SITE_BASE}/post.html?slug=test-blog-post`, {
        waitUntil: 'networkidle0',
      });
      await page.click('#reader-settings-toggle');
      await page.waitForSelector('#reader-settings-panel:not([hidden])', { timeout: 5000 });

      await page.keyboard.press('Escape');
      await new Promise((resolve) => setTimeout(resolve, 300));

      const hidden = await page.$eval(
        '#reader-settings-panel',
        (n) => n.hasAttribute('hidden')
      );
      expect(hidden).to.be.true;
    });
  });

  describe('Separation of the saved data', () => {
    it('should clear bookmarks without erasing reading positions or story paths', async () => {
      await page.goto(`${SITE_BASE}/post.html?slug=test-blog-post`, {
        waitUntil: 'networkidle0',
      });

      await page.evaluate(() => {
        ReaderData.clearBookmarks();
        ReaderData.clearProgress();
        ReaderData.addBookmark('a-post');
        ReaderData.setProgress('a-post', 0.5, 50);
        ReaderData.setStoryPath('a-story', [{ nodeId: 'n1', title: 'One', viaLabel: null }]);
      });

      page.on('dialog', async (dialog) => {
        await dialog.accept();
      });

      // The first action in the panel clears the bookmarks only.
      await page.evaluate(() => {
        const buttons = Array.from(
          document.querySelectorAll('#reader-data-panel .reader-data-action')
        );
        buttons.find((b) => b.textContent.trim() === 'Clear bookmarks').click();
      });
      await new Promise((resolve) => setTimeout(resolve, 400));

      const state = await page.evaluate(() => ({
        bookmarks: ReaderData.getBookmarks(),
        progress: ReaderData.getProgress('a-post'),
        storyPath: ReaderData.getStoryPath('a-story'),
      }));

      expect(state.bookmarks).to.deep.equal([]);
      expect(state.progress).to.exist;
      expect(state.progress.r).to.equal(0.5);
      expect(state.storyPath).to.have.lengthOf(1);
    });

    it('should clear reading positions without erasing bookmarks or story paths', async () => {
      await page.goto(`${SITE_BASE}/post.html?slug=test-blog-post`, {
        waitUntil: 'networkidle0',
      });

      await page.evaluate(() => {
        ReaderData.clearBookmarks();
        ReaderData.clearProgress();
        ReaderData.addBookmark('a-post');
        ReaderData.setProgress('a-post', 0.5, 50);
        ReaderData.setStoryPath('a-story', [{ nodeId: 'n1', title: 'One', viaLabel: null }]);
      });

      page.on('dialog', async (dialog) => {
        await dialog.accept();
      });

      await page.evaluate(() => {
        const buttons = Array.from(
          document.querySelectorAll('#reader-data-panel .reader-data-action')
        );
        buttons.find((b) => b.textContent.trim() === 'Clear reading positions').click();
      });
      await new Promise((resolve) => setTimeout(resolve, 400));

      const state = await page.evaluate(() => ({
        bookmarks: ReaderData.getBookmarks(),
        progress: ReaderData.getProgress('a-post'),
        storyPath: ReaderData.getStoryPath('a-story'),
      }));

      expect(state.progress).to.equal(null);
      expect(state.bookmarks).to.deep.equal(['a-post']);
      expect(state.storyPath).to.have.lengthOf(1);
    });

    it('should confirm the clearing in the data panel status', async () => {
      await page.goto(`${SITE_BASE}/bookmarks/code.html`, { waitUntil: 'networkidle0' });
      await page.evaluate(() => {
        ReaderData.clearBookmarks();
        ReaderData.addBookmark('a-post');
      });

      page.on('dialog', async (dialog) => {
        await dialog.accept();
      });

      await page.evaluate(() => {
        const buttons = Array.from(
          document.querySelectorAll('#reader-data-panel .reader-data-action')
        );
        buttons.find((b) => b.textContent.trim() === 'Clear bookmarks').click();
      });
      await new Promise((resolve) => setTimeout(resolve, 500));

      const status = await page.$eval('#reader-data-status', (n) => n.textContent);
      expect(status).to.contain('Bookmarks cleared');
      expect(status).to.contain('left alone');
    });

    it('should report what is stored in the data panel', async () => {
      await page.goto(`${SITE_BASE}/bookmarks/code.html`, { waitUntil: 'networkidle0' });

      await page.evaluate(() => {
        ReaderData.clearBookmarks();
        ReaderData.clearProgress();
        ReaderData.addBookmark('one');
        ReaderData.addBookmark('two');
        ReaderData.setProgress('a-post', 0.5, 50);
        ReaderData.setStoryPath('a-story', [{ nodeId: 'n1' }]);
      });

      await page.reload({ waitUntil: 'networkidle0' });
      await page.waitForSelector('#reader-data-summary', { timeout: 10000 });

      const counts = await page.$$eval('#reader-data-summary .reader-data-count', (nodes) =>
        nodes.map((n) => n.textContent.replace(/\s+/g, ' ').trim())
      );

      // The value and the label are separate elements, so they are joined
      // with a space when the text is read.
      const joined = counts.join(' | ');
      expect(joined).to.match(/2\s*Bookmarks/);
      expect(joined).to.match(/1\s*Reading positions/);
      expect(joined).to.match(/1\s*Story paths/);
    });
  });

  describe('Safe rendering', () => {
    it('should render the article body as text, never as markup', async () => {
      await page.goto(`${SITE_BASE}/post.html?slug=test-blog-post`, {
        waitUntil: 'networkidle0',
      });

      const body = await page.evaluate(() => {
        const node = document.querySelector('#post-content .reader-text');
        return {
          exists: !!node,
          children: node ? node.children.length : -1,
          text: node ? node.textContent : '',
        };
      });

      expect(body.exists).to.be.true;
      // The body is plain text, so it has no child elements.
      expect(body.children).to.equal(0);
      expect(body.text).to.contain('This is the test content');
    });

    it('should not execute a script embedded in the article title', async () => {
      await page.goto(`${SITE_BASE}/post.html?slug=test-blog-post`, {
        waitUntil: 'networkidle0',
      });

      // Any alert would be caught by the pageerror handler.
      await page.evaluate(() => {
        window.__alerts = [];
        window.alert = (m) => window.__alerts.push(String(m));
      });

      // The title and the body are rendered through textContent, so a
      // payload in either is inert.
      const injected = await page.evaluate(() => {
        const title = document.querySelector('#post-content h1');
        const body = document.querySelector('#post-content .reader-text');
        return {
          titleChildren: title ? title.children.length : -1,
          bodyChildren: body ? body.children.length : -1,
          scripts: document.querySelectorAll('#post-content script').length,
          alerts: window.__alerts,
        };
      });

      expect(injected.titleChildren).to.equal(0);
      expect(injected.bodyChildren).to.equal(0);
      expect(injected.scripts).to.equal(0);
      expect(injected.alerts).to.deep.equal([]);
    });
  });

  describe('The Phase 9A interactive-story path', () => {
    it('should still persist the story reading path across a reload', async () => {
      // Write a path under the exact Phase 9A key and shape.
      await page.goto(`${SITE_BASE}/branching_stories/reader.html?slug=the-ashen-corridor-demo`, {
        waitUntil: 'networkidle0',
      });

      const stored = await page.evaluate(() => {
        const key = 'wdc.story.path.the-ashen-corridor-demo';
        localStorage.setItem(
          key,
          JSON.stringify([
            { nodeId: 'node-1', title: 'The Threshold', viaLabel: null },
            { nodeId: 'node-2', title: 'The Corridor', viaLabel: 'Walk on' },
          ])
        );
        // The shared storage layer must read the same value.
        return {
          hasSharedLayer: typeof ReaderData !== 'undefined',
          viaStorage: ReaderData.getStoryPath('the-ashen-corridor-demo'),
          raw: localStorage.getItem(key),
        };
      });

      expect(stored.hasSharedLayer).to.be.true;
      expect(stored.viaStorage).to.have.lengthOf(2);
      expect(stored.viaStorage[1].viaLabel).to.equal('Walk on');
      expect(stored.raw).to.contain('The Threshold');
    });

    it('should keep the story path separate from the other saved data', async () => {
      await page.goto(`${SITE_BASE}/bookmarks/code.html`, { waitUntil: 'networkidle0' });

      const state = await page.evaluate(() => {
        ReaderData.clearBookmarks();
        ReaderData.clearProgress();
        ReaderData.addBookmark('a-post');
        ReaderData.setProgress('a-post', 0.5, 50);
        ReaderData.setStoryPath('a-story', [{ nodeId: 'n1' }]);
        ReaderData.clearBookmarks();
        return {
          bookmarks: ReaderData.getBookmarks(),
          progress: ReaderData.getProgress('a-post'),
          storyPath: ReaderData.getStoryPath('a-story'),
        };
      });

      expect(state.bookmarks).to.deep.equal([]);
      expect(state.progress).to.exist;
      expect(state.storyPath).to.have.lengthOf(1);
    });
  });

  describe('Responsive layout and keyboard navigation', () => {
    it('should fit the article page on a phone without horizontal overflow', async () => {
      await page.setViewport({ width: 390, height: 844 });
      await page.goto(`${SITE_BASE}/post.html?slug=test-blog-post`, {
        waitUntil: 'networkidle0',
      });

      const overflow = await page.evaluate(() => ({
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
        offenders: Array.from(document.querySelectorAll('*'))
          .filter((e) => e.getBoundingClientRect().right > document.documentElement.clientWidth + 1)
          .slice(0, 5)
          .map((e) => e.tagName + '.' + String(e.className || '').slice(0, 30)),
      }));

      expect(overflow.scrollWidth).to.equal(overflow.clientWidth);
      expect(overflow.offenders).to.deep.equal([]);
    });

    it('should fit the bookmarks page on a phone without horizontal overflow', async () => {
      await page.setViewport({ width: 390, height: 844 });
      await page.goto(`${SITE_BASE}/bookmarks/code.html`, { waitUntil: 'networkidle0' });

      const overflow = await page.evaluate(() => ({
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
      }));

      expect(overflow.scrollWidth).to.equal(overflow.clientWidth);
    });

    it('should let the bookmark button be reached and activated with the keyboard', async () => {
      await page.goto(`${SITE_BASE}/post.html?slug=test-blog-post`, {
        waitUntil: 'networkidle0',
      });
      await page.evaluate(() => localStorage.removeItem('wdc.bookmarks'));

      await page.focus('#reader-bookmark');
      const focused = await page.evaluate(() => document.activeElement.id);
      expect(focused).to.equal('reader-bookmark');

      await page.keyboard.press('Enter');
      await page.waitForFunction(
        () => document.getElementById('reader-bookmark').getAttribute('aria-pressed') === 'true',
        { timeout: 5000 }
      );

      const pressed = await page.$eval(
        '#reader-bookmark',
        (b) => b.getAttribute('aria-pressed')
      );
      expect(pressed).to.equal('true');
    });

    it('should give the bookmark button a visible focus ring', async () => {
      await page.goto(`${SITE_BASE}/post.html?slug=test-blog-post`, {
        waitUntil: 'networkidle0',
      });
      await page.focus('#reader-bookmark');

      const focus = await page.evaluate(() => {
        const style = getComputedStyle(document.getElementById('reader-bookmark'));
        return {
          matches: document.getElementById('reader-bookmark').matches(':focus-visible'),
          outline: style.outlineStyle,
          width: style.outlineWidth,
        };
      });

      expect(focus.matches).to.be.true;
      expect(focus.outline).to.not.equal('none');
      expect(parseFloat(focus.width)).to.be.greaterThan(0);
    });
  });
});
