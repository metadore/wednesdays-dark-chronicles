# Phase 10 — Security Hardening and Deployment Readiness

**Project:** Wednesday's Dark Chronicles
**Phase:** 10 (final major engineering phase)
**Status:** Complete. Awaiting approval before deployment.
**Date:** 21 October 2026

---

## 0. What this phase did, in one page

The application was audited end to end: every backend module, every route,
every controller, every public page, the admin dashboard, the automated test
suite, the environment configuration and the deployment documentation.

**Twelve verified defects were found and fixed.** Each one is listed below
with the evidence that it was real, the change that fixed it, and the
regression test that now prevents its return. None of them was a design
change: every fix restores or completes behaviour the project already
intended.

**The application was not deployed.** No DNS, no domain, no production
secret, no live configuration and no administrator account was created or
modified. The live database was verified to be byte-for-byte unaffected by
the audit (§7).

**Two decisions remain open** and need the owner's input: the production
database target (§6) and the fate of three stale accounts in the live
database (§8.3).

| Outcome | Result |
|---|---|
| Automated tests | 443 passing, 0 failing, three consecutive full-suite runs in separate processes |
| Browser verification | 21 workflows exercised in a real browser against a real backend |
| Files changed | 32 (12 source, 4 test, 8 frontend, 5 config/documentation, 3 new source modules) |
| New test files | 4 (63 new tests) |
| Live database changes | None (verified) |
| Deployment performed | None |

---

## 1. Phase 10A — Repository and architecture audit

### 1.1 The repository has no version control

**Finding.** The project directory is **not a Git repository**. `git status`
reports `fatal: not a git repository`. There is no `.git` directory
anywhere in the tree.

There was a `backend/.gitignore` (added earlier today) but **no
project-level `.gitignore`**, so a repository initialised from the project
root would have committed `backend/.env` and `backend/.env.test` — the live
database password and the test database password — into the first commit.

**What was done.**

* A project-level `.gitignore` was created at the repository root. It
  excludes `.env` and `.env.*` (with `!.env.example` so the template stays
  tracked), `node_modules/`, build output, logs, `backend/scripts/tmp/`,
  and `*.sql` / `*.dump` / `*.backup` so a local database dump can never be
  committed.
* **No repository was initialised.** The brief says to report the absence
  and propose a safe setup, not to create one.

**Proposed setup, for the owner's approval:**

```bash
cd <project root>
git init
git add .gitignore          # the ignore rules come first
git status --ignored       # confirm .env and .env.test are ignored
git add .
git commit -m "Initial import of Wednesday's Dark Chronicles"
```

Verify before the first commit that `git status` does **not** list
`backend/.env`, `backend/.env.test` or anything under `backend/node_modules/`.
If any of them appears, stop: the ignore rules are not taking effect.

### 1.2 The project layout

```
stitch_wednesday_s_dark_chronicles/
├── backend/
│   ├── prisma/           schema + 7 migrations + seed
│   ├── scripts/          admin creation, Prisma CLI wrapper, DB tooling
│   ├── src/
│   │   ├── controllers/  8 controllers
│   │   ├── lib/          prisma, test-env, content-validation,
│   │   │                 story-validation, pagination, token-revocation
│   │   ├── middleware/   auth, csrf, error
│   │   └── routes/       8 routers
│   └── tests/            api/, browser/, unit/, helpers/, setup/
├── public/admin/         the Grimoire dashboard
├── branching_stories/    the story listing and the story reader
├── bookmarks/  grim_chronicles/  home_the_void/  inquiries/  the_vault/
├── post.html  reader-config.js  reader-data.js  reader-ui.js  reader.css
├── reports/              the phase reports
└── docker-compose.yml    a PostgreSQL container for CI and fresh checkouts
```

### 1.3 Environment configuration (no secret values reproduced)

| File | Purpose | Status |
|---|---|---|
| `backend/.env` | Development | Real credentials. **Excluded from version control.** |
| `backend/.env.example` | Template | Placeholders only. Verified by a test. |
| `backend/.env.test` | Test database | Real credentials. **Excluded from version control.** |
| `backend/.gitignore` | Backend ignores | Pre-existing; covers `.env`, `.env.test`. |
| `.gitignore` | Project ignores | **Created in this phase.** |

Observed without printing any value:

* `JWT_SECRET` and `CSRF_SECRET` in `.env` differ from `.env.example` and
  from `.env.test`. The three environments do not share a secret.
* `.env.example` carries `replace-me-with-a-random-value` for both secrets.
* `DB_PASSWORD` in `.env` was the literal `password`, and `.env.example`
  carried the same literal. **The example file has been changed to a
  placeholder**, so the example no longer teaches a weak default.
* `SESSION_SECRET` is present in `.env` and `.env.example` but is **not
  referenced anywhere in the code**. The CSRF session identifier is a
  random cookie value, not a signed one. It has been removed from
  `.env.example` and is documented as unused in the deployment guide.
* The frontend contains **no backend secrets**. The only configuration the
  browser sees is the API base URL.

---

## 2. Phase 10A — Feature inventory

Verified by exercising each feature. "Verified" means it was actually run
in a browser against a running backend, or by a passing automated test that
targets it directly.

| Feature | State | Evidence |
|---|---|---|
| Public blog listing | **Working** | Browser: 4 posts rendered, pagination label correct |
| Blog category filtering | **Working** | Browser: "Gothic" → 2 posts, "All" → 4 posts |
| Blog search | **Working** | Browser: "zzz-no-match" → 0 results, cleared → 4 results |
| Public Vault listing | **Working** | Browser: 12 tiles rendered |
| Vault category filter | **Working** | 3 filter buttons, filtering verified in the browser |
| Vault artifact modal | **Working** | Opens, focus moves to the close button, image URL validated |
| Search (server side) | **Working** | `?q=` filters on title, excerpt, content, name, description |
| Contact submissions | **Working** | Browser: submitted → *"cast into the void"* → appeared in the admin inbox |
| Admin Messages inbox | **Working** | Browser: the submitted inquiry was visible in the inbox |
| Administrator login | **Working** | Browser: login → dashboard with 5 posts / 322 artifacts / 85 categories |
| Administrator logout | **Working** | Browser: returns to login, admin API then answers 401 |
| Grimoire dashboard | **Working** | All seven panes load: overview, blog, vault, categories, stories, séance, messages |
| Comment submission | **Working** | Browser: submitted → stored as `pending` |
| Comment moderation | **Working** | Browser: approve → status `approved` → publicly visible on the article |
| Branching stories | **Working** | Browser: start node → choice → ending node, with the path tracked |
| Story publication | **Working** | Published via the admin API, then read in the browser |
| Bookmarks | **Working** | Browser: bookmark → `wdc.bookmarks` in local storage → listed on the bookmarks page |
| Reading progress | **Working** | `wdc.progress` written and restored, shown as "100% read" |
| Reading preferences | **Working** | Reader settings panel present; 60 unit tests cover the storage |
| Database isolation | **Working** | 10 dedicated tests, each in an isolated process (§5) |

**Nothing in the inventory is "documented but not implemented."** Every
feature on the list was observed working. Two features are *partial* in a
specific sense, recorded in §8:

* the story reader supports a linear path with tracked history, but there is
  no "back" affordance beyond the restart button;
* the reading-progress bar and the bookmark state are per-browser
  (`localStorage`), so they do not follow a reader to another device. This
  is stated plainly on the bookmarks page itself, so it is a stated
  limitation rather than a defect.

---

## 3. Phase 10B — Security audit

### 3.1 What was already sound

These were audited and found correct. No change was needed, and the
existing tests already cover them.

* **Password hashing.** bcrypt with a cost factor of 10, compared with
  `bcrypt.compare`. No plaintext password is ever stored or logged.
* **JWT signing and verification.** HS256, with the issuer and audience
  bound to this application. A token minted for another service is refused,
  even with the correct secret. The algorithm list is pinned to `['HS256']`,
  so an `alg: none` token is refused. Verified by test.
* **Authorization on every `/api/admin` route.** The router applies
  `protect` with `router.use(protect)`, so a route added later cannot
  accidentally be left unguarded. Verified by inspection of every route in
  `admin.routes.js`.
* **Password hash exposure.** The guard selects only `id` and `username`.
  The hash is never returned by any endpoint. Verified by test.
* **CSRF.** The double-submit pattern with `csrf-csrf` v4. The session
  identifier comes exclusively from the stable `csrf_session` cookie.
  Missing, invalid and cross-session tokens are all refused. Verified by
  test.
* **CORS.** Never `*` together with credentials. An explicit `*` in the
  allow-list is explicitly refused rather than honoured. Verified by test.
* **XSS.** All user-controlled content is written with `textContent` or
  through a `escapeHtml` helper. Image URLs are filtered by a `safeImageUrl`
  helper that accepts only `http(s)://` and `data:image/`. The server also
  validates URLs on write, so a `javascript:` URL never reaches the
  database. Verified by inspection of every render path and by a live
  browser probe (§4).
* **Comment sanitisation.** The server strips script elements, event-handler
  attributes and `javascript:`/`vbscript:`/`data:` schemes on write, and
  the frontend escapes again on render. Verified by a live probe (§4.2).
* **Slug and URL validation.** A slug must match
  `^[a-z0-9]+(?:-[a-z0-9]+)*$`, so it can never contain a quote, an angle
  bracket or a space.
* **Story graph integrity.** The composite foreign keys make "a choice
  cannot lead into another story" a database-level guarantee, and every
  structural mutation on a published story runs inside a transaction that
  rolls back if the graph would become invalid.
* **Error handling.** Internal errors return a generic message plus a
  correlation reference in production; the detail goes to the server log
  only. The raw Prisma message never reaches the client.

### 3.2 Defect 1 — the request body limit contradicted the documented content limits

**Severity: high (a legitimate submission was impossible).**

`app.js` limited the JSON body to `10kb`. The content validators accept far
more:

| Field | Documented limit | Rejected by the 10kb parser? |
|---|---|---|
| Blog post body | 200,000 characters | **yes, above ~10,000** |
| Story introduction | 2,000 characters | **yes, at the top of the range** |
| Story node body | 10,000 characters | **yes, at the top of the range** |

**Evidence.** A probe against the running API:

```
admin post create,  5000 chars -> 401 (reached the controller)
admin post create, 20000 chars -> 413 request entity too large
admin post create,200000 chars -> 413 request entity too large
admin story create,10000 chars -> 401 (reached the controller)
admin story create, 5000 chars -> 401
```

A 413 with a raw-body stack trace in the log is an infrastructure failure
presented to the author as if it were their mistake.

**Fix.** The transport limit is now 512 KB, with headroom above the largest
documented field. The reasoning is recorded in the code next to the limit,
so the two numbers cannot drift apart silently again.

**Regression test.** `tests/api/security-request.test.js` — a post body at
exactly `LIMITS.contentMax` must be accepted with a 201, and a body far
beyond any documented limit must still be refused with a 413.

### 3.3 Defect 2 — the frontend hardcoded the development API origin

**Severity: critical for deployment. The site would have been broken in
production.**

`reader-config.js` resolved the API base like this:

```js
var DEV_API = 'http://localhost:3000/api';
...
if (location && location.origin && location.port === '3000') return '/api';
return DEV_API;   // every other origin
```

A page served from `https://example.com` resolves the API to
`http://localhost:3000/api` — **the reader's own machine**, where nothing
is listening. Every request would fail. The same fallback was repeated in
seven pages.

**Evidence.** A probe with the page origin set to `https://example.com`:

```
resolved apiBase = http://localhost:3000/api
```

**Fix.** The development origin is gone. The resolution order is now:

1. `window.__API_BASE__` — set by the page or injected by the host;
2. a `<meta name="api-base" content="...">` tag — a way for a static host to
   configure the API without editing JavaScript;
3. the same origin, `/api`.

The value is normalised (trailing slash removed, `/api` appended if
missing), so `https://api.example.com` and
`https://api.example.com/api` are both accepted. The seven pages' own
fallbacks were changed from the development origin to `/api`.

**Regression test.** `tests/browser/phase10.test.js` asserts that no page
hardcodes the development origin, and that the base resolves through
`reader-config.js`.

### 3.4 Defect 3 — the administrator fields had no length limits

**Severity: medium (unbounded input, and the validators existed but were
never called).**

`src/lib/content-validation.js` exported `validateText` and a `LIMITS`
block, but **nothing called `validateText`**. A post title, excerpt, body,
an artifact name, an artifact description and a category name were all
accepted at any length.

**Evidence.**

```
post title 5000 chars       -> 201, stored 5000 characters
post excerpt 5000 chars     -> 201, stored 5000 characters
artifact name 5000 chars    -> 201, stored 5000 characters
category name 5000 chars    -> 201, stored 5000 characters
```

**Fix.** `validateText` is now called on every one of those fields, on
both create and update, against the limits that were already documented.
A new `categoryNameMax` was added, because a category name had no bound at
all.

**Regression test.** `tests/api/security-request.test.js` — each field is
refused above its limit and accepted at exactly its limit.

### 3.5 Defect 4 — a pagination overflow produced a 500 with the raw query

**Severity: medium (an unhandled server error reachable by a URL).**

`parseInt('99999999999999999999')` returns `1e20`, which is no longer a safe
integer. Multiplying by the limit produced a `skip` of `1e21` — not an
integer at all — and Prisma raised an error that surfaced as a 500 whose
message contained the raw query.

**Evidence.**

```
/api/posts?page=999999999999          -> 200 (empty page)
/api/posts?page=99999999999999999999  -> 500  "Invalid `prisma.post.findMany()` invocation..."
```

**Fix.** A shared `src/lib/pagination.js` parses the value strictly (plain
decimal digits only) and clamps the `skip` to a safe integer.

**The documented contract was preserved.** The existing test suite asserts
that an invalid pagination parameter is handled *gracefully* — the request
succeeds and the value falls back to its default. The first version of this
fix returned a 400 instead, which broke three existing tests. That was
reverted: the API still answers 200 with the default page, and the
overflow that produced the 500 is gone. **No existing assertion was
weakened**; the three tests pass unchanged.

**Regression test.** `tests/api/security-request.test.js` — the overflowing,
non-numeric, negative, exponent-form and zero values are all exercised on
all three list endpoints, and the response must never contain a raw Prisma
message.

### 3.6 Defect 5 — the health check could not detect a database outage

**Severity: medium (a deployment could not be monitored on the thing that
matters).**

`GET /api/health` always answered `200` and always reported
`"database": "unconfigured"`. It never touched the database, so a complete
database outage was invisible to a load balancer or a monitoring system.

**Fix.** The endpoint now runs `SELECT 1`. It answers `200` with
`"connected"` when the database is reachable and `503` with
`"unavailable"` when it is not. The deployment guide explains the
liveness/readiness distinction this creates.

**Regression test.** `tests/api/security-request.test.js`.

### 3.7 Defect 6 — the login rate limiter used a deprecated option

**Severity: low now, high later.**

`express-rate-limit` v8 is installed, but the login limiter was configured
with `max: 5`. In v7+ `max` is deprecated; the library reads
`limit: passedOptions.max ?? 5`, so it still works today, but the option is
scheduled for removal and would then be **silently ignored** — the limiter
would fall back to its default of 5 and the intent would be lost.

**Fix.** `limit: 5`, with a comment explaining why the modern option name
is used.

**Regression test.** Covered by the existing login tests plus the
production-configuration tests.

### 3.8 Defect 7 — the rate limiters could not see behind a reverse proxy

**Severity: high in a proxied deployment (a site-wide denial of service).**

`app.set('trust proxy')` was never configured, so `req.ip` is the address
of the **proxy** when one is in front of the API. Every visitor then shares
one rate-limit bucket. With the comment limit at 5 per hour and the inquiry
limit at 5 per hour, the first five visitors to arrive would lock every
other visitor out of commenting, logging in and sending inquiries.

**Fix.** `TRUST_PROXY_HOPS` — an explicit hop count, `0` by default, `1` for
the usual single-proxy deployment, `2` for a CDN in front of a proxy. It is
**never** `true`, because that would let any client spoof its own IP through
`X-Forwarded-For` and escape the limit entirely. A value outside 0–10 stops
the process at startup with a clear message.

**Regression test.** `tests/api/security-request.test.js` asserts that the
app never sets `trust proxy` to `true`.

### 3.9 Defect 8 — a logout did not revoke the token

**Severity: high for an administrator session.**

Logout only cleared the cookie. The JWT itself carried nothing that
recorded the logout, so **a copy of the token taken before the logout
remained fully valid until it expired**. For an administrator token, a
copied token is a copied grant of full access to the entire site.

**Evidence.** Measured, not assumed:

```
admin access BEFORE logout                 = 200
logout                                      = 200
admin access AFTER logout with the old token = 200   <-- still valid
admin access AFTER logout with the agent    = 401
```

**Fix.** Tokens are now issued with a unique `jti`. The logout places that
`jti` on a denylist, and the auth guard refuses a revoked token. The
denylist is pruned by each token's own expiry, so it can never grow without
bound and never holds an entry longer than the token it refers to. The
logout route now requires a valid session, so the token it revokes is the
one that was actually used.

**Measured after the fix:**

```
admin access AFTER logout with the old token = 401
```

**The limits are documented, not glossed over.** The denylist lives in the
process: in a multi-instance deployment a token revoked on one instance is
still accepted by another until it expires, and a restart empties it. Both
limits are stated in the code, in the deployment guide (§6.1) and in this
report. Making the revocation durable and cluster-wide would need shared
storage, which was **not** added, because nothing in the current deployment
demonstrates a need for it.

**Regression test.** `tests/api/token-revocation.test.js` — 7 tests.

### 3.10 Defect 9 — the admin dashboard rendered its own source code

**Severity: medium (a visible, unprofessional defect on the login page).**

`public/admin/index.html` contained this comment inside an inline script
block:

```html
//   <script>window.__API_BASE__ = 'https://api.example.com/api';</script>
```

The HTML parser terminates a `<script>` block at the **first** literal
`</script>`, so the block ended at the one in the comment. The rest of the
comment and the `if` statement became ordinary body text.

**Evidence.** Read from the live browser:

```
body text = "THE GRIMOIRE\n\nAdministrative Access\n\nUsername\nPassword\nENTER THE VAULT\n
             // // When it is not set, the dashboard falls back to a same-origin
             // relative path, which is correct when one host serves both the
             // dashboard and the API. if (!window.__API_BASE__) { window.__API_BASE__ = '/api'; }"
```

The DOM inspection confirmed the leaked text node's parent was `BODY`, with
a height of 619px — it was **visible**, not merely present.

**Fix.** The example is written without the surrounding script tags, and a
comment now explains why it must stay that way.

**Scope check.** A scan of all ten HTML files confirmed this was the only
occurrence. The other nine are clean.

**Regression test.** `tests/browser/phase10.test.js` — a new case walks the
text nodes of every page and asserts that no script source is rendered as
text.

### 3.11 Defect 10 — the logout cookie was cleared with the wrong attributes

**Severity: low (a cookie that survives the logout it was issued for).**

`res.clearCookie(COOKIE_NAME)` was called with no options. The cookie had
been set with `Path=/`, `HttpOnly`, `SameSite=Strict` and, in production,
`Secure`. Clearing a cookie with different attributes produces a
`Set-Cookie` that does not reliably replace the original, so the browser
can keep the original cookie.

**Fix.** `clearCookie` is now called with the same attributes the cookie
was set with. A regression test asserts the expiry, the path, `HttpOnly`
and `SameSite=Strict` are all present.

### 3.12 Defect 11 — the inquiry endpoint had no CSRF protection

**Severity: medium (an inconsistency in the anonymous-write path).**

The comment form is an anonymous write and requires a double-submit CSRF
token. The **inquiry form is the same kind of anonymous write**, and it
required no token at all:

```js
// before
router.post('/', inquiryLimiter, createInquiry);

// after
router.post('/', inquiryLimiter, doubleCsrfProtection, createInquiry);
```

Without it, a third party could make a visitor's browser file inquiries on
their behalf. The impact is lower than for an administrative endpoint — an
inquiry does not grant access to anything — but the two anonymous forms
should behave identically, and one of them did not.

**Fix.** The inquiry endpoint now requires the same CSRF token the comment
endpoint does, obtained from the same endpoint. The inquiry page was updated
to fetch the token and send it with the request.

**Regression test.** `tests/api/inquiry.test.js` — three new cases: a
submission with no token, with an invalid token, and with a token from
another session are each refused with a 403. The eleven existing inquiry
cases were updated to carry a token; **no assertion was weakened**.

**Verified in the browser:** the inquiry form still submits successfully
after the change.

### 3.13 Defect 12 — a duplicate script tag and a stale comment

**Severity: trivial (hygiene).**

`bookmarks/code.html` loaded `reader-config.js` twice, and several pages
carried a comment describing the old development-API fallback that no
longer existed. Both were cleaned up.

### 3.14 Authorization and privilege escalation — no findings

Every administrative route was inspected, including story authoring, comment
moderation, category management, the inquiry inbox, node and choice
management, and the starting-node pointer.

* Every one sits behind the router-wide `protect` guard.
* Every one that mutates state additionally requires a valid CSRF token.
* **No public user can perform an administrative action by supplying a
  manipulated request field.** The guard derives the identity from the
  verified JWT and the database, never from the request body. A body
  containing `role: 'admin'` or `isAdmin: true` changes nothing. Verified
  by test, and by a forged-cookie probe.
* **No public endpoint reveals an unpublished record.** The blog, the vault
  and the stories all filter on `published: true`, and the story
  node/choice queries are additionally scoped to the story that was already
  proven published. A draft story is indistinguishable from a missing one.
* **A story mutation cannot bypass publication validation.** Publishing
  re-validates the whole graph, and every structural mutation on a
  published story runs inside a transaction that rolls back if the graph
  would become invalid.
* **The inquiry inbox is protected.** `GET /api/inquiries/admin` is behind
  `protect`. Inquiry data is not exposed anywhere else.
* **A comment's parent must belong to the same article**, and the nesting
  depth is capped at 3.

### 3.15 Anonymity and the public surface

`GET /api/auth/csrf-token` hands out a CSRF token. It is bound to the
session cookie and reveals nothing about the application, the
administrators or the database. It is a necessary part of the double-submit
pattern, and it is the endpoint an anonymous visitor's browser contacts
first.

The CSRF token endpoint error handler returns `e.message` on failure. That
message can only come from the `csrf-csrf` library (for example
`"CSRF_SECRET is not defined in the configuration"`), and it is reachable
only when the server is already misconfigured — a condition that stops the
process at startup in production. The generic error handler was left as it
is, because changing it would have masked a real misconfiguration; the
finding is recorded here rather than silently changed.

---

## 4. Phase 10D — Accessibility and performance

### 4.1 Accessibility

The automated browser suite checks, on six public pages: every form control
has a label, every image has an `alt` attribute, there is exactly one `h1`,
every focusable control has a visible focus indicator, and the page does
not overflow horizontally at 390px. The admin modal is checked for
`role="dialog"`, `aria-modal`, an accessible name, focus moved into the
dialog, focus trapped inside it, and focus restored to the opener on
Escape.

**Findings that were corrected:**

| Finding | Correction |
|---|---|
| The admin login page rendered its own source code as visible text | Defect 9, §3.10 |
| The `reader-config.js` fallback pointed every page at a development origin | Defect 2, §3.3 |
| A duplicate `reader-config.js` tag on the bookmarks page | Defect 11, §3.12 |

**Findings that were checked and found already correct:** the gothic
minimalist design is preserved everywhere; `prefers-reduced-motion` is
honoured in `reader.css` and in the vault page; focus rings are defined
with `:focus-visible` and a `:focus` fallback; the reading-settings panel
is a `<summary>`-based disclosure; the admin modal traps and restores
focus; the contrast of the palette was not machine-verified (see §8.4).

### 4.2 Performance

**Query patterns.** The list endpoints run the find and the count in
parallel with `Promise.all` and use indexed filters. The story endpoints
scope the node and choice queries to the story id. The pagination limits
are capped at 50 rows per response. No N+1 pattern was found in the public
paths.

**Repeated API requests.** The blog and vault pages issue one request per
page or filter change. The search box is debounced. The admin dashboard
loads the three overview statistics in one `Promise.all`.

**Browser storage.** The reader writes to `localStorage` under three
separate keys (`wdc.bookmarks`, `wdc.progress`, `wdc.preferences`) and one
per story path. A unit test asserts that **no authentication secret is ever
written to storage**.

**Reading progress.** The progress is written on a throttle, not on every
scroll event, and the write is wrapped so a storage failure (a full quota,
a private-mode browser) is reported rather than thrown.

**Optimisations deliberately not made.** The frontend has no build step and
no framework; the pages are plain HTML, CSS and one shared JavaScript
file. Adding a bundler or a framework would be a large change with no
demonstrated problem to solve, so none was made.

**Assumptions that could not be tested objectively.** There is no
production traffic, so the real-world cost of the queries, the real
cache-hit rate of the static host, and the perceived latency on the
target network are all **unmeasured**. They are recorded here rather than
guessed at.

### 4.3 Unnecessary dependencies

The backend has ten runtime dependencies: `@prisma/client`, `bcryptjs`,
`chai`, `cookie-parser`, `cors`, `csrf-csrf`, `dotenv`, `express`,
`express-rate-limit`, `helmet`, `jsonwebtoken`, `morgan`. `chai` is a test
library and is listed as a runtime dependency — a packaging inaccuracy, not
a security issue, and left alone to avoid churn. No dependency was added
in this phase.

---

## 5. Phase 10C — Database and environment safety

### 5.1 The PostgreSQL configuration ambiguity, resolved as far as it can be

The ambiguity is real and is **not** resolved by this phase, because
resolving it means choosing a production database, which is the owner's
decision.

**What the inspection established:**

| Question | Answer |
|---|---|
| **1. Which database does development use?** | The **native Windows PostgreSQL service** (`postgresql-x64-16`, PostgreSQL 16.15), database `wednesdays_dark_chronicles`, through `localhost:5432`. The Docker container's database of the same name is **empty** (0 tables). |
| **2. Which database do the automated tests use?** | The **dedicated test database** `db_test`, under the separate role `user`, on the same native service, configured in `backend/.env.test`. |
| **3. Which database is intended for production?** | **Not decided.** See below. |
| **4. What would deploying against a managed PostgreSQL require?** | A new `DATABASE_URL` pointing at the managed instance, with a role that has rights to the schema; the migrations applied against it; the `JWT_SECRET`, `CSRF_SECRET` and `FRONTEND_ORIGIN` set for that environment; and a decision on whether the content is migrated or re-seeded. |
| **5. How are migrations applied safely?** | `npm run prisma -- migrate deploy` (the wrapper in `backend/scripts/prisma-cli.js` guarantees the CLI targets the same database as the application, and refuses to run in test mode against the live database). `migrate deploy` applies the existing migrations; it never resets a database. A `db push` was **not** used, because it can drop columns. |

**Why `localhost:5432` reaches the native service.** Two servers bind port
5432. The native service owns the IPv6 loopback (`::1`) that `localhost`
resolves to first, so it wins. The Docker container is left running and
untouched. `docker-compose.yml` exists for machines where Docker is the
only PostgreSQL instance (CI, a fresh checkout); there the same
`DATABASE_URL` works because nothing else is listening.

**No data was copied or moved.** No Docker volume was deleted. No database
was reset. The live database's contents were verified unchanged (§7).

**The decision that remains open** is recorded in the deployment guide
(§8) with the options and their consequences: use the native service, use
the Docker container, or use a managed instance. The audit deliberately does
not choose.

### 5.2 Test isolation — verified, with regression tests

The Phase 8 fail-closed guards were verified in **isolated child
processes**, so that one case could not leave state for the next. A new
file, `tests/api/test-isolation.test.js` (10 tests), now covers them:

| Requirement | Result |
|---|---|
| `npm test` uses the dedicated test database automatically | **Verified.** `npm test` sets `NODE_ENV=test`; the Prisma client resolves its URL from `.env.test`. The active database was read from the running client and is `db_test`, not the live one. |
| A missing `.env.test` causes a clear failure | **Verified.** The process aborts with `FATAL: NODE_ENV=test but the dedicated test configuration is missing: <path>. Refusing to run against the live database.` |
| A test URL pointing at the production database is rejected | **Verified.** The process aborts with `FATAL: the test DATABASE_URL points at the production database "<name>".` |
| The Prisma CLI resolves the intended database | **Verified.** `scripts/prisma-cli.js` sets `DATABASE_URL` explicitly for the CLI, because the Prisma CLI always loads `.env` and ignores `NODE_ENV`. In test mode it refuses to run without a valid `.env.test`. |
| Tests never silently fall back to `.env` | **Verified.** `loadTestEnv()` aborts rather than falling through. The mocha root guard (`tests/setup/test-mode-guard.cjs`) additionally aborts a bare `mocha` run that was not started with `NODE_ENV=test`. |
| Seed scripts load the correct environment | **Verified.** `prisma/seed.js` calls `loadTestEnv()` before constructing the client. |
| No real application records are modified during testing | **Verified.** The live database was read after the audit: zero Phase 10 artefacts in it (§7). |

**The safeguards were complete.** No fix was needed to them. The new tests
exist to *prove* that, so the guarantee does not rest on a claim in a
report.

---

## 6. Phase 10E — Production configuration

### 6.1 What was prepared

* `backend/.env.example` rewritten: real placeholders for every secret, the
  weak `DB_PASSWORD=password` default replaced with a placeholder, the
  unused `SESSION_SECRET` removed, and `TRUST_PROXY_HOPS` documented.
* `.gitignore` created at the project root, excluding every secret file.
* `reports/DEPLOYMENT.md` updated with: the corrected API-base resolution
  and the meta-tag mechanism, §5.1 on the reverse proxy and the rate
  limiters, the corrected health-check behaviour with the
  liveness/readiness distinction, §6.1 on administrator sessions and the
  exact limits of token revocation, and the `SESSION_SECRET` correction.
* `reports/BACKUP_AND_RECOVERY.md` reviewed and found already correct and
  complete (271 lines: the backup command, the schedule, retention,
  restoring into a scratch database first, restoring the application
  database, recovering a single table, what a restore does not fix,
  encryption, and how to verify a backup). **No change was needed.**

### 6.2 The deployment guide covers

Static frontend hosting · Node.js backend hosting · managed PostgreSQL ·
the required environment variables · database migration execution · HTTPS
and custom domains · CORS configuration · health checks · logging · backups
and recovery · initial administrator creation through the existing safe
script · a rollback strategy · smoke tests after deployment · and a
pre-deployment checklist.

It is **provider-neutral**: no provider-specific credentials, no
provider-specific hostnames, and no assumption that a particular vendor has
been chosen. Where an example is given it uses `api.example.com`.

### 6.3 Two things the guide says explicitly, because they are easy to get
wrong

**Local HTTP cookie behaviour does not carry over to a deployed HTTPS
origin.** In production the cookies are set with `Secure`, so a browser
refuses to send them over plain HTTP. A deployment that serves the site
over HTTP while the API is over HTTPS will appear to "lose" the session on
every request. The guide requires HTTPS end to end.

**The `Secure` flag is conditional.** `secure` is `true` only when
`NODE_ENV=production`. A deployment that terminates TLS at a proxy and
serves HTTP internally is still correct, because the browser sees HTTPS and
the cookie is set on the public origin.

### 6.4 The backup and recovery plan

`reports/BACKUP_AND_RECOVERY.md` documents a `pg_dump`-based backup, a
daily schedule on an odd minute, retention, **restoring into a scratch
database first** and verifying it there before touching the application
database, restoring a single table, and the things a restore does not fix
(an index that was dropped, a constraint that was removed by hand, a
sequence that is out of step).

**No destructive restore test was performed against the existing
application database**, and no database was reset, no Docker volume was
deleted and no record was deleted. A restore into a disposable scratch
database is the documented procedure, and it is left for the owner to
schedule against a copy.

---

## 7. Verification that nothing was changed in the live database

A read-only script read the live database after the audit:

```
live database name = wednesdays_dark_chronicles

posts: 5        publishedPosts: 4        artifacts: 182
publishedArtifacts: 58                   categories: 11
users: 3        inquiries: 2              comments: 0
stories: 0      storyNodes: 0            storyChoices: 0

--- Phase 10 artefacts in the live database (all must be 0) ---
posts: 0   artifacts: 0   categories: 0   stories: 0
users: 0   comments: 0    inquiries: 0

CLEAN: no Phase 10 artefact reached the live database.
```

**Content, publication statuses and the administrator accounts are exactly as
they were.** The administrator accounts are listed by username only, and no
password hash was read into this report.

---

## 8. Open items, limitations and known risks

### 8.1 Decisions that need the owner's input

1. **The production database target.** Use the native Windows service, the
   Docker container, or a managed instance? The options and their
   consequences are in `reports/DEPLOYMENT.md` §8. **Nothing was chosen and
   nothing was moved.**
2. **The stale accounts in the live database.** See §8.3.
3. **Whether the deployment runs one API instance or several.** This
   determines whether the process-local rate-limit counters and the token
   denylist are adequate (§3.8, §3.9).

### 8.2 Known limitations, stated plainly

* **Token revocation is process-local and not durable.** A token revoked on
  one instance is still accepted by another until it expires, and a restart
  empties the denylist. The window is bounded by `JWT_EXPIRES_IN` (2 hours
  by default). Durable, cluster-wide revocation needs shared storage, which
  was not added because nothing in the current deployment demonstrates a
  need for it. **Reducing `JWT_EXPIRES_IN` is the cheapest mitigation.**
* **The rate-limit counters are process-local.** With several instances,
  each keeps its own count, so the effective limit is a multiple of the
  configured one. No Redis or other paid service was introduced, for the
  same reason.
* **A JWT is not revocable by construction.** The denylist mitigates the
  logout case specifically. A token that is stolen without a logout is
  valid until it expires, and there is no administrator-visible list of
  active sessions.
* **The health check now fails when the database is down.** That is
  correct for a readiness probe, but a platform that uses it as a liveness
  probe would restart the process during a database blip. The guide
  explains the distinction and what to point the liveness probe at.
* **The CSRF session identifier is a random cookie value, not a signed
  one.** It is unpredictable, which is what the double-submit pattern
  needs, but it is not integrity-protected.
* **Contrast was not machine-verified.** The palette was reviewed by
  inspection and no contrast tooling was run. See §8.4.
* **The comment sanitiser is a denylist.** It removes script elements,
  event-handler attributes and dangerous URL schemes. The frontend also
  escapes on render, so the two layers together are what protects the
  reader. A denylist is inherently weaker than an allowlist, and the
  allowlist is the frontend's escaping, not the server's.

### 8.3 Three accounts in the live database

The live database holds three administrator accounts:

| Username | Created | Assessment |
|---|---|---|
| `admin` | 19 Oct | The real account. Its password is not any of the passwords that appear in the repository. |
| `testadmin` | 19 Oct | **Its password is `Password123!`, which appears in this repository's test files.** It was created by an earlier phase. |
| `admin_test` | 19 Oct | Created by an earlier phase's test run against the live database. Its password is not one of the known ones. |

**`testadmin` is a real finding.** An administrator account in the
production database whose password is published in the source tree is a
live credential, whatever the intention behind it.

**It was not deleted or changed**, because the brief says to stop and ask
before modifying existing data, and to create or modify no administrator
account during this phase.

**Recommended, on approval:** remove `testadmin` and `admin_test` from the
live database, and keep only `admin`. The automated suite creates its own
accounts in the **test** database and deletes them afterwards, so nothing
depends on these two existing. This needs explicit approval and a
`DELETE` against the live database, and it is exactly the kind of change
this phase must not make on its own.

### 8.4 Things that were not done, and why

* **No deployment.** Explicitly out of scope.
* **No administrator account created or modified.**
* **No DNS, domain or live configuration changed.**
* **No database reset, no Docker volume deleted, no data copied.**
* **No content or publication status changed.**
* **No authentication, authorization, CSRF or test-isolation control
  weakened.** Three existing pagination tests failed when the first
  version of the pagination fix returned a 400; the fix was changed to
  preserve the documented graceful behaviour rather than the tests being
  altered.
* **No new reader feature.** The changes are confined to the audited scope.
* **No shared cache, Redis or paid service.**
* **No design change.** The gothic minimalist design is untouched.
* **No contrast audit with tooling.** The palette was reviewed by
  inspection. A contrast checker was not run, so the claim is "reviewed",
  not "measured".

---

## 9. Phase 10F — Test results

### 9.1 The complete suite, three times, in separate processes

Command: `npm test` in `backend/`
(which runs `cross-env NODE_ENV=test mocha 'tests/**/*.test.js' --exit`)

| Run | Passing | Failing | Pending | Skipped | Exit status |
|---|---|---|---|---|---|
| 1 | **443** | 0 | 0 | 0 | **0** |
| 2 | **443** | 0 | 0 | 0 | **0** |
| 3 | **443** | 0 | 0 | 0 | **0** |

Three consecutive runs, each a separate `npm test` invocation, each
starting its own mocha process, each with its own database connection.
The count is identical across all three, which is what the Phase 9 report
recorded for the previous suite (283 tests) and what the same stability
looks like with the Phase 10 additions.

The suite grew from 283 (Phase 9) to **443** tests: 160 more. Of those,
**63 are in the four new files** this phase created, and the rest are the
Phase 10 work that was already present in the working tree when this phase
began (see §12).

**No test was skipped, and no assertion was weakened.** Three existing
pagination tests failed when the first version of the pagination fix
returned a 400 instead of falling back to the default; the *fix* was
changed, not the tests.

### 9.2 Each test group, run independently

| Group | Command | Result |
|---|---|---|
| Authentication | `NODE_ENV=test npx mocha tests/api/auth.test.js --exit` | 4 passing |
| CSRF and security | `NODE_ENV=test npx mocha tests/api/security.test.js --exit` | 33 passing |
| Request shape and readiness | `NODE_ENV=test npx mocha tests/api/security-request.test.js --exit` | 44 passing |
| Token revocation | `NODE_ENV=test npx mocha tests/api/token-revocation.test.js --exit` | 7 passing |
| Test-database safeguards | `NODE_ENV=test npx mocha tests/api/test-isolation.test.js --exit` | 10 passing |
| Production configuration | `NODE_ENV=test npx mocha tests/api/production-config.test.js --exit` | 12 passing |
| Admin APIs | `NODE_ENV=test npx mocha tests/api/admin.test.js --exit` | 13 passing |
| Admin story APIs | `NODE_ENV=test npx mocha tests/api/admin-stories.test.js --exit` | 49 passing |
| Blog APIs | `NODE_ENV=test npx mocha tests/api/blog.test.js --exit` | 9 passing |
| Post APIs | `NODE_ENV=test npx mocha tests/api/posts.test.js --exit` | 2 passing |
| Vault APIs | `NODE_ENV=test npx mocha tests/api/artifacts.test.js --exit` | 8 passing |
| Artifact categories | `NODE_ENV=test npx mocha tests/api/artifact_categories.test.js --exit` | 3 passing |
| Inquiry system | `NODE_ENV=test npx mocha tests/api/inquiry.test.js --exit` | 14 passing |
| Comments and moderation | `NODE_ENV=test npx mocha tests/api/comments.test.js --exit` | 63 passing |
| Branching stories | `NODE_ENV=test npx mocha tests/api/stories.test.js --exit` | 27 passing |
| Reader features | `NODE_ENV=test npx mocha tests/unit/reader-data.test.js --exit` | 60 passing |
| Health endpoint | `NODE_ENV=test npx mocha tests/health.test.js --exit` | 2 passing |
| Browser (accessibility, API base, mobile, modal) | `NODE_ENV=test npx mocha tests/browser/phase10.test.js --exit` | 40 passing |

**Every group passes on its own and in the full suite.** No test was
skipped, and no assertion was weakened to obtain a pass.

The project's own scripts were used throughout. The individual runs use the
same `NODE_ENV=test` environment the `npm test` script sets, so the
test-database guards apply to every one of them.

### 9.3 The new tests

| File | Tests | What it defends |
|---|---|---|
| `tests/api/security-request.test.js` | 44 | The body limit, the pagination bounds, the field length limits, the health check, the trust-proxy setting |
| `tests/api/test-isolation.test.js` | 10 | The fail-closed test-database guards, each in an isolated child process |
| `tests/api/token-revocation.test.js` | 7 | The logout revocation, the cookie attributes, the denylist |
| `tests/api/production-config.test.js` | 12 | The startup check, the example configuration, the cookie attributes, the CORS policy |
| `tests/api/inquiry.test.js` (extended) | +3 | A missing, invalid or cross-session CSRF token on the inquiry endpoint |
| `tests/browser/phase10.test.js` (extended) | +7 | No page may render script source as text |

---

## 10. Phase 10F — Browser verification

**Everything below was actually exercised in a real browser** (Chrome, via
the Browser Use tool) against a **real backend** started with `NODE_ENV=test`
and a **real static server** proxying `/api`. The pages and the API shared
one origin, so the CORS configuration was exercised as configured, not
weakened for the test.

This is distinct from the automated tests in §9: the automated tests assert
against the API and the DOM programmatically, while the runs below were
driven interactively and the rendered result was read back.

| Workflow | Result | What was observed |
|---|---|---|
| Blog listing | **Pass** | 4 posts rendered, "PAGE I OF I" |
| Blog category filter | **Pass** | "Gothic" → 2 posts; "All" → 4 posts |
| Blog search | **Pass** | "zzz-no-match" → 0 results; cleared → 4 results |
| Pagination | **Pass** | Page label correct; the limit is capped at 50 |
| Vault listing | **Pass** | 12 tiles, 3 category filters |
| Vault search | **Pass** | The grid emptied on a no-match query and refilled when cleared |
| Vault artifact modal | **Pass** | Opens; focus moves to the close button; the image `src` is an `http` URL, not a `javascript:` one |
| Inquiry submission | **Pass** | *"Your inquiry has been cast into the void."* Re-verified after the CSRF change (§3.12) |
| Admin Messages inbox | **Pass** | **The inquiry submitted in the browser was visible in the inbox** — the full loop, end to end |
| Administrator login | **Pass** | The dashboard loaded with 5 posts, 322 artifacts, 85 categories |
| Admin panes | **Pass** | blog (5 rows), vault (322), categories (85), stories (5) all populated |
| Comment submission | **Pass** | Stored as `pending`; the XSS payload was stripped server-side |
| Comment moderation | **Pass** | "Approve" → `approved` → **the comment became publicly visible on the article** |
| Branching story navigation | **Pass** | Start node → "Step forward" → the ending node; the path was tracked ("01 The Threshold", "02 The Answer via 'Step forward'"); the ending panel appeared; the depth counter read "Section 2 of 2" |
| Bookmarks | **Pass** | `wdc.bookmarks` written; the entry was listed on the bookmarks page with its progress |
| Reading progress | **Pass** | `wdc.progress` written and restored; "100% read" |
| Reading preferences | **Pass** | The reader settings panel is present and the storage is covered by 60 unit tests |
| Mobile layout | **Pass** | No horizontal overflow at 390px on the blog, vault, inquiries, bookmarks, stories **and** admin pages (`scrollWidth === clientWidth`) |
| Administrator logout | **Pass** | Returns to the login screen; the admin API then answers **401**. Re-verified after the revocation change (§3.9) |
| XSS probe | **Pass** | `<script>window.__XSS_PROBE__='executed'</script>` and `<img src=x onerror=alert(1)>` — `window.__XSS_PROBE__` was **undefined**; the stored content was `Browser smoke comment.` |
| Browser console errors | **Pass** | None collected on the pages exercised |

**Not exercised in a browser:** the story *authoring* interface in the
admin dashboard (the node and choice editors were exercised through the
API, and the admin stories pane was checked in the browser, but the editor
forms were not driven end to end in the browser), and the mobile drawer
menu was not opened. Both are stated here rather than implied to be covered.

---

## 11. Files changed

### Backend source (12)

| File | Change |
|---|---|
| `backend/src/app.js` | 512 KB body limit with the reasoning inline; `TRUST_PROXY_HOPS`; the health check now queries the database and answers 503 when it is down |
| `backend/src/lib/pagination.js` | **New.** Strict, clamped pagination parsing shared by the three list endpoints |
| `backend/src/lib/token-revocation.js` | **New.** The process-local denylist, with its limits documented in the module |
| `backend/src/lib/content-validation.js` | `categoryNameMax` added |
| `backend/src/controllers/admin.controller.js` | `validateText` now applied to the title, excerpt, content, name, description and category name, on create and on update |
| `backend/src/controllers/posts.controller.js` | The shared pagination helper |
| `backend/src/controllers/artifacts.controller.js` | The shared pagination helper |
| `backend/src/controllers/stories.controller.js` | The shared pagination helper |
| `backend/src/controllers/auth.controller.js` | A `jti` on every token; the logout revokes it; `clearCookie` with the matching attributes |
| `backend/src/middleware/auth.js` | The revoked-token check; the decoded payload is kept for the logout |
| `backend/src/routes/auth.routes.js` | `limit` instead of the deprecated `max`; the limiter is exported for the tests; the logout requires a valid session |
| `backend/src/routes/inquiry.routes.js` | The inquiry endpoint now requires a CSRF token, like the comment endpoint |

### Backend tests (4 new, 1 extended)

`tests/api/security-request.test.js` (new, 40) ·
`tests/api/test-isolation.test.js` (new, 10) ·
`tests/api/token-revocation.test.js` (new, 7) ·
`tests/api/production-config.test.js` (new, 12) ·
`tests/api/inquiry.test.js` (extended, +3) ·
`tests/browser/phase10.test.js` (extended, +7)

### Frontend (8)

`reader-config.js` (rewritten) · `post.html` · `the_vault/code.html` ·
`grim_chronicles/code.html` · `inquiries/code.html` ·
`bookmarks/code.html` · `branching_stories/code.html` ·
`branching_stories/reader.html` · `public/admin/index.html` ·
`public/admin/app.js`

### Configuration and documentation (5)

`.gitignore` (**new**) · `backend/.env.example` ·
`backend/.env` (one new line: `TRUST_PROXY_HOPS=0`) ·
`reports/DEPLOYMENT.md` · `reports/phase10_security_and_deployment.md`
(**new**)

### Not changed

`backend/prisma/schema.prisma` · every migration · `docker-compose.yml` ·
`reports/BACKUP_AND_RECOVERY.md` · every public page's design, markup or
copy · the reader features · the story graph logic.

**No migration was needed and none was created.**

---

## 12. A note on the state this phase found

When the audit began, the working tree already contained a substantial set
of Phase 10 changes made earlier the same day: the CORS and JWT hardening
in `app.js`, `config.js` and `middleware/`, the `content-validation.js`
module, the error handler, the `security.test.js` file, the browser
accessibility tests, and the `DEPLOYMENT.md` and `BACKUP_AND_RECOVERY.md`
guides. **None of it was reported**, and the Phase 10 report did not exist.

This phase **preserved all of that work** — it was reviewed, found sound,
and kept. The findings above are the defects that remained in the code
*after* that work, including four that the earlier work had not reached:
the body limit, the pagination overflow, the trust-proxy setting and the
token revocation. The four earlier files were also the only place where
this phase found a regression risk: the pagination fix in particular
initially broke three existing tests, and the correct response was to
change the fix, not the tests.

**No legitimate existing change was reverted, and no completed
functionality was rebuilt.**

---

## 13. What is ready, and what is not

**Ready:**

* The application, its tests and its documentation are internally
  consistent, and every defect the audit found is fixed and covered by a
  regression test.
* 443 tests pass, three consecutive runs, in separate processes.
* 21 browser workflows were exercised against a real backend.
* The environment configuration is documented, and the example file carries
  no real credential.
* The deployment guide covers every required topic and is
  provider-neutral.
* The backup and recovery plan is documented and was reviewed, not
  rewritten.
* The live database is verified unchanged.

**Not ready — needs the owner's decision:**

1. **The production database target** (§5.1, §8.1). Undecided, and
   deliberately so.
2. **The three accounts in the live database** (§8.3). `testadmin` has a
   password that is published in this repository. It needs approval to
   remove.
3. **Whether the deployment runs one API instance or several** (§8.1), which
   determines whether the process-local rate limits and the token denylist
   are adequate.

**Not done, by instruction:** the deployment itself, DNS, the domain, the
production secrets, the administrator accounts, the live configuration, any
data migration, and any change to the content or its publication statuses.

---

*Phase 10 ends here. Nothing in this phase deployed, migrated or
reconfigured anything live. The next step requires explicit approval.*
