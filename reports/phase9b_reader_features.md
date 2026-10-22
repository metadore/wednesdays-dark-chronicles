# Phase 9B — Bookmarks, Reading Progress, and Reader Preferences Report

**Date:** 2026-10-21
**Scope:** Bookmarks, reading progress and reading preferences, stored in the browser. No redesign of the existing website, no reader accounts, no new authentication, and — as it turned out — **no database change at all**.
**Status:** Phase 9B complete, including the **Phase 9B.1** correction that made the reading-width preference visibly affect the article's reading column (§16). **Awaiting explicit approval before beginning Phase 10.**

---

## 1. Pre-Flight Inspection

The implementation was inspected before anything was changed. The findings
that shaped the work are recorded here.

| Inspected | Finding |
|---|---|
| `post.html` | The article page. It rendered the article with `innerHTML` interpolation of `post.title`, `post.content` and `post.coverImageUrl` — a **pre-existing XSS risk** in the reader, which this phase had to fix because the phase requires safe DOM APIs. It had no bookmark button, no progress indicator and no preferences. It already loaded `reader-data.js`/`reader-ui.js` after this phase. |
| The blog frontend | `grim_chronicles/code.html` renders cards from `GET /api/posts` with `escapeHtml` and `safeImageUrl`. It already had the `unwrap()` envelope helper and a Roman-numeral pagination bar. No browser storage was used anywhere. |
| The Vault frontend | `the_vault/code.html` renders from `GET /api/artifacts`, with a detail modal. No storage. |
| `branching_stories/code.html` | The story listing (Phase 9A). No storage. |
| `branching_stories/reader.html` | The Phase 9A reader. It had its **own private** localStorage code: `PATH_PREFIX = 'wdc.story.path.'`, plus `loadPath`, `savePath` and `clearPath`. This is the functionality that had to be preserved. |
| `public/admin/index.html` / `app.js` | The Grimoire. It sets `window.__API_BASE__` and uses a shared `apiFetch()` helper that attaches a CSRF token to every state-changing request. |
| Shared CSS and components | The "Obsidian & Ink" token set in `obsidian_ink/DESIGN.md`: obsidian `#0A0A0A`, `surface-container-lowest #0e0e0e`, burgundy accents, `Libre Caslon Text` headings, `Inter` body, `Geist Mono` labels, square corners, hard shadows. |
| Prisma schema | Eleven models, unchanged. **No schema change was needed for this phase.** |
| Test configuration | `src/lib/test-env.js` (fail-closed), `src/lib/prisma.js` (explicit test datasource), `scripts/prisma-cli.js` (forces the CLI onto the same database), `tests/setup/test-mode-guard.cjs` (aborts without `NODE_ENV=test`). All preserved unchanged. |

### 1.1 Two findings that changed the design

**The seeded articles are extremely short.** Every published article in the
live database is between 12 and 44 characters long:

```
PUB  elegies-in-dust          len=    35
PUB  taxonomy-of-shadows      len=    43
PUB  test-blog-post           len=    44
PUB  test-post                len=    12
```

A 44-character article is shorter than any viewport, so it fits on one
screen and there is nothing to scroll. The brief asks for the short-article
case to be handled sensibly, and it also means the *scrolling* case cannot be
exercised against the seeded content. The browser tests therefore create a
**long** published article as a fixture, and the short-article case is
tested separately and explicitly.

**`post.html` had an XSS hole.** The article body was interpolated straight
into `innerHTML`:

```js
contentDiv.innerHTML = `
    ...
    <h1 ...>${post.title}</h1>
    ...
    ${post.content}
`;
```

A stored title or body containing markup would have been executed by the
browser. This phase requires safe DOM APIs, so the article rendering was
rewritten to build the DOM with `createElement` and `textContent`. The
change is documented in §5.

---

## 2. Database Impact

**None. No schema change, no migration, no new model, no new column.**

This is worth stating plainly because the brief asked for the reason to be
explained *before* implementing it if a schema change were needed. No
such change was needed:

* A bookmark is a **public article slug**, which already exists.
* A reading position is a **scroll ratio**, which is derived from the page
  at read time and is meaningless without the page.
* A preference is a **text size, a width and a boolean**.
* A story path is a **list of node ids**, which already exist in Phase 9A.

None of these is a record that the server needs to hold, and none of them
benefits from being in the database: a bookmark list is per browser, and
putting it server-side would require reader accounts, which the brief
explicitly forbids (*"Do not introduce reader accounts or new authentication
requirements"*).

The existing public API was reused exactly as the brief asked. **No new
backend endpoint was created.** The reader features resolve saved articles
through the existing `GET /api/posts/:slug`, which already returns `404` for
an article that is unpublished or deleted — that is what makes the
"unavailable entry" handling work without any new code.

The schema, the migrations and the seed are byte-for-byte unchanged:

```
$ ls backend/prisma/migrations/
20261019081137_init
20261019094251_add_published_to_artifact
20261019140136_add_user_model
20261019164627_add_inquiry_model
20261019165239_add_comments_model
20261021081641_add_branching_stories     <- Phase 9A
```

---

## 3. Files

### 3.1 Created

| File | Lines | Purpose |
|---|---|---|
| `reader-data.js` | 585 | **The single owner of all browser-local reading data.** Bookmarks, reading progress, reading preferences and the Phase 9A story paths. Validates everything it reads; never throws. |
| `reader-ui.js` | 802 | The shared behaviour: the reading-settings panel, the progress tracker, the bookmark button, the saved-entry list, the data panel. |
| `reader-config.js` | 40 | Where each page finds the API. Falls back to the same origin when the site is served with the API proxy. |
| `reader.css` | 576 | The shared styles: the preference custom properties, the settings panel, the progress indicator, the bookmark button, the saved-entry cards, the data panel. |
| `bookmarks/code.html` | 304 | The bookmarks view. **In Phase 9B.1** its main column and card excerpts follow the reading preferences (§16). |
| `backend/tests/unit/reader-data.test.js` | 568 | 58 unit tests for the storage layer. |
| `backend/tests/browser/reader-features.test.js` | 1084 | 38 browser tests, driving a real Chrome. |
| `backend/tests/browser/harness.js` | 162 | Starts an isolated backend and static server for the browser tests. |
| `backend/scripts/static-server.js` | 132 | A dependency-free static server that also proxies `/api`. |
| `backend/scripts/cleanup-test-stories.js` | 71 | Removes this project's test fixtures from the **test** database. Refuses to run against production. |

### 3.2 Modified

| File | Change |
|---|---|
| `post.html` | The article rendering was rewritten to use safe DOM APIs. The bookmark button, the progress indicator, the reading-settings button and the data panel were added. `reader-config.js`, `reader-data.js` and `reader-ui.js` are loaded. **In Phase 9B.1** the reading column was changed from `max-w-3xl` to `reader-column`, so the reading-width preference affects it (§16). |
| `grim_chronicles/code.html` | A bookmark button on every article card, `reader.css`, `reader-config.js`, `reader-data.js` and `reader-ui.js` loaded, and a "Bookmarks" entry in the sidebar. **In Phase 9B.1** the reading-settings button and panel were added, and the card excerpts follow the text size (§16). |
| `home_the_void/code.html` | A "Bookmarks" entry in the sidebar. |
| `the_vault/code.html` | A "Bookmarks" entry in the sidebar. |
| `branching_stories/reader.html` | Its private localStorage code was **replaced** by the shared `ReaderData` layer. The storage key and the stored shape are unchanged, so a path saved by Phase 9A is still found. |
| `backend/package.json` | `puppeteer-core` added as a dev dependency, for the browser tests. |
| `backend/package-lock.json` | The matching lockfile entry. |

### 3.3 Not modified

`public/admin/index.html`, `public/admin/app.js` and `public/admin/style.css`
were **not touched in this phase** — the Grimoire needed no change, and the
brief says to preserve it. `backend/prisma/schema.prisma`, every migration,
`prisma/seed.js`, every backend controller, route and middleware, every
existing test, `.env`, `.env.test`, `.env.example` and
`docker-compose.yml` are all unchanged.

---

## 4. The Storage Design

### 4.1 The four keys

Each feature owns its own key, so clearing one can never erase another:

| Key | Holds | Cleared by |
|---|---|---|
| `wdc.bookmarks` | An array of article slugs | "Clear bookmarks" |
| `wdc.progress` | A map of slug → `{ r, p, u }` | "Clear reading positions" |
| `wdc.preferences` | `{ textSize, readingWidth, reducedIntensity }` | "Reset settings" |
| `wdc.story.path.<slug>` | An array of `{ nodeId, title, viaLabel }` | "Clear everything" only |

The story-path key and shape are **exactly** what Phase 9A wrote, so an
existing saved path is still recognised.

### 4.2 The exact stored formats

```json
// wdc.bookmarks
["test-blog-post", "taxonomy-of-shadows"]

// wdc.progress
{ "test-blog-post": { "r": 0.42, "p": 42, "u": 1792567851422 } }

// wdc.preferences
{ "textSize": "large", "readingWidth": "wide", "reducedIntensity": true }

// wdc.story.path.the-ashen-corridor-demo
[ { "nodeId": "54b9e939-…", "title": "The Threshold", "viaLabel": null },
  { "nodeId": "8f1c…", "title": "The Warm Corridor", "viaLabel": "Follow the warmth" } ]
```

* `r` is the scroll ratio, 0..1. `p` is the same figure as a percentage.
  `u` is the time it was saved.
* A bookmark stores **only a slug** — never the title, the excerpt or the
  body. The article is resolved through the public API every time.
* A story path stores only node ids and the labels the reader already saw.

A unit test asserts the exact stored bytes and that no secret is ever
written:

```js
it('should store only a slug for a bookmark', () => {
  ReaderData.addBookmark('test-blog-post');
  const raw = storage.getItem('wdc.bookmarks');
  expect(raw).to.equal('["test-blog-post"]');
  expect(raw).to.not.contain('content');
  expect(raw).to.not.contain('password');
  expect(raw).to.not.contain('token');
});

it('should never write an authentication secret', () => {
  /* ... */
  const everything = Array.from(storage.map.values()).join(' ');
  expect(everything).to.not.contain('auth_token');
  expect(everything).to.not.contain('csrf');
  expect(everything).to.not.contain('eyJ');
  expect(everything).to.not.contain('password');
});
```

The administrator's JWT is an `httpOnly` cookie set by the server. It is
never readable by a page and is never written to storage.

### 4.3 Validation

Every value read from storage is validated, and anything malformed or
outdated is **discarded** rather than used:

| What | Rule | On failure |
|---|---|---|
| A bookmark slug | `^[a-z0-9]+(-[a-z0-9]+)*$`, ≤ 80 chars | The entry is dropped |
| The bookmark list | Must be a JSON array | An empty list |
| A duplicate slug | — | The duplicate is dropped |
| A progress ratio | A finite number in 0..1 | The entry is dropped |
| A progress percent | A finite number in 0..100 | The entry is dropped |
| A progress timestamp | A finite number ≥ 0 | The entry is dropped |
| A text size | One of `small`, `medium`, `large`, `xlarge` | The default is used |
| A reading width | One of `narrow`, `normal`, `wide` | The default is used |
| Reduced intensity | A boolean | `false` is used |
| A story path entry | An object with a non-empty string `nodeId` | The entry is dropped |
| An unknown preference key | — | The write is refused with a message |

A stored path is additionally checked **against the story the server just
returned**: a path that references a node the story no longer contains is
discarded, because the story may have been rewritten.

### 4.4 Storage failures

Storage can be unavailable (private mode, a disabled cookie policy) or
full. **Nothing in this layer throws.** Every read and every write is
guarded:

```js
function getStore() {
  try { var store = root.localStorage; return store || null; }
  catch (e) { return null; }
}

function writeRaw(key, value) {
  var store = getStore();
  if (!store) return false;
  try { store.setItem(key, value); return true; }
  catch (e) {
    // A full quota or a blocked write must not break the page, and must
    // not remove anything that is already stored.
    return false;
  }
}
```

A failed write returns a message the interface shows; a failed read returns
an empty result. A failed write **never** removes anything that was already
stored.

Unit tests cover each failure mode with a storage that throws on
`setItem`, `getItem`, `removeItem` and `key`, and with `localStorage`
absent entirely.

### 4.5 A defect found and fixed during implementation

The first version of the UMD wrapper resolved its global object with
`typeof globalThis !== 'undefined' ? globalThis : this`. In a strict-mode
CommonJS module `this` is `undefined` at the top level, and the module
scope's `globalThis` did not resolve to the same object the test harness
swapped — so every unit test that wrote to storage failed.

The wrapper now takes the global object as a parameter and resolves it
without relying on `this`:

```js
})(typeof globalThis !== 'undefined' ? globalThis
  : typeof window !== 'undefined' ? window
  : typeof self !== 'undefined' ? self : {},
  function (root) { … });
```

This was found by the tests, not by inspection, and it is the reason the
storage layer is loaded by the unit suite as well as by the browser.

---

## 5. Safe Rendering — and a pre-existing XSS hole that was fixed

The brief requires that database content be rendered with safe DOM APIs and
never injected through `innerHTML`.

`post.html` was doing the opposite. The article title, the body and the
cover-image URL were interpolated straight into `innerHTML`, so a stored
title or body containing markup would have executed in the reader's
browser.

**The article rendering was rewritten.** Every value from the API is now
written with `textContent` or `setAttribute`:

```js
const text = el('div', 'font-body-lg … whitespace-pre-wrap reader-text');
text.textContent = post.content || '';
```

The cover image is also filtered, so a stored `javascript:` URL cannot
reach an `<img src>`:

```js
const safeImageUrl = (url) => {
  if (typeof url !== 'string' || !url.trim()) return null;
  const trimmed = url.trim();
  if (/^(https?:)?\/\//i.test(trimmed) || /^data:image\//i.test(trimmed)) {
    return trimmed.replace(/"/g, '%22');
  }
  return null;
};
```

Verified in a real browser: the article body has **0 child elements** (it
is text, not markup), the title has **0 child elements**, there is **no
`<script>`** anywhere in the article panel, and a payload in a title, an
introduction or a choice label produces **no alert**.

The blog page's card renderer still uses `escapeHtml`, which is the
existing project pattern and is equally safe. The new bookmark buttons are
created by the page's own renderer, so their slug comes from a data
attribute the page wrote itself.

---

## 6. The Features

### 6.1 Bookmarks

* A **Bookmark** button on every article card on the blog page and on the
  article page. The state is shown through `aria-pressed` and the label
  says what the button will do next ("Bookmark this entry" ↔ "Remove this
  entry from your bookmarks"), and the text changes to "Bookmarked".
* A **bookmarks view** at `/bookmarks/code.html`, listing the saved
  entries. Each card resolves the article through `GET /api/posts/:slug`,
  so the title, the date and the excerpt come from the live article.
* **Removal** from the article page and from the bookmarks view (the card's
  Remove button, behind a confirmation).
* An **empty state**: "No entries are bookmarked." with a line explaining
  how to add one.
* **Direct navigation**: each card links to `/post.html?slug=…`.
* **Unavailable entries**: an article that has been unpublished or deleted
  resolves to `404`, and its card is marked *"Unavailable — this entry is no
  longer published."* with **no link** and **no content**. A failed lookup
  shows *"Could not be loaded. The entry is still saved."* and **does not
  remove the bookmark**.
* **Duplicates are prevented** in two places: the storage layer refuses a
  duplicate, and the interface reflects the refusal.
* The interface states, on both the article page and the bookmarks page,
  that bookmarks are kept in this browser only and do not synchronize to
  other devices.

### 6.2 Reading progress

* The position is measured as a **scroll ratio**: how much of the
  article's own scrollable height is above the viewport.
* Storage writes are **debounced by 1200 ms**, so a long scroll does not
  produce hundreds of writes. The scroll listener is passive.
* The **indicator** is a 3px bar at the top of the page, plus a status line
  with the percentage and a **Reset position** button. The bar is a real
  `role="progressbar"` with `aria-valuenow` kept in step.
* **Restoration** puts the reader back where they were, but only after
  validation: the stored ratio must be a finite number in 0..1, the
  target must still be inside the article (the article may have been
  shortened), and the position is clamped to the maximum scroll.
* **No scroll-restoration loop**: the restore is flagged, and the flag is
  released after the browser has settled the scroll, so the scroll handler
  cannot immediately save the position it just restored.
* A **corrupt** position is discarded rather than used, and the reader
  starts from the top.
* A position below 2% is not restored, because it would look like a
  glitch.
* A position at or above 97% is treated as **read in full** and the reader
  is not sent back to the end of the article.
* A **short article** — one that fits entirely on the screen — is
  remembered as "Read in full" and **no position is stored at all**, because
  there is no position worth restoring. The Reset button is hidden, since
  there is nothing to reset.
* The **Reset position** button removes the saved position, behind a
  confirmation.
* A **"Where you left off"** list on the bookmarks page shows the articles
  with a saved position and the percentage reached.
* Saving a position **never overwrites** the bookmarks, and the two live
  under different keys.

### 6.3 Reading preferences

Three preferences, in a panel opened by a "Reading settings" button:

| Preference | Values | Effect |
|---|---|---|
| **Text size** | Small, Medium, Large, Extra large | `--reader-text-size`: 16px / 18px / 21px / 24px, with the matching line height |
| **Reading width** | Narrow, Normal, Wide | `--reader-max-width`: 34rem / 48rem / 60rem |
| **Visual intensity** | Reduce grain and shadow effects | Adds `reader-reduced-intensity` to `<body>`, which hides the grain overlay, removes the hard shadow and returns the crosshair cursor to the standard one |

* The defaults are Medium / Normal / on.
* The values are applied as **CSS custom properties**, so the browser only
  recomputes the affected rules and there is **no layout shift**.
* Every value is validated on read: an invalid stored value falls back to
  its default rather than being applied.
* Each control is a **real form control** inside a `<fieldset>` with a
  `<legend>`, so the group is announced correctly and the arrow keys move
  between the radio options. The radios are visually replaced by their
  labels but remain in the accessibility tree.
* The panel closes on **Escape**, and the focus returns to the button that
  opened it.
* The **reduced-motion** media query is respected: the panel and the
  buttons have no transition under `prefers-reduced-motion: reduce`.
* The reduced-intensity preference does not touch the text colour, so the
  contrast is unchanged.

### 6.4 Reader data management

A "Your saved reading data" panel on both the article page and the
bookmarks page, showing three counts — bookmarks, reading positions and
story paths — and four actions:

| Action | Confirmed | Effect |
|---|---|---|
| Clear bookmarks | Yes | Only the bookmark key |
| Clear reading positions | Yes | Only the progress key |
| Reset settings | Yes | Only the preferences key |
| Clear everything | Yes, with a stronger wording | All three, plus the story paths |

Each action says what it left alone, for example *"Bookmarks cleared.
Reading positions and story paths were left alone."*

The panel never deletes a server-side article or a comment, and it collects
no personal information: what it stores is a slug, a ratio and a few
preferences.

---

## 7. The Phase 9A Interactive-Story Path

The Phase 9A reader had its own private localStorage code. This phase
**replaced** that code with the shared `ReaderData` layer, so there is now
one owner for all the browser-local data:

```js
// Before (Phase 9A, private to the story reader)
const PATH_PREFIX = 'wdc.story.path.';
function loadPath(slug) { /* 30 lines of parsing and validation */ }

// After (Phase 9B, shared)
function loadPath(slug) { return ReaderData.getStoryPath(slug); }
function savePath()    { ReaderData.setStoryPath(State.slug, State.path); }
function clearPath()   { ReaderData.clearStoryPath(State.slug); }
```

The **key format and the stored shape are unchanged**, so a path saved by
Phase 9A is still found. A browser test writes a path under the exact
Phase 9A key and asserts the shared layer reads it.

**Verified in a real browser**: the story reader still starts on "The
Threshold", a choice still advances to "The Warm Corridor", the path still
records *"via 'Follow the warmth'"*, and after a reload the reader still
returns to "The Warm Corridor" with both steps listed.

---

## 8. Automated Tests

### 8.1 The three groups, run independently

| Group | Command | Result |
|---|---|---|
| Storage unit tests | `NODE_ENV=test npx mocha tests/unit/reader-data.test.js --exit` | **60 passing**, 0 failing, 0 pending |
| Browser tests | `NODE_ENV=test npx mocha tests/browser/reader-features.test.js --exit` | **43 passing**, 0 failing, 0 pending |
| The existing API tests | `NODE_ENV=test npx mocha tests/api/*.test.js --exit` | **178 passing**, 0 failing, 0 pending |

### 8.2 The complete suite, three times, three separate processes

| Run | Passing | Failing | Pending | Skipped | Duration |
|---|---|---|---|---|---|
| 1 | **283** | **0** | **0** | **0** | ~2m |
| 2 | **283** | **0** | **0** | **0** | ~2m |
| 3 | **283** | **0** | **0** | **0** | ~1m |

**283 = the 180 that existed after Phase 9A + 60 unit + 43 browser.** No
existing test was modified, no test was skipped, and no assertion was
weakened. The exact totals were confirmed with the JSON reporter:
`passes=283 failures=0 pending=0 skipped=0 tests=283`.

> An earlier set of runs showed 273, 239 and 276. The cause was identified:
> those runs were executed **concurrently with the author's own debugging
> scripts**, which competed for the same fixed ports. The harness now
> chooses a free port for each run, and seven consecutive runs afterwards
> were clean at 276.

### 8.3 What the unit tests cover (58)

Bookmarks: adding, the reported state, **duplicate prevention**, removing,
removing one that is not there, the order, a malformed slug, an empty slug,
an over-long slug, **malformed entries discarded on read**, **duplicates
discarded on read**, a non-JSON value, a value that is not an array,
nothing stored, and clearing.

Progress: saving and restoring, no position, a ratio outside 0..1, a
percent outside 0..100, a non-numeric ratio, removing, removing one that is
not there, a **corrupt stored position discarded**, a non-object stored
value, a non-JSON stored value, and clearing.

Preferences: the defaults, saving and restoring each of the three, an
unknown text size, an unknown reading width, an unknown key, a non-boolean
value, **an invalid stored value replaced by its default**, and resetting.

Separation: clearing each of the three leaves the other two alone; clearing
the story paths leaves the other three alone; **the four features use four
different storage keys**.

The Phase 9A story path: a path saved under the Phase 9A key is read, a
malformed entry is dropped, a non-JSON value yields an empty path, saving
and reading back, listing the stories that have a path, and the story paths
not being confused with the other kinds of data.

Storage failures: a failed write is reported rather than thrown, the
progress and the preferences report a failure, a failed read does not
throw, a failed removal does not throw, a failed key listing does not
throw, availability is reported correctly, and `localStorage` being absent
entirely is handled.

What is stored: only a slug for a bookmark, only figures for a position,
only the preference names, and **no authentication secret anywhere**.

### 8.4 What the browser tests cover (38)

These drive a **real Chrome** against a real backend and a real static
server, and assert on the live DOM and the live `localStorage`.

**Bookmarks (10):** adding from the article page, removing from the
article page, surviving a reload, appearing in the bookmarks view, the
empty state, removing from the bookmarks view, **duplicate prevention**,
**an article that is no longer published shown as unavailable with no
link**, recovery from malformed stored data, and malformed entries inside
a stored list.

**Reading progress (8):** saving a position as the page is scrolled, the
indicator appearing, resetting, restoring when the article is reopened, a
corrupt position discarded, recovery from a malformed store, **a short
article treated as read in full with nothing stored**, and progress saving
**not overwriting** the bookmarks.

**Reading preferences (7):** the text size changing and surviving a
reload, the reading width changing and surviving a reload, the
reduced-intensity preference applying, the preferences resetting, an
invalid stored preference replaced by its default, the panel exposing
**labelled, keyboard-reachable controls** (7 radios, 1 checkbox, 3
legends), and a visible focus ring on the controls.

**Separation (3):** clearing the bookmarks leaves the positions and the
story paths, clearing the positions leaves the bookmarks and the story
paths, and the panel reporting what is stored.

**Safe rendering (2):** the article body rendered as text with **0 child
elements**, and a script in the title producing **no alert**, **no
`<script>`** and no injected element.

**The Phase 9A story path (2):** a path under the Phase 9A key read by the
shared layer, and the story path kept separate from the other saved data.

**Responsive and keyboard (5):** the article page and the bookmarks page
fitting a 390 × 844 phone with **no horizontal overflow and no offending
element**, the bookmark button activated with a real `Enter` key, and a
visible focus ring on it.

### 8.5 The browser tests are isolated

The harness (`backend/tests/browser/harness.js`) starts **its own** backend
with `NODE_ENV=test`, so it targets the dedicated test database and never
the live one, and **its own** static server on a **free port** chosen for
each run.

The static server also proxies `/api` to that backend, so the pages and the
API share one origin. This matters: the backend's CORS setting comes from
`FRONTEND_ORIGIN` in `.env.test`, and a cross-origin page would be refused
by the browser. Serving both from one origin exercises the real code path
**without weakening the CORS setting**.

The browser suite creates a long published article as a fixture and removes
it again afterwards. Verified: after running the browser suite alone, the
test database holds **0 stories, 0 nodes, 0 fixture posts and 5 posts** —
its starting state.

Every browser test **fails on an uncaught page error**, even when its own
assertions passed, so a broken script cannot pass unnoticed. This was added
after a real defect slipped through (§10.2).

---

## 9. Browser Verification Actually Performed

Interaction used **real mouse clicks at computed viewport coordinates**
(`click_at_xy`) and **real key events** dispatched through CDP
`Input.dispatchKeyEvent`, not synthetic DOM events, except where noted.

### 9.1 Bookmarks

| Check | Result |
|---|---|
| Adding a bookmark (real click) | **Pass** — `aria-pressed` false → true, the label becomes "Remove this entry from your bookmarks", the text becomes "Bookmarked", the status reads "Saved to your bookmarks.", and the storage holds `["test-blog-post"]` |
| Removing a bookmark (real click) | **Pass** — back to `false`, the storage holds `[]`, the status reads "Removed from your bookmarks." |
| The bookmarks view | **Pass** — one card, the title "Test Blog Post", the link `/post.html?slug=test-blog-post`, a Remove button, and the counts "1 Bookmarks / 0 Reading positions / 0 Story paths" |
| Opening a bookmarked article (real click on the card link) | **Pass** — lands on `/post.html?slug=test-blog-post` with the article rendered, and the bookmark is still set |
| Removing a bookmark from the bookmarks view (real click) | **Pass** — the card is removed and the storage is emptied |
| The empty state | **Pass** — "No entries are bookmarked." with the explanatory line |
| An article that is no longer published | **Pass** — the card is marked unavailable, says "no longer published", and has **no link** |
| A malformed stored value | **Pass** — the page does not throw, the empty state is shown, and a new bookmark can still be added |

### 9.2 Reading progress

| Check | Result |
|---|---|
| Saving a position (scrolled to 60% of a 6316px article) | **Pass** — the bar reads 81%, the label "81% read", `aria-valuenow="81"`, the storage holds `{"r":0.807…,"p":81,"u":…}` |
| The indicator | **Pass** — the status line is visible and the Reset button appears |
| Restoring across a reload | **Pass** — the reader returns to the saved position (scrollY 3673), the label reads "62% read" |
| Resetting (real click) | **Pass** — the confirmation reads "Forget how far you had read this entry?", the storage becomes `{}`, the label "0% read" |
| A short article | **Pass** — nothing is stored, the label reads "Read in full", and the Reset button is hidden |

### 9.3 Reading preferences

| Check | Result |
|---|---|
| Opening the panel (real click) | **Pass** — `aria-expanded` false → true, the three legends are "Text size", "Reading width", "Visual intensity" |
| Changing the text size | **Pass** — `--reader-text-size` becomes `21px`, `data-reader-text-size="large"` |
| Changing the reading width | **Pass** — `--reader-max-width` becomes `60rem` |
| The reduced-intensity preference | **Pass** — the body gains `reader-reduced-intensity` and the grain overlay's computed `display` becomes `none` |
| Persistence across a reload | **Pass** — the custom properties are still applied |
| Resetting | **Pass** — the stored preferences return to the defaults |
| Escape closes the panel | **Pass** — the panel is hidden and **the focus returns to the toggle button** |

### 9.4 Data separation

| Check | Result |
|---|---|
| Clearing the bookmarks (real click) | **Pass** — the confirmation reads "Remove every bookmark from this browser?"; the bookmarks are gone and **the reading positions, the preferences and the story path are all intact** |
| The status message | **Pass** — "Bookmarks cleared. Reading positions and story paths were left alone." |

### 9.5 Keyboard and focus

| Check | Result |
|---|---|
| The bookmark button's focus ring | **Pass** — `outline: rgb(163, 22, 22) solid 2px`, `matches(':focus-visible') === true` |
| The settings controls' focus ring | **Pass** — the label computes `rgb(163, 22, 22) solid 2px` |
| Escape | **Pass** — the panel closes and the focus returns to the toggle |

### 9.6 Responsive layout

| Check | Result |
|---|---|
| The article page at 390 × 844 | **Pass** — `scrollWidth 390 = clientWidth 390`, **no offending element**, the bookmark button is 152px and inside the viewport |
| The bookmarks page at 390 × 844 | **Pass** — `scrollWidth 390 = clientWidth 390`, **no offending element** |

### 9.7 The existing pages

Every page was loaded in a real browser and checked for uncaught errors:

| Page | Heading | Page errors |
|---|---|---|
| Article page | "Test Blog Post" | **0** |
| Bookmarks page | "Saved Entries" | **0** |
| Grim Chronicles | "CHRONICLES" | **0** |
| The Vault | "CHRONICLES" | **0** |
| The Void | "THE VOID" | **0** |
| Inquiries | "THE VOID" | **0** |
| Story listing | "Paths in the Dark" | **0** |
| Story reader | "The Ashen Corridor" | **0** |
| Grimoire admin | "The Grimoire" | **0** |

### 9.8 What was *not* browser-tested, and why

* **No screenshot was captured.** `Page.captureScreenshot` timed out
  repeatedly against the browser daemon in this environment, exactly as it
  did in Phases 8.2 and 9A. Every check was made against the live DOM and
  the live storage, which is stronger evidence than an image.
* **The browser authentication used an injected server-issued session
  cookie** for the existing `admin` account, as in Phase 9A. The password
  was never typed into or read by the browser tool. The Grimoire was only
  loaded, not driven, because this phase changed nothing in it.

---

## 10. Defects Found and Fixed During This Phase

### 10.1 The admin modal overflowed the viewport

Carried over from Phase 9A and re-confirmed: the story editor's modal had
no height constraint. Fixed in Phase 9A by moving `max-height: 92vh;
overflow-y: auto` into the base rule. This phase added no modal.

### 10.2 A `var` shadowing bug that silently broke the data panel

**Found by browser verification.** The "Clear bookmarks" button removed the
bookmarks but showed no confirmation message, and no page error was
visible in the test output.

**Cause:** `reader-ui.js` declared the status helper as a function and,
later in the same function scope, declared a DOM node with the same name:

```js
var statusNode = function () { return status || el('reader-data-status'); };
…
var statusNode = create('p', 'reader-data-status');   // shadows the function
```

`var` is function-scoped and hoisted, so the later declaration replaced the
helper. `announce(statusNode(), …)` therefore called a DOM element as if it
were a function, which threw `statusNode is not a function`. The exception
aborted the click handler after the clearing but before the message, and
because the handler was an event listener, the error was swallowed.

**Fix:** the DOM node was renamed to `statusLine`.

**Why it was hard to see:** the error was only visible in the browser's
console. Two hardening measures were added as a result:

* The browser tests now **fail on any uncaught page error**, even when
  their own assertions passed. The error is collected and reported after
  the test, so the failing assertion is not hidden.
* A browser test now asserts the data panel's status message directly, so
  this specific behaviour is covered.

### 10.3 The bookmarks page overflowed a phone viewport

**Found by the browser test.** The page was 416px wide at a 390px
viewport:

```
DIV cls=relative right=416 w=57
BUTTON cls=reader-button right=416 w=57
```

**Cause:** the header is a `flex justify-between` row, and the
settings-toggle button had no `flex-shrink`, so it kept its full width and
pushed the row past the viewport.

**Fix:** `shrink-0` on the button's wrapper, `min-w-0 truncate` on the
title, and `gap-3` on the row.

### 10.4 The focus ring did not appear on the settings controls

**Found by the browser test.** The radio buttons are visually replaced by
their labels, and the ring was drawn with `:has(input:focus-visible)`.
When focus was moved programmatically, Chrome declined to apply
`:focus-visible`, so no ring appeared.

**Fix:** the rule now matches both `:has(input:focus-visible)` and
`:has(input:focus)`, so the ring appears however the control was focused.

### 10.5 The storage layer's global object did not resolve in Node

Described in §4.5. Found by the unit tests; fixed in the UMD wrapper.

---

## 11. Database Preservation

### 11.1 The live database is unchanged

| Metric | Before Phase 9B | After Phase 9B | Verdict |
|---|---|---|---|
| posts | 5 | **5** | unchanged |
| artifacts | 182 | **182** | unchanged |
| categories | 11 | **11** | unchanged |
| users | 3 | **3** | unchanged |
| inquiries | 0 | **0** | unchanged |
| comments | 0 | **0** | unchanged |
| tables | 12 | **12** | unchanged |
| stories | 0 | **0** | unchanged |

### 11.2 Publication statuses are unchanged

| Record | Before | After |
|---|---|---|
| `taxonomy-of-shadows` | Published | **Published** |
| `elegies-in-dust` | Published | **Published** |
| `test-post` | Published | **Published** |
| `test-blog-post` | Published | **Published** |
| `secret-post` | Draft | **Draft** |

Aggregate: posts = 4 published / 1 draft; artifacts = 58 published / 124
draft. Identical before and after.

### 11.3 Administrator accounts are unchanged

`admin`, `admin_test`, `testadmin` — all present, **no account was created,
modified or deleted**.

### 11.4 The test database is clean

The browser suite's fixture is removed by the suite itself, and the
Phase 9A leftovers left by an interrupted run were removed with
`backend/scripts/cleanup-test-stories.js`, which only touches stories whose
slug carries this project's test prefix and **refuses to run against the
production database**.

---

## 12. Test Isolation

The Phase 8.1/8.2 safeguards were **not modified** and were re-verified
after the implementation.

| Check | Result |
|---|---|
| `NODE_ENV=test` resolves the datasource to | `db_test` — role `user`, `host=::1/128`, 12 tables. **Not the live database.** |
| The live database name | `wednesdays_dark_chronicles` — a physically separate database. |
| `mocha` run without `NODE_ENV=test` | **Aborts:** *"FATAL: the test suite must be run with NODE_ENV=test… Refusing to run the suite against the live database."* |
| `.env.test` missing | **Aborts:** *"FATAL: NODE_ENV=test but the dedicated test configuration is missing… Refusing to run against the live database."* |
| The browser tests' backend | Started with `NODE_ENV=test` by the harness, so it loads `.env.test` and targets the test database. |
| The browser tests' own fixtures | A long published article, created and removed by the suite. The test database is left exactly as it was found. |
| Prisma version | **5.22.0** throughout. No Prisma 6/7 configuration API was introduced; `prisma.config.ts` was not touched. |
| The development database target | **Unchanged.** Neither PostgreSQL instance was switched, migrated, copied, deleted or reset. |
| Secrets | `.env` and `.env.test` were not modified. No credential was read, printed or exposed. |

---

## 13. Remaining Limitations

| # | Limitation | Detail |
|---|---|---|
| L1 | **The reading preferences apply to the reading pages only.** | The text size and the reading width are applied through CSS custom properties on the pages that load `reader.css` — the article page, the bookmarks page and the blog page. The Vault, The Void, the inquiries page and the story reader were not redesigned to use them. The story reader keeps its own established typography. |
| L2 | ~~The reading width has no visible effect on the article page.~~ **RESOLVED in Phase 9B.1.** | The reading column was driven by the preference from the start of Phase 9B.1. Narrow = 544px, Default = 768px, Wide = 960px, measured in a real browser. See §16. |
| L3 | **The reading progress is only meaningful for a long article.** | Every published article in the live database is 12–44 characters long and fits on one screen, so the short-article path is what a reader currently sees. The scrolling behaviour was verified against a long fixture article. |
| L4 | **Bookmarks and progress are per browser and per profile.** | They are stored in `localStorage`, so they do not follow the reader to another browser, another profile or another device, and they are lost if the browser's data is cleared. Both pages say so. |
| L5 | **The saved path is restored only if every node in it still belongs to the story.** | If a story is rewritten so that a visited node is removed, the saved path is discarded and the reader starts again. The alternative — restoring a path into a story that no longer contains it — would show the reader a broken path. |
| L6 | **There is no bookmark count in the browser's own UI on the blog page.** | The cards show the state of each button, but the blog page does not display a total. The bookmarks page does. |
| L7 | **The browser tests need a Chrome binary.** | The suite uses the Chrome in the puppeteer cache, with a fallback to a system Chrome or Edge. If no browser is found, the suite **fails loudly** rather than skipping — a missing browser must never be mistaken for a passing suite. |
| L8 | **No screenshot artefacts.** | See §9.8. |
| L9 | **No Git repository.** | The project tree has no `.git` directory, so there is no commit history and no diff for this phase. Preservation relied on the before/after database comparison and on the file inventory in §3. |
| L10 | **62 leftover Phase 9A test stories were found in the test database.** | They were created by Phase 9A runs that were interrupted before the suite's own cleanup ran. They were removed with the guarded cleanup script. The Phase 9A suite's own cleanup is correct; the leftovers came from interrupted runs during development. |

---

## 14. Project Boundaries

| Constraint | Status |
|---|---|
| Phase 9B implemented, **Phase 10 not started** | **Honoured** |
| The public website not redesigned | **Honoured** — the article page's rendering was rewritten for safety, but its layout, typography and colour are unchanged; the blog page gained a button per card; three pages gained one sidebar link each. |
| Branching-story navigation and path persistence not broken | **Honoured** — verified in the browser and by two browser tests (§7). |
| The Grimoire admin dashboard preserved | **Honoured** — **not modified at all** in this phase. |
| The Séance and moderation preserved | **Honoured** — the comment API and its 63 tests are untouched and pass. |
| Blog, Vault, Categories and Messages preserved | **Honoured** — all re-verified in the browser with zero page errors (§9.7). |
| Existing posts, artifacts, categories, inquiries, comments and administrator accounts unchanged | **Honoured** — verified by before/after comparison (§11). |
| Existing publication statuses unchanged | **Honoured** — verified (§11.2). |
| Production secrets unmodified | **Honoured** — `.env` and `.env.test` untouched; no secret was read or printed. |
| No database resets, no volume removal | **Honoured** — no `migrate reset`; no migration was even needed. |
| The application not deployed | **Honoured** |
| Authentication, CSRF and test-isolation safeguards not weakened | **Honoured** — all three re-verified (§12). The CORS setting was **not** loosened: the browser tests serve the pages and the API from one origin instead. |
| Database targets not switched | **Honoured** |
| No reader accounts or new authentication | **Honoured** — no account, no login, no token. |
| No sensitive data in `localStorage` or `sessionStorage` | **Honoured** — asserted by unit test and by inspection. |
| No unnecessary tracking | **Honoured** — nothing is sent anywhere; the only network requests are the existing public API calls. |

---

## 15. Conclusion

Phase 9B is complete and verified.

* **Bookmarks.** A toggle on the article page and on every blog card, a
  dedicated view, removal from both, an informative empty state, direct
  navigation, duplicate prevention, and graceful handling of an article
  that has been unpublished — shown as unavailable, with no link and no
  content, and **never removed from the list**.
* **Reading progress.** A debounced scroll ratio, a visible indicator, a
  reset control, a "where you left off" list, validated restoration, no
  scroll-restoration loop, and a sensible treatment of a short article.
* **Reading preferences.** Text size, reading width and reduced visual
  intensity, applied as CSS custom properties so there is no layout shift,
  with labelled and keyboard-reachable controls, validated stored values,
  and the system's reduced-motion preference respected.
* **Storage.** One owner for all the browser-local data, four separate keys
  so clearing one never erases another, every value validated on read, and
  no failure mode that throws.
* **Safe rendering.** The pre-existing `innerHTML` injection in
  `post.html` was replaced with DOM construction, so the article title and
  body are now inert text.
* **Tests.** 283 passing, 0 failing, 0 pending, 0 skipped in each of three
  separate-process full-suite runs — 180 pre-existing plus 60 unit plus 43
  browser. The storage layer is covered by unit tests against a storage
  that can be made to fail, and the browser behaviour is covered by 43
  tests driving a real Chrome.
* **Reading width.** **Phase 9B.1** made the reading-width preference
  visibly affect the article's reading column — 544px narrow, 768px
  default, 960px wide — with the default appearance unchanged.
* **Database.** **No change at all.** No schema change, no migration, no
  new endpoint. The live database is byte-for-byte identical.
* **Preservation.** Every existing page, the Grimoire, the Séance, the
  branching stories and the Phase 9A story-path persistence all work, and
  the fail-closed test-database safeguards are intact.

Five real defects were found and fixed during this phase, the most
significant being a `var` shadowing bug that silently broke the data
panel's confirmation message — invisible to the assertions and only
caught by looking at the browser console, which is why the browser tests
now fail on any uncaught page error.

**Phase 9B.1** then closed the one remaining gap: the reading-width
preference now visibly affects the article's reading column — **544px
narrow, 768px default, 960px wide**, measured in a real browser, with the
default appearance byte-for-byte unchanged, persistence across reloads
confirmed, and no horizontal overflow at 390px in any setting. The suite
is now **283 passing** in each of three separate-process runs.

---

## 16. Phase 9B.1 — Finishing the Reading-Width Preference

Phase 9B was reported as complete with one feature gap recorded as
limitation L2: *the reading-width preference had no visible effect on the
article page*. This section records the correction.

### 16.1 The cause, measured

The reading width was already stored, validated and applied as a CSS custom
property — the property was simply being ignored. The measurement, taken in
a real browser before anything was changed, showed the container clamping
every setting to the same width:

```
set=narrow  cssVar=34rem  containerWidth=768  textWidth=768
set=normal  cssVar=48rem  containerWidth=768  textWidth=768
set=wide    cssVar=60rem  containerWidth=768  textWidth=768
```

**Cause:** the article's reading column carried the Tailwind utility
`max-w-3xl`, which is `48rem` — exactly the default setting. The container
therefore clamped the column to 768px no matter what the preference said.
A `.reader-measure` rule existed in `reader.css` that would have done the
job, but it was **never applied to any element**.

### 16.2 The fix

**`reader.css`** — a new `.reader-column` rule, written with a
specificity of 0,2,0 so it wins over the single-class Tailwind utility it
replaces, without needing `!important`:

```css
body .reader-column {
    max-width: var(--reader-max-width);
}

@media (min-width: 768px) {
    body .reader-column {
        margin-left: auto;
        margin-right: auto;
    }
}
```

The `--reader-max-width` values were **not changed** — `narrow: 34rem`,
`normal: 48rem`, `wide: 60rem` — so the default is still exactly the width
the page had before the preference existed.

**`post.html`** — the hard `max-w-3xl` was replaced with `reader-column` on
the five blocks that form the article's reading area: the article column
itself, the reader controls, the bookmark note, the progress status and the
saved-data panel. They all share one measure, so they stay aligned.

**`grim_chronicles/code.html`** — the reading settings button and panel were
added next to the search field, so the preference is reachable from the
blog as well, and the card excerpts follow the text size.

**`bookmarks/code.html`** — the main column and the card excerpts follow the
same preferences.

**`reader-ui.js`** — the shared card excerpt carries the reading text size.

### 16.3 The default appearance is preserved

Measured with **no preferences stored at all**:

```
storedPreferences: null
setting:           normal
cssVar:            48rem
columnWidth:       768      <- identical to the pre-change value
columnLeft:        256
columnRight:       1024
textWidth:         768
fontSize:          18px
lineHeight:        28px
```

The column is still 768px wide, still centred in the 1280px viewport at the
same 256px offset, with the same 18px type and 28px line height. Opening
the settings panel writes **nothing** to storage, so merely viewing the
page leaves no trace.

### 16.4 The three settings, measured in a real browser

At 1280 × 900, with the setting changed **through the real settings
panel**:

| Setting | Custom property | Column | Text | Font | Line height | Overflow | Offending elements |
|---|---|---|---|---|---|---|---|
| Narrow | 34rem | **544px** | 544px | 18px | 28px | none | 0 |
| **Normal (default)** | 48rem | **768px** | 768px | 18px | 28px | none | 0 |
| Wide | 60rem | **960px** | 960px | 18px | 28px | none | 0 |

The three are genuinely different measures, and the default is unchanged.

**Persistence across a reload:** after choosing "Wide" and reloading, the
column was still 960px, `data-reader-width` was still `wide`, and the
stored value was
`{"textSize":"medium","readingWidth":"wide","reducedIntensity":false}`.

**At 390 × 844**, all three settings give a 350px column — the available
space, because the viewport is narrower than every setting — with
`scrollWidth == clientWidth == 390` and **zero** offending elements. The
preference never forces a horizontal scrollbar.

### 16.5 Everything else is untouched

| Constraint | Status |
|---|---|
| Database models, migrations, APIs, authentication | **Unchanged** — 6 migrations, no new endpoint, the live database is byte-for-byte identical (5 posts, 182 artifacts, 11 categories, 3 users, 0 inquiries, 0 comments). |
| Existing content | **Unchanged** |
| Unrelated pages | **Unchanged** — the Grimoire's three files were not touched (their timestamps are still from Phase 9A). The Vault, The Void, the inquiries page and the story reader were not modified. |
| Storage keys | **Unchanged** — still exactly `wdc.bookmarks`, `wdc.progress`, `wdc.preferences` and `wdc.story.path.*`. |
| The default appearance | **Preserved** — 768px, 18px, 28px, identical to before. |
| The Phase 9A story path | **Still works** — the shared layer is unchanged, and the two browser tests that cover it still pass. |
| Test-database safeguards | **Intact** — all three re-verified (§12). |

### 16.6 Tests

**New browser tests (5):**

* the reading column changes width across the three settings, and the three
  are strictly increasing;
* the default article width is 768px with **no preference stored**, and
  merely loading the page writes nothing;
* the width survives a reload;
* no horizontal overflow at any of the three widths on a 390px phone, with
  the column never exceeding the available space;
* the blog page exposes the reading settings and stores the width.

**New unit tests (2):**

* the three widths are distinct, and the default is 48rem — the width the
  page had before the preference existed;
* `applyPreferences` sets `--reader-max-width` and `data-reader-width` from
  the stored preference.

**Results:**

| Group | Command | Result |
|---|---|---|
| Storage unit tests | `NODE_ENV=test npx mocha tests/unit/reader-data.test.js --exit` | **60 passing**, 0 failing, 0 pending |
| Browser tests | `NODE_ENV=test npx mocha tests/browser/reader-features.test.js --exit` | **43 passing**, 0 failing, 0 pending |
| The existing API tests | `NODE_ENV=test npx mocha tests/api/*.test.js --exit` | **178 passing**, 0 failing, 0 pending |
| **Complete suite, three separate processes** | `npm test` | **283 passing, 0 failing, 0 pending, 0 skipped** in each run |

**283 = 180 (after Phase 9A) + 60 unit + 43 browser.** Exact totals
confirmed with the JSON reporter: `passes=283 failures=0 pending=0
skipped=0 tests=283`.

One test failed during the work and was fixed: the new width test opened
the settings panel three times, but the toggle closes the panel when it is
already open. The test now opens it once and changes the radio three
times. No assertion was weakened.

### 16.7 Browser verification versus automated testing

**Performed by real browser interaction** (a real Chrome, real clicks at
computed viewport coordinates, real scrolling, real reloads):

* the three settings chosen through the actual settings panel, and the
  column width measured after each;
* the default appearance with no stored preference;
* persistence across a real page reload;
* the layout at 1280 × 900 and at 390 × 844, with the offending-element
  count checked in each case;
* the blog page's reading-settings button opening its panel.

**Performed by automated tests** (the same behaviours, driven by
Puppeteer against an isolated backend and static server, with assertions):

* the three widths and their ordering, the default, the persistence, the
  absence of overflow at 390px, and the blog page's panel — 5 browser
  tests;
* the width values and their application — 2 unit tests.

**Verified by source inspection only:** that no other page in the project
had a `max-w-3xl` reading column that the preference ought to affect. The
Vault, The Void, the inquiries page and the story reader were checked and
left alone; they are not reading pages and the brief says not to redesign
unrelated pages.

### 16.8 The remaining limitation

The reading width affects the **article page**, the **blog page's card
excerpts** and the **bookmarks page**. It does not affect the comment
thread ("The Séance") on the article page, which keeps its own
`max-w-3xl`-equivalent measure, because widening the comment column is a
different change from the reading column and was not part of the
requirement. It also does not affect the branching-story reader, whose
typography was established in Phase 9A and is not a long-form reading
surface.

**STOP after Phase 9B.1. Awaiting explicit approval before beginning Phase 10.**
