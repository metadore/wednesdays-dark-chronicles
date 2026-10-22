import { expect } from 'chai';
import { createRequire } from 'module';
import path from 'path';
import { fileURLToPath } from 'url';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * The browser-storage layer.
 *
 * `reader-data.js` is a browser script, but it is written so that it can also
 * be loaded in Node, which lets the parsing, validation and storage rules be
 * tested directly rather than only through a browser.
 *
 * A fake localStorage stands in for the browser's, so the tests can also
 * simulate a storage that throws.
 */

// reader-data.js lives at the site root, one level above the backend folder.
const PROJECT_ROOT = path.resolve(__dirname, '..', '..', '..');
const READER_DATA_PATH = path.join(PROJECT_ROOT, 'reader-data.js');

/** A minimal in-memory localStorage that can be made to fail. */
class FakeStorage {
  constructor() {
    this.map = new Map();
    this.failOnSet = false;
    this.failOnGet = false;
    this.failOnRemove = false;
    this.failOnKey = false;
  }

  get length() {
    return this.map.size;
  }

  key(index) {
    if (this.failOnKey) throw new Error('storage key() failed');
    return Array.from(this.map.keys())[index] ?? null;
  }

  getItem(key) {
    if (this.failOnGet) throw new Error('storage getItem() failed');
    return this.map.has(key) ? this.map.get(key) : null;
  }

  setItem(key, value) {
    if (this.failOnSet) throw new Error('storage setItem() failed');
    this.map.set(key, String(value));
  }

  removeItem(key) {
    if (this.failOnRemove) throw new Error('storage removeItem() failed');
    this.map.delete(key);
  }
}

/**
 * Load reader-data.js with a given storage in place.
 *
 * The module reads `root.localStorage` lazily on every call, so a single
 * require is enough: swapping `globalThis.localStorage` between tests
 * changes the behaviour of the already-loaded module.
 */
function loadWith(storage) {
  // The module is cached by Node's require, so it is loaded once and the
  // storage is swapped per test. The factory reads `root.localStorage` at
  // call time, not at load time.
  if (!loadWith._cached) {
    loadWith._cached = require(READER_DATA_PATH);
  }
  globalThis.localStorage = storage;
  return loadWith._cached;
}

describe('Reader browser-storage layer', () => {
  let ReaderData;
  let storage;

  beforeEach(() => {
    storage = new FakeStorage();
    ReaderData = loadWith(storage);
  });

  after(() => {
    delete globalThis.localStorage;
  });

  describe('Bookmarks', () => {
    it('should add a bookmark and report the new state', () => {
      const result = ReaderData.addBookmark('test-blog-post');
      expect(result.ok).to.be.true;
      expect(result.duplicate).to.be.false;
      expect(ReaderData.getBookmarks()).to.deep.equal(['test-blog-post']);
      expect(ReaderData.isBookmarked('test-blog-post')).to.be.true;
    });

    it('should prevent a duplicate bookmark', () => {
      ReaderData.addBookmark('test-blog-post');
      const second = ReaderData.addBookmark('test-blog-post');
      expect(second.ok).to.be.false;
      expect(second.duplicate).to.be.true;
      expect(ReaderData.getBookmarks()).to.have.lengthOf(1);
    });

    it('should remove a bookmark', () => {
      ReaderData.addBookmark('test-blog-post');
      expect(ReaderData.removeBookmark('test-blog-post')).to.be.true;
      expect(ReaderData.getBookmarks()).to.have.lengthOf(0);
      expect(ReaderData.isBookmarked('test-blog-post')).to.be.false;
    });

    it('should report removing a bookmark that is not there', () => {
      expect(ReaderData.removeBookmark('never-bookmarked')).to.be.false;
    });

    it('should keep the bookmark order', () => {
      ReaderData.addBookmark('first-post');
      ReaderData.addBookmark('second-post');
      ReaderData.addBookmark('third-post');
      expect(ReaderData.getBookmarks()).to.deep.equal([
        'first-post',
        'second-post',
        'third-post',
      ]);
    });

    it('should refuse a malformed slug', () => {
      const result = ReaderData.addBookmark('Not A Slug!');
      expect(result.ok).to.be.false;
      expect(result.error).to.be.a('string');
      expect(ReaderData.getBookmarks()).to.have.lengthOf(0);
    });

    it('should refuse an empty slug', () => {
      expect(ReaderData.addBookmark('').ok).to.be.false;
    });

    it('should refuse a slug that is too long', () => {
      const long = 'a'.repeat(200);
      expect(ReaderData.addBookmark(long).ok).to.be.false;
    });

    it('should discard malformed entries when reading', () => {
      storage.setItem(
        'wdc.bookmarks',
        JSON.stringify(['good-post', 'Bad Slug', '', null, 42, {}, 'another-good'])
      );
      expect(ReaderData.getBookmarks()).to.deep.equal(['good-post', 'another-good']);
    });

    it('should discard duplicate entries when reading', () => {
      storage.setItem(
        'wdc.bookmarks',
        JSON.stringify(['same-post', 'same-post', 'other-post'])
      );
      expect(ReaderData.getBookmarks()).to.deep.equal(['same-post', 'other-post']);
    });

    it('should return an empty list when the stored value is not JSON', () => {
      storage.setItem('wdc.bookmarks', '{{{ not json');
      expect(ReaderData.getBookmarks()).to.deep.equal([]);
    });

    it('should return an empty list when the stored value is not an array', () => {
      storage.setItem('wdc.bookmarks', JSON.stringify({ a: 'b' }));
      expect(ReaderData.getBookmarks()).to.deep.equal([]);
    });

    it('should return an empty list when nothing is stored', () => {
      expect(ReaderData.getBookmarks()).to.deep.equal([]);
    });

    it('should clear every bookmark', () => {
      ReaderData.addBookmark('one');
      ReaderData.addBookmark('two');
      ReaderData.clearBookmarks();
      expect(ReaderData.getBookmarks()).to.deep.equal([]);
    });
  });

  describe('Reading progress', () => {
    it('should save and restore a reading position', () => {
      expect(ReaderData.setProgress('test-blog-post', 0.42, 42)).to.be.true;
      const stored = ReaderData.getProgress('test-blog-post');
      expect(stored).to.exist;
      expect(stored.r).to.equal(0.42);
      expect(stored.p).to.equal(42);
      expect(stored.u).to.be.a('number');
    });

    it('should return null for an article with no saved position', () => {
      expect(ReaderData.getProgress('never-read')).to.equal(null);
    });

    it('should refuse a ratio outside 0..1', () => {
      expect(ReaderData.setProgress('a-post', 1.5, 150)).to.be.false;
      expect(ReaderData.setProgress('a-post', -0.1, -10)).to.be.false;
      expect(ReaderData.getProgress('a-post')).to.equal(null);
    });

    it('should refuse a percent outside 0..100', () => {
      expect(ReaderData.setProgress('a-post', 0.5, 101)).to.be.false;
      expect(ReaderData.getProgress('a-post')).to.equal(null);
    });

    it('should refuse a non-numeric ratio', () => {
      expect(ReaderData.setProgress('a-post', 'half', 50)).to.be.false;
      expect(ReaderData.setProgress('a-post', NaN, 50)).to.be.false;
      expect(ReaderData.setProgress('a-post', Infinity, 50)).to.be.false;
    });

    it('should remove a saved position', () => {
      ReaderData.setProgress('test-blog-post', 0.5, 50);
      expect(ReaderData.removeProgress('test-blog-post')).to.be.true;
      expect(ReaderData.getProgress('test-blog-post')).to.equal(null);
    });

    it('should report removing a position that is not there', () => {
      expect(ReaderData.removeProgress('never-read')).to.be.false;
    });

    it('should discard a corrupt stored position', () => {
      storage.setItem(
        'wdc.progress',
        JSON.stringify({
          'good-post': { r: 0.5, p: 50, u: 1700000000000 },
          'bad-ratio': { r: 5, p: 50, u: 1700000000000 },
          'bad-percent': { r: 0.5, p: 500, u: 1700000000000 },
          'no-updated': { r: 0.5, p: 50 },
          'not-an-object': 'nope',
          'Bad Slug': { r: 0.5, p: 50, u: 1700000000000 },
        })
      );
      const map = ReaderData.getProgressMap();
      expect(Object.keys(map)).to.deep.equal(['good-post']);
    });

    it('should return an empty map when the stored value is not an object', () => {
      storage.setItem('wdc.progress', JSON.stringify(['not', 'an', 'object']));
      expect(ReaderData.getProgressMap()).to.deep.equal({});
    });

    it('should return an empty map when the stored value is not JSON', () => {
      storage.setItem('wdc.progress', 'not json at all');
      expect(ReaderData.getProgressMap()).to.deep.equal({});
    });

    it('should clear every reading position', () => {
      ReaderData.setProgress('one', 0.2, 20);
      ReaderData.setProgress('two', 0.4, 40);
      ReaderData.clearProgress();
      expect(ReaderData.getProgressMap()).to.deep.equal({});
    });
  });

  describe('Reading preferences', () => {
    it('should return sensible defaults when nothing is stored', () => {
      const prefs = ReaderData.getPreferences();
      expect(prefs.textSize).to.equal('medium');
      expect(prefs.readingWidth).to.equal('normal');
      expect(prefs.reducedIntensity).to.be.false;
    });

    it('should save and restore a text size', () => {
      const result = ReaderData.setPreference('textSize', 'large');
      expect(result.ok).to.be.true;
      expect(ReaderData.getPreferences().textSize).to.equal('large');
    });

    it('should save and restore a reading width', () => {
      const result = ReaderData.setPreference('readingWidth', 'wide');
      expect(result.ok).to.be.true;
      expect(ReaderData.getPreferences().readingWidth).to.equal('wide');
    });

    it('should save and restore the reduced-intensity setting', () => {
      const result = ReaderData.setPreference('reducedIntensity', true);
      expect(result.ok).to.be.true;
      expect(ReaderData.getPreferences().reducedIntensity).to.be.true;
    });

    it('should refuse an unknown text size', () => {
      const result = ReaderData.setPreference('textSize', 'enormous');
      expect(result.ok).to.be.false;
      expect(result.error).to.be.a('string');
      expect(ReaderData.getPreferences().textSize).to.equal('medium');
    });

    it('should refuse an unknown reading width', () => {
      const result = ReaderData.setPreference('readingWidth', 'enormous');
      expect(result.ok).to.be.false;
      expect(ReaderData.getPreferences().readingWidth).to.equal('normal');
    });

    it('should refuse an unknown preference key', () => {
      const result = ReaderData.setPreference('somethingElse', 'x');
      expect(result.ok).to.be.false;
    });

    it('should refuse a non-boolean reduced-intensity value', () => {
      const result = ReaderData.setPreference('reducedIntensity', 'yes');
      expect(result.ok).to.be.false;
      expect(ReaderData.getPreferences().reducedIntensity).to.be.false;
    });

    it('should replace an invalid stored value with its default', () => {
      storage.setItem(
        'wdc.preferences',
        JSON.stringify({ textSize: 'gigantic', readingWidth: 42, reducedIntensity: 'yes' })
      );
      const prefs = ReaderData.getPreferences();
      expect(prefs.textSize).to.equal('medium');
      expect(prefs.readingWidth).to.equal('normal');
      expect(prefs.reducedIntensity).to.be.false;
    });

    it('should offer three distinct reading widths, with a 48rem default', () => {
      const widths = Object.values(ReaderData.READING_WIDTHS);
      // Three settings, three different measures.
      expect(widths).to.have.lengthOf(3);
      expect(new Set(widths).size).to.equal(3);

      // The default is the width the page used before the preference existed,
      // so the default appearance is unchanged.
      expect(ReaderData.DEFAULT_PREFERENCES.readingWidth).to.equal('normal');
      expect(ReaderData.READING_WIDTHS.normal).to.equal('48rem');

      // The narrow setting is narrower than the default, and the wide
      // setting is wider.
      expect(ReaderData.READING_WIDTHS.narrow).to.equal('34rem');
      expect(ReaderData.READING_WIDTHS.wide).to.equal('60rem');
    });

    it('should apply the reading width as a custom property', () => {
      // A minimal stand-in for a document, so the application can be checked
      // without a browser.
      const props = {};
      const attributes = {};
      const fakeRoot = {
        style: {
          setProperty: (name, value) => {
            props[name] = value;
          },
        },
        setAttribute: (name, value) => {
          attributes[name] = value;
        },
      };
      const fakeDocument = { documentElement: fakeRoot, body: null };

      ReaderData.setPreference('readingWidth', 'wide');
      ReaderData.applyPreferences(fakeDocument);

      expect(props['--reader-max-width']).to.equal('60rem');
      expect(attributes['data-reader-width']).to.equal('wide');

      ReaderData.setPreference('readingWidth', 'narrow');
      ReaderData.applyPreferences(fakeDocument);

      expect(props['--reader-max-width']).to.equal('34rem');
      expect(attributes['data-reader-width']).to.equal('narrow');
    });

    it('should reset the preferences to their defaults', () => {
      ReaderData.setPreference('textSize', 'xlarge');
      ReaderData.setPreference('readingWidth', 'narrow');
      ReaderData.setPreference('reducedIntensity', true);
      ReaderData.resetPreferences();
      const prefs = ReaderData.getPreferences();
      expect(prefs.textSize).to.equal('medium');
      expect(prefs.readingWidth).to.equal('normal');
      expect(prefs.reducedIntensity).to.be.false;
    });
  });

  describe('Separation of the different kinds of saved data', () => {
    it('should keep bookmarks, progress, preferences and story paths apart', () => {
      ReaderData.addBookmark('a-bookmarked-post');
      ReaderData.setProgress('a-read-post', 0.5, 50);
      ReaderData.setPreference('textSize', 'large');
      ReaderData.setStoryPath('a-story', [{ nodeId: 'node-1', title: 'One', viaLabel: null }]);

      // Clearing the bookmarks leaves the rest alone.
      ReaderData.clearBookmarks();
      expect(ReaderData.getBookmarks()).to.deep.equal([]);
      expect(ReaderData.getProgress('a-read-post')).to.exist;
      expect(ReaderData.getPreferences().textSize).to.equal('large');
      expect(ReaderData.getStoryPath('a-story')).to.have.lengthOf(1);

      // Clearing the progress leaves the rest alone.
      ReaderData.clearProgress();
      expect(ReaderData.getProgressMap()).to.deep.equal({});
      expect(ReaderData.getPreferences().textSize).to.equal('large');
      expect(ReaderData.getStoryPath('a-story')).to.have.lengthOf(1);

      // Resetting the preferences leaves the rest alone.
      ReaderData.resetPreferences();
      expect(ReaderData.getPreferences().textSize).to.equal('medium');
      expect(ReaderData.getStoryPath('a-story')).to.have.lengthOf(1);
    });

    it('should clear the story paths without touching anything else', () => {
      ReaderData.addBookmark('a-bookmarked-post');
      ReaderData.setProgress('a-read-post', 0.5, 50);
      ReaderData.setPreference('textSize', 'large');
      ReaderData.setStoryPath('a-story', [{ nodeId: 'node-1', title: 'One', viaLabel: null }]);
      ReaderData.setStoryPath('another-story', [{ nodeId: 'node-2', title: 'Two', viaLabel: null }]);

      ReaderData.clearStoryPaths();

      expect(ReaderData.getStoryPath('a-story')).to.deep.equal([]);
      expect(ReaderData.getStoryPath('another-story')).to.deep.equal([]);
      expect(ReaderData.listStoryPathSlugs()).to.deep.equal([]);
      expect(ReaderData.getBookmarks()).to.deep.equal(['a-bookmarked-post']);
      expect(ReaderData.getProgress('a-read-post')).to.exist;
      expect(ReaderData.getPreferences().textSize).to.equal('large');
    });

    it('should use a separate storage key for each kind of data', () => {
      ReaderData.addBookmark('a-post');
      ReaderData.setProgress('a-post', 0.5, 50);
      ReaderData.setPreference('textSize', 'large');
      ReaderData.setStoryPath('a-story', [{ nodeId: 'node-1' }]);

      const keys = Array.from(storage.map.keys()).sort();
      expect(keys).to.deep.equal([
        'wdc.bookmarks',
        'wdc.preferences',
        'wdc.progress',
        'wdc.story.path.a-story',
      ]);
    });
  });

  describe('Interactive-story reading paths (Phase 9A)', () => {
    it('should read a path saved under the Phase 9A key', () => {
      // Exactly the shape and key Phase 9A wrote.
      storage.setItem(
        'wdc.story.path.the-ashen-corridor-demo',
        JSON.stringify([
          { nodeId: 'node-1', title: 'The Threshold', viaLabel: null },
          { nodeId: 'node-2', title: 'The Corridor', viaLabel: 'Walk on' },
        ])
      );
      const path = ReaderData.getStoryPath('the-ashen-corridor-demo');
      expect(path).to.have.lengthOf(2);
      expect(path[0].nodeId).to.equal('node-1');
      expect(path[1].viaLabel).to.equal('Walk on');
    });

    it('should discard malformed entries in a stored path', () => {
      storage.setItem(
        'wdc.story.path.a-story',
        JSON.stringify([
          { nodeId: 'node-1', title: 'Good', viaLabel: null },
          { title: 'No node id' },
          null,
          'a string',
          { nodeId: 42 },
        ])
      );
      const path = ReaderData.getStoryPath('a-story');
      expect(path).to.have.lengthOf(1);
      expect(path[0].nodeId).to.equal('node-1');
    });

    it('should return an empty path when the stored value is not JSON', () => {
      storage.setItem('wdc.story.path.a-story', 'not json');
      expect(ReaderData.getStoryPath('a-story')).to.deep.equal([]);
    });

    it('should save and read back a path', () => {
      const ok = ReaderData.setStoryPath('a-story', [
        { nodeId: 'node-1', title: 'One', viaLabel: null },
      ]);
      expect(ok).to.be.true;
      expect(ReaderData.getStoryPath('a-story')[0].nodeId).to.equal('node-1');
    });

    it('should list the stories that have a saved path', () => {
      ReaderData.setStoryPath('story-one', [{ nodeId: 'n1' }]);
      ReaderData.setStoryPath('story-two', [{ nodeId: 'n2' }]);
      expect(ReaderData.listStoryPathSlugs().sort()).to.deep.equal([
        'story-one',
        'story-two',
      ]);
    });

    it('should not list the other kinds of data as story paths', () => {
      ReaderData.addBookmark('a-post');
      ReaderData.setProgress('a-post', 0.5, 50);
      expect(ReaderData.listStoryPathSlugs()).to.deep.equal([]);
    });
  });

  describe('Storage failures', () => {
    it('should report that a write failed instead of throwing', () => {
      storage.failOnSet = true;
      const result = ReaderData.addBookmark('test-blog-post');
      expect(result.ok).to.be.false;
      expect(result.error).to.be.a('string');
    });

    it('should not throw when the progress cannot be written', () => {
      storage.failOnSet = true;
      expect(ReaderData.setProgress('a-post', 0.5, 50)).to.be.false;
    });

    it('should not throw when the preferences cannot be written', () => {
      storage.failOnSet = true;
      const result = ReaderData.setPreference('textSize', 'large');
      expect(result.ok).to.be.false;
      expect(result.error).to.be.a('string');
    });

    it('should not throw when a read fails', () => {
      storage.failOnGet = true;
      expect(ReaderData.getBookmarks()).to.deep.equal([]);
      expect(ReaderData.getProgressMap()).to.deep.equal({});
      expect(ReaderData.getPreferences().textSize).to.equal('medium');
    });

    it('should not throw when a removal fails', () => {
      ReaderData.addBookmark('test-blog-post');
      storage.failOnRemove = true;
      expect(() => ReaderData.clearBookmarks()).to.not.throw();
      expect(() => ReaderData.clearProgress()).to.not.throw();
      expect(() => ReaderData.resetPreferences()).to.not.throw();
    });

    it('should not throw when the key listing fails', () => {
      storage.failOnKey = true;
      expect(ReaderData.listStoryPathSlugs()).to.deep.equal([]);
      expect(() => ReaderData.clearStoryPaths()).to.not.throw();
    });

    it('should report that storage is unavailable', () => {
      storage.failOnSet = true;
      expect(ReaderData.isStorageAvailable()).to.be.false;
    });

    it('should report that storage is available when it works', () => {
      expect(ReaderData.isStorageAvailable()).to.be.true;
    });

    it('should not throw when localStorage is missing entirely', () => {
      delete globalThis.localStorage;
      expect(ReaderData.getBookmarks()).to.deep.equal([]);
      expect(ReaderData.getProgressMap()).to.deep.equal({});
      expect(ReaderData.getPreferences().textSize).to.equal('medium');
      expect(ReaderData.addBookmark('a-post').ok).to.be.false;
      expect(ReaderData.isStorageAvailable()).to.be.false;
    });
  });

  describe('What is stored', () => {
    it('should store only a slug for a bookmark', () => {
      ReaderData.addBookmark('test-blog-post');
      const raw = storage.getItem('wdc.bookmarks');
      expect(raw).to.equal('["test-blog-post"]');
      expect(raw).to.not.contain('content');
      expect(raw).to.not.contain('password');
      expect(raw).to.not.contain('token');
    });

    it('should store only figures for a reading position', () => {
      ReaderData.setProgress('test-blog-post', 0.5, 50);
      const raw = storage.getItem('wdc.progress');
      expect(raw).to.contain('"r":0.5');
      expect(raw).to.contain('"p":50');
      expect(raw).to.not.contain('content');
    });

    it('should store only the preference names and values', () => {
      ReaderData.setPreference('textSize', 'large');
      ReaderData.setPreference('readingWidth', 'wide');
      ReaderData.setPreference('reducedIntensity', true);
      const raw = storage.getItem('wdc.preferences');
      expect(raw).to.contain('textSize');
      expect(raw).to.contain('readingWidth');
      expect(raw).to.contain('reducedIntensity');
      expect(raw).to.not.contain('password');
      expect(raw).to.not.contain('auth_token');
    });

    it('should never write an authentication secret', () => {
      ReaderData.addBookmark('a-post');
      ReaderData.setProgress('a-post', 0.5, 50);
      ReaderData.setPreference('textSize', 'large');
      ReaderData.setStoryPath('a-story', [{ nodeId: 'n1' }]);

      const everything = Array.from(storage.map.values()).join(' ');
      expect(everything).to.not.contain('auth_token');
      expect(everything).to.not.contain('csrf');
      expect(everything).to.not.contain('eyJ');
      expect(everything).to.not.contain('password');
    });
  });

  describe('Summary', () => {
    it('should report what is currently stored', () => {
      ReaderData.addBookmark('a-post');
      ReaderData.setProgress('b-post', 0.5, 50);
      ReaderData.setStoryPath('a-story', [{ nodeId: 'n1' }]);

      const summary = ReaderData.getSummary();
      expect(summary.bookmarks).to.deep.equal(['a-post']);
      expect(Object.keys(summary.progress)).to.deep.equal(['b-post']);
      expect(summary.storyPaths).to.deep.equal(['a-story']);
      expect(summary.storageAvailable).to.be.true;
    });
  });
});
