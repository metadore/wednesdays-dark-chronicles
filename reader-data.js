/*
 * reader-data.js — the single owner of this site's browser-local reading data.
 *
 * Three independent features live here, each under its OWN storage key, so
 * that clearing one can never erase another:
 *
 *   wdc.bookmarks     the slugs of bookmarked articles
 *   wdc.progress      the reading position of each article
 *   wdc.preferences   the reader's text size, reading width and intensity
 *   wdc.story.path.*  the interactive-story reading paths (Phase 9A)
 *
 * Rules that apply to every read and write:
 *
 *   - Nothing is trusted. Every value read from storage is validated, and
 *     anything malformed or outdated is discarded rather than used.
 *   - Nothing throws. Storage can be unavailable (private mode, a disabled
 *     cookie policy) or full. A failure degrades quietly; it never breaks
 *     the page and never deletes anything else.
 *   - No secret is ever stored. Bookmarks hold a public article slug;
 *     progress holds a scroll ratio; preferences hold a few numbers and
 *     booleans. No token, password or cookie is written here.
 *
 * The file is a classic script so a page can load it with <script src>, and
 * it also exports itself under CommonJS so the Node test suite can exercise
 * the parsing and validation rules directly.
 */
(function (root, factory) {
  'use strict';
  var api = factory(root);
  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  } else {
    root.ReaderData = api;
  }
})(
  // In a browser this is `window`; in Node it is `globalThis`. The lookup
  // must not rely on `this`, because `this` is undefined at the top level of
  // a strict-mode CommonJS module.
  typeof globalThis !== 'undefined'
    ? globalThis
    : typeof window !== 'undefined'
      ? window
      : typeof self !== 'undefined'
        ? self
        : {},
  function (root) {
  'use strict';

  // --- Storage keys --------------------------------------------------------

  var KEYS = {
    bookmarks: 'wdc.bookmarks',
    progress: 'wdc.progress',
    preferences: 'wdc.preferences',
  };

  // The interactive-story reading paths keep the exact key format they used
  // in Phase 9A: 'wdc.story.path.' + slug.
  var STORY_PATH_PREFIX = 'wdc.story.path.';

  // --- Limits --------------------------------------------------------------

  var MAX_SLUG_LENGTH = 80;
  var MAX_BOOKMARKS = 500;
  var MAX_PROGRESS_ENTRIES = 500;
  var MAX_STORY_PATH_LENGTH = 500;

  // A slug is what the public API resolves, so it is the identifier stored.
  var SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

  // --- Preferences ---------------------------------------------------------

  var TEXT_SIZES = {
    small: { size: '16px', line: '24px' },
    medium: { size: '18px', line: '28px' },
    large: { size: '21px', line: '32px' },
    xlarge: { size: '24px', line: '38px' },
  };

  var READING_WIDTHS = {
    narrow: '34rem',
    normal: '48rem',
    wide: '60rem',
  };

  var DEFAULT_PREFERENCES = {
    textSize: 'medium',
    readingWidth: 'normal',
    reducedIntensity: false,
  };

  // --- Low-level storage access -------------------------------------------

  /**
   * Return localStorage, or null when it is unavailable. Reading
   * `window.localStorage` can itself throw in some privacy configurations,
   * so even the lookup is guarded.
   */
  function getStore() {
    try {
      var store = root.localStorage;
      return store || null;
    } catch (e) {
      return null;
    }
  }

  function readRaw(key) {
    var store = getStore();
    if (!store) return null;
    try {
      return store.getItem(key);
    } catch (e) {
      return null;
    }
  }

  function writeRaw(key, value) {
    var store = getStore();
    if (!store) return false;
    try {
      store.setItem(key, value);
      return true;
    } catch (e) {
      // A full quota or a blocked write must not break the page, and must
      // not remove anything that is already stored.
      return false;
    }
  }

  function removeRaw(key) {
    var store = getStore();
    if (!store) return false;
    try {
      store.removeItem(key);
      return true;
    } catch (e) {
      return false;
    }
  }

  /** Parse a JSON string, returning null when it is not valid JSON. */
  function parseJson(raw) {
    if (typeof raw !== 'string' || !raw) return null;
    try {
      return JSON.parse(raw);
    } catch (e) {
      return null;
    }
  }

  // --- Validation ----------------------------------------------------------

  function isValidSlug(value) {
    return (
      typeof value === 'string' &&
      value.length > 0 &&
      value.length <= MAX_SLUG_LENGTH &&
      SLUG_PATTERN.test(value)
    );
  }

  function isFiniteNumber(value) {
    return typeof value === 'number' && isFinite(value);
  }

  // --- Bookmarks -----------------------------------------------------------

  /**
   * The bookmarked article slugs, in the order they were bookmarked.
   * Duplicates and malformed entries are dropped.
   */
  function getBookmarks() {
    var parsed = parseJson(readRaw(KEYS.bookmarks));
    if (!Array.isArray(parsed)) return [];

    var out = [];
    for (var i = 0; i < parsed.length; i += 1) {
      var slug = parsed[i];
      if (!isValidSlug(slug)) continue;
      if (out.indexOf(slug) !== -1) continue;
      out.push(slug);
      if (out.length >= MAX_BOOKMARKS) break;
    }
    return out;
  }

  /**
   * Bookmark an article.
   *
   * @returns {{ok: boolean, duplicate: boolean, error: string|null}}
   *          `duplicate` is true when the article was already bookmarked and
   *          nothing was written.
   */
  function addBookmark(slug) {
    if (!isValidSlug(slug)) {
      return { ok: false, duplicate: false, error: 'That entry could not be identified.' };
    }

    var current = getBookmarks();
    if (current.indexOf(slug) !== -1) {
      return { ok: false, duplicate: true, error: 'This entry is already bookmarked.' };
    }
    if (current.length >= MAX_BOOKMARKS) {
      return { ok: false, duplicate: false, error: 'The bookmark list is full.' };
    }

    current.push(slug);
    var written = writeRaw(KEYS.bookmarks, JSON.stringify(current));
    if (!written) {
      return { ok: false, duplicate: false, error: 'The bookmark could not be saved in this browser.' };
    }
    return { ok: true, duplicate: false, error: null };
  }

  /** Remove a bookmark. Returns true when the list actually changed. */
  function removeBookmark(slug) {
    if (!isValidSlug(slug)) return false;

    var current = getBookmarks();
    var index = current.indexOf(slug);
    if (index === -1) return false;

    current.splice(index, 1);
    writeRaw(KEYS.bookmarks, JSON.stringify(current));
    return true;
  }

  function isBookmarked(slug) {
    return isValidSlug(slug) && getBookmarks().indexOf(slug) !== -1;
  }

  /** Remove every bookmark. Only the bookmark key is touched. */
  function clearBookmarks() {
    return removeRaw(KEYS.bookmarks);
  }

  // --- Reading progress ----------------------------------------------------

  /**
   * The stored progress entries, keyed by article slug.
   *
   * Each entry is { r: ratio 0..1, p: percent 0..100, u: updatedAt ms }.
   * Entries whose slug is malformed, or whose numbers are missing, out of
   * range or not finite, are discarded.
   */
  function getProgressMap() {
    var parsed = parseJson(readRaw(KEYS.progress));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};

    var out = {};
    var count = 0;
    for (var slug in parsed) {
      if (!Object.prototype.hasOwnProperty.call(parsed, slug)) continue;
      if (!isValidSlug(slug)) continue;

      var entry = parsed[slug];
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue;

      var ratio = entry.r;
      if (!isFiniteNumber(ratio) || ratio < 0 || ratio > 1) continue;

      var percent = entry.p;
      if (!isFiniteNumber(percent) || percent < 0 || percent > 100) continue;

      var updatedAt = entry.u;
      if (!isFiniteNumber(updatedAt) || updatedAt < 0) continue;

      out[slug] = { r: ratio, p: percent, u: updatedAt };
      count += 1;
      if (count >= MAX_PROGRESS_ENTRIES) break;
    }
    return out;
  }

  /** The stored progress for one article, or null when there is none. */
  function getProgress(slug) {
    if (!isValidSlug(slug)) return null;
    var map = getProgressMap();
    return Object.prototype.hasOwnProperty.call(map, slug) ? map[slug] : null;
  }

  /**
   * Record how far through an article the reader has got.
   *
   * @param {string} slug
   * @param {number} ratio  0..1, the fraction of the article read
   * @param {number} percent 0..100, the same figure for display
   * @returns {boolean} whether the value was stored
   */
  function setProgress(slug, ratio, percent) {
    if (!isValidSlug(slug)) return false;
    if (!isFiniteNumber(ratio) || ratio < 0 || ratio > 1) return false;
    if (!isFiniteNumber(percent) || percent < 0 || percent > 100) return false;

    var map = getProgressMap();
    map[slug] = { r: ratio, p: percent, u: Date.now() };
    return writeRaw(KEYS.progress, JSON.stringify(map));
  }

  /** Forget the progress for one article. */
  function removeProgress(slug) {
    if (!isValidSlug(slug)) return false;

    var map = getProgressMap();
    if (!Object.prototype.hasOwnProperty.call(map, slug)) return false;

    delete map[slug];
    writeRaw(KEYS.progress, JSON.stringify(map));
    return true;
  }

  /** Remove every saved reading position. Only the progress key is touched. */
  function clearProgress() {
    return removeRaw(KEYS.progress);
  }

  // --- Reading preferences -------------------------------------------------

  /** The stored preferences, with any invalid value replaced by its default. */
  function getPreferences() {
    var parsed = parseJson(readRaw(KEYS.preferences));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return {
        textSize: DEFAULT_PREFERENCES.textSize,
        readingWidth: DEFAULT_PREFERENCES.readingWidth,
        reducedIntensity: DEFAULT_PREFERENCES.reducedIntensity,
      };
    }

    var textSize = parsed.textSize;
    if (!Object.prototype.hasOwnProperty.call(TEXT_SIZES, textSize)) {
      textSize = DEFAULT_PREFERENCES.textSize;
    }

    var readingWidth = parsed.readingWidth;
    if (!Object.prototype.hasOwnProperty.call(READING_WIDTHS, readingWidth)) {
      readingWidth = DEFAULT_PREFERENCES.readingWidth;
    }

    var reducedIntensity = parsed.reducedIntensity;
    if (typeof reducedIntensity !== 'boolean') {
      reducedIntensity = DEFAULT_PREFERENCES.reducedIntensity;
    }

    return { textSize: textSize, readingWidth: readingWidth, reducedIntensity: reducedIntensity };
  }

  /**
   * Change one preference.
   *
   * @returns {{ok: boolean, error: string|null}}
   */
  function setPreference(key, value) {
    if (key !== 'textSize' && key !== 'readingWidth' && key !== 'reducedIntensity') {
      return { ok: false, error: 'That setting is not recognised.' };
    }

    if (key === 'textSize' && !Object.prototype.hasOwnProperty.call(TEXT_SIZES, value)) {
      return { ok: false, error: 'That text size is not available.' };
    }
    if (key === 'readingWidth' && !Object.prototype.hasOwnProperty.call(READING_WIDTHS, value)) {
      return { ok: false, error: 'That reading width is not available.' };
    }
    if (key === 'reducedIntensity' && typeof value !== 'boolean') {
      return { ok: false, error: 'That setting is not recognised.' };
    }

    var current = getPreferences();
    current[key] = value;
    if (!writeRaw(KEYS.preferences, JSON.stringify(current))) {
      return { ok: false, error: 'The setting could not be saved in this browser.' };
    }
    return { ok: true, error: null };
  }

  /** Forget every preference, so the defaults apply again. */
  function resetPreferences() {
    return removeRaw(KEYS.preferences);
  }

  /**
   * Apply the preferences to a document: CSS custom properties for the
   * typographic settings, and a class for the reduced-intensity setting.
   *
   * Applying them as custom properties avoids a layout shift, because the
   * browser only needs to recompute the affected rules.
   */
  function applyPreferences(doc) {
    var target = doc || (typeof document !== 'undefined' ? document : null);
    if (!target || !target.documentElement) return;

    var prefs = getPreferences();
    var size = TEXT_SIZES[prefs.textSize];
    var root = target.documentElement;

    root.style.setProperty('--reader-text-size', size.size);
    root.style.setProperty('--reader-line-height', size.line);
    root.style.setProperty('--reader-max-width', READING_WIDTHS[prefs.readingWidth]);
    root.setAttribute('data-reader-text-size', prefs.textSize);
    root.setAttribute('data-reader-width', prefs.readingWidth);

    if (target.body) {
      if (prefs.reducedIntensity) {
        target.body.classList.add('reader-reduced-intensity');
      } else {
        target.body.classList.remove('reader-reduced-intensity');
      }
    }
  }

  // --- Interactive-story reading paths (Phase 9A) --------------------------

  function storyPathKey(slug) {
    return STORY_PATH_PREFIX + slug;
  }

  /**
   * The reading path for an interactive story.
   *
   * The shape and the key are exactly what Phase 9A used, so an existing
   * saved path is still recognised after this file is introduced.
   */
  function getStoryPath(slug) {
    if (typeof slug !== 'string' || !slug) return [];

    var parsed = parseJson(readRaw(storyPathKey(slug)));
    if (!Array.isArray(parsed)) return [];

    var out = [];
    for (var i = 0; i < parsed.length; i += 1) {
      var entry = parsed[i];
      if (!entry || typeof entry !== 'object') continue;
      if (typeof entry.nodeId !== 'string' || !entry.nodeId.length) continue;

      out.push({
        nodeId: entry.nodeId,
        title: typeof entry.title === 'string' ? entry.title : '',
        viaLabel: typeof entry.viaLabel === 'string' ? entry.viaLabel : null,
      });
      if (out.length >= MAX_STORY_PATH_LENGTH) break;
    }
    return out;
  }

  function setStoryPath(slug, path) {
    if (typeof slug !== 'string' || !slug) return false;
    if (!Array.isArray(path)) return false;

    var cleaned = [];
    for (var i = 0; i < path.length; i += 1) {
      var entry = path[i];
      if (!entry || typeof entry !== 'object') continue;
      if (typeof entry.nodeId !== 'string' || !entry.nodeId.length) continue;
      cleaned.push({
        nodeId: entry.nodeId,
        title: typeof entry.title === 'string' ? entry.title : '',
        viaLabel: typeof entry.viaLabel === 'string' ? entry.viaLabel : null,
      });
      if (cleaned.length >= MAX_STORY_PATH_LENGTH) break;
    }

    return writeRaw(storyPathKey(slug), JSON.stringify(cleaned));
  }

  function clearStoryPath(slug) {
    if (typeof slug !== 'string' || !slug) return false;
    return removeRaw(storyPathKey(slug));
  }

  /** The slugs of the stories that have a saved reading path. */
  function listStoryPathSlugs() {
    var store = getStore();
    if (!store) return [];

    var out = [];
    try {
      for (var i = 0; i < store.length; i += 1) {
        var key = store.key(i);
        if (typeof key === 'string' && key.indexOf(STORY_PATH_PREFIX) === 0) {
          out.push(key.slice(STORY_PATH_PREFIX.length));
        }
      }
    } catch (e) {
      return out;
    }
    return out;
  }

  /**
   * Remove every saved interactive-story path.
   *
   * This touches only the 'wdc.story.path.' keys, so bookmarks, reading
   * positions and preferences are untouched.
   */
  function clearStoryPaths() {
    var store = getStore();
    if (!store) return false;

    var keys = [];
    try {
      for (var i = 0; i < store.length; i += 1) {
        var key = store.key(i);
        if (typeof key === 'string' && key.indexOf(STORY_PATH_PREFIX) === 0) {
          keys.push(key);
        }
      }
    } catch (e) {
      return false;
    }

    var removed = 0;
    for (var k = 0; k < keys.length; k += 1) {
      if (removeRaw(keys[k])) removed += 1;
    }
    return removed > 0;
  }

  // --- Diagnostics ---------------------------------------------------------

  /** Whether browser storage is usable at all, for the interface to explain. */
  function isStorageAvailable() {
    var store = getStore();
    if (!store) return false;
    try {
      var probe = '__wdc_probe__';
      store.setItem(probe, '1');
      store.removeItem(probe);
      return true;
    } catch (e) {
      return false;
    }
  }

  /**
   * A summary of what is currently stored. Used by the reader-data panel so
   * the reader can see what is held, and so the tests can assert that the
   * three features are genuinely independent.
   */
  function getSummary() {
    return {
      bookmarks: getBookmarks(),
      progress: getProgressMap(),
      preferences: getPreferences(),
      storyPaths: listStoryPathSlugs(),
      storageAvailable: isStorageAvailable(),
    };
  }

  return {
    KEYS: KEYS,
    STORY_PATH_PREFIX: STORY_PATH_PREFIX,
    TEXT_SIZES: TEXT_SIZES,
    READING_WIDTHS: READING_WIDTHS,
    DEFAULT_PREFERENCES: DEFAULT_PREFERENCES,
    MAX_BOOKMARKS: MAX_BOOKMARKS,

    getBookmarks: getBookmarks,
    addBookmark: addBookmark,
    removeBookmark: removeBookmark,
    isBookmarked: isBookmarked,
    clearBookmarks: clearBookmarks,

    getProgressMap: getProgressMap,
    getProgress: getProgress,
    setProgress: setProgress,
    removeProgress: removeProgress,
    clearProgress: clearProgress,

    getPreferences: getPreferences,
    setPreference: setPreference,
    resetPreferences: resetPreferences,
    applyPreferences: applyPreferences,

    getStoryPath: getStoryPath,
    setStoryPath: setStoryPath,
    clearStoryPath: clearStoryPath,
    clearStoryPaths: clearStoryPaths,
    listStoryPathSlugs: listStoryPathSlugs,

    isStorageAvailable: isStorageAvailable,
    getSummary: getSummary,
  };
  }
);
