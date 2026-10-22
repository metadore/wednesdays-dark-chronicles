# Deployment Guide — Wednesday's Dark Chronicles

**Status:** deployment configuration is prepared; no hosted service has been
created, no Neon database has been provisioned, and no data has been copied.
The owner approved migrating existing data while excluding the known test
administrator accounts. Provisioning, credential entry and the final deploy
still require access to the owner's Neon and Render accounts.

The repository includes a Render Blueprint at [`../render.yaml`](../render.yaml).
It deploys the site and API together as one web service and expects an existing
Neon PostgreSQL connection string and production secrets.

---

## 1. What has to be deployed

The site and API are served together by the Render web service. Its site
routes expose only the public pages and assets; backend files and reports are
not served.

| Piece | What it is | How it is served |
|---|---|---|
| **The site** | Static HTML/CSS/JS: the public pages, the reader features and the Grimoire dashboard | Render web service |
| **The API** | The Node.js/Express backend, which owns the database | Render web service |

**The simplest correct deployment serves both from one host**, because the
authentication cookie and the CSRF cookie are `SameSite=Strict`. Splitting
them across two origins
works but requires the configuration described in §5.

### The static site

The site root is the directory containing `post.html`, `reader-config.js`,
`grim_chronicles/`, `the_vault/`, `public/admin/`, and the rest. There is no
build step: the HTML is already written for the browser. Serve it as static
files.

Two things to preserve when serving it:

* **The directory layout.** The pages reference each other by path
  (`/post.html`, `/grim_chronicles/code.html`, `/bookmarks/code.html`), and
  `reader-config.js`, `reader-data.js`, `reader-ui.js` and `reader.css` are
  loaded from the site root. Do not flatten the directories.
* **`/reader-config.js` must be served with a JavaScript content type**, and
  must not be cached for longer than the site's other assets.

The site must **not** expose the backend's `.env` file.

The backend serves the root page, named root assets, and the site's public
directories from the repository root. It deliberately does not serve the
`backend`, `reports`, or repository metadata directories. The default page is
`/home_the_void/code.html`.

### The API

The API is a plain Node.js process:

```
cd backend
npm ci --omit=dev
npm start          # node src/index.js
```

It listens on `PORT` (default 3000), serves `/api/*` and `/api/health`, and
serves the explicitly allowed public site files from the repository root.

**It is not intended to be exposed directly to the internet.** Put it behind
a reverse proxy that terminates TLS and forwards to the process, or run it
on a platform that does the same.

---

## 2. Environment variables

The backend reads these from the process environment. On a platform that
supports environment variables, set them there; do not write a `.env` file
into the deployed directory.

| Variable | Required | Purpose | Notes |
|---|---|---|---|
| `NODE_ENV` | yes | `production` | Switches cookies to `Secure` and makes missing secrets fatal |
| `PORT` | no | Listen port | Defaults to 3000 |
| `DATABASE_URL` | yes | PostgreSQL connection string | See §3 |
| `JWT_SECRET` | yes | Signs administrator tokens | **Fatal if missing** |
| `CSRF_SECRET` | yes | Signs the double-submit CSRF token | **Fatal if missing** |
| `JWT_ISSUER` | no | Expected token issuer | Defaults to `wdc-api` |
| `JWT_AUDIENCE` | no | Expected token audience | Defaults to `wdc-admin` |
| `JWT_EXPIRES_IN` | no | Session lifetime | Defaults to `2h` |
| `FRONTEND_ORIGIN` | only for cross-origin clients | Allowed CORS origins | Comma-separated exact origins. See §5 |
| `TRUST_PROXY_HOPS` | yes, in practice | Number of trusted reverse proxies | `0` when the API is exposed directly, `1` behind one proxy. See §5.1 |
| `DB_USER` / `DB_PASSWORD` / `DB_NAME` / `DB_PORT` | no | Compose interpolation | Only used by `docker-compose.yml` |

For the same-origin Render deployment, leave `FRONTEND_ORIGIN` unset: the
browser calls `/api` on the page's own origin, and CORS is not needed for
same-origin requests. The Blueprint sets `TRUST_PROXY_HOPS=1` for Render's
reverse proxy.

### Render environment

Set these secret environment variables in Render before the first deployment:

* `DATABASE_URL` — the Neon connection string, including `sslmode=require`.
  Use the direct (non-pooler) Neon URL for Prisma migrations.
* `JWT_SECRET` and `CSRF_SECRET` — distinct random values generated with the
  command above.

The Blueprint sets `NODE_ENV=production` and `TRUST_PROXY_HOPS=1`. Its build
command installs dependencies, generates Prisma Client, and applies pending
migrations. The `/api/health` check also verifies database connectivity.
The Blueprint selects Render's free web-service plan; free instances may
sleep when idle and have a cold start on the next request. Upgrading the
service can incur charges.

> `SESSION_SECRET` was in earlier revisions of this guide but is **not used
> anywhere in the code**: the CSRF session identifier is a random cookie
> value, not a signed one. It has been removed from `.env.example`. Setting
> it is harmless but pointless, and it is one more secret to rotate.

### Generating the secrets

```
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
```

Run it **three times**, once for each secret. The values must be different
from one another and different from anything in `.env.example`.

### The production startup check

`src/config.js` validates the required secrets at load time. With
`NODE_ENV=production`, a missing `JWT_SECRET` or `CSRF_SECRET` prints

```
FATAL: Missing required production secrets: JWT_SECRET, CSRF_SECRET
```

and exits with status 1 **before the server binds a port**. A
half-configured deployment therefore fails immediately and visibly rather
than running with a guessable secret.

> **Do not copy the test secrets into production.** `.env.test` holds the
> values the automated suite uses. The two environments must not share a
> secret, a database, or a `JWT_SECRET`.

---

## 3. The database

### Which database the application talks to

`DATABASE_URL` is the single source of truth. The development `.env` points
at the **native Windows PostgreSQL service**, which holds the project's real
content. The Docker container's database is empty. See §8 and the Phase 10
report for the full picture.

**The production database target is Neon**, as requested. Provision a Neon
database before deploying the Render service.

### Connecting to a managed instance

A managed PostgreSQL service gives you a host, a port, a database name, a
user and a password. Build the connection string from them:

```
DATABASE_URL="postgresql://<user>:<password>@<host>:<port>/<database>?schema=public&sslmode=require"
```

Notes:

* **The password must be URL-encoded.** A password containing `@`, `:`, `/`
  or `#` breaks the string if it is not encoded.
* **Use `sslmode=require`** (or `verify-full`) for a managed instance. A
  local development instance usually does not need it.
* **Use a dedicated database and a dedicated role** for the application, not
  the provider's admin or superuser role.
* **Restrict the role's privileges** to the schema it owns. The application
  needs to read and write its own tables, and to create and drop objects
  during a migration, but it does not need superuser.

### Applying the migrations

Migrations live in `backend/prisma/migrations/`. They are **additive**:
each one creates tables, columns or indexes without dropping or rewriting
existing data.

```
cd backend
npx prisma migrate deploy
```

`migrate deploy` applies the pending migrations and **never** resets the
database or generates a new migration. It is the correct command for a
deployment. Do not use `migrate reset` — it drops the schema and destroys
the content.

The project also wraps the Prisma CLI in `backend/scripts/prisma-cli.js`,
which resolves the right database for the current environment. Use
`npm run prisma -- migrate deploy` if you want that behaviour.

**Order of operations for a first deployment:**

1. Create the database and the role on the managed instance.
2. Set `DATABASE_URL` and the secrets in the platform's environment.
3. Run `migrate deploy` **once**, as a release step, before the application
   starts serving traffic.
4. Start the application.
5. Create the first administrator (see §7).

Running the migration as a release step, rather than on every boot, keeps
several instances from racing to apply the same migration.

---

## 4. HTTPS and cookies

**Terminate TLS in front of the API.** The authentication cookie is set with
`Secure` when `NODE_ENV=production`, so a browser will refuse to store or
send it over plain HTTP. The site and the API must both be reachable over
HTTPS, and the redirect from `http://` to `https://` must happen before any
authenticated request.

With TLS in place, the production cookie attributes are:

| Cookie | HttpOnly | SameSite | Secure | Path |
|---|---|---|---|---|
| `auth_token` | yes | Strict | yes (in production) | `/` |
| `csrf_session` | yes | Strict | yes (in production) | `/` |
| `x-csrf-token` | yes | Strict | yes (in production) | `/` |

`SameSite=Strict` means the browser sends these cookies only for
same-site requests. **A same-site deployment is therefore the simplest and
most robust option** — the site and the API on one registrable domain, even
on different subdomains.

**A split-origin deployment needs care.** If the site is on
`example.com` and the API on `api.example.com`, that is still same-site
(SameSite is about the registrable domain, not the origin), so `Strict`
works. But if the API is on a *different* registrable domain, `Strict`
will not send the cookie and the administrator dashboard will not
authenticate. In that case `SameSite=None; Secure` would be required — and
that is a change to the code, not to the configuration, so it needs its own
approval and a re-run of the security review.

**Do not assume local HTTP cookie behaviour carries over.** On
`http://localhost` a `Secure` cookie is not required, and the browser
treats `localhost` as a secure context. A deployed site over plain HTTP
will not send a `Secure` cookie at all, and the dashboard will simply
appear to fail to log in. Test the login on the real HTTPS origin.

---

## 5. CORS

`FRONTEND_ORIGIN` is a comma-separated list of **exact origins**:

```
FRONTEND_ORIGIN="https://example.com,https://www.example.com"
```

Rules:

* **No wildcards.** `Access-Control-Allow-Origin: *` combined with
  `Access-Control-Allow-Credentials: true` is refused by browsers and would
  expose the API to every origin. The application no longer emits it: an
  unrecognised origin simply gets no CORS headers.
* **The scheme, host and port must match exactly.** `https://example.com`
  and `https://example.com:443` are different strings; list the form the
  browser actually sends.
* **An empty value means same-origin only.** That is the correct setting
  when one host serves both the site and the API.

### Pointing the site at the API

The pages find the API through `reader-config.js`, which resolves the base
URL in this order:

1. `window.__API_BASE__`, if the page set it;
2. a `<meta name="api-base" content="...">` tag, if the page has one;
3. **development only** — when the page is opened on a loopback address,
   the backend's port on the *same host name* as the page
   (`http://127.0.0.1:5500` → `http://127.0.0.1:3000/api`);
4. the relative path `/api`.

**There is no hardcoded development origin in the file.** An earlier
revision fell back to a literal `http://localhost:3000/api`, which meant a
page served from `https://example.com` sent every reader's request to
their own machine, where nothing was listening. The same-origin default
replaced it.

Step 3 is the development fallback, and it is reachable ONLY for a loopback
address. It repeats the page's own host name on purpose: the session cookie
is `SameSite=Strict`, and `localhost` and `127.0.0.1` are different
*sites* to a browser, so a page on one would receive the cookie and then
never send it back. A page on a real host never reaches step 3, so a
production deployment still falls through to the same-origin `/api` and
never points a reader at a local machine.

Step 3 is also what makes the public pages work when a static development
server serves the site on a port of its own. Without it, the relative path
`/api` points at the static server, every request 404s, and the pages
render their empty state instead of their content. Two arrangements both
work:

* the site's own `scripts/static-server.js`, which proxies `/api` to the
  backend, so the relative path is correct and step 3 never fires; or
* any plain static server, where step 3 supplies the backend's origin.

The verification below greps the served file for the literal development
origin, so the fallback must be built from the page's location at runtime
rather than written into the file.

* **Same-origin deployment:** nothing to do. The relative path is correct.
* **Split-origin deployment:** the host must supply the API origin before
  `reader-config.js` loads. Either an inline script in the page head:

  ```html
  <script>window.__API_BASE__ = 'https://api.example.com/api';</script>
  <script src="/reader-config.js?v=1"></script>
  ```

  or a meta tag, which is easier for a static host to inject or rewrite:

  ```html
  <meta name="api-base" content="https://api.example.com/api">
  ```

  Both forms are normalised: a trailing slash is removed, and `/api` is
  appended if it is missing, so `https://api.example.com` and
  `https://api.example.com/api` are both accepted.

  The Grimoire dashboard (`public/admin/index.html`) resolves its API base
  through `public/admin/api-config.js`, which follows the same order of
  preference, plus one development-only step:

1. `window.__API_BASE__`, if the page set it;
2. a `<meta name="api-base" content="...">` tag, if the page has one;
3. **development only** — when the dashboard is opened on a loopback
   address, the backend's port on the *same host name* as the page
   (`http://127.0.0.1:5500` → `http://127.0.0.1:3000/api`);
4. the relative path `/api`.

Step 3 is what makes the dashboard work when a static development server
serves it on a port of its own. It repeats the page's own host name on
purpose: the session cookie is `SameSite=Strict`, and `localhost` and
`127.0.0.1` are different *sites* to a browser, so a page on one would
receive the cookie and then never send it back. Step 3 is unreachable for a
page on a real host, so a production deployment still falls through to the
same-origin `/api` and never points an administrator at a local machine.

---

## 5.1 The reverse proxy and the rate limiters

The login, comment and inquiry rate limiters count requests **per client IP**.
Behind a reverse proxy, every request arrives with the proxy's own address,
so without a configuration change the first five visitors to arrive share
one bucket and everybody else is locked out of commenting, logging in and
sending inquiries.

`TRUST_PROXY_HOPS` tells the API how many proxies are in front of it:

| Situation | `TRUST_PROXY_HOPS` |
|---|---|
| The API is reached directly | `0` |
| One reverse proxy (nginx, a platform router) | `1` |
| A CDN in front of a reverse proxy | `2` |

It is a hop count, never `true`. Setting it to `true` would make the API
believe any `X-Forwarded-For` header it is given, and a client could then
spoof its own IP to escape the rate limit entirely. A value outside 0–10
stops the process at startup with a clear message.

**Note on the limiters themselves:** the counters live in the process, so a
deployment that runs more than one API instance gives each instance its own
count. No shared store (Redis or otherwise) is used, because the Phase 10
audit found no need to justify one.

---

## 6. Health checks and logging

### Health check

`GET /api/health` runs `SELECT 1` against the database and answers:

| State | Status | Body |
|---|---|---|
| The database is reachable | `200` | `{"status":"ok", "services":{"database":"connected"}, ...}` |
| The database is unreachable | `503` | `{"status":"degraded", "services":{"database":"unavailable"}, ...}` |

**Before the Phase 10 audit the endpoint always answered `200` and reported
`"database": "unconfigured"`,** so it could not detect a database outage at
all. It now reflects reality.

This makes it a **readiness** probe as well as a liveness probe. Use it for
both unless you would rather keep a brief database blip from taking a
healthy process out of rotation:

* **Readiness** (`/api/health`): the instance is only added to the load
  balancer while the database is reachable. Use this.
* **Liveness** (a separate, trivial endpoint): the process is restarted only
  if it is wedged. Point this at the platform's own process check instead,
  or add a `?liveness=1` variant that skips the database query.

### Logging

The application logs to stdout and stderr through `morgan` and a small
error handler. On a platform that collects stdout, that is enough: no log
file needs to be mounted, and no rotation needs to be configured.

The error handler writes a short **reference** id to the log and returns
that same id to the client. When a user reports an error, that id ties the
report to the log line without exposing the internals of the failure.

**What is not logged:** request cookies, tokens, passwords or secret
values. `morgan` is configured with the `dev` format, which logs the
method, path, status and response time — not headers. The health check
itself logs nothing.

**What a production deployment should add:** a log sink with a retention
policy. Without one, the platform's default buffer is all the history
there is.

---

## 6.1 Administrator sessions and logout

An administrator session is a JWT in an `HttpOnly`, `SameSite=Strict`
cookie, named `auth_token`, with a lifetime of `JWT_EXPIRES_IN` (2 hours by
default). The token is signed with `JWT_SECRET` and carries an issuer, an
audience and a unique identifier (`jti`).

**Logout revokes the token.** The server puts the `jti` of the token that
was used for the logout on a denylist and clears the cookie. A copy of that
token that was taken before the logout is refused from that moment on,
instead of remaining valid until it expires. This was not true before the
Phase 10 audit: the logout only cleared the cookie, and the token itself
stayed usable.

Two limits of that revocation must be known before launch:

* **The denylist lives in the process.** In a deployment that runs more than
  one API instance behind a load balancer, a token revoked on instance A is
  still accepted by instance B until it expires. The exposure window is
  bounded by `JWT_EXPIRES_IN`.
* **The denylist is not durable.** A restart empties it, so a revoked token
  becomes valid again until it expires. Nothing is written to the database,
  so no migration is required and no schema change is needed.

If the deployment needs revocation that is durable and shared between
instances, either run a single API instance or move the denylist into shared
storage. That is a decision for the owner of the deployment; the Phase 10
audit did not add a shared store, because nothing in the current deployment
demonstrates a need for one.

**Shortening `JWT_EXPIRES_IN` reduces the exposure window** of both limits
and is the cheapest mitigation if neither of the above is addressed.

---

## 7. The first administrator

The administrator account is created by the existing script:

```
cd backend
ADMIN_USERNAME=... ADMIN_PASSWORD=... node scripts/create-admin.js
```

**This script has not been run against the live database**, and it must not
be without approval.

It reads `ADMIN_USERNAME` and `ADMIN_PASSWORD` from the environment (or
from `.env`), hashes the password with bcrypt, and writes one row to the
`User` table. Run it once, after the migrations, against the production
database.

### 7.1 Resetting a forgotten password

The same script resets the password of an account that already exists:

* the username does **not** exist → the account is **created**;
* the username **does** exist → only that account's password hash is
  **replaced, in place**.

The row is never deleted and never recreated, so the account's id, its
creation date and every relationship that points at it are preserved. The
script reports which of the two happened:

```
Admin user "admin" created.
Admin user "admin" already existed; its password was reset.
```

This matters because **the application has no password-change flow.** The
bcrypt hash is one-way, so a forgotten password cannot be recovered — it can
only be replaced. This script is the supported way to do that.

**Use a long, unique password.** The script enforces a minimum of 8
characters and nothing more; there is no strength policy, and no way to
change the password later except by running this script again.

**Do not put the credentials in a `.env` file that is committed.** Pass
them on the command line, or as one-off environment variables, and let them
out of the shell history if that matters to you.

### 7.2 The accounts that are already in the database

The administrator table currently holds **three** accounts:

| Username | Assessment |
|---|---|
| `admin` | The real account. |
| `testadmin` | **Its password is `Password123!`, which appears in this repository's test files.** It was created by an earlier phase. |
| `admin_test` | Created by an earlier phase's test run. |

**`testadmin` must be removed before the site goes live.** An
administrator account whose password is published in the source tree is a
live credential, whatever the intention behind it.

The owner approved excluding both test accounts from the Neon migration.
This does not modify the local database; verify both names are absent from
Neon before enabling the Render service.

The automated suite creates its own accounts in the **test** database and
deletes them afterwards, so nothing depends on these two existing. To
remove them, against the live database:

```sql
DELETE FROM "User" WHERE username IN ('testadmin', 'admin_test');
```

**Take a backup first** (§9), and confirm the usernames before the
deletion — the `User` table is the whole administrator list, and the
application has no password-change or account-removal interface.

---

## 8. Neon migration and first deployment

The development environment has **two** PostgreSQL servers on port 5432:

1. The **native Windows service** (`postgresql-x64-16`, PostgreSQL 16.15).
   This holds the project's content: 5 posts, 182 artifacts, 11 categories
   and the administrator accounts.
2. The **Docker container** `wednesdays-db` (`postgres:16-alpine`). Its
   `wednesdays_dark_chronicles` database is **empty**.

`localhost:5432` resolves to the native service, so that is what the
development `.env` uses. The Docker container is provisioned for machines
where it is the only PostgreSQL instance (CI, a fresh checkout) and is left
running and untouched.

The owner approved migrating the existing database contents to Neon, excluding
the `testadmin` and `admin_test` rows. Do not copy the local `.env` file or
commit a database dump.

Use this order so the application is not opened to visitors before its content
is restored:

1. Create a Neon PostgreSQL database and copy its **direct** connection string.
2. Apply the checked-in schema migrations to the empty Neon database with
   `DATABASE_URL` set to that Neon connection string:

   ```
   cd backend
   npx prisma migrate deploy
   ```

3. Export the local database's data only (not its schema or Prisma migration
   history), restore it into Neon, and verify the row counts. Use PostgreSQL's
`pg_dump --format=custom --data-only --no-owner --no-acl
--exclude-table=public._prisma_migrations` and `pg_restore` with the Neon
connection string. Take care not to print either connection string in logs.
4. Before creating the public Render service, remove the two known test admin
   accounts from Neon and verify they are absent:

   ```sql
   DELETE FROM "User" WHERE username IN ('testadmin', 'admin_test');
   ```

   The published test password for `testadmin` is not safe for a public
   deployment.
5. Create a Render Blueprint deployment from `render.yaml`. Enter the Neon
   connection string as `DATABASE_URL`, and set distinct, random values for
   `JWT_SECRET` and `CSRF_SECRET`. Do not paste secrets into Git or this
   document.
6. Confirm Render reports a healthy `/api/health` check, then open the
   `onrender.com` URL and verify the homepage, content, login and admin
   dashboard.
7. If the original administrator credentials are not known or have not been
   rotated, run `backend/scripts/create-admin.js` against Neon with a new
   unique password before enabling public access.

The Render build applies migrations with `prisma migrate deploy`; it does not
reset or seed the database. Re-deploying applies only migrations that are
still pending.

---

## 9. Backups and recovery

The procedure is in [`BACKUP_AND_RECOVERY.md`](BACKUP_AND_RECOVERY.md),
next to this file. The short version:

* `pg_dump` in custom format is the primary backup.
* Back up to a separate machine or object store, not to the same disk.
* **A backup is only proven by restoring it.** Restore into a scratch
  database on a schedule and check the row counts.
* Test a restore in a disposable database first; never against the
  application database.

---

## 10. Rollback

**Code and schema are rolled back separately, and they are not symmetric.**

| Change | Rollback |
|---|---|
| Application code | Redeploy the previous version. The API is stateless apart from the database, so this is safe. |
| An additive migration | The migration is not reversed automatically. To undo it, write a new, explicit down-migration. Do not delete the migration directory — the migration history must stay consistent with the database. |
| A destructive migration | **There are none.** Every migration in this project is additive. A destructive one would need a rehearsed restore, not a rollback. |

**The migrations are additive by design.** A deployment that fails after the
migrations have been applied is rolled back by redeploying the previous
code, because the new schema is a superset of the old one.

Before applying a migration to a production database, take a backup. That
is the only rollback that works for a change that alters existing rows.

---

## 11. Smoke tests after deployment

Run these once, against the deployed origin, after every release.

```bash
# 1. The API is up.
curl -fsS https://api.example.com/api/health

# 2. The public site is served.
curl -fsSI https://example.com/post.html

# 3. The public API returns content.
curl -fsS https://api.example.com/api/posts?limit=1

# 4. The CSRF endpoint hands out a token.
curl -fsS https://api.example.com/api/auth/csrf-token

# 5. An administrative endpoint refuses an unauthenticated request.
#    It must answer 401, never 200 and never 500.
curl -s -o /dev/null -w '%{http_code}\n' https://api.example.com/api/admin/posts

# 6. The health check reports the database as connected.
#    It must answer 200 and say "connected". A 503 means the API cannot
#    reach the database.
curl -fsS https://api.example.com/api/health

# 7. The site finds the API. The page must not contain a hardcoded
#    development origin, and the resolved base must be the deployed one.
curl -fsS https://example.com/reader-config.js | grep -c 'localhost:3000'
#    Must print 0.
```

Then, in a browser:

8. The blog lists published entries and the search filters them.
9. An article opens, and the comment thread renders.
10. **A comment can be posted.** This is the step that fails if the CSRF
    token is not being sent, and it fails silently in the other direction
    too: the comment form and the inquiry form both post with a token, so a
    missing token shows up as a 403 in the browser's network tab.
11. **An inquiry can be sent**, and it appears in the Grimoire's inbox.
12. The Grimoire dashboard loads and **logging in works over HTTPS** — this
    is the step that fails if the cookies are wrong.
13. **Logging out works**, and the admin API then answers 401.
14. A bookmark can be added, survives a reload, and can be removed.
15. The reading preferences change the article's width and survive a reload.
16. A branching story can be walked from the start to an ending.

---

## 12. A checklist before the first deployment

- [ ] The production database target has been chosen and approved.
- [ ] `DATABASE_URL` points at it, with `sslmode=require`.
- [ ] `JWT_SECRET` and `CSRF_SECRET` are new, random and different from
      the development and test values.
- [ ] `NODE_ENV=production`.
- [ ] `FRONTEND_ORIGIN` lists the exact site origins.
- [ ] `TRUST_PROXY_HOPS` is set to the real number of proxies in front of
      the API (see §5.1). **Getting this wrong locks every visitor out of
      the rate-limited endpoints.**
- [ ] TLS is terminated in front of the API.
- [ ] The static site is served from its own directory, with no `.env` in it.
- [ ] The static site and the API are on the same origin, **or** the site's
      API base is set through `window.__API_BASE__` or a `api-base` meta
      tag (see §5).
- [ ] `migrate deploy` has been run once, as a release step.
- [ ] The first administrator has been created with the existing script.
- [ ] **The stale test accounts have been removed** from the administrator
      table (see §7.1).
- [ ] A backup has been taken and its restore rehearsed in a scratch database.
- [ ] The health check is wired to the platform's readiness probe.
- [ ] Logs are collected somewhere with a retention policy.
- [ ] The smoke tests in §11 have been run against the deployed origin.
