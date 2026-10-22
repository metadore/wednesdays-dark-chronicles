/* reader-config.js — where the pages find the API.
 *
 * The site can be served in two ways:
 *
 *   - by a static server alone, in which case the API lives on another
 *     origin and this file has to be told where that is;
 *   - by a server that also serves (or proxies) the API, in which case the
 *     relative path '/api' is correct.
 *
 * The order of preference is:
 *
 *   1. window.__API_BASE__ — set by the page, by the host at serve time, or
 *      by a small inline script in the HTML. This is the explicit override.
 *   2. A <meta name="api-base" content="..."> tag — a way for a static host
 *      to configure the API without editing any JavaScript.
 *   3. The development API, when the page is opened on a loopback address.
 *      A static development server serves the site on one port and the API
 *      on another, so the relative path '/api' points at the static server
 *      and every request 404s.
 *   4. The same origin ('/api') — the correct default for a deployment where
 *      one host serves both the site and the API.
 *
 * Why step 3 repeats the page's own host name
 * --------------------------------------------
 * The API sets its session cookie with `sameSite: 'Strict'`, and the CSRF
 * cookies travel with it. 'Strict' means the browser only sends the cookie
 * on same-site requests, and the site is decided by the host name:
 * 'localhost' and '127.0.0.1' are DIFFERENT sites to a browser, even
 * though they usually reach the same machine.
 *
 * So a page opened on the 127.0.0.1 loopback, talking to the API on the
 * localhost loopback, would receive the cookie and then never send it back,
 * and every authenticated request would fail with a 401 that looks like a
 * server fault. The development base therefore repeats the page's own host
 * name: a page on 127.0.0.1 uses 127.0.0.1, and a page on localhost uses
 * localhost. Either way the site and the API are the same site, and the
 * cookie is sent.
 *
 * Why a production deployment must not fall back to a development origin
 * ----------------------------------------------------------------------
 * A page served from https://example.com that resolved the API to a
 * loopback origin would send every reader's request to their own machine,
 * where nothing is listening. Step 3 is therefore reachable ONLY
 * for a loopback address: a page on a real host never sees it, and falls
 * through to the same-origin '/api' instead. There is no development
 * origin written into this file at all — the loopback base is built from
 * the page's own location at runtime.
 */
(function (root) {
  'use strict';

  /** The API base for a same-origin deployment (site and API on one host). */
  var SAME_ORIGIN_API = '/api';

  /** The port the backend listens on in development. */
  var DEVELOPMENT_API_PORT = '3000';

  /** The loopback host names a browser treats as the local machine. */
  var LOOPBACK_HOSTS = ['localhost', '127.0.0.1', '::1', '[::1]'];

  var isNonEmptyString = function (value) {
    return typeof value === 'string' && value.trim() !== '';
  };

  /**
   * Normalise an API base: no trailing slash, and always ending in '/api'.
   * A host may configure 'https://api.example.com' or
   * 'https://api.example.com/api'; both are accepted.
   */
  var normalise = function (value) {
    if (!isNonEmptyString(value)) return null;
    var trimmed = value.trim().replace(/\/+$/, '');
    if (trimmed === '') return null;
    if (!/\/api$/.test(trimmed)) trimmed += '/api';
    return trimmed;
  };

  /** Read the <meta name="api-base"> tag, if the page has one. */
  var fromMetaTag = function () {
    try {
      var doc = root.document;
      if (!doc || typeof doc.querySelector !== 'function') return null;
      var tag = doc.querySelector('meta[name="api-base"]');
      if (!tag) return null;
      return normalise(tag.getAttribute('content'));
    } catch (e) {
      return null;
    }
  };

  /** The page's location, if the page is running in a browser. */
  var location_ = function () {
    try {
      return root.location || null;
    } catch (e) {
      return null;
    }
  };

  /**
   * The development API base for a page opened on a loopback address.
   *
   * Returns null when the page is not a local development page, or when the
   * page is already served from the backend's own port (in which case the
   * same-origin path is the right answer).
   */
  var developmentApiBase = function () {
    var loc = location_();
    if (!loc) return null;

    var host = String(loc.hostname || '').toLowerCase();
    if (LOOPBACK_HOSTS.indexOf(host) === -1) return null;

    // The page is already the API host: the same-origin path is right.
    if (String(loc.port || '') === DEVELOPMENT_API_PORT) return null;

    return 'http://' + host + ':' + DEVELOPMENT_API_PORT + '/api';
  };

  var resolve = function () {
    // 1. Explicitly configured by the page or by the server.
    if (isNonEmptyString(root.__API_BASE__)) {
      return normalise(root.__API_BASE__) || SAME_ORIGIN_API;
    }

    // 2. Configured by the static host through a meta tag.
    var fromMeta = fromMetaTag();
    if (fromMeta) return fromMeta;

    // 3. A page opened on the development machine.
    var development = developmentApiBase();
    if (development) return development;

    // 4. The site and the API are served from the same origin.
    return SAME_ORIGIN_API;
  };

  root.ReaderConfig = {
    apiBase: resolve(),
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
