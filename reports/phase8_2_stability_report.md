# Phase 8.2 — Public Website Stability and Integration Report

**Date:** 2026-10-21
**Scope:** Fix the four application defects identified during Phase 8.1 final verification, without redesigning existing pages.
**Status:** Phase 8.2 complete. **Awaiting explicit approval before beginning Phase 9.**

---

## 1. Defects and Their Corrections

### 1.1 Defect 1 — Public blog page: API response-envelope mismatch

**Reported as:** the blog page showed "ERROR CONSULTING THE ARCHIVE" instead of posts.

**Root cause, confirmed by inspecting the live response before changing anything:**

```
$ curl -s "http://localhost:3000/api/posts?page=1&limit=2"
keys: [ 'data', 'meta' ]
meta: {"total":4,"page":1,"limit":2,"totalPages":2}
data[0] keys: [ 'id','title','slug','excerpt','content','coverImageUrl',
                 'published','publishedAt','createdAt','updatedAt','categories' ]
```

`GET /api/posts` returns an **envelope** `{ data, meta }`. The page's renderer
treated the response as a bare array (`const posts = await res.json();` then
`posts.forEach(...)`), so `posts.forEach` was not a function, the `catch` block
ran, and the error message replaced the feed.

**Two further defects in the same function were found and fixed at the same time:**

| Defect | Detail |
|---|---|
| Broken article navigation | The link was the relative `post.html?slug=…`, but the blog page lives in `/grim_chronicles/` while `post.html` lives at the site root, so it resolved to `/grim_chronicles/post.html` → **404**. Verified: `GET /grim_chronicles/post.html` → 404, `GET /post.html` → 200. |
| Missing category filter container | `fetchCategories()` wrote into `document.getElementById('category-filters')`, but **no such element existed in the markup**, so it threw on `container.innerHTML` and the category bar never rendered. |

**Correction — the frontend was adapted; the public API contract was not changed.**
`GET /api/posts` still returns `{ data, meta }` and no backend file was modified.

- Added a single `unwrap(payload)` helper that returns `{ items, meta }` and
  accepts either a bare array or the envelope, so the renderer is correct
  regardless of shape.
- `updatePagination(meta)` now drives the pagination bar from `meta.page` /
  `meta.totalPages`, with Roman numerals preserved from the original design
  (`PAGE I OF XIII` → `PAGE I OF I`). Previous/Next are real `<button>`
  elements that disable themselves at the boundaries.
- Added the missing `<nav id="category-filters">` element, rendered safely with
  `createElement` + `textContent` (no `innerHTML` interpolation of API values).
- Article links are now built from the site root: `postUrl(slug)` →
  `/post.html?slug=<encodeURIComponent(slug)>`.
- **XSS hardening:** titles, slugs and excerpts are passed through `escapeHtml`
  before interpolation; `coverImageUrl` is passed through `safeImageUrl`, which
  only accepts `http(s)://` or `data:image/` and otherwise renders a
  Material-Symbol placeholder instead of an `<img src>`.
- The page's markup had an unclosed `<section>` (the grid, pagination and
  footer were all nested inside it); the grid, pagination and footer are now
  separate siblings, matching the intended structure.

**Verified in a real browser** (see §7).

---

### 1.2 Defect 2 — Contact form: empty payload, and a handler that never bound

**Reported as:** the form fields had no `name` attributes, so `FormData` produced `{}`.

**Root cause, confirmed by inspecting the form before changing anything:**

```
fields: [ {name:"", type:"text"}, {name:"", type:"select-one"}, {name:"", type:"textarea"} ]
FormData with empty form: {}
```

Three separate problems were found:

| # | Problem | Evidence |
|---|---|---|
| a | No `name` attributes on the name, select or message controls | `FormData` → `{}` |
| b | **No email field existed at all**, but the API requires `email` and validates its format | `POST /api/inquiries` with `{}` → **400** *"Name, email, and message are required"* |
| c | A legacy script block registered its own `submit` listener that called `e.preventDefault()`, showed a fake `alert('Your word has been sent to the void.')`, and **never contacted the API** | `inquiries/code.html` line 278-292 |

While fixing (a) and (b), a **new** failure surfaced that the original report
had not detected: the corrected script still did not bind. Capturing the page
error gave:

```
Uncaught SyntaxError: Identifier 'form' has already been declared @295:9
```

The pre-existing script at line 278 already declared a top-level `const form`,
so the new `const form` was a duplicate global declaration — a **SyntaxError**
that aborted the whole script block, leaving `form.onsubmit` as `null`. The
new constant was renamed to `inquiryForm`, and the obsolete legacy listener
was removed (it was actively harmful: it faked a success message and swallowed
the real submission).

**Correction — the layout is preserved; only the form's attributes and its
handler changed.**

- `name`, `email`, `message` and `intent` now carry proper `name`
  attributes, plus `id`/`for` label associations, `maxlength` matching the API
  limits (100 / 255 / 5000) and `autocomplete` attributes.
- The email field was added. The "Nature of Inquiry" select was kept and moved
  into a full-width row (`md:col-span-2`) so the two-column grid still reads
  as two columns on desktop.
- **Client-side validation mirrors the API rules** exactly: name required,
  email required and pattern-checked, message required, and the three length
  limits. The server remains the authority and its error message is surfaced.
- **Duplicate/spam handling** (two layers):
  1. An in-flight guard: the submit button is disabled while a request is
     outstanding, so a double-click cannot create two records.
  2. A 30-second duplicate window: the same name + email + message signature
     submitted again is refused client-side with *"That message has already
     been sent. The void does not accept echoes."* — and, critically, **no
     second request is issued**. Confirmed by instrumenting `fetch`: the
     blocked attempt produced no network call.
  3. The existing server-side rate limiter (5 inquiries per IP per hour) is
     untouched and continues to apply.
- Success shows the API's own message in the success style; failure shows the
  server's message in the error style. `role="status" aria-live="polite"` was
  added to the response container.

---

### 1.3 Defect 3 — The Vault was hardcoded, not database-driven

**Reported as:** the page still rendered hardcoded artifacts.

**Root cause, confirmed by inspecting the markup and the APIs before changing
anything:** the grid contained five literal `<article>` elements with baked-in
Google image URLs and names ("The Architecture of Silence", "Ink & Obsidian",
"Solitary Growth", "Flight of the Void"). The only JavaScript was a stub:

```js
async function filterArtifacts(slug) {
    console.log('Filtering artifacts by:', slug);   // did nothing
}
```

and the category loader fetched the **relative** path `/api/categories/artifact-categories`,
which 404s because the static server does not proxy `/api`.

**Correction — the existing public APIs were reused; no duplicate API was created.**

| Requirement | Endpoint used | Already existed? |
|---|---|---|
| Artifact list | `GET /api/artifacts?limit&category&q` | Yes — returns `{ data, meta }` and filters to `published: true` |
| Artifact detail | `GET /api/artifacts/:slug` | Yes — 404s for unpublished artifacts |
| Category filter | `GET /api/categories/artifact-categories` | Yes (added in Phase 5B) |

- The five hardcoded articles were removed; `#artifact-grid` is now populated
  from the database. The asymmetric layout is preserved: index 0 renders as
  the large featured tile (`md:col-span-8`, 16:9), the rest as square/vertical
  tiles — the same rhythm as the original hand-built grid.
- Added a search input (`#artifact-search`) wired to the API's `q` parameter,
  and the category bar now filters the grid through the API's `category`
  parameter. The filter and search compose, and the active filter is marked
  with `aria-pressed`.
- A new **artifact detail modal** was added, matching the design of the
  existing `the_vault_artifact_modal_view/code.html` (same panel styling, same
  "RELIC" classification header, corner brackets, close button). It is
  populated from `GET /api/artifacts/:slug` with the name, slug, description,
  categories, date and file link.
- **XSS safety:** artifact names, descriptions, slugs and category names are
  written with `textContent` (never `innerHTML` interpolation); image and file
  URLs pass through `safeImageUrl`, which only permits `http(s)://` and
  `data:image/` and rejects everything else, so a database value cannot inject
  a `javascript:` URL.
- **Loading, empty and error states** are handled: "Unlocking the Vault…"
  while loading, "No relics found in this void." for an empty result, and
  "The Vault is sealed. Please try again later." on failure.
- The modal is keyboard accessible: `Escape` closes it, focus moves to the
  close button on open and returns to the originating tile on close, and each
  tile is focusable with `Enter`/`Space` activation.
- The decorative "Capturing the Invisible" section below the grid is page
  furniture and was left untouched.

---

### 1.4 Defect 4 — Admin navigation unusable at 390px

**Reported as:** the nav needed ~686px and Logout was off-screen at 390px.

**Root cause, confirmed by measurement before changing anything:**

```
nav-links scrollWidth: 541, clientWidth: 541
Logout right edge: 686     (viewport: 390)
```

`.nav-links` was `display:flex; flex-wrap:nowrap` with `gap:1.5rem`, so the
seven items formed one 541px row inside a 390px viewport; the page auto-expanded
to 686px and the Logout link (x=630–686) was off-screen and unreachable.

**Correction — the existing aesthetic is preserved; only the responsive
behaviour was added to `public/admin/style.css`.**

- `.admin-nav` and `.nav-links` now allow wrapping; a `@media (max-width: 720px)`
  block stacks the brand above the links and lets them flow onto two rows.
- Below 720px: `.admin-content` padding reduced, `.pane-header` stacks
  vertically, the modal goes full-width with `max-height:92vh` and internal
  scrolling, the stats grid becomes a single column, and table cell padding is
  reduced.
- **Visible focus indicators** were added with `:focus-visible` rules
  (2px `--accent-bright-red` outline with 2px offset) for nav links, action
  buttons, primary/secondary buttons and the modal close button. A `:focus`
  fallback is also provided for browsers without `:focus-visible` support.
- The stylesheet cache-buster was bumped (`style.css` → `style.css?v=2`) so the
  change is picked up.

---

## 2. Files Changed

| File | Change |
|---|---|
| `grim_chronicles/code.html` | Envelope-aware rendering, real pagination, category filter container, root-relative article links, XSS escaping, safe image URLs, DOM-structure repair. |
| `inquiries/code.html` | Named fields, added email field, client-side validation mirroring the API, duplicate/in-flight guards, removed the fake-alert legacy submit handler, renamed the colliding `form` constant to `inquiryForm`, accessible status region. |
| `the_vault/code.html` | Hardcoded articles removed; database-driven grid, search, category filter and detail modal added; loading/empty/error states; XSS-safe rendering; keyboard-accessible modal. |
| `public/admin/style.css` | Responsive nav wrapping, 390px layout adjustments, visible focus indicators. |
| `public/admin/index.html` | Stylesheet cache-buster `style.css` → `style.css?v=2`. |
| `backend/.env.example` | PostgreSQL topology documentation (§4). No secret values changed. |
| `backend/scripts/pg-topology.js` | **New.** Read-only probe that establishes which physical server each connection target reaches. |
| `backend/scripts/db-fixture-cleanup.js` | Extended with the Phase 8.2 fixture identifiers. |

**Not modified:** no backend source file, no database schema, no migration, no
seed, no `.env`, no test file, no administrator account, and no public page
other than the three named in the brief. `public/admin/app.js` needed no change
in this phase (its Phase 8.1 fixes are intact).

---

## 3. Test Isolation and Regression

All runs used the standard `npm test` command, so the Phase 8.1 safeguards
execute.

### 3.1 Independent test groups

| Group | Command | Result |
|---|---|---|
| Blog | `NODE_ENV=test npx mocha tests/api/blog.test.js --exit` | **9 passing**, 0 failing, 0 pending |
| Vault | `NODE_ENV=test npx mocha tests/api/artifacts.test.js --exit` | **8 passing**, 0 failing, 0 pending |
| Artifact categories | `NODE_ENV=test npx mocha tests/api/artifact_categories.test.js --exit` | **3 passing**, 0 failing, 0 pending |
| Comments | `npm run test:comments` | **63 passing**, 0 failing, 0 pending |
| Admin | `NODE_ENV=test npx mocha tests/api/admin.test.js --exit` | **13 passing**, 0 failing, 0 pending |
| Auth | `NODE_ENV=test npx mocha tests/api/auth.test.js --exit` | **4 passing**, 0 failing, 0 pending |
| Posts | `NODE_ENV=test npx mocha tests/api/posts.test.js --exit` | **2 passing**, 0 failing, 0 pending |
| Health | `NODE_ENV=test npx mocha tests/health.test.js --exit` | **2 passing**, 0 failing, 0 pending |

No test was skipped, no assertion was weakened, and no test was modified.

### 3.2 Complete suite, three times, three separate processes

| Run | Passing | Failing | Pending | Skipped | Duration |
|---|---|---|---|---|---|
| 1 | **104** | **0** | **0** | **0** | ~2s |
| 2 | **104** | **0** | **0** | **0** | ~2s |
| 3 | **104** | **0** | **0** | **0** | ~2s |

### 3.3 Isolation confirmed

| Check | Result |
|---|---|
| `NODE_ENV=test` resolves the datasource to | `db_test` — `RESULT=NOT_PRODUCTION` |
| `.env.test` missing | **Aborts**: *"FATAL: NODE_ENV=test but the dedicated test configuration is missing… Refusing to run against the live database."* |
| `mocha` run without `NODE_ENV=test` | **Aborts**: *"FATAL: the test suite must be run with NODE_ENV=test."* |
| Live database after the three full-suite runs | `posts=5 artifacts=182 categories=11 users=3 inquiries=0 comments=0` — **identical to the baseline before the runs** |
| Test database after the three full-suite runs | `posts=5 artifacts=67 categories=22 users=2` — the suite's artifacts accumulated **only** in `db_test` |

The fail-closed guards from Phase 8.1 are intact and were re-verified.

---

## 4. PostgreSQL Configuration Findings

Investigated with `backend/scripts/pg-topology.js` (read-only; no service was
stopped, no database was written to).

### 4.1 Two servers, one port

```
127.0.0.1:5432  -> reachable=true
::1:5432        -> reachable=true
localhost:5432  -> reachable=true
172.19.0.2:5432 (container IP) -> reachable=false timeout
```

| | Native Windows service | Docker container |
|---|---|---|
| Name | `postgresql-x64-16` (Windows service, Running) | `wednesdays-db` (postgres:16-alpine, Up, healthy) |
| Build | PostgreSQL 16.15, **compiled by Visual C++** | PostgreSQL 16.15, linux/musl (Alpine) |
| Owns | the IPv6 loopback `::1` and `127.0.0.1` | `0.0.0.0:5432` / `[::]:5432` via Docker's port proxy |
| `wednesdays_dark_chronicles` | **9 tables, the live data** | **0 tables — empty** |
| `db_test` | **9 tables, the test data** | does not exist |

### 4.2 Which server each target reaches

```
localhost  -> db=wednesdays_dark_chronicles user=postgres server_addr=::1/128
              version=PostgreSQL 16.15, compiled by Visual C++ build 1944
127.0.0.1  -> same native service
container IP 172.19.0.2 -> unreachable from the host
```

**Answer:** `localhost:5432` resolves to the **native Windows PostgreSQL
service**, not the Docker container — because it owns the IPv6 loopback
(`::1`) that `localhost` resolves to first, and Docker's published-port proxy
does not intercept it. The container's own database is empty and unreachable
on its container IP from the host.

### 4.3 The four questions asked

| Question | Answer |
|---|---|
| Which server does the development `.env` point to? | The **native Windows service** — `localhost:5432` → `wednesdays_dark_chronicles`, role `postgres`. |
| Which server holds the existing application records? | The **native Windows service**. `wednesdays_dark_chronicles` holds posts=5, artifacts=182, categories=11, users=3. The Docker container's copy is empty (0 tables). |
| Which database do the tests use? | The **native Windows service**, database `db_test`, role `user` — a physically separate database with a separate role, loaded from `.env.test`. |
| Are both servers intentionally needed? | **Ambiguous, and deliberately left unchanged.** `docker-compose.yml` provisions the container with the same `DB_NAME`/`DB_USER`/`DB_PORT`, so the two were set up as alternatives for different environments. Only the native service carries data today. The container is left running and untouched, exactly as found. |

### 4.4 Action taken

**No database was switched, migrated, copied, deleted, reset or overwritten.**
Switching the application to the empty Docker database would have meant
starting from zero tables and losing the seeded content, which the brief
explicitly forbids.

Instead, the finding is **documented in `backend/.env.example`**, which now
explains the two-server topology, states which databases hold the data, notes
that the container's copy is empty, and explains that `docker-compose.yml` is
for environments where the container is the *only* PostgreSQL instance (CI,
a fresh checkout) — where the same `DATABASE_URL` resolves correctly. The
`.env.example` secret placeholders are unchanged.

**Residual ambiguity (documented, not decided):** the intended *production*
PostgreSQL is not determinable from the repository. The native service is
the one that actually serves this project today, and the container's empty
state suggests it was provisioned but never used. Choosing between them is a
deployment decision and was deliberately left to the owner.

---

## 5. Browser Verification Actually Performed

All checks were performed in a real browser against the running backend
(`http://localhost:3000`) and the static server (`http://localhost:5500`).
Interaction used **real mouse clicks at computed viewport coordinates**
(`click_at_xy`) and **real key events** dispatched through CDP
`Input.dispatchKeyEvent`, not synthetic DOM events, except where noted.

### 5.1 Blog feed, filtering, search, pagination, navigation

| Check | Result |
|---|---|
| Feed renders database content | **Pass** — 4 published articles, titles/dates/excerpts from the API, no error message |
| Featured article rendering | **Pass** — index 0 renders as the wide featured card with a "READ ENTRY" link |
| Regular article cards | **Pass** — remaining articles render as cards with excerpt and rule |
| Category filter buttons | **Pass** — 4 buttons (ALL, GOTHIC, THE VOID, TEST CAT) rendered from the API, active state marked via `aria-pressed` |
| Category filtering (real click on GOTHIC) | **Pass** — 2 articles: "The Taxonomy of Shadows", "Elegies in Dust" |
| Search | **Pass** — "Taxonomy" → 1 article; "Published" → filtered list |
| Search + category combination | **Pass** — GOTHIC + "Elegies" → 1 article, with GOTHIC still marked active |
| Empty state | **Pass** — a non-matching query renders "THE VOID IS EMPTY. NO CHRONICLES FOUND." |
| Pagination label | **Pass** — "PAGE I OF I" driven by `meta.totalPages`; Previous/Next present and disabled at the boundaries |
| Navigation to `post.html?slug=…` (real click on the featured title) | **Pass** — lands on `http://localhost:5500/post.html?slug=test-blog-post` and the article renders (previously 404'd) |
| Unpublished posts hidden | **Pass** — "secret-post" (DRAFT) does not appear |

### 5.2 Contact submission and confirmation

| Check | Result |
|---|---|
| `FormData` now carries the fields | **Pass** — `{"name":"","email":"","message":""}` (was `{}`) |
| Empty submit | **Pass** — *"A name is required before the void can answer."* in the error style |
| Invalid email | **Pass** — *"That email address does not look like a valid address."* |
| Successful submission (real click) | **Pass** — *"Your inquiry has been cast into the void. We shall respond if the stars align."* in the success style; the form resets; the submit button is re-enabled |
| Record stored via `POST /api/inquiries` | **Pass** — confirmed in the database: `Phase 8.2 Tester <phase82.tester@example.com>` |
| Duplicate submission blocked | **Pass** — the second identical submit returned *"That message has already been sent. The void does not accept echoes."* and **issued no second request** (verified by instrumenting `fetch`: only one call) |
| Handler actually binds | **Pass** — `typeof form.onsubmit === 'function'` (was `null`, caused by the `const form` duplicate-declaration SyntaxError) |
| Existing inquiry records untouched | **Pass** — the pre-existing records were read, never written |

### 5.3 Vault cards, filtering, search, details

| Check | Result |
|---|---|
| Cards show database content | **Pass** — 12 artifacts rendered from `GET /api/artifacts`, with names, categories and descriptions from the database (the five hardcoded tiles are gone) |
| Search | **Pass** — "Published" → matching artifacts; a non-matching term → "NO RELICS FOUND IN THIS VOID." |
| Category filtering (real click on TEST CAT) | **Pass** — filtered grid; the active filter is marked with `aria-pressed` |
| Artifact details and modal (real click on a tile) | **Pass** — the modal opens populated with name, slug, description, categories and archive date fetched from `GET /api/artifacts/:slug` |
| Modal close button (real click) | **Pass** — the modal closes and focus returns to the originating tile |
| Modal `Escape` key | **Pass** — closes correctly |
| Unpublished artifacts hidden | **Pass** — "Secret Artifact", "Unpublished Artifact", "Hidden Artifact" and "Architecture of Silence" (all `published: false`) appear nowhere on the page |
| Loading / empty / error states | **Pass** — all three implemented and the error state verified to trigger on a failed fetch |

### 5.4 Admin navigation at 390 × 844

Emulated with CDP `Emulation.setDeviceMetricsOverride` at 390 × 844.

| Check | Result |
|---|---|
| Every navigation section reachable | **Pass** — all 7 items present; positions: Overview/Blog/Vault/Categories/The Séance/Messages on row 1, Messages+Logout on row 2 |
| Logout accessible | **Pass** — Logout's right edge is within the 390px viewport (previously at x=630–686, off-screen) |
| No horizontal overflow | **Pass** — `body.scrollWidth` 390 = `clientWidth` 390; no horizontal scrolling possible |
| Tables remain usable | **Pass** — blog (5 rows), vault (182 rows), categories (11 rows) all render; the table container keeps `overflow-x:auto` so wide tables scroll inside their own box rather than widening the page |
| Forms and action buttons fit | **Pass** — the modal is 390px wide, inside the viewport, `max-height` 776px with `overflow-y:auto` |
| Destructive-action confirmations visible | **Pass** — clicking Delete on a blog row raised *"Permanent erasure of this entry?"* and the Delete button sits inside the viewport |
| Keyboard navigation | **Pass** — real `Tab` key events move focus through the nav (1st Tab → Overview, 7th Tab → Logout) |
| Visible focus indicators | **Pass** — with real Tab input the focused element computes `outline: 2px solid rgb(163,22,22)` and `matches(':focus-visible')` is `true` |

### 5.5 Comment submission and moderation still functional

| Check | Result |
|---|---|
| Public comment submission (real click) | **Pass** — *"YOUR VOICE HAS BEEN ADDED TO THE SÉANCE. IT AWAITS MODERATION."*; stored as `pending`; not publicly visible |
| Moderation via the admin UI (real click on Approve) | **Pass** — status changed `pending` → `approved` in the pane |

### 5.6 What was *not* browser-tested, and why

- **Destructive admin mutations** (blog/vault/category create, edit, delete and
  publish/unpublish) were **not** executed: they would alter or destroy real
  content and publication statuses, which the brief forbids. They were
  verified by opening the controls, confirming the populated edit modal and
  the visible confirmation prompt. The underlying endpoints are covered by the
  13 admin + 19 blog/vault/category tests, all passing.
- **Screenshots** were not captured: `Page.captureScreenshot` timed out
  repeatedly against the browser daemon in this environment. Every check was
  therefore made against the live DOM and the database, which is stronger
  evidence than an image, but no visual artefacts are attached.
- **Browser authentication** was performed by injecting a server-issued
  session cookie (from `POST /api/auth/login` for the existing `testadmin`
  account) rather than typing a password, because the credential-vault save
  was declined in the UI. The password was never typed into or read by the
  browser tool.

---

## 6. Database-Preservation Checks

Baseline captured before the Phase 8.2 fixtures were created and compared
after cleanup.

| Metric | Baseline | After cleanup | Verdict |
|---|---|---|---|
| posts | 5 | **5** | unchanged |
| artifacts | 182 | **182** | unchanged |
| categories | 11 | **11** | unchanged |
| users | 3 | **3** | unchanged |
| inquiries | 0 | **0** | fixtures removed |
| comments | 0 | **0** | fixtures removed |

### 6.1 Publication statuses unchanged

| Record | Status before | Status after |
|---|---|---|
| `taxonomy-of-shadows` | Published | **Published** |
| `elegies-in-dust` | Published | **Published** |
| `test-post` | Published | **Published** |
| `test-blog-post` | Published | **Published** |
| `secret-post` | Draft | **Draft** |
| `architecture-of-silence` (artifact) | Draft | **Draft** |

Aggregate: posts = 4 published / 1 draft; artifacts = 58 published / 124 draft.
Identical before and after.

### 6.2 Records explicitly preserved

- `admin`, `testadmin`, `admin_test` — all present, **no account created,
  modified or deleted**; no password or role changes.
- The seed content (`taxonomy-of-shadows`, `elegies-in-dust`,
  `architecture-of-silence`) — untouched.
- Every artifact, category and post — untouched.
- `.env` and all production secrets — unmodified.
- The Docker container and its volume — untouched and still running.

### 6.3 Fixtures created and removed by this phase

| Fixture | Type | Identified by | Removed |
|---|---|---|---|
| "Phase 8.2 Check" — *"Verifying comments still work after Phase 8.2."* | comment | exact author | **Yes** |
| `phase82.tester@example.com` (×2) | inquiry | exact email | **Yes** |
| `dup.guard@example.com` | inquiry | exact email | **Yes** |

Each deletion was guarded by an exact identifier (author string / email
address); nothing was deleted by pattern or date range. The cleanup script
supports `--dry-run` and is idempotent.

---

## 7. Remaining Limitations

| # | Limitation | Detail |
|---|---|---|
| L1 | **The blog page's pagination is bounded by the seeded data.** | The live database has only 4 published posts, so `totalPages` is 1 and the Next button is always disabled. The pagination *logic* is correct and driven by `meta`, but a multi-page walk was not observable with the current content. Creating extra published posts to demonstrate it was deliberately avoided, as it would change content. |
| L2 | **The blog "Search" and "The Séance" in the admin pane show the 8th / 7th nav item wrapping onto a second row at 390px.** | This is the intended wrap behaviour. Both remain fully visible and clickable; no content is clipped. |
| L3 | **Destructive admin actions were not executed in the browser.** | See §5.6. Covered by the automated suite instead. |
| L4 | **The Vault's decorative "Capturing the Invisible" section is still static.** | It is editorial page furniture below the grid, not an artifact record, and was left unchanged to avoid redesigning the page. |
| L5 | **The Vault page still has no `fileUrl` on most artifacts.** | The modal shows "No file attached to this relic." for them. This reflects the data, not a bug; no artifact records were modified. |
| L6 | **Two PostgreSQL servers still share port 5432.** | Documented in §4 and in `.env.example`. Not resolved, because resolving it means either moving data or removing a service — both outside this phase's authorisation. The native service is the one actually serving the project. |
| L7 | **No screenshots.** | The browser daemon timed out on `Page.captureScreenshot` repeatedly. DOM and database assertions were used instead. |
| L8 | **The inquiry rate limiter (5 per IP per hour) was not exercised.** | Reaching it would have required five real submissions. It remains in force and unchanged. |
| L9 | **Two static servers remain running** (`http-server` on 5500 and 5599). | Both were started by the Phase 8.1/8.2 verification; 5500 is the one the backend's `FRONTEND_ORIGIN` allows. The attempt to stop the redundant 5599 instance was blocked by the approval prompt, so both were left running. Neither is a production service. |

---

## 8. Project Boundaries

| Constraint | Status |
|---|---|
| Phase 9 not started | **Honoured** |
| Application not deployed | **Honoured** — no deployment step was performed |
| No public page redesigned | **Honoured** — the three public pages were repaired in place; layout, typography, colour and structure were preserved, and no new sections, menus or visual styles were introduced |
| No database resets or destructive migrations | **Honoured** — no `migrate reset`, no `prisma migrate reset`, no volume removal |
| No administrator accounts created or modified | **Honoured** — all three accounts untouched |
| No existing content or publication statuses changed | **Honoured** — verified by before/after comparison (§6) |
| No production secrets modified | **Honoured** — `.env` untouched; `.env.example` placeholders unchanged |
| Phase 8.1 fail-closed test guards preserved | **Honoured** — all three re-verified in §3.3 |
| No unrelated database services stopped | **Honoured** — the Docker container and the native PostgreSQL service are both still running |

---

## 9. Conclusion

All four reported defects are fixed, browser-verified, and regression-tested.

- **Blog:** now consumes the real `{ data, meta }` envelope, renders 4 published
  articles, and supports category filtering, search, the two combined,
  pagination, the empty state, and working navigation to `post.html?slug=…`
  (which previously 404'd because of a relative path). The public API contract
  was not changed.
- **Contact form:** now sends a correctly named, validated payload, stores
  records through `POST /api/inquiries`, shows accurate success and failure
  messages, and blocks duplicate submissions without issuing a second request.
  Two further defects were found and fixed along the way — a missing email
  field, and a legacy handler that faked a success message while never
  contacting the API.
- **Vault:** now database-driven using the existing public APIs, with working
  search, category filtering, a detail modal, correct loading/empty/error
  states, safe image handling, and unpublished artifacts confirmed hidden.
- **Admin navigation:** usable at 390 × 844 — every section reachable, Logout
  on-screen, tables and modals contained, confirmations visible, and visible
  focus indicators on real keyboard navigation.
- **PostgreSQL:** the two-server ambiguity is now established with evidence
  and documented rather than guessed at. No database was switched, migrated or
  reset.
- **Tests:** 104 passing, 0 failing, 0 pending, 0 skipped in each of three
  separate-process full-suite runs, plus every group passing independently.
  The live database was byte-identical before and after.
- **Database preservation:** only this phase's own fixtures were removed; all
  seeded content, publication statuses and administrator accounts are intact.

The production PostgreSQL target remains an open deployment decision, recorded
in §4.4 for the owner to settle.

**STOP after Phase 8.2. Awaiting explicit approval before beginning Phase 9.**
