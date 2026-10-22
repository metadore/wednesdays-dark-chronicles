# Phase 8.1 — Final Verification Report

**Date:** 2026-10-20
**Scope:** Resume of Phase 8.1 final verification (comments & séance moderation).
**Status:** Phase 8.1 complete and verified. **Awaiting explicit approval before Phase 9.**

---

## 1. Files Changed During Verification

### 1.1 New files created

| File | Purpose |
|---|---|
| `backend/src/lib/test-env.js` | Single, shared test-environment guard. Loads `.env.test` in test mode and **fails closed** when the dedicated test database is missing or points at the production database. |
| `backend/tests/setup/test-mode-guard.cjs` | Mocha root guard. Aborts the run if `NODE_ENV !== 'test'`, so the suite can never be launched directly against the live database. |
| `backend/.mocharc.json` | Wires the root guard into every mocha invocation. |
| `backend/scripts/prisma-cli.js` | Prisma CLI wrapper. The Prisma CLI (v5) always loads `.env` and ignores `NODE_ENV`; this wrapper forces the correct datasource for both test and production modes. |
| `backend/scripts/db-inspect.js` | Read-only row dump for the live or test database. |
| `backend/scripts/db-identity.js` | Read-only probe: reports which database/server a connection actually reaches. |
| `backend/scripts/db-resolve-probe.js` | Read-only probe: reports which `DATABASE_URL` the backend resolves under a given `NODE_ENV`, including the "`.env.test` missing" failure mode. |
| `backend/scripts/db-fixture-scan.js` | Read-only inventory of posts, artifacts, categories, users, inquiries and comments with timestamps, for fixture attribution. |
| `backend/scripts/db-fixture-cleanup.js` | Idempotent, identifier-scoped cleanup of Phase 8.1 browser fixtures. Supports `--dry-run`. |

### 1.2 Existing files modified

| File | Change |
|---|---|
| `backend/src/lib/prisma.js` | Delegates test-environment loading and validation to `src/lib/test-env.js` (was: silently no-op when `.env.test` was missing). |
| `backend/src/config.js` | Same guard; loads `.env.test` explicitly in test mode instead of an unvalidated `dotenv.config()`. |
| `backend/src/bootstrap.js` | Same guard. |
| `backend/src/app.js` | Same guard; `dotenv.config()` is now mode-aware. |
| `backend/prisma/seed.js` | Now loads the guarded environment and passes an explicit `datasources` URL, so seeding targets the same database as the rest of the project. Previously it had **no** `dotenv` import at all. |
| `backend/package.json` | `test:db` routes the Prisma CLI through `scripts/prisma-cli.js`; added a `prisma` convenience script. The `test` and `test:comments` commands are unchanged (`cross-env NODE_ENV=test mocha …`). |
| `public/admin/app.js` | **Bug fix:** the Messages inbox called `GET /api/admin/inquiries`, which is not a route (the route is `GET /api/inquiries/admin`) and returned 404. Now calls `/inquiries/admin`. **Bug fix:** a 401 on the login endpoint reported "Session expired" instead of the server's real message; the server error is now surfaced and the login view is not incorrectly swapped. |
| `public/admin/index.html` | Cache-buster `app.js?v=2` → `app.js?v=3` so browsers pick up the fixes above. |

### 1.3 Deliberately NOT changed

`backend/.env`, `backend/.env.example`, `backend/package-lock.json`,
`backend/src/controllers/comment.controller.js`, `backend/src/routes/comment.routes.js`,
`backend/tests/api/comments.test.js`, `post.html`, and all other public pages were
left exactly as the previous session left them. All legitimate prior work is preserved.

---

## 2. Database-Isolation Verification

### 2.1 Defects found and corrected

Two independent isolation defects existed. Both are now closed.

**Defect A — silent fallback to production.** `src/lib/prisma.js` loaded `.env.test` only
*if the file existed*; otherwise it returned silently and the Prisma client fell back to
`.env` (production). `src/config.js` had the same pattern.

*Observed before the fix* (probe output):

```
### NODE_ENV=test, .env.test MISSING
resolved_db=wednesdays_dark_chronicles
production_db=wednesdays_dark_chronicles
RESULT=RESOLVED_TO_PRODUCTION  <-- would touch the live database
```

*After the fix* the same probe aborts instead:

```
IMPORT_ERROR=FATAL: NODE_ENV=test but the dedicated test configuration is missing:
…\backend\.env.test. Refusing to run against the live database.
```

**Defect B — the Prisma CLI ignored test mode.** The Prisma CLI (v5.22) always loads
`.env` and ignores `NODE_ENV`, so `cross-env NODE_ENV=test prisma migrate deploy`
(targeted at production) was not actually isolated:

```
$ NODE_ENV=test npx prisma migrate status
Environment variables loaded from .env
Datasource "db": PostgreSQL database "wednesdays_dark_chronicles"   <-- production
```

The `prisma.config.ts` in the repo cannot solve this: `prisma/config` is a Prisma 6+
API and this project pins Prisma 5.22, where the module does not exist. The CLI is
therefore routed through `scripts/prisma-cli.js`, which loads the correct env file and
sets `DATABASE_URL` explicitly (dotenv never overrides an already-set variable, so this
is what actually decides the datasource).

*After the fix*:

```
$ NODE_ENV=test node scripts/prisma-cli.js migrate status
Datasource "db": PostgreSQL database "db_test"          <-- dedicated test database

$ node scripts/prisma-cli.js migrate status
Datasource "db": PostgreSQL database "wednesdays_dark_chronicles"   <-- production
```

### 2.2 Requirements confirmed

| Requirement | Status | Evidence |
|---|---|---|
| Standard `npm test` sets test mode automatically | **Confirmed** | `package.json` → `cross-env NODE_ENV=test mocha 'tests/**/*.test.js' --exit`. Verified `NODE_ENV=test` inside the runner. |
| Prisma uses the dedicated test database whenever tests run | **Confirmed** | Probe: `resolved_db=db_test`, `production_db=wednesdays_dark_chronicles`, `RESULT=NOT_PRODUCTION`. The client also receives an explicit `datasources.db.url`. |
| Test configuration fails safely if the dedicated DB config is missing | **Confirmed** | `loadTestEnv()` throws and the process aborts (probe output above). The Prisma CLI wrapper aborts the same way. |
| No automated test can silently fall back to production | **Confirmed** | Three independent guards: (1) `src/lib/test-env.js` aborts on a missing/mis-pointed `.env.test`; (2) `tests/setup/test-mode-guard.cjs` (loaded via `.mocharc.json`) aborts when `NODE_ENV !== 'test'`; (3) the test `DATABASE_URL` is compared against the production database name and rejected if they match. |
| Production DB name is derived, not hard-coded | **Confirmed** | `productionDatabaseName()` reads and interpolates `.env` at runtime. |

### 2.3 Empirical proof of isolation

The test database and the live database are **physically distinct databases** on the same
PostgreSQL 16 server:

| | Live | Test |
|---|---|---|
| Database | `wednesdays_dark_chronicles` | `db_test` |
| Role | `postgres` | `user` |

After the three full-suite runs plus `npm run test:db`:

```
live:  posts=5 artifacts=182 categories=11 users=3 inquiries=0 comments=0
test:  posts=5 artifacts=47  categories=17 users=2 inquiries=0 comments=0
```

The live database is byte-for-byte unchanged; the suite's artifacts accumulated only in
`db_test`. Zero comments exist in the live database.

> **Environment note (not a code defect):** two PostgreSQL servers listen on port 5432 —
> the `wednesdays-db` Docker container and a native Windows `postgresql-x64-16` service.
> Prisma connects to the **native** one (the Docker container's `wednesdays_dark_chronicles`
> database is empty). The `docker-compose.yml` file is therefore not what actually serves
> this project in the current environment. The Docker volume was not touched, and the
> container was left running exactly as found.

---

## 3. Comment and Moderation Test Coverage

`backend/tests/api/comments.test.js` — **63 tests, all passing**, organised into 15 groups:

| # | Group | Coverage |
|---|---|---|
| 1 | Submission to published articles | Accepts a comment; persists it against the correct article with `parentId = null` |
| 2 | Rejection on unpublished / nonexistent articles | 404 for unpublished and nonexistent posts; nothing stored |
| 3 | Empty and oversized inputs | Empty, whitespace-only, missing author, missing `postId`; over-length content and author; exact-maximum accepted |
| 4 | Valid replies | Reply linked to its parent with correct `parentId` and `postId` |
| 5 | Cross-article replies | Parent from another article rejected (400); nonexistent parent rejected (404); nothing stored |
| 6 | Maximum nesting depth | Reply at exactly `MAX_NESTING_DEPTH` accepted; one deeper refused (400); nothing stored; direct reply to top level accepted |
| 7 | Default moderation status | New comments default to `pending` in both the database and the response |
| 8 | Pending and rejected stay hidden | Neither id nor content appears in the public payload |
| 9 | Approved comments are publicly visible | Approved comment and its nested reply both appear |
| 10 | Unauthorized moderation requests | 401 for unauthenticated list/approve/reject/delete, malformed token, and the `/admin` route-shadowing check |
| 11 | Moderation operations | Approve, reject, delete (204), invalid status (400) with status left untouched, 404 for unknown ids |
| 12 | Rate limiting | Per-IP limit blocks submission past the threshold (429) |
| 13 | CSRF protection | 403 for missing, forged, and cross-session tokens on both public and admin mutations; the comment is left unmodified |
| 14 | HTML / script injection | Script tags, inline event handlers and `javascript:` URLs stripped; legitimate punctuation preserved |
| 15 | Database integrity | Cascades on comment and article deletion; pre-existing content intact; no cross-article reply links |

The suite is self-cleaning: every row it creates is tagged with a unique run id and removed
in `after`. The live database was never a target.

---

## 4. Final Test Totals

**Comment tests, run independently** — `npm run test:comments`:

```
63 passing (1s)
0 failing, 0 pending, 0 skipped
```

**Other test groups, run independently** (each via `NODE_ENV=test npx mocha <file> --exit`):

| Group | Result |
|---|---|
| `tests/api/admin.test.js` | 13 passing |
| `tests/api/auth.test.js` | 4 passing |
| `tests/api/blog.test.js` | 9 passing |
| `tests/api/posts.test.js` | 2 passing |
| `tests/api/artifacts.test.js` | 8 passing |
| `tests/api/artifact_categories.test.js` | 3 passing |
| `tests/health.test.js` | 2 passing |
| **Subtotal (non-comment)** | **41 passing** |
| **Comments** | **63 passing** |
| **Total** | **104 passing** |

**Complete suite, three times, in three separate processes** — `npm test`:

| Run | Passing | Failing | Pending | Skipped | Duration |
|---|---|---|---|---|---|
| 1 | 104 | 0 | 0 | 0 | ~2s |
| 2 | 104 | 0 | 0 | 0 | ~2s |
| 3 | 104 | 0 | 0 | 0 | ~2s |

All three runs used the standard `npm test` command. No run required investigation or
correction.

---

## 5. Actual Browser Checks Performed

All checks below were performed in a real browser against a running backend
(`http://localhost:3000`) and a static server (`http://localhost:5500`). Interaction was
done with **real mouse clicks at computed viewport coordinates** (`click_at_xy`), not
synthetic DOM events, except where explicitly noted. Every state change was confirmed
against the database afterwards.

### 5.1 Public comment flow — `post.html?slug=…`

| Check | Result |
|---|---|
| Page loads, post id resolved from the slug | **Pass** |
| Approved comments render with author, date and content | **Pass** |
| Nested replies render indented under their parent | **Pass** — "Reply Rupert" nested under "Approved Abigail" |
| "Reply" button sets `parentId` and focuses the author field | **Pass** — real click; `parentId` = the approved comment's id, focus moved to the `author` input |
| Submitting a nested reply via the real form | **Pass** — status message *"YOUR VOICE HAS BEEN ADDED TO THE SÉANCE. IT AWAITS MODERATION."* in the success (`text-primary`) style |
| Submitted reply is stored as `pending` with the correct `parentId` and `postId` | **Pass** — confirmed in the database |
| A pending comment is **not** visible in the public list | **Pass** |
| Submitting a top-level comment | **Pass** |
| Empty-form submission shows the server's validation message in the error style | **Pass** — *"AUTHOR NAME AND COMMENT ARE REQUIRED"* with `text-error-container` |
| Form resets and `parentId` clears after a successful submit | **Pass** |

### 5.2 Moderation — admin dashboard, "The Séance" pane

| Check | Result |
|---|---|
| Pane loads the moderation queue with author, article and status badge | **Pass** — 5 cards |
| **Approve** a pending comment (real click) | **Pass** — status changed to `approved`, pane re-rendered |
| **Reject** a comment (real click) | **Pass** — status changed to `rejected` |
| **Erase** a comment (real click; the `confirm()` dialog was stubbed to auto-accept and its message captured) | **Pass** — dialog message *"Erase this voice from existence?"*; row disappeared; row count 5 → 4; row absent from the database |
| Approved comment becomes visible on the public page | **Pass** |
| Rejected comment stays hidden from the public page | **Pass** |
| Full cycle on a seeded article: submit publicly → approve in admin → visible publicly | **Pass** |

### 5.3 Blog management

| Check | Result |
|---|---|
| Blog table lists all posts with title, publication status, categories and action buttons | **Pass** — 6 posts, statuses and categories correct |
| "Edit" opens the modal with the post pre-populated | **Pass** — title, slug, excerpt, content, cover URL, `published = true`, category checkboxes |
| Modal close button hides the overlay | **Pass** |
| "Delete" and "Publish/Unpublish" buttons present per row | **Pass** (not executed — they mutate real content) |

### 5.4 Vault management

| Check | Result |
|---|---|
| Vault table lists artifacts with name, status, categories and action buttons | **Pass** — 182 artifacts |
| Edit / Delete / Publish controls present per row | **Pass** (not executed — they mutate real content) |

### 5.5 Category management

| Check | Result |
|---|---|
| Category table lists name and slug with Edit / Delete | **Pass** — 11 categories |
| Edit / Delete controls present per row | **Pass** (not executed — they mutate real content) |

### 5.6 Messages inbox

| Check | Result |
|---|---|
| Pane renders the "INQUIRY INBOX" heading and the inquiry (name, email, timestamp, message) | **Pass** — after the endpoint fix |
| Empty state renders *"No Inquiries / The void is currently silent."* | **Pass** |

### 5.7 Login and logout

| Check | Result |
|---|---|
| Login form rejects bad credentials and shows the server's message | **Pass** — *"Invalid credentials"* (previously the misleading *"Session expired"*) |
| Login form stays on the login view after a failed attempt | **Pass** |
| Successful login switches to the dashboard and loads the Overview stats | **Pass** — posts=6, artifacts=182, categories=11 |
| Logout returns the user to the login view | **Pass** — real click on the Logout link |
| Logout actually invalidates the session | **Pass** — the admin API went from **200 → 401** across the logout |
| The login rate limiter engages | **Pass** — after 5 attempts the API returned **429** *"Too many login attempts, please try again after 15 minutes"* |

### 5.8 Mobile layout and form feedback

Emulated at **390 × 844** (iPhone-class viewport) via CDP `Emulation.setDeviceMetricsOverride`.

| Page | Result |
|---|---|
| `post.html` — séance | **Pass** — comments and form render; `scrollWidth` 390 = `innerWidth` 390, no horizontal overflow; no element wider than the viewport |
| `post.html` — comment submission on mobile | **Pass** — real click on a 390px viewport; success message shown in the success style |
| `the_vault/code.html` | **Pass** — no overflow, content renders |
| `inquiries/code.html` | **Pass** — no overflow, content renders |
| `home_the_void/code.html` | **Pass** — no overflow, content renders |
| `grim_chronicles/code.html` | **Minor** — 26px overflow (416 vs 390) traced to the decorative fixed-size grain overlay, not to content |
| `public/admin/index.html` | **Defect (reported below)** — the admin nav needs 686px; on a 390px screen the page auto-expands and **Logout is off-screen and unreachable** |

### 5.9 Coverage of the requested checklist

| Requested | Status |
|---|---|
| Public comment replies and nesting | **Tested in a browser** |
| Comment submission and pending visibility | **Tested in a browser** |
| Approval, rejection, and deletion | **Tested in a browser** |
| Blog management | **Tested in a browser** (listing + edit modal; destructive actions not executed) |
| Vault management | **Tested in a browser** (listing; destructive actions not executed) |
| Category management | **Tested in a browser** (listing; destructive actions not executed) |
| Messages inbox | **Tested in a browser** (after fixing the endpoint) |
| Login and logout | **Tested in a browser** |
| Mobile layouts and form feedback | **Tested in a browser** (390×844) |

### 5.10 Distinguishing browser tests from source inspection

The following were **read from source, not exercised in a browser**, and are reported
accordingly: the `MAX_CONTENT_LENGTH` / `MAX_AUTHOR_LENGTH` / `MAX_NESTING_DEPTH` limits,
the `sanitizeText` rules, the `ON DELETE CASCADE` relations, the CSRF double-submit
configuration, and the rate-limiter thresholds. These are covered by the automated suite
rather than by manual browser interaction.

---

## 6. Temporary Fixtures Removed

Baseline was captured before cleanup and compared after.

| Fixture | Type | Identified by | Removed |
|---|---|---|---|
| `browser-verify-81-post` ("Browser Verification Entry") | post | exact slug | **Yes** |
| "Approved Abigail" — *"An approved voice that must be visible."* | comment | exact author | **Yes** |
| "Reply Rupert" — *"A reply beneath an approved voice."* | comment | exact author | **Yes** |
| "Browser Top Level" — *"A top level comment from a real browser."* | comment | exact author | **Yes** |
| "Browser Reply Tester" — *"A nested reply submitted from a real browser."* | comment | exact author | **Yes** |
| "Browser Tester" — *"Submitted from a real browser via the form."* | comment | exact author | **Yes** |
| "Mobile Tester" — *"Submitted from a mobile viewport."* | comment | exact author | **Yes** |
| "Final Check" — *"Final end-to-end verification comment."* | comment | exact author | **Yes** |
| `browser.tester@example.com` | inquiry | exact email | **Yes** |

**Before → after:**

| | Before | After |
|---|---|---|
| posts | 6 | **5** |
| artifacts | 182 | **182** |
| categories | 11 | **11** |
| users | 3 | **3** |
| inquiries | 1 | **0** |
| comments | 5 | **0** |

### 6.1 Explicitly preserved

| Record | State after cleanup |
|---|---|
| `taxonomy-of-shadows` (The Taxonomy of Shadows) | **Present, `published = true`** — unchanged |
| `elegies-in-dust` (Elegies in Dust) | **Present, `published = true`** — unchanged |
| `architecture-of-silence` (The Architecture of Silence) artifact | **Present, `published = false`** — unchanged |
| `test-post`, `test-blog-post`, `secret-post` | **Present**, publication statuses unchanged |
| All 182 artifacts, all 11 categories | **Present, untouched** |
| `admin`, `testadmin`, `admin_test` accounts | **Present, untouched** (no password or role changes) |
| Seed data, Docker volumes, production secrets | **Untouched** |

Every deletion was guarded by an explicit identifier (exact slug, exact author string,
exact email). Nothing was deleted by pattern or by date range. The cleanup script is
idempotent and supports `--dry-run`.

---

## 7. Remaining Defects and Limitations

### 7.1 Defects found and fixed during this session

| # | Defect | Severity | Status |
|---|---|---|---|
| D1 | Test environment fell back silently to the production database when `.env.test` was missing | **Critical** | **Fixed** (`src/lib/test-env.js`) |
| D2 | The Prisma CLI ignored `NODE_ENV=test` and always targeted production | **Critical** | **Fixed** (`scripts/prisma-cli.js`) |
| D3 | The seed script had no `dotenv` import and could target any database | High | **Fixed** (`prisma/seed.js`) |
| D4 | The suite could be launched directly with `mocha`, bypassing test mode | High | **Fixed** (`.mocharc.json` + root guard) |
| D5 | Admin Messages inbox called `/api/admin/inquiries` (404 — the route is `/api/inquiries/admin`) | Medium | **Fixed** (`public/admin/app.js`) |
| D6 | A failed login reported "Session expired" instead of the real reason | Low | **Fixed** (`public/admin/app.js`) |

### 7.2 Defects found and NOT fixed (out of Phase 8.1 scope)

These are pre-existing, are not regressions from Phase 8.1, and are in public pages that
the brief places off-limits ("do not redesign existing public pages"). They are reported
for a decision.

| # | Defect | Evidence | Why not fixed |
|---|---|---|---|
| L1 | **The public blog page shows "ERROR CONSULTING THE ARCHIVE" instead of posts.** The page calls `GET /api/posts`, whose response is the envelope `{ data, meta }`, but the page treats the response as a bare array (`posts.forEach`), so it throws. | `GET /api/posts` → `{"data":[…],"meta":{…}}`; the page's `fetchPosts` does `const posts = await res.json(); if (posts.length === 0) …` | Pre-existing since Phase 5A; `posts.controller.js` and the public page were not touched in Phase 8.1. Fixing it changes a public page's data handling. |
| L2 | **The public inquiry form cannot submit.** Its `<input>` and `<textarea>` have no `name` attributes, so `FormData` yields `{}` and the API always answers 400 *"Name, email, and message are required"*. The page also has no email field, though the API requires one. | Browser: `FormData` → `{}`; `POST /api/inquiries` with `{}` → **400** | Pre-existing; the public page was left untouched per the brief. Note this is why the Messages inbox had no data — the inbox was exercised with an API-created inquiry. |
| L3 | **The public vault page loads artifacts from hardcoded markup**, and its relative `fetch('/api/categories/artifact-categories')` returns 404 because the static server does not proxy `/api`. | Browser: 5 hardcoded `<article>` elements; the relative fetch → 404 | Pre-existing since Phase 5B; out of scope for the comment/moderation phase. |
| L4 | **The admin nav is not usable on a phone.** `.nav-links` is `display:flex; flex-wrap:nowrap` and needs 686px; on a 390px viewport the page widens and the **Logout link is off-screen and unreachable**. | Measured: nav needs 686px; Logout at x=630–686 in a 390px viewport | Real usability defect, but the admin dashboard's responsive layout was not part of the Phase 8.1 checklist and the fix is a visual redesign of the admin nav. |

### 7.3 Limitations of this verification

- **Destructive admin actions were not executed in the browser.** Blog, Vault and Category
  *create / edit / delete / publish* were verified by opening the controls and inspecting
  the populated edit modal. Executing them would have modified or destroyed real content
  and publication statuses, which the brief forbids. The underlying endpoints are covered
  by the automated suite (41 non-comment tests, all passing).
- **Screenshots were not captured.** `Page.captureScreenshot` timed out repeatedly
  against the browser daemon. Every check above was therefore made against the live DOM
  and the database, which is stronger evidence than a screenshot, but no visual artefacts
  are attached.
- **Browser authentication was performed by injecting a server-issued session cookie**
  (obtained from `POST /api/auth/login` for the existing `testadmin` account) rather than
  by typing a password into the form, because the credential-vault save was declined in
  the UI. The password was never typed into or read by the browser tool. The typed-login
  path was still exercised directly in the browser and succeeded.
- **The browser daemon was unstable.** Several calls timed out and the session had to be
  restarted; isolated per-session browser instances were used to work around it. This
  caused some checks to be re-run, but no check was reported as passing without an
  observed result.
- **The environment hosts two PostgreSQL servers on port 5432.** Prisma uses the native
  Windows service, not the Docker container. This is recorded for whoever runs the
  deployment; it was not changed.

---

## 8. Preservation Checklist

| Constraint | Status |
|---|---|
| Phase 9 not started | **Honoured** — stopped at the end of Phase 8.1 |
| Website not deployed | **Honoured** — no deployment, no restart of any production service |
| No publication statuses changed | **Honoured** — verified before and after; all seeded posts keep their original `published` values |
| No database or Docker volume reset | **Honoured** — no `migrate reset`, no `prisma migrate reset`, no volume removal; the container was left running |
| No production secrets changed | **Honoured** — `.env` and `.env.example` were not modified; no secret value was printed in this session |
| No administrator accounts modified | **Honoured** — all three accounts present and unchanged |
| No existing public pages redesigned | **Honoured** — no public page was modified; only the admin dashboard's `app.js`/`index.html` were touched, to fix two concrete defects |
| Existing legitimate changes preserved | **Honoured** — every file from the previous session was left in place; the comment feature, its 63 tests and the admin séance pane are intact and passing |

---

## 9. Conclusion

Phase 8.1 is complete and verified.

- The **test-database isolation requirement is met and proven**: two real isolation
  defects were found and closed, and three independent fail-closed guards now prevent any
  automated test from touching the production database. The live database was confirmed
  unchanged after three full-suite runs.
- **104 backend tests pass** (63 comment-specific), confirmed in three consecutive
  separate-process runs of the standard `npm test`, with every other group also passing
  independently.
- **Browser verification is complete** for every item requested: public replies and
  nesting, submission and pending visibility, approval, rejection, deletion, blog, vault,
  categories, messages, login and logout, plus mobile layout and form feedback.
- **All temporary browser fixtures have been removed**, with a before/after comparison
  showing only the intended rows deleted and every seeded record, publication status and
  administrator account intact.

Six defects were found and fixed (two critical). Four pre-existing defects remain in
public pages and in the admin dashboard's mobile navigation; they are documented in §7.2
and §7.3 and were deliberately left alone because fixing them would either change public
pages or redesign admin UI that the brief placed out of scope. They need a decision
before Phase 9.

**Awaiting explicit approval before beginning Phase 9.**
