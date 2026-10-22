/* admin/api-config.js — where the admin dashboard finds the API.
 *
 * The dashboard is served in two different arrangements:
 *
 *   - by a host that also serves (or proxies) the API. Then the API is on
 *     the same origin and the relative path '/api' is correct. This is the
 *     production arrangement, and the one the browser tests use.
 *
 *   - by a static development server on its own port, with the API on the
 *     backend's port. Then the relative path '/api' points at the static
 *     server, which has no API on it, and every request fails.
 *
 * The order of preference is the same as the one the public site already
 * uses in reader-config.js:
 *
 *   1. window.__API_BASE__ — set by the page, by the host at serve time, or
 *      by a small inline script in the HTML. This is the explicit override.
 *   2. A <meta name="api-base" content="..."> tag — a way for a static host
 *      to configure the API without editing any JavaScript.
 *   3. A development fallback, used ONLY when the dashboard is being opened
 *      on a loopback address. It then points at the backend's own port on
 *      the SAME host name as the page.
 *   4. The same origin ('/api') — the correct default for a deployment where
 *      one host serves both the site and the API.
 *
 * Why the development fallback repeats the page's host name
 * ------------------------------------------------------
 * The API sets its session cookie with `sameSite: 'Strict'`. 'Strict' means
 * the browser only sends the cookie on same-site requests, and the site is
 * decided by the host name. 'localhost' and '127.0.0.1' are different sites
 * to a browser, even though they reach the same machine:
 *
 *   a page on http://localhost:5500 talking to http://127.0.0.1:3000/api
 *   would receive the authentication cookie and then never send it back,
 *   and every authenticated request would fail with 401.
 *
 * So the development fallback derives the API origin from the page's own
 * host: a dashboard opened on http://127.0.0.1:5500 uses
 * http://127.0.0.1:3000/api, and one opened on http://localhost:5500 uses
 * http://localhost:3000/api. Either way the site and the API are the same
 * site, and the cookie is sent.
 *
 * A production deployment must never fall back to a hardcoded development
 * origin: a page served from https://example.com that resolved the API to
 * http://localhost:3000/api would send every administrator's request to
 * their own machine, where nothing is listening. The same-origin default is
 * used instead, and a split deployment supplies the real origin through
 * one of the mechanisms above.
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
   * Returns null when the page is not a local development page, or when the
   * page is already served from the backend's own port.
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

    // 3. A dashboard opened on the development machine.
    var development = developmentApiBase();
    if (development) return development;

    // 4. The site and the API are served from the same origin.
    return SAME_ORIGIN_API;
  };

  root.AdminConfig = {
    apiBase: resolve(),
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
